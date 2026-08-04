// 世界书条目·聊天绑定 UI 注入层
// 在 ST 原生世界书编辑器每个条目的 header（.inline-drawer-header）注入「绑定当前聊天」下拉框
// 三态：inherit（继承）/ on（本聊开）/ off（本聊关），切换即应用

import {
    selected_world_info,
    world_info,
    world_names,
} from '../../../../../../world-info.js';
import { getBinding, setBinding, applyBindingsToWorldInfo, WB_BIND_MODE } from './worldBookBindingState.js';
import { isInChatPage } from '../../core/contextBottomUI.js';
import { debugLog, errorLog } from '../../utils/logger.js';

// 控件根元素 class（用于幂等判断）
const CC_WB_BIND_CLASS = 'cc-wb-bind';

// 三态图标按钮样式（注入一次）
// 用 ST 自带 Font Awesome 图标（fa-solid），收起态无背景/无边框，仅图标；
// hover 变色，data-mode 驱动：inherit 默认色 / on 绿 / off 红。
const CC_WB_BIND_STYLES = `
.${CC_WB_BIND_CLASS} {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    margin-left: 0;
    vertical-align: middle;
    line-height: normal;
    position: relative;
}
/* 收起态：纯图标按钮，无背景无边框 */
.${CC_WB_BIND_CLASS} .cc-wb-bind-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6em;
    height: 1.6em;
    font-size: 1em;
    line-height: 1;
    /* 继承=默认态：用 ST 次要/变暗色，与 ST 其它未激活图标一致，不抢眼 */
    color: var(--SmartThemeDimColor, #8a8a8a);
    background: transparent;
    border: none;
    cursor: pointer;
    vertical-align: middle;
    transition: color .12s ease;
}
.${CC_WB_BIND_CLASS} .cc-wb-bind-toggle:hover { color: var(--SmartThemeQuoteColor, #6cf); }
.${CC_WB_BIND_CLASS} .cc-wb-bind-toggle[data-mode="on"] { color: var(--SmartThemeSuccessColor, #5c5); }
.${CC_WB_BIND_CLASS} .cc-wb-bind-toggle[data-mode="on"]:hover { color: var(--SmartThemeSuccessColor, #5c5); filter: brightness(1.2); }
.${CC_WB_BIND_CLASS} .cc-wb-bind-toggle[data-mode="off"] { color: var(--SmartThemeDangerColor, #f88); }
.${CC_WB_BIND_CLASS} .cc-wb-bind-toggle[data-mode="off"]:hover { color: var(--SmartThemeDangerColor, #f88); filter: brightness(1.2); }
/* 展开的下拉菜单：纯图标项，无背景干扰，hover 高亮 */
.${CC_WB_BIND_CLASS} .cc-wb-bind-menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 1000;
    display: none;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    margin-top: 2px;
    border: 1px solid var(--SmartThemeBorderColor, #555);
    border-radius: 6px;
    background: var(--SmartThemeBlurTintColor, #2a2a2a);
    box-shadow: 0 4px 12px rgba(0,0,0,.4);
}
.${CC_WB_BIND_CLASS}.open .cc-wb-bind-menu { display: flex; }
/* 打开时抬高当前 .world_entry 的层叠层级，避免下拉菜单被相邻条目（DOM 后续兄弟）盖住 */
.${CC_WB_BIND_CLASS} .cc-wb-bind-menu { z-index: 2147483647; }
.world_entry.cc-wb-entry-open { position: relative; z-index: 2147483647; }
.${CC_WB_BIND_CLASS} .cc-wb-bind-menu button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.8em;
    height: 1.8em;
    font-size: 1em;
    line-height: 1;
    color: var(--SmartThemeBodyColor, #eee);
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: color .12s ease, background .12s ease;
}
.${CC_WB_BIND_CLASS} .cc-wb-bind-menu button:hover { background: rgba(255,255,255,.08); color: var(--SmartThemeQuoteColor, #6cf); }
.${CC_WB_BIND_CLASS} .cc-wb-bind-menu button[data-mode="on"]:hover { color: var(--SmartThemeSuccessColor, #5c5); }
.${CC_WB_BIND_CLASS} .cc-wb-bind-menu button[data-mode="off"]:hover { color: var(--SmartThemeDangerColor, #f88); }
.${CC_WB_BIND_CLASS} .cc-wb-bind-menu button.cc-wb-active { background: rgba(255,255,255,.12); }
`;

