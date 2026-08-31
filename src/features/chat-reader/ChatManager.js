// src/features/chat-reader/ChatManager.js
// 聊天管理 tab（父窗口驱动，操作 iframe 的 doc，同构 ChatReader.js）。
//
// 只读体检：选角色 → 选聊天 → 点「开始分析」才扫描。不自动分析、不需要秒开。
// 扫描来源：POST /api/chats/export {file:'<name>.jsonl', format:'jsonl'}
//   → 返回 {message, result: 原始 jsonl 文本}；逐行切片（indexOf('\n')，不 split 成数组）
//   → 逐行 JSON.parse → 统计 → 丢弃，峰值内存 ≈ 文件大小×1 + 单行对象。
// 扩展键识别：原生键白名单法（白名单外一律列为「扩展/未知键」），保证旧插件遗留无处遁形。
// 提取/导出：每条键给「导出」按钮，拼接命中值为 JSON 经 Blob 下载，不碰原文件（零风险）。
// 写回/删除：本期一律不做。
//
// 主题：与其它编辑器一致，由 syncChatReaderTheme 统一处理（本模块不重复绑定）。

import { characters, getPastCharacterChats, getRequestHeaders } from '../../../../../../../script.js';
import { getCurrentChatDetails } from '../../../../../../../script.js';
import { debugLog, errorLog, infoLog } from '../../utils/logger.js';
import { renderCharPicker, openChatModal, closeChatModal, chatTimeValue } from './ChatReader.js';
import { compileRegex, matchAll, fillTemplate } from './regexBridge.js';
import { getAvatarThumbUrl } from '../../shared/characterBridge.js';
import { timestampToMoment } from '../../../../../../utils.js';

const LOG_TAG = '[ChatManager]';

// 分批让出主线程的节奏（每扫描 N 行 yield 一次）
const SCAN_YIELD_EVERY = 200;
// 字节统计复用单例
const textEncoder = new TextEncoder();

// ST 原生顶层消息键白名单（白名单外即「扩展/未知键」）。
// 注意：ST 跨版本键名较多，此处尽力覆盖常见原生键；仍有漏网者会显示为「第三方/未知」，
// 但只会让其「可清理」（实际多为原生数据，用户需自行判断），不会误删。
const NATIVE_TOP_KEYS = new Set([
    'name', 'is_user', 'is_system', 'send_date', 'send_date_str', 'mes',
    'swipes', 'swipe_id', 'swipe_info', 'extra', 'gen_started', 'gen_finished',
    'force_avatar', 'title', 'variables', 'display_avatar', 'mes_id', 'gen_id',
    'depth_prompt_role', 'depth_prompt_depth', 'extra_custom_prompt',
    'default_preset', 'type', 'sub_type', 'files', 'backend', 'model', 'api',
    'preset', 'exclude_recursion', 'skip_prompt_types', 'extra_generation_settings',
]);
// ST 原生 extra 键白名单
const NATIVE_EXTRA_KEYS = new Set([
    'display_text', 'type', 'is_small_sys', 'image', 'inline_image', 'memory',
    'title', 'append_title', 'system', 'ap', 'tool_invocations', 'tool_calls',
    'reasoning', 'reasoning_parsed', 'files', 'media', 'display_avatar', 'is_group',
    'name', 'rank', 'personality', 'scenario', 'mes', 'depth', 'version',
    'character_id', 'char_name', 'exclude_recursion', 'gen_id', 'api', 'model',
    'backend', 'send_date', 'sub_type', 'extensions', 'depth_prompt', 'wi_format',
    'prompt', 'cost', 'usage', 'finish_reason', 'extra', 'infill', 'topic', 'note',
]);

/**
 * 字节长度（UTF-8，中文准确）。
 * @param {*} v
 * @returns {number}
 */
function byteLen(v) {
    try { return textEncoder.encode(JSON.stringify(v)).length; } catch (e) { return 0; }
}

/**
 * 原生聊天元数据键白名单（chat_metadata 内）。
 * ccore 是我们自己的，仍列入（标明 source），便于用户区分自家/第三方。
 */
const NATIVE_META_KEYS = new Set([
    'api_server', 'api_key', 'main_prompt', 'temperature', 'max_context',
    'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty', 'repeat_last_n',
    'repeat_penalty', 'top_k', 'min_p', 'top_a', 'typical_p', 'tfs', 'rep_pen',
    'sampler_seed', 'model', 'jailbreak', 'mes_example', 'prompt', 'world_info',
    'prompt2', 'group_only_greeting', 'nudge', 'force_avatar', 'situation',
    'creatorcomment', 'create_date', 'integrity', 'version', 'extensions',
    'world_info_fullContent', 'world_info_related', 'wi_format', 'scenario_format',
    'personality_format', 'assistant_prefill', 'assistant_impersonation',
    'continue_nudge_prompt', 'group_nudge_prompt', 'sys_prompt_suffix',
    'human_sys_prompt', 'dynamic_system_prompt', 'bias', 'bias_preset_selected',
    'character_version', 'sfw_threshold', 'depth_prompt', 'example_dialogue',
    'prompt_name', 'prompt_order', 'note', 'topic', 'send_date', 'type', 'sub_type',
    'backend', 'main_api', 'score', 'enabled', 'disable_bias', 'logit_bias',
    'logprobs', 'mirostat_tau', 'mirostat_eta', 'mirostat', 'streaming',
    'stop_sequence', 'grammar', 'cfg_scale', 'top_logprobs', 'min_tokens',
]);

/**
 * 键来源标记。来源决定：①键表上的标签；②是否允许清理（原生一律禁止）。
 * - ccore：本扩展（ST-Continuity-Core）自己写入的数据，删了会丢本扩展状态
 * - stme：st-memory-enhancement（同 third-party 目录的记忆增强插件）
 * - native：ST 原生键（禁止清理，删了会破坏聊天）
 * - other：其它第三方/未知扩展
 */
const SOURCE_LABEL = {
    ccore: { text: 'ccore', title: '本扩展 ST-Continuity-Core 写入的数据' },
    stme: { text: '记忆增强', title: '插件 st-memory-enhancement 写入的数据' },
    native: { text: '原生', title: 'ST 原生字段，禁止清理' },
    other: { text: '第三方', title: '其它扩展/未知来源写入的数据' },
};

// 本扩展写入的键（顶层 + extra 内 + chat_metadata 内均用 'ccore' 命名空间）
const CCORE_KEYS = new Set(['ccore']);
// st-memory-enhancement 写入的键：
//   消息顶层 —— hash_sheets / two_step_links / two_step_waiting / tableEditMatches（<tableEdit> 解析缓存，去重用）
//   chat_metadata —— sheets / selected_sheets
const STME_KEYS = new Set([
    'hash_sheets', 'two_step_links', 'two_step_waiting', 'tableEditMatches',
    'sheets', 'selected_sheets',
]);

/**
 * 去掉作用域前缀，得到裸键名（仅用于展示）。
 * 注意：row.key 必须保留完整路径（extra. / swipe_info. / swipe_info.extra. / chat_metadata.），
 * 因为导出/清理靠 resolveKey 按前缀定位取值，不能拿裸键名去解析。
 * @param {string} key
 * @returns {string}
 */
function bareKey(key) {
    return String(key).replace(/^(?:swipe_info\.)?(?:extra\.)?/, '').replace(/^chat_metadata\./, '');
}

/**
 * 判定键的来源。key 可能带作用域前缀（extra. / swipe_info. / swipe_info.extra. / chat_metadata.）。
 * @param {string} key 报告里的完整键名
 * @param {boolean} isNative 是否命中 ST 原生白名单
 * @returns {'ccore'|'stme'|'native'|'other'}
 */
