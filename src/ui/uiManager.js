// UI管理模块 - 基础UI功能
import {
    extensionFolderPath,
    loadSettingsToUI,
    onEnabledToggle,
    onBackendUrlChange,
    onDebugLogsToggle,
    onAutoInjectToggle,
    onPromptChange,
    onOrderPromptChange,
    onUsagePromptChange,
    onModuleDataPromptChange,
    onContainerStylesChange,
    onExternalStylesChange,
    onTimeFormatChange,
    updateInjectionSettingsVisibility,
    sendToBackend,
    saveModuleConfig,
    loadModuleConfig,
    renderModulesFromConfig,
    setBindModuleEvents,
    setOnRenderComplete,
    addModule,
    bindModuleEvents,
    updateModuleOrderNumbers,
    debugLog,
    errorLog,
    initJsonImportExport,
    bindSaveButtonEvent,
    bindAddModuleButtonEvent,
    bindClearModulesButtonEvent,
    rebindAllModulesEvents,
    updateAllModulesPreview,
    initPromptPreview,
    ExtractModuleController,
    initParseModule,
    extensionName,
    configManager,
    infoLog
} from '../index.js';

import { onButtonTypeChange, onBottomStylesChange } from './settingsManager.js';


// 加载CSS文件
function loadCSS() {
    // 加载所有拆分后的CSS文件
    const cssFiles = [
        'base.css',        // 基础样式
        'modules.css',     // 模块样式
        'variables.css',   // 变量样式
        'buttons.css',     // 按钮样式
        'preview.css',     // 预览样式
        'context-bottom-ui.css', // 上下文底部UI样式
        'responsive.css'   // 响应式样式
    ];

    cssFiles.forEach(fileName => {
        const link = document.createElement('link');
        link.id = `third-party_${extensionName}-css`;
        link.rel = 'stylesheet';
        link.href = `${extensionFolderPath}/assets/css/${fileName}`;
        document.head.appendChild(link);
    });
}

/**
 * 加载设置面板
 * @returns {Promise<void>}
 */
export async function loadSettingsPanel() {
    try {
        // 加载CSS文件
        loadCSS();

        // 从外部HTML文件加载设置面板结构
        const settingsHtml = await $.get(`${extensionFolderPath}/assets/html/settings-panel.html`);
        $('#extensions_settings').append(settingsHtml);

        // 绑定设置变更事件
        $('#continuity_enabled').on('input', onEnabledToggle);
        $('#continuity_backend_url').on('input', onBackendUrlChange);
        $('#continuity_debug_logs').on('input', onDebugLogsToggle);
        $('#continuity_button_type').on('change', onButtonTypeChange);

        // 加载设置到UI
        loadSettingsToUI();
    } catch (error) {
        errorLog('加载设置面板失败:', error);
        toastr.error('加载设置面板失败，请刷新页面重试。');
    }
}

/**
 * 创建模态背景
 */
function createModalBackdrop() {
    const backdrop = $('<div class="continuity-modal-backdrop" id="continuity-modal-backdrop"></div>');
    $('body').append(backdrop);

    // 点击背景关闭窗口
    backdrop.on('click', function () {
        closeModuleConfigWindow();
    });
}

/**
 * 打开模块配置窗口
 */
