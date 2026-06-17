// src/ui/extensionSettingsManager.js

import configManager, { extensionFolderPath } from "../singleton/configManager.js";
import { infoLog, errorLog, debugLog } from "../utils/logger.js";
import { removeUIfromContextBottom } from "../core/contextBottomUI.js";
import {
    addWorldBookToGlobalSettings,
    removeWorldBookFromGlobalSettings,
    WORLD_BOOK_CONSTANTS
} from "../utils/worldBookUtils.js"
import { registerContinuityRegexPattern } from "../utils/regexUtils.js"
import { EntryButton } from "../features/entry/EntryButton.js";
import perMessageStorage from "../services/perMessageStorage.js";
import { moduleAiGenerator } from "../services/moduleAiGenerator.js";
import { chat, chat_metadata, this_chid, characters, getCurrentChatDetails } from '../../../../../../script.js';

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

    // AI 生成设置
    $("#continuity_generation_mode").val(asyncModule.generationMode || 'pipeline');
    $("#continuity_use_independent_api").prop("checked", asyncModule.useIndependentApi || false);
    $("#continuity_raw_system_prompt").val(asyncModule.rawSystemPrompt || '');
    $("#continuity_raw_user_prompt").val(asyncModule.rawUserPromptTemplate || '');
    $("#continuity_pipeline_modifier").val(asyncModule.pipelineModifier || '');
    $("#continuity_show_debug").prop("checked", asyncModule.showDebug !== false);

    // 独立 API 设置
    const customApi = asyncModule.customApi || {};
    $("#continuity_custom_api_url").val(customApi.apiurl || '');
    $("#continuity_custom_api_key").val(customApi.key || '');
    $("#continuity_custom_api_model").val(customApi.model || '');
    $("#continuity_custom_api_source").val(customApi.source || 'openai');
    $("#continuity_custom_api_temperature").val(customApi.temperature ?? 0.3);
    $("#continuity_custom_api_max_tokens").val(customApi.max_tokens ?? 500);

    // 根据生成模式显示/隐藏对应设置
    _updateGenerationModeVisibility(asyncModule.generationMode || 'pipeline');

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
export async function onAsyncExtractChat() {
    try {
        if (!chat || chat.length === 0) {
            toastr.warning('没有打开的聊天');
            return;
        }

        const charName = _getCurrentCharName();
        const chatFile = _getCurrentChatFileName();
        if (!charName || !chatFile) {
            toastr.warning('无法获取当前聊天信息');
            return;
        }

        const chatIdHash = _getCurrentChatIdHash();
        const cotTags = configManager.getGlobalSettings().cotTags || [];

        infoLog(`[AsyncStorage] 开始提取当前聊天: ${charName} / ${chatFile}, 共 ${chat.length} 条消息`);

        // 初始化存储
        await perMessageStorage.initChat(charName, chatFile, chatIdHash);

        let extractedCount = 0;
        for (let i = 0; i < chat.length; i++) {
            const message = chat[i];
            if (!message || (message.mes === undefined && message.content === undefined)) continue;

            const activeSwipeId = message.swipe_id ?? 0;
            const swipesData = _extractAllSwipes(message, cotTags);

            // 检查是否有任何 swipe 含模块数据
            const hasModules = Object.values(swipesData).some(sd =>
                sd.moduleTagModules.length > 0
                || sd.contentTagModules.length > 0
                || sd.extraModules.length > 0
            );

            if (hasModules) {
                await perMessageStorage.writeMessage(i, activeSwipeId, swipesData);
                extractedCount++;
            }
        }

        infoLog(`[AsyncStorage] 提取完成: ${extractedCount} 条消息含模块数据`);
        toastr.success(`提取完成，${extractedCount} 条消息含模块数据`);
    } catch (err) {
        errorLog('[AsyncStorage] 提取当前聊天失败:', err);
        toastr.error('提取失败，请查看控制台');
    }
}

/**
 * 提取指定楼层的模块数据到存储
 */
export async function onAsyncExtractFloor() {
    const input = prompt('输入楼层范围，楼层从0开始（如 5 或 5-10）:');
    if (!input) return;

    try {
        let from, to;
        if (input.includes('-')) {
            const parts = input.split('-').map(s => parseInt(s.trim(), 10));
            if (parts.length !== 2 || parts.some(isNaN)) {
                toastr.warning('格式错误，请输入如 5 或 5-10');
                return;
            }
            [from, to] = parts;
        } else {
            from = to = parseInt(input, 10);
            if (isNaN(from)) {
                toastr.warning('格式错误，请输入如 5 或 5-10');
                return;
            }
        }

        if (!chat || chat.length === 0) {
            toastr.warning('没有打开的聊天');
            return;
        }

        from = Math.max(0, from);
        to = Math.min(chat.length - 1, to);

        const charName = _getCurrentCharName();
        const chatFile = _getCurrentChatFileName();
        const chatIdHash = _getCurrentChatIdHash();
        const cotTags = configManager.getGlobalSettings().cotTags || [];

        await perMessageStorage.initChat(charName, chatFile, chatIdHash);

        let extractedCount = 0;
        for (let i = from; i <= to; i++) {
            const message = chat[i];
            if (!message || (message.mes === undefined && message.content === undefined)) continue;

            const activeSwipeId = message.swipe_id ?? 0;
            const swipesData = _extractAllSwipes(message, cotTags);

            const hasModules = Object.values(swipesData).some(sd =>
                sd.moduleTagModules.length > 0
                || sd.contentTagModules.length > 0
                || sd.extraModules.length > 0
            );

            if (hasModules) {
                await perMessageStorage.updateMessage(i, activeSwipeId, swipesData);
                extractedCount++;
            }
        }

        infoLog(`[AsyncStorage] 提取楼层 ${from}-${to} 完成: ${extractedCount} 条含模块`);
        toastr.success(`提取完成，${extractedCount} 条消息含模块数据`);
    } catch (err) {
        errorLog('[AsyncStorage] 提取指定楼层失败:', err);
        toastr.error('提取失败，请查看控制台');
    }
}

