// 提示词预设条目·搜索定位
// 在 OpenAI 设置面板注入：
//   - 折叠栏：收拢「上下文长度等上半区」，即 #range_block_openai（Context Size / Max Response 等）
//     以及 #openai_settings 内除「包含预设列表的外层 .range-block.m-b-1」之外的全部，
//     默认收起，仅保留搜索栏 + 条目列表 + 底部按钮，点击展开一键还原
//   - 搜索工具条（常驻）：按「条目名称 + 条目内容」搜索，上一/下一循环 + 下拉点选 + 回车，滚动时始终可见
//   - 回顶 / 跳底 右缘垂直层：以 position:sticky 钉在预设列表右缘，随列表滚动始终跟随（不跑出面板）
//
// 布局：
//   #completion_prompt_manager_list 本身作为独立溢出滚动容器（max-height + overflow-y:auto），
//   因此其上方（搜索工具条）天然常驻、滚动时始终可见；
//   回顶/跳底 使用 0 高度 + sticky 装饰 <li> 插入 ul 顶部，随该滚动容器钉在右缘。
//   ⚠️ ST sortable 只允许 '.completion_prompt_manager_prompt_draggable' 可拖、toArray 只取
//      data-pm-identifier 的条目，故此装饰 <li> 不影响排序。
//
// 折叠机制：
//   收拢 #range_block_openai + #openai_settings 内除「包含预设列表的外层 .range-block」外的全部；
//   折叠栏作为 #openai_settings 首子元素常驻。ST 原生头部区/搜索栏/列表/底部按钮均在保留块内。
//
// 数据模型（与 promptEntryActions 同款）：
//   - 条目名称 = li.querySelector('.completion_prompt_manager_prompt_name')['data-pm-name']
//   - 条目内容不在 DOM（未展开不渲染），须读 promptManager.getPromptById(id).content（string 时才纳入搜索）
//   - 搜索框复用 ST 的 text_pole 输入样式；下拉借用 ST 主题变量，观感与原生日志一致。
//
// ⚠️ renderPromptManager() 每次重绘都会清空容器 innerHTML，所有注入元素随之被抹掉 ——
// 与 promptEntryActions 同策略：心跳 + 窄 MutationObserver 幂等重建，折叠态 / 搜索词按状态重放。

import { promptManager } from '../../../../../../openai.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import configManager from '../../singleton/configManager.js';
import { escapeHtmlEntities as escapeHtml } from '../../utils/textConverter.js';

const CC_SEARCH_ID = 'cc-pm-search';
const CC_COLLAPSE_ID = 'cc-pm-openai-collapse';
const CC_COLLAPSE_GEN_ID = 'cc-pm-gen-collapse';
const CC_COLLAPSE_ROW_ID = 'cc-pm-collapse-row';
const CC_COLLAPSED = 'cc-pm-collapsed';
const CC_STYLE_ID = 'cc-pm-search-style';
const CC_HIT_CLASS = 'cc-pm-search-hit';
const CC_CUR_CLASS = 'cc-pm-search-current';

