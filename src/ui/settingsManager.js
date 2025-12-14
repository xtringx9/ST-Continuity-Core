// 设置管理模块 - 已重构为使用configManager单例
import {
    configManager, loadModuleConfig, renderModulesFromConfig,
    createFabMenu,
    infoLog,
    errorLog,
    removeUIfromContextBottom,
} from "../index.js";

/**
 * 设置扩展启用状态（全局函数）
 * @param {boolean} enabled 是否启用
 */
export function setExtensionEnabled(enabled) {
    // 使用configManager更新扩展配置
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.enabled = Boolean(enabled);
    configManager.setExtensionConfig(extensionConfig);
}

/**
 * 加载设置到UI
 */
export function loadSettingsToUI() {
    // 使用configManager获取扩展配置
    const extensionConfig = configManager.getExtensionConfig();

    // 更新开关状态（不触发input事件，避免重复初始化）
    $("#continuity_enabled").prop("checked", extensionConfig.enabled);
    // 更新后端URL输入框
    $("#continuity_backend_url").val(extensionConfig.backendUrl);
    // 更新调试日志开关
    $("#continuity_debug_logs").prop("checked", extensionConfig.debugLogs);
    // 更新自动注入开关
    $("#auto-inject-toggle").prop("checked", extensionConfig.autoInject);

    // 根据设置启用或禁用扩展UI
    updateExtensionUIState(extensionConfig.enabled);

    // 根据自动注入开关状态更新插入设置区域的显示
    updateInjectionSettingsVisibility(extensionConfig.autoInject);
}

/**
 * 处理全局开关变更
 * @param {Event} event 事件对象
 */
export function onEnabledToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));

    // 使用全局函数设置状态
    setExtensionEnabled(enabled);

    // 更新UI状态
    updateExtensionUIState(enabled);

    // 根据开关状态处理插件功能
    if (enabled) {
        // 启用时：创建或重新初始化所有组件
        enableContinuityCore();
    } else {
        // 禁用时：销毁所有组件，停止所有功能
        disableContinuityCore();
    }

    // toastr.info(enabled ? "Continuity Core 已启用" : "Continuity Core 已禁用");
}

/**
 * 启用Continuity Core功能
 */
function enableContinuityCore() {
    try {
        // 创建FAB菜单
        createFabMenu();

        // 自动加载模块配置到DOM（如果配置面板尚未打开）
        if ($('.module-item').length === 0) {
            const config = loadModuleConfig();
            if (config && config.modules && config.modules.length > 0) {
                renderModulesFromConfig(config);
                infoLog("已自动加载模块配置到DOM，共" + config.modules.length + "个模块");
            }
        }

        infoLog("♥️ Continuity Core 已启用，功能已激活");
    } catch (error) {
        errorLog("启用Continuity Core失败:", error);
        toastr.error("启用Continuity Core失败，请检查控制台");
    }
}

/**
 * 禁用Continuity Core功能
 */
function disableContinuityCore() {
    try {
        // 隐藏FAB菜单
        const fabContainer = $("#continuity-fab-container");
        if (fabContainer.length) {
            fabContainer.hide();
        }

        // 主动移除已插入的UI
        removeUIfromContextBottom();
        infoLog("已移除上下文底部UI");

        infoLog("♥️ Continuity Core 已禁用，功能已停止（事件监听器仍存在）");
    } catch (error) {
        errorLog("禁用Continuity Core失败:", error);
    }
}

/**
 * 处理后端URL变更
 * @param {Event} event 事件对象
 */
export function onBackendUrlChange(event) {
    const url = $(event.target).val();

    // 使用configManager更新扩展配置
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.backendUrl = url;
    configManager.setExtensionConfig(extensionConfig);
}

/**
 * 处理调试日志开关变更
 * @param {Event} event 事件对象
 */
export function onDebugLogsToggle(event) {
    const debugLogs = Boolean($(event.target).prop("checked"));

    // 使用configManager更新扩展配置
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.debugLogs = debugLogs;
    configManager.setExtensionConfig(extensionConfig);

    // toastr.info(debugLogs ? "调试日志已启用" : "调试日志已禁用");
}

/**
 * 处理核心原则提示词变更
 * @param {Event} event 事件对象
 */
