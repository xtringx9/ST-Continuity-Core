// 提示词预设条目·扩展操作（复制 / 插入空白 / 移除）
// 在 PromptManager 每个条目（li[data-pm-identifier]）的 .prompt_manager_prompt_controls 中，
// 把操作按钮逐个注入到「编辑(edit)按钮」左边（不抢最左的 ST 占位空 span）。
// 与「绑定当前聊天」(.cc-pm-bind) 同容器但相互独立：本功能编辑预设本身，与聊天无关，故不做聊天页门控。
//
// 数据模型（已核实 ST 原生 PromptManager）：
//   - serviceSettings.prompts            : 条目定义数组（全局，随预设）
//   - serviceSettings.prompt_order[角色] : 该角色的显示顺序 + 启用态，形如 { character_id, order:[{identifier,enabled}] }
//   - render() 只读 prompt_order 渲染列表、不会自动补全缺失条目 → 插入必须「双写」prompts + 当前角色 order。
//   - 原生「Remove」= detachPrompt(prompt, character)：仅从当前角色 order 移除，不删 prompts 本身（即解绑，非删除）。

import { promptManager } from '../../../../../../openai.js';
import { eventSource, event_types } from '../../../../../../../script.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../popup.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import configManager from '../../singleton/configManager.js';

const CC_PM_ACT_CLASS = 'cc-pm-act-btn';

// 仅图标按钮基础样式（尺寸/间距沿用 ST 原生控件区 span 规则，不额外改变原生布局）
const CC_PM_ACT_STYLES = `
.${CC_PM_ACT_CLASS} {
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    color: var(--SmartThemeDimColor, #8a8a8a);
    /* 用 !important 覆盖 ST 的高特异性干扰：
       - ST span span span { margin-left:0.25em }(特异性 2,3,3) 会按主题字号撑大按钮间隙 → 列宽不足时被挤压；
       - ST .prompt_manager_prompt_controls span { width:18px; display:flex } 固定了宽度但 flex-shrink 默认 1 → 也会被压 */
    margin: 0 2px !important;
    flex: 0 0 auto !important;
    width: 18px !important;
    transition: color 0.15s ease;
}
.${CC_PM_ACT_CLASS}:hover { color: var(--SmartThemeQuoteColor, #6cf); }
.${CC_PM_ACT_CLASS}.cc-pm-act-remove { color: var(--SmartThemeDangerColor, #f88); }
.${CC_PM_ACT_CLASS}.cc-pm-act-remove:hover { color: var(--SmartThemeDangerColor, #f88); filter: brightness(1.2); }
.${CC_PM_ACT_CLASS}.cc-pm-act-delete { color: var(--SmartThemeDangerColor, #f88); }
.${CC_PM_ACT_CLASS}.cc-pm-act-delete:hover { color: var(--SmartThemeDangerColor, #f88); filter: brightness(1.2); }

/* 注入了我们按钮的条目：控件区改为靠右紧凑排列（覆盖 ST 高特异性 space-between），
   展开时给该条目 li 加宽网格控件列（grid 列加宽只向左延展、右边界不动 → edit/开关不动），
   避免注入按钮溢出把 edit/开关挤出 */
.prompt_manager_prompt_controls.cc-pm-controls-normalized {
    justify-content: flex-end !important;
}
#completion_prompt_manager #completion_prompt_manager_list li.cc-pm-entry {
    grid-template-columns: 4fr auto 45px !important;
}

/* 折叠：默认仅显示 “...”（cc-pm-act-toggle）；展开后显现 4 个操作按钮，
   “...” 保持可见并变色提示「收起」（单按钮方案，避免伪装按钮不可见的问题）。
   ST promptmanager.css 对控件区 span 设了 18x18 + display:flex，必须用 !important 覆盖 */
.prompt_manager_prompt_controls.cc-pm-controls-normalized .${CC_PM_ACT_CLASS}.cc-pm-act-collapsible { display: none !important; }
.prompt_manager_prompt_controls.cc-pm-controls-normalized.cc-pm-act-expanded .${CC_PM_ACT_CLASS}.cc-pm-act-collapsible { display: flex !important; }
.${CC_PM_ACT_CLASS}.cc-pm-act-toggle { font-weight: bold; margin-left: auto; }
.prompt_manager_prompt_controls.cc-pm-controls-normalized.cc-pm-act-expanded .${CC_PM_ACT_CLASS}.cc-pm-act-toggle { color: var(--SmartThemeQuoteColor, #6cf); }
`;