export async function openModuleConfigWindow() {
    try {
        // 检查是否已创建模态背景
        if (!$('#continuity-modal-backdrop').length) {
            createModalBackdrop();
        } else {
            // 如果背景已存在，重新绑定点击事件
            $('#continuity-modal-backdrop').off('click').on('click', closeModuleConfigWindow);
        }

        // 检查窗口是否已加载
        if (!$('#continuity-module-config-window').length) {
            // 加载窗口HTML
            const windowHtml = await $.get(`${extensionFolderPath}/assets/html/module-config-window.html`);
            $('body').append(windowHtml);

            // 绑定关闭事件
            $('#continuity-window-close').on('click', closeModuleConfigWindow);
            $('#module-cancel-btn').on('click', closeModuleConfigWindow);

            // 设置bindModuleEvents函数引用给moduleConfigManager
            setBindModuleEvents(bindModuleEvents);

            // 设置渲染完成回调，确保模块渲染后更新排序数字
            setOnRenderComplete(updateModuleOrderNumbers);

            // 绑定确认保存按钮事件
            bindSaveButtonEvent();

            // 绑定添加模块按钮事件
            bindAddModuleButtonEvent(addModule);

            // 绑定清空模块按钮事件
            bindClearModulesButtonEvent(function () {
                // 显示自定义确认弹窗
                showCustomConfirmDialog(
                    '清空所有模块',
                    '确定要清空所有模块吗？此操作将删除所有自定义模块，且无法撤销！',
                    function () {
                        // 用户确认清空 - 只删除模块项，保留标题栏和模板
                        // 使用更精确的选择器，确保只删除真正的模块项，保留.module-template
                        $('.custom-modules-container > div').not('.section-title, .module-template').remove();
                        // 更新模块排序数字
                        updateModuleOrderNumbers();
                        // 重新绑定所有模块事件
                        rebindAllModulesEvents();
                        // 更新所有模块的预览
                        updateAllModulesPreview();
                        toastr.success('所有模块已清空');
                    },
                    function () {
                        // 用户取消清空
                        debugLog('用户取消了清空模块操作');
                    }
                );
            });

            // 初始化JSON导入导出功能
            initJsonImportExport();

            // 初始化提示词预览功能
            initPromptPreview();

            // 尝试从本地存储加载配置
            const savedConfig = loadModuleConfig();
            if (savedConfig) {
                renderModulesFromConfig(savedConfig);
                // 重新绑定所有模块的事件
                rebindAllModulesEvents();
                // 更新所有模块的预览
                updateAllModulesPreview();
            } else {
                // 如果没有保存的配置，绑定现有模块的事件
                rebindAllModulesEvents();
                // 初始化解析模块功能
                initParseModule();
            }

            // 绑定自动注入开关事件
            $('#auto-inject-toggle').on('input', onAutoInjectToggle);

            // 绑定新提示词输入框事件
            $('#global-prompt-input').on('input', onPromptChange);
            $('#global-order-prompt-input').on('input', onOrderPromptChange);
            $('#global-usage-prompt-input').on('input', onUsagePromptChange);
            $('#global-module-data-prompt-input').on('input', onModuleDataPromptChange);
            $('#global-container-styles-input').on('input', onContainerStylesChange);
            $('#global-external-styles-input').on('input', onExternalStylesChange);
            $('#global-bottom-styles-input').on('input', onBottomStylesChange);
            $('#global-time-format-input').on('input', onTimeFormatChange);

            // 绑定设置区域折叠/展开事件
            $('#toggle-settings-btn').on('click', toggleSettings);

            // 加载设置到UI（包括自动注入开关状态）
            loadSettingsToUI();

            // 初始化分页标签切换逻辑
            initTabSwitching();

            // 初始化提取模块功能
            const extractModuleController = new ExtractModuleController();
            extractModuleController.init();
        }

        // 显示窗口和背景
        $('#continuity-module-config-window').addClass('show');
        $('#continuity-modal-backdrop').addClass('show');
    } catch (error) {
        errorLog('打开模块配置窗口失败:', error);
        toastr.error('打开窗口失败，请刷新页面重试。');
    }
}

/**
 * 显示自定义确认弹窗
 * @param {string} title 弹窗标题
 * @param {string} message 确认消息
 * @param {function} onConfirm 确认回调函数
 * @param {function} onCancel 取消回调函数
 */
export function showCustomConfirmDialog(title, message, onConfirm, onCancel) {
    // 创建确认弹窗HTML
    const confirmDialog = $(`
        <div id="continuity-confirm-dialog" class="continuity-confirm-dialog">
            <div class="confirm-dialog-content">
                <h3 class="confirm-dialog-title">${title}</h3>
                <p class="confirm-dialog-message">${message}</p>
                <div class="confirm-dialog-buttons">
                    <button class="confirm-dialog-btn confirm-dialog-cancel">取消</button>
                    <button class="confirm-dialog-btn confirm-dialog-confirm">确定</button>
                </div>
            </div>
        </div>
    `);

    // 添加到页面
    $('body').append(confirmDialog);

    // 绑定按钮事件
    confirmDialog.find('.confirm-dialog-confirm').on('click', function () {
        if (onConfirm) onConfirm();
        confirmDialog.remove();
    });

    confirmDialog.find('.confirm-dialog-cancel').on('click', function () {
        if (onCancel) onCancel();
        confirmDialog.remove();
    });

    // 点击背景关闭
    confirmDialog.on('click', function (e) {
        if (e.target === this) {
            if (onCancel) onCancel();
            confirmDialog.remove();
        }
    });

    // 显示弹窗
    setTimeout(() => {
        confirmDialog.addClass('show');
    }, 10);
}

/**
 * 关闭模块配置窗口
 */
export function closeModuleConfigWindow() {
    $('#continuity-module-config-window').removeClass('show');
    $('#continuity-modal-backdrop').removeClass('show');
    // 移除背景点击事件，避免内存泄漏
    $('#continuity-modal-backdrop').off('click');
}

/**
 * 创建FAB按钮和菜单
 */
