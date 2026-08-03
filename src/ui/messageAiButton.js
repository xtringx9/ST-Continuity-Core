// src/ui/messageAiButton.js
// 为每条消息添加模块操作按钮（Cc 菜单触发器 + 展开的多框菜单）
// Cc 点击 → 同行右侧展开：[模块框: 重新生成 编辑 汇总] [各 generator 框: 重新生成] ...

import { chat } from '../../../../../../script.js';
import { debugLog, infoLog, errorLog } from '../utils/logger.js';
import { moduleAiGenerator, hasPendingResult, reopenPendingDebugPanel } from '../services/moduleAiGenerator.js';
import configManager from '../singleton/configManager.js';
import generatedContentCache from '../singleton/generatedContentCache.js';
import { isInChatPage, openContextBottomAsModal } from '../core/contextBottomUI.js';
import perMessageStorage from '../services/perMessageStorage.js';
import { CONTEXT_MSG_CONTAINER_ID } from '../core/context-ui/containerManager.js';

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
let currentMenuMesId = null;

/**
 * 为单条消息添加 Cc 菜单触发器
 *
 * 定位策略（仿 ST swipe 按钮）：
 *   - .mes 是 position:relative，子元素 absolute 相对消息块定位
 *   - swipe_left 在 left:20px; bottom:20px，swipe_right 在 right:5px，底部居中是 swipes-counter
 *   - Cc 紧贴消息框左下角（left:0; bottom:0），与 swipe_left 错开（swipe 更靠右靠上）
 *   - z-index:9999 浮在最上层，opacity 0.5（hover 1.0），比 swipe 的 0.3 更明显
 *
 * 历史方案（保留注释以防回退）：
 *   之前 Cc 用 mes_button class 插入到 .mes_edit 前（顶部按钮栏），
 *   占用按钮栏空间，且正文太长时编辑入口在顶部、textarea 在底部，需滚动。
 *   改为浮动定位后，按钮始终在消息底部，点击编辑后 textarea 就在附近，无需滚动。
 *   也试过 left:50px（中央偏左），最终采用紧贴左下角。
 *
 * @param {number} messageId - 消息 ID
 */
export function addAiButtonToMessage(messageId) {
    if(!isInChatPage()) return;
    // 中转判断：不可见则不加（批量函数负责清理已存在的）
    if (!isMessageAiButtonVisible()) return;
    try {
        const messageBlock = $(`.mes[mesid="${messageId}"]`);
        if (!messageBlock.length) return;

        // 避免重复添加
        if (messageBlock.find(`.${BUTTON_CLASS}`).length) return;

        // 仍检查 editButton 以判断消息可编辑性（系统消息可能没有）
        const editButton = messageBlock.find('.mes_edit');
        if (!editButton.length) return;

        // 浮动容器：承载 Cc 触发器 + 展开的菜单项（同一行横向排列）
        const floatWrap = $('<div>')
            .addClass('ccore-mes-float-wrap')
            .css({
                position: 'absolute',
                bottom: '0',
                left: '0',
                zIndex: 9999,
                display: 'inline-flex',
                gap: '0',
                alignItems: 'center',
            });

        // 创建 Cc 触发器，使用 Cc 文字图标
        // 注意：不再用 mes_button class（顶部按钮栏样式），改用浮动定位
        const button = $('<div>')
            .attr('title', BUTTON_TITLE)
            .attr('data-i18n', `[title]${BUTTON_TITLE}`)
            .addClass(`${BUTTON_CLASS} interactable`)
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
                cursor: 'pointer',
                opacity: 0.5,
                transition: 'opacity 0.2s, background-color 0.3s, border-color 0.3s, color 0.3s',
            })
            .text('Cc');

        // hover 时变明显（仿 swipe 按钮 opacity 行为，但比 swipe 的 0.3 更明显）
        button.hover(
            function () { $(this).css('opacity', 1); },
            function () { $(this).css('opacity', 0.5); }
        );

        floatWrap.append(button);
        messageBlock.append(floatWrap);

        debugLog(LOG_TAG, `已为消息 ${messageId} 添加 Cc 浮动触发器`);
    } catch (err) {
        debugLog(LOG_TAG, `为消息 ${messageId} 添加按钮失败:`, err);
    }
}

