/**
 * 角色绑定页主逻辑
 * 左栏：角色树（角色 -> 展开其聊天）；右栏：选中节点的编辑器。
 *
 * 层级（Model A 继承/逐键覆盖）：
 *   有效值 = 默认 < 角色级 < 聊天级；聊天只覆盖显式设过的键，其余继承下层。
 *   - 半灰(默认)/实心(覆盖)：effective 与全局默认比较；"继承自角色"徽标标示来自角色层。
 *   - 存储用 Delta：override 仅在该节点设的值 ≠ 下层时才写入；拨回下层即删除 override（会员制仍保留）。
 *
 * 注意：本脚本跑在 iframe 内；ST 实时数据经 `import { getContext } from '../../../../../../extensions.js'`
 * 直接获取（同目录 Toolbox.js 已验证可用）。切勿 import script.js（相对路径 404）。
 */

import { translate } from '../../../../../../i18n.js';
import configManager from '../../singleton/configManager.js';
import { refreshOnModuleConfigChange } from '../../core/contextBottomUI.js';
import { IframeDialog } from '../../shared/IframeDialog.js';
import { showToast } from '../../shared/Toast.js';
// 直接 import SillyTavern 的 getContext（同目录 Toolbox.js 已验证可用：iframe 内可经此拿到实时角色/聊天上下文）
// ⚠️ getContext() 返回对象含 chat 数组（st-context.js:96）——iframe 内不要 import script.js（404），
// 一律走 getContext().chat 拿实时聊天数组。
import { getContext } from '../../../../../../extensions.js';
import {
    getChatModuleEntryConfig,
    getChatModuleEntries,
    addChatModuleEntry,
    updateChatModuleEntry,
    deleteChatModuleEntry,
    setChatModuleEntriesEnabled,
    setChatModuleEntryEnabled,
    migrateWorldBookModulesToChatEntries,
} from '../../core/chatModuleEntryStore.js';
import { createEmptyBoundVariable } from '../../config/characterBindingTemplate.js';
import { applyCurrentVariables } from '../variable-binding/variableBindingState.js';
import { getAvatarThumbUrl } from '../../shared/characterBridge.js';
import { timestampToMoment } from '../../../../../../utils.js';

// 全局文档引用（指向 iframe 的 document）
let doc = null;
// 角色树滚动位置记忆：重新打开编辑器 / 进入本视图后还原，避免频繁编辑时角色栏跳回顶部
const BINDING_TREE_SCROLL_KEY = 'ccore_bindingtree_scroll';
import { persistScroll, restoreScroll } from '../../shared/scrollPersistence.js';
let treeListEl = null;
let detailEl = null;
let selected = null;                 // { scope, charName, chatFile }
const expandedMods = new Set();      // 已展开的模块名
let treeSearchQuery = '';            // 角色树搜索词（实时过滤）

/**
 * 初始化角色绑定页
 * @param {Document} iframeDocument iframe 的文档对象
 */
export function initCharacterBinding(iframeDocument) {
    doc = iframeDocument;
    treeListEl = doc.getElementById('binding-tree-list');
    detailEl = doc.getElementById('binding-detail-content');
    if (!treeListEl || !detailEl) return;

    // 实时记忆角色树滚动位置（关闭/重新打开编辑器时还原）
    treeListEl.addEventListener('scroll', () => persistScroll(treeListEl, BINDING_TREE_SCROLL_KEY));

    // 角色树搜索：输入即过滤（修复此前搜索框失效）
    const searchEl = doc.getElementById('binding-tree-search');
    if (searchEl) {
        searchEl.addEventListener('input', () => {
            treeSearchQuery = (searchEl.value || '').trim();
            renderTree();
        });
    }

    renderTree();

    // 切换到本视图时刷新（支持"当前聊天自动跟随"）
    const navItem = doc.querySelector('.nav-item[data-target="view-profiles"]');
    if (navItem) {
        navItem.addEventListener('click', () => {
            // 仅在"进入"（而非已在角色绑定页重复点击）时从 localStorage 还原上次滚动位置，
            // 避免同会话内编辑/切换时把当前滚动位置错误跳回存档值
            const entering = !navItem.classList.contains('active');
            renderTree();
            if (entering) restoreBindingTreeScroll();
        });
    }

    // 若角色绑定是启动时的初始视图（上次离开前停留在此），激活后异步还原滚动位置
    requestAnimationFrame(() => {
        if (doc.getElementById('view-profiles')?.classList.contains('active')) {
            restoreBindingTreeScroll();
        }
    });
}

/* ===================== 左栏角色树 ===================== */

// ST 实时数据：经 import 的 getContext 直接取（iframe 内可用，见文件头说明）
function getCurrentChat() {
    try {
        const ctx = getContext();
        const charName = ctx?.characters?.[ctx.characterId]?.name || '';
        const chatFile = ctx?.chatId ?? '';
        return { charName, chatFile };
    } catch {
        return { charName: '', chatFile: '' };
    }
}

function getRealCharacters() {
    try {
        const chars = getContext()?.characters || [];
        return chars
            .filter(c => c && c.name)
            .map(c => ({ name: c.name, avatar: c.avatar }));
    } catch {
        return [];
    }
}

// 按角色名缓存聊天列表（Promise<string[]>），避免反复请求
const chatCache = new Map();
function getChatNamesForChar(charName, avatar) {
    if (chatCache.has(charName)) return chatCache.get(charName);
    const p = (async () => {
        try {
            const ctx = getContext();
            const headers = ctx?.getRequestHeaders?.() || {};
            const response = await fetch('/api/characters/chats', {
                method: 'POST',
                headers,
                body: JSON.stringify({ avatar_url: avatar }),
            });
            if (!response.ok) return [];
            const data = await response.json();
            // 返回完整元数据：文件名 / 楼层数 chat_items / 文件大小 file_size / 最后消息 last_mes
            return Object.values(data || {}).map(x => ({
                name: String(x.file_name || '').replace(/\.jsonl$/, ''),
                chat_items: x.chat_items,
                file_size: x.file_size,
                last_mes: x.last_mes,
            }));
        } catch {
            return [];
        }
    })();
    chatCache.set(charName, p);
    return p;
}

