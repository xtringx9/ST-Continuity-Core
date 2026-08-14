// src/ui/extensionSettingsManager.js

import configManager, { extensionFolderPath } from "../singleton/configManager.js";
import moduleCacheManager from "../singleton/moduleCacheManager.js";
import { infoLog, errorLog, debugLog } from "../utils/logger.js";
import { removeUIfromContextBottom } from "../core/contextBottomUI.js";
import { addAiButtonsToAllMessages, removeAllAiButtons } from "../ui/messageAiButton.js";
import {
    addWorldBookToGlobalSettings,
    removeWorldBookFromGlobalSettings,
    WORLD_BOOK_CONSTANTS
} from "../utils/worldBookUtils.js"
import { registerContinuityRegexPattern } from "../utils/regexUtils.js"
import { EntryButton } from "../features/entry/EntryButton.js";
import { initMessageRangeView, removeMessageRangeView } from "../features/message-range-view/MessageRangeView.js";
import { initQuickReplyOptimize, removeQuickReplyOptimize } from "../features/quick-reply-optimize/QuickReplyOptimize.js";
import { initMessageScrollToTop, removeMessageScrollToTop, addScrollTopButtonsToAllMessages, removeAllScrollTopButtons } from "../features/messageScrollToTop.js";
import { initSendHijack, removeSendHijack } from "../features/send-hijack/SendHijack.js";
import { initWorldBookBinding, removeWorldBookBinding } from "../features/world-book-binding/worldBookBinding.js";
import { initPromptBinding, removePromptBinding } from "../features/prompt-binding/promptBinding.js";
import { initPromptEntryActions, removePromptEntryActions } from "../features/prompt-entry-actions/promptEntryActions.js";
import { escapeHtmlEntities as escapeHtml } from "../utils/textConverter.js";
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
    // 设置面板表单：读/写均直接操作 getExtensionConfig() 返回的配置对象引用。
    // 保留直读原因：①写路径需直接赋值（如 extensionConfig.server.url = ...）再 setExtensionConfig 落盘，
    //   getter 只读不适用；②统一入口已是 get/setExtensionConfig，无需再经领域 getter 绕一层。
    const extensionConfig = configManager.getExtensionConfig();

    $("#continuity_enabled").prop("checked", extensionConfig.enabled);
    $("#continuity_backend_url").val(extensionConfig.server?.url);
    $("#continuity_debug_logs").prop("checked", extensionConfig.debug?.global === true);
    $("#continuity_button_type").val(extensionConfig.module?.buttonType || "embedded");
    $("#continuity_message_range_view").prop("checked", extensionConfig.stFeatureEnhance?.messageRangeView !== false);
    $("#continuity_quick_reply_optimize").prop("checked", Boolean(extensionConfig.stFeatureEnhance?.quickReplyOptimize));
    $("#continuity_send_hijack").prop("checked", Boolean(extensionConfig.stFeatureEnhance?.sendHijack?.enabled));
    populateSendHijackOptions();
    $("#continuity_scroll_to_top").prop("checked", Boolean(extensionConfig.stFeatureEnhance?.scrollToTop?.enabled));
    $("#continuity_smooth_scroll_to_top").prop("checked", extensionConfig.stFeatureEnhance?.scrollToTop?.smoothScroll !== false);
    $("#continuity_show_per_message_buttons").prop("checked", Boolean(extensionConfig.stFeatureEnhance?.scrollToTop?.showPerMessageButtons));
    $("#continuity_world_book_binding").prop("checked", extensionConfig.stFeatureEnhance?.worldBookBinding?.enabled !== false);
    $("#continuity_prompt_binding").prop("checked", extensionConfig.stFeatureEnhance?.promptBinding?.enabled !== false);
    $("#continuity_prompt_entry_actions").prop("checked", extensionConfig.stFeatureEnhance?.promptEntryActions?.enabled !== false);
    $("#continuity_nai_preset_switcher").prop("checked", extensionConfig.stFeatureEnhance?.naiPresetSwitcher?.enabled !== false);
    $("#continuity_include_hidden_messages").prop("checked", extensionConfig.module?.includeHiddenMessages?.enabled !== false);

    // 异步模块存储设置
    const asyncModule = extensionConfig.module?.asyncModule || {};
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
    extensionConfig.server = extensionConfig.server || {};
    extensionConfig.server.url = url;
    configManager.setExtensionConfig(extensionConfig);
}