/**
 * 小 Cc 按钮显隐的中转判断。
 * 集中所有「是否显示每条消息上的小 Cc 按钮」的控制逻辑，方便后续接入其他开关。
 * 当前仅受异步模块总开关 asyncModule.enabled 控制：
 *   - 原显示、关掉异步 → 隐藏
 *   - 原隐藏、开启异步 → 显示
 * 后续若新增其他开关（如按角色/按消息类型等），在此函数内合并判断即可，
 * 下游 addAiButtonsToAllMessages / addAiButtonToMessage 无需改动。
 * @returns {boolean} 是否应显示小 Cc 按钮
 */
export function isMessageAiButtonVisible() {
    const asyncEnabled = configManager.getExtensionConfig().asyncModule?.enabled ?? false;
    // TODO: 后续其他开关在此处用 && / || 合并（例如：&& otherFeatureEnabled）
    return asyncEnabled;
}

/**
 * 为当前聊天中所有消息添加按钮
 */
export function addAiButtonsToAllMessages() {
    try {
        // 中转判断：不可见时清除所有已存在的小 Cc 按钮并退出（满足「关异步即隐藏」）
        if (!isMessageAiButtonVisible()) {
            removeAllAiButtons();
            return;
        }

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
 *
 * opacity 管理：
 *   - IDLE: 0.5（半透明，与浮动定位的轻量感一致，hover 时由 jQuery hover 事件提到 1.0）
 *   - LOADING/SUCCESS/ERROR: 1.0（状态反馈需完全可见）
 *
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
                    opacity: 1,
                });
            break;
        case STATE.SUCCESS:
            button.text('Cc')
                .attr('title', '生成成功')
                .css({
                    backgroundColor: 'rgba(76, 175, 80, 0.3)',
                    borderColor: 'rgba(76, 175, 80, 0.8)',
                    color: 'rgba(76, 175, 80, 1)',
                    opacity: 1,
                });
            break;
        case STATE.ERROR:
            button.text('Cc')
                .attr('title', '生成失败')
                .css({
                    backgroundColor: 'rgba(244, 67, 54, 0.3)',
                    borderColor: 'rgba(244, 67, 54, 0.8)',
                    color: 'rgba(244, 67, 54, 1)',
                    opacity: 1,
                });
            break;
        default: // IDLE
            button.text('Cc')
                .attr('title', BUTTON_TITLE)
                .css('opacity', 0.5);
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
 *
 * 展开方向：向右（Cc 之后插入菜单项）
 *   - 与 EntryButton 保持一致的操作逻辑（向右展开）
 *   - Cc 浮动在消息底部中央偏左，右侧空间充足
 *
 * 历史方案（保留注释以防回退）：
 *   之前 Cc 在顶部按钮栏时，为避免遮挡右侧的编辑/删除按钮，采用向左展开：
 *     triggerButton.before(currentMenu);
 *   改为浮动定位后，右侧无其他按钮，改为向右展开更符合直觉。
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
    currentMenuMesId = mesId;

    // 向右展开：菜单插入到 Cc 之后（同一浮动容器内，横向排列）
    triggerButton.after(currentMenu);

    // Cc 激活样式
    triggerButton.css({
        backgroundColor: 'rgba(128, 128, 128, 0.3)',
        borderColor: 'rgba(128, 128, 128, 0.9)',
        opacity: 1, // 激活时完全可见
    });

    // 延迟绑定外部点击关闭（避免本次点击立即触发）
    setTimeout(() => {
        $(document).on('click.ccore-menu', handleOutsideClick);
    }, 0);
}

/**
 * 创建 inline 菜单（多框横向排列）
 *
 * 布局：[模块框: 重新生成 编辑 汇总] [gen1框: 重新生成] [gen2框: 重新生成] ...
 * 每个框是独立的带边框容器，框之间有间距(gap:4px)，框内按钮紧贴(gap:0)。
 * 模块框始终存在；generator 框从 generator_config 读取启用的 generators 动态生成。
 */