function fmtChatMetaDate(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function renderTree() {
    if (!treeListEl) return;
    const prevScroll = treeListEl.scrollTop; // 重渲前记录，便于同会话内编辑后保留位置
    treeListEl.innerHTML = '';

    const current = getCurrentChat();
    let realChars = getRealCharacters();
    // 角色树搜索过滤（大小写不敏感）
    if (treeSearchQuery) {
        const q = treeSearchQuery.toLowerCase();
        realChars = realChars.filter(c => (c.name || '').toLowerCase().includes(q));
    }
    // 当前角色置顶（如有）
    if (current.charName) {
        const idx = realChars.findIndex(c => c.name === current.charName);
        if (idx > 0) {
            const [cur] = realChars.splice(idx, 1);
            realChars.unshift(cur);
        }
    }
    const realNames = new Set(realChars.map(c => c.name));
    const bindings = configManager.getBindings();

    // 1) 真实角色（扁平，聊天选择移到右栏下拉）
    for (const char of realChars) {
        treeListEl.appendChild(buildCharNode(char.name, current, false));
    }

    // 2) 配置中存在但已找不到的角色（改名/删除后残留），仅显示角色节点
    const danglingNames = [...new Set(bindings.map(b => b.charName))]
        .filter(name => name && !realNames.has(name))
        .filter(name => !treeSearchQuery || name.toLowerCase().includes(treeSearchQuery.toLowerCase()));
    for (const name of danglingNames) {
        treeListEl.appendChild(buildCharNode(name, current, true));
    }

    // 首次进入且存在当前角色：自动选中（不覆盖用户后续手动选择）
    if (!selected && current.charName && realNames.has(current.charName)) {
        selected = { scope: 'character', charName: current.charName, chatFile: null };
    }
    // 同会话内重渲（增删/重定向角色绑定等）保留当前滚动位置。
    // 必须同步设置：下方 await renderDetail()（含 fetch 聊天列表）会在后续帧续延，
    // 若放在 await 之后才设置，会在此刻已完成的进入时存档还原（rAF）之后把它覆盖回 0。
    treeListEl.scrollTop = prevScroll;
    applyActive();
    await renderDetail();
}

// 从 localStorage 还原角色树滚动位置（仅当角色绑定视图可见时有效，隐藏元素设置 scrollTop 无效）
function restoreBindingTreeScroll() {
    if (!treeListEl) return;
    if (!doc.getElementById('view-profiles')?.classList.contains('active')) return;
    restoreScroll(treeListEl, BINDING_TREE_SCROLL_KEY);
}

function firstChar(s) {
    return (s || '?').trim().charAt(0).toUpperCase();
}

function buildCharNode(name, current, isDangling) {
    const node = doc.createElement('div');
    node.className = 'binding-tree-char';
    const realChar = !isDangling ? (getRealCharacters().find(c => c.name === name) || null) : null;
    const ph = firstChar(name);
    const avFile = realChar && realChar.avatar && realChar.avatar !== 'none' ? realChar.avatar : '';
    const avatarHtml = avFile
        ? `<img class="binding-tree-avatar" src="${escapeAttr(getAvatarThumbUrl(avFile))}" data-ph="${escapeAttr(ph)}">`
        : `<span class="binding-tree-avatar">${escapeHtml(ph)}</span>`;
    node.innerHTML = `
        <div class="binding-tree-row" data-char="${escapeAttr(name)}">
            ${avatarHtml}
            <span class="binding-tree-name">${escapeHtml(name)}</span>
            ${isDangling ? `<span class="binding-tree-missing" title="${translate('ccore_binding_missing_char')}">⚠</span>` : ''}
            ${name === current.charName ? `<span class="binding-tree-current" title="${translate('ccore_binding_current_chat')}">●</span>` : ''}
            ${isDangling
                ? `<button class="btn-secondary binding-char-repoint" data-repoint-char="${escapeAttr(name)}" title="${translate('ccore_binding_repoint_char')}">${translate('ccore_binding_repoint_char')}</button>`
                    + `<button class="btn-secondary binding-char-del" data-del-char="${escapeAttr(name)}" title="${translate('ccore_binding_missing_char')}">${translate('ccore_binding_delete')}</button>`
                : ''}
        </div>
        `;
    node.querySelector('.binding-tree-row').addEventListener('click', () => selectNode('character', name, null));
    node.querySelectorAll('img.binding-tree-avatar').forEach(img => {
        img.onerror = () => {
            const s = doc.createElement('span');
            s.className = 'binding-tree-avatar';
            s.textContent = img.dataset.ph || '';
            img.replaceWith(s);
        };
    });
    const del = node.querySelector('.binding-char-del');
    if (del) del.addEventListener('click', e => { e.stopPropagation(); deleteCharBinding(name); });
    const repoint = node.querySelector('.binding-char-repoint');
    if (repoint) repoint.addEventListener('click', e => { e.stopPropagation(); repointCharBinding(name); });
    return node;
}

// 删除整个悬空角色节点（角色级 + 其下所有聊天级绑定）
function deleteCharBinding(name) {
    const all = configManager.getBindings().filter(b => b.charName === name);
    all.forEach(b => configManager.removeBinding(b.scope, b.charName, b.chatFile ?? null));
    if (selected && selected.charName === name) selected = null;
    renderTree();
}

// 把某个（通常已悬空的）角色名下的全部绑定重指到新角色名
function repointCharBinding(oldName) {
    const realChars = getRealCharacters().filter(c => c.name !== oldName);
    const options = realChars.length
        ? realChars.map(c => `<label class="binding-repoint-item" style="display:block;padding:4px 2px;cursor:pointer;"><input type="radio" name="repoint-target" value="${escapeAttr(c.name)}"> ${escapeHtml(c.name)}</label>`).join('')
        : `<div style="color:var(--text-muted);padding:6px;">${translate('ccore_binding_no_char')}</div>`;
    const dialog = new IframeDialog(doc);
    const d = dialog;
    dialog.open({
        title: translate('ccore_binding_repoint_char'),
        content: `<div style="margin-bottom:8px;">${translate('ccore_binding_repoint_confirm').replace('{name}', escapeHtml(oldName))}</div>
            <div style="max-height:300px;overflow:auto;border:1px solid var(--border-light);border-radius:4px;padding:6px;">${options}</div>`,
        buttons: [
            {
                text: translate('ccore_binding_repoint_confirm_btn'),
                className: 'btn-primary',
                onClick: () => {
                    const sel = doc.querySelector('input[name="repoint-target"]:checked');
                    if (!sel) return; // 未选则保持弹窗
                    configManager.renameCharacterInBindings(oldName, sel.value);
                    d.close();
                    renderTree();
                }
            },
            { text: translate('ccore_btn_cancel'), className: 'btn-secondary', onClick: (dd) => dd.close() }
        ]
    });
}

function selectNode(scope, charName, chatFile) {
    selected = { scope, charName, chatFile };
    renderTree();
}

// 重渲染后恢复选中高亮（renderTree 末尾调用）
function applyActive() {
    if (!treeListEl || !selected) return;
    treeListEl.querySelectorAll('.binding-tree-row').forEach(r => r.classList.remove('active'));
    const sel = treeListEl.querySelector(
        `.binding-tree-row[data-char="${CSS.escape(selected.charName)}"]:not([data-chat])`
    );
    if (sel) sel.classList.add('active');
}

/* ===================== 右栏编辑器 + Model A 解析 ===================== */

function getModuleDef(modName) {
    return configManager.getModules(true).find(m => m.name === modName) || null;
}

function getNodeBinding() {
    let b = configManager.findBinding(selected.scope, selected.charName, selected.chatFile);
    if (!b) {
        b = { scope: selected.scope, charName: selected.charName, chatFile: selected.scope === 'chat' ? selected.chatFile : null, modules: [], variables: [] };
    }
    return b;
}

function ensureModuleEntry(b, modName) {
    let entry = b.modules.find(m => m.name === modName);
    if (!entry) {
        entry = { name: modName, variableOverrides: {} };
        b.modules.push(entry);
    }
    return entry;
}

// 某模块在某节点下的有效状态（默认 < 角色 < 聊天）
function resolveModuleState(modName) {
    const def = getModuleDef(modName);
    const charB = configManager.findBinding('character', selected.charName, null);
    const chatB = selected.scope === 'chat' ? configManager.findBinding('chat', selected.charName, selected.chatFile) : null;
    const charEntry = charB?.modules?.find(m => m.name === modName);
    const chatEntry = chatB?.modules?.find(m => m.name === modName);
    const defEnabled = def ? (def.enabled !== false) : true;
    const effectiveEnabled = (chatEntry && typeof chatEntry.moduleOverride === 'boolean') ? chatEntry.moduleOverride
        : ((charEntry && typeof charEntry.moduleOverride === 'boolean') ? charEntry.moduleOverride : defEnabled);
    const entryHere = selected.scope === 'chat' ? chatEntry : charEntry;
    const moduleSetHere = !!(entryHere && typeof entryHere.moduleOverride === 'boolean');
    const inheritedModule = !moduleSetHere && effectiveEnabled !== defEnabled;
    return { def, charEntry, chatEntry, defEnabled, effectiveEnabled, moduleSetHere, inheritedModule };
}

function resolveVarState(modName, varName) {
    const { def, charEntry, chatEntry } = resolveModuleState(modName);
    const defVar = def?.variables?.find(v => v.name === varName);
    const defVarEnabled = defVar ? (defVar.enabled !== false) : true;
    const charVO = charEntry?.variableOverrides?.[varName];
    const chatVO = chatEntry?.variableOverrides?.[varName];
    const effective = typeof chatVO === 'boolean' ? chatVO
        : (typeof charVO === 'boolean' ? charVO : defVarEnabled);
    const entryHere = selected.scope === 'chat' ? chatEntry : charEntry;
    const varSetHere = !!(entryHere && typeof entryHere.variableOverrides?.[varName] === 'boolean');
    const inherited = !varSetHere && effective !== defVarEnabled;
    return { defVar, defVarEnabled, effective, varSetHere, inherited };
}

// 判断某模块在本节点是否显式钉住（有 moduleOverride 或变量覆盖）
function isModuleOverridden(st) {
    const entryHere = selected.scope === 'chat' ? st.chatEntry : st.charEntry;
    if (!entryHere) return false;
    if (typeof entryHere.moduleOverride === 'boolean') return true;
    return Object.keys(entryHere.variableOverrides || {}).length > 0;
}

async function renderDetail() {
    if (!detailEl) return;

    if (!selected) {
        detailEl.innerHTML = `<div style="text-align:center;margin-top:50px;color:var(--text-muted);"><p>${translate('ccore_binding_select_hint')}</p></div>`;
        return;
    }

    // 移动端：同步切到详情单栏，不依赖下方的异步聊天列表请求（避免点击角色后切换被网络延迟/卡住）
    if (window.innerWidth <= 768) {
        doc.body.classList.add('mobile-view-detail-binding');
    }

    const scopeLabel = selected.scope === 'character'
        ? translate('ccore_binding_scope_character')
        : translate('ccore_binding_scope_chat');
    // 角色级只显示角色名；聊天级显示「角色名 · 聊天名」
    const title = selected.scope === 'character'
        ? selected.charName
        : `${selected.charName} · ${selected.chatFile}`;

    // 构建聊天下拉选项（当前聊天置顶；默认=角色级）
    const current = getCurrentChat();
    const isCurrentChar = current.charName === selected.charName;
    let chatOptions = [];
    if (isCurrentChar) {
        const char = getRealCharacters().find(c => c.name === selected.charName);
        if (char?.avatar) {
            const chats = await getChatNamesForChar(selected.charName, char.avatar);
            // 按最后消息时间从新到旧排序（复用 ST 的 timestampToMoment，兼容 last_mes 各种历史格式）；当前聊天随后置顶
            chats.sort((a, b) => {
                const tv = (x) => {
                    if (x == null || x === '') return 0;
                    try { const m = timestampToMoment(x); return m && m.isValid() ? m.valueOf() : 0; }
                    catch { return 0; }
                };
                return tv(b.last_mes) - tv(a.last_mes);
            });
            // 当前聊天置顶
            if (current.chatFile) {
                const idx = chats.findIndex(c => c.name === current.chatFile);
                if (idx > 0) { const [c] = chats.splice(idx, 1); chats.unshift(c); }
            }
            chatOptions = chats;
        }
    } else {
        // 非当前角色：列出配置里残留的聊天绑定（无法枚举真实聊天，元数据留空）
        chatOptions = configManager.getBindings()
            .filter(x => x.charName === selected.charName && x.scope === 'chat' && x.chatFile)
            .map(x => ({ name: x.chatFile, chat_items: null, file_size: null, last_mes: null }));
    }

    const isChatScope = selected.scope === 'chat';
    // 角色级只显示「模块覆盖 / 变量设置」；聊天级额外显示「模块条目 / 聊天操作」
    const tabDefs = isChatScope
        ? [['binding-tab-modules', '模块覆盖'], ['binding-tab-vars', '变量设置'], ['binding-tab-entries', '模块条目'], ['binding-tab-chatops', '聊天操作']]
        : [['binding-tab-modules', '模块覆盖'], ['binding-tab-vars', '变量设置']];
    const tabItemsHtml = tabDefs.map(([t, label], i) => `<div class="detail-tab-item ${i === 0 ? 'active' : ''}" data-target="${t}">${label}</div>`).join('');

    const scopeOptions = [
        `<option value="" ${!selected.chatFile ? 'selected' : ''}>${translate('ccore_binding_all_chats')}</option>`,
        ...chatOptions.map(chat => {
            const isCur = isCurrentChar && chat.name === current.chatFile;
            const meta = [];
            if (chat.chat_items != null) meta.push(`${chat.chat_items}楼`);
            if (chat.file_size) meta.push(String(chat.file_size));
            if (chat.last_mes) meta.push(fmtChatMetaDate(chat.last_mes));
            const label = meta.length ? `${chat.name}（${meta.join(' · ')}）` : chat.name;
            return `<option value="${escapeAttr(chat.name)}" ${selected.chatFile === chat.name ? 'selected' : ''}>${isCur ? '● ' : ''}${escapeHtml(label)}</option>`;
        }),
    ].join('');

    // 会员制取并集（角色级 + 聊天级）
    const b = configManager.findBinding(selected.scope, selected.charName, selected.chatFile);
    const charB = configManager.findBinding('character', selected.charName, null);
    const names = new Set();
    (b?.modules || []).forEach(m => names.add(m.name));
    (charB?.modules || []).forEach(m => names.add(m.name));
    // 按模块配置里的 order 排序（而非默认添加顺序）
    const moduleOrderMap = new Map(configManager.getModules(true).map(m => [m.name, typeof m.order === 'number' ? m.order : 0]));
    const modNames = [...names].sort((a, b) => (moduleOrderMap.get(a) ?? 0) - (moduleOrderMap.get(b) ?? 0));

    detailEl.innerHTML = `
        <div class="detail-tabs" id="binding-detail-tabs">
            <div class="sticky-title-group">
                <button class="mobile-only btn-back-icon" id="binding-back-btn" title="${translate('ccore_binding_back_to_chars')}">❮</button>
                <span class="sticky-module-name" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
                <span class="binding-detail-scope">${scopeLabel}</span>
            </div>
            ${tabItemsHtml}
        </div>
        <div class="binding-chat-select-row">
            <label class="binding-chat-select-label">${translate('ccore_binding_chat_select')}</label>
            <select class="binding-chat-select" id="binding-chat-select">
                ${scopeOptions}
            </select>
            ${buildCurrentChatJumpBtn()}
        </div>
        <div class="binding-detail-body" id="binding-detail-body">
            <div class="detail-tab-panel active" id="binding-tab-modules">
                <div class="form-section-title binding-section-head">
                    <span>${translate('ccore_binding_section_modules')}</span>
                    <div class="binding-section-head-actions">
                        <button class="btn-secondary binding-add-btn" id="binding-add-btn">＋ ${translate('ccore_binding_add_module')}</button>
                        <button class="btn-secondary binding-reset-btn" id="binding-reset-btn" title="${translate('ccore_binding_reset')}">${translate('ccore_binding_reset')}</button>
                    </div>
                </div>
                <div class="binding-section-body">
                    <div class="binding-mod-list" id="binding-mod-list">
                        ${modNames.length
                            ? modNames.map(renderModuleBlock).join('')
                            : `<p style="color:var(--text-muted);">${translate('ccore_binding_empty')}</p>`}
                    </div>
                </div>
            </div>
            <div class="detail-tab-panel" id="binding-tab-vars">
                ${renderVarBindingSection()}
            </div>
            ${isChatScope ? `
            <div class="detail-tab-panel" id="binding-tab-entries">
                ${renderChatModuleEntriesSection(true)}
            </div>
            <div class="detail-tab-panel" id="binding-tab-chatops">
                <div class="form-section-title">${translate('ccore_binding_section_chatops')}</div>
                <div class="binding-section-body">
                    <p style="color:var(--text-muted);">${translate('ccore_binding_section_chatops_hint')}</p>
                    <button class="btn-secondary chat-op-migrate-wb" style="padding:4px 10px;font-size:12px;margin-top:6px;">${translate('ccore_btn_migrate_worldbook_chat')}</button>
                </div>
            </div>` : ''}
        </div>
    `;

    detailEl.querySelector('#binding-add-btn').addEventListener('click', openAddModuleDialog);
    detailEl.querySelector('#binding-reset-btn').addEventListener('click', onReset);
    const backBtn = detailEl.querySelector('#binding-back-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            // 仅退出详情视图，回到左栏角色列表（左栏内容仍完好，无需重渲染）
            doc.body.classList.remove('mobile-view-detail-binding');
        });
    }
    const chatSel = detailEl.querySelector('#binding-chat-select');
    chatSel.addEventListener('change', (e) => {
        const v = e.target.value;
        if (v === '') selectNode('character', selected.charName, null);
        else selectNode('chat', selected.charName, v);
    });
    const jumpBtn = detailEl.querySelector('#binding-current-chat-btn');
    if (jumpBtn) {
        jumpBtn.addEventListener('click', () => {
            const current = getCurrentChat();
            if (!current.charName) return;
            const isOnCurrentChat = selected.scope === 'chat' && selected.charName === current.charName && selected.chatFile === current.chatFile;
            if (isOnCurrentChat) {
                // 已在当前聊天聊天级 → 跳回角色级
                selectNode('character', current.charName, null);
            } else {
                // 跳转到当前聊天的聊天级（需确保该角色在树中存在）
                const realNames = new Set(getRealCharacters().map(c => c.name));
                const targetChar = realNames.has(current.charName) ? current.charName : selected.charName;
                selectNode('chat', targetChar, current.chatFile);
            }
        });
    }
    bindModuleBlocks();
    bindChatModuleEntries();
    bindVarBinding();
    bindChatOpMigrateButton();
    bindBindingTabs();
}