export function onPromptChange(event) {
    const moduleConfig = configManager.getGlobalSettings();
    const prompt = $(event.target).val();
    moduleConfig.prompt = prompt;
    configManager.setGlobalSettings(moduleConfig);
}

/**
 * 处理通用格式描述提示词变更
 * @param {Event} event 事件对象
 */
export function onOrderPromptChange(event) {
    const orderPrompt = $(event.target).val();
    const moduleConfig = configManager.getGlobalSettings();
    moduleConfig.orderPrompt = orderPrompt;
    configManager.setGlobalSettings(moduleConfig);
}

/**
 * 处理使用指南提示词变更
 * @param {Event} event 事件对象
 */
export function onUsagePromptChange(event) {
    const usagePrompt = $(event.target).val();
    const moduleConfig = configManager.getGlobalSettings();
    moduleConfig.usagePrompt = usagePrompt;
    configManager.setGlobalSettings(moduleConfig);
}

/**
 * 处理模块数据提示词变更
 * @param {Event} event 事件对象
 */
export function onModuleDataPromptChange(event) {
    const moduleDataPrompt = $(event.target).val();
    const moduleConfig = configManager.getGlobalSettings();
    moduleConfig.moduleDataPrompt = moduleDataPrompt;
    configManager.setGlobalSettings(moduleConfig);
}

/**
 * 处理容器样式变更
 * @param {Event} event 事件对象
 */
export function onContainerStylesChange(event) {
    const containerStyles = $(event.target).val();
    const moduleConfig = configManager.getGlobalSettings();
    moduleConfig.containerStyles = containerStyles;
    configManager.setGlobalSettings(moduleConfig);
}

/**
 * 处理外部样式变更
 * @param {Event} event 事件对象
 */
export function onExternalStylesChange(event) {
    const externalStyles = $(event.target).val();
    const moduleConfig = configManager.getGlobalSettings();
    moduleConfig.externalStyles = externalStyles;
    configManager.setGlobalSettings(moduleConfig);
}

/**
 * 处理时间格式变更
 * @param {Event} event 事件对象
 */
export function onTimeFormatChange(event) {
    const timeFormat = $(event.target).val();
    const moduleConfig = configManager.getGlobalSettings();
    moduleConfig.timeFormat = timeFormat;
    configManager.setGlobalSettings(moduleConfig);
}

/**
 * 处理自动注入开关变更
 * @param {Event} event 事件对象
 */
export function onAutoInjectToggle(event) {
    const autoInject = Boolean($(event.target).prop("checked"));

    // 使用configManager更新扩展配置
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.autoInject = autoInject;
    configManager.setExtensionConfig(extensionConfig);

    // 更新插入设置区域的显示
    updateInjectionSettingsVisibility(autoInject);

    // toastr.info(autoInject ? "自动注入已启用" : "自动注入已禁用");
}

/**
 * 更新插入设置区域的可见性
 * @param {boolean} autoInject 是否启用自动注入
 */
export function updateInjectionSettingsVisibility(autoInject) {
    const injectionSettings = $("#injection-settings");
    if (autoInject) {
        injectionSettings.slideDown(300);
    } else {
        injectionSettings.slideUp(300);
    }
}

/**
 * 更新扩展UI状态（显示或隐藏）
 * @param {boolean} enabled 是否启用
 */
export function updateExtensionUIState(enabled) {
    // 处理FAB菜单
    const fabContainer = $("#continuity-fab-container");
    if (enabled) {
        fabContainer.show();
    } else {
        fabContainer.hide();
    }

    // 处理设置面板中的其他控件（除了全局开关）
    const backendUrlInput = $("#continuity_backend_url");
    const debugLogsCheckbox = $("#continuity_debug_logs");

    if (enabled) {
        // 启用时：显示并启用所有控件
        backendUrlInput.prop("disabled", false);
        debugLogsCheckbox.prop("disabled", false);

        // 移除禁用样式
        backendUrlInput.removeClass("disabled-input");
        debugLogsCheckbox.parent().removeClass("disabled-control");
    } else {
        // 禁用时：禁用除全局开关外的所有控件
        backendUrlInput.prop("disabled", true);
        debugLogsCheckbox.prop("disabled", true);

        // 添加禁用样式
        backendUrlInput.addClass("disabled-input");
        debugLogsCheckbox.parent().addClass("disabled-control");
    }
}