function ensureStyles() {
    if ($('#cc-wb-bind-styles').length) return;
    $('<style>', { id: 'cc-wb-bind-styles' }).text(CC_WB_BIND_STYLES).appendTo('head');
}

/**
 * 取「世界书编辑器当前打开的那本书」的名字。
 * 这是唯一可靠的归属来源：#world_popup_entries_list 一次只渲染这一本书的条目。
 *
 * 💥 坑：不能用 selected_world_info[0] 兜底——那是「全局激活列表」的第一本，
 * 与编辑器当前打开的书通常不是同一本，会把绑定写到错误的世界书上。
 * @returns {string|null}
 */
function getEditorWorldName() {
    try {
        const $sel = $('#world_editor_select');
        if (!$sel.length) return null;
        const idx = Number($sel.val());
        if (!Number.isInteger(idx) || idx < 0) return null;
        const name = Array.isArray(world_names) ? world_names[idx] : null;
        if (typeof name === 'string' && name) return name;
        // 回退：直接读选中 option 的文本
        const text = String($sel.find(':selected').text() || '').trim();
        return text || null;
    } catch (e) {
        errorLog('[WB-BIND] getEditorWorldName 失败', e);
        return null;
    }
}

/**
 * 根据条目 uid 反查其所属世界书名称。
 * 优先级：编辑器当前打开的书 > selected_world_info 命中 > 全量扫描。
 * @param {string|number} uid
 * @returns {string|null}
 */
function resolveWorldName(uid) {
    const uidStr = String(uid);

    // 最高优先级：编辑器当前打开的书（条目列表就是它渲染出来的，必然属于它）
    const editorName = getEditorWorldName();
    if (editorName) return editorName;

    // 次选：selected_world_info 中按 uid 命中
    if (Array.isArray(selected_world_info)) {
        for (const name of selected_world_info) {
            if (typeof name !== 'string') continue;
            const g = world_info?.[name];
            if (g?.entries && g.entries[uidStr]) return name;
            const cl = world_info?.charLore;
            if (Array.isArray(cl)) {
                for (const book of cl) {
                    if (book?.name === name && book.entries && book.entries[uidStr]) return name;
                }
            }
        }
    }

    // 回退：遍历 world_info 全部全局世界书
    if (world_info && typeof world_info === 'object') {
        for (const [name, book] of Object.entries(world_info)) {
            if (name === 'charLore') continue;
            if (book?.entries && book.entries[uidStr]) return name;
        }
    }

    // 不做 selected_world_info[0] 兜底：那是全局激活列表首项，
    // 与编辑器打开的书无关，猜错会把绑定写进错误的世界书。
    return null;
}

// 三态对应的 ST 自带 Font Awesome 图标（fa-solid）
const WB_BIND_FA = {
    [WB_BIND_MODE.INHERIT]: 'fa-rotate-left',
    [WB_BIND_MODE.ON]: 'fa-comment',
    [WB_BIND_MODE.OFF]: 'fa-comment-slash',
};
const WB_BIND_MENU = [
    { mode: WB_BIND_MODE.INHERIT, fa: 'fa-rotate-left', tip: '继承（随世界书总开关）' },
    { mode: WB_BIND_MODE.ON, fa: 'fa-comment', tip: '本聊开（仅当前聊天启用）' },
    { mode: WB_BIND_MODE.OFF, fa: 'fa-comment-slash', tip: '本聊关（仅当前聊天禁用）' },
];

/**
 * 为单个世界书条目 header 注入绑定图标按钮（幂等）
 * 收起态：纯 fa 图标（无背景/边框）；点击展开纯图标下拉菜单。
 * @param {jQuery} $entry 列表项 .world_entry 的 jQuery 对象
 */