/**
 * Handles the debug logs checkbox change.
 * @param {Event} event
 */
export function onDebugLogsToggle(event) {
    const debugLogs = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.debug = extensionConfig.debug || {};
    extensionConfig.debug.global = debugLogs;
    configManager.setExtensionConfig(extensionConfig);
}

/**
 * Handles the button type dropdown change.
 * @param {Event} event
 */
export function onButtonTypeChange(event) {
    const buttonType = $(event.target).val();
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.module = extensionConfig.module || {};
    extensionConfig.module.buttonType = buttonType;
    configManager.setExtensionConfig(extensionConfig);

    new EntryButton(extensionFolderPath).init();
}

/**
 * Handles the message range view entry toggle change.
 * @param {Event} event
 */
export function onMessageRangeViewToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    extensionConfig.stFeatureEnhance.messageRangeView = enabled;
    configManager.setExtensionConfig(extensionConfig);

    if (enabled) {
        initMessageRangeView();
    } else {
        removeMessageRangeView();
    }
}

/**
 * Handles the quick reply optimize toggle change.
 * @param {Event} event
 */
export function onQuickReplyOptimizeToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    extensionConfig.stFeatureEnhance.quickReplyOptimize = enabled;
    configManager.setExtensionConfig(extensionConfig);

    if (enabled) {
        initQuickReplyOptimize();
    } else {
        removeQuickReplyOptimize();
    }
}

/**
 * 填充发送劫持的两级 QR 下拉（集合 + 条目）
 * 依赖 globalThis.quickReplyApi，QR 扩展未就绪时给出提示并使下拉不可用。
 * 在 APP_READY 后对应用户新建/改名集合：由 SettingsPanel 在 <select> 聚焦时触发重填。
 */
export function populateSendHijackOptions() {
    const api = globalThis.quickReplyApi;
    const $set = $("#continuity_send_hijack_set");
    const $label = $("#continuity_send_hijack_label");
    const cfg = configManager.getExtensionConfig().stFeatureEnhance?.sendHijack || {};

    if (!api) {
        $set.html('<option value="">（Quick Reply 不可用）</option>').prop("disabled", true);
        $label.html('<option value="">（Quick Reply 不可用）</option>').prop("disabled", true);
        return;
    }

    let sets = [];
    try { sets = api.listSets() || []; } catch { sets = []; }
    $set.prop("disabled", false).html(
        '<option value="">— 未选择 —</option>' +
        sets.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")
    );
    $set.val(sets.includes(cfg.set) ? cfg.set : "");

    populateSendHijackLabelOptions();
}

/**
 * 根据当前选中的 QR 集合填充条目下拉
 */
export function populateSendHijackLabelOptions() {
    const api = globalThis.quickReplyApi;
    const setName = String($("#continuity_send_hijack_set").val() || "");
    const $label = $("#continuity_send_hijack_label");
    const cfg = configManager.getExtensionConfig().stFeatureEnhance?.sendHijack || {};

    if (!api || !setName) {
        $label.html('<option value="">— 未选择 —</option>').prop("disabled", !setName);
        return;
    }

    let labels = [];
    try { labels = api.listQuickReplies(setName) || []; } catch { labels = []; }
    $label.prop("disabled", false).html(
        '<option value="">— 未选择 —</option>' +
        labels.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("")
    );
    $label.val(labels.includes(cfg.label) ? cfg.label : "");
}

