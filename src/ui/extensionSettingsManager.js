// src/ui/extensionSettingsManager.js

import {
    configManager,
    infoLog,
    errorLog,
    removeUIfromContextBottom,
    extensionFolderPath,
} from "../index.js";
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
    const elementsToToggle = [$('#continuity_backend_url'), $('#continuity_debug_logs'), $('#continuity_button_type'), $('#continuity_test_backend')];
    elementsToToggle.forEach(el => el.prop("disabled", !enabled));
}