/** 绑定「聊天操作」区的搬迁世界书模块按钮（仅聊天级 scope 显示） */
function bindChatOpMigrateButton() {
    const btn = detailEl.querySelector('.chat-op-migrate-wb');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const count = migrateWorldBookModulesToChatEntries();
        showToast(`${translate('ccore_btn_migrate_worldbook_chat')} 完成，复制 ${count} 条到当前聊天`, 'success');
        renderDetail(); // 刷新条目列表显示新搬迁的条目
    });
}

/** 绑定详情顶部的 tab 切换（模块覆盖/变量设置/模块条目/聊天操作） */
function bindBindingTabs() {
    const tabsEl = detailEl.querySelector('#binding-detail-tabs');
    if (!tabsEl) return;
    tabsEl.querySelectorAll('.detail-tab-item').forEach((tab) => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.target;
            tabsEl.querySelectorAll('.detail-tab-item').forEach((t) => t.classList.toggle('active', t === tab));
            detailEl.querySelectorAll('.detail-tab-panel').forEach((p) => p.classList.toggle('active', p.id === target));
        });
    });
}

/**
 * 当前聊天快捷跳转按钮。
 * - 当前选中的不是「当前聊天的聊天级」→ 显示「🎯 当前聊天」，点击跳到当前聊天的聊天级配置
 * - 当前已是「当前聊天的聊天级」→ 显示「⬅ 角色级」，点击跳回角色级
 * 解决：聊天级模块条目藏在角色树的聊天节点里，手动找麻烦；这个按钮一键到位。
 */