// ---- 心跳 + 窄 observer（与世界书/绑定同款，不再监听整页） ----
let listObserver = null;
let parentObserver = null;
let heartbeatTimer = null;
let listPresent = false;
let throttleTimer = null;

function scheduleTick() {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
        throttleTimer = null;
        onTick();
    }, 150);
}

function onTick() {
    const listEl = getListElement();
    if (listEl) {
        if (!listPresent) attachListObservers(listEl);
        injectAllControls();
    } else if (listPresent) {
        detachListObservers();
        cleanupStrayControls();
    }
}

function attachListObservers(listEl) {
    listPresent = true;
    listObserver = new MutationObserver(scheduleTick);
    listObserver.observe(listEl, { childList: true, subtree: true });
    const parent = listEl.parentNode;
    if (parent) {
        parentObserver = new MutationObserver(scheduleTick);
        parentObserver.observe(parent, { childList: true });
    }
}

function detachListObservers() {
    listPresent = false;
    if (listObserver) { listObserver.disconnect(); listObserver = null; }
    if (parentObserver) { parentObserver.disconnect(); parentObserver = null; }
}

function cleanupStrayControls() {
    $(`.${CC_PM_ACT_CLASS}`).remove();
    $('.prompt_manager_prompt_controls').removeClass('cc-pm-controls-normalized');
    $('.cc-pm-entry').removeClass('cc-pm-entry');
}

function getListElement() {
    if (!promptManager) return null;
    const prefix = promptManager.configuration?.prefix || '';
    return document.getElementById(`${prefix}prompt_manager_list`);
}

function getEntries() {
    const list = getListElement();
    if (!list) return [];
    return Array.from(list.querySelectorAll('li[data-pm-identifier]'));
}

// ---- 数据操作：复制 / 插入空白 / 移除 ----
function newIdentifier() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'cc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * 克隆源条目，写入新 identifier + 占位名，插入到源条目之后（或给定位置）。
 * @param {string} sourceId
 * @param {boolean} copyContent  true=复制（带内容）；false=空白（清空 content）
 */
function clonePromptEntry(sourceId, copyContent) {
    if (!promptManager || !promptManager.activeCharacter) return false;
    const source = promptManager.getPromptById(sourceId);
    if (!source) return false;

    const newId = newIdentifier();
    const base = (source && typeof source === 'object') ? structuredClone(source) : {};
    const blank = {
        system_prompt: false,
        enabled: false,
        marker: false,
        role: 'system',
        ...base,
    };
    blank.identifier = newId;
    blank.name = (source.name || 'Prompt') + (copyContent ? ' (副本)' : '');
    blank.content = copyContent ? (source.content || '') : '';

    promptManager.serviceSettings.prompts.push(blank);

    const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
    const srcEntry = order.find(e => e.identifier === sourceId);
    const newEntry = { identifier: newId, enabled: srcEntry ? srcEntry.enabled : true };
    const idx = order.findIndex(e => e.identifier === sourceId);
    if (idx === -1) order.push(newEntry);
    else order.splice(idx + 1, 0, newEntry);

    promptManager.render(false);
    promptManager.saveServiceSettings();
    return true;
}

function insertBlankEntry(sourceId, position) {
    if (!promptManager || !promptManager.activeCharacter) return false;
    const source = sourceId ? promptManager.getPromptById(sourceId) : null;
    const newId = newIdentifier();
    const base = (source && typeof source === 'object') ? structuredClone(source) : {};
    const blank = {
        system_prompt: false,
        enabled: false,
        marker: false,
        role: 'system',
        ...base,
    };
    blank.identifier = newId;
    blank.name = 'New Prompt';
    blank.content = '';

    promptManager.serviceSettings.prompts.push(blank);

    const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
    let insertIdx = order.length;
    if (sourceId) {
        const idx = order.findIndex(e => e.identifier === sourceId);
        if (idx !== -1) insertIdx = position === 'before' ? idx : idx + 1;
    }
    order.splice(insertIdx, 0, { identifier: newId, enabled: true });

    promptManager.render(false);
    promptManager.saveServiceSettings();
    return true;
}

function removeEntry(id) {
    if (!promptManager || !promptManager.activeCharacter) return false;
    const prompt = promptManager.getPromptById(id);
    if (!prompt) return false;
    // 接管原生 Remove：仅从当前角色 order 解绑（detach），不删 prompts 定义（非永久删除）
    promptManager.detachPrompt(prompt, promptManager.activeCharacter);
    promptManager.render(false);
    promptManager.saveServiceSettings();
    return true;
}

