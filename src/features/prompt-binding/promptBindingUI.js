// 提示词预设条目·聊天绑定 UI 注入层
// 在 PromptManager 列表中每个提示词条目（li[data-pm-identifier]）的 .prompt_manager_prompt_controls
// 注入「绑定当前聊天」下拉框（与 ST 世界书条目绑定同款三态控件）
// 三态：inherit（继承）/ on（本聊开）/ off（本聊关），切换即应用

import { promptManager } from '../../../../../../openai.js';
import { eventSource, event_types } from '../../../../../../../script.js';
import { getPromptBinding, setPromptBinding, applyBindingsToPromptManager, WB_BIND_MODE } from './promptBindingState.js';
import { isInChatPage } from '../../core/contextBottomUI.js';
import { debugLog, errorLog } from '../../utils/logger.js';

// 控件样式（注入到页面 <style> 一次）
const CC_PM_BIND_STYLES = `
.cc-pm-bind {
    margin-left: 0;
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
}
.cc-pm-bind-toggle {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    color: var(--SmartThemeDimColor, #8a8a8a);
    transition: color 0.15s ease;
}
.cc-pm-bind-toggle:hover {
    color: var(--SmartThemeQuoteColor, #6cf);
}
.cc-pm-bind-toggle[data-mode="on"] {
    color: var(--SmartThemeEmColor, #4caf50);
}
.cc-pm-bind-toggle[data-mode="on"]:hover {
    color: var(--SmartThemeEmColor, #4caf50);
}
.cc-pm-bind-toggle[data-mode="off"] {
    color: var(--SmartThemeBodyColor, #f04747);
}
.cc-pm-bind-toggle[data-mode="off"]:hover {
    color: var(--SmartThemeBodyColor, #f04747);
}
.cc-pm-bind-toggle[data-mode="inherit"] {
    color: var(--SmartThemeDimColor, #8a8a8a);
}
.cc-pm-bind-toggle[data-mode="inherit"]:hover {
    color: var(--SmartThemeQuoteColor, #6cf);
}
.cc-pm-bind-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    display: none;
    flex-direction: row;
    gap: 4px;
    background: var(--SmartThemeBlurTintColor, #1a1a1a);
    border: 1px solid var(--SmartThemeQuoteColor, #444);
    border-radius: 6px;
    padding: 4px;
    z-index: 2147483647;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.cc-pm-bind-menu.open {
    display: flex;
}
.cc-pm-bind-menu button {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--SmartThemeDimColor, #8a8a8a);
    padding: 2px 4px;
    border-radius: 4px;
}
.cc-pm-bind-menu button:hover {
    color: var(--SmartThemeQuoteColor, #6cf);
    background: rgba(255,255,255,0.06);
}
.cc-pm-bind-menu button.cc-pm-active {
    color: var(--SmartThemeEmColor, #6cf);
}
.prompt_manager_prompt.cc-pm-entry-open {
    position: relative;
    z-index: 2147483647;
}
`;

const WB_BIND_FA = {
    [WB_BIND_MODE.INHERIT]: 'fa-rotate-left',
    [WB_BIND_MODE.ON]: 'fa-comment',
    [WB_BIND_MODE.OFF]: 'fa-comment-slash',
};

const WB_BIND_MENU = [
    { mode: WB_BIND_MODE.INHERIT, fa: 'fa-rotate-left', tip: '继承（随角色/预设原值）' },
    { mode: WB_BIND_MODE.ON, fa: 'fa-comment', tip: '本聊开（仅当前聊天启用）' },
    { mode: WB_BIND_MODE.OFF, fa: 'fa-comment-slash', tip: '本聊关（仅当前聊天禁用）' },
];

let listObserver = null;     // 监听列表子树：条目增删/重渲染（即时响应）
let parentObserver = null;   // 监听列表父节点 childList：列表自身被移除时触发 rediscovery
let heartbeatTimer = null;   // 轻量心跳：每 500ms 重新评估「列表存在 + 是否聊天页」，替代整页 subtree 监听
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
    applyBindingsToPromptManager(false);
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
    $('.cc-pm-bind').remove();
    $('.prompt_manager_prompt.cc-pm-entry-open').removeClass('cc-pm-entry-open');
}

function getListElement() {
    if (!promptManager) return null;
    const prefix = promptManager.configuration?.prefix || '';
    return document.getElementById(`${prefix}prompt_manager_list`);
}

function getEntries() {
    const $list = $(getListElement());
    if (!$list || !$list.length) return $();
    return $list.find('li[data-pm-identifier]');
}