function buildCurrentChatJumpBtn() {
    const current = getCurrentChat();
    if (!current.charName || !current.chatFile) return '';
    const isOnCurrentChat = selected.scope === 'chat' && selected.charName === current.charName && selected.chatFile === current.chatFile;
    return `<button class="btn-secondary binding-current-chat-btn" id="binding-current-chat-btn" style="padding:3px 10px;font-size:12px;flex-shrink:0;"
        title="${isOnCurrentChat ? translate('ccore_binding_jump_char') : translate('ccore_binding_jump_chat')}">
        ${isOnCurrentChat ? '⬅ ' + translate('ccore_binding_jump_char') : '🎯 ' + translate('ccore_binding_jump_chat')}
    </button>`;
}

/**
 * 渲染「聊天级模块内容条目」区块。
 * 仅聊天级节点（selected.scope === 'chat'）显示；角色级显示提示「切到具体聊天配置」。
 * 数据存 chat_metadata.ccore.chatModuleEntries（聊天级共享，条目独立于消息生命周期）。
 */
function renderChatModuleEntriesSection(isChatScope) {
    // 标题行右侧动作（聊天级：启用开关 + 新增按钮，编排同「模块覆盖」）
    const headActions = isChatScope ? `
        <div class="binding-section-head-actions">
            <label class="toggle-switch binding-toggle-override" style="margin:0;" title="${translate('ccore_chat_entries_enable')}">
                <input type="checkbox" class="chat-entries-enabled" ${getChatModuleEntryConfig().enabled ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
            <button class="btn-secondary chat-entry-add">＋ ${translate('ccore_chat_entries_add')}</button>
        </div>` : '';

    const sectionHead = `
        <div class="form-section-title${isChatScope ? ' binding-section-head' : ''}">
            <span>${translate('ccore_chat_entries_title')}</span>
            ${headActions}
        </div>`;

    if (!isChatScope) {
        return `${sectionHead}
            <div class="binding-section-body"><p style="color:var(--text-muted);">${translate('ccore_chat_entries_scope_hint')}</p></div>`;
    }

    const entries = getChatModuleEntries();
    const currentChat = getContext()?.chat;
    const defaultFloor = (currentChat && Array.isArray(currentChat)) ? currentChat.length - 1 : 0;

    let listHtml = '';
    if (entries.length === 0) {
        listHtml = `<p style="color:var(--text-muted);">${translate('ccore_chat_entries_empty')}</p>`;
    } else {
        listHtml = entries.map((e, idx) => {
            const entryEnabled = e.enabled !== false;
            return `
            <div class="chat-entry-row" data-entry-id="${escapeAttr(e.id)}" style="border:1px solid var(--border-light);border-radius:4px;padding:6px 8px;margin-bottom:6px;${entryEnabled ? '' : 'opacity:0.55;'}"
                ${entryEnabled ? '' : 'data-disabled="1"'}>
                <div style="display:flex;align-items:center;gap:6px;">
                    <label class="toggle-switch binding-toggle-override" style="margin:0;flex-shrink:0;" title="${translate('ccore_chat_entries_enable_one')}">
                        <input type="checkbox" class="chat-entry-enabled" ${entryEnabled ? 'checked' : ''}>
                        <span class="slider round"></span>
                    </label>
                    <span class="chat-entry-idx" style="color:var(--text-muted);font-size:11px;">#${idx + 1}</span>
                    <input type="text" class="chat-entry-name" value="${escapeAttr(e.name)}" placeholder="${translate('ccore_chat_entries_name_ph')}"
                        style="flex:1;min-width:0;padding:3px 6px;border-radius:3px;border:1px solid var(--border-color);background:var(--bg-input);color:var(--text-input);font-size:12px;">
                    <input type="number" class="chat-entry-floor" value="${e.messageIndex}" title="${translate('ccore_chat_entries_floor_title')}"
                        style="width:64px;padding:3px 6px;border-radius:3px;border:1px solid var(--border-color);background:var(--bg-input);color:var(--text-input);font-size:12px;text-align:center;">
                    <button class="btn-secondary chat-entry-del" title="${translate('ccore_binding_delete')}" style="padding:2px 8px;font-size:12px;">✕</button>
                </div>
                <textarea class="chat-entry-content" rows="3" placeholder="${translate('ccore_chat_entries_content_ph')}"
                    style="width:100%;margin-top:4px;padding:4px 6px;border-radius:3px;border:1px solid var(--border-color);background:var(--bg-input);color:var(--text-input);font-size:12px;resize:vertical;box-sizing:border-box;">${escapeHtml(e.content)}</textarea>
            </div>
        `;
        }).join('');
    }

    return `
        ${sectionHead}
        <div class="binding-section-body">
            <div class="chat-entry-list">${listHtml}</div>
            <p style="color:var(--text-muted);font-size:11px;margin-top:6px;">${translate('ccore_chat_entries_hint').replace('{floor}', String(defaultFloor))}</p>
        </div>`;
}