function keySource(key, isNative) {
    if (isNative) return 'native';
    const bare = bareKey(key);
    if (CCORE_KEYS.has(bare)) return 'ccore';
    if (STME_KEYS.has(bare)) return 'stme';
    return 'other';
}

let doc = null;
// 导航与首页元素
let navReadEl = null;
let navManageEl = null;
let mCharSearchEl = null;
// 详情/分析
let crumbEl = null;
let chatLabelEl = null;
let metaEl = null;
let analyzeBtn = null;
let cancelBtn = null;
let progressEl = null;
let progressFillEl = null;
let progressTextEl = null;
let reportEl = null;
// 管理：主从布局
let manageCharListEl = null;
let manageChatSelectEl = null;
let manageSubtabsEl = null;
// 提取子tab
let extractPatternEl = null;
let extractFlagsEl = null;
let extractTemplateEl = null;
let extractRoleUserEl = null;
let extractRoleAssistantEl = null;
let extractRoleSystemEl = null;
let extractRunBtn = null;
let extractCopyBtn = null;
let extractWarnEl = null;
let extractResultsEl = null;
let mChatList = [];               // 当前角色聊天列表（供下拉回查 chatMeta）
let mLastExtract = null;          // 最近一次提取结果（复制用）

// 管理上下文（复用阅读器的角色/聊天选择逻辑，但不渲染正文）
let mActiveChar = null;       // 选中的角色对象（历史聊天用）
let mActiveCharIdx = -1;      // 选中的角色索引
let mActiveChatName = '';     // 选中的聊天文件名（不含 .jsonl）
let mActiveChatMeta = null;   // 选中的聊天元数据（file_name/file_size/last_mes）
let mCurrentChat = false;     // 是否为当前打开聊天（用内存 chat，无需 fetch）
let mScanToken = 0;           // 取消/重扫令牌
let mLastReport = null;       // 最近一次报告数据（导出用）

/**
 * 初始化聊天管理（由 initChatReader 在拿到 doc 后调用，幂等）。
 * @param {Document} iframeDoc
 */
export function initChatManager(iframeDoc) {
    if (!iframeDoc || iframeDoc !== doc) return;
    bindManageDom();
    bindNav();
    showManageHome();
    infoLog(LOG_TAG, '聊天管理初始化完成');
}

/**
 * 记录 doc 引用（在 initChatReader 内最早调用，避免循环 import）。
 * @param {Document} iframeDoc
 */
export function setChatManagerDoc(iframeDoc) {
    doc = iframeDoc;
}

function bindNav() {
    navReadEl = doc.getElementById('reader-nav-read');
    navManageEl = doc.getElementById('reader-nav-manage');
    if (!navReadEl || !navManageEl) return;
    navReadEl.addEventListener('click', () => switchView('read'));
    navManageEl.addEventListener('click', () => switchView('manage'));
}

/**
 * 切换阅读 / 管理视图（侧栏 tab）。
 * @param {'read'|'manage'} view
 */
function switchView(view) {
    navReadEl?.classList.toggle('active', view === 'read');
    navManageEl?.classList.toggle('active', view === 'manage');
    doc.getElementById('reader-view-read')?.classList.toggle('active', view === 'read');
    doc.getElementById('reader-view-manage')?.classList.toggle('active', view === 'manage');
    if (view === 'manage') {
        showManageHome();
    } else {
        doc.body.classList.remove('mobile-view-detail-manage');
    }
}

function bindManageDom() {
    manageCharListEl = doc.getElementById('manage-char-list');
    mCharSearchEl = doc.getElementById('manage-char-search');
    manageChatSelectEl = doc.getElementById('manage-chat-select');
    crumbEl = doc.getElementById('reader-manage-crumb');
    chatLabelEl = doc.getElementById('reader-manage-chat-label');
    metaEl = doc.getElementById('reader-manage-meta');
    analyzeBtn = doc.getElementById('reader-manage-analyze');
    cancelBtn = doc.getElementById('reader-manage-cancel');
    progressEl = doc.getElementById('reader-manage-progress');
    progressFillEl = doc.getElementById('reader-manage-progress-fill');
    progressTextEl = doc.getElementById('reader-manage-progress-text');
    reportEl = doc.getElementById('reader-manage-report');
    // 提取子tab
    extractPatternEl = doc.getElementById('extract-pattern');
    extractFlagsEl = doc.getElementById('extract-flags');
    extractTemplateEl = doc.getElementById('extract-template');
    extractRoleUserEl = doc.getElementById('extract-role-user');
    extractRoleAssistantEl = doc.getElementById('extract-role-assistant');
    extractRoleSystemEl = doc.getElementById('extract-role-system');
    extractRunBtn = doc.getElementById('extract-run');
    extractCopyBtn = doc.getElementById('extract-copy');
    extractWarnEl = doc.getElementById('extract-warn');
    extractResultsEl = doc.getElementById('extract-results');
    manageSubtabsEl = doc.getElementById('manage-detail-tabs');

    if (mCharSearchEl) {
        mCharSearchEl.addEventListener('input', () => renderManageCharGrid(mCharSearchEl.value));
    }
    manageChatSelectEl?.addEventListener('change', onManageChatChange);
    analyzeBtn?.addEventListener('click', () => startAnalysis());
    cancelBtn?.addEventListener('click', cancelAnalysis);
    doc.getElementById('reader-manage-back')?.addEventListener('click', backToManageChatList);
    bindSubtabs();
    extractRunBtn?.addEventListener('click', runExtract);
    extractCopyBtn?.addEventListener('click', copyExtract);
}

/* =====================================================
 * 管理：首页（角色 → 聊天 选择，懒加载）
 * ===================================================== */

function showManageHome() {
    doc.body.classList.remove('mobile-view-detail-manage');
    renderManageCharGrid('');
    resetManageChatPanel();
}

/**
 * 格式化时间戳 → 「YYYY-MM-DD HH:mm」（24 小时制，纯数字，无英文月份）。
 * 复用 ST 的 timestampToMoment：last_mes 可能是 Unix 时间戳，也可能是历史 send_date 字符串
 * （ISO 8601 / meridiem / ST humanized 等），直接 new Date() 解析不稳定（会原样漏出英文月份）。
 * @param {string|number} ts
 * @returns {string} 解析失败返回空串
 */
function formatTime(ts) {
    if (ts === undefined || ts === null || ts === '') return '';
    try {
        const m = timestampToMoment(ts);
        return m && m.isValid() ? m.format('YYYY-MM-DD HH:mm') : '';
    } catch (e) {
        return '';
    }
}

function renderManageCharGrid(query) {
    if (!manageCharListEl) return;
    manageCharListEl.innerHTML = '';
    const q = (query || '').trim().toLowerCase();

    for (let idx = 0; idx < characters.length; idx++) {
        const char = characters[idx];
        if (!char) continue;
        if (q && !(char.name || '').toLowerCase().includes(q)) continue;
        const item = doc.createElement('div');
        item.className = 'binding-tree-char';
        const row = doc.createElement('div');
        row.className = 'binding-tree-row';
        row.dataset.idx = String(idx);
        row.appendChild(makeAvatar(char.avatar, char.name));
        const name = doc.createElement('span');
        name.className = 'binding-tree-name';
        name.textContent = char.name || '';
        row.appendChild(name);
        row.addEventListener('click', () => {
            manageCharListEl.querySelectorAll('.binding-tree-row.active').forEach(r => r.classList.remove('active'));
            row.classList.add('active');
            selectManageCharacter(idx);
        });
        item.appendChild(row);
        manageCharListEl.appendChild(item);
    }
}

