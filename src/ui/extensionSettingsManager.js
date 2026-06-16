// src/ui/extensionSettingsManager.js

import configManager, { extensionFolderPath } from "../singleton/configManager.js";
import { infoLog, errorLog } from "../utils/logger.js";
import { removeUIfromContextBottom } from "../core/contextBottomUI.js";
import {
    addWorldBookToGlobalSettings,
    removeWorldBookFromGlobalSettings,
    WORLD_BOOK_CONSTANTS
} from "../utils/worldBookUtils.js"
import { registerContinuityRegexPattern } from "../utils/regexUtils.js"
import { EntryButton } from "../features/entry/EntryButton.js";

/**
 * Sets the global enabled state of the extension.
 * @param {boolean} enabled
 */
export function setExtensionEnabled(enabled) {
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.enabled = Boolean(enabled);
    configManager.setExtensionConfig(extensionConfig);
}

/**
 * Loads current settings from configManager into the UI elements.
 */
export function loadSettingsToUI() {
    const extensionConfig = configManager.getExtensionConfig();

    $("#continuity_enabled").prop("checked", extensionConfig.enabled);
    $("#continuity_backend_url").val(extensionConfig.backendUrl);
    $("#continuity_debug_logs").prop("checked", extensionConfig.debugLogs);
    $("#continuity_button_type").val(extensionConfig.buttonType || "embedded");

    // 异步模块存储设置
    const asyncModule = extensionConfig.asyncModule || {};
    $("#continuity_async_enabled").prop("checked", asyncModule.enabled || false);
    $("#continuity_snapshot_interval").val(asyncModule.snapshotInterval || 5);

    updateExtensionUIState(extensionConfig.enabled);
}

/**
 * Handles the main 'enabled' toggle switch change.
 * @param {Event} event
 */
export function onEnabledToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    setExtensionEnabled(enabled);
    updateExtensionUIState(enabled);

    if (enabled) {
        enableContinuityCore();
    } else {
        disableContinuityCore();
    }
}

/**
 * Handles the backend URL input change.
 * @param {Event} event
 */
export function onBackendUrlChange(event) {
    const url = $(event.target).val();
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.backendUrl = url;
    configManager.setExtensionConfig(extensionConfig);
}

/**
 * Handles the debug logs checkbox change.
 * @param {Event} event
 */
export function onDebugLogsToggle(event) {
    const debugLogs = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.debugLogs = debugLogs;
    configManager.setExtensionConfig(extensionConfig);
}

/**
 * Handles the button type dropdown change.
 * @param {Event} event
 */
export function onButtonTypeChange(event) {
    const buttonType = $(event.target).val();
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.buttonType = buttonType;
    configManager.setExtensionConfig(extensionConfig);

    new EntryButton(extensionFolderPath).init();
}

/**
 * Handles the async module storage enabled toggle change.
 * @param {Event} event
 */
export function onAsyncEnabledToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.asyncModule.enabled = enabled;
    configManager.setExtensionConfig(extensionConfig);
    updateAsyncActionsVisibility(enabled);
}

/**
 * Handles the snapshot interval input change.
 * @param {Event} event
 */
export function onSnapshotIntervalChange(event) {
    let value = parseInt($(event.target).val(), 10);
    if (isNaN(value) || value < 1) value = 1;
    if (value > 100) value = 100;
    $(event.target).val(value);

    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.asyncModule.snapshotInterval = value;
    configManager.setExtensionConfig(extensionConfig);
}

function enableContinuityCore() {
    try {
        new EntryButton(extensionFolderPath).init();
        addWorldBookToGlobalSettings(WORLD_BOOK_CONSTANTS.worldBookName, true);
        registerContinuityRegexPattern();
        infoLog("♥️ Continuity Core has been enabled.");
    } catch (error) {
        errorLog("Failed to enable Continuity Core:", error);
        toastr.error("Failed to enable Continuity Core, check console.");
    }
}

function disableContinuityCore() {
    try {
        new EntryButton(extensionFolderPath).remove();
        removeUIfromContextBottom();
        removeWorldBookFromGlobalSettings(WORLD_BOOK_CONSTANTS.worldBookName, true);
        registerContinuityRegexPattern();
        infoLog("♥️ Continuity Core has been disabled.");
    } catch (error) {
        errorLog("Failed to disable Continuity Core:", error);
    }
}

function updateExtensionUIState(enabled) {
    const elementsToToggle = [$('#continuity_backend_url'), $('#continuity_debug_logs'), $('#continuity_button_type'), $('#continuity_test_backend'),
        $('#continuity_async_enabled'), $('#continuity_snapshot_interval')];
    elementsToToggle.forEach(el => el.prop("disabled", !enabled));

    // 异步存储操作按钮显隐
    const asyncEnabled = enabled && (configManager.getExtensionConfig().asyncModule?.enabled ?? false);
    updateAsyncActionsVisibility(asyncEnabled);
}

function updateAsyncActionsVisibility(visible) {
    $('#continuity_async_actions_divider').toggle(visible);
    $('#continuity_async_actions').toggle(visible);
}

/**
 * 提取当前聊天所有楼层的模块数据到存储
 */
export function onAsyncExtractChat() {
    infoLog('[AsyncStorage] 提取当前聊天 — 功能待实现');
    // TODO: 调用 perMessageStorage 提取整个聊天
}

/**
 * 提取指定楼层的模块数据到存储
 */
export function onAsyncExtractFloor() {
    infoLog('[AsyncStorage] 提取指定楼层 — 功能待实现');
    // TODO: 弹窗输入楼层范围，调用 perMessageStorage 提取
}

/**
 * 从脏标记层开始重建累积状态快照
 */
export function onAsyncRebuildSnapshots() {
    infoLog('[AsyncStorage] 重建快照 — 功能待实现');
    // TODO: 调用 perMessageStorage 重建快照
}