/* ===================== C 变量绑定 区块（角色级/聊天级都显示） ===================== */

/** 当前节点绑定的 variables 数组（无则空） */
function nodeVarBindings() {
    return getNodeBinding().variables || [];
}

/** 渲染「变量设置」区块 */
function renderVarBindingSection() {
    const vars = nodeVarBindings();
    const rows = vars.length
        ? vars.map((v, i) => renderVarBindingRow(v, i)).join('')
        : `<p style="color:var(--text-muted);">${translate('ccore_var_binding_empty')}</p>`;
    return `
        <div class="form-section-title binding-section-head">
            <span>${translate('ccore_var_binding_title')}</span>
            <div class="binding-section-head-actions">
                <button class="btn-secondary var-binding-add">＋ ${translate('ccore_var_binding_add')}</button>
            </div>
        </div>
        <div class="binding-section-body">
            <div class="var-binding-list">${rows}</div>
        </div>`;
}

function renderVarBindingRow(v, idx) {
    const fallback = fallbackHint(v);
    return `
        <div class="var-binding-row" data-var-idx="${idx}" ${v.enabled ? '' : 'data-disabled="1"'}>
            <div style="display:flex;align-items:center;gap:6px;">
                <label class="toggle-switch binding-toggle-override" style="margin:0;flex-shrink:0;" title="${translate('ccore_var_binding_enable_title')}">
                    <input type="checkbox" class="var-binding-enabled" ${v.enabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
                <input type="text" class="var-binding-name" value="${escapeAttr(v.name)}" placeholder="${translate('ccore_var_binding_name_ph')}"
                style="flex:1;min-width:0;padding:3px 6px;border-radius:3px;border:1px solid var(--border-color);background:var(--bg-input);color:var(--text-input);font-size:12px;">
                ${fallback}
                <button class="btn-secondary var-binding-del" title="${translate('ccore_binding_delete')}" style="padding:2px 8px;font-size:12px;">✕</button>
            </div>
            <textarea class="var-binding-value" rows="2" placeholder="${translate('ccore_var_binding_value_ph')}"
                style="width:100%;margin-top:4px;padding:4px 6px;border-radius:3px;border:1px solid var(--border-color);background:var(--bg-input);color:var(--text-input);font-size:12px;resize:vertical;box-sizing:border-box;">${escapeHtml(v.value)}</textarea>
            <textarea class="var-binding-comment" rows="2" placeholder="${translate('ccore_var_binding_comment_ph')}"
                style="width:100%;margin-top:4px;padding:4px 6px;border-radius:3px;border:1px solid var(--border-color);background:var(--bg-input);color:var(--text-input);font-size:12px;resize:vertical;box-sizing:border-box;">${escapeHtml(v.comment)}</textarea>
        </div>`;
}