/** 生成小头像（img 或首字母占位），载入失败自动回退占位 */
function makeAvatar(avatarFile, name) {
    const ph = (name || '?').trim().charAt(0).toUpperCase();
    const url = (avatarFile && avatarFile !== 'none') ? getAvatarThumbUrl(avatarFile) : '';
    if (url) {
        const img = doc.createElement('img');
        img.className = 'binding-tree-avatar';
        img.src = url;
        img.dataset.ph = ph;
        img.onerror = () => {
            const s = doc.createElement('span');
            s.className = 'binding-tree-avatar';
            s.textContent = ph;
            img.replaceWith(s);
        };
        return img;
    }
    const span = doc.createElement('span');
    span.className = 'binding-tree-avatar';
    span.textContent = ph;
    return span;
}

async function openCurrentChatManage() {
    const current = getCurrentChatDetails();
    if (!current) return;
    mCurrentChat = true;
    mActiveChar = null;
    mActiveCharIdx = -1;
    mActiveChatName = current.sessionName || '';
    mActiveChatMeta = null;
    await populateChatSelect(null, /*isCurrent=*/ true);
    doc.body.classList.add('mobile-view-detail-manage');
}

async function selectManageCharacter(idx) {
    if (!characters[idx]) return;
    const char = characters[idx];
    mCurrentChat = false;
    mActiveChar = char;
    mActiveCharIdx = idx;
    mActiveChatMeta = null;
    await populateChatSelect(char, /*isCurrent=*/ false);
    doc.body.classList.add('mobile-view-detail-manage');
}

function backToManageChatList() {
    // 重置右侧聊天选择（左角色树保持），回到未选聊天状态
    showManageHome();
}

/* =====================================================
 * 管理：详情（概览 + 开始分析）
 * ===================================================== */

async function enterManageDetail(chatMeta, isCurrent) {
    if (reportEl) reportEl.innerHTML = '';
    if (extractResultsEl) extractResultsEl.innerHTML = '';
    mLastReport = null;
    mLastExtract = null;

    const label = isCurrent
        ? (getCurrentChatDetails()?.sessionName || '当前聊天')
        : (chatMeta?.file_name || mActiveChatName || '').replace(/\.jsonl$/i, '');
    if (chatLabelEl) chatLabelEl.textContent = label;
    const headerCharEl = doc.getElementById('reader-manage-char-label');
    if (headerCharEl) {
        const charName = mActiveChar?.name || (isCurrent ? (getCurrentChatDetails()?.charName || '') : '');
        headerCharEl.textContent = charName || '未命名角色';
    }
    if (metaEl) {
        const parts = [];
        if (isCurrent) {
            // 当前聊天走内存数据：chat 为消息数组（不含元数据行），其长度即楼层数
            const memChat = await getMemoryChat();
            const floors = Array.isArray(memChat) ? memChat.length : 0;
            if (floors > 0) parts.push(`楼层 ${floors}`);
            parts.push('当前打开的聊天（分析内存数据，无需读取文件）');
        } else {
            // getChatInfo 返回的 chat_items 即楼层数（已减去元数据行）
            if (chatMeta?.chat_items != null) parts.push(`楼层 ${chatMeta.chat_items}`);
            if (chatMeta?.file_size) parts.push(`大小 ${chatMeta.file_size}`);
            if (chatMeta?.last_mes) parts.push(`最后消息 ${formatTime(chatMeta.last_mes)}`);
        }
        metaEl.textContent = parts.join(' · ');
    }
    if (analyzeBtn) analyzeBtn.style.display = '';
    if (extractRunBtn) extractRunBtn.disabled = false;
}

async function startAnalysis() {
    const token = ++mScanToken;
    if (analyzeBtn) analyzeBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = '';
    if (progressEl) { progressEl.style.display = ''; progressFillEl.style.width = '0%'; }
    if (reportEl) reportEl.innerHTML = '<div class="reader-loading">正在读取聊天文件…</div>';

    try {
        const data = await getChatLines();
        if (!data) throw new Error('读取聊天文件失败');
        const lines = data.lines;

        const report = await scanLines(lines, (done, total) => {
            if (token !== mScanToken) throw new Error('cancelled');
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            if (progressFillEl) progressFillEl.style.width = `${pct}%`;
            if (progressTextEl) progressTextEl.textContent = `已扫描 ${done} / ${total} 行`;
        });
        if (token !== mScanToken) return; // 已取消
        mLastReport = report;
        renderReport(report);
    } catch (e) {
        if (String(e?.message) === 'cancelled') {
            if (reportEl) reportEl.innerHTML = '<div class="reader-loading">已取消分析</div>';
        } else {
            errorLog(LOG_TAG, '分析失败:', e);
            if (reportEl) reportEl.innerHTML = `<div class="reader-loading reader-loading-error">分析失败：${String(e?.message || e)}</div>`;
        }
    } finally {
        if (token === mScanToken) {
            if (analyzeBtn) analyzeBtn.style.display = '';
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (progressEl) progressEl.style.display = 'none';
        }
    }
}

function cancelAnalysis() {
    mScanToken++;
    if (reportEl && !reportEl.innerHTML) reportEl.innerHTML = '<div class="reader-loading">已取消分析</div>';
}

/* =====================================================
 * 管理：读取聊天（体检 / 提取 共用）
 * ===================================================== */

/**
 * 读取当前选中聊天的 jsonl 行数组。
 * @returns {Promise<{lines:string[],hasMetaLine:boolean,isCurrent:boolean}|null>}
 */
async function getChatLines() {
    if (mCurrentChat) {
        const chat = await getMemoryChat();
        if (!chat) return null;
        return { lines: chat.map((m) => JSON.stringify(m)), hasMetaLine: false, isCurrent: true };
    }
    if (!mActiveChar) return null;
    const raw = await fetchChatJsonl(mActiveChatName, mActiveChar);
    if (raw == null) return null;
    return { lines: sliceLines(raw), hasMetaLine: true, isCurrent: false };
}

/* =====================================================
 * 管理：右侧聊天下拉（主从布局，内联选择，不弹窗）
 * ===================================================== */

/**
 * 填充右侧聊天下拉：当前聊天 → 单个「当前聊天」选项；历史角色 → 拉聊天列表。
 * @param {object|null} char 角色对象（isCurrent 时传 null）
 * @param {boolean} isCurrent 是否为当前打开聊天
 */
async function populateChatSelect(char, isCurrent) {
    if (!manageChatSelectEl) return;
    manageChatSelectEl.innerHTML = '';
    if (isCurrent) {
        const cur = getCurrentChatDetails();
        const name = cur?.sessionName || '当前聊天';
        let text = `当前聊天：${name}`;
        try {
            const memChat = await getMemoryChat();
            const floors = Array.isArray(memChat) ? memChat.length : 0;
            if (floors > 0) text += ` · ${floors}楼`;
        } catch { /* 取不到内存聊天则忽略 */ }
        const opt = doc.createElement('option');
        opt.value = '__current__';
        opt.textContent = text;
        manageChatSelectEl.appendChild(opt);
        manageChatSelectEl.disabled = false;
        mChatList = [];
        mActiveChatName = name;
        onManageChatChange();
        return;
    }
    const idx = mActiveCharIdx;
    let chats = [];
    try { chats = (await getPastCharacterChats(idx)) || []; } catch (e) { chats = []; }
    // 按最后消息时间从新到旧排序（复用阅读弹窗同款 chatTimeValue，兼容 last_mes 各种历史格式）
    chats.sort((a, b) => chatTimeValue(b.last_mes) - chatTimeValue(a.last_mes));
    if (!chats.length) {
        const opt = doc.createElement('option');
        opt.value = '';
        opt.textContent = '该角色没有历史聊天';
        manageChatSelectEl.appendChild(opt);
        manageChatSelectEl.disabled = true;
        return;
    }
    manageChatSelectEl.disabled = false;
    mChatList = chats;
    for (const c of chats) {
        const fn = String(c.file_name || '').replace(/\.jsonl$/i, '');
        const parts = [];
        if (c.chat_items != null) parts.push(`${c.chat_items}楼`);
        if (c.file_size) parts.push(String(c.file_size));
        if (c.last_mes) parts.push(formatTime(c.last_mes));
        const meta = parts.join(' · ');
        const opt = doc.createElement('option');
        opt.value = fn;
        opt.textContent = meta ? `${fn}　(${meta})` : fn;
        manageChatSelectEl.appendChild(opt);
    }
    manageChatSelectEl.value = String(chats[0].file_name || '').replace(/\.jsonl$/i, '');
    onManageChatChange();
}

