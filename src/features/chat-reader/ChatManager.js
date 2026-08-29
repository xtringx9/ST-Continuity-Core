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
import { renderCharPicker, openChatModal, closeChatModal } from './ChatReader.js';
import { timestampToMoment } from '../../../../../../utils.js';

const LOG_TAG = '[ChatManager]';

// 分批让出主线程的节奏（每扫描 N 行 yield 一次）
const SCAN_YIELD_EVERY = 200;
// 字节统计复用单例
const textEncoder = new TextEncoder();

// ST 原生顶层消息键白名单（版本差异较大，以保守清单为准，白名单外即「扩展/未知键」）
const NATIVE_TOP_KEYS = new Set([
    'name', 'is_user', 'send_date', 'mes', 'swipes', 'swipe_id', 'extra',
    'gen_started', 'gen_finished', 'force_avatar', 'title', 'is_system',
    'mes_id', 'variables', 'display_avatar', 'send_date_str',
]);
// ST 原生 extra 键白名单
const NATIVE_EXTRA_KEYS = new Set([
    'display_text', 'type', 'is_small_sys', 'image', 'inline_image', 'memory',
    'title', 'append_title', 'system', 'ap', 'tool_invocations', 'tool_calls',
    'reasoning', 'files', 'media', 'display_avatar', 'is_group', 'name',
    'rank', 'personality', 'scenario', 'mes', 'depth',
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
]);

let doc = null;
// 导航与首页元素
let navReadEl = null;
let navManageEl = null;
let manageHomeEl = null;
let mCharTitleEl = null;
let mCharGridEl = null;
let mCharSearchEl = null;
// 详情/分析
let detailEl = null;
let crumbEl = null;
let chatLabelEl = null;
let metaEl = null;
let analyzeBtn = null;
let cancelBtn = null;
let progressEl = null;
let progressFillEl = null;
let progressTextEl = null;
let reportEl = null;

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
    }
}

function bindManageDom() {
    manageHomeEl = doc.getElementById('reader-manage-home');
    mCharTitleEl = doc.getElementById('reader-manage-char-title');
    mCharGridEl = doc.getElementById('reader-manage-char-grid');
    mCharSearchEl = doc.getElementById('reader-manage-char-search');
    detailEl = doc.getElementById('reader-manage-detail');
    crumbEl = doc.getElementById('reader-manage-crumb');
    chatLabelEl = doc.getElementById('reader-manage-chat-label');
    metaEl = doc.getElementById('reader-manage-meta');
    analyzeBtn = doc.getElementById('reader-manage-analyze');
    cancelBtn = doc.getElementById('reader-manage-cancel');
    progressEl = doc.getElementById('reader-manage-progress');
    progressFillEl = doc.getElementById('reader-manage-progress-fill');
    progressTextEl = doc.getElementById('reader-manage-progress-text');
    reportEl = doc.getElementById('reader-manage-report');

    if (mCharSearchEl) {
        mCharSearchEl.addEventListener('input', () => renderManageCharGrid(mCharSearchEl.value));
    }
    analyzeBtn?.addEventListener('click', () => startAnalysis());
    cancelBtn?.addEventListener('click', cancelAnalysis);
    doc.getElementById('reader-manage-back')?.addEventListener('click', backToManageChatList);
}

/* =====================================================
 * 管理：首页（角色 → 聊天 选择，懒加载）
 * ===================================================== */

function showManageHome() {
    if (manageHomeEl) manageHomeEl.style.display = '';
    if (detailEl) detailEl.style.display = 'none';
    if (reportEl) reportEl.innerHTML = '';
    mLastReport = null;
    renderManageCharGrid('');
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
    renderCharPicker({
        doc,
        gridEl: mCharGridEl,
        titleEl: mCharTitleEl,
        query,
        onPick: (idx) => selectManageCharacter(idx),
        onPickCurrent: () => openCurrentChatManage(),
    });
}

function openCurrentChatManage() {
    const current = getCurrentChatDetails();
    if (!current) return;
    mCurrentChat = true;
    mActiveChar = null;
    mActiveCharIdx = -1;
    mActiveChatName = current.sessionName || '';
    enterManageDetail(null, /*activeChat=*/ true);
}