// 真删除：从 serviceSettings.prompts 永久删除定义（区别于 removeEntry 仅解绑）。
// 仅允许非 system_prompt（与 ST isPromptDeletionAllowed 一致），系统/Marker 条目不可删。
// 同时清理所有角色 prompt_order 的残留引用，避免定义删除后其它角色订单串留孤儿。
function deleteEntry(id) {
    if (!promptManager) return false;
    const prompt = promptManager.getPromptById(id);
    if (!prompt) return false;
    if (promptManager.isPromptDeletionAllowed && promptManager.isPromptDeletionAllowed(prompt) === false) return false;
    const idx = promptManager.getPromptIndexById(id);
    if (idx == null) return false;
    promptManager.serviceSettings.prompts.splice(Number(idx), 1);
    const orderMap = promptManager.serviceSettings.prompt_order;
    if (orderMap) {
        for (const charId in orderMap) {
            const ord = orderMap[charId];
            if (ord && Array.isArray(ord.order)) ord.order = ord.order.filter(e => e && e.identifier !== id);
        }
    }
    promptManager.render(false);
    promptManager.saveServiceSettings();
    return true;
}

// ---- UI 注入（逐个按钮注入到 edit 左边） ----
function ensureStyles() {
    if ($('#cc-pm-act-style').length) return;
    $('<style>', { id: 'cc-pm-act-style' }).text(CC_PM_ACT_STYLES).appendTo('head');
}

function makeActionButton(fa, title, act, extra = '') {
    const $btn = $('<span>', { class: `${CC_PM_ACT_CLASS} fa-solid ${fa} ${extra}`, title });
    $btn.on('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { act(); } catch (err) { errorLog('[PM-ACTIONS] 操作失败', err); }
    });
    return $btn;
}