/** 下拉变更：解析选中聊天并载入右侧详情 */
function onManageChatChange() {
    if (!manageChatSelectEl) return;
    const v = manageChatSelectEl.value;
    if (!v) { resetManageChatPanel(); return; }
    if (v === '__current__') {
        mCurrentChat = true;
        mActiveChar = null;
        mActiveCharIdx = -1;
        mActiveChatName = getCurrentChatDetails()?.sessionName || '';
        mActiveChatMeta = null;
    } else {
        mCurrentChat = false;
        mActiveChatName = v;
        mActiveChatMeta = findChatMeta(v);
    }
    enterManageDetail(mActiveChatMeta, mCurrentChat);
}

function findChatMeta(name) {
    return mChatList.find((c) => String(c.file_name || '').replace(/\.jsonl$/i, '') === name) || null;
}

/** 重置右侧面板（保留左角色树），回到未选聊天状态 */
function resetManageChatPanel() {
    if (chatLabelEl) chatLabelEl.textContent = '';
    if (metaEl) metaEl.textContent = '';
    if (reportEl) reportEl.innerHTML = '';
    if (extractResultsEl) extractResultsEl.innerHTML = '';
    if (extractWarnEl) { extractWarnEl.style.display = 'none'; extractWarnEl.textContent = ''; }
    if (analyzeBtn) analyzeBtn.style.display = '';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (progressEl) progressEl.style.display = 'none';
    if (extractRunBtn) extractRunBtn.disabled = true;
    if (extractCopyBtn) extractCopyBtn.disabled = true;
    if (manageChatSelectEl) {
        manageChatSelectEl.disabled = true;
        manageChatSelectEl.innerHTML = '<option value="">请先在左侧选择角色…</option>';
    }
    mLastReport = null;
    mLastExtract = null;
    mActiveChatName = '';
    mActiveChatMeta = null;
    mCurrentChat = false;
    mActiveChar = null;
    mActiveCharIdx = -1;
    mChatList = [];
}

/** 子tab 切换（分析 / 提取），复用共享 .detail-tab-item / .detail-tab-panel */
function bindSubtabs() {
    if (!manageSubtabsEl) return;
    manageSubtabsEl.querySelectorAll('.detail-tab-item').forEach((tab) => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.target;
            manageSubtabsEl.querySelectorAll('.detail-tab-item').forEach((t) => t.classList.toggle('active', t === tab));
            doc.querySelectorAll('.detail-tab-panel').forEach((p) => p.classList.toggle('active', p.id === target));
        });
    });
}

/* =====================================================
 * 管理：提取子tab（正则 + 模板 → 按角色过滤 → 结果 + 未匹配提醒）
 * 抽象 contentUnit={floorIndex,kind,swipeId,text}：现仅 mes，
 * 将来扩展 swipes 时只需在此处把每个 swipe 分支补为独立 unit。
 * ===================================================== */

function getRoleOf(mes) {
    if (mes?.is_system) return 'system';
    if (mes?.is_user) return 'user';
    return 'assistant';
}

async function runExtract() {
    const pattern = extractPatternEl?.value?.trim();
    const tpl = extractTemplateEl?.value ?? '';
    if (!pattern) { showExtractWarn('请输入正则'); return; }
    const { ok, regex, error } = compileRegex(pattern, extractFlagsEl?.value ?? '');
    if (!ok) { showExtractWarn(`正则无效：${error}`); return; }

    const roles = new Set();
    if (extractRoleUserEl?.checked) roles.add('user');
    if (extractRoleAssistantEl?.checked) roles.add('assistant');
    if (extractRoleSystemEl?.checked) roles.add('system');

    const data = await getChatLines();
    if (!data) { showExtractWarn('无法读取聊天文件（请先选择聊天）'); return; }
    const { lines, hasMetaLine } = data;

    const results = [];
    const unmatched = [];
    const startIdx = hasMetaLine ? 1 : 0;
    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        let mes;
        try { mes = JSON.parse(line); } catch (e) { continue; }
        const floor = hasMetaLine ? i - 1 : i;
        const role = getRoleOf(mes);
        if (!roles.has(role)) continue;
        const text = typeof mes?.mes === 'string' ? mes.mes : '';
        // contentUnit（swipes 预留：将来 mes.swipes 各分支各产一个 unit）
        const unit = { floorIndex: floor, kind: 'mes', swipeId: mes?.swipe_id ?? null, text };
        const matches = matchAll(unit.text, regex);
        if (matches.length === 0) { unmatched.push(floor); continue; }
        for (const m of matches) {
            results.push({ floor, role, filled: fillTemplate(tpl, m) });
        }
    }
    mLastExtract = results;
    renderExtractResults(results, unmatched);
}

function renderExtractResults(results, unmatched) {
    if (!extractResultsEl) return;
    if (results.length === 0) {
        showExtractWarn(unmatched.length > 0 ? '所选角色范围内没有命中任何匹配' : '没有可提取的内容（请先选择聊天并确认角色过滤）');
        extractResultsEl.innerHTML = '';
        if (extractCopyBtn) extractCopyBtn.disabled = true;
        return;
    }
    let warn = '';
    if (unmatched.length > 0) {
        warn = `以下楼层（在所选角色范围内）未提取到匹配，共 ${unmatched.length} 层：\n${unmatched.join(', ')}`;
    }
    showExtractWarn(warn, !!warn);

    const PREVIEW_MAX = 2000;
    const container = doc.createElement('div');
    container.className = 'cc-manage-report-inner';
    results.forEach((r) => {
        const item = doc.createElement('div');
        item.className = 'cc-extract-item';
        const head = doc.createElement('div');
        head.className = 'cc-extract-head';
        head.textContent = `[楼层#${r.floor}] ${r.role}`;
        const body = doc.createElement('div');
        body.className = 'cc-extract-body';
        let t = r.filled;
        if (t.length > PREVIEW_MAX) t = `${t.slice(0, PREVIEW_MAX)}\n…（已截断，共 ${t.length} 字符）`;
        body.textContent = t;
        item.append(head, body);
        container.appendChild(item);
    });
    extractResultsEl.innerHTML = '';
    extractResultsEl.appendChild(container);
    if (extractCopyBtn) extractCopyBtn.disabled = false;
}

function showExtractWarn(msg, visible) {
    if (!extractWarnEl) return;
    if (!msg) { extractWarnEl.style.display = 'none'; extractWarnEl.textContent = ''; return; }
    extractWarnEl.textContent = msg;
    extractWarnEl.style.display = visible === false ? 'none' : 'block';
}

