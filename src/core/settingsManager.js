// 设置管理模块
import { extension_settings, loadExtensionSettings, saveSettingsDebounced, extensionName, defaultSettings } from "../index.js";

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

    // 根据设置启用或禁用扩展UI
    updateExtensionUIState(settings.enabled);
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

    // 通知提示词注入管理器开关状态变化
    if (window.continuityPromptInjector) {
        window.continuityPromptInjector.updateSettings(enabled,
            window.continuityPromptInjector.injectionDepth,
            window.continuityPromptInjector.injectionRole);
    }

    // 根据开关状态处理事件处理器
    if (window.continuityEventHandler) {
        if (enabled) {
            // 启用时：重新初始化事件处理器
            window.continuityEventHandler.reinitializeEventHandlers();
        } else {
            // 禁用时：销毁事件处理器，停止所有事件监听
            window.continuityEventHandler.destroy();
        }
    }

    toastr.info(enabled ? "Continuity Core 已启用" : "Continuity Core 已禁用");
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