/**
 * 从脏标记层开始重建累积状态快照
 */
export async function onAsyncRebuildSnapshots() {
    try {
        if (!perMessageStorage.currentChat) {
            toastr.warning('请先提取聊天数据');
            return;
        }

        const meta = perMessageStorage.metaCache;
        if (!meta) {
            toastr.info('无 meta 数据，无需重建');
            return;
        }

        const dirtyFrom = meta.dirtyFromMesId;
        if (dirtyFrom === null || dirtyFrom === undefined) {
            toastr.info('快照均为最新，无需重建');
            return;
        }

        infoLog(`[AsyncStorage] 从楼层 ${dirtyFrom} 开始重建快照`);
        // TODO: 实现快照重建逻辑（Phase 3）
        toastr.info('快照重建功能将在后续阶段实现');
    } catch (err) {
        errorLog('[AsyncStorage] 重建快照失败:', err);
        toastr.error('重建失败，请查看控制台');
    }
}

// ==========================================
// 内部辅助
// ==========================================

function _getCurrentCharName() {
    const details = getCurrentChatDetails();
    return details?.characterName || '';
}

function _getCurrentChatFileName() {
    const details = getCurrentChatDetails();
    return details?.sessionName ?? '';
}

function _getCurrentChatIdHash() {
    return `${chat_metadata?.chat_id || ''}_${chat_metadata?.chat_id_hash || ''}`;
}

/**
 * 从消息中提取所有 swipe 的模块数据
 * ST 消息结构：mes（当前swipe文本）、swipes（所有swipe文本数组）、swipe_id（当前索引）
 * @param {object} message - ST 聊天消息对象
 * @param {string[]} cotTags - 内容标签列表
 * @returns {Object<string, { moduleTagModules: string[], contentTagModules: string[], extraModules: string[] }>}
 */
function _extractAllSwipes(message, cotTags) {
    const swipesData = {};

    // 如果有 swipes 数组，提取所有 swipe
    if (Array.isArray(message.swipes) && message.swipes.length > 0) {
        for (let si = 0; si < message.swipes.length; si++) {
            const swipeText = message.swipes[si];
            if (swipeText) {
                swipesData[si] = perMessageStorage.extractMessageModules(swipeText, cotTags);
            }
        }
    } else {
        // 无 swipes 数组，只提取 mes
        const rawText = message.mes !== undefined ? message.mes : message.content;
        if (rawText) {
            swipesData[0] = perMessageStorage.extractMessageModules(rawText, cotTags);
        }
    }

    return swipesData;
}

// ==========================================
// AI 生成相关函数
// ==========================================

/**
 * 根据生成模式显示/隐藏对应设置区域
 */
function _updateGenerationModeVisibility(mode) {
    $('#continuity_raw_settings').toggle(mode === 'raw');
    $('#continuity_pipeline_settings').toggle(mode === 'pipeline');
}

/**
 * 从 UI 读取 AI 生成配置
 */
function _getAiGenerationOptions() {
    const extensionConfig = configManager.getExtensionConfig();
    const asyncModule = extensionConfig.asyncModule || {};
    const cotTags = configManager.getGlobalSettings().cotTags || [];

    const useIndependentApi = $('#continuity_use_independent_api').prop('checked');
    let customApi = null;
    if (useIndependentApi) {
        const apiUrl = $('#continuity_custom_api_url').val()?.trim();
        if (apiUrl) {
            customApi = {
                apiurl: apiUrl,
                key: $('#continuity_custom_api_key').val()?.trim() || '',
                model: $('#continuity_custom_api_model').val()?.trim() || '',
                source: $('#continuity_custom_api_source').val() || 'openai',
                temperature: parseFloat($('#continuity_custom_api_temperature').val()) || 0.3,
                max_tokens: parseInt($('#continuity_custom_api_max_tokens').val(), 10) || 0,
            };
        }
    }

    return {
        mode: $('#continuity_generation_mode').val() || 'pipeline',
        customApi,
        rawSystemPrompt: $('#continuity_raw_system_prompt').val()?.trim() || '',
        rawUserPrompt: $('#continuity_raw_user_prompt').val()?.trim() || '',
        pipelineModifier: $('#continuity_pipeline_modifier').val()?.trim() || '',
        cotTags,
        showDebug: $('#continuity_show_debug').prop('checked'),
    };
}