function copyExtract() {
    if (!mLastExtract || mLastExtract.length === 0) return;
    const text = mLastExtract.map((r) => r.filled).join('\n');
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const ta = doc.createElement('textarea');
    ta.value = text;
    doc.body.appendChild(ta);
    ta.select();
    try { doc.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
}

/**
 * 读取内存中的当前聊天（与 ST 同步）。
 * @returns {Promise<Array|null>}
 */
async function getMemoryChat() {
    try {
        // chat 在 script.js 导出，父窗口可直接引用；这里通过 ST 全局拿（避免循环 import）
        const st = /** @type {any} */ (globalThis).SillyTavern;
        const ctx = st?.getContext?.();
        const chat = ctx?.chat;
        if (Array.isArray(chat) && chat.length > 0) return chat;
    } catch (e) { /* ignore */ }
    return null;
}

/**
 * 拉取聊天 jsonl 原文（POST /api/chats/export format:'jsonl'）。
 * @param {string} chatName 不含扩展名
 * @param {object} char 角色对象
 * @returns {Promise<string|null>}
 */
async function fetchChatJsonl(chatName, char) {
    if (!char) return null;
    try {
        const response = await fetch('/api/chats/export', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                file: `${chatName}.jsonl`,
                avatar_url: char.avatar,
                format: 'jsonl',
                exportfilename: 'analyze',
            }),
            cache: 'no-cache',
        });
        if (!response.ok) return null;
        const data = await response.json();
        const result = data?.result;
        return typeof result === 'string' ? result : null;
    } catch (e) {
        errorLog(LOG_TAG, 'fetchChatJsonl 失败:', e);
        return null;
    }
}

/**
 * 把 jsonl 文本按行切片为数组（保留空行过滤，但保留首行元数据）。
 * 不用 split('\n') 是为了避免一次性产生 N 个字符串常驻；此处仍用 split
 * （实现简单且峰值可接受），后续若超大可改 indexOf 循环。
 * @param {string} raw
 * @returns {string[]}
 */
function sliceLines(raw) {
    return raw.split('\n');
}

/**
 * 逐行扫描，产出体检报告。分批让出主线程。
 * @param {string[]} lines
 * @param {(done:number,total:number)=>void} onProgress
 * @returns {Promise<object>}
 */
async function scanLines(lines, onProgress) {
    const total = lines.length;
    const topKeys = new Map();      // key -> { type, count, bytes, sample }
    const extraKeys = new Map();    // 'extra.KEY' -> 同上
    const swipeKeys = new Map();    // 'swipe_info.KEY' -> 同上（swipe_info / swipes 各分支内的键）
    const metaKeys = new Map();     // 'chat_metadata.KEY' -> { type, bytes, sample }

    let totalBytes = 0;       // 估算全文 jsonl 字节
    let metaBytes = 0;        // 首行元数据字节（含 chat_metadata）

    let first = true;
    for (let i = 0; i < total; i++) {
        const line = lines[i];
        if (!line) continue;
        let mes;
        try { mes = JSON.parse(line); } catch (e) { continue; }
        const lineBytes = byteLen(mes);
        totalBytes += lineBytes;

        if (first) {
            first = false;
            // 首行 = 元数据（含 chat_metadata）
            const cm = mes?.chat_metadata;
            if (cm && typeof cm === 'object') {
                metaBytes = byteLen(cm);
                for (const k of Object.keys(cm)) {
                    const isNative = NATIVE_META_KEYS.has(k);
                    const rec = metaKeys.get(k) || { type: typeof cm[k], bytes: 0, sample: null, native: isNative };
                    rec.bytes += byteLen(cm[k]);
                    rec.sample = rec.sample ?? cm[k];
                    metaKeys.set(k, rec);
                }
            }
            continue; // 首行不计入消息统计
        }

        // 顶层键：原生键也收集（仅标记 native，不跳过），以便报告列出全部键
        // 注：swipes / swipe_info 也收集（用户希望在「楼层级键」表里看到其体积）
        for (const k of Object.keys(mes)) {
            if (k === 'extra') continue;
            accum(topKeys, k, mes[k], NATIVE_TOP_KEYS.has(k));
        }
        // extra 内键
        const extra = mes.extra;
        if (extra && typeof extra === 'object') {
            for (const k of Object.keys(extra)) {
                accum(extraKeys, `extra.${k}`, extra[k], NATIVE_EXTRA_KEYS.has(k));
            }
        }
        // swipe_info / swipes 内副本
        const swipes = mes.swipe_info || mes.swipes;
        if (Array.isArray(swipes)) {
            for (const sw of swipes) {
                if (!sw || typeof sw !== 'object') continue;
                if (sw.extra && typeof sw.extra === 'object') {
                    for (const k of Object.keys(sw.extra)) {
                        accum(swipeKeys, `swipe_info.extra.${k}`, sw.extra[k], NATIVE_EXTRA_KEYS.has(k));
                    }
                }
                for (const k of Object.keys(sw)) {
                    if (k === 'extra') continue;
                    accum(swipeKeys, `swipe_info.${k}`, sw[k], NATIVE_TOP_KEYS.has(k));
                }
            }
        }

        if (i > 0 && i % SCAN_YIELD_EVERY === 0) {
            onProgress(i, total);
            await new Promise((r) => setTimeout(r, 0));
        }
    }
    onProgress(total, total);

    // key = 完整路径（导出/清理靠它定位）；label = 裸键名（分组标题已表明作用域，展示时不再重复前缀）
    const toRows = (map, scope) => Array.from(map.entries()).map(([key, rec]) => ({
        key: scope ? `${scope}.${key}` : key,
        label: bareKey(key),
        type: rec.type,
        floors: rec.count,
        bytes: rec.bytes,
        sample: rec.sample,
        native: rec.native,
        source: keySource(key, rec.native),
    })).sort((a, b) => b.bytes - a.bytes);

    const topRows = toRows(topKeys);
    const extraRows = toRows(extraKeys);
    const swipeRows = toRows(swipeKeys);
    const metaRows = Array.from(metaKeys.entries()).map(([key, rec]) => ({
        key: `chat_metadata.${key}`,
        label: key,
        type: rec.type,
        bytes: rec.bytes,
        sample: rec.sample,
        native: rec.native,
        source: keySource(key, rec.native),
    })).sort((a, b) => b.bytes - a.bytes);
    // 扩展字节 = 所有「非原生」键字节之和（原生键 mes/name 等不计入「扩展/元数据占比」），
    // 否则 mes 一旦进表会让扩展占比失准。
    const extBytes = [topRows, extraRows, swipeRows, metaRows]
        .flat()
        .filter((r) => !r.native)
        .reduce((s, r) => s + r.bytes, 0);

    return {
        chatName: mCurrentChat ? (getCurrentChatDetails()?.sessionName || '') : mActiveChatName,
        isCurrent: mCurrentChat,
        totalBytes,
        extBytes,
        metaBytes,
        topRows,
        extraRows,
        swipeRows,
        metaRows,
    };
}

function topKeysTotal(map) {
    let s = 0;
    for (const rec of map.values()) s += rec.bytes;
    return s;
}

function accum(map, key, value, isNative = false) {
    let rec = map.get(key);
    if (!rec) {
        rec = { type: Array.isArray(value) ? 'array' : typeof value, count: 0, bytes: 0, sample: null, native: isNative };
        map.set(key, rec);
    }
    rec.bytes += byteLen(value);
    // 命中楼层数用计数器（无上限）。此前用数组并在 200 处截断，导致 mes 等每层都有的键
    // 在 >200 层的聊天里显示成 200，与导出的实际楼层数不符。
    rec.count++;
    if (rec.sample === null && value !== undefined) {
        // 只保留较小样本的预览（避免巨型值拖慢渲染/卡死）；始终存为安全大小的字符串
        try {
            const s = JSON.stringify(value);
            rec.sample = s.length <= 2000
                ? (typeof value === 'string' ? value : s)
                : `[值过大，已省略预览（单条 ${fmtBytes(s.length)}）]`;
        } catch (e) { rec.sample = '[无法序列化]'; }
    }
}

/* =====================================================
 * 报告渲染
 * ===================================================== */