async function selectManageCharacter(idx) {
    if (!characters[idx]) return;
    const char = characters[idx];
    mCurrentChat = false;
    mActiveChar = char;
    mActiveCharIdx = idx;
    openChatModal({
        title: `选择聊天（${char.name}）`,
        getChats: () => getPastCharacterChats(idx),
        onPick: (chatMeta) => {
            mActiveChatName = String(chatMeta.file_name || '').replace(/\.jsonl$/i, '');
            mActiveChatMeta = chatMeta;
            enterManageDetail(chatMeta, false);
        },
    });
}

function backToManageChatList() {
    // 详情视图的「← 选择角色」：关闭任何残留弹窗，回到角色网格
    closeChatModal();
    showManageHome();
}

/* =====================================================
 * 管理：详情（概览 + 开始分析）
 * ===================================================== */

async function enterManageDetail(chatMeta, isCurrent) {
    if (manageHomeEl) manageHomeEl.style.display = 'none';
    if (detailEl) detailEl.style.display = '';
    if (reportEl) reportEl.innerHTML = '';
    mLastReport = null;

    const label = isCurrent
        ? (getCurrentChatDetails()?.sessionName || '当前聊天')
        : (chatMeta?.file_name || '').replace(/\.jsonl$/i, '');
    if (chatLabelEl) chatLabelEl.textContent = label;
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
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (progressEl) progressEl.style.display = 'none';
}

async function startAnalysis() {
    const token = ++mScanToken;
    if (analyzeBtn) analyzeBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = '';
    if (progressEl) { progressEl.style.display = ''; progressFillEl.style.width = '0%'; }
    if (reportEl) reportEl.innerHTML = '<div class="reader-loading">正在读取聊天文件…</div>';

    try {
        let lines = null; // ['<jsonl 文本行>', ...]，首行为元数据
        if (mCurrentChat) {
            // 当前聊天：直接读内存 chat（含首行元数据）
            const chat = await getMemoryChat();
            if (!chat) throw new Error('无法读取当前聊天');
            lines = chat.map((m) => JSON.stringify(m));
        } else {
            const raw = await fetchChatJsonl(mActiveChatName, mActiveChar);
            if (raw == null) throw new Error('读取聊天文件失败');
            // 逐行切片（不 split 成数组，避免 N 个字符串常驻）
            lines = sliceLines(raw);
        }

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
    const topKeys = new Map();      // key -> { type, floors:[], bytes, samples:[] }
    const extraKeys = new Map();    // 'extra.KEY' -> 同上
    const swipeKeys = new Map();    // 'swipe.KEY' -> 同上（swipe_info 内副本）
    const metaKeys = new Map();     // 'chat_metadata.KEY' -> { type, bytes, sample }

    let msgCount = 0;
    let sysCount = 0;
    let totalBytes = 0;       // 估算全文 jsonl 字节
    let bodyBytes = 0;        // 正文（mes）字节
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

        msgCount++;
        if (mes.is_system) sysCount++;
        const b = byteLen(mes.mes);
        if (typeof mes.mes === 'string') bodyBytes += b;

        // 顶层扩展键
        for (const k of Object.keys(mes)) {
            if (k === 'extra' || k === 'swipes') continue;
            if (NATIVE_TOP_KEYS.has(k)) continue;
            accum(topKeys, k, mes[k], i);
        }
        // extra 内键
        const extra = mes.extra;
        if (extra && typeof extra === 'object') {
            for (const k of Object.keys(extra)) {
                if (NATIVE_EXTRA_KEYS.has(k)) continue;
                accum(extraKeys, `extra.${k}`, extra[k], i);
            }
        }
        // swipe_info / swipes 内副本
        const swipes = mes.swipe_info || mes.swipes;
        if (Array.isArray(swipes)) {
            for (const sw of swipes) {
                if (!sw || typeof sw !== 'object') continue;
                if (sw.extra && typeof sw.extra === 'object') {
                    for (const k of Object.keys(sw.extra)) {
                        if (NATIVE_EXTRA_KEYS.has(k)) continue;
                        accum(swipeKeys, `swipe.extra.${k}`, sw.extra[k], i);
                    }
                }
                for (const k of Object.keys(sw)) {
                    if (k === 'extra') continue;
                    if (NATIVE_TOP_KEYS.has(k)) continue;
                    accum(swipeKeys, `swipe.${k}`, sw[k], i);
                }
            }
        }

        if (i > 0 && i % SCAN_YIELD_EVERY === 0) {
            onProgress(i, total);
            await new Promise((r) => setTimeout(r, 0));
        }
    }
    onProgress(total, total);

    const toRows = (map, scope) => Array.from(map.entries()).map(([key, rec]) => ({
        key: scope ? `${scope}.${key}` : key,
        type: rec.type,
        floors: rec.floors.length,
        bytes: rec.bytes,
        sample: rec.sample,
        native: rec.native,
    })).sort((a, b) => b.bytes - a.bytes);

    return {
        chatName: mCurrentChat ? (getCurrentChatDetails()?.sessionName || '') : mActiveChatName,
        isCurrent: mCurrentChat,
        msgCount,
        sysCount,
        totalBytes,
        bodyBytes,
        extBytes: topKeysTotal(topKeys) + topKeysTotal(extraKeys) + topKeysTotal(swipeKeys),
        metaBytes,
        topRows: toRows(topKeys),
        extraRows: toRows(extraKeys),
        swipeRows: toRows(swipeKeys),
        metaRows: Array.from(metaKeys.entries()).map(([key, rec]) => ({
            key: `chat_metadata.${key}`,
            type: rec.type,
            bytes: rec.bytes,
            sample: rec.sample,
            native: rec.native,
        })).sort((a, b) => b.bytes - a.bytes),
    };
}