/** 聊天级·开关关 且 角色级同名 enabled → 提示「回退角色级」徽标 */
function fallbackHint(v) {
    if (selected.scope !== 'chat' || v.enabled) return '';
    const charV = configManager.findBinding('character', selected.charName, null)?.variables?.find(x => x.name === v.name);
    if (charV && charV.enabled !== false) {
        return `<span class="binding-inherited-badge">${translate('ccore_var_binding_fallback_char')}</span>`;
    }
    return '';
}

function bindVarBinding() {
    const root = detailEl.querySelector('.var-binding-list');
    if (!root) return;

    const addBtn = detailEl.querySelector('.var-binding-add');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const b = getNodeBinding();
            if (!Array.isArray(b.variables)) b.variables = [];
            b.variables.push(createEmptyBoundVariable());
            configManager.upsertBinding(b);
            renderDetail();
        });
    }

    root.querySelectorAll('.var-binding-del').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const row = btn.closest('.var-binding-row');
            const idx = Number(row?.dataset?.varIdx);
            if (Number.isNaN(idx)) return;
            const dlg = new IframeDialog(doc);
            const d = dlg;
            dlg.open({
                title: translate('ccore_binding_delete'),
                content: `<div>${translate('ccore_var_binding_delete_confirm')}</div>`,
                buttons: [
                    { text: translate('ccore_btn_confirm'), className: 'btn-secondary', style: 'background-color: var(--red, #ff4444); color: white;', onClick: () => {
                        removeVarBinding(idx);
                        d.close();
                        renderDetail();
                    } },
                    { text: translate('ccore_btn_cancel'), className: 'btn-primary', onClick: (dialog) => dialog.close() },
                ],
            });
        });
    });

    root.querySelectorAll('.var-binding-enabled').forEach(sw => {
        sw.addEventListener('change', e => {
            const row = e.target.closest('.var-binding-row');
            const idx = Number(row?.dataset?.varIdx);
            if (Number.isNaN(idx)) return;
            updateVarBinding(idx, v => { v.enabled = e.target.checked; });
            // 同步置灰态（不整页重渲，避免失焦丢失正在编辑的备注/值）
            row.style.opacity = e.target.checked ? '' : '0.55';
            if (e.target.checked) row.removeAttribute('data-disabled');
            else row.setAttribute('data-disabled', '1');
            maybeApplyToCurrent();
        });
    });

    const bindField = (selector, apply) => {
        root.querySelectorAll(selector).forEach(el => {
            const row = el.closest('.var-binding-row');
            const idx = Number(row?.dataset?.varIdx);
            if (Number.isNaN(idx)) return;
            el.addEventListener('change', () => {
                updateVarBinding(idx, v => apply(v, el.value));
                maybeApplyToCurrent();
            });
        });
    };
    bindField('.var-binding-name', (v, val) => { v.name = val; });
    bindField('.var-binding-value', (v, val) => { v.value = val; });
    bindField('.var-binding-comment', (v, val) => { v.comment = val; });
}

/** 按索引更新当前节点绑定的一个变量（回调后保存） */
function updateVarBinding(idx, mutate) {
    const b = getNodeBinding();
    const vars = Array.isArray(b.variables) ? b.variables : (b.variables = []);
    const v = vars[idx];
    if (!v) return;
    mutate(v);
    configManager.upsertBinding(b);
}

/** 按索引删除当前节点绑定的一个变量 */
function removeVarBinding(idx) {
    const b = configManager.findBinding(selected.scope, selected.charName, selected.chatFile);
    if (!b) return;
    if (Array.isArray(b.variables)) b.variables.splice(idx, 1);
    configManager.upsertBinding(b);
}

/** 若当前编辑的节点即「当前聊天」生效节点，重放运行时变量（让 {{getvar}} 立即反映） */
function maybeApplyToCurrent() {
    const cur = getCurrentChat();
    if (!cur.charName) return;
    if (selected.charName !== cur.charName) return;
    if (selected.scope === 'chat' && selected.chatFile !== cur.chatFile) return;
    applyCurrentVariables();
}