const STYLES = `
#completion_prompt_manager .range-block { position: relative; }

/* 预设条目保持自然高度、不做内部限高滚动（限定高度属于折叠区，非条目列表）；
   搜索栏以 sticky 常驻，随外层抽屉滚动保持在顶部 */

/* —— 折叠按钮（复用 ST menu_button，位于搜索栏常驻工具栏内，始终可见） —— */
.cc-pm-collapse { gap: 6px; user-select: none; }
.cc-pm-collapse .cc-pm-collapse-label { opacity: 0.85; }
.cc-pm-collapse .cc-pm-collapse-fa { pointer-events: none; }
.cc-pm-collapse-row { display: flex; gap: 6px; margin-bottom: 4px; }
.cc-pm-collapse-row .cc-pm-collapse { flex: 1; margin: 0; }

/* 折叠态隐藏规则（!important 压制 ST 内联 display；展开移除 class 即恢复）：
   ① 直接对 #range_block_openai 自身隐藏，不依赖父层级 */
#range_block_openai.${CC_COLLAPSED} { display: none !important; }
/* ② OpenAI 高级区：#openai_settings 内除预设列表外层块全隐 */
#openai_settings.${CC_COLLAPSED} > :not(.range-block.m-b-1) { display: none !important; }

/* —— 搜索工具条（复用 ST text_pole 输入观感；作为列表首行，置于「名称」表头下方） —— */
#${CC_SEARCH_ID} {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 2px;
}
#completion_prompt_manager #completion_prompt_manager_list li.cc-pm-search-li {
    display: flex !important;
    flex-direction: column;
    padding: 4px 2px !important;
    margin: 0 !important;
    border: none !important;
    position: sticky;
    top: 0;
    z-index: 9;
    background: inherit !important;
}
#${CC_SEARCH_ID} .cc-pm-search-row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
}
#${CC_SEARCH_ID} .cc-pm-search-input-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
}
#${CC_SEARCH_ID} .cc-pm-search-input {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    padding-right: 24px;
}
#${CC_SEARCH_ID} .cc-pm-search-input:focus { outline: none; border-color: var(--SmartThemeQuoteColor, #6cf); }
#${CC_SEARCH_ID} .cc-pm-search-clear {
    position: absolute;
    right: 5px;
    top: 50%;
    transform: translateY(-50%);
    cursor: pointer;
    border: none;
    background: transparent;
    padding: 0;
    font-size: 13px;
    line-height: 1;
    color: var(--SmartThemeDimColor, #8a8a8a);
}
#${CC_SEARCH_ID} .cc-pm-search-clear:hover { color: var(--SmartThemeQuoteColor, #6cf); }
#${CC_SEARCH_ID} .cc-pm-search-count {
    font-size: 11px;
    color: var(--SmartThemeDimColor, #8a8a8a);
    white-space: nowrap;
}
/* —— 搜索工具条按钮：统一用原生 menu_button 观感 + 可见填充（ButtonFill） —— */
#${CC_SEARCH_ID} .cc-pm-search-btn {
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    color: var(--SmartThemeBodyColor);
    width: 22px;
    height: 22px;
    padding: 0;
    margin: 0 !important;
    background-color: var(--ButtonFill, var(--SmartThemeBlurTintColor));
    border: 1px solid var(--SmartThemeBorderColor);
    border-radius: 4px;
    flex: 0 0 auto;
}
#${CC_SEARCH_ID} .cc-pm-search-btn:disabled { opacity: 0.4; cursor: default; }
#${CC_SEARCH_ID} .cc-pm-search-btn:not(:disabled):hover {
    /* 覆盖 ST menu_button hover 的 var(--white30a)，保持可见不半透明 */
    color: var(--SmartThemeQuoteColor, #6cf);
    border-color: var(--SmartThemeQuoteColor, #6cf);
    background-color: var(--ButtonFill, var(--SmartThemeBlurTintColor)) !important;
}
#${CC_SEARCH_ID} .cc-pm-search-results {
    display: none;
    max-height: 180px;
    overflow-y: auto;
    border: 1px solid var(--SmartThemeBorderColor);
    border-radius: 4px;
    background: var(--ButtonFill, var(--SmartThemeBlurTintColor));
}
#${CC_SEARCH_ID} .cc-pm-search-results.cc-open { display: block; }
#${CC_SEARCH_ID} .cc-pm-search-result-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 13px;
    border-left: 3px solid transparent;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
#${CC_SEARCH_ID} .cc-pm-search-result-item:hover { background: var(--black30a); border-left-color: var(--SmartThemeQuoteColor, #6cf); }
#${CC_SEARCH_ID} .cc-pm-search-result-item .cc-pm-hit-badge { color: var(--SmartThemeDimColor, #8a8a8a); font-size: 11px; }

/* 列表条目高亮：命中浅色描边，当前项加深 + 背景 */
.completion_prompt_manager_prompt.${CC_HIT_CLASS} {
    outline: 1px dashed var(--SmartThemeQuoteColor, #6cf);
    outline-offset: -1px;
}
.completion_prompt_manager_prompt.${CC_CUR_CLASS} {
    outline: 2px solid var(--SmartThemeQuoteColor, #6cf) !important;
    background: color-mix(in srgb, var(--SmartThemeQuoteColor, #6cf) 12%, transparent);
}
`;

// ---- 状态 ----
const state = { query: '', currentId: null, genCollapsed: true, openaiCollapsed: true };

