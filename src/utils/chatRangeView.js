// src/utils/chatRangeView.js
// 聊天视口区间操作工具：显示/隐藏指定楼层区间、恢复全量视图。
// 纯前端 DOM 裁剪，不改 chat 数据、不影响发给模型的上下文。
// 独立成单例模块供「消息区间视图」等功能复用；状态与右下角反馈浮标自管理。

import {
    chat,
    addOneMessage,
    eventSource,
    event_types,
    scrollChatToBottom,
    reloadCurrentChat,
} from '../../../../../../script.js';
import { translate } from '../../../../../i18n.js';
import { debugLog } from './logger.js';

const FEEDBACK_ID = 'ccore_range_feedback';
const FEEDBACK_STYLE_ID = 'ccore_range_feedback_styles';

/** 当前视图状态：null（全量）| { mode: 'show'|'hide', start, end } */
let viewState = null;
/** hide 模式下被隐藏的楼层 mesId 集合 */
let hiddenMesIds = new Set();
/** CHAT_CHANGED 监听（切聊天/重载时重置区间状态，单例注册一次） */
let chatChangedListener = null;

export function getRangeViewState() {
    return viewState ? { ...viewState } : null;
}

export function isRangeViewActive() {
    return viewState !== null;
}

/** 重置区间状态（关闭功能/插件时调用）：还原隐藏、清除状态与反馈浮标 */
export function resetRangeView() {
    resetRangeState();
}

/**
 * 应用区间视图。
 * @param {'show'|'hide'} mode show=只显示区间；hide=隐藏区间、显示其余
 * @param {number} start 起始楼层
 * @param {number} end 结束楼层
 */
export async function applyRangeView(mode, start, end) {
    const prev = viewState;
    // 仅当从 show 模式（DOM 只含区间）切到 hide 时，需先重建全量 DOM 再隐藏
    if (prev?.mode === 'show' && mode === 'hide') {
        await reloadCurrentChat();
    }
    resetHidden();
    if (mode === 'hide') {
        hideRange(start, end);
    } else {
        await showRange(start, end);
    }
}

/**
 * 恢复全量视图（移除区间裁剪）。
 * show 模式用 reloadCurrentChat 全量重建；hide 模式仅还原被隐藏的楼层。
 */
export function restoreChatView() {
    const prev = viewState;
    resetHidden();
    viewState = null;
    removeFeedback();
    if (prev?.mode === 'show') {
        reloadCurrentChat();
    }
    debugLog('[RangeView] 已恢复全量视图');
}

/** 只显示 [start, end]：清空 #chat 仅重渲该区间（复用 ST printMessages 的逐条重建方式） */
async function showRange(start, end) {
    $('#chat').children().remove();
    for (let i = start; i <= end; i++) {
        addOneMessage(chat[i], { scroll: false, forceId: i, showSwipes: true });
        await eventSource.emit(
            chat[i].is_user ? event_types.USER_MESSAGE_RENDERED : event_types.CHARACTER_MESSAGE_RENDERED,
            i,
        );
    }
    scrollChatToBottom();
    viewState = { mode: 'show', start, end };
    updateFeedback();
    debugLog(`[RangeView] 显示区间 ${start}-${end}`);
}

/** 隐藏 [start, end]：CSS 隐藏对应 .mes，其余保持全量渲染 */
function hideRange(start, end) {
    for (let i = start; i <= end; i++) {
        const el = document.querySelector(`.mes[mesid="${i}"]`);
        if (el) {
            el.style.display = 'none';
            hiddenMesIds.add(i);
        }
    }
    viewState = { mode: 'hide', start, end };
    updateFeedback();
    debugLog(`[RangeView] 隐藏区间 ${start}-${end}`);
}

/** 还原所有被隐藏的楼层 */
function resetHidden() {
    hiddenMesIds.forEach((id) => {
        const el = document.querySelector(`.mes[mesid="${id}"]`);
        if (el) el.style.display = '';
    });
    hiddenMesIds.clear();
}

// ── 当前区间反馈浮标（#chat 内的 sticky 底部元素，桌面/手机都贴在聊天可视区底部） ──

function updateFeedback() {
    if (!viewState) {
        removeFeedback();
        return;
    }
    ensureFeedbackStyles();
    const chatEl = document.getElementById('chat');
    if (!chatEl) {
        removeFeedback();
        return;
    }
    let el = document.getElementById(FEEDBACK_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = FEEDBACK_ID;
        el.className = 'ccore-range-feedback';
        el.innerHTML =
            `<span class="ccore-range-feedback-text"></span>` +
            `<button type="button" class="menu_button ccore-range-feedback-restore">${translate('恢复默认', 'ccore_range_restore')}</button>`;
        chatEl.appendChild(el);
        el.querySelector('.ccore-range-feedback-restore').addEventListener('click', () => restoreChatView());
    }
    const total = Array.isArray(chat) ? chat.length : 0;
    const modeLabel = viewState.mode === 'show'
        ? translate('查看', 'ccore_range_feedback_view')
        : translate('隐藏', 'ccore_range_feedback_hide');
    // 范围用 0 基楼层号（与弹窗输入/ST mesId 一致），分母标注为「楼层总数」避免语义混淆
    const fmt = translate('{mode} {range} / 共 {total} 层', 'ccore_range_feedback_fmt');
    el.querySelector('.ccore-range-feedback-text').textContent =
        fmt
            .replace('{mode}', modeLabel)
            .replace('{range}', `${viewState.start}-${viewState.end}`)
            .replace('{total}', String(total));
    el.style.display = '';
}

function removeFeedback() {
    document.getElementById(FEEDBACK_ID)?.remove();
}

function ensureFeedbackStyles() {
    if (document.getElementById(FEEDBACK_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = FEEDBACK_STYLE_ID;
    style.textContent = `
        #${FEEDBACK_ID}.ccore-range-feedback {
            position: sticky;
            bottom: 8px;
            align-self: flex-end;
            flex-shrink: 0;
            z-index: 30;
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 6px 12px 2px 0;
            padding: 5px 10px;
            font-size: 0.85em;
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 10px;
            background: var(--SmartThemeBlurTintColor);
            backdrop-filter: blur(var(--SmartThemeBlurStrength));
            color: var(--SmartThemeBodyColor);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            max-width: min(340px, 70vw);
        }
        #${FEEDBACK_ID}.ccore-range-feedback .ccore-range-feedback-restore {
            flex-shrink: 0;
            margin: 0;
            padding: 1px 8px;
            font-size: 0.85em;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);
}

// ── 切聊天/重载时重置区间状态 ──

function resetRangeState() {
    resetHidden();
    viewState = null;
    removeFeedback();
}

function ensureChatChangedListener() {
    if (chatChangedListener) return;
    chatChangedListener = resetRangeState;
    eventSource.on(event_types.CHAT_CHANGED, chatChangedListener);
}

ensureChatChangedListener();