function topKeysTotal(map) {
    let s = 0;
    for (const rec of map.values()) s += rec.bytes;
    return s;
}

function accum(map, key, value, floor) {
    let rec = map.get(key);
    if (!rec) {
        rec = { type: Array.isArray(value) ? 'array' : typeof value, floors: [], bytes: 0, sample: null, native: false };
        map.set(key, rec);
    }
    rec.bytes += byteLen(value);
    if (rec.floors.length < 200) rec.floors.push(floor);
    if (rec.sample === null && value !== undefined) {
        // 仅保留较小样本的预览（避免巨型值拖慢渲染）
        try { rec.sample = JSON.stringify(value).length < 2000 ? value : '[值过大，已省略预览]'; } catch (e) { rec.sample = '[无法序列化]'; }
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

function renderReport(report) {
    if (!reportEl) return;
    const pct = (n) => report.totalBytes > 0 ? `${((n / report.totalBytes) * 100).toFixed(1)}%` : '0%';
    const container = doc.createElement('div');
    container.className = 'cc-manage-report-inner';

    // 概览
    const overview = doc.createElement('div');
    overview.className = 'cc-manage-overview';
    overview.innerHTML = `
        <div class="cc-manage-ov-card"><div class="cc-manage-ov-num">${report.msgCount}</div><div class="cc-manage-ov-label">消息数（系统 ${report.sysCount}）</div></div>
        <div class="cc-manage-ov-card"><div class="cc-manage-ov-num">${fmtBytes(report.totalBytes)}</div><div class="cc-manage-ov-label">文件估算体积</div></div>
        <div class="cc-manage-ov-card"><div class="cc-manage-ov-num">${pct(report.bodyBytes)}</div><div class="cc-manage-ov-label">正文占比</div></div>
        <div class="cc-manage-ov-card"><div class="cc-manage-ov-num">${pct(report.extBytes + report.metaBytes)}</div><div class="cc-manage-ov-label">扩展/元数据占比</div></div>
    `;
    container.appendChild(overview);

    if (report.extBytes === 0 && report.metaBytes === 0) {
        const empty = doc.createElement('div');
        empty.className = 'cc-manage-section-note';
        empty.textContent = '未发现扩展键或自定义元数据（文件内容均为原生字段）。';
        container.appendChild(empty);
    } else {
        // 三组键位表
        container.appendChild(renderKeyTable('楼层级扩展键（消息顶层，非原生）', report.topRows, report.totalBytes));
        container.appendChild(renderKeyTable('extra 内扩展键', report.extraRows, report.totalBytes));
        container.appendChild(renderKeyTable('swipe_info / swipes 内副本', report.swipeRows, report.totalBytes));
        container.appendChild(renderKeyTable('聊天元数据 chat_metadata 键', report.metaRows, report.totalBytes));
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
        const isNative = row.native;
        const pct = totalBytes > 0 ? `${((row.bytes / totalBytes) * 100).toFixed(1)}%` : '0%';
        tr.innerHTML = `
            <span class="cc-manage-td cc-manage-k" title="${escapeAttr(row.key)}">${escapeHtml(row.key)}${isNative ? ' <em class="cc-native-tag">原生</em>' : ''}</span>
            <span class="cc-manage-td">${escapeHtml(row.type)}</span>
            <span class="cc-manage-td">${row.floors}</span>
            <span class="cc-manage-td">${fmtBytes(row.bytes)}</span>
            <span class="cc-manage-td">${pct}</span>
        `;
        const exportBtn = doc.createElement('button');
        exportBtn.className = 'btn-secondary cc-manage-export';
        exportBtn.textContent = '导出';
        exportBtn.title = '将该键在全部命中楼层的取值导出为 JSON（不修改原文件）';
        exportBtn.addEventListener('click', (e) => { e.stopPropagation(); exportKey(row.key); });
        const lastTd = doc.createElement('span');
        lastTd.className = 'cc-manage-td';
        lastTd.appendChild(exportBtn);
        tr.appendChild(lastTd);

        // 预览
        const preview = doc.createElement('div');
        preview.className = 'cc-manage-preview';
        preview.style.display = 'none';
        if (row.sample !== undefined) {
            preview.textContent = typeof row.sample === 'string' ? row.sample : JSON.stringify(row.sample, null, 2);
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
 * @param {string} key 形如 extra.ccore / swipe.extra.ccore / chat_metadata.xxx / 顶层键
 */
function exportKey(key) {
    // 重新扫描并抽取（报告里只保留了 sample，未保留全量楼层取值）
    exportKeyFromSource(key);
}

async function exportKeyFromSource(key) {
    try {
        let lines = null;
        if (mCurrentChat) {
            const chat = await getMemoryChat();
            if (!chat) return;
            lines = chat.map((m) => JSON.stringify(m));
        } else {
            const raw = await fetchChatJsonl(mActiveChatName, mActiveChar);
            if (raw == null) return;
            lines = raw.split('\n');
        }
        const out = [];
        let first = true;
        for (const line of lines) {
            if (!line) continue;
            let mes;
            try { mes = JSON.parse(line); } catch (e) { continue; }
            if (first) { first = false; continue; }
            const v = resolveKey(mes, key);
            if (v !== undefined) out.push({ floor: out.length, [key]: v });
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
 * 解析键路径（支持 extra.x / swipe.extra.x / swipe.x / chat_metadata.x / 顶层键）。
 * @param {object} mes
 * @param {string} key
 * @returns {*}
 */
function resolveKey(mes, key) {
    if (key.startsWith('extra.')) {
        const k = key.slice('extra.'.length);
        return mes?.extra?.[k];
    }
    if (key.startsWith('swipe.extra.')) {
        const k = key.slice('swipe.extra.'.length);
        const sw = Array.isArray(mes?.swipe_info) ? mes.swipe_info : (Array.isArray(mes?.swipes) ? mes.swipes : null);
        if (!Array.isArray(sw)) return undefined;
        for (const s of sw) if (s?.extra && k in s.extra) return s.extra[k];
        return undefined;
    }
    if (key.startsWith('swipe.')) {
        const k = key.slice('swipe.'.length);
        const sw = Array.isArray(mes?.swipe_info) ? mes.swipe_info : (Array.isArray(mes?.swipes) ? mes.swipes : null);
        if (!Array.isArray(sw)) return undefined;
        for (const s of sw) if (k in s) return s[k];
        return undefined;
    }
    if (key.startsWith('chat_metadata.')) {
        const k = key.slice('chat_metadata.'.length);
        return mes?.chat_metadata?.[k];
    }
    return mes?.[key];
}