/**
 * 发送键劫持开关切换
 * @param {Event} event
 */
export function onSendHijackToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    extensionConfig.stFeatureEnhance.sendHijack = { ...(extensionConfig.stFeatureEnhance.sendHijack || {}), enabled };
    configManager.setExtensionConfig(extensionConfig);

    if (enabled) {
        initSendHijack();
    } else {
        removeSendHijack();
    }
}

/**
 * 发送键劫持目标 QR 集合切换：清空条目并联动刷新二级下拉
 */
export function onSendHijackSetChange() {
    const setName = String($("#continuity_send_hijack_set").val() || "");
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    extensionConfig.stFeatureEnhance.sendHijack = { ...(extensionConfig.stFeatureEnhance.sendHijack || {}), set: setName, label: "" };
    configManager.setExtensionConfig(extensionConfig);
    populateSendHijackLabelOptions();
}

/**
 * 发送键劫持目标 QR 条目切换
 */
export function onSendHijackLabelChange() {
    const label = String($("#continuity_send_hijack_label").val() || "");
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    extensionConfig.stFeatureEnhance.sendHijack = { ...(extensionConfig.stFeatureEnhance.sendHijack || {}), label };
    configManager.setExtensionConfig(extensionConfig);
}

/**
 * Handles the message scroll-to-top button toggle change.
 * @param {Event} event
 */
export function onScrollToTopToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    if (!extensionConfig.stFeatureEnhance.scrollToTop) extensionConfig.stFeatureEnhance.scrollToTop = { enabled: false, smoothScroll: true, showPerMessageButtons: false };
    extensionConfig.stFeatureEnhance.scrollToTop.enabled = enabled;
    configManager.setExtensionConfig(extensionConfig);

    if (enabled) {
        initMessageScrollToTop();
    } else {
        removeMessageScrollToTop();
    }
}

/**
 * Handles the smooth scroll toggle change for message nav.
 * @param {Event} event
 */
export function onSmoothScrollToTopToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    if (!extensionConfig.stFeatureEnhance.scrollToTop) extensionConfig.stFeatureEnhance.scrollToTop = { enabled: false, smoothScroll: true, showPerMessageButtons: false };
    extensionConfig.stFeatureEnhance.scrollToTop.smoothScroll = enabled;
    configManager.setExtensionConfig(extensionConfig);
    // 无需重新初始化导航条，scrollChatTo 已实时读 config
}

/**
 * Handles the per-message top/bottom buttons toggle change.
 * @param {Event} event
 */
export function onShowPerMessageButtonsToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    if (!extensionConfig.stFeatureEnhance.scrollToTop) extensionConfig.stFeatureEnhance.scrollToTop = { enabled: false, smoothScroll: true, showPerMessageButtons: false };
    extensionConfig.stFeatureEnhance.scrollToTop.showPerMessageButtons = enabled;
    configManager.setExtensionConfig(extensionConfig);

    if (enabled) {
        // 若导航条已启用，即时添加按钮；否则下次开导航条时会自动创建
        if (configManager.getExtensionConfig().stFeatureEnhance?.scrollToTop?.enabled) {
            addScrollTopButtonsToAllMessages();
        }
    } else {
        removeAllScrollTopButtons();
    }
}

/**
 * 世界书条目·聊天绑定开关切换
 * @param {Event} event
 */
export function onWorldBookBindingToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    extensionConfig.stFeatureEnhance.worldBookBinding = { ...(extensionConfig.stFeatureEnhance.worldBookBinding || {}), enabled };
    configManager.setExtensionConfig(extensionConfig);

    if (enabled) {
        initWorldBookBinding();
    } else {
        removeWorldBookBinding();
    }
}

