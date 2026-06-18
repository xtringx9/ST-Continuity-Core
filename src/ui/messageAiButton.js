// src/ui/messageAiButton.js
// 为每条消息添加模块操作按钮（Cc 菜单触发器 + 展开的三个操作）
// Cc 点击 → 同行右侧展开三个按钮：重新生成 / 编辑模块数据 / 模块汇总

import { eventSource, event_types } from '../../../../../../script.js';
import { debugLog, infoLog, errorLog } from '../utils/logger.js';
import { moduleAiGenerator } from '../services/moduleAiGenerator.js';
import configManager from '../singleton/configManager.js';
import { openContextBottomAsModal } from '../core/contextBottomUI.js';

const LOG_TAG = '[MessageAiButton]';
const BUTTON_CLASS = 'mes_ai_generate';
const BUTTON_TITLE = '模块操作';
const MENU_CLASS = 'ccore-mes-menu';

// 按钮状态
const STATE = {
    IDLE: 'idle',
    LOADING: 'loading',
    SUCCESS: 'success',
    ERROR: 'error',
};

// 状态恢复延迟（毫秒）
const RESET_DELAY = 2000;

// 当前打开的菜单
let currentMenu = null;
let currentTrigger = null;

/**
 * 为单条消息添加 Cc 菜单触发器
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

        // 创建 Cc 触发器，使用 Cc 文字图标，样式与编辑按钮对齐
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
                cursor: 'pointer',
            })
            .text('Cc');

        // 插入到编辑按钮前面
        editButton.before(button);

        debugLog(LOG_TAG, `已为消息 ${messageId} 添加 Cc 菜单触发器`);
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
 * 设置 Cc 触发器状态（用于重新生成反馈）
 * @param {jQuery} button - Cc 触发器元素
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
 * Cc 触发器点击：toggle 菜单
 */
function onTriggerClick(event) {
    const button = $(event.currentTarget);
    const mesBlock = button.closest('.mes');
    const mesId = parseInt(mesBlock.attr('mesid'), 10);
    if (isNaN(mesId)) return;

    // 生成中不响应
    if (button.text() === '...') return;

    toggleInlineMenu(button, mesId);
}

/**
 * 切换菜单显示（inline 同行展开）
 */
function toggleInlineMenu(triggerButton, mesId) {
    // 已有菜单打开：先关闭
    if (currentMenu) {
        const isSameTrigger = currentTrigger && currentTrigger[0] === triggerButton[0];
        closeInlineMenu();
        // 点的是当前触发器：仅关闭
        if (isSameTrigger) return;
    }

    currentTrigger = triggerButton;
    currentMenu = createInlineMenu(triggerButton, mesId);

    // 插入到 Cc 左侧（同一行，Cc 位置不变）
    triggerButton.before(currentMenu);

    // Cc 激活样式
    triggerButton.css({
        backgroundColor: 'rgba(128, 128, 128, 0.3)',
        borderColor: 'rgba(128, 128, 128, 0.9)',
    });

    // 延迟绑定外部点击关闭（避免本次点击立即触发）
    setTimeout(() => {
        $(document).on('click.ccore-menu', handleOutsideClick);
    }, 0);
}

/**
 * 创建 inline 菜单（三个按钮，横向排列）
 */
function createInlineMenu(triggerButton, mesId) {
    const menu = $('<div>')
        .addClass(MENU_CLASS)
        .css({
            display: 'inline-flex',
            gap: '4px',
            marginRight: '4px',
            verticalAlign: 'middle',
        });

    // 三个操作按钮
    const actions = [
        { action: 'regenerate', icon: 'fa-arrows-rotate', title: '重新生成模块' },
        { action: 'edit', icon: 'fa-pen-to-square', title: '编辑模块数据' },
        { action: 'summary', icon: 'fa-table-list', title: '模块汇总' },
    ];

    actions.forEach(({ action, icon, title }) => {
        const btn = $('<div>')
            .attr('title', title)
            .attr('data-i18n', `[title]${title}`)
            .addClass('mes_button interactable')
            .attr('tabindex', '0')
            .attr('role', 'button')
            .css({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '22px',
                height: '22px',
                borderRadius: '4px',
                cursor: 'pointer',
            })
            .html(`<i class="fa-solid ${icon}"></i>`);

        btn.on('click', (e) => {
            e.stopPropagation();
            closeInlineMenu();
            onMenuAction(action, triggerButton, mesId);
        });

        menu.append(btn);
    });

    return menu;
}

/**
 * 关闭菜单
 */
function closeInlineMenu() {
    if (currentMenu) {
        currentMenu.remove();
        currentMenu = null;
    }
    if (currentTrigger) {
        // 恢复 Cc 默认样式
        setButtonState(currentTrigger, STATE.IDLE);
    }
    currentTrigger = null;
    $(document).off('.ccore-menu');
}

/**
 * 外部点击关闭
 */
function handleOutsideClick(e) {
    if (!currentMenu) return;
    const $target = $(e.target);
    if (!$target.closest(`.${MENU_CLASS}`).length &&
        currentTrigger && !$target.closest(currentTrigger).length) {
        closeInlineMenu();
    }
}

/**
 * 菜单项动作分发
 */
async function onMenuAction(action, triggerButton, mesId) {
    switch (action) {
        case 'regenerate':
            await onRegenerate(triggerButton, mesId);
            break;
        case 'edit':
            onEditModules(mesId);
            break;
        case 'summary':
            onSummaryPanel();
            break;
    }
}

/**
 * 重新生成模块
 */
async function onRegenerate(button, mesId) {
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
            infoLog(LOG_TAG, `消息 ${mesId} 生成成功`);
        } else {
            setButtonState(button, STATE.ERROR);
            errorLog(LOG_TAG, `消息 ${mesId} 生成失败: ${result.error || '未知错误'}`);
        }
    } catch (err) {
        setButtonState(button, STATE.ERROR);
        errorLog(LOG_TAG, `消息 ${mesId} 生成异常:`, err);
    }

    // 一定时间后恢复
    setTimeout(() => setButtonState(button, STATE.IDLE), RESET_DELAY);
}

/**
 * 编辑模块数据（占位，待实现）
 * 仅在异步存储开启时可用
 */
function onEditModules(mesId) {
    const asyncModule = configManager.getExtensionConfig().asyncModule || {};
    if (!asyncModule.enabled) {
        infoLog(LOG_TAG, '编辑模块数据仅在异步存储开启时可用');
        return;
    }
    infoLog(LOG_TAG, `编辑模块数据（功能开发中）: 消息 ${mesId}`);
}

/**
 * 模块汇总弹窗
 */
function onSummaryPanel() {
    openContextBottomAsModal();
}

/**
 * 初始化消息模块操作按钮
 */
export function initMessageAiButton() {
    // 监听消息渲染事件，为新消息添加按钮
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, addAiButtonToMessage);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, addAiButtonToMessage);
    eventSource.on(event_types.MESSAGE_RECEIVED, addAiButtonToMessage);
    eventSource.on(event_types.MESSAGE_SENT, addAiButtonToMessage);
    eventSource.on(event_types.MORE_MESSAGES_LOADED, addAiButtonsToAllMessages);
    eventSource.on(event_types.CHAT_CHANGED, addAiButtonsToAllMessages);

    // 事件委托：Cc 触发器点击
    $(document).on('click', `.${BUTTON_CLASS}`, onTriggerClick);

    // 为当前已加载的消息添加按钮
    addAiButtonsToAllMessages();

    infoLog(LOG_TAG, '消息模块操作按钮初始化完成');
}