let heartbeatTimer = null;
let listObserver = null;
let parentObserver = null;
let listPresent = false;
let throttleTimer = null;
let inputTimer = null;
let lastSignature = ''; // 已计算匹配时的条目 id 签名，用于避免滚动/心跳重复全量重算

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
        ensurePresetCollapseRow();
        ensureToolbar(listEl);
        applyGenCollapse();
        applyOpenAICollapse();
        // 有搜索词时：仅当条目列表签名变化（增删/重绘）才重算，否则滚动/心跳不重复全量匹配
        if (state.query.trim()) {
            const sig = getEntrySignature(listEl);
            if (sig !== lastSignature) {
                lastSignature = sig;
                const matches = computeMatches(listEl);
                renderSearchState(matches);
            }
        }
    } else if (listPresent) {
        detachListObservers();
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

function getPrefix() {
    return promptManager?.configuration?.prefix || '';
}

function getListElement() {
    if (!promptManager) return null;
    const prefix = getPrefix();
    return document.getElementById(`${prefix}prompt_manager_list`);
}

function getHeaderElement() {
    const prefix = getPrefix();
    if (!prefix) return null;
    return document.querySelector(`#${prefix}prompt_manager .${prefix}prompt_manager_header`);
}

function getOpenAISettings() {
    return document.getElementById('openai_settings');
}

/** 定位「包含预设列表」的外层 .range-block.m-b-1（折叠时唯一保留的 #openai_settings 子块）。
 *  结构：外层 .range-block.m-b-1 > #completion_prompt_manager > .range-block > ul，故向上爬两层。 */
function getPromptRegion() {
    const inner = getListElement()?.closest('.range-block');
    const outer = inner?.parentElement?.closest('.range-block');
    if (outer && outer.closest('#openai_settings')) return outer;
    return inner || null;
}

// ---- 两块折叠按钮（放在「选择预设的下拉框」#openai_api-presets 下方，常驻可见） ----
function ensurePresetCollapseRow() {
    if (document.getElementById(CC_COLLAPSE_ROW_ID)) {
        applyGenCollapse();
        applyOpenAICollapse();
        return;
    }
    const host = document.getElementById('openai_api-presets');
    const fallback = host ? host.parentElement?.parentElement : (document.getElementById('openai_settings'));
    let anchor = host;
    if (!anchor && fallback) anchor = fallback;
    if (!anchor) return;
    const $row = $('<div>', { id: CC_COLLAPSE_ROW_ID, class: 'cc-pm-collapse-row' })
        .append(`
            <div class="cc-pm-collapse menu_button cc-pm-gen-collapse" title="收拢 / 展开 上下文与采样设置">
                <span class="cc-pm-collapse-fa fa-solid fa-chevron-right"></span>
                <span class="cc-pm-collapse-label">上下文 / 采样</span>
            </div>
            <div class="cc-pm-collapse menu_button cc-pm-openai-collapse" title="收拢 / 展开 OpenAI 高级设置">
                <span class="cc-pm-collapse-fa fa-solid fa-chevron-right"></span>
                <span class="cc-pm-collapse-label">OpenAI 高级</span>
            </div>
        `);
    $row.find('.cc-pm-gen-collapse').on('click', () => {
        state.genCollapsed = !state.genCollapsed;
        applyGenCollapse();
    });
    $row.find('.cc-pm-openai-collapse').on('click', () => {
        state.openaiCollapsed = !state.openaiCollapsed;
        applyOpenAICollapse();
    });
    anchor.insertAdjacentElement('afterend', $row[0]);
    applyGenCollapse();
    applyOpenAICollapse();
}

// ④ 上下文 / 采样：#range_block_openai（直接按 id 折叠，不依赖父层级）
function applyGenCollapse() {
    const rangeBlock = document.getElementById('range_block_openai');
    if (rangeBlock) rangeBlock.classList.toggle(CC_COLLAPSED, state.genCollapsed);
    updateBarState('.cc-pm-gen-collapse', state.genCollapsed);
}

// ② OpenAI 高级区：#openai_settings 内除「预设列表外层块」外全部收拢
function applyOpenAICollapse() {
    const host = getOpenAISettings();
    if (host) host.classList.toggle(CC_COLLAPSED, state.openaiCollapsed);
    updateBarState('.cc-pm-openai-collapse', state.openaiCollapsed);
}

// 刷新折叠按钮的箭头状态（按钮在预设下拉框下方的常驻行里）
function updateBarState(sel, collapsed) {
    const el = document.getElementById(CC_COLLAPSE_ROW_ID)?.querySelector(sel);
    if (!el) return;
    const icon = el.querySelector('.cc-pm-collapse-fa');
    if (collapsed) {
        icon?.classList.remove('fa-chevron-down');
        icon?.classList.add('fa-chevron-right');
    } else {
        icon?.classList.remove('fa-chevron-right');
        icon?.classList.add('fa-chevron-down');
    }
}

// ---- 匹配计算（数据模型 + DOM 顺序） ----
function entryName(li) {
    // 名称在 li 内部 .completion_prompt_manager_prompt_name[data-pm-name]
    const nameEl = li.querySelector('.completion_prompt_manager_prompt_name');
    if (nameEl?.dataset?.pmName) return nameEl.dataset.pmName;
    return (nameEl?.textContent || '').trim();
}

function entryContent(id) {
    try {
        if (!promptManager || !promptManager.getPromptById) return '';
        const p = promptManager.getPromptById(id);
        // 仅对真实字符串内容搜索；system_prompt/marker 的 content 多是非字符串对象，
        // JSON 序列化会混入键名造成误命中，故跳过其内容搜索（仅按名称匹配）。
        return (p && typeof p.content === 'string') ? p.content : '';
    } catch { return ''; }
}

function computeMatches(listEl) {
    const q = state.query.trim().toLowerCase();
    const list = listEl || getListElement();
    if (!list || !q) return [];
    const results = [];
    const entries = Array.from(list.querySelectorAll('li[data-pm-identifier]'));
    for (const li of entries) {
        const id = li.dataset?.pmIdentifier;
        if (!id) continue;
        const name = entryName(li);
        const nameLow = name.toLowerCase();
        const contentLow = entryContent(id).toLowerCase();
        if (nameLow.includes(q) || contentLow.includes(q)) {
            results.push({ id, el: li, name, matchedInName: nameLow.includes(q) });
        }
    }
    return results;
}

/** 条目集合签名（基于 id 序列），用于判断列表是否真的发生了变化 */
function getEntrySignature(listEl) {
    const list = listEl || getListElement();
    if (!list) return '';
    let sig = '';
    for (const li of list.querySelectorAll('li[data-pm-identifier]')) {
        sig += li.dataset?.pmIdentifier + '|';
    }
    return sig;
}

// ---- 渲染工具条 & 搜索结果 ----
function getToolbar() {
    return document.getElementById(CC_SEARCH_ID);
}

function ensureToolbar(listEl) {
    if (getToolbar()) return;
    if (!listEl || !listEl.parentElement) return;
    const $bar = buildToolbar();
    // 放在「名称」表头行(.completion_prompt_manager_list_head)上方，即列表最顶部
    const head = listEl.querySelector('.completion_prompt_manager_list_head');
    if (head && head.parentElement) {
        head.insertAdjacentElement('beforebegin', $bar[0]);
    } else {
        listEl.insertBefore($bar[0], listEl.firstChild);
    }
    bindToolbarEvents($bar);
    $bar.find('.cc-pm-search-input').val(state.query);
    // 重建后重算计数显示
    const matches = computeMatches(listEl);
    const cur = state.currentId ? matches.findIndex(m => m.id === state.currentId) + 1 : 0;
    const curIdx = state.currentId ? Math.max(cur, 1) : 0;
    $bar.find('.cc-pm-search-count').text(`${curIdx}/${matches.length}`);
    // 仅上一/下一随有无搜索词禁用；回顶/跳底始终可点
    $bar.find('.cc-pm-search-prev, .cc-pm-search-next').prop('disabled', !state.query.trim());
}

function buildToolbar() {
    const $bar = $('<li>', { id: CC_SEARCH_ID, class: 'cc-pm-search-li' });
    $bar.append(`
        <div class="cc-pm-search-row">
            <div class="cc-pm-search-input-wrap">
                <input type="text" class="cc-pm-search-input text_pole" placeholder="搜索条目名 / 内容…" />
                <button type="button" class="cc-pm-search-clear" title="清除搜索"><span class="fa-solid fa-xmark"></span></button>
            </div>
            <span class="cc-pm-search-count">0/0</span>
            <button type="button" class="cc-pm-search-btn menu_button cc-pm-search-prev" title="上一个匹配"><span class="fa-solid fa-arrow-up"></span></button>
            <button type="button" class="cc-pm-search-btn menu_button cc-pm-search-next" title="下一个匹配"><span class="fa-solid fa-arrow-down"></span></button>
            <button type="button" class="cc-pm-search-btn menu_button cc-pm-search-top" title="回顶"><span class="fa-solid fa-angle-double-up"></span></button>
            <button type="button" class="cc-pm-search-btn menu_button cc-pm-search-bottom" title="跳底"><span class="fa-solid fa-angle-double-down"></span></button>
        </div>
        <div class="cc-pm-search-results"></div>
    `);
    return $bar;
}

function bindToolbarEvents($bar) {
    const $input = $bar.find('.cc-pm-search-input');
    const $prev = $bar.find('.cc-pm-search-prev');
    const $next = $bar.find('.cc-pm-search-next');

    $input.on('input', () => {
        state.query = $input.val();
        clearTimeout(inputTimer);
        inputTimer = setTimeout(() => {
            applyQuery();
        }, 150);
    }).on('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            moveCurrent(1);
        } else if (e.key === 'Escape') {
            clearFilter();
        }
    }).on('focus', () => {
        // 聚焦时若有查询，重算并展开下拉（列表可能已重绘）
        if (state.query.trim()) {
            const matches = computeMatches(getListElement());
            renderSearchState(matches);
            getToolbar()?.querySelector('.cc-pm-search-results')?.classList.add('cc-open');
        }
    });

    $prev.on('click', () => moveCurrent(-1));
    $next.on('click', () => moveCurrent(1));
    // 回顶 / 跳底（搜索栏常驻，直接滚动列表所在容器）
    $bar.find('.cc-pm-search-top').on('click', () => scrollContainer('top'));
    $bar.find('.cc-pm-search-bottom').on('click', () => scrollContainer('bottom'));
    // 清除按钮：清空搜索词并复位高亮/下拉
    $bar.find('.cc-pm-search-clear').on('click', () => clearFilter());

    // 下拉候选：事件委托
    $bar.find('.cc-pm-search-results').on('click', (e) => {
        const item = e.target.closest('.cc-pm-search-result-item');
        if (!item) return;
        const id = item.dataset.pmId;
        if (!id) return;
        state.currentId = id;
        const matches = computeMatches(getListElement());
        renderSearchState(matches);
        jumpToCurrent();
    });
}

