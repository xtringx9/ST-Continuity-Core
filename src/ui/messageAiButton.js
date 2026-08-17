// src/ui/messageAiButton.js
// 为每条消息添加模块操作按钮（Cc 菜单触发器 + 展开的多框菜单）
// Cc 点击 → 同行右侧展开：[模块框: 重新生成 编辑 版本切换] [各 generator 框: 重新生成 编辑 版本切换] ...

import { chat } from '../../../../../../script.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../popup.js';
import { debugLog, infoLog, errorLog } from '../utils/logger.js';
import { moduleAiGenerator, hasPendingResult, reopenPendingDebugPanel } from '../services/moduleAiGenerator.js';
import configManager from '../singleton/configManager.js';
import generatedContentCache from '../singleton/generatedContentCache.js';
import { isInChatPage, openContextBottomAsModal, scheduleMsgBottom } from '../core/contextBottomUI.js';
import { readFloorModules, readAllGeneratorContents, getActiveGeneratorSwipe, setActiveGeneratorSwipe, writeGeneratorContent, deleteGeneratorContent, readGeneratorContent, appendGeneratorContent, FLOOR_MODULES_UPDATED_EVENT } from '../core/floorModuleStore.js';
import { parseNestedModules } from '../core/moduleExtractor.js';
import { taskRegistry } from '../core/taskRegistry.js';
import { showDebugPanel } from './generatorDebugPanel.js';
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

        // 楼层任务数显示（混合方案：有任务时按钮文字显示数字，无任务恢复 Cc）
        button.attr('data-mesid', messageId);
        _updateCcButtonText(button);

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
    const asyncEnabled = configManager.getModuleDomainConfig().asyncModule?.enabled ?? false;
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

    // 注意：不再绑定外部点击关闭（用户要求：再次点击小 Cc 才折叠，方便切版本时不误关菜单）
}

/**
 * 创建 inline 菜单（多框横向排列）
 *
 * 布局：[模块框: 重新生成 编辑 版本切换] [gen1框: 重新生成 编辑 版本切换] ...
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

    const asyncModule = configManager.getModuleDomainConfig().asyncModule || {};
    const asyncEnabled = !!asyncModule.enabled;

    // 1. 模块框：重新生成 + 编辑（+ 版本切换，无 label；「模块汇总」已隐藏——大 Cc 按钮已有）
    const moduleRegenIcon = hasPendingResult('modules', mesId) ? 'fa-hourglass-half' : 'fa-arrows-rotate';
    const moduleActions = [
        { action: 'regenerate', icon: moduleRegenIcon, title: '生成模块', needAsync: true },
        { action: 'edit', icon: 'fa-pen-to-square', title: '编辑模块', needAsync: true },
    ];
    menu.append(createMenuBox(moduleActions, asyncEnabled, triggerButton, mesId, null, 'modules'));

    // 2. 各 generator 框：每个启用的 generator 一个重新生成 + 编辑 + 版本切换（带 displayName label）
    const generators = configManager.getGenerators(); // 默认只返回启用的
    for (const gen of generators) {
        const genRegenIcon = hasPendingResult(gen.name, mesId) ? 'fa-hourglass-half' : 'fa-arrows-rotate';
        const genActions = [
            { action: `generate:${gen.name}`, icon: genRegenIcon, title: `生成${gen.displayName}`, needAsync: true },
            { action: `edit:${gen.name}`, icon: 'fa-pen-to-square', title: `编辑${gen.displayName}`, needAsync: true },
        ];
        menu.append(createMenuBox(genActions, asyncEnabled, triggerButton, mesId, gen.displayName, gen.name));
    }

    return menu;
}

/**
 * 创建菜单框（带边框容器，内含多个紧贴的按钮 + 版本切换）
 * @param {Array} actions - 按钮配置数组
 * @param {boolean} asyncEnabled - 异步存储是否开启
 * @param {jQuery} triggerButton - Cc 触发器
 * @param {number} mesId
 * @param {string} [label] - 框内前置 label 文本（如 generator 的 displayName）
 * @param {string} [genName] - generator 名（'modules' 或 generator.name），提供则加版本切换控件
 */