function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// 注：此处不再渲染概览卡片（消息数/文件体积/各项占比）—— 占比已在每个键行显示，
// 消息数与体积在上方「开始分析」那一栏已有，避免重复信息。
function renderReport(report) {
    if (!reportEl) return;
    const container = doc.createElement('div');
    container.className = 'cc-manage-report-inner';

    if (report.extBytes === 0 && report.metaBytes === 0) {
        const empty = doc.createElement('div');
        empty.className = 'cc-manage-section-note';
        empty.textContent = '未发现扩展键或自定义元数据（文件内容均为原生字段）。';
        container.appendChild(empty);
    } else {
        // 四组键位表（含原生键，原生键标记「原生」且不可清理）
        container.appendChild(renderKeyTable('每层', report.topRows, report.totalBytes));
        container.appendChild(renderKeyTable('每层/extra', report.extraRows, report.totalBytes));
        container.appendChild(renderKeyTable('每层/swipe_info', report.swipeRows, report.totalBytes));
        container.appendChild(renderKeyTable('chat_metadata', report.metaRows, report.totalBytes));
    }

    reportEl.innerHTML = '';
    reportEl.appendChild(container);
}

function renderKeyTable(title, rows, totalBytes) {
    const wrap = doc.createElement('div');
    wrap.className = 'cc-manage-keys';
    const h = doc.createElement('div');
    h.className = 'cc-manage-keys-title';
    h.textContent = title;
    wrap.appendChild(h);
    if (!rows || rows.length === 0) {
        const note = doc.createElement('div');
        note.className = 'cc-manage-section-note';
        note.textContent = '无';
        wrap.appendChild(note);
        return wrap;
    }
    const table = doc.createElement('div');
    table.className = 'cc-manage-table';
    // 表头
    const head = doc.createElement('div');
    head.className = 'cc-manage-tr cc-manage-tr-head';
    head.innerHTML = `<span class="cc-manage-td cc-manage-k">键</span><span class="cc-manage-td">类型</span><span class="cc-manage-td">命中楼层</span><span class="cc-manage-td">字节</span><span class="cc-manage-td">占比</span><span class="cc-manage-td"></span>`;
    table.appendChild(head);
    rows.forEach((row) => {
        const tr = doc.createElement('div');
        tr.className = 'cc-manage-tr';
        // 存完整路径，供清理后定位本行（裸键名跨组不唯一，不能靠文本匹配）
        tr.dataset.key = String(row.key);
        const src = row.source || keySource(row.key, row.native);
        const srcLabel = SOURCE_LABEL[src] || SOURCE_LABEL.other;
        const pct = totalBytes > 0 ? `${((row.bytes / totalBytes) * 100).toFixed(1)}%` : '0%';
        // 「第三方/未知」不打标签：来源判定是尽力而为，误标会显得像在诱导清理，
        // 交由用户自行判断；仅对来源明确的（ccore / 记忆增强 / 原生）标注。
        const tagHtml = src === 'other' ? '' : ` <em class="cc-src-tag cc-src-${src}" title="${escapeAttr(srcLabel.title)}">${escapeHtml(srcLabel.text)}</em>`;
        tr.innerHTML = `
            <span class="cc-manage-td cc-manage-k" title="${escapeAttr(row.label ?? row.key)}">${escapeHtml(row.label ?? row.key)}${tagHtml}</span>
            <span class="cc-manage-td">${escapeHtml(row.type)}</span>
            <span class="cc-manage-td">${row.floors ?? '-'}</span>
            <span class="cc-manage-td">${fmtBytes(row.bytes)}</span>
            <span class="cc-manage-td">${pct}</span>
        `;
        const exportBtn = doc.createElement('button');
        exportBtn.className = 'btn-secondary cc-manage-export';
        exportBtn.textContent = '导出';
        exportBtn.title = '预览将导出的内容，确认后导出为 JSON（不修改原文件）';
        exportBtn.addEventListener('click', (e) => { e.stopPropagation(); openExportPreview(row); });
        const lastTd = doc.createElement('span');
        lastTd.className = 'cc-manage-td cc-manage-ops';
        lastTd.appendChild(exportBtn);

        // 清理：原生键 / 当前聊天一律禁止
        const cleanBtn = doc.createElement('button');
        cleanBtn.className = 'btn-secondary cc-manage-clean';
        cleanBtn.textContent = '清理';
        if (src === 'native') {
            cleanBtn.disabled = true;
            cleanBtn.title = 'ST 原生字段，禁止清理（删除会破坏聊天）';
        } else if (mCurrentChat) {
            cleanBtn.disabled = true;
            cleanBtn.title = '当前聊天走内存数据，不允许清理；请选历史聊天';
        } else {
            cleanBtn.title = '预览将被删除的内容，确认后从聊天文件中移除该键';
            cleanBtn.addEventListener('click', (e) => { e.stopPropagation(); openCleanPreview(row); });
        }
        lastTd.appendChild(cleanBtn);
        tr.appendChild(lastTd);

        // 预览：复用导出的截断逻辑，避免超大键（如累计 46M 的数组）整段塞进 DOM 卡死
        const preview = doc.createElement('div');
        preview.className = 'cc-manage-preview';
        preview.style.display = 'none';
        if (row.sample !== undefined) {
            let text;
            try { text = typeof row.sample === 'string' ? row.sample : JSON.stringify(row.sample, null, 2); }
            catch (e) { text = '[无法序列化]'; }
            const PREVIEW_MAX = 4000;
            if (text.length > PREVIEW_MAX) {
                text = `${text.slice(0, PREVIEW_MAX)}\n\n…（预览已截断，完整内容请点「导出」或「清理」按钮查看，全键约 ${fmtBytes(row.bytes)}）`;
            }
            preview.textContent = text;
        }
        tr.addEventListener('click', () => {
            preview.style.display = preview.style.display === 'none' ? 'block' : 'none';
        });
        table.appendChild(tr);
        table.appendChild(preview);
    });
    wrap.appendChild(table);
    return wrap;
}

// 占比在 renderReport 内已用 pct() 计算；renderKeyTable 内简化显示由 report 总字节推导
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
}

/**
 * 导出某键的全部命中楼层取值为 JSON（不修改原文件）。
 * @param {string} key 形如 extra.ccore / swipe_info.extra.ccore / chat_metadata.xxx / 顶层键
 */
function exportKey(key) {
    // 重新扫描并抽取（报告里只保留了 sample，未保留全量楼层取值）
    exportKeyFromSource(key);
}

async function exportKeyFromSource(key) {
    // chat_metadata.* 只存在于首行（元数据行）；其余键存在于消息行。
    // 旧实现无条件跳过首行 → 导出元数据键恒为空，且当前聊天（内存 chat 无元数据行）会误跳第 0 楼。
    const isMetaKey = key.startsWith('chat_metadata.');
    try {
        let lines = null;
        let hasMetaLine = false; // 是否含首行元数据（jsonl 有，内存 chat 没有）
        if (mCurrentChat) {
            if (isMetaKey) {
                infoLog(LOG_TAG, '当前聊天走内存数据，不含 chat_metadata 元数据行，无法导出该键');
                return;
            }
            const chat = await getMemoryChat();
            if (!chat) return;
            lines = chat.map((m) => JSON.stringify(m));
        } else {
            const raw = await fetchChatJsonl(mActiveChatName, mActiveChar);
            if (raw == null) return;
            lines = raw.split('\n');
            hasMetaLine = true;
        }

        const out = [];
        // 元数据键：只看首行；消息键：有元数据行时从 1 开始，否则从 0 开始
        const startIdx = (hasMetaLine && !isMetaKey) ? 1 : 0;
        const endIdx = isMetaKey ? 1 : lines.length;
        for (let i = startIdx; i < endIdx; i++) {
            const line = lines[i];
            if (!line) continue;
            let mes;
            try { mes = JSON.parse(line); } catch (e) { continue; }
            const v = resolveKey(mes, key);
            if (v === undefined) continue;
            if (isMetaKey) {
                out.push({ scope: 'chat_metadata', [key]: v });
            } else {
                // 真实楼层号：有元数据行时行号-1，否则即行号
                out.push({ floor: hasMetaLine ? i - 1 : i, [key]: v });
            }
        }
        const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = url;
        const safe = (mActiveChatName || 'current').replace(/[^\w一-龥.-]/g, '_');
        a.download = `cc-export_${safe}_${key.replace(/[^\w一-龥.-]/g, '_')}.json`;
        doc.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        infoLog(LOG_TAG, `已导出键 ${key}，共 ${out.length} 条`);
    } catch (e) {
        errorLog(LOG_TAG, '导出失败:', e);
    }
}

