// 预设绑定当前聊天 状态层
// 把「预设 ↔ 聊天」的绑定持久化到 chat_metadata.ccore.presetBinding（预设名字符串，走 chatFileBridge），
// 并在需要时把 ST 当前预设（oai_settings.preset_settings_openai）切换到绑定值。
// 未绑定聊天的回退目标「默认预设」记忆在 stFeatureEnhance.presetBinding.defaultPreset
// （= 最近一次用户手动切换的预设；init 时若为空则记录当前值）。

import { oai_settings, openai_setting_names } from '../../../../../../openai.js';
import * as chatFileBridge from '../../shared/chatFileBridge.js';
import configManager from '../../singleton/configManager.js';
import { debugLog, warnLog } from '../../utils/logger.js';

const PRESET_BINDING_KEY = 'presetBinding';

// 自动切换预设期间置位，避免 change 监听把自动切换误记为「用户手动切换」
let applying = false;

/** 是否正处于「自动切换预设」中（供 UI 层跳过手动记录） */
export function isApplyingPreset() {
    return applying;
}

/** 当前聊天的预设绑定（空=未绑定） */
export function getPresetBinding() {
    return chatFileBridge.get(PRESET_BINDING_KEY) || '';
}

/** 写入/清除当前聊天的预设绑定 */
export async function setPresetBinding(presetName, { save = true } = {}) {
    if (presetName) {
        chatFileBridge.set(PRESET_BINDING_KEY, presetName, { save });
    } else {
        chatFileBridge.del(PRESET_BINDING_KEY, { save });
    }
}

/** 未绑定聊天的回退预设（最近一次手动切换的预设） */
export function getDefaultPreset() {
    return configManager.getStFeatureEnhanceConfig()?.presetBinding?.defaultPreset || '';
}

/** 记忆「默认预设」（保留 enabled 等既有字段） */
export function setDefaultPreset(presetName) {
    const ext = configManager.getExtensionConfig();
    ext.stFeatureEnhance ||= {};
    const cur = ext.stFeatureEnhance.presetBinding || {};
    ext.stFeatureEnhance.presetBinding = { ...cur, defaultPreset: presetName };
    configManager.setExtensionConfig(ext);
    debugLog('[PRESET-BIND] 默认预设记忆更新:', presetName);
}

/** 当前 ST 生效预设名 */
export function getCurrentPreset() {
    return oai_settings?.preset_settings_openai || '';
}

/**
 * 把 ST 当前预设切换到指定预设（走 ST 原生 select change 流程）。
 * ⚠️ 自动切换期间 applying=true，供 change 监听识别。
 * ⚠️ 「Default」预设没有对应 openai_settings 条目（select value="gui"），无字段可应用，
 *    只改选中状态与 oai_settings 值，不 trigger change（原生 change 会因读取 undefined 预设而失败）。
 * @param {string} presetName 预设名（openai_setting_names 的 key 或 'Default'）
 */
export function switchToPreset(presetName) {
    if (!presetName) return;
    const $sel = $('#settings_preset_openai');
    if (!$sel.length) return;
    if (oai_settings?.preset_settings_openai === presetName) return; // 已在该预设

    applying = true;
    try {
        const idx = openai_setting_names?.[presetName];
        if (idx === undefined) {
            if (presetName === 'Default') {
                $sel.val('gui');
                oai_settings.preset_settings_openai = 'Default';
                debugLog('[PRESET-BIND] 已切换当前预设 → Default');
                return;
            }
            warnLog('[PRESET-BIND] 预设不存在（可能已被删除），跳过切换:', presetName);
            return;
        }
        $sel.val(String(idx)).trigger('change');
        debugLog('[PRESET-BIND] 已切换当前预设 →', presetName);
    } finally {
        applying = false;
    }
}