export function onPromptBindingToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    extensionConfig.stFeatureEnhance.promptBinding = { ...(extensionConfig.stFeatureEnhance.promptBinding || {}), enabled };
    configManager.setExtensionConfig(extensionConfig);

    if (enabled) {
        initPromptBinding();
    } else {
        removePromptBinding();
    }
}

export function onPromptEntryActionsToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    extensionConfig.stFeatureEnhance.promptEntryActions = { ...(extensionConfig.stFeatureEnhance.promptEntryActions || {}), enabled };
    configManager.setExtensionConfig(extensionConfig);

    if (enabled) {
        initPromptEntryActions();
    } else {
        removePromptEntryActions();
    }
}

export function onNaiPresetSwitcherToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.stFeatureEnhance ||= {};
    extensionConfig.stFeatureEnhance.naiPresetSwitcher = { ...(extensionConfig.stFeatureEnhance.naiPresetSwitcher || {}), enabled };
    configManager.setExtensionConfig(extensionConfig);

    // 重建入口按钮：开关即时反映到 Cc 菜单 / 独立按钮（init 自带 remove 旧按钮，幂等安全）。
    // UI 模块（侧边栏 + 导入器）在后续阶段实现；门控内聚在其 init 内。
    new EntryButton(extensionFolderPath).init();

    if (enabled) {
        infoLog('[智绘姬NAI预设切换] 功能已开启');
    } else {
        infoLog('[智绘姬NAI预设切换] 功能已关闭');
    }
}

export function onIncludeHiddenMessagesToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.module ||= {};
    extensionConfig.module.includeHiddenMessages = { ...(extensionConfig.module.includeHiddenMessages || {}), enabled };
    configManager.setExtensionConfig(extensionConfig);
    // 切换隐藏楼层包含策略会直接改变提取结果，必须让模块缓存失效并重建
    moduleCacheManager.updateModuleCacheForce();
}

/**
 * Handles the async module storage enabled toggle change.
 * @param {Event} event
 */
export function onAsyncEnabledToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.module = extensionConfig.module || {};
    extensionConfig.module.asyncModule = extensionConfig.module.asyncModule || {};
    extensionConfig.module.asyncModule.enabled = enabled;
    configManager.setExtensionConfig(extensionConfig);
    updateAsyncActionsVisibility(enabled);
    // 异步开关变化后，立即同步每条消息小 Cc 按钮的显隐
    addAiButtonsToAllMessages();
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
    extensionConfig.module = extensionConfig.module || {};
    extensionConfig.module.asyncModule = extensionConfig.module.asyncModule || {};
    extensionConfig.module.asyncModule.snapshotInterval = value;
    configManager.setExtensionConfig(extensionConfig);
}

function enableContinuityCore() {
    try {
        new EntryButton(extensionFolderPath).init();
        addWorldBookToGlobalSettings(WORLD_BOOK_CONSTANTS.worldBookName, true);
        registerContinuityRegexPattern();
        // 显式添加 Cc 按钮（不依赖事件/Observer 兜底，与 contextBottomUI 行为一致）
        addAiButtonsToAllMessages();
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
        removeAllAiButtons();
        removeWorldBookFromGlobalSettings(WORLD_BOOK_CONSTANTS.worldBookName, true);
        registerContinuityRegexPattern();
        // 插件关闭后：若「智绘姬NAI预设切换」独立开启，仍显示其独立按钮（全局工具）
        if (configManager.getStFeatureEnhanceConfig()?.naiPresetSwitcher?.enabled) {
            new EntryButton(extensionFolderPath).init();
        }
        infoLog("♥️ Continuity Core has been disabled.");
    } catch (error) {
        errorLog("Failed to disable Continuity Core:", error);
    }
}