function createMenuBox(actions, asyncEnabled, triggerButton, mesId, label, genName) {
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

    // 版本切换控件（‹ 当前/总数 ›）：所有 generator 框（含模块）都有
    // 外层用带 data-ccore-ver-switcher 的容器，保存/删除/切版本后可按标记重建（刷新当前/总数）
    // ⚠️ 用 div（inline-flex 居中）而非 span：span 高度由继承 line-height 撑开，内部控件会贴到框底
    if (genName) {
        const switcherWrap = $('<div>')
            .attr('data-ccore-ver-switcher', genName)
            .css({ display: 'inline-flex', alignItems: 'center' });
        switcherWrap.append(createVersionSwitcher(mesId, genName));
        box.append(switcherWrap);
    }

    for (const { action, icon, title, needAsync } of actions) {
        const disabled = needAsync && !asyncEnabled;
        box.append(createMenuButton(action, icon, title, disabled, triggerButton, mesId));
    }

    return box;
}

/**
 * 创建版本切换控件：‹ 当前版本号/总数 ›
 * 点击左右箭头切换当前激活的生成内容版本（innerSwipe）。
 * @param {number} mesId
 * @param {string} genName
 * @returns {jQuery}
 */
function createVersionSwitcher(mesId, genName) {
    const outerSwipeId = chat[mesId]?.swipe_id ?? 0;
    // 与编辑区一致：includeEmpty=true（空版本计入总数，active 指向空版本时能正确匹配，避免 ?/1）
    const versions = readAllGeneratorContents(mesId, genName, outerSwipeId, { includeEmpty: true });
    const ids = Object.keys(versions).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    const active = getActiveGeneratorSwipe(mesId, genName, outerSwipeId);
    const activeIndex = ids.indexOf(active);

    const wrap = $('<div>').css({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0',
        fontSize: '11px',
        lineHeight: '1',
        color: 'var(--smart-body-text-color, inherit)',
        userSelect: 'none',
    });

    // 总数 0：不显示任何版本指示（避免 ?/0 占位）
    if (ids.length === 0) {
        return wrap;
    }

    // 只有存在多版本时才显示切换控件（避免单版本也占位）
    if (ids.length > 1) {
        const mkBtn = (dir, label) => $('<span>')
            .text(label)
            .attr('title', dir > 0 ? '下一个版本' : '上一个版本')
            .css({
                cursor: 'pointer',
                padding: '0 3px',
                color: 'var(--smart-body-text-color, inherit)',
                fontWeight: 'bold',
            })
            .on('click', (e) => {
                e.stopPropagation();
                switchGeneratorVersion(mesId, genName, dir);
            });
        const counter = $('<span>')
            .attr('data-ccore-ver-counter', genName)
            .text(`${activeIndex >= 0 ? activeIndex + 1 : '?'}\u200b/\u200b${ids.length}`)
            .css({ padding: '0 1px' });
        wrap.append(mkBtn(-1, '‹'), counter, mkBtn(1, '›'));
    } else {
        // 单版本：仍显示 1\u200b/\u200b1（提示已有内容），但无切换按钮
        const counter = $('<span>')
            .attr('data-ccore-ver-counter', genName)
            .text(`${activeIndex >= 0 ? activeIndex + 1 : '?'}\u200b/\u200b${ids.length}`)
            .css({ padding: '0 2px', opacity: '0.7' });
        wrap.append(counter);
    }

    return wrap;
}

/**
 * 切换某 generator 的激活版本（innerSwipe）到上一个/下一个。
 * 模块切版本后：若增量模块文本变化 → 刷新下游（suffix）；否则只刷该条（single）。
 * @param {number} mesId
 * @param {string} genName
 * @param {number} direction - -1=上一个, 1=下一个
 */