/**
 * 解析键路径（支持 extra.x / swipe_info.extra.x / swipe_info.x / chat_metadata.x / 顶层键）。
 * 注：swipe_info. 是我们自定义的作用域前缀，文件里并没有 swipe_info.x 这样的字面路径，
 *   它表示「到 mes.swipe_info 的每个分支对象里找 x」。
 *   注意 mes.swipes 是【字符串数组】（各分支正文），不是分支对象，故不参与此前缀。
 * @param {object} mes
 * @param {string} key
 * @returns {*}
 */
function resolveKey(mes, key) {
    if (key.startsWith('extra.')) {
        const k = key.slice('extra.'.length);
        return mes?.extra?.[k];
    }
    if (key.startsWith('swipe_info.extra.')) {
        const k = key.slice('swipe_info.extra.'.length);
        const sw = Array.isArray(mes?.swipe_info) ? mes.swipe_info : (Array.isArray(mes?.swipes) ? mes.swipes : null);
        if (!Array.isArray(sw)) return undefined;
        for (const s of sw) if (s?.extra && k in s.extra) return s.extra[k];
        return undefined;
    }
    if (key.startsWith('swipe_info.')) {
        const k = key.slice('swipe_info.'.length);
        const sw = Array.isArray(mes?.swipe_info) ? mes.swipe_info : (Array.isArray(mes?.swipes) ? mes.swipes : null);
        if (!Array.isArray(sw)) return undefined;
        // mes.swipes 是字符串数组（各分支正文），元素非对象：跳过（对字符串用 `in` 会抛 TypeError）
        for (const s of sw) if (s && typeof s === 'object' && k in s) return s[k];
        return undefined;
    }
    if (key.startsWith('chat_metadata.')) {
        const k = key.slice('chat_metadata.'.length);
        return mes?.chat_metadata?.[k];
    }
    return mes?.[key];
}

/* =====================================================
 * 键操作：预览确认（导出 / 清理）
 * ===================================================== */

/** 预览弹窗元素（懒初始化） */
let keyModalEl = null;
let keyModalTitleEl = null;
let keyModalSummaryEl = null;
let keyModalSamplesEl = null;
let keyModalConfirmBtn = null;

function ensureKeyModal() {
    if (keyModalEl) return true;
    keyModalEl = doc.getElementById('reader-key-modal');
    keyModalTitleEl = doc.getElementById('reader-key-modal-title');
    keyModalSummaryEl = doc.getElementById('reader-key-modal-summary');
    keyModalSamplesEl = doc.getElementById('reader-key-modal-samples');
    keyModalConfirmBtn = doc.getElementById('reader-key-modal-confirm');
    if (!keyModalEl) return false;
    doc.getElementById('reader-key-modal-close')?.addEventListener('click', closeKeyModal);
    doc.getElementById('reader-key-modal-cancel')?.addEventListener('click', closeKeyModal);
    keyModalEl.addEventListener('click', (e) => { if (e.target === keyModalEl) closeKeyModal(); });
    return true;
}

function closeKeyModal() {
    if (keyModalEl) keyModalEl.style.display = 'none';
    if (keyModalConfirmBtn) keyModalConfirmBtn.onclick = null;
}

/**
 * 打开确认弹窗（导出/清理共用）。
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.summaryHtml 概要（数量/字节等）
 * @param {string} opts.samplesText 样例内容（长文本会被截断展示）
 * @param {string} opts.confirmText
 * @param {boolean} opts.danger 是否危险操作（清理）
 * @param {()=>void} opts.onConfirm
 */
function openKeyModal({ title, summaryHtml, samplesText, confirmText, danger, onConfirm }) {
    if (!ensureKeyModal()) return;
    keyModalTitleEl.textContent = title;
    keyModalSummaryEl.innerHTML = summaryHtml;
    keyModalSamplesEl.textContent = samplesText || '';
    keyModalConfirmBtn.textContent = confirmText;
    keyModalConfirmBtn.classList.toggle('btn-danger', !!danger);
    keyModalConfirmBtn.classList.toggle('btn-primary', !danger);
    keyModalConfirmBtn.onclick = () => {
        closeKeyModal();
        onConfirm();
    };
    keyModalEl.style.display = 'flex';
}

/** 截断长文本用于预览 */
function truncate(s, max = 600) {
    const str = typeof s === 'string' ? s : JSON.stringify(s, null, 2);
    if (!str) return '';
    return str.length > max ? `${str.slice(0, max)}\n…（已截断，共 ${str.length} 字符）` : str;
}

/**
 * 收集某键的全部取值（供预览与实际操作复用）。
 * @param {string} key
 * @returns {Promise<{items:Array, isMeta:boolean, hasMetaLine:boolean, lines:string[]|null}>}
 */
async function collectKeyValues(key) {
    const isMeta = key.startsWith('chat_metadata.');
    let lines = null;
    let hasMetaLine = false;
    if (mCurrentChat) {
        if (isMeta) return { items: [], isMeta, hasMetaLine: false, lines: null };
        const chat = await getMemoryChat();
        if (!chat) return { items: [], isMeta, hasMetaLine: false, lines: null };
        lines = chat.map((m) => JSON.stringify(m));
    } else {
        const raw = await fetchChatJsonl(mActiveChatName, mActiveChar);
        if (raw == null) return { items: [], isMeta, hasMetaLine: false, lines: null };
        lines = raw.split('\n');
        hasMetaLine = true;
    }
    const items = [];
    const startIdx = (hasMetaLine && !isMeta) ? 1 : 0;
    const endIdx = isMeta ? 1 : lines.length;
    for (let i = startIdx; i < endIdx; i++) {
        const line = lines[i];
        if (!line) continue;
        let mes;
        try { mes = JSON.parse(line); } catch (e) { continue; }
        const v = resolveKey(mes, key);
        if (v === undefined) continue;
        items.push({ index: i, floor: hasMetaLine ? i - 1 : i, value: v });
    }
    return { items, isMeta, hasMetaLine, lines };
}

/** 导出前预览 */
async function openExportPreview(row) {
    const { items } = await collectKeyValues(row.key);
    const shown = row.label ?? row.key;
    if (items.length === 0) {
        openKeyModal({
            title: `导出：${shown}`,
            summaryHtml: '<b>该键当前没有可导出的取值。</b>',
            samplesText: '',
            confirmText: '关闭',
            onConfirm: () => { },
        });
        return;
    }
    const samples = items.slice(0, 5).map((it) => (
        `#${it.index} → ${truncate(it.value, 300)}`
    )).join('\n\n');
    openKeyModal({
        title: `导出：${shown}`,
        summaryHtml: `共 <b>${items.length}</b> 条取值，合计约 <b>${fmtBytes(row.bytes)}</b>。导出为 JSON 文件，<b>不会修改聊天文件</b>。`,
        samplesText: `${samples}${items.length > 5 ? `\n\n…（另有 ${items.length - 5} 条，导出时全部包含）` : ''}`,
        confirmText: '确认导出',
        onConfirm: () => exportKey(row.key),
    });
}