function injectControlIntoEntry($entry) {
    try {
        const uid = $entry.attr('uid');
        if (!uid) return;
        // .inline-drawer-header 是 .world_entry 的后代，不是直接子节点，用 find()
        const $header = $entry.find('.inline-drawer-header').first();
        if (!$header.length) return;

        // 幂等：已注入则跳过
        if ($header.find(`.${CC_WB_BIND_CLASS}`).length) return;

        // ST 世界书条目的 killSwitch / stateSelector 是 name 属性，不是 class
        const $kill = $header.find('[name="entryKillSwitch"]').first();
        const anchor = $kill.length ? $kill : $header.find('[name="entryStateSelector"], .fa-comment-dots').first();

        const $wrap = $('<div>', {
            class: `alignTop ${CC_WB_BIND_CLASS}`,
            title: '绑定当前聊天：↺ 继承 / 💬 本聊开 / 🚫 本聊关',
        });

        // 收起态：图标按钮（无背景无边框）
        const $toggle = $('<button>', {
            type: 'button',
            class: 'cc-wb-bind-toggle fa-solid ' + WB_BIND_FA[WB_BIND_MODE.INHERIT],
        });

        // 展开态：纯图标下拉菜单
        const $menu = $('<div>', { class: 'cc-wb-bind-menu' });
        for (const item of WB_BIND_MENU) {
            const $btn = $('<button>', {
                type: 'button',
                class: `fa-solid ${item.fa}`,
                title: item.tip,
                'data-mode': item.mode,
            });
            $btn.on('click', async (e) => {
                e.stopPropagation();
                const worldName = resolveWorldName(uid);
                if (!worldName) {
                    errorLog('[WB-BIND] 无法确定条目所属世界书', uid);
                    $wrap.removeClass('open');
                    $entry.removeClass('cc-wb-entry-open');
                    return;
                }
                setBinding(worldName, uid, item.mode);
                // 必须 await：applyBindingsToWorldInfo 内部要 await loadWorldInfo
                await applyBindingsToWorldInfo(true);
                refreshEntryControl($entry);
                $wrap.removeClass('open');
                $entry.removeClass('cc-wb-entry-open');
            });
            $menu.append($btn);
        }

        $toggle.on('click', (e) => {
            e.stopPropagation();
            const willOpen = !$wrap.hasClass('open');
            // 关闭其它已展开的菜单（同屏多个条目）+ 还原其条目层级
            $(`.${CC_WB_BIND_CLASS}.open`).not($wrap)
                .removeClass('open')
                .closest('.world_entry').removeClass('cc-wb-entry-open');
            $wrap.toggleClass('open', willOpen);
            // 抬高当前条目层级，避免菜单被相邻条目盖住
            $entry.toggleClass('cc-wb-entry-open', willOpen);
        });

        $wrap.append($toggle).append($menu);

        // 全局点击关闭菜单（具名函数，便于精确解绑）
        if (!injectControlIntoEntry._globalBound) {
            injectControlIntoEntry._closeMenu = () => {
                $(`.${CC_WB_BIND_CLASS}.open`)
                    .removeClass('open')
                    .closest('.world_entry').removeClass('cc-wb-entry-open');
            };
            injectControlIntoEntry._globalBound = true;
            $(document).on('click', injectControlIntoEntry._closeMenu);
        }

        if (anchor.length) {
            $wrap.insertAfter(anchor);
        } else {
            $header.append($wrap);
        }

        refreshEntryControl($entry);
    } catch (e) {
        errorLog('[WB-BIND] injectControlIntoEntry 失败', e);
    }
}

/**
 * 刷新单个条目的图标按钮选中态（图标 + data-mode 配色 + 菜单高亮项）
 * @param {jQuery} $entry
 */
function refreshEntryControl($entry) {
    try {
        const uid = $entry.attr('uid');
        if (!uid) return;
        const worldName = resolveWorldName(uid);
        if (!worldName) return;
        const mode = getBinding(worldName, uid);
        const $wrap = $entry.find(`.${CC_WB_BIND_CLASS}`).first();
        if (!$wrap.length) return;
        // 收起态图标
        const $toggle = $wrap.find('.cc-wb-bind-toggle').first();
        $toggle.removeClass('fa-rotate-left fa-comment fa-comment-slash').addClass('fa-solid ' + WB_BIND_FA[mode]);
        $toggle.attr('data-mode', mode);
        // 菜单高亮当前项
        $wrap.find('.cc-wb-bind-menu button').each(function () {
            const $b = $(this);
            $b.toggleClass('cc-wb-active', $b.attr('data-mode') === mode);
        });
    } catch (e) {
        errorLog('[WB-BIND] refreshEntryControl 失败', e);
    }
}

/**
 * 扫描列表，为所有条目注入/刷新控件
 */