function injectControlIntoEntry($entry) {
    if ($entry.find('.cc-pm-bind').length) return false;
    const identifier = $entry.attr('data-pm-identifier');
    if (!identifier) return false;

    const $toggle = $('<button>')
        .addClass('cc-pm-bind-toggle fa-solid ' + WB_BIND_FA[WB_BIND_MODE.INHERIT])
        .attr('type', 'button')
        .attr('title', '绑定当前聊天');

    const $menu = $('<div>').addClass('cc-pm-bind-menu');
    WB_BIND_MENU.forEach(item => {
        $('<button>')
            .addClass('fa-solid ' + item.fa)
            .attr('type', 'button')
            .attr('title', item.tip)
            .attr('data-mode', item.mode)
            .appendTo($menu);
    });

    const $control = $('<div>').addClass('cc-pm-bind').append($toggle).append($menu);
    const $controls = $entry.find('.prompt_manager_prompt_controls');
    if ($controls.length) {
        $controls.append($control);
    } else {
        $entry.append($control);
    }

    refreshEntryControl($entry, identifier);

    $toggle.on('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = $menu.hasClass('open');
        closeAllMenus();
        if (!isOpen) {
            $menu.addClass('open');
            $entry.addClass('cc-pm-entry-open');
        }
    });

    $menu.find('button').on('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mode = $(e.currentTarget).attr('data-mode');
        closeAllMenus();
        try {
            await setPromptBinding(identifier, mode);
            await applyBindingsToPromptManager(true);
        } catch (err) {
            errorLog('[PM-BIND] 设置预设条目绑定失败', err);
        }
        // 重渲染后由 observer 重新注入控件并刷新状态，这里无需手动刷新
    });

    return true;
}

function refreshEntryControl($entry, identifier) {
    const mode = getPromptBinding(identifier);
    const $toggle = $entry.find('.cc-pm-bind-toggle');
    $toggle
        .removeClass('fa-rotate-left fa-comment fa-comment-slash')
        .addClass('fa-solid ' + WB_BIND_FA[mode])
        .attr('data-mode', mode);
    $entry.find('.cc-pm-bind-menu button').each(function () {
        const $btn = $(this);
        $btn.toggleClass('cc-pm-active', $btn.attr('data-mode') === mode);
    });
}

function closeAllMenus() {
    $('.cc-pm-bind-menu.open').removeClass('open');
    $('.prompt_manager_prompt.cc-pm-entry-open').removeClass('cc-pm-entry-open');
}

function injectAllControls() {
    if (!isInChatPage()) {
        // 离开聊天页时清掉可能残留的控件，避免跨上下文串味（与世界书条目绑定同一逻辑）
        $('.cc-pm-bind').remove();
        $('.prompt_manager_prompt.cc-pm-entry-open').removeClass('cc-pm-entry-open');
        return;
    }
    const $entries = getEntries();
    $entries.each(function () {
        injectControlIntoEntry($(this));
    });
}

export function initPromptBindingUI() {
    if ($('#cc-pm-bind-style').length === 0) {
        $('<style>').attr('id', 'cc-pm-bind-style').text(CC_PM_BIND_STYLES).appendTo('head');
    }

    document.removeEventListener('click', injectControlIntoEntry._closeMenu, true);
    injectControlIntoEntry._closeMenu = function (e) {
        if (!$(e.target).closest('.cc-pm-bind').length) {
            closeAllMenus();
        }
    };
    document.addEventListener('click', injectControlIntoEntry._closeMenu, true);

    // 聊天切换时刷新控件（列表可能随聊天上下文重建 / 离开聊天页需清理）。
    // 注意：跨聊天的绑定还原由 promptBinding.js 的 CHAT_CHANGED 处理，此处只刷新 UI，不重复 apply。
    eventSource.on(event_types.CHAT_CHANGED, onTick);

    // 轻量心跳：每 500ms 重新评估「列表存在 + 是否聊天页」。不监听整页 subtree，
    // 「进入聊天页」(isInChatPage false→true) 既非列表 DOM 变动、也未必发 CHAT_CHANGED，
    // 必须靠心跳兜底，否则控件不会被重新注入。
    heartbeatTimer = setInterval(onTick, 500);
    onTick();
    debugLog('[PM-BIND] 预设条目绑定控件已初始化');
}

export function removePromptBindingUI() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    detachListObservers();
    if (throttleTimer) { clearTimeout(throttleTimer); throttleTimer = null; }
    eventSource.removeListener(event_types.CHAT_CHANGED, onTick);
    document.removeEventListener('click', injectControlIntoEntry._closeMenu, true);
    closeAllMenus();
    cleanupStrayControls();
    listPresent = false;
}
