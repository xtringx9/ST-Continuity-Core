// src/ui/messageAiButton.js
// 为每条消息添加 AI 生成模块按钮

import { eventSource, event_types } from '../../../../../../script.js';
import { debugLog, infoLog } from '../utils/logger.js';

const LOG_TAG = '[MessageAiButton]';
const BUTTON_CLASS = 'mes_ai_generate';
const BUTTON_TITLE = '重新生成模块';

/**
 * 为单条消息添加 AI 生成按钮
 * @param {number} messageId - 消息 ID
 */
function addAiButtonToMessage(messageId) {
    try {
        const messageBlock = $(`.mes[mesid="${messageId}"]`);
        if (!messageBlock.length) return;

        // 避免重复添加
        if (messageBlock.find(`.${BUTTON_CLASS}`).length) return;

        const editButton = messageBlock.find('.mes_edit');
        if (!editButton.length) return;

        // 创建按钮，使用 Cc 文字图标，样式与编辑按钮对齐
        const button = $('<div>')
            .attr('title', BUTTON_TITLE)
            .attr('data-i18n', `[title]${BUTTON_TITLE}`)
            .addClass(`mes_button ${BUTTON_CLASS} interactable`)
            .attr('tabindex', '0')
            .attr('role', 'button')
            .css({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: 'bold',
                lineHeight: '1',
                width: '22px',
                height: '22px',
                border: '2px solid var(--smart-border-color, rgba(128,128,128,0.5))',
                borderRadius: '6px',
                boxSizing: 'border-box',
            })
            .text('Cc');

        // 插入到编辑按钮前面
        editButton.before(button);

        debugLog(LOG_TAG, `已为消息 ${messageId} 添加 AI 生成按钮`);
    } catch (err) {
        debugLog(LOG_TAG, `为消息 ${messageId} 添加按钮失败:`, err);
    }
}

/**
 * 为当前聊天中所有消息添加按钮
 */
function addAiButtonsToAllMessages() {
    try {
        const messages = $('#chat .mes');
        messages.each(function () {
            const mesId = parseInt($(this).attr('mesid'), 10);
            if (!isNaN(mesId)) {
                addAiButtonToMessage(mesId);
            }
        });
    } catch (err) {
        debugLog(LOG_TAG, '为所有消息添加按钮失败:', err);
    }
}

/**
 * 处理按钮点击事件
 */
function onAiButtonClick(event) {
    const mesBlock = $(event.currentTarget).closest('.mes');
    const mesId = parseInt(mesBlock.attr('mesid'), 10);
    if (isNaN(mesId)) return;

    infoLog(LOG_TAG, `点击了消息 ${mesId} 的 AI 生成按钮`);
    // TODO: 接入 moduleAiGenerator.generate(mesId, options)
}

/**
 * 初始化消息 AI 生成按钮
 */
export function initMessageAiButton() {
    // 监听消息渲染事件，为新消息添加按钮
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, addAiButtonToMessage);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, addAiButtonToMessage);
    eventSource.on(event_types.MESSAGE_RECEIVED, addAiButtonToMessage);
    eventSource.on(event_types.MESSAGE_SENT, addAiButtonToMessage);
    eventSource.on(event_types.MORE_MESSAGES_LOADED, addAiButtonsToAllMessages);
    eventSource.on(event_types.CHAT_CHANGED, addAiButtonsToAllMessages);

    // 事件委托处理按钮点击
    $(document).on('click', `.${BUTTON_CLASS}`, onAiButtonClick);

    // 为当前已加载的消息添加按钮
    addAiButtonsToAllMessages();

    infoLog(LOG_TAG, '消息 AI 生成按钮初始化完成');
}