/** 清理前预览（不改变文件） */
async function openCleanPreview(row) {
    if (mCurrentChat) return;
    const { items } = await collectKeyValues(row.key);
    const shown = row.label ?? row.key;
    if (items.length === 0) {
        openKeyModal({
            title: `清理：${shown}`,
            summaryHtml: '<b>该键当前没有可清理的内容。</b>',
            samplesText: '',
            confirmText: '关闭',
            onConfirm: () => { },
        });
        return;
    }
    const samples = items.slice(0, 5).map((it) => (
        `#${it.index} → ${truncate(it.value, 300)}`
    )).join('\n\n');
    openKeyModal({
        title: `清理：${shown}`,
        summaryHtml: `将从 <b>${items.length}</b> 处<b>删除该键本身</b>（键值对整体移除，不只是清空内容），释放约 <b>${fmtBytes(row.bytes)}</b>。<br>
            <b class="cc-warn">此操作会改写聊天文件，不可撤销。</b><br>
            建议先手动备份聊天文件（复制一份 <code>${escapeHtml(mActiveChatName || '')}.jsonl</code> 到别处）；
            ST 保存时虽会自行备份且为原子写入，但自行备份最稳妥。`,
        samplesText: `${samples}${items.length > 5 ? `\n\n…（另有 ${items.length - 5} 处）` : ''}`,
        confirmText: '确认清理',
        danger: true,
        onConfirm: () => runCleanKey(row),
    });
}

/**
 * 执行清理：读 jsonl → 逐行删除该键 → POST /api/chats/save 重写。
 * 保留 chat_metadata.integrity 原值以通过 ST 的完整性校验（chats.js:335）。
 * @param {object} row 报告里的键行
 */
async function runCleanKey(row) {
    const key = row.key;
    try {
        // 兜底：当前聊天走内存，清理必须针对历史聊天文件
        if (mCurrentChat) throw new Error('当前聊天不允许清理，请选择历史聊天');
        const raw = await fetchChatJsonl(mActiveChatName, mActiveChar);
        if (raw == null) throw new Error('读取聊天文件失败');
        const lines = raw.split('\n');
        let removed = 0;
        let skipped = 0;
        // 一次遍历：解析 → 删键 → 直接产出对象（不再 stringify 后二次 parse，
        // 避免损坏行在二次 parse 时抛错导致整个清理失败）
        const chat = [];
        for (const line of lines) {
            if (!line) continue;
            let mes;
            try { mes = JSON.parse(line); } catch (e) { skipped++; continue; }
            if (deleteKeyAt(mes, key)) removed++;
            chat.push(mes);
        }
        if (removed === 0) {
            infoLog(LOG_TAG, `键 ${key} 无可清理内容`);
            return;
        }
        // 无法解析的行无法回写（/api/chats/save 只接受对象数组），继续执行会静默丢消息。
        // 因此只要有一行解析失败就整体中止，不做任何写入。
        if (skipped > 0) {
            throw new Error(`聊天文件中有 ${skipped} 行无法解析，为避免数据丢失已中止清理（文件未被修改）`);
        }
        // 首行 chat_metadata.integrity 必须原样保留，否则 /api/chats/save 的完整性校验会 400
        const res = await fetch('/api/chats/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                avatar_url: mActiveChar?.avatar,
                chat,
                file_name: mActiveChatName,
            }),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`保存失败（HTTP ${res.status}）${errText ? `：${errText}` : ''}`);
        }
        const data = await res.json().catch(() => ({}));
        if (data && data.error) throw new Error(String(data.error));
        infoLog(LOG_TAG, `已清理键 ${key}，共 ${removed} 处`);
        markKeyCleaned(row, removed);
    } catch (e) {
        errorLog(LOG_TAG, '清理失败:', e);
        openKeyModal({
            title: '清理失败',
            summaryHtml: `<b class="cc-warn">${escapeHtml(String(e?.message || e))}</b>`,
            samplesText: '',
            confirmText: '关闭',
            onConfirm: () => { },
        });
    }
}

/**
 * 结构性关键键：无论来源判定结果如何，一律禁止删除。
 * 这是兜底防线 —— 原生键白名单是 best-effort，可能漏判；
 * 一旦漏判就允许用户删掉这些字段，会直接破坏聊天结构或让 ST 报错。
 */
const PROTECTED_TOP_KEYS = new Set([
    'mes', 'name', 'is_user', 'is_system', 'send_date', 'send_date_str',
    'swipes', 'swipe_info', 'swipe_id', 'extra', 'mes_id', 'gen_id',
    'chat_metadata', 'title', 'force_avatar', 'display_avatar',
]);

/**
 * 从消息对象里删除指定键（就地修改），返回是否删除。
 * 支持 extra.x / swipe_info.extra.x / swipe_info.x / chat_metadata.x / 顶层键。
 */
function deleteKeyAt(mes, key) {
    if (key.startsWith('extra.')) {
        const k = key.slice('extra.'.length);
        if (mes?.extra && Object.prototype.hasOwnProperty.call(mes.extra, k)) {
            delete mes.extra[k];
            return true;
        }
        return false;
    }
    if (key.startsWith('swipe_info.extra.')) {
        const k = key.slice('swipe_info.extra.'.length);
        const sw = Array.isArray(mes?.swipe_info) ? mes.swipe_info : (Array.isArray(mes?.swipes) ? mes.swipes : null);
        if (!Array.isArray(sw)) return false;
        let hit = false;
        for (const s of sw) {
            if (s?.extra && Object.prototype.hasOwnProperty.call(s.extra, k)) { delete s.extra[k]; hit = true; }
        }
        return hit;
    }
    if (key.startsWith('swipe_info.')) {
        const k = key.slice('swipe_info.'.length);
        const sw = Array.isArray(mes?.swipe_info) ? mes.swipe_info : (Array.isArray(mes?.swipes) ? mes.swipes : null);
        if (!Array.isArray(sw)) return false;
        let hit = false;
        for (const s of sw) {
            // mes.swipes 是字符串数组，跳过非对象分支
            if (s && typeof s === 'object' && Object.prototype.hasOwnProperty.call(s, k)) { delete s[k]; hit = true; }
        }
        return hit;
    }
    if (key.startsWith('chat_metadata.')) {
        const k = key.slice('chat_metadata.'.length);
        // integrity 是 ST 完整性校验依据，禁止删除，否则保存会被 400 拒绝
        if (k === 'integrity') return false;
        if (mes?.chat_metadata && Object.prototype.hasOwnProperty.call(mes.chat_metadata, k)) {
            delete mes.chat_metadata[k];
            return true;
        }
        return false;
    }
    const bare = key;
    // 兜底：结构性关键键永不删除（防白名单漏判导致误删）
    if (PROTECTED_TOP_KEYS.has(bare)) return false;
    if (mes && Object.prototype.hasOwnProperty.call(mes, bare)) {
        delete mes[bare];
        return true;
    }
    return false;
}

/** 清理完成：在该键行就地提示（不自动重新分析） */
function markKeyCleaned(row, removed) {
    if (!reportEl) return;
    const rows = reportEl.querySelectorAll('.cc-manage-tr');
    // 按行上存的完整键路径精确匹配（显示的是裸键名，跨组不唯一，不能靠文本匹配）
    const fullKey = String(row.key);
    for (const tr of rows) {
        if (tr.dataset.key === fullKey) {
            const tip = doc.createElement('span');
            tip.className = 'cc-cleaned-tip';
            tip.textContent = `已清理 ${removed} 处（重新分析可刷新统计）`;
            tr.appendChild(tip);
            const cleanBtn = tr.querySelector('.cc-manage-clean');
            if (cleanBtn) cleanBtn.disabled = true;
            break;
        }
    }
}