function renderModuleBlock(modName) {
    const st = resolveModuleState(modName);
    if (!st.def) {
        // 悬空最小处理（完整重指 UI 留 Step 6）：模块已不存在，可删除
        return `<div class="binding-mod-row binding-mod-dangling">
            <span>⚠ ${translate('ccore_binding_no_module_def').replace('{name}', modName)}</span>
            <button class="btn-secondary binding-del-btn" data-del-mod="${escapeAttr(modName)}">${translate('ccore_binding_delete')}</button>
        </div>`;
    }

    const isExpanded = expandedMods.has(modName);
    const overridden = isModuleOverridden(st);
    const disabled = !st.effectiveEnabled;
    const rowCls = `binding-mod-row${disabled ? ' binding-mod-disabled' : ''}`;
    const canDelete = st.moduleSetHere; // 仅本节点显式钉住的模块可移除（回到继承）

    return `
        <div class="${rowCls}" data-mod="${escapeAttr(modName)}">
            <div class="binding-mod-head">
                <span class="binding-mod-toggle">${isExpanded ? '▾' : '▸'}</span>
                <span class="binding-mod-name">${st.def.displayName ? `${st.def.displayName} (${modName})` : modName}</span>
                ${overridden ? `<span class="binding-override-dot" title="${translate('ccore_binding_overridden')}"></span>` : ''}
                <label class="toggle-switch binding-toggle-override">
                    <input type="checkbox" class="binding-mod-switch" ${st.effectiveEnabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
                ${st.inheritedModule ? `<span class="binding-inherited-badge">${translate('ccore_binding_inherited')}</span>` : ''}
                ${canDelete ? `<button class="binding-del-btn binding-del-icon" data-del-mod="${escapeAttr(modName)}" title="${translate('ccore_binding_delete')}">✕</button>` : ''}
            </div>
            ${isExpanded ? `<div class="binding-var-list">${renderVarBlocks(modName)}</div>` : ''}
        </div>
    `;
}

function renderVarBlocks(modName) {
    const def = getModuleDef(modName);
    const vars = def?.variables || [];
    const st = resolveModuleState(modName);
    const nodeEntry = selected.scope === 'chat' ? st.chatEntry : st.charEntry;
    const danglingKeys = nodeEntry?.variableOverrides
        ? Object.keys(nodeEntry.variableOverrides).filter(k => !vars.some(v => v.name === k))
        : [];
    if (!vars.length && !danglingKeys.length) {
        return `<div class="binding-var-empty">${translate('ccore_binding_no_var')}</div>`;
    }
    const varHtml = vars.map(v => {
        const vs = resolveVarState(modName, v.name);
        return `<div class="binding-var-row" data-var="${escapeAttr(v.name)}">
            <span class="binding-var-name">${v.displayName ? `${v.displayName} (${v.name})` : v.name}</span>
            <label class="toggle-switch binding-toggle-override">
                <input type="checkbox" class="binding-var-switch" ${vs.effective ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
            ${vs.inherited ? `<span class="binding-inherited-badge">${translate('ccore_binding_inherited')}</span>` : ''}
        </div>`;
    }).join('');
    const danglingHtml = danglingKeys.map(k => `
        <div class="binding-var-row binding-var-dangling" data-dangle-var="${escapeAttr(k)}">
            <span class="binding-var-name">⚠ ${translate('ccore_binding_no_var_def').replace('{name}', k)}</span>
            <button class="btn-secondary binding-var-del" data-del-var="${escapeAttr(k)}">${translate('ccore_binding_delete')}</button>
        </div>
    `).join('');
    return varHtml + danglingHtml;
}

function bindModuleBlocks() {
    detailEl.querySelectorAll('.binding-mod-head').forEach(head => {
        head.addEventListener('click', e => {
            if (e.target.closest('.toggle-switch')) return; // 开关点击不触发展开
            if (e.target.closest('.binding-del-btn')) return; // 删除按钮不触发展开
            const row = head.closest('.binding-mod-row');
            const mod = row.dataset.mod;
            if (expandedMods.has(mod)) expandedMods.delete(mod);
            else expandedMods.add(mod);
            renderDetail();
        });
    });

    detailEl.querySelectorAll('.binding-mod-switch').forEach(sw => {
        sw.addEventListener('change', e => {
            const mod = e.target.closest('.binding-mod-row').dataset.mod;
            toggleModule(mod, e.target.checked);
        });
    });

    detailEl.querySelectorAll('.binding-var-switch').forEach(sw => {
        sw.addEventListener('change', e => {
            const mod = e.target.closest('.binding-mod-row').dataset.mod;
            const v = e.target.closest('.binding-var-row').dataset.var;
            toggleVar(mod, v, e.target.checked);
        });
    });

    detailEl.querySelectorAll('.binding-del-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            deleteModuleEntry(e.target.dataset.delMod);
        });
    });

    detailEl.querySelectorAll('.binding-var-del').forEach(btn => {
        btn.addEventListener('click', e => {
            const mod = e.target.closest('.binding-mod-row').dataset.mod;
            deleteVarOverride(mod, e.target.dataset.delVar);
        });
    });
}

/**
 * 绑定「聊天级模块内容条目」区块事件。
 * - 总开关 → setChatModuleEntriesEnabled
 * - 新增 → 默认楼层号 = chat.length-1，追加空条目
 * - 删除 → deleteChatModuleEntry
 * - 名称/内容/楼层号 input → 防抖 updateChatModuleEntry
 */
function bindChatModuleEntries() {
    const root = detailEl.querySelector('.chat-entry-list');
    if (!root) return; // 角色级（非聊天）无条目区块，无事件可绑

    const enabledSwitch = detailEl.querySelector('.chat-entries-enabled');
    if (enabledSwitch) {
        enabledSwitch.addEventListener('change', e => {
            setChatModuleEntriesEnabled(e.target.checked);
        });
    }

    const addBtn = detailEl.querySelector('.chat-entry-add');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const currentChat = getContext()?.chat;
            const defaultFloor = (currentChat && Array.isArray(currentChat)) ? currentChat.length - 1 : 0;
            addChatModuleEntry({ name: '', content: '', messageIndex: defaultFloor });
            renderDetail();
        });
    }

    root.querySelectorAll('.chat-entry-del').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const row = btn.closest('.chat-entry-row');
            const id = row?.dataset?.entryId;
            if (!id) return;
            const dlg = new IframeDialog(doc);
            const d = dlg;
            dlg.open({
                title: translate('ccore_binding_delete'),
                content: `<div>${translate('ccore_chat_entries_delete_confirm')}</div>`,
                buttons: [
                    { text: translate('ccore_btn_confirm'), className: 'btn-secondary', style: 'background-color: var(--red, #ff4444); color: white;', onClick: () => {
                        deleteChatModuleEntry(id);
                        d.close();
                        renderDetail();
                    } },
                    { text: translate('ccore_btn_cancel'), className: 'btn-primary', onClick: (dialog) => dialog.close() },
                ],
            });
        });
    });

    // 条目独立开关（与世界书条目 disable 语义对齐）
    root.querySelectorAll('.chat-entry-enabled').forEach(sw => {
        sw.addEventListener('change', e => {
            const row = e.target.closest('.chat-entry-row');
            const id = row?.dataset?.entryId;
            if (!id) return;
            setChatModuleEntryEnabled(id, e.target.checked);
            // 立即反馈置灰状态（不整页重渲，避免失焦丢失正在编辑的内容）
            row.style.opacity = e.target.checked ? '' : '0.55';
            if (e.target.checked) row.removeAttribute('data-disabled');
            else row.setAttribute('data-disabled', '1');
        });
    });

    // 名称 / 内容 / 楼层号：失焦保存（简单可靠；不做防抖输入，避免复杂化）
    const bindField = (selector, apply) => {
        root.querySelectorAll(selector).forEach(el => {
            const row = el.closest('.chat-entry-row');
            const id = row?.dataset?.entryId;
            if (!id) return;
            el.addEventListener('change', () => {
                updateChatModuleEntry(id, apply(el));
            });
        });
    };
    bindField('.chat-entry-name', el => ({ name: el.value }));
    bindField('.chat-entry-content', el => ({ content: el.value }));
    bindField('.chat-entry-floor', el => ({ messageIndex: Number(el.value) }));
}