function createInlineMenu(triggerButton, mesId) {
    const menu = $('<div>')
        .addClass(MENU_CLASS)
        .css({
            display: 'inline-flex',
            gap: '4px', // 框之间间距
            verticalAlign: 'middle',
            alignItems: 'center',
        });

    const asyncModule = configManager.getExtensionConfig().asyncModule || {};
    const asyncEnabled = !!asyncModule.enabled;

    // 1. 模块框：重新生成 + 编辑 + 汇总（无 label）
    const moduleRegenIcon = hasPendingResult('modules', mesId) ? 'fa-hourglass-half' : 'fa-arrows-rotate';
    const moduleActions = [
        { action: 'regenerate', icon: moduleRegenIcon, title: '重新生成模块', needAsync: true },
        { action: 'edit', icon: 'fa-pen-to-square', title: '编辑模块数据', needAsync: true },
        { action: 'summary', icon: 'fa-table-list', title: '模块汇总', needAsync: false },
    ];
    menu.append(createMenuBox(moduleActions, asyncEnabled, triggerButton, mesId));

    // 2. 各 generator 框：每个启用的 generator 一个重新生成 + 编辑按钮（带 displayName label）
    const generators = configManager.getGenerators(); // 默认只返回启用的
    for (const gen of generators) {
        const genRegenIcon = hasPendingResult(gen.name, mesId) ? 'fa-hourglass-half' : 'fa-arrows-rotate';
        const genActions = [
            { action: `generate:${gen.name}`, icon: genRegenIcon, title: `生成${gen.displayName}`, needAsync: true },
            { action: `edit:${gen.name}`, icon: 'fa-pen-to-square', title: `编辑${gen.displayName}`, needAsync: true },
        ];
        menu.append(createMenuBox(genActions, asyncEnabled, triggerButton, mesId, gen.displayName));
    }

    return menu;
}

/**
 * 创建菜单框（带边框容器，内含多个紧贴的按钮）
 * @param {Array} actions - 按钮配置数组
 * @param {boolean} asyncEnabled - 异步存储是否开启
 * @param {jQuery} triggerButton - Cc 触发器
 * @param {number} mesId
 * @param {string} [label] - 框内前置 label 文本（如 generator 的 displayName）
 */
function createMenuBox(actions, asyncEnabled, triggerButton, mesId, label) {
    const box = $('<div>').css({
        display: 'inline-flex',
        gap: '0',
        alignItems: 'center',
        border: '2px solid var(--smart-border-color, rgba(128,128,128,0.5))',
        borderRadius: '6px',
        padding: '0',
        height: '22px',
        boxSizing: 'border-box',
    });

    // 前置 label（非模块框用）
    if (label) {
        const labelEl = $('<span>')
            .text(label)
            .css({
                fontSize: '11px',
                padding: '0 4px 0 3px',
                whiteSpace: 'nowrap',
                color: 'var(--smart-body-text-color, inherit)',
                lineHeight: '1',
            });
        box.append(labelEl);
    }

    for (const { action, icon, title, needAsync } of actions) {
        const disabled = needAsync && !asyncEnabled;
        box.append(createMenuButton(action, icon, title, disabled, triggerButton, mesId));
    }

    return box;
}

/**
 * 创建单个菜单按钮
 */
function createMenuButton(action, icon, title, disabled, triggerButton, mesId) {
    // 提取 generatorName 用于 data-generator 属性
    let generatorName = 'modules';
    if (action.startsWith('generate:')) {
        generatorName = action.substring('generate:'.length);
    } else if (action === 'regenerate') {
        generatorName = 'modules';
    } else {
        generatorName = null; // 非生成按钮不加 data-generator
    }

    const btn = $('<div>')
        .attr('title', disabled ? `${title}（需开启异步模块存储）` : title)
        .attr('data-i18n', `[title]${title}`)
        .addClass('mes_button interactable')
        .attr('tabindex', '0')
        .attr('role', 'button');

    if (generatorName) {
        btn.attr('data-generator', generatorName);
    }

    btn.css({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '18px',
            height: '18px',
            padding: '0',
            borderRadius: '4px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.4 : 0.7,
        })
        .html(`<i class="fa-solid ${icon}"></i>`);

    if (!disabled) {
        btn.hover(
            function () { $(this).css('opacity', 1); },
            function () { $(this).css('opacity', 0.7); }
        );

        btn.on('click', (e) => {
            e.stopPropagation();
            // generate 操作不关闭菜单，让按钮自身显示生成状态
            const isGenerate = action === 'regenerate' || action.startsWith('generate:');
            if (!isGenerate) {
                closeInlineMenu();
            }
            onMenuAction(action, triggerButton, mesId, btn);
        });
    }

    return btn;
}

/**
 * 关闭菜单
 */