function applyQuery() {
    const matches = computeMatches(getListElement());
    state.currentId = null;
    renderSearchState(matches);
    lastSignature = getEntrySignature(getListElement());
}

function clearFilter() {
    state.query = '';
    state.currentId = null;
    lastSignature = '';
    const toolbar = getToolbar();
    if (!toolbar) return;
    toolbar.querySelector('.cc-pm-search-input').value = '';
    toolbar.querySelector('.cc-pm-search-results').classList.remove('cc-open');
    renderSearchState([]);
}

function renderSearchState(matches) {
    const toolbar = getToolbar();
    if (!toolbar) return;
    const $results = $(toolbar).find('.cc-pm-search-results');
    // 移除旧高亮
    document.querySelectorAll(`li.${CC_HIT_CLASS}, li.${CC_CUR_CLASS}`).forEach(li => {
        li.classList.remove(CC_HIT_CLASS, CC_CUR_CLASS);
    });

    if (!state.query.trim()) {
        $results.html('').removeClass('cc-open');
        $(toolbar).find('.cc-pm-search-count').text('0/0');
        // 回顶/跳底保持可点；仅上一/下一禁用
        $(toolbar).find('.cc-pm-search-prev, .cc-pm-search-next').prop('disabled', true);
        return;
    }

    // 命中高亮
    for (const m of matches) m.el.classList.add(CC_HIT_CLASS);
    // 确定当前项
    let curIdx = -1;
    if (state.currentId) curIdx = matches.findIndex(m => m.id === state.currentId);
    if (curIdx < 0 && matches.length) {
        curIdx = 0;
        state.currentId = matches[curIdx].id;
    }
    if (curIdx >= 0) matches[curIdx].el.classList.add(CC_CUR_CLASS);

    // 计数
    const shownIdx = curIdx >= 0 ? curIdx + 1 : 0;
    $(toolbar).find('.cc-pm-search-count').text(`${shownIdx}/${matches.length}`);
    $(toolbar).find('.cc-pm-search-prev, .cc-pm-search-next').prop('disabled', matches.length === 0);

    // 下拉候选（仅名称入列，附带命中位置徽标）
    const items = matches.map(m => {
        const loc = m.matchedInName ? '名称' : '内容';
        return `<div class="cc-pm-search-result-item" data-pm-id="${escapeHtml(m.id)}">
            <span class="cc-pm-hit-badge">${loc}</span>
            <span>${escapeHtml(m.name) || '(未命名)'}</span>
        </div>`;
    });
    $results.html(items.length ? items.join('') : '<div class="cc-pm-search-result-item">无匹配</div>');
    $results.toggleClass('cc-open', matches.length > 0);
}

