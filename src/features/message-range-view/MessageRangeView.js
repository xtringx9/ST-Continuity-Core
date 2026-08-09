// 消息区间视图 - 在 SillyTavern 扩展菜单 (#extensionsMenu) 中提供两个入口：
//   1. 显示区间消息：弹窗输入区间（支持 "n-r" 或单楼层 "n"），清空 #chat 后仅重渲该区间
//   2. 恢复默认消息：reloadCurrentChat() 重载当前聊天，还原完整视图
//
// 门控：参考 EntryButton 的做法，这两个入口仅在「已进入聊天页」时显示
//   （isInChatPage()），未进入聊天时隐藏，进入聊天后通过 CHAT_CHANGED 实时显现。
//
// 实现说明（rebuild 式，复用 ST 的聊天重建机制）：
// - ST 在 public/script.js 的 printMessages() 里重建整段聊天时，正是逐条
//   addOneMessage(item, { scroll:false, forceId:i, showSwipes:false })；
//   本扩展按 forceId 只重渲区间，是同一套底层机制的子集。
// - 与 printMessages 不同，我们对每条手动 emit USER/CHARACTER_MESSAGE_RENDERED，
//   以便本扩展挂在渲染事件上的 UI（消息内 Cc 按钮、contextBottomUI 等）重新挂载。
//   （printMessages 本身不 emit 这些事件，依赖后续流程；这里需显式补发。）
//
// 已知边界（按设计接受，不做特殊处理）：
// - 区间视图只是前端 DOM 裁剪，不影响 chat 数据，也不影响实际发给模型的上下文。
// - 区间视图下继续生成，新消息会 append 到 DOM 末尾（超出区间），视图变成"区间 + 最新一条"。
// - "恢复默认消息" 通过 reloadCurrentChat() 整体还原，无残留状态。

import {
    chat,
    addOneMessage,
    eventSource,
    event_types,
    scrollChatToBottom,
    reloadCurrentChat,
} from '../../../../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../../popup.js';
import { translate } from '../../../../../../i18n.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import { isInChatPage } from '../../core/contextBottomUI.js';
import configManager from '../../singleton/configManager.js';

const CONTAINER_ID = 'ccore_range_container';
const MENU_VIEW_ID = 'ccore_range_view';
const MENU_RESTORE_ID = 'ccore_range_restore';
const STYLE_ID = 'ccore_range_view_styles';

// 模块级引用：进入/离开聊天页时实时切换容器显隐，避免重复注册监听
let chatChangedListener = null;

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
    if (chatChangedListener) {
        eventSource.removeListener(event_types.CHAT_CHANGED, chatChangedListener);
        chatChangedListener = null;
    }
    document.getElementById(CONTAINER_ID)?.remove();
}

function tryAttach() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;

    // 防重复注入（扩展重载等场景）：清理旧容器 + 旧监听
    if (chatChangedListener) {
        eventSource.removeListener(event_types.CHAT_CHANGED, chatChangedListener);
        chatChangedListener = null;
    }
    document.getElementById(CONTAINER_ID)?.remove();

    injectStyles();

    const container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.classList.add('extension_container', 'ccore-range-container');

    container.append(
        createMenuItem(
            MENU_VIEW_ID,
            'fa-window-restore',
            translate('显示区间消息', 'ccore_range_view'),
            showRangeView,
        ),
        createMenuItem(
            MENU_RESTORE_ID,
            'fa-rotate-left',
            translate('恢复默认消息', 'ccore_range_restore'),
            () => reloadCurrentChat(),
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
    debugLog('[MessageRangeView] 菜单项已注入 #extensionsMenu');
    return true;
}

/**
 * 创建一个与 ST 原生扩展菜单项同款样式、但带强调配色的节点。
 * 复用 ST 自带类：.list-group-item / .extensionsMenuExtensionButton（图标）。
 * 通过 .ccore-range-item 类叠加独立高亮样式，从原生菜单项中凸显出来。
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
 * 注入一次性样式：用强调色（--SmartThemeEmColor）给容器加左侧色条 + 轻微底色，
 * 菜单项 hover 时整条高亮，使其从原生 #extensionsMenu 项中脱颖而出。
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
 * 弹窗获取区间并重渲。
 * 输入兼容两种格式：
 *   - "n-r"：显示第 n 到 r 楼
 *   - "n"  ：单楼层，等价于 n-n
 */
async function showRangeView() {
    try {
        if (!Array.isArray(chat) || chat.length === 0) {
            toastr.warning(translate('当前没有聊天消息', 'ccore_range_no_chat'));
            return;
        }

        const maxId = chat.length - 1;
        const promptText = translate('请输入显示区间 (格式: 0-10 或单楼层 5, 范围: 0-{max})', 'ccore_range_prompt')
            .replace('{max}', String(maxId));

        const input = await callGenericPopup(promptText, POPUP_TYPE.INPUT, '');
        // 取消/关闭弹窗：静默返回，不报错
        if (input === null || input === undefined || input === false || String(input).trim() === '') {
            return;
        }

        const text = String(input).trim();
        let start;
        let end;
        if (text.includes('-')) {
            [start, end] = text.split('-').map((s) => Number(s.trim()));
        } else {
            start = end = Number(text);
        }

        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > maxId) {
            toastr.error(translate('未填入有效区间', 'ccore_range_invalid'));
            return;
        }

        // rebuild：清空 #chat，仅重渲区间消息（复用 ST printMessages 的逐条 addOneMessage 重建方式）
        $('#chat').children().remove();
        for (let i = start; i <= end; i++) {
            addOneMessage(chat[i], { scroll: false, forceId: i, showSwipes: true });
            await eventSource.emit(
                chat[i].is_user ? event_types.USER_MESSAGE_RENDERED : event_types.CHARACTER_MESSAGE_RENDERED,
                i,
            );
        }
        scrollChatToBottom();
        debugLog(`[MessageRangeView] 已显示区间 ${start}-${end}`);
    } catch (error) {
        errorLog('[MessageRangeView] 显示区间失败:', error);
    }
}