let injectedOnceLogged = false;
function injectAllControls() {
    try {
        // 仅聊天页面内显示控件：角色卡/全局设置打开的世界书编辑器不在聊天上下文，
        // 此时绑定无归属（没有"当前聊天"），不应注入。
        if (!isInChatPage()) {
            // 离开聊天页时清掉可能残留的控件，避免跨上下文串味
            $(`.${CC_WB_BIND_CLASS}`).remove();
            $('.world_entry.cc-wb-entry-open').removeClass('cc-wb-entry-open');
            return;
        }
        ensureStyles();
        const list = $('#world_popup_entries_list');
        if (!list.length) return;
        const entries = list.find('.world_entry');
        let count = 0;
        entries.each(function () {
            const before = $(this).find(`.${CC_WB_BIND_CLASS}`).length;
            injectControlIntoEntry($(this));
            if (before === 0 && $(this).find(`.${CC_WB_BIND_CLASS}`).length) count++;
        });
        if (count > 0) {
            debugLog(`[WB-BIND] 已注入 ${count} 个绑定控件到世界书条目 header`);
            injectedOnceLogged = true;
        }
    } catch (e) {
        errorLog('[WB-BIND] injectAllControls 失败', e);
    }
}

let observer = null;
let bootstrapObserver = null;
let initialized = false;
let bootstrapTimer = null;

let boundListEl = null;
/**
 * 主 observer 绑定：若 #world_popup_entries_list 存在则监听其增删，并立即注入一次。
 * 每次都重绑到当前最新的 list 节点（ST 可能整体替换 list 节点，旧 observer 会失效）。
 * @returns {boolean} 是否成功绑定
 */
function bindMainObserver() {
    const list = document.getElementById('world_popup_entries_list');
    if (!list) return false;
    if (observer) { observer.disconnect(); observer = null; boundListEl = null; }
    observer = new MutationObserver(() => injectAllControls());
    observer.observe(list, { childList: true, subtree: false });
    boundListEl = list;
    debugLog('[WB-BIND] 主 observer 已绑定 #world_popup_entries_list');
    injectAllControls(); // 列表存在，立即注入（幂等）
    return true;
}

/**
 * 启动 UI 注入（监听世界书编辑器列表变化）
 */
export function initWorldBookBindingUI() {
    if (initialized) return;
    initialized = true;

    debugLog('[WB-BIND] 世界书条目·聊天绑定 UI 已初始化');

    // 初次注入（若编辑器已打开）
    if (!bindMainObserver()) {
        debugLog('[WB-BIND] #world_popup_entries_list 尚不存在，等待编辑器打开');
    }

    // 引导 observer：世界书编辑器/列表懒加载，覆盖所有可能的时序
    const tryBind = () => {
        const list = document.getElementById('world_popup_entries_list');
        if (list && observer && boundListEl === list) return;
        if (bindMainObserver()) {
            if (bootstrapObserver && boundListEl === list) {
                bootstrapObserver.disconnect();
                bootstrapObserver = null;
            }
        }
    };
    bootstrapObserver = new MutationObserver(() => {
        if (bootstrapTimer) return;
        bootstrapTimer = setTimeout(() => { bootstrapTimer = null; tryBind(); }, 150);
    });
    bootstrapObserver.observe(document.body, { childList: true, subtree: true });
    // 兜底：即便 body 已稳定，也立即试一次
    tryBind();

    // 世界书设置/数据更新时刷新控件态（切换聊天、保存后）
    import('../../../../../../../script.js').then(({ eventSource, event_types }) => {
        const refresh = () => {
            injectAllControls();
            $('#world_popup_entries_list .world_entry').each(function () {
                refreshEntryControl($(this));
            });
        };
        eventSource.on(event_types.WORLDINFO_UPDATED, refresh);
        eventSource.on(event_types.WORLDINFO_SETTINGS_UPDATED, refresh);
        eventSource.on(event_types.CHAT_CHANGED, refresh);
    });

    debugLog('[WB-BIND] UI 注入已启动');
}

export function removeWorldBookBindingUI() {
    if (observer) { observer.disconnect(); observer = null; }
    if (bootstrapObserver) { bootstrapObserver.disconnect(); bootstrapObserver = null; }
    if (bootstrapTimer) { clearTimeout(bootstrapTimer); bootstrapTimer = null; }
    if (injectControlIntoEntry._globalBound) {
        $(document).off('click', injectControlIntoEntry._closeMenu); // 精确解绑全局关闭监听
        injectControlIntoEntry._globalBound = false;
    }
    $(`.${CC_WB_BIND_CLASS}`).remove();
    $('.world_entry.cc-wb-entry-open').removeClass('cc-wb-entry-open');
    initialized = false;
    injectedOnceLogged = false;
}
