// src/features/extension-settings/SettingsPanel.js

import { extensionFolderPath } from '../../singleton/configManager.js';
import {
    onEnabledToggle,
    onBackendUrlChange,
    onDebugLogsToggle,
    onButtonTypeChange,
    onMessageRangeViewToggle,
    onQuickReplyOptimizeToggle,
    onScrollToTopToggle,
    onSmoothScrollToTopToggle,
    onShowPerMessageButtonsToggle,
    onWorldBookBindingToggle,
    onPromptBindingToggle,
    onPromptEntryActionsToggle,
    onNaiPresetSwitcherToggle,
    onChatu8LauncherToggle,
    onPhoneModeToggle,
    onChatReaderToggle,
    onIncludeHiddenMessagesToggle,
    onSendHijackToggle,
    onSendHijackSetChange,
    onSendHijackLabelChange,
    populateSendHijackOptions,
    onAsyncEnabledToggle,
    onSnapshotIntervalChange,
    onAsyncExtractChat,
    onAsyncExtractFloor,
    onAsyncRebuildSnapshots,
    onGenerationModeChange,
    onAiConfigChange,
    onAiGenerateFloor,
    onAiGenerateChat,
    loadSettingsToUI,
} from '../../ui/extensionSettingsManager.js';
import { sendToBackend } from '../../services/backendService.js';


export class SettingsPanel {
    constructor() {
        this.isLoaded = false;
    }

    async load() {
        if (this.isLoaded) return;

        try {
            await this._loadCSS();
            await this._loadHTML();
            this._bindEvents();
            loadSettingsToUI(); // Load initial values into the UI
            this.isLoaded = true;
        } catch (error) {
            console.error('[Continuity] Failed to load settings panel:', error);
            toastr.error('Failed to load Continuity Core settings panel.');
        }
    }

    async _loadCSS() {
        const cssId = 'continuity-settings-panel-style';
        if (document.getElementById(cssId)) return;

        const link = document.createElement('link');
        link.id = cssId;
        link.rel = 'stylesheet';
        link.href = `${extensionFolderPath}/src/features/extension-settings/styles/settings-panel.css`;
        document.head.appendChild(link);
    }

    async _loadHTML() {
        const response = await fetch(`${extensionFolderPath}/src/features/extension-settings/settings-panel.html`);
        if (!response.ok) {
            throw new Error(`Failed to fetch settings-panel.html: ${response.statusText}`);
        }
        const settingsHtml = await response.text();
        $('#extensions_settings').append(settingsHtml);
    }

    _bindEvents() {
        $('#continuity_enabled').on('input', onEnabledToggle);
        $('#continuity_backend_url').on('input', onBackendUrlChange);
        $('#continuity_test_backend').on('click', sendToBackend);
        $('#continuity_debug_logs').on('input', onDebugLogsToggle);
        $('#continuity_button_type').on('change', onButtonTypeChange);
        $('#continuity_message_range_view').on('input', onMessageRangeViewToggle);
        $('#continuity_quick_reply_optimize').on('input', onQuickReplyOptimizeToggle);
        $('#continuity_scroll_to_top').on('input', onScrollToTopToggle);
        $('#continuity_smooth_scroll_to_top').on('input', onSmoothScrollToTopToggle);
        $('#continuity_show_per_message_buttons').on('input', onShowPerMessageButtonsToggle);
        $('#continuity_world_book_binding').on('input', onWorldBookBindingToggle);
        $('#continuity_prompt_binding').on('input', onPromptBindingToggle);
        $('#continuity_prompt_entry_actions').on('input', onPromptEntryActionsToggle);
        $('#continuity_nai_preset_switcher').on('input', onNaiPresetSwitcherToggle);
        $('#continuity_chatu8_launcher').on('input', onChatu8LauncherToggle);
        $('#continuity_phone_mode').on('input', onPhoneModeToggle);
        $('#continuity_chat_reader').on('input', onChatReaderToggle);
        $('#continuity_include_hidden_messages').on('input', onIncludeHiddenMessagesToggle);
        $('#continuity_send_hijack').on('input', onSendHijackToggle);
        $('#continuity_send_hijack_set').on('change', onSendHijackSetChange);
        $('#continuity_send_hijack_label').on('change', onSendHijackLabelChange);
        // 打开下拉时重填，确保反映 ST 内新建/改名/删除的 QR 集合
        $('#continuity_send_hijack_set').on('focus mousedown', populateSendHijackOptions);
        $('#continuity_async_enabled').on('input', onAsyncEnabledToggle);
        $('#continuity_snapshot_interval').on('input', onSnapshotIntervalChange);
        $('#continuity_async_extract_chat').on('click', onAsyncExtractChat);
        $('#continuity_async_extract_floor').on('click', onAsyncExtractFloor);
        $('#continuity_async_rebuild_snapshots').on('click', onAsyncRebuildSnapshots);

        // AI 生成相关事件
        $('#continuity_generation_mode').on('change', onGenerationModeChange);
        $('#continuity_raw_system_prompt').on('input', onAiConfigChange);
        $('#continuity_raw_user_prompt').on('input', onAiConfigChange);
        $('#continuity_pipeline_modifier').on('input', onAiConfigChange);
        $('#continuity_show_debug').on('input', onAiConfigChange);
        $('#continuity_custom_api_url').on('input', onAiConfigChange);
        $('#continuity_custom_api_key').on('input', onAiConfigChange);
        $('#continuity_custom_api_model').on('input', onAiConfigChange);
        $('#continuity_custom_api_source').on('change', onAiConfigChange);
        $('#continuity_custom_api_temperature').on('input', onAiConfigChange);
        $('#continuity_custom_api_max_tokens').on('input', onAiConfigChange);
        $('#continuity_ai_generate_floor').on('click', onAiGenerateFloor);
        $('#continuity_ai_generate_chat').on('click', onAiGenerateChat);

        $('.continuity-tab-btn').on('click', function () {
            const tabId = $(this).data('tab');
            $('.continuity-tab-btn').removeClass('active');
            $('.continuity-tab-content').removeClass('active');
            $(this).addClass('active');
            $('#tab-' + tabId).addClass('active');
        });

        $('.inline-drawer-toggle').on('click', function () {
            $(this).closest('.inline-drawer').toggleClass('open');
        });
    }
}