function closeInlineMenu() {
    if (currentMenu) {
        currentMenu.remove();
        currentMenu = null;
    }
    currentMenuMesId = null;
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
 * @param {string} action
 * @param {jQuery} triggerButton - Cc 触发器
 * @param {number} mesId
 * @param {jQuery} [clickedBtn] - 被点击的菜单按钮（generate 操作传入，用于显示状态）
 */
async function onMenuAction(action, triggerButton, mesId, clickedBtn) {
    // generate:xxx — 生成其他内容(xxx = generator.name)
    if (action.startsWith('generate:')) {
        const generatorName = action.substring('generate:'.length);
        await onRegenerate(clickedBtn, mesId, generatorName);
        return;
    }

    // edit:xxx — 编辑其他生成内容(xxx = generator.name)
    if (action.startsWith('edit:')) {
        const generatorName = action.substring('edit:'.length);
        await onEditGeneratedContent(mesId, generatorName);
        return;
    }

    switch (action) {
        case 'regenerate':
            await onRegenerate(clickedBtn, mesId);
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
 * 重新生成（模块或其他生成内容）
 * @param {jQuery} button - 被点击的"重新生成"菜单按钮
 * @param {number} mesId
 * @param {string} [generatorName='modules'] - 'modules' 或 generator.name
 */
async function onRegenerate(button, mesId, generatorName = 'modules') {
    // 正在生成中（按钮显示 spinner）则不重复触发
    if (button && button.find('i.fa-spinner').length) return;

    // 有该 generator + 楼层的未处理结果时，重新打开调试面板而非发起新生成
    if (hasPendingResult(generatorName, mesId)) {
        reopenPendingDebugPanel(generatorName, mesId);
        return;
    }

    // 从配置读取选项
    const asyncModule = configManager.getExtensionConfig().asyncModule || {};
    const isModule = generatorName === 'modules';
    const useIndependentApi = asyncModule.useIndependentApi || false;
    let customApi = null;
    if (useIndependentApi) {
        const apiConfig = asyncModule.customApi || {};
        if (apiConfig.apiurl) {
            customApi = { ...apiConfig };
        }
    }

    const options = {
        generatorName,
        mode: asyncModule.generationMode || 'pipeline',
        customApi,
        showDebug: asyncModule.showDebug !== false,
        skipStorage: true, // 先展示不存储
    };

    // 模块才需要传提示词配置(其他生成内容从 generator_config 读)
    if (isModule) {
        options.rawSystemPrompt = asyncModule.rawSystemPrompt || '';
        options.rawUserPrompt = asyncModule.rawUserPromptTemplate || '';
        options.pipelineModifier = asyncModule.pipelineModifier || '';
    }

    setRegenButtonState(button, STATE.LOADING, generatorName);

    try {
        const result = await moduleAiGenerator.generate(mesId, options);

        if (result.success) {
            setRegenButtonState(button, STATE.SUCCESS, generatorName);
            infoLog(LOG_TAG, `消息 ${mesId} ${generatorName} 生成成功`);
        } else {
            setRegenButtonState(button, STATE.ERROR, generatorName);
            errorLog(LOG_TAG, `消息 ${mesId} ${generatorName} 生成失败: ${result.error || '未知错误'}`);
        }
    } catch (err) {
        setRegenButtonState(button, STATE.ERROR, generatorName);
        errorLog(LOG_TAG, `消息 ${mesId} ${generatorName} 生成异常:`, err);
    }

    // 一定时间后恢复
    setTimeout(() => setRegenButtonState(button, STATE.IDLE, generatorName, mesId), RESET_DELAY);
}

/**
 * 设置"重新生成"按钮状态（图标替换式）
 * 与 setButtonState(Cc 触发器) 不同，这里通过替换 fa 图标展示状态
 * @param {jQuery} button - 被点击的菜单按钮
 * @param {string} state - STATE 常量
 * @param {string} [generatorName='modules'] - 用于判断 IDLE 时是否有待处理结果
 * @param {number} [mesId] - 楼层 ID，IDLE 状态判断 hasPendingResult 时需要
 */
function setRegenButtonState(button, state, generatorName = 'modules', mesId) {
    if (!button || !button.length) return;

    // 清除状态样式
    button.css({
        backgroundColor: '',
        color: '',
    });

    switch (state) {
        case STATE.LOADING:
            button.html('<i class="fa-solid fa-spinner fa-spin"></i>')
                .attr('title', '生成中...')
                .css({
                    backgroundColor: 'rgba(128, 128, 128, 0.3)',
                    opacity: 1,
                });
            break;
        case STATE.SUCCESS:
            button.html('<i class="fa-solid fa-check"></i>')
                .attr('title', '生成成功')
                .css({
                    backgroundColor: 'rgba(76, 175, 80, 0.3)',
                    color: 'rgba(76, 175, 80, 1)',
                    opacity: 1,
                });
            break;
        case STATE.ERROR:
            button.html('<i class="fa-solid fa-xmark"></i>')
                .attr('title', '生成失败')
                .css({
                    backgroundColor: 'rgba(244, 67, 54, 0.3)',
                    color: 'rgba(244, 67, 54, 1)',
                    opacity: 1,
                });
            break;
        default: { // IDLE — 根据是否有待处理结果决定图标
            const hasPending = mesId !== undefined && hasPendingResult(generatorName, mesId);
            const idleIcon = hasPending ? 'fa-hourglass-half' : 'fa-arrows-rotate';
            button.html(`<i class="fa-solid ${idleIcon}"></i>`)
                .attr('title', hasPending ? '有待处理结果，点击查看' : '重新生成')
                .css('opacity', 0.7);
        }
    }
}

/**
 * 编辑模块数据（就地 textarea）
 * 仅在异步存储开启时可用，编辑 modules key 的文本
 */
async function onEditModules(mesId) {
    const asyncModule = configManager.getExtensionConfig().asyncModule || {};
    if (!asyncModule.enabled) {
        infoLog(LOG_TAG, '编辑模块数据仅在异步存储开启时可用');
        return;
    }

    const $message = $(`.mes[mesid="${mesId}"]`);
    if (!$message.length) {
        errorLog(LOG_TAG, `找不到消息 ${mesId}`);
        return;
    }

    let $container = $message.find(`#${CONTEXT_MSG_CONTAINER_ID}`);
    if (!$container.length) {
        $container = $(`<div id="${CONTEXT_MSG_CONTAINER_ID}"></div>`);
        $message.append($container);
    }

    // 已有编辑区则不重复创建
    if ($container.find('.ccore-edit-area').length) return;

    // 隐藏现有 iframe
    const $iframe = $container.find('iframe');
    $iframe.hide();

    // 读取 perMessageStorage 数据(新格式:swipe 数据是 { modules: string, ... })
    const swipeId = chat[mesId]?.swipe_id ?? 0;
    let rawText = '';
    let existingData = null;
    try {
        existingData = await perMessageStorage.getMessage(mesId, swipeId);
        if (existingData?.modules) {
            rawText = existingData.modules;
        }
    } catch (err) {
        errorLog(LOG_TAG, `读取消息 ${mesId} 模块数据失败:`, err);
    }

    // 构建编辑区
    // - textarea 不设 placeholder（用户要求：空着即可，无需提示）
    // - 保存/取消按钮用 ST 原生编辑消息样式（menu_button fa-solid fa-check/fa-times），
    //   与 ST 原生编辑消息按钮视觉一致
    const $editArea = $(`
        <div class="ccore-edit-area" style="margin:5px 0;padding:5px;border:1px solid var(--smart-border-color,rgba(128,128,128,0.5));border-radius:5px;">
            <textarea class="ccore-edit-textarea" style="width:100%;min-height:80px;resize:vertical;background:var(--smart-background,#202123);color:var(--smart-text-color,#fff);border:1px solid var(--smart-border-color,rgba(128,128,128,0.5));border-radius:3px;padding:5px;font-family:monospace;font-size:13px;box-sizing:border-box;"></textarea>
            <div class="ccore-edit-actions" style="margin-top:5px;display:flex;gap:5px;">
                <div class="ccore-edit-save menu_button fa-solid fa-check interactable" title="确认" data-i18n="[title]Confirm" tabindex="0" role="button"></div>
                <div class="ccore-edit-cancel menu_button fa-solid fa-times interactable" title="取消" data-i18n="[title]Cancel" tabindex="0" role="button"></div>
            </div>
        </div>
    `);

    $editArea.find('.ccore-edit-textarea').val(rawText);
    $container.append($editArea);

    // 保存（div 按钮，用 class 标记禁用状态而非 prop('disabled')）
    $editArea.find('.ccore-edit-save').on('click', async (e) => {
        const $btn = $(e.currentTarget);
        if ($btn.hasClass('disabled')) return;
        $btn.addClass('disabled').css('opacity', 0.5);
        const text = String($editArea.find('.ccore-edit-textarea').val() || '');
        try {
            // 新格式:只更新 modules key,保留其他 generator key
            await perMessageStorage.updateMessage(mesId, swipeId, {
                modules: text,
            });
            infoLog(LOG_TAG, `消息 ${mesId} 模块数据已保存（${text.length} 字符）`);
            $editArea.remove();
            $iframe.show();
            // TODO: 重新渲染该消息的模块展示区（需 updateUItoMsgBottom 接入异步数据源后实现）
        } catch (err) {
            errorLog(LOG_TAG, `保存消息 ${mesId} 模块数据失败:`, err);
            $btn.removeClass('disabled').css('opacity', '');
        }
    });

    // 取消
    $editArea.find('.ccore-edit-cancel').on('click', () => {
        $editArea.remove();
        $iframe.show();
    });
}

/**
 * 编辑生成内容（小剧场、角色心理等）
 * 逻辑同 onEditModules，但读写 generatorName key，保存后更新内存缓存
 * @param {number} mesId
 * @param {string} generatorName - generator.name
 */
async function onEditGeneratedContent(mesId, generatorName) {
    const asyncModule = configManager.getExtensionConfig().asyncModule || {};
    if (!asyncModule.enabled) {
        infoLog(LOG_TAG, '编辑生成内容仅在异步存储开启时可用');
        return;
    }

    const $message = $(`.mes[mesid="${mesId}"]`);
    if (!$message.length) {
        errorLog(LOG_TAG, `找不到消息 ${mesId}`);
        return;
    }

    let $container = $message.find(`#${CONTEXT_MSG_CONTAINER_ID}`);
    if (!$container.length) {
        $container = $(`<div id="${CONTEXT_MSG_CONTAINER_ID}"></div>`);
        $message.append($container);
    }

    // 已有编辑区则不重复创建
    if ($container.find('.ccore-edit-area').length) return;

    // 隐藏现有 iframe
    const $iframe = $container.find('iframe');
    $iframe.hide();

    // 读取 perMessageStorage 数据
    const swipeId = chat[mesId]?.swipe_id ?? 0;
    let rawText = '';
    try {
        const existingData = await perMessageStorage.getMessage(mesId, swipeId);
        if (existingData?.[generatorName]) {
            rawText = existingData[generatorName];
        }
    } catch (err) {
        errorLog(LOG_TAG, `读取消息 ${mesId} ${generatorName} 数据失败:`, err);
    }

    // 构建编辑区（样式与 onEditModules 一致）
    const $editArea = $(`
        <div class="ccore-edit-area" style="margin:5px 0;padding:5px;border:1px solid var(--smart-border-color,rgba(128,128,128,0.5));border-radius:5px;">
            <textarea class="ccore-edit-textarea" style="width:100%;min-height:80px;resize:vertical;background:var(--smart-background,#202123);color:var(--smart-text-color,#fff);border:1px solid var(--smart-border-color,rgba(128,128,128,0.5));border-radius:3px;padding:5px;font-family:monospace;font-size:13px;box-sizing:border-box;"></textarea>
            <div class="ccore-edit-actions" style="margin-top:5px;display:flex;gap:5px;">
                <div class="ccore-edit-save menu_button fa-solid fa-check interactable" title="确认" data-i18n="[title]Confirm" tabindex="0" role="button"></div>
                <div class="ccore-edit-cancel menu_button fa-solid fa-times interactable" title="取消" data-i18n="[title]Cancel" tabindex="0" role="button"></div>
            </div>
        </div>
    `);

    $editArea.find('.ccore-edit-textarea').val(rawText);
    $container.append($editArea);

    // 保存
    $editArea.find('.ccore-edit-save').on('click', async (e) => {
        const $btn = $(e.currentTarget);
        if ($btn.hasClass('disabled')) return;
        $btn.addClass('disabled').css('opacity', 0.5);
        const text = String($editArea.find('.ccore-edit-textarea').val() || '');
        try {
            // 只更新 generatorName key，保留其他 key
            await perMessageStorage.updateMessage(mesId, swipeId, {
                [generatorName]: text,
            });
            // 更新内存缓存（注入时同步读取）
            generatedContentCache.set(mesId, generatorName, text);
            infoLog(LOG_TAG, `消息 ${mesId} ${generatorName} 数据已保存（${text.length} 字符）`);
            $editArea.remove();
            $iframe.show();
        } catch (err) {
            errorLog(LOG_TAG, `保存消息 ${mesId} ${generatorName} 数据失败:`, err);
            $btn.removeClass('disabled').css('opacity', '');
        }
    });

    // 取消
    $editArea.find('.ccore-edit-cancel').on('click', () => {
        $editArea.remove();
        $iframe.show();
    });
}

/**
 * 模块汇总弹窗
 */
function onSummaryPanel() {
    openContextBottomAsModal();
}

/**
 * 初始化消息模块操作按钮
 *
 * 仅负责非事件初始化：MutationObserver + 事件委托 + 首次添加按钮。
 * 事件注册由 eventHandler.initializeMessageAiButton 统一管理。
 */
export function initMessageAiButton() {
    // MutationObserver：监听 #chat 子元素变化，.mes 被重建时自动重新添加按钮
    // ST 在 swipe 切换/生成/编辑等场景会重建 .mes 元素，append 到 .mes 内的浮动按钮被清除。
    // 事件监听（MESSAGE_SWIPED/GENERATION_ENDED）无法覆盖所有场景，Observer 作为兜底。
    setupChatObserver();

    // 事件委托：Cc 触发器点击
    $(document).on('click', `.${BUTTON_CLASS}`, onTriggerClick);

    // 监听待处理结果清除事件，更新当前菜单中对应按钮的图标
    window.addEventListener('ccore-pending-cleared', (e) => {
        const { generatorName, mesId } = e.detail;
        // 只更新当前打开菜单对应楼层的按钮
        if (!currentMenu || mesId !== currentMenuMesId) return;
        const btn = currentMenu.find(`[data-generator="${generatorName}"]`);
        if (btn.length) {
            setRegenButtonState(btn, STATE.IDLE, generatorName, mesId);
        }
    });

    // 为当前已加载的消息添加按钮
    addAiButtonsToAllMessages();

    infoLog(LOG_TAG, '消息模块操作按钮初始化完成');
}

/**
 * #chat 的 MutationObserver
 *
 * ST 重新渲染消息块（swipe 切换/生成/编辑等）时会重建 .mes 元素，
 * 导致 append 到 .mes 内的浮动按钮被清除。Observer 监听 #chat 直接子元素
 * 变化，.mes 被添加/删除/替换时触发防抖刷新，确保按钮始终存在。
 */
let chatObserver = null;
let refreshDebounceTimer = null;

function setupChatObserver() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) {
        // chat 元素尚未就绪，延迟重试
        setTimeout(setupChatObserver, 500);
        return;
    }

    if (chatObserver) chatObserver.disconnect();

    chatObserver = new MutationObserver(() => {
        if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = setTimeout(() => {
            addAiButtonsToAllMessages();
            refreshDebounceTimer = null;
        }, 200);
    });

    // 只监听 #chat 直接子元素（.mes）的添加/删除/替换
    // 不监听 subtree，避免流式生成时频繁触发
    chatObserver.observe(chatEl, { childList: true });
}

/**
 * CHAT_CHANGED 处理：聊天切换时判断是否在聊天页
 * - 在聊天页 → 添加按钮
 * - 非聊天页 → 移除所有按钮（参考 contextBottomUI.removeUIfromContextBottom 模式）
 */
function onChatChanged() {
    // 复用 contextBottomUI.isInChatPage 判断聊天页
    if (isInChatPage()) {
        addAiButtonsToAllMessages();
    } else {
        debugLog(LOG_TAG, '非聊天页，移除所有 Cc 按钮');
        removeAllAiButtons();
    }
}

/**
 * 移除所有消息的 Cc 浮动按钮（含展开的菜单）
 *
 * 插件关闭时由 extensionSettingsManager.disableContinuityCore 调用，
 * 与 contextBottomUI.removeUIfromContextBottom 对齐。
 */
export function removeAllAiButtons() {
    if (currentMenu) closeInlineMenu();
    $('.ccore-mes-float-wrap').remove();
}