// 删除某个悬空变量覆盖（变量已改名/不存在）
function deleteVarOverride(modName, varName) {
    const b = configManager.findBinding(selected.scope, selected.charName, selected.chatFile);
    if (!b) return;
    const entry = b.modules.find(m => m.name === modName);
    if (entry?.variableOverrides) delete entry.variableOverrides[varName];
    configManager.upsertBinding(b);
    // 模块/变量覆盖变化 → 清缓存 + 全量刷新（数据层结果变化）
    refreshOnModuleConfigChange();
    renderDetail();
}

function toggleModule(modName, newVal) {
    const b = getNodeBinding();
    const entry = ensureModuleEntry(b, modName);
    entry.moduleOverride = !!newVal; // 始终钉死当前值（去 Delta：不再因等于默认而删除）
    configManager.upsertBinding(b); // 自动保存（debounce）
    refreshOnModuleConfigChange(); // 模块覆盖变化 → 清缓存 + 全量刷新
    renderDetail();
}

function toggleVar(modName, varName, newVal) {
    const b = getNodeBinding();
    const entry = ensureModuleEntry(b, modName);
    if (!entry.variableOverrides) entry.variableOverrides = {};
    entry.variableOverrides[varName] = !!newVal; // 始终钉死当前值
    configManager.upsertBinding(b);
    // 模块/变量覆盖变化 → 清缓存 + 全量刷新（数据层结果变化）
    refreshOnModuleConfigChange();
    renderDetail();
}

function deleteModuleEntry(modName) {
    const b = configManager.findBinding(selected.scope, selected.charName, selected.chatFile);
    if (!b) return;
    b.modules = b.modules.filter(m => m.name !== modName);
    configManager.upsertBinding(b);
    // 模块/变量覆盖变化 → 清缓存 + 全量刷新（数据层结果变化）
    refreshOnModuleConfigChange();
    renderDetail();
}

function onReset() {
    const dialog = new IframeDialog(doc);
    dialog.open({
        title: translate('ccore_binding_reset'),
        content: `<div>${translate('ccore_binding_reset_confirm')}</div>`,
        buttons: [
            {
                text: translate('ccore_btn_confirm'),
                className: 'btn-secondary',
                style: 'background-color: var(--red, #ff4444); color: white;',
                onClick: (d) => {
                    // 只清空当前节点的「模块覆盖」；保留条目本体（未来聊天操作等其它配置不受影响）
                    const b = configManager.findBinding(selected.scope, selected.charName, selected.chatFile);
                    if (b) {
                        b.modules = [];
                        configManager.upsertBinding(b);
                        refreshOnModuleConfigChange(); // 覆盖清空 → 清缓存 + 全量刷新
                    }
                    expandedMods.clear();
                    d.close();
                    renderTree();
                    renderDetail();
                }
            },
            { text: translate('ccore_btn_cancel'), className: 'btn-primary', onClick: (d) => d.close() }
        ]
    });
}

function openAddModuleDialog() {
    const b = getNodeBinding();
    const existing = new Set((b.modules || []).map(m => m.name));
    const addable = configManager.getModules(true).filter(m => !existing.has(m.name));

    const dialog = new IframeDialog(doc);
    const d = dialog;
    dialog.open({
        title: translate('ccore_binding_add_module_title'),
        content: `
            <input type="text" id="binding-add-search" placeholder="${translate('ccore_binding_search_module')}"
                style="width:100%;padding:6px;margin-bottom:8px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-input);color:var(--text-input);">
            <div id="binding-add-list" class="pick-list">
                ${addable.length
                    ? addable.map(m => `<label class="pick-item binding-add-item" for="binding-add-${escapeAttr(m.name)}">
                        <input type="checkbox" id="binding-add-${escapeAttr(m.name)}" class="binding-add-checkbox" value="${escapeAttr(m.name)}">
                        <span class="pick-name">${m.displayName || m.name} <span class="pick-id">(${m.name})</span></span>
                    </label>`).join('')
                    : `<div style="color:var(--text-muted);padding:6px;">${translate('ccore_binding_no_module')}</div>`}
            </div>
        `,
        buttons: [
            {
                text: translate('ccore_binding_confirm_add'),
                className: 'btn-primary',
                onClick: () => {
                    const checked = [...doc.querySelectorAll('#binding-add-list input:checked')].map(i => i.value);
                    if (!checked.length) { d.close(); return; }
                    const nb = getNodeBinding();
                    checked.forEach(name => {
                        const entry = ensureModuleEntry(nb, name);
                        const st = resolveModuleState(name);
                        // 添加即钉死"当前 effective 值"（模块 + 全部变量），不再留半灰/未记录
                        entry.moduleOverride = !!st.effectiveEnabled;
                        if (st.def?.variables && st.def.variables.length) {
                            if (!entry.variableOverrides) entry.variableOverrides = {};
                            st.def.variables.forEach(v => {
                                const vs = resolveVarState(name, v.name);
                                entry.variableOverrides[v.name] = !!vs.effective;
                            });
                        }
                    });
                    configManager.upsertBinding(nb);
                    refreshOnModuleConfigChange(); // 新增覆盖 → 清缓存 + 全量刷新
                    expandedMods.clear();
                    d.close();
                    renderDetail();
                }
            },
            { text: translate('ccore_btn_cancel'), className: 'btn-secondary', onClick: (dd) => dd.close() }
        ]
    });

    const search = doc.getElementById('binding-add-search');
    if (search) {
        search.addEventListener('input', e => {
            const t = e.target.value.trim().toLowerCase();
            doc.querySelectorAll('#binding-add-list .binding-add-item').forEach(l => {
                const n = (l.textContent || '').toLowerCase();
                l.style.display = (!t || n.includes(t)) ? 'flex' : 'none';
            });
        });
    }
}

function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