function switchGeneratorVersion(mesId, genName, direction) {
    const outerSwipeId = chat[mesId]?.swipe_id ?? 0;
    // 与编辑区一致：includeEmpty=true，保证 ids 与 createVersionSwitcher 的版本表一致
    const versions = readAllGeneratorContents(mesId, genName, outerSwipeId, { includeEmpty: true });
    const ids = Object.keys(versions).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    if (ids.length <= 1) return;
    const active = getActiveGeneratorSwipe(mesId, genName, outerSwipeId);
    const activeIndex = ids.indexOf(active);
    if (activeIndex === -1) return;
    const nextIndex = (activeIndex + direction + ids.length) % ids.length;
    const nextId = ids[nextIndex];
    if (nextId === active) return;

    // 模块：对比切换前后的增量模块文本，决定刷新范围
    if (genName === 'modules') {
        const before = readFloorModules(mesId, outerSwipeId);
        setActiveGeneratorSwipe(mesId, genName, outerSwipeId, nextId);
        const after = readFloorModules(mesId, outerSwipeId);
        if (_incrementalModulesChanged(before, after)) {
            infoLog(LOG_TAG, `切模块版本 ${active}→${nextId} 增量模块变化，刷新下游`);
            scheduleMsgBottom('suffix', mesId);
        } else {
            scheduleMsgBottom('single', mesId);
        }
    } else {
        // 非模块：仅切指针（不渲染 UI，只影响注入提示词），并同步内存缓存
        setActiveGeneratorSwipe(mesId, genName, outerSwipeId, nextId);
        generatedContentCache.set(mesId, genName, versions[nextId] || '');
    }

    // 更新版本计数显示（若菜单仍打开）
    const counter = $(`.ccore-mes-menu [data-ccore-ver-counter="${genName}"]`);
    if (counter.length) {
        const newIndex = ids.indexOf(nextId);
        counter.text(`${newIndex >= 0 ? newIndex + 1 : '?'}\u200b/\u200b${ids.length}`);
    }
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
            padding: '0 !important', // 覆盖 ST .mes_button 的 padding:1px 3px
            boxSizing: 'border-box', // height 含 padding/border，保证盒内居中
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

    // 菜单重建后按 taskRegistry 恢复生成按钮状态（修复：收起菜单再展开，生成中/结果态丢失）
    if (generatorName && !disabled) {
        let task = null;
        taskRegistry.forEach(t => {
            if (t.mesId === mesId && t.generatorName === generatorName) task = t;
        });
        if (task) {
            if (task.status === 'running') {
                setRegenButtonState(btn, STATE.LOADING, generatorName, mesId);
            } else if (task.status === 'success') {
                setRegenButtonState(btn, STATE.SUCCESS, generatorName, mesId);
            } else if (task.status === 'error') {
                setRegenButtonState(btn, STATE.ERROR, generatorName, mesId);
            } else {
                setRegenButtonState(btn, STATE.IDLE, generatorName, mesId);
            }
        }
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
        // 恢复 Cc 默认样式（按任务数决定显示数字或 Cc，避免覆盖任务计数）
        _updateCcButtonText(currentTrigger);
        currentTrigger.css({ backgroundColor: '', borderColor: '', color: '' });
    }
    currentTrigger = null;
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
 * 生成前弹窗让用户临时修改「追加指令」提示词（ST Popup + textarea，样式保持一致）。
 * 确认后返回修改后的提示词；取消/关闭/失败返回 null（调用方应中止本次生成）。
 * 留空时提示并回退默认（pipeline 模式必须要有生成指令，空值无法组装）。
 * @param {string} defaultPrompt 默认填入的「追加指令」
 * @returns {Promise<string|null>}
 */
async function _askPromptBeforeGenerate(defaultPrompt) {
    const $textarea = $('<textarea>')
        .addClass('text_pole')
        .val(defaultPrompt || '')
        .css({
            width: '100%',
            minHeight: '140px',
            resize: 'vertical',
            boxSizing: 'border-box',
            fontFamily: 'monospace',
            fontSize: '13px',
        });
    const $body = $('<div>').append(
        $('<p>').text('本次生成的追加指令（留空则使用默认）：').css({ margin: '0 0 6px 0' }),
        $textarea,
    );
    try {
        const result = await new Popup($body, POPUP_TYPE.CONFIRM, '修改生成提示词', {
            okButton: '生成',
            cancelButton: '取消',
        }).show();
        if (result !== POPUP_RESULT.AFFIRMATIVE) return null;
        const text = String($textarea.val() ?? '');
        if (text.trim() === '') {
            toastr.warning('追加指令为空，已使用默认追加指令');
            return defaultPrompt;
        }
        return text;
    } catch (err) {
        errorLog(LOG_TAG, '生成前提示词编辑弹窗失败:', err);
        return null;
    }
}

/**
 * 重新生成（模块或其他生成内容）
 * @param {jQuery} button - 被点击的"重新生成"菜单按钮
 * @param {number} mesId
 * @param {string} [generatorName='modules'] - 'modules' 或 generator.name
 */
async function onRegenerate(button, mesId, generatorName = 'modules') {
    // 正在生成中（taskRegistry 有 running 任务）→ 不重复生成；若已捕获 prompt 可打开生成中面板
    let runningTask = null;
    taskRegistry.forEach(t => {
        if (t.status === 'running' && t.mesId === mesId && t.generatorName === generatorName) runningTask = t;
    });
    if (runningTask) {
        // 生成中：已捕获到 prompt 则打开生成中调试面板（不重复发起生成）
        if (runningTask.debugData) {
            showDebugPanel(runningTask.debugData);
        } else {
            toastr.info('该楼层此内容正在生成中…');
        }
        return;
    }

    // 有该 generator + 楼层的未处理结果时，重新打开调试面板而非发起新生成
    if (hasPendingResult(generatorName, mesId)) {
        reopenPendingDebugPanel(generatorName, mesId);
        return;
    }

    // 从配置读取选项
    const asyncModule = configManager.getModuleDomainConfig().asyncModule || {};
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

        // 生成前询问：弹窗让用户临时修改「追加指令」（仅走 ST 管线时生效——raw 模式用自定义提示词，无「追加指令」概念）
        // 取消/关闭弹窗 → 中止本次生成（不发起请求）
        if (asyncModule.askPromptBeforeGenerate && (asyncModule.generationMode || 'pipeline') !== 'raw') {
            const editedPrompt = await _askPromptBeforeGenerate(options.pipelineModifier);
            if (editedPrompt === null) {
                debugLog(LOG_TAG, `用户取消生成前提示词编辑，中止楼层 ${mesId} ${generatorName} 的生成`);
                return;
            }
            options.pipelineModifier = editedPrompt;
        }
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
 * 委托通用版本编辑（genName='modules'），支持多版本切换 + 增量模块刷新判断
 */
async function onEditModules(mesId) {
    await onEditGeneratedContent(mesId, 'modules', { isModule: true });
}

/**
 * 编辑生成内容（小剧场、角色心理等）/ 模块数据（genName='modules'）
 * 支持多版本（innerSwipe）：编辑区顶部显示版本切换（‹ 当前/总数 ›），
 * 读取当前激活版本，保存写回当前编辑的版本（不自动切 active）。
 * @param {number} mesId
 * @param {string} generatorName - 'modules' 或 generator.name
 * @param {Object} [opts]
 * @param {boolean} [opts.isModule] - 模块编辑（保存后做增量模块判断刷新下游）
 */
async function onEditGeneratedContent(mesId, generatorName, opts = {}) {
    const isModule = opts.isModule === true || generatorName === 'modules';
    // 编辑/查看已存内容不要求异步开关开启（便于 debug 查看保存内容）
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

    const outerSwipeId = chat[mesId]?.swipe_id ?? 0;

    // 版本列表状态（含空版本，编辑区需看到手动新建的空版本）
    let versions = readAllGeneratorContents(mesId, generatorName, outerSwipeId, { includeEmpty: true });
    let ids = Object.keys(versions).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    let currentIndex = ids.indexOf(getActiveGeneratorSwipe(mesId, generatorName, outerSwipeId));
    if (currentIndex === -1) currentIndex = ids.length > 0 ? ids.length - 1 : -1;

    // 重新读取版本列表（新建/删除后刷新）
    const refreshVersions = () => {
        versions = readAllGeneratorContents(mesId, generatorName, outerSwipeId, { includeEmpty: true });
        ids = Object.keys(versions).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
        // 若 currentIndex 越界，回退到最后一个版本；无版本则 -1（显示空）
        if (ids.length === 0) {
            currentIndex = -1;
        } else if (currentIndex < 0 || currentIndex >= ids.length) {
            currentIndex = ids.length - 1;
        }
    };

    // 楼层/swipe 显示：仿 ST 聊天右下角 swipe 样式「#楼层 · 当前/总数」（formatSwipeCounter 的 x\u200b/y 格式）
    const totalSwipes = chat[mesId]?.swipes?.length ?? 1;
    const outerSwipeDisplay = `${Number(outerSwipeId) + 1}\u200b/\u200b${totalSwipes}`;

    // 构建编辑区（顶部栏：左=#楼层·swipe 计数，右=版本切换 + 新建/删除 + 确定/取消）
    // 按钮用 ST 原生 menu_button 样式 + FontAwesome 图标，但不用 mes_edit_* / mes_edit_buttons 类
    //（ST 编辑态逻辑会连坐控制 .mes_edit_buttons 显隐，script.js 点编辑显示、取消隐藏，会误伤我们的按钮）。
    // 内联覆盖小尺寸：缩小 padding / font-size，保持版本栏细高。
    const $editArea = $(`
        <div class="ccore-edit-area" style="position:relative;margin:5px 0;padding:5px;border:1px solid var(--smart-border-color,rgba(128,128,128,0.5));border-radius:5px;">
            <div class="ccore-edit-versionbar" style="display:flex;align-items:center;gap:4px;margin-bottom:4px;font-size:12px;color:var(--smart-body-text-color,inherit);min-height:24px;">
                <span class="ccore-edit-ver-outer" style="opacity:0.6;margin-right:auto;">#${mesId} · ${outerSwipeDisplay}</span>
                <span class="ccore-edit-ver-prev" style="cursor:pointer;font-weight:bold;padding:0 2px;" title="上一个版本">‹</span>
                <span class="ccore-edit-ver-label" data-ccore-ver-label style="padding:0 2px;min-width:20px;text-align:center;">0\u200b/\u200b0</span>
                <span class="ccore-edit-ver-next" style="cursor:pointer;font-weight:bold;padding:0 2px;" title="下一个版本">›</span>
                <span class="ccore-edit-ver-add menu_button interactable" style="cursor:pointer;font-size:11px;padding:1px 4px;line-height:1;margin:0;" title="新建版本" tabindex="0" role="button"><i class="fa-solid fa-plus"></i></span>
                <span class="ccore-edit-ver-del menu_button interactable" style="cursor:pointer;font-size:11px;padding:1px 4px;line-height:1;margin:0;" title="删除当前版本" tabindex="0" role="button"><i class="fa-solid fa-trash-can"></i></span>
                <div class="ccore-edit-actions" style="display:flex;gap:2px;margin-left:8px;">
                    <span class="ccore-edit-save menu_button interactable" style="cursor:pointer;font-size:11px;padding:1px 4px;line-height:1;margin:0;background-color:var(--okGreen70a);" title="确认" tabindex="0" role="button"><i class="fa-solid fa-check"></i></span>
                    <span class="ccore-edit-cancel menu_button interactable" style="cursor:pointer;font-size:11px;padding:1px 4px;line-height:1;margin:0;background-color:var(--crimson70a);" title="取消" tabindex="0" role="button"><i class="fa-solid fa-xmark"></i></span>
                </div>
            </div>
            <textarea class="edit_textarea mdHotkeys ccore-edit-textarea" style="width:100%;min-height:80px;resize:vertical;font-family:monospace;font-size:13px;box-sizing:border-box;"></textarea>
        </div>
    `);

    const $textarea = $editArea.find('.ccore-edit-textarea');
    const $verLabel = $editArea.find('.ccore-edit-ver-label');

    // 加载指定索引版本到 textarea；无版本时显示空 + 标签 0\u200b/\u200b0（仿 ST swipe 计数格式）
    const loadVersion = (idx) => {
        if (ids.length === 0) {
            currentIndex = -1;
            $textarea.val('');
            $verLabel.text(`0\u200b/\u200b0`);
            $editArea.find('.ccore-edit-ver-prev, .ccore-edit-ver-next').css('visibility', 'hidden');
            return;
        }
        if (idx < 0) idx = 0;
        if (idx >= ids.length) idx = ids.length - 1;
        currentIndex = idx;
        $textarea.val(versions[ids[idx]] || '');
        $verLabel.text(`${idx + 1}\u200b/\u200b${ids.length}`);
        $editArea.find('.ccore-edit-ver-prev, .ccore-edit-ver-next').css('visibility', ids.length > 1 ? 'visible' : 'hidden');
    };

    // 版本切换
    $editArea.find('.ccore-edit-ver-prev').on('click', (e) => {
        e.stopPropagation();
        if (ids.length <= 1) return;
        loadVersion((currentIndex - 1 + ids.length) % ids.length);
    });
    $editArea.find('.ccore-edit-ver-next').on('click', (e) => {
        e.stopPropagation();
        if (ids.length <= 1) return;
        loadVersion((currentIndex + 1) % ids.length);
    });

    // 新建版本：追加一个空版本并切到它
    $editArea.find('.ccore-edit-ver-add').on('click', (e) => {
        e.stopPropagation();
        try {
            const newId = appendGeneratorContent(mesId, generatorName, outerSwipeId, '');
            if (newId < 0) {
                toastr.error('新建版本失败');
                return;
            }
            refreshVersions();
            // 切到新版本（新版本是最大 id，位于数组末尾）
            const newIdx = ids.indexOf(newId);
            loadVersion(newIdx >= 0 ? newIdx : ids.length - 1);
        } catch (err) {
            errorLog(LOG_TAG, `新建版本失败:`, err);
            toastr.error(`新建版本失败：${err.message}`);
        }
    });

    // 删除当前版本（删除后回退到剩余最后一个；全删则显示空，保存可重建）
    // 用 ST 原生 Popup（POPUP_TYPE.CONFIRM）确认，不使用浏览器原生 confirm（与 promptEntryActions 一致）
    $editArea.find('.ccore-edit-ver-del').on('click', async (e) => {
        e.stopPropagation();
        if (ids.length === 0) return;
        const delIdx = currentIndex >= 0 ? currentIndex : ids.length - 1;
        const delSwipe = ids[delIdx];
        try {
            const $body = $('<div>').append(
                $('<p>').text(`确定删除版本 ${delIdx + 1}（共 ${ids.length} 个）吗？此操作不可恢复。`),
            );
            const result = await new Popup($body, POPUP_TYPE.CONFIRM, '', {
                okButton: '删除',
                cancelButton: '取消',
            }).show();
            if (result !== POPUP_RESULT.AFFIRMATIVE) return;
        } catch (err) {
            errorLog(LOG_TAG, '删除确认弹窗失败:', err);
            return;
        }
        const remainingAfter = ids.length - 1;
        // 删除前记录模块 active 文本（删除后 active 可能回退，需判断增量变化刷下游）
        const beforeModuleText = isModule ? readFloorModules(mesId, outerSwipeId) : '';
        try {
            deleteGeneratorContent(mesId, generatorName, outerSwipeId, delSwipe);
            // 若删除的是当前编辑版本，且后续还有版本 → 回退到删除位置或末尾；全删则空
            if (remainingAfter === 0) {
                refreshVersions();
                loadVersion(-1);
            } else {
                refreshVersions();
                loadVersion(Math.min(delIdx, ids.length - 1));
            }
            // 非模块同步内存缓存（删后 active 可能变化）
            if (!isModule && ids.length > 0) {
                const active = getActiveGeneratorSwipe(mesId, generatorName, outerSwipeId);
                generatedContentCache.set(mesId, generatorName, readGeneratorContent(mesId, generatorName, outerSwipeId, active) || '');
            }
            // 模块：删除导致 active 回退 → 对比删除前后模块文本，增量变化则刷下游
            if (isModule) {
                const afterModuleText = readFloorModules(mesId, outerSwipeId);
                if (_incrementalModulesChanged(beforeModuleText, afterModuleText)) {
                    infoLog(LOG_TAG, `消息 ${mesId} 删除版本 ${delSwipe} 后模块文本变化，刷新下游`);
                    scheduleMsgBottom('suffix', mesId);
                }
            }
            infoLog(LOG_TAG, `消息 ${mesId} ${generatorName} 删除版本 ${delSwipe}`);
        } catch (err) {
            errorLog(LOG_TAG, `删除版本失败:`, err);
            toastr.error(`删除版本失败：${err.message}`);
        }
    });

    loadVersion(currentIndex);
    $container.append($editArea);

    // 保存：无版本 → 新建（append 并激活）；有版本 → 写回当前编辑版本（不自动切 active）
    $editArea.find('.ccore-edit-save').on('click', async (e) => {
        const $btn = $(e.currentTarget);
        if ($btn.hasClass('disabled')) return;
        $btn.addClass('disabled').css('opacity', 0.5);
        const text = String($textarea.val() || '');
        let before = '';
        let targetSwipe;
        try {
            if (ids.length === 0 || currentIndex < 0) {
                // 无版本：保存即新建（append 自动激活）
                targetSwipe = appendGeneratorContent(mesId, generatorName, outerSwipeId, text);
                if (targetSwipe < 0) {
                    const msg = `保存失败：楼层 ${mesId} ${generatorName} 无法新建版本（楼层可能已不存在）`;
                    errorLog(LOG_TAG, msg);
                    toastr.error(msg);
                    $btn.removeClass('disabled').css('opacity', '');
                    return;
                }
                infoLog(LOG_TAG, `消息 ${mesId} ${generatorName} 数据已保存（新建版本 ${targetSwipe}，${text.length} 字符）`);
            } else {
                targetSwipe = ids[currentIndex];
                before = versions[targetSwipe] || '';
                // 写入指定版本（不自动改 active）
                writeGeneratorContent(mesId, generatorName, outerSwipeId, targetSwipe, text);
                infoLog(LOG_TAG, `消息 ${mesId} ${generatorName} 数据已保存到版本 ${targetSwipe}（${text.length} 字符）`);
            }
            // 非模块内容同步内存缓存（注入提示词用）
            if (!isModule) {
                generatedContentCache.set(mesId, generatorName, text);
            }
            $editArea.remove();
            $iframe.show();
            // 模块：对比编辑前后「增量模块文本」→ 变化则刷下游（suffix），否则只刷该条（single）
            if (isModule) {
                if (_incrementalModulesChanged(before, text)) {
                    infoLog(LOG_TAG, `消息 ${mesId} 增量模块文本变化，刷新下游`);
                    scheduleMsgBottom('suffix', mesId);
                } else {
                    scheduleMsgBottom('single', mesId);
                }
            }
        } catch (err) {
            errorLog(LOG_TAG, `保存消息 ${mesId} ${generatorName} 数据失败:`, err);
            toastr.error(`保存消息 ${mesId} ${generatorName} 数据失败：${err.message}`);
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

    // 任务状态变化 → 刷新所有小 Cc 按钮文字（楼层任务数）
    window.addEventListener(taskRegistry.TASK_UPDATE_EVENT, () => {
        _refreshAllCcButtons();
    });

    // 楼层生成内容变更（保存/追加新版本/删除/切版本）→ 重建菜单中对应 generator 的版本切换控件
    //（追加后 active 已切到新版本，但菜单 counter 是打开时的快照，需重建才显示新 当前/总数）
    window.addEventListener(FLOOR_MODULES_UPDATED_EVENT, (e) => {
        if (!currentMenu || e.detail?.mesId !== currentMenuMesId) return;
        currentMenu.find('[data-ccore-ver-switcher]').each(function () {
            const genName = $(this).attr('data-ccore-ver-switcher');
            if (genName) $(this).empty().append(createVersionSwitcher(currentMenuMesId, genName));
        });
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
 * 判断当前模块配置是否启用了增量模块（outputMode === 'incremental'）
 */
function _hasIncrementalModule() {
    return (configManager.getModules() || []).some(m => m.outputMode === 'incremental');
}

/**
 * 提取文本中所有模块块（形如 [模块名|...]）。
 * 复用 moduleExtractor 的栈式嵌套解析，返回含嵌套在内的全部模块 raw。
 * @param {string} content
 * @returns {string[]}
 */
function _extractModuleBlocks(content) {
    if (typeof content !== 'string' || !content) return [];
    return parseNestedModules(content).map(m => m.raw);
}

/**
 * 判断编辑前后「增量模块文本」是否发生变化。
 * 仅对比增量模块的 [模块|...] 块文本（存在≠变化，需文本不同才算变）。
 * @param {string} before 编辑前内容
 * @param {string} after 编辑后内容
 * @returns {boolean}
 */
function _incrementalModulesChanged(before, after) {
    if (!_hasIncrementalModule()) return false;
    const incNames = new Set((configManager.getModules() || [])
        .filter(m => m.outputMode === 'incremental')
        .map(m => m.name));

    const pickInc = (content) => _extractModuleBlocks(content)
        .filter(block => {
            const pipeIdx = block.indexOf('|');
            const name = pipeIdx > 0 ? block.slice(1, pipeIdx).trim() : '';
            return incNames.has(name);
        });

    const beforeInc = pickInc(before);
    const afterInc = pickInc(after);

    // 集合文本对比：长度不同或任一块不同 → 变了
    if (beforeInc.length !== afterInc.length) return true;
    for (let i = 0; i < beforeInc.length; i++) {
        if (beforeInc[i] !== afterInc[i]) return true;
    }
    return false;
}

/**
 * 更新单个小 Cc 按钮文字（混合方案：有任务显示数字，无任务恢复 Cc）
 * @param {jQuery} button - Cc 触发器
 */
function _updateCcButtonText(button) {
    const mesId = Number(button.attr('data-mesid'));
    if (isNaN(mesId)) return;
    const count = taskRegistry.getRunningCountForMes(mesId);
    if (count > 0) {
        // 有任务：只改文字为数字 + title，保持与普通 Cc 相同的透明度/颜色
        button.text(count > 99 ? '99+' : String(count));
        button.attr('title', `${count} 个任务进行中`);
    } else {
        button.text('Cc');
        button.attr('title', BUTTON_TITLE);
    }
}

/**
 * 刷新所有小 Cc 按钮文字（任务状态变化时调用）
 */
function _refreshAllCcButtons() {
    $('.mes_ai_generate[data-mesid]').each(function () {
        _updateCcButtonText($(this));
    });
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
