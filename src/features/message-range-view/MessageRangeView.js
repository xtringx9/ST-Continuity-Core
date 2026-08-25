// src/features/message-range-view/MessageRangeView.js
// 消息区间视图 - 在 ST 扩展菜单 (#extensionsMenu) 提供单一入口「显示/隐藏范围」：
//   弹窗内选择「显示范围 / 隐藏范围」+ 起始/结束楼层，对聊天视口做纯前端裁剪；
//   弹窗同时含「恢复默认」。核心区间操作见 src/utils/chatRangeView.js（可复用）。
//
// 门控：仅「已进入聊天页」时显示菜单项（isInChatPage()），切聊天时实时刷新。

import { chat, eventSource, event_types } from '../../../../../../../script.js';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../popup.js';
import { translate } from '../../../../../../i18n.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import { isInChatPage } from '../../core/contextBottomUI.js';
import configManager from '../../singleton/configManager.js';
import { applyRangeView, restoreChatView, getRangeViewState, resetRangeView } from '../../utils/chatRangeView.js';

const CONTAINER_ID = 'ccore_range_container';
const MENU_ID = 'ccore_range_view';
const STYLE_ID = 'ccore_range_view_styles';

let chatChangedListener = null;
/** 保持菜单项位于 #extensionsMenu 最底部的观察器 */
let menuObserver = null;

/**
 * 初始化：向 #extensionsMenu 注入菜单项。
 * 就绪安全：若菜单尚未创建（loading_order 竞争），用 MutationObserver 等它出现。
 */
