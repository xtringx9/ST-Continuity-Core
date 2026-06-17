// src/ui/messageAiButton.js
// 为每条消息添加 AI 生成模块按钮

import { eventSource, event_types } from '../../../../../../script.js';
import { debugLog, infoLog, errorLog } from '../utils/logger.js';
import { moduleAiGenerator } from '../services/moduleAiGenerator.js';
import configManager from '../singleton/configManager.js';

const LOG_TAG = '[MessageAiButton]';
const BUTTON_CLASS = 'mes_ai_generate';
const BUTTON_TITLE = '重新生成模块';

// 按钮状态
const STATE = {
    IDLE: 'idle',
    LOADING: 'loading',
    SUCCESS: 'success',
    ERROR: 'error',
};

// 状态恢复延迟（毫秒）
const RESET_DELAY = 2000;

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
                transition: 'background-color 0.3s, border-color 0.3s, color 0.3s',
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
 * 设置按钮状态
 * @param {jQuery} button - 按钮元素
 * @param {string} state - 状态
 */
function setButtonState(button, state) {
    // 清除所有状态样式
    button.css({
        backgroundColor: '',
        borderColor: '',
        color: '',
    });

    switch (state) {
        case STATE.LOADING:
            button.text('...')
                .attr('title', '生成中...')
                .css({
                    backgroundColor: 'rgba(128, 128, 128, 0.3)',
                    borderColor: 'rgba(128, 128, 128, 0.8)',
                });
            break;
        case STATE.SUCCESS:
            button.text('Cc')
                .attr('title', '生成成功')
                .css({
                    backgroundColor: 'rgba(76, 175, 80, 0.3)',
                    borderColor: 'rgba(76, 175, 80, 0.8)',
                    color: 'rgba(76, 175, 80, 1)',
                });
            break;
        case STATE.ERROR:
            button.text('Cc')
                .attr('title', '生成失败')
                .css({
                    backgroundColor: 'rgba(244, 67, 54, 0.3)',
                    borderColor: 'rgba(244, 67, 54, 0.8)',
                    color: 'rgba(244, 67, 54, 1)',
                });
            break;
        default: // IDLE
            button.text('Cc')
                .attr('title', BUTTON_TITLE);
    }
}

/**
 * 处理按钮点击事件
 */
async function onAiButtonClick(event) {
    const button = $(event.currentTarget);
    const mesBlock = button.closest('.mes');
    const mesId = parseInt(mesBlock.attr('mesid'), 10);
    if (isNaN(mesId)) return;

    // 防止重复点击
    if (button.text() === '...') return;

    // 从配置读取选项
    const asyncModule = configManager.getExtensionConfig().asyncModule || {};
    const useIndependentApi = asyncModule.useIndependentApi || false;
    let customApi = null;
    if (useIndependentApi) {
        const apiConfig = asyncModule.customApi || {};
        if (apiConfig.apiurl) {
            customApi = { ...apiConfig };
        }
    }

    const options = {
        mode: asyncModule.generationMode || 'pipeline',
        customApi,
        rawSystemPrompt: asyncModule.rawSystemPrompt || '',
        rawUserPrompt: asyncModule.rawUserPromptTemplate || '',
        pipelineModifier: asyncModule.pipelineModifier || '',
        cotTags: configManager.getGlobalSettings().cotTags || [],
        showDebug: asyncModule.showDebug !== false,
        skipStorage: true, // 先展示不存储
    };

    setButtonState(button, STATE.LOADING);

    try {
        const result = await moduleAiGenerator.generate(mesId, options);

        if (result.success) {
            setButtonState(button, STATE.SUCCESS);
            infoLog(LOG_TAG, `消息 ${mesId} AI 生成成功`);
        } else {
            setButtonState(button, STATE.ERROR);
            errorLog(LOG_TAG, `消息 ${mesId} AI 生成失败: ${result.error || '未知错误'}`);
        }
    } catch (err) {
        setButtonState(button, STATE.ERROR);
        errorLog(LOG_TAG, `消息 ${mesId} AI 生成异常:`, err);
    }

    // 一定时间后恢复
    setTimeout(() => setButtonState(button, STATE.IDLE), RESET_DELAY);
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