function injectControlIntoEntry($entry) {
    // 以 “...” 切换按钮为存在判据：已有则跳过；否则先清掉上一版本遗留的旧按钮再注入，避免热重载残留
    if ($entry.find('.cc-pm-act-toggle').length) return false;
    $entry.find(`.${CC_PM_ACT_CLASS}`).remove();
    const identifier = $entry.attr('data-pm-identifier');
    if (!identifier) return false;

    const $edit = $entry.find('.prompt-manager-edit-action').first();
    const $controls = $entry.find('.prompt_manager_prompt_controls');
    // ST 在无编辑/无删除权限的条目会渲染空占位 <span class="fa-solid">（无 title、无内容），
    // 用它定位「最左占位」；无编辑按钮的条目（如 Chat History/Examples）改放到占位右边，
    // 避免走到末尾追加导致按钮跑到最右、顺序与常驻条目相反。
    const $placeholder = $controls.children('span.fa-solid').not('[title]').filter(function () {
        return !this.textContent.trim() && !this.querySelector('*');
    }).last();

    // 仅非 system_prompt（ST isPromptDeletionAllowed）才提供「删除」，系统/Marker 条目不可删
    const prompt = promptManager.getPromptById(identifier);
    const canDelete = !!prompt && (!promptManager.isPromptDeletionAllowed || promptManager.isPromptDeletionAllowed(prompt) !== false);

    const ACTIONS = [
        { fa: 'fa-copy', title: '复制', act: () => clonePromptEntry(identifier, true) },
        { fa: 'fa-arrow-up', title: '在上方插入空白', act: () => insertBlankEntry(identifier, 'before') },
        { fa: 'fa-arrow-down', title: '在下方插入空白', act: () => insertBlankEntry(identifier, 'after') },
        { fa: 'fa-chain-broken cc-pm-act-remove', title: '移除', act: () => removeEntry(identifier) },
    ];
    if (canDelete) {
        ACTIONS.push({
            fa: 'fa-trash-can cc-pm-act-delete',
            title: '删除',
            act: async () => {
                // 自行构造 ST 风格确认弹窗（Popup + POPUP_TYPE.CONFIRM），不使用浏览器原生 confirm，
                // 也不依赖 Popup.show.confirm 的调用栈时序
                const $body = $('<div>').append(
                    $('<p>').text('确定删除该提示词吗？此操作不可撤销。'),
                );
                try {
                    const result = await new Popup($body, POPUP_TYPE.CONFIRM, '', {
                        okButton: '删除',
                        cancelButton: '取消',
                    }).show();
                    if (result === POPUP_RESULT.AFFIRMATIVE) deleteEntry(identifier);
                } catch (err) {
                    errorLog('[PM-ACTIONS] 删除确认弹窗失败', err);
                }
            },
        });
    }
    ACTIONS.reverse(); // 展开后顺序反过来；删除按钮（若有）在最左，最右挨“...”的是复制
    const $collapsible = ACTIONS.map(a =>
        makeActionButton(a.fa, a.title, a.act, (a.extra || '') + ' cc-pm-act-collapsible'));
    // “...” 切换按钮：点击就地展开/收起 4 个操作按钮（切换控件区 cc-pm-act-expanded），
    // 同时加宽条目网格控件列 li.cc-pm-entry（grid 列加宽只向左延展 → edit/开关不动）。
    // 单一 “...” 始终可见：展开时变色提示「收起」，避免伪装按钮不可见的问题。
    const toggleExpanded = () => {
        $controls.toggleClass('cc-pm-act-expanded');
        $entry.toggleClass('cc-pm-entry');
    };
    const $toggle = makeActionButton('fa-ellipsis', '更多操作 / 收起', toggleExpanded, 'cc-pm-act-toggle');
    // 顺序（右→左插入前 edit）：[复制][上插][下插][移除][...][edit]
    const $btns = [...$collapsible, $toggle];

    // 插入锚点优先级：编辑按钮左边 > 占位符右边 > 控件区最左
    let $anchor = null;
    if ($edit.length) $anchor = $edit;
    else if ($placeholder.length) $anchor = $placeholder;

    if ($anchor) {
        // 正向 insertBefore：最先插入的在最左、最后插入的（...）紧挨锚点左侧。
        // 最终顺序 [复制][上插][下插][移除][...][锚点] → 展开时按钮在 “...” 左侧（向左展开），... 在最右。
        $btns.forEach($b => $b.insertBefore($anchor));
    } else if ($controls.length) {
        $btns.forEach($b => $controls.append($b));
    } else {
        $btns.forEach($b => $entry.append($b));
    }

    // 隐藏原生 detach（Remove）按钮：其能力由本「移除」接管，避免重复
    $entry.find('.prompt-manager-detach-action').hide();
    // 隐藏 ST 为系统/自带条目渲染的纯空占位 span（class 仅含 "fa-solid"、无图标类/无内容）：
    // 它被 ST 设成 18px×18px，会在控件区左端留空白导致与自定义条目间距不一致。
    // 注意：开关 prompt-manager-toggle-action 也带 fa-solid 类，不能用宽泛的 span.fa-solid 匹配，
    // 必须精确判定 class 仅等于 "fa-solid"（无其他 fa- 图标类 / prompt-manager-* 类）。
    $controls.children('span.fa-solid').filter(function () {
        return this.className.trim() === 'fa-solid' && !this.textContent.trim();
    }).hide();
    // 控件区归一化为靠右紧凑排列，统一各条目按钮间距
    if ($controls.length) $controls.addClass('cc-pm-controls-normalized');
    return true;
}

function injectAllControls() {
    const entries = getEntries();
    for (const entry of entries) {
        injectControlIntoEntry($(entry));
    }
}

export function initPromptEntryActionsUI() {
    ensureStyles();

    heartbeatTimer = setInterval(onTick, 500);
    onTick();
    debugLog('[PM-ACTIONS] 预设条目扩展操作控件已初始化');
}

export function removePromptEntryActionsUI() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    detachListObservers();
    if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; }
    // 还原被隐藏的原生 detach（Remove）按钮
    $('.prompt-manager-detach-action').show();
    $('.prompt_manager_prompt_controls').removeClass('cc-pm-controls-normalized');
    cleanupStrayControls();
    listPresent = false;
}

// ---- 编排层（配置门控，与 promptBinding 同构） ----
let applied = false;

export function initPromptEntryActions() {
    if (configManager.getSTFeatureEnhanceConfig().promptEntryActions?.enabled === false) return;
    if (applied) return;
    applied = true;
    try {
        initPromptEntryActionsUI();
    } catch (e) {
        errorLog('[PM-ACTIONS] 初始化预设条目扩展操作失败', e);
    }
}

export function removePromptEntryActions() {
    if (!applied) return;
    applied = false;
    try {
        removePromptEntryActionsUI();
    } catch (e) {
        errorLog('[PM-ACTIONS] 移除预设条目扩展操作失败', e);
    }
}