export function initMessageRangeView() {
    // 独立开关：关闭时移除已注入的菜单项并返回
    if (!configManager.getStFeatureEnhanceConfig().messageRangeView) {
        removeMessageRangeView();
        return;
    }

    if (tryAttach()) return;

    const observer = new MutationObserver(() => {
        if (tryAttach()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * 移除注入的菜单容器与 CHAT_CHANGED 监听（关闭开关或禁用插件时调用）。
 */
export function removeMessageRangeView() {
    // 关闭开关/插件时清掉区间状态（还原隐藏、移除反馈浮标）
    resetRangeView();
    if (chatChangedListener) {
        eventSource.removeListener(event_types.CHAT_CHANGED, chatChangedListener);
        chatChangedListener = null;
    }
    if (menuObserver) {
        menuObserver.disconnect();
        menuObserver = null;
    }
    document.getElementById(CONTAINER_ID)?.remove();
}

function tryAttach() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;

    // 防重复注入（扩展重载等场景）：清理旧容器 + 旧监听 + 旧观察器
    if (chatChangedListener) {
        eventSource.removeListener(event_types.CHAT_CHANGED, chatChangedListener);
        chatChangedListener = null;
    }
    if (menuObserver) {
        menuObserver.disconnect();
        menuObserver = null;
    }
    document.getElementById(CONTAINER_ID)?.remove();

    injectStyles();

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.classList.add('extension_container', 'ccore-range-container');

    container.append(
        createMenuItem(
            MENU_ID,
            'fa-window-restore',
            translate('显示/隐藏范围', 'ccore_range_view'),
            openRangeDialog,
        ),
    );

    // 聊天页门控：未进入聊天时隐藏，进入后由 CHAT_CHANGED 显现
    container.style.display = isInChatPage() ? '' : 'none';

    chatChangedListener = () => {
        const el = document.getElementById(CONTAINER_ID);
        if (el) el.style.display = isInChatPage() ? '' : 'none';
    };
    eventSource.on(event_types.CHAT_CHANGED, chatChangedListener);

    menu.appendChild(container);

    // 尽量保持在菜单最底部：若其他扩展后续把容器追加到其后，把本容器挪回末尾
    menuObserver = new MutationObserver(() => {
        if (container.parentElement === menu && menu.lastElementChild !== container) {
            menu.appendChild(container);
        }
    });
    menuObserver.observe(menu, { childList: true });

    debugLog('[MessageRangeView] 菜单项已注入 #extensionsMenu');
    return true;
}

/**
 * 创建一个与 ST 原生扩展菜单项同款样式、但带强调配色的节点。
 */
function createMenuItem(id, iconClass, label, onClick) {
    const item = document.createElement('div');
    item.id = id;
    item.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable', 'ccore-range-item');
    item.tabIndex = 0;

    const icon = document.createElement('div');
    icon.classList.add('fa-solid', iconClass, 'extensionsMenuExtensionButton');

    const span = document.createElement('span');
    span.textContent = label;

    item.append(icon, span);
    item.addEventListener('click', onClick);
    return item;
}

/**
 * 注入一次性样式：用强调色（--SmartThemeEmColor）给容器加左侧色条 + 轻微底色。
 */
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        #${CONTAINER_ID}.ccore-range-container {
            margin: 6px 0;
            padding: 2px 0 2px 8px;
            border-left: 3px solid var(--SmartThemeEmColor, #d9534f);
            background: color-mix(in srgb, var(--SmartThemeEmColor, #d9534f) 8%, transparent);
            border-radius: 0 4px 4px 0;
        }
        #${CONTAINER_ID}.ccore-range-container .ccore-range-item {
            background: color-mix(in srgb, var(--SmartThemeEmColor, #d9534f) 12%, transparent);
            border: 1px solid color-mix(in srgb, var(--SmartThemeEmColor, #d9534f) 35%, transparent);
            border-radius: 4px;
            padding: 4px 6px;
            margin: 2px 0;
            transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }
        #${CONTAINER_ID}.ccore-range-container .ccore-range-item .extensionsMenuExtensionButton {
            color: var(--SmartThemeEmColor, #d9534f);
            transition: color 0.15s ease;
        }
        #${CONTAINER_ID}.ccore-range-container .ccore-range-item:hover {
            background: var(--SmartThemeEmColor, #d9534f);
            color: #fff;
        }
        #${CONTAINER_ID}.ccore-range-container .ccore-range-item:hover .extensionsMenuExtensionButton {
            color: #fff;
        }
    `;
    document.head.appendChild(style);
}

/**
 * 打开区间操作弹窗：模式（显示/隐藏）+ 起始/结束楼层 + 恢复默认。
 */
async function openRangeDialog() {
    try {
        if (!Array.isArray(chat) || chat.length === 0) {
            toastr.warning(translate('当前没有聊天消息', 'ccore_range_no_chat'));
            return;
        }

        const maxId = chat.length - 1;
        const current = getRangeViewState();
        // 无活动区间时的默认范围：最近 50 层，避免默认 0..maxId 误点导致全量重建/全隐藏
        const DEFAULT_RANGE_SIZE = 50;
        const defaultStart = Math.max(0, maxId - (DEFAULT_RANGE_SIZE - 1));

        const row = (html) => `<div style="display:flex;align-items:center;gap:8px;width:100%;">${html}</div>`;
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
        wrapper.innerHTML =
            row(`<span style="font-size:0.9em;color:var(--SmartThemeEmColor);">${translate('仅影响显示，不改聊天数据与上下文', 'ccore_range_desc')}</span>`) +
            `<div style="display:flex;gap:14px;font-size:0.95em;">
                <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
                    <input type="radio" name="ccore_range_mode" value="show" ${current?.mode !== 'hide' ? 'checked' : ''} />
                    <span>${translate('显示范围', 'ccore_range_mode_show')}</span>
                </label>
                <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
                    <input type="radio" name="ccore_range_mode" value="hide" ${current?.mode === 'hide' ? 'checked' : ''} />
                    <span>${translate('隐藏范围', 'ccore_range_mode_hide')}</span>
                </label>
            </div>` +
            row(
                `<label style="min-width:64px;">${translate('起始楼层', 'ccore_range_start')}</label>` +
                `<input id="ccore_range_start" type="number" class="text_pole" min="0" max="${maxId}" style="flex:1;min-width:0;" value="${current?.start ?? defaultStart}" />` +
                `<label style="min-width:64px;margin-left:8px;">${translate('结束楼层', 'ccore_range_end')}</label>` +
                `<input id="ccore_range_end" type="number" class="text_pole" min="0" max="${maxId}" style="flex:1;min-width:0;" value="${current?.end ?? maxId}" />`,
            ) +
            (current
                ? `<div style="font-size:0.85em;opacity:0.8;">${translate('当前已应用：', 'ccore_range_current')}${current.mode === 'show' ? translate('查看', 'ccore_range_feedback_view') : translate('隐藏', 'ccore_range_feedback_hide')} ${current.start}-${current.end}</div>`
                : '');

        const result = await callGenericPopup(wrapper, POPUP_TYPE.TEXT, '', {
            okButton: translate('应用', 'ccore_range_apply'),
            cancelButton: translate('取消', 'ccore_range_cancel'),
            customButtons: [{ text: translate('恢复默认', 'ccore_range_restore'), result: POPUP_RESULT.CUSTOM1 }],
        });

        // 弹窗内「恢复默认」：还原全量视图
        if (result === POPUP_RESULT.CUSTOM1) {
            restoreChatView();
            return;
        }
        // 取消/关闭：静默返回
        if (!result || result === POPUP_RESULT.CANCELLED) {
            return;
        }

        const start = Number(wrapper.querySelector('#ccore_range_start')?.value);
        const end = Number(wrapper.querySelector('#ccore_range_end')?.value);
        const mode = String(wrapper.querySelector('input[name="ccore_range_mode"]:checked')?.value || 'show');

        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > maxId) {
            toastr.error(translate('未填入有效区间', 'ccore_range_invalid'));
            return;
        }

        // 全量守卫：区间等于全部消息时无操作意义（显示=全量重建白费；隐藏=整聊天消失），直接拦截
        if (start === 0 && end === maxId) {
            toastr.info(translate('该区间等于全部消息，无需操作', 'ccore_range_noop'));
            return;
        }

        await applyRangeView(mode, start, end);
    } catch (error) {
        errorLog('[MessageRangeView] 应用区间失败:', error);
    }
}
