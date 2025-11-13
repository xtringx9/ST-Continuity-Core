// 设置管理模块
import { 
    extension_settings, 
    loadExtensionSettings, 
    saveSettingsDebounced, 
    extensionName, 
    defaultSettings,
    createFabMenu,
    EventHandler,
    PromptInjector,
    infoLog
} from "../index.js";
import { loadModuleConfig, renderModulesFromConfig } from "../modules/moduleConfigManager.js";

/**
 * 初始化扩展设置
 * @returns {Object} 当前设置对象
 */
export function initializeSettings() {
    // 如果设置不存在，创建默认设置
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    return extension_settings[extensionName];
}

/**
 * 加载设置到UI
 */
export function loadSettingsToUI() {
    const settings = initializeSettings();
    // 更新开关状态
    $("#continuity_enabled").prop("checked", settings.enabled).trigger("input");
    // 更新后端URL输入框
    $("#continuity_backend_url").val(settings.backendUrl).trigger("input");
    // 更新调试日志开关
    $("#continuity_debug_logs").prop("checked", settings.debugLogs).trigger("input");
    // 更新自动注入开关
    $("#auto-inject-toggle").prop("checked", settings.autoInject).trigger("input");

    // 根据设置启用或禁用扩展UI
    updateExtensionUIState(settings.enabled);
    
    // 根据自动注入开关状态更新插入设置区域的显示
    updateInjectionSettingsVisibility(settings.autoInject);
}

/**
 * 处理全局开关变更
 * @param {Event} event 事件对象
 */
export function onEnabledToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].enabled = enabled;
    saveSettingsDebounced();

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

    toastr.info(enabled ? "Continuity Core 已启用" : "Continuity Core 已禁用");
}

/**
 * 启用Continuity Core功能
 */
function enableContinuityCore() {
    try {
        // 创建FAB菜单
        createFabMenu();

        // 创建或重新初始化事件处理器
        if (!window.continuityEventHandler) {
            window.continuityEventHandler = new EventHandler();
        }
        window.continuityEventHandler.initialize();

        // 创建或重新初始化提示词注入管理器
        if (!window.continuityPromptInjector) {
            window.continuityPromptInjector = new PromptInjector();
        }
        window.continuityPromptInjector.initialize();

        // 自动加载模块配置到DOM（如果配置面板尚未打开）
        if ($('.module-item').length === 0) {
            const config = loadModuleConfig();
            if (config && config.modules && config.modules.length > 0) {
                renderModulesFromConfig(config);
                infoLog("已自动加载模块配置到DOM，共" + config.modules.length + "个模块");
            }
        }

        infoLog("Continuity Core 已启用，功能已激活");
    } catch (error) {
        console.error("启用Continuity Core失败:", error);
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

        // 销毁事件处理器
        if (window.continuityEventHandler) {
            window.continuityEventHandler.destroy();
        }

        // 销毁提示词注入管理器
        if (window.continuityPromptInjector) {
            window.continuityPromptInjector.destroy();
        }

        infoLog("Continuity Core 已禁用，功能已停止");
    } catch (error) {
        console.error("禁用Continuity Core失败:", error);
    }
}

/**
 * 处理后端URL变更
 * @param {Event} event 事件对象
 */
export function onBackendUrlChange(event) {
    const url = $(event.target).val();
    extension_settings[extensionName].backendUrl = url;
    saveSettingsDebounced();
}

/**
 * 处理调试日志开关变更
 * @param {Event} event 事件对象
 */
export function onDebugLogsToggle(event) {
    const debugLogs = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].debugLogs = debugLogs;
    saveSettingsDebounced();

    toastr.info(debugLogs ? "调试日志已启用" : "调试日志已禁用");
}

/**
 * 处理自动注入开关变更
 * @param {Event} event 事件对象
 */
export function onAutoInjectToggle(event) {
    const autoInject = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].autoInject = autoInject;
    saveSettingsDebounced();

    // 更新插入设置区域的显示
    updateInjectionSettingsVisibility(autoInject);

    toastr.info(autoInject ? "自动注入已启用" : "自动注入已禁用");
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