function updateExtensionUIState(enabled) {
    // 只禁用模块核心相关的控件，界面增强功能始终可用
    const elementsToToggle = [$('#continuity_backend_url'), $('#continuity_button_type'), $('#continuity_test_backend')];
    elementsToToggle.forEach(el => el.prop("disabled", !enabled));

    // 异步存储操作按钮显隐
    const asyncEnabled = enabled && (configManager.getModuleDomainConfig().asyncModule?.enabled ?? false);
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

        infoLog(`[AsyncStorage] 开始提取当前聊天: ${charName} / ${chatFile}, 共 ${chat.length} 条消息`);

        // 初始化存储
        await perMessageStorage.initChat(charName, chatFile, chatIdHash);

        let extractedCount = 0;
        for (let i = 0; i < chat.length; i++) {
            const message = chat[i];
            if (!message || (message.mes === undefined && message.content === undefined)) continue;

            const activeSwipeId = message.swipe_id ?? 0;
            const swipesData = _extractAllSwipes(message);

            // 检查是否有任何 swipe 含模块数据(新格式:检查 modules 字符串非空)
            const hasModules = Object.values(swipesData).some(sd =>
                sd.modules && sd.modules.length > 0
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

        await perMessageStorage.initChat(charName, chatFile, chatIdHash);

        let extractedCount = 0;
        for (let i = from; i <= to; i++) {
            const message = chat[i];
            if (!message || (message.mes === undefined && message.content === undefined)) continue;

            const activeSwipeId = message.swipe_id ?? 0;
            const swipesData = _extractAllSwipes(message);

            const hasModules = Object.values(swipesData).some(sd =>
                sd.modules && sd.modules.length > 0
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
 * 新格式:每个 swipe 返回 { modules: string }
 * @param {object} message - ST 聊天消息对象
 * @returns {Object<string, { modules: string }>}
 */
function _extractAllSwipes(message) {
    const swipesData = {};

    // 如果有 swipes 数组，提取所有 swipe
    if (Array.isArray(message.swipes) && message.swipes.length > 0) {
        for (let si = 0; si < message.swipes.length; si++) {
            const swipeText = message.swipes[si];
            if (swipeText) {
                swipesData[si] = perMessageStorage.extractMessageModules(swipeText);
            }
        }
    } else {
        // 无 swipes 数组，只提取 mes
        const rawText = message.mes !== undefined ? message.mes : message.content;
        if (rawText) {
            swipesData[0] = perMessageStorage.extractMessageModules(rawText);
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
    const asyncModule = extensionConfig.module?.asyncModule || {};

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
        showDebug: $('#continuity_show_debug').prop('checked'),
    };
}

/**
 * 保存 AI 生成配置到 extensionConfig
 */
function _saveAiGenerationConfig() {
    const extensionConfig = configManager.getExtensionConfig();
    extensionConfig.module = extensionConfig.module || {};
    extensionConfig.module.asyncModule = extensionConfig.module.asyncModule || {};

    extensionConfig.module.asyncModule.generationMode = $('#continuity_generation_mode').val() || 'pipeline';
    extensionConfig.module.asyncModule.useIndependentApi = $('#continuity_use_independent_api').prop('checked');
    extensionConfig.module.asyncModule.rawSystemPrompt = $('#continuity_raw_system_prompt').val()?.trim() || '';
    extensionConfig.module.asyncModule.rawUserPromptTemplate = $('#continuity_raw_user_prompt').val()?.trim() || '';
    extensionConfig.module.asyncModule.pipelineModifier = $('#continuity_pipeline_modifier').val()?.trim() || '';
    extensionConfig.module.asyncModule.showDebug = $('#continuity_show_debug').prop('checked');

    extensionConfig.module.asyncModule.customApi = {
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

        toastr.success(result.hasModules ? 'AI 生成完成' : 'AI 回复中未提取到模块数据');
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

        toastr.success(result.hasModules ? 'AI 生成完成' : 'AI 回复中未提取到模块数据');
    } catch (err) {
        errorLog('[AiGenerate] AI 生成失败:', err);
        toastr.error('AI 生成失败，请查看控制台');
    }
}
