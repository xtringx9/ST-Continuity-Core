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
import { IframeDialog } from '../../shared/IframeDialog.js';
// 直接 import SillyTavern 的 getContext（同目录 Toolbox.js 已验证可用：iframe 内可经此拿到实时角色/聊天上下文）
import { getContext } from '../../../../../../extensions.js';

// 全局文档引用（指向 iframe 的 document）
let doc = null;
let treeListEl = null;
let detailEl = null;
let selected = null;                 // { scope, charName, chatFile }
const expandedMods = new Set();      // 已展开的模块名

/**
 * 初始化角色绑定页
 * @param {Document} iframeDocument iframe 的文档对象
 */
export function initCharacterBinding(iframeDocument) {
    doc = iframeDocument;
    treeListEl = doc.getElementById('binding-tree-list');
    detailEl = doc.getElementById('binding-detail-content');
    if (!treeListEl || !detailEl) return;

    renderTree();

    // 切换到本视图时刷新（支持"当前聊天自动跟随"）
    const navItem = doc.querySelector('.nav-item[data-target="view-profiles"]');
    if (navItem) {
        navItem.addEventListener('click', renderTree);
    }
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
                body: JSON.stringify({ avatar_url: avatar, simple: true }),
            });
            if (!response.ok) return [];
            const data = await response.json();
            return Object.values(data || {}).map(x => String(x.file_name || '').replace(/\.jsonl$/, ''));
        } catch {
            return [];
        }
    })();
    chatCache.set(charName, p);
    return p;
}

async function renderTree() {
    if (!treeListEl) return;
    treeListEl.innerHTML = '';

    const current = getCurrentChat();
    let realChars = getRealCharacters();
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
        .filter(name => name && !realNames.has(name));
    for (const name of danglingNames) {
        treeListEl.appendChild(buildCharNode(name, current, true));
    }

    // 首次进入且存在当前角色：自动选中（不覆盖用户后续手动选择）
    if (!selected && current.charName && realNames.has(current.charName)) {
        selected = { scope: 'character', charName: current.charName, chatFile: null };
    }
    applyActive();
    renderDetail();
}