function moveCurrent(step) {
    const matches = computeMatches(getListElement());
    if (!matches.length) return;
    let idx = matches.findIndex(m => m.id === state.currentId);
    if (idx < 0) idx = step > 0 ? -1 : 0;
    idx = (idx + step + matches.length) % matches.length;
    state.currentId = matches[idx].id;
    renderSearchState(matches);
    jumpToCurrent();
}

function jumpToCurrent() {
    const matches = computeMatches(getListElement());
    const cur = matches.find(m => m.id === state.currentId);
    if (cur?.el?.scrollIntoView) {
        // 跳转后让条目尽量位于视图中间，方便继续浏览/操作
        cur.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// 顶 / 底：滚动定位到列表本身（列表已是独立溢出滚动容器）
function getScrollContainer() {
    const listEl = getListElement();
    if (!listEl) return document.scrollingElement || document.documentElement;
    if (listEl.scrollHeight > listEl.clientHeight) {
        const s = getComputedStyle(listEl);
        if (s.overflowY === 'auto' || s.overflowY === 'scroll') return listEl;
    }
    // 兜底：向上找最近可滚动祖先
    let el = listEl.parentElement;
    while (el && el !== document.documentElement) {
        const style = getComputedStyle(el);
        const oy = style.overflowY;
        const ox = style.overflow;
        if ((oy === 'auto' || oy === 'scroll' || ox === 'auto' || ox === 'scroll') && el.scrollHeight > el.clientHeight) {
            return el;
        }
        el = el.parentElement;
    }
    return listEl;
}

function scrollContainer(where) {
    const el = getScrollContainer();
    if (!el) return;
    el.scrollTo({ top: where === 'top' ? 0 : el.scrollHeight, behavior: 'smooth' });
}

// ---- 样式 ----
function ensureStyles() {
    if (document.getElementById(CC_STYLE_ID)) return;
    $('<style>', { id: CC_STYLE_ID }).text(STYLES).appendTo('head');
}

// ---- UI 生命周期 ----
export function initPromptEntrySearchUI() {
    ensureStyles();
    heartbeatTimer = setInterval(onTick, 500);
    onTick();
    debugLog('[PM-SEARCH] 预设条目搜索定位控件已初始化');
}

export function removePromptEntrySearchUI() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    detachListObservers();
    if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; }
    if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; }
    state.query = '';
    state.currentId = null;
    state.genCollapsed = true;
    state.openaiCollapsed = true;
    lastSignature = '';
    $(`#${CC_SEARCH_ID}`).remove();
    $(`#${CC_COLLAPSE_ROW_ID}`).remove();
    $(`#${CC_STYLE_ID}`).remove();
    // 还原折叠态 class，恢复显示
    const wrap = getOpenAISettings();
    if (wrap) wrap.classList.remove(CC_COLLAPSED);
    const rangeBlock = document.getElementById('range_block_openai');
    if (rangeBlock) rangeBlock.classList.remove(CC_COLLAPSED);
    document.querySelectorAll(`li.${CC_HIT_CLASS}, li.${CC_CUR_CLASS}`).forEach(li => {
        li.classList.remove(CC_HIT_CLASS, CC_CUR_CLASS);
    });
    listPresent = false;
}

// ---- 编排层（配置门控，与 promptBinding 同构） ----
let applied = false;

export function initPromptEntrySearch() {
    if (configManager.getStFeatureEnhanceConfig().promptEntrySearch?.enabled === false) return;
    if (applied) return;
    applied = true;
    try {
        initPromptEntrySearchUI();
    } catch (e) {
        errorLog('[PM-SEARCH] 初始化预设条目搜索定位失败', e);
    }
}

export function removePromptEntrySearch() {
    if (!applied) return;
    applied = false;
    try {
        removePromptEntrySearchUI();
    } catch (e) {
        errorLog('[PM-SEARCH] 移除预设条目搜索定位失败', e);
    }
}