// src/features/extension-settings/SettingsPanel.js

import { extensionFolderPath } from '../../index.js';
import {
    onEnabledToggle,
    onBackendUrlChange,
    onDebugLogsToggle,
    onButtonTypeChange,
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