function buildCharNode(name, current, isDangling) {
    const node = doc.createElement('div');
    node.className = 'binding-tree-char';
    node.innerHTML = `
        <div class="binding-tree-row" data-char="${escapeAttr(name)}">
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
        b = { scope: selected.scope, charName: selected.charName, chatFile: selected.scope === 'chat' ? selected.chatFile : null, modules: [] };
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

// 下层有效值（用于 Delta：仅当设的值 ≠ 下层时才写入 override）
function computeLowerModule(modName) {
    const def = getModuleDef(modName);
    const defEnabled = def ? (def.enabled !== false) : true;
    if (selected.scope === 'character') return defEnabled; // 角色层下层=全局默认
    const charB = configManager.findBinding('character', selected.charName, null);
    const charEntry = charB?.modules?.find(m => m.name === modName);
    return (charEntry && typeof charEntry.moduleOverride === 'boolean') ? charEntry.moduleOverride : defEnabled;
}

function computeLowerVar(modName, varName) {
    const def = getModuleDef(modName);
    const defVar = def?.variables?.find(v => v.name === varName);
    const defVarEnabled = defVar ? (defVar.enabled !== false) : true;
    if (selected.scope === 'character') return defVarEnabled;
    const charB = configManager.findBinding('character', selected.charName, null);
    const charEntry = charB?.modules?.find(m => m.name === modName);
    const charVO = charEntry?.variableOverrides?.[varName];
    return typeof charVO === 'boolean' ? charVO : defVarEnabled;
}

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

    const scopeLabel = selected.scope === 'character'
        ? translate('ccore_binding_scope_character')
        : translate('ccore_binding_scope_chat');
    const title = selected.scope === 'character'
        ? `${selected.charName} · ${scopeLabel}`
        : `${selected.charName} · ${selected.chatFile}`;

    // 构建聊天下拉选项（当前聊天置顶；默认=角色级）
    const current = getCurrentChat();
    const isCurrentChar = current.charName === selected.charName;
    let chatOptions = [];
    if (isCurrentChar) {
        const char = getRealCharacters().find(c => c.name === selected.charName);
        if (char?.avatar) {
            const chats = await getChatNamesForChar(selected.charName, char.avatar);
            // 当前聊天置顶
            if (current.chatFile) {
                const idx = chats.indexOf(current.chatFile);
                if (idx > 0) { const [c] = chats.splice(idx, 1); chats.unshift(c); }
            }
            chatOptions = chats;
        }
    } else {
        // 非当前角色：列出配置里残留的聊天绑定（无法枚举真实聊天）
        chatOptions = configManager.getBindings()
            .filter(x => x.charName === selected.charName && x.scope === 'chat' && x.chatFile)
            .map(x => x.chatFile);
    }

    const scopeOptions = [
        `<option value="" ${!selected.chatFile ? 'selected' : ''}>${translate('ccore_binding_scope_character')}（全部聊天）</option>`,
        ...chatOptions.map(chat => {
            const isCur = isCurrentChar && chat === current.chatFile;
            return `<option value="${escapeAttr(chat)}" ${selected.chatFile === chat ? 'selected' : ''}>${isCur ? '● ' : ''}${escapeHtml(chat)}</option>`;
        }),
    ].join('');

    // 会员制取并集（角色级 + 聊天级）
    const b = configManager.findBinding(selected.scope, selected.charName, selected.chatFile);
    const charB = configManager.findBinding('character', selected.charName, null);
    const names = new Set();
    (b?.modules || []).forEach(m => names.add(m.name));
    (charB?.modules || []).forEach(m => names.add(m.name));
    const modNames = [...names];

    detailEl.innerHTML = `
        <div class="binding-detail-header">
            <h3>${title}</h3>
            <span class="binding-detail-scope">${scopeLabel}</span>
            <button class="btn-secondary binding-reset-btn" id="binding-reset-btn">${translate('ccore_binding_reset')}</button>
        </div>
        <div class="binding-chat-select-row">
            <label class="binding-chat-select-label">${translate('ccore_binding_chat_select')}</label>
            <select class="binding-chat-select" id="binding-chat-select">
                ${scopeOptions}
            </select>
        </div>
        <div class="binding-detail-body" id="binding-detail-body">
            <button class="btn-secondary binding-add-btn" id="binding-add-btn">＋ ${translate('ccore_binding_add_module')}</button>
            <div class="binding-mod-list" id="binding-mod-list">
                ${modNames.length
                    ? modNames.map(renderModuleBlock).join('')
                    : `<p style="color:var(--text-muted);">${translate('ccore_binding_empty')}</p>`}
            </div>
        </div>
    `;

    detailEl.querySelector('#binding-add-btn').addEventListener('click', openAddModuleDialog);
    detailEl.querySelector('#binding-reset-btn').addEventListener('click', onReset);
    const chatSel = detailEl.querySelector('#binding-chat-select');
    chatSel.addEventListener('change', (e) => {
        const v = e.target.value;
        if (v === '') selectNode('character', selected.charName, null);
        else selectNode('chat', selected.charName, v);
    });
    bindModuleBlocks();

    if (window.innerWidth <= 768) {
        doc.body.classList.add('mobile-view-detail');
    }
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

    return `
        <div class="${rowCls}" data-mod="${escapeAttr(modName)}">
            <div class="binding-mod-head">
                <span class="binding-mod-toggle">${isExpanded ? '▾' : '▸'}</span>
                <span class="binding-mod-name">${st.def.displayName || modName}</span>
                ${overridden ? `<span class="binding-override-dot" title="${translate('ccore_binding_overridden')}"></span>` : ''}
                <label class="toggle-switch ${st.effectiveEnabled !== st.defEnabled ? 'binding-toggle-override' : 'binding-toggle-inherited'}">
                    <input type="checkbox" class="binding-mod-switch" ${st.effectiveEnabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
                ${st.inheritedModule ? `<span class="binding-inherited-badge">${translate('ccore_binding_inherited')}</span>` : ''}
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
            <span class="binding-var-name">${v.displayName || v.name}</span>
            <label class="toggle-switch ${vs.effective !== vs.defVarEnabled ? 'binding-toggle-override' : 'binding-toggle-inherited'}">
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

// 删除某个悬空变量覆盖（变量已改名/不存在）
function deleteVarOverride(modName, varName) {
    const b = configManager.findBinding(selected.scope, selected.charName, selected.chatFile);
    if (!b) return;
    const entry = b.modules.find(m => m.name === modName);
    if (entry?.variableOverrides) delete entry.variableOverrides[varName];
    configManager.upsertBinding(b);
    renderDetail();
}

function toggleModule(modName, newVal) {
    const lower = computeLowerModule(modName);
    const b = getNodeBinding();
    const entry = ensureModuleEntry(b, modName);
    if (newVal === lower) delete entry.moduleOverride; // 回到下层 → 删 override（Delta）
    else entry.moduleOverride = newVal;
    configManager.upsertBinding(b); // 自动保存（debounce）
    renderDetail();
}

function toggleVar(modName, varName, newVal) {
    const lower = computeLowerVar(modName, varName);
    const b = getNodeBinding();
    const entry = ensureModuleEntry(b, modName);
    if (!entry.variableOverrides) entry.variableOverrides = {};
    if (newVal === lower) delete entry.variableOverrides[varName];
    else entry.variableOverrides[varName] = newVal;
    configManager.upsertBinding(b);
    renderDetail();
}

function deleteModuleEntry(modName) {
    const b = configManager.findBinding(selected.scope, selected.charName, selected.chatFile);
    if (!b) return;
    b.modules = b.modules.filter(m => m.name !== modName);
    configManager.upsertBinding(b);
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
                    configManager.removeBinding(selected.scope, selected.charName, selected.chatFile);
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
            <div id="binding-add-list" style="max-height:300px;overflow:auto;border:1px solid var(--border-light);border-radius:4px;padding:6px;">
                ${addable.length
                    ? addable.map(m => `<label class="binding-add-item" style="display:block;padding:4px 2px;cursor:pointer;"><input type="checkbox" value="${escapeAttr(m.name)}"> ${m.displayName || m.name}</label>`).join('')
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
                    checked.forEach(name => ensureModuleEntry(nb, name));
                    configManager.upsertBinding(nb);
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
                l.style.display = (!t || n.includes(t)) ? 'block' : 'none';
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