export function createMenu() {
    // 获取按钮类型配置
    const extensionConfig = configManager.getExtensionConfig();
    if (!extensionConfig.enabled) {
        infoLog('Continuity Core 已禁用，不创建按钮');
        return;
    }
    const buttonType = extensionConfig.buttonType || 'embedded';

    if (buttonType === 'floating') {
        createFloatingButton();
    } else if (buttonType === 'embedded') {
        createEmbeddedButton();
    }
}

/**
 * 创建浮动按钮
 */
function createFloatingButton() {
    // 检查是否已经存在FAB菜单
    let fabContainer = $('#continuity-fab-container');

    if (fabContainer.length) {
        // 如果已经存在，直接显示并返回
        fabContainer.show();
        debugLog('FAB菜单已存在，直接显示');
        return;
    }

    // 创建更复杂的HTML结构，默认关闭菜单
    fabContainer = $(`
        <div id="continuity-fab-container">
            <div class="continuity-fab-menu">
                <button id="send-to-backend-btn" class="continuity-fab-item" style="display: none;">测试最新楼层</button>
                <button id="open-module-config-btn" class="continuity-fab-item">模块面板</button>
            </div>
            <button id="continuity-fab-main-btn" class="continuity-fab-item">
                <span>🔗</span>
            </button>
        </div>
    `);
    //<span>&#43;</span>

    // 将整个容器添加到body
    $('body').append(fabContainer);

    // 为主按钮绑定点击事件，用于展开/收起菜单
    $('#continuity-fab-main-btn').on('click', function () {
        $('#continuity-fab-container').toggleClass('open');
    });

    // 为"发送最新楼层"按钮绑定功能
    $('#send-to-backend-btn').on('click', sendToBackend);

    // 为"模块配置"按钮绑定功能
    $('#open-module-config-btn').on('click', function () {
        // 先关闭菜单
        $('#continuity-fab-container').removeClass('open');
        // 然后打开模块配置窗口
        openModuleConfigWindow();
    });

    debugLog('浮动按钮创建完成');
}

/**
 * 创建嵌入按钮
 */
function createEmbeddedButton() {
    // 检查是否已经存在嵌入按钮
    let embeddedButton = $('#continuity-embedded-button');

    if (embeddedButton.length) {
        // 如果已经存在，直接显示并返回
        embeddedButton.show();
        debugLog('嵌入按钮已存在，直接显示');
        return;
    }

    // 创建嵌入按钮（使用CSS样式）
    embeddedButton = $(`
        <button id="continuity-embedded-button" title="Continuity Core" tabindex="0">
            <span>🔗</span>
        </button>
    `);

    // 查找目标插入位置
    const leftSendForm = $('#form_sheld #send_form #nonQRFormItems #leftSendForm');

    if (leftSendForm.length) {
        // 插入到leftSendForm内的最后一个位置，使用CSS order确保显示在最后
        embeddedButton.css('order', '9999'); // 设置较高的order值确保显示在最后
        leftSendForm.append(embeddedButton);

        // 为嵌入按钮绑定点击事件
        embeddedButton.on('click', function () {
            openModuleConfigWindow();
        });

        debugLog('嵌入按钮创建完成');
    } else {
        errorLog('无法找到嵌入按钮插入位置：form_sheld > send_form > nonQRFormItems > leftSendForm');
    }
}

/**
 * 初始化分页标签切换逻辑
 */
function initTabSwitching() {
    // 绑定标签点击事件
    $('.tab-item').on('click', function () {
        // 移除所有标签的active类
        $('.tab-item').removeClass('active');
        // 为当前点击的标签添加active类
        $(this).addClass('active');

        // 获取要显示的标签内容ID
        const tabId = $(this).data('tab');
        // 隐藏所有标签内容
        $('.tab-content').removeClass('active');
        // 显示当前标签内容
        $(`#${tabId}-tab`).addClass('active');


    });
}

/**
 * 切换设置区域的折叠/展开状态
 */
export function toggleSettings() {
    try {
        const settingsContent = $('#settings-content');
        const toggleBtn = $('#toggle-settings-btn');

        if (settingsContent.is(':visible')) {
            // 如果当前是展开状态，则折叠
            settingsContent.slideUp(300);
            toggleBtn.removeClass('expanded');
            toggleBtn.html('<span class="toggle-arrow">▶</span> 展开设置');
            debugLog('设置区域已折叠');
        } else {
            // 如果当前是折叠状态，则展开
            settingsContent.slideDown(300);
            toggleBtn.addClass('expanded');
            toggleBtn.html('<span class="toggle-arrow">▼</span> 收起设置');
            debugLog('设置区域已展开');
        }
    } catch (error) {
        errorLog('切换设置区域失败:', error);
    }
}