/**
 * 保存 AI 生成配置到 extensionConfig
 */
function _saveAiGenerationConfig() {
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.asyncModule = extensionConfig.asyncModule || {};

    extensionConfig.asyncModule.generationMode = $('#continuity_generation_mode').val() || 'pipeline';
    extensionConfig.asyncModule.useIndependentApi = $('#continuity_use_independent_api').prop('checked');
    extensionConfig.asyncModule.rawSystemPrompt = $('#continuity_raw_system_prompt').val()?.trim() || '';
    extensionConfig.asyncModule.rawUserPromptTemplate = $('#continuity_raw_user_prompt').val()?.trim() || '';
    extensionConfig.asyncModule.pipelineModifier = $('#continuity_pipeline_modifier').val()?.trim() || '';
    extensionConfig.asyncModule.showDebug = $('#continuity_show_debug').prop('checked');

    extensionConfig.asyncModule.customApi = {
        apiurl: $('#continuity_custom_api_url').val()?.trim() || '',
        key: $('#continuity_custom_api_key').val()?.trim() || '',
        model: $('#continuity_custom_api_model').val()?.trim() || '',
        source: $('#continuity_custom_api_source').val() || 'openai',
        temperature: parseFloat($('#continuity_custom_api_temperature').val()) || 0.3,
        max_tokens: parseInt($('#continuity_custom_api_max_tokens').val(), 10) || 500,
    };

    configManager.setExtensionConfig(extensionConfig);
}

/**
 * 生成模式切换
 */
export function onGenerationModeChange(event) {
    const mode = $(event.target).val();
    _updateGenerationModeVisibility(mode);
    _saveAiGenerationConfig();
}

/**
 * AI 生成配置字段变更（通用）
 */
export function onAiConfigChange() {
    _saveAiGenerationConfig();
}

/**
 * AI 生成指定楼层
 */
export async function onAiGenerateFloor() {
    const input = prompt('输入楼层范围，楼层从0开始（如 5 或 5-10）:');
    if (!input) return;

    try {
        let from, to;
        if (input.includes('-')) {
            const parts = input.split('-').map(s => parseInt(s.trim(), 10));
            if (parts.length !== 2 || parts.some(isNaN)) {
                toastr.warning('格式错误，请输入如 5 或 5-10');
                return;
            }
            [from, to] = parts;
        } else {
            from = to = parseInt(input, 10);
            if (isNaN(from)) {
                toastr.warning('格式错误，请输入如 5 或 5-10');
                return;
            }
        }

        if (!chat || chat.length === 0) {
            toastr.warning('没有打开的聊天');
            return;
        }

        from = Math.max(0, from);
        to = Math.min(chat.length - 1, to);

        const charName = _getCurrentCharName();
        const chatFile = _getCurrentChatFileName();
        const chatIdHash = _getCurrentChatIdHash();

        await perMessageStorage.initChat(charName, chatFile, chatIdHash);

        const options = _getAiGenerationOptions();
        infoLog(`[AiGenerate] 开始 AI 生成楼层 ${from}-${to}，模式: ${options.mode}`);

        // 构建楼层 ID 列表，只做一次 AI 调用
        const mesIds = [];
        for (let i = from; i <= to; i++) mesIds.push(i);

        const result = await moduleAiGenerator.generate(mesIds, options);

        toastr.success(result.success ? 'AI 生成完成' : 'AI 回复中未提取到模块数据');
    } catch (err) {
        errorLog('[AiGenerate] AI 生成失败:', err);
        toastr.error('AI 生成失败，请查看控制台');
    }
}

/**
 * AI 生成当前聊天所有楼层
 */
export async function onAiGenerateChat() {
    try {
        if (!chat || chat.length === 0) {
            toastr.warning('没有打开的聊天');
            return;
        }

        const charName = _getCurrentCharName();
        const chatFile = _getCurrentChatFileName();
        const chatIdHash = _getCurrentChatIdHash();

        await perMessageStorage.initChat(charName, chatFile, chatIdHash);

        const options = _getAiGenerationOptions();
        infoLog(`[AiGenerate] 开始 AI 生成当前聊天，共 ${chat.length} 条消息，模式: ${options.mode}`);

        // 构建楼层 ID 列表，只做一次 AI 调用
        const mesIds = [];
        for (let i = 0; i < chat.length; i++) mesIds.push(i);

        const result = await moduleAiGenerator.generate(mesIds, options);

        toastr.success(result.success ? 'AI 生成完成' : 'AI 回复中未提取到模块数据');
    } catch (err) {
        errorLog('[AiGenerate] AI 生成失败:', err);
        toastr.error('AI 生成失败，请查看控制台');
    }
}
