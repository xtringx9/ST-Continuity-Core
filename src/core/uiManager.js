// UI管理模块 - 基础UI功能
import {
    extensionFolderPath,
    loadSettingsToUI,
    onEnabledToggle,
    onBackendUrlChange,
    onDebugLogsToggle,
    onAutoInjectToggle,
    onCorePrinciplesChange,
    onFormatDescriptionChange,
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
    initParseModule
} from '../index.js';

// 导入用于测试的extractModulesFromChat功能
import { PromptInjector } from '../core/promptInjector.js';

// 加载CSS文件
function loadCSS() {
    // 加载所有拆分后的CSS文件
    const cssFiles = [
        'base.css',        // 基础样式
        'modules.css',     // 模块样式
        'variables.css',   // 变量样式
        'buttons.css',     // 按钮样式
        'preview.css',     // 预览样式
        'context-bottom.css', // 上下文底部UI样式
        'responsive.css'   // 响应式样式
    ];

    cssFiles.forEach(fileName => {
        const link = document.createElement('link');
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
            bindSaveButtonEvent(function (modules, globalSettings) {
                // 保存配置到本地存储
                if (saveModuleConfig(modules, globalSettings)) {
                    toastr.success('模块配置已保存！');
                } else {
                    toastr.error('保存模块配置失败');
                }
            });

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
                        console.log('用户取消了清空模块操作');
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
            $('#core-principles-input').on('input', onCorePrinciplesChange);
            $('#format-description-input').on('input', onFormatDescriptionChange);

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
export function createFabMenu() {
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
                <button id="send-to-backend-btn" class="continuity-fab-item">发送最新楼层</button>
                <button id="open-module-config-btn" class="continuity-fab-item">模块面板</button>
            </div>
            <button id="continuity-fab-main-btn" class="continuity-fab-item">
                <span>&#43;</span>
            </button>
        </div>
    `);

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



    debugLog('FAB菜单创建完成');
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

        // 如果是界面配置标签，初始化界面配置功能
        if (tabId === 'ui') {
            initUIConfig();
        }
    });
}

/**
 * 初始化界面配置功能
 */
function initUIConfig() {
    // 绑定界面配置按钮事件
    bindUIConfigEvents();

    // 初始化UI模块管理
    initUIModuleManagement();

    // 初始化UI预览功能
    initUIPreview();
}

/**
 * 绑定界面配置按钮事件
 */
function bindUIConfigEvents() {
    // 绑定取消按钮事件
    $('#ui-cancel-btn').on('click', closeModuleConfigWindow);

    // 绑定保存按钮事件
    $('#ui-save-btn').on('click', saveUIConfig);

    // 绑定导入UI配置按钮事件
    $('#import-ui-config-btn').on('click', importUIConfig);

    // 绑定导出UI配置按钮事件
    $('#export-ui-config-btn').on('click', exportUIConfig);

    // 绑定添加UI模块按钮事件
    $('#add-ui-module-btn').on('click', addUIModule);

    // 绑定清空UI模块按钮事件
    $('#clear-ui-modules-btn').on('click', clearUIModules);

    // 绑定切换UI预览按钮事件
    $('#toggle-ui-preview-btn').on('click', toggleUIPreview);

    // 绑定更新UI预览按钮事件
    $('#update-ui-preview-btn').on('click', updateUIPreview);

    // 绑定复制UI配置按钮事件
    $('#copy-ui-config-btn').on('click', copyUIConfig);
}

/**
 * 初始化UI模块管理
 */
function initUIModuleManagement() {
    // 绑定UI模块事件
    bindUIModuleEvents();

    // 加载保存的UI配置
    loadUIConfig();
}

/**
 * 绑定UI模块事件
 */
function bindUIModuleEvents() {
    // 绑定UI模块展开/折叠事件
    $(document).on('click', '.ui-module-toggle-expand-btn', function () {
        const $moduleItem = $(this).closest('.ui-module-item');
        const $variablesContainer = $moduleItem.find('.ui-variables-container');
        const $toggleArrow = $moduleItem.find('.toggle-ui-variables .arrow');
        const $toggleText = $moduleItem.find('.toggle-ui-variables .text');

        if ($variablesContainer.is(':visible')) {
            $variablesContainer.hide();
            $toggleArrow.text('▶');
            $toggleText.text('展开变量');
        } else {
            $variablesContainer.show();
            $toggleArrow.text('▼');
            $toggleText.text('收起变量');
        }
    });

    // 绑定添加UI变量按钮事件
    $(document).on('click', '.add-ui-variable', function () {
        const $moduleItem = $(this).closest('.ui-module-item');
        addUIVariable($moduleItem);
    });

    // 绑定删除UI模块按钮事件
    $(document).on('click', '.remove-ui-module', function () {
        const $moduleItem = $(this).closest('.ui-module-item');
        showCustomConfirmDialog(
            '删除UI模块',
            '确定要删除此UI模块吗？此操作无法撤销！',
            function () {
                $moduleItem.remove();
                updateUIModuleOrderNumbers();
                updateUIPreview();
                toastr.success('UI模块已删除');
            }
        );
    });

    // 绑定删除UI变量按钮事件
    $(document).on('click', '.remove-ui-variable', function () {
        const $variableItem = $(this).closest('.ui-variable-item');
        $variableItem.remove();
        updateUIVariableOrderNumbers($(this).closest('.ui-module-item'));
        updateUIPreview();
    });

    // 绑定代码输入框变化事件
    $(document).on('input', '.ui-module-style-code, .ui-variable-style-code', function () {
        updateCodePreview($(this));
    });

    // 绑定切换UI变量按钮事件
    $(document).on('click', '.toggle-ui-variables', function () {
        const $moduleItem = $(this).closest('.ui-module-item');
        const $variablesContainer = $moduleItem.find('.ui-variables-container');
        const $arrow = $(this).find('.arrow');
        const $text = $(this).find('.text');

        if ($variablesContainer.is(':visible')) {
            $variablesContainer.hide();
            $arrow.text('▶');
            $text.text('展开变量');
        } else {
            $variablesContainer.show();
            $arrow.text('▼');
            $text.text('收起变量');
        }
    });
}

/**
 * 添加UI模块
 */
function addUIModule() {
    const $template = $('.ui-module-template').clone();
    const $moduleItem = $template.find('.ui-module-item');

    // 移除模板类并显示
    $template.removeClass('ui-module-template').show();

    // 添加到容器
    $('.ui-config-section').append($template);

    // 更新模块序号
    updateUIModuleOrderNumbers();

    // 更新变量计数
    updateUIVariableCounts();

    // 更新预览
    updateUIPreview();
}

/**
 * 添加UI变量
 */
function addUIVariable($moduleItem) {
    const $template = $('.ui-variable-template').clone();
    const $variableItem = $template.find('.ui-variable-item');

    // 移除模板类并显示
    $template.removeClass('ui-variable-template').show();

    // 添加到变量容器
    $moduleItem.find('.ui-variables-container').append($template);

    // 更新变量序号
    updateUIVariableOrderNumbers($moduleItem);

    // 更新变量计数
    updateUIVariableCounts();

    // 更新预览
    updateUIPreview();
}

/**
 * 清空UI模块
 */
function clearUIModules() {
    showCustomConfirmDialog(
        '清空所有UI模块',
        '确定要清空所有UI模块吗？此操作将删除所有UI配置，且无法撤销！',
        function () {
            // 只删除UI模块项，保留标题栏和模板
            $('.ui-config-section > div').not('.section-title, .ui-module-template, .ui-preview-section').remove();
            updateUIPreview();
            toastr.success('所有UI模块已清空');
        }
    );
}

/**
 * 更新UI模块序号
 */
function updateUIModuleOrderNumbers() {
    $('.ui-module-item').each(function (index) {
        const $moduleItem = $(this);
        const $orderNumber = $moduleItem.find('.ui-module-order-number');
        $orderNumber.text(index + 1);
    });
}

/**
 * 更新UI变量序号
 */
function updateUIVariableOrderNumbers($moduleItem) {
    $moduleItem.find('.ui-variable-item').each(function (index) {
        const $variableItem = $(this);
        const $orderNumber = $variableItem.find('.ui-variable-order-number');
        $orderNumber.text(index + 1);
    });
}

/**
 * 更新UI变量计数
 */
function updateUIVariableCounts() {
    $('.ui-module-item').each(function () {
        const $moduleItem = $(this);
        const variableCount = $moduleItem.find('.ui-variable-item').length;
        const $variableCount = $moduleItem.find('.ui-variable-count');
        $variableCount.text(`(${variableCount})`);
    });
}

/**
 * 更新代码预览
 */
function updateCodePreview($codeElement) {
    const code = $codeElement.val().trim();
    const $previewContent = $codeElement.closest('.code-editor-container').find('.code-preview-content');

    if (code) {
        $previewContent.text(code);
    } else {
        $previewContent.text('// 暂无代码');
    }
}

/**
 * 初始化UI预览功能
 */
function initUIPreview() {
    // 绑定预览模式选择事件
    $('#ui-preview-mode-select').on('change', updateUIPreview);

    // 初始更新预览
    updateUIPreview();
}

/**
 * 切换UI预览
 */
function toggleUIPreview() {
    const $previewContent = $('#ui-preview-content');
    const $toggleArrow = $('#toggle-ui-preview-btn .toggle-arrow');

    if ($previewContent.is(':visible')) {
        $previewContent.hide();
        $toggleArrow.text('▶');
        $('#toggle-ui-preview-btn').html('<span class="toggle-arrow">▶</span> 展开预览');
    } else {
        $previewContent.show();
        $toggleArrow.text('▼');
        $('#toggle-ui-preview-btn').html('<span class="toggle-arrow">▼</span> 收起预览');
        updateUIPreview();
    }
}

/**
 * 更新UI预览
 */
function updateUIPreview() {
    const previewMode = $('#ui-preview-mode-select').val();
    const uiConfig = getUIConfig();

    let previewText = '';

    switch (previewMode) {
        case 'json':
            previewText = JSON.stringify(uiConfig, null, 2);
            break;
        case 'css':
            previewText = generateUICSS(uiConfig);
            break;
        case 'html':
            previewText = generateUIHTML(uiConfig);
            break;
        default:
            previewText = JSON.stringify(uiConfig, null, 2);
    }

    $('#ui-preview-textarea').val(previewText);
}

/**
 * 获取UI配置
 */
function getUIConfig() {
    const uiConfig = {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        configType: 'ui',
        modulesUI: []
    };

    $('.ui-module-item').each(function () {
        const $moduleItem = $(this);
        const moduleUI = {
            moduleName: $moduleItem.find('.ui-module-name').val() || '',
            displayName: $moduleItem.find('.ui-module-display-name').val() || '',
            enabled: $moduleItem.find('.ui-module-enabled-toggle').is(':checked'),
            moduleStyle: $moduleItem.find('.ui-module-style-code').val() || '',
            variablesUI: []
        };

        $moduleItem.find('.ui-variable-item').each(function () {
            const $variableItem = $(this);
            const variableUI = {
                variableName: $variableItem.find('.ui-variable-name').val() || '',
                displayName: $variableItem.find('.ui-variable-display-name').val() || '',
                variableStyle: $variableItem.find('.ui-variable-style-code').val() || ''
            };

            moduleUI.variablesUI.push(variableUI);
        });

        uiConfig.modulesUI.push(moduleUI);
    });

    return uiConfig;
}

/**
 * 生成UI CSS代码
 */
function generateUICSS(uiConfig) {
    let cssCode = '/* Continuity UI CSS配置 */\n\n';

    uiConfig.modulesUI.forEach(moduleUI => {
        if (moduleUI.moduleStyle) {
            cssCode += `/* ${moduleUI.moduleName} 模块样式 */\n`;
            cssCode += moduleUI.moduleStyle + '\n\n';
        }

        moduleUI.variablesUI.forEach(variableUI => {
            if (variableUI.variableStyle) {
                cssCode += `/* ${moduleUI.moduleName}.${variableUI.variableName} 变量样式 */\n`;
                cssCode += variableUI.variableStyle + '\n\n';
            }
        });
    });

    return cssCode;
}

/**
 * 生成UI HTML结构
 */
function generateUIHTML(uiConfig) {
    let htmlCode = '<!-- Continuity UI HTML结构 -->\n\n';

    uiConfig.modulesUI.forEach(moduleUI => {
        htmlCode += `<!-- ${moduleUI.moduleName} 模块 -->\n`;
        htmlCode += `<div class="continuity-module ${moduleUI.moduleName}">\n`;

        moduleUI.variablesUI.forEach(variableUI => {
            htmlCode += `  <!-- ${variableUI.variableName} 变量 -->\n`;
            htmlCode += `  <div class="continuity-variable ${variableUI.variableName}">\n`;
            htmlCode += `    <span class="variable-name">${variableUI.displayName || variableUI.variableName}</span>\n`;
            htmlCode += `    <span class="variable-value">[值]</span>\n`;
            htmlCode += `  </div>\n`;
        });

        htmlCode += `</div>\n\n`;
    });

    return htmlCode;
}

/**
 * 保存UI配置
 */
function saveUIConfig() {
    const uiConfig = getUIConfig();

    try {
        localStorage.setItem('continuity-ui-config', JSON.stringify(uiConfig));
        toastr.success('UI配置已保存！');
    } catch (error) {
        errorLog('保存UI配置失败:', error);
        toastr.error('保存UI配置失败');
    }
}

/**
 * 加载UI配置
 */
function loadUIConfig() {
    try {
        const savedConfig = localStorage.getItem('continuity-ui-config');
        if (savedConfig) {
            const uiConfig = JSON.parse(savedConfig);
            renderUIConfig(uiConfig);
        }
    } catch (error) {
        errorLog('加载UI配置失败:', error);
    }
}

/**
 * 渲染UI配置
 */
function renderUIConfig(uiConfig) {
    // 清空现有UI模块
    $('.ui-config-section > div').not('.section-title, .ui-module-template, .ui-preview-section').remove();

    // 渲染UI模块
    uiConfig.modulesUI.forEach(moduleUI => {
        addUIModule();
        const $lastModule = $('.ui-module-item').last();

        // 设置模块属性
        $lastModule.find('.ui-module-name').val(moduleUI.moduleName || '');
        $lastModule.find('.ui-module-display-name').val(moduleUI.displayName || '');
        $lastModule.find('.ui-module-enabled-toggle').prop('checked', moduleUI.enabled !== false);
        $lastModule.find('.ui-module-style-code').val(moduleUI.moduleStyle || '');

        // 渲染UI变量
        moduleUI.variablesUI.forEach(variableUI => {
            addUIVariable($lastModule);
            const $lastVariable = $lastModule.find('.ui-variable-item').last();

            // 设置变量属性
            $lastVariable.find('.ui-variable-name').val(variableUI.variableName || '');
            $lastVariable.find('.ui-variable-display-name').val(variableUI.displayName || '');
            $lastVariable.find('.ui-variable-style-code').val(variableUI.variableStyle || '');
        });

        // 更新代码预览
        updateCodePreview($lastModule.find('.ui-module-style-code'));
        $lastModule.find('.ui-variable-style-code').each(function () {
            updateCodePreview($(this));
        });
    });

    // 更新序号和计数
    updateUIModuleOrderNumbers();
    updateUIVariableCounts();
    updateUIPreview();
}

/**
 * 导入UI配置
 */
function importUIConfig() {
    // 创建文件输入元素
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';

    fileInput.onchange = function (event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const uiConfig = JSON.parse(e.target.result);
                renderUIConfig(uiConfig);
                toastr.success('UI配置导入成功！');
            } catch (error) {
                errorLog('导入UI配置失败:', error);
                toastr.error('导入UI配置失败，请检查文件格式');
            }
        };
        reader.readAsText(file);
    };

    fileInput.click();
}

/**
 * 导出UI配置
 */
function exportUIConfig() {
    const uiConfig = getUIConfig();
    const configJson = JSON.stringify(uiConfig, null, 2);

    // 创建下载链接
    const blob = new Blob([configJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `continuity-ui-config-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toastr.success('UI配置导出成功！');
}

/**
 * 复制UI配置
 */
function copyUIConfig() {
    const previewText = $('#ui-preview-textarea').val();

    navigator.clipboard.writeText(previewText).then(() => {
        toastr.success('UI配置已复制到剪贴板！');
    }).catch(err => {
        errorLog('复制UI配置失败:', err);
        toastr.error('复制UI配置失败');
    });
}




