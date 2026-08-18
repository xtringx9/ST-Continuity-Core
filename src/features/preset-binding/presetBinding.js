// 预设绑定当前聊天 主模块
// 串起状态层（presetBindingState）与 UI 注入层（presetBindingUI）：
//   - 门控（enabled）集中在此处，启动 / HMR / 动态开关统一走 initPresetBinding
//   - 切换聊天（CHAT_CHANGED）时把当前预设切到聊天绑定；未绑定聊天切回「默认预设」
//   - 用户手动切换预设（非自动应用）→ 绑定聊天内更新绑定值；未绑定聊天内记忆为默认预设

import { eventSource, event_types } from '../../../../../../../script.js';
import { translate } from '../../../../../../i18n.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import configManager from '../../singleton/configManager.js';
import { initPresetBindingUI, removePresetBindingUI, refreshPresetBindState } from './presetBindingUI.js';
import {
    getPresetBinding,
    setPresetBinding,
    getDefaultPreset,
    setDefaultPreset,
    switchToPreset,
    getCurrentPreset,
    isApplyingPreset,
} from './presetBindingState.js';

let applied = false;

export function initPresetBinding() {
    // 按配置门控：未启用时不注入。启动、HMR、动态开关统一走此入口，门控集中在此一处。
    if (configManager.getStFeatureEnhanceConfig().presetBinding?.enabled === false) return;
    if (applied) return;
    applied = true;
    try {
        // 首次启用时记录当前预设为默认（未绑定聊天回退目标）
        if (!getDefaultPreset()) setDefaultPreset(getCurrentPreset());

        initPresetBindingUI();

        // 用户手动切换预设（非自动应用）→ 记忆为默认预设
        // 用文档级委托，避免 ST 重建/清空 select 时丢失监听
        $(document).on('change.ccPresetBinding', '#settings_preset_openai', onPresetManualChange);

        // 切换聊天 → 应用绑定（绑定聊天切绑定预设，未绑定切回默认预设）
        eventSource.on(event_types.CHAT_CHANGED, applyPresetBinding);
        // 当前聊天立即应用一次（启动 / 开关打开时）
        applyPresetBinding();
        debugLog('[PRESET-BIND] 预设绑定当前聊天已初始化');
    } catch (e) {
        errorLog('[PRESET-BIND] 初始化失败', e);
    }
}

function onPresetManualChange() {
    if (isApplyingPreset()) return; // 自动切换不记录
    const presetName = getCurrentPreset();
    if (!presetName) return;
    if (getPresetBinding()) {
        // 绑定聊天内手动切换预设 → 更新绑定值（保持绑定语义：绑定的聊天永远用绑定值，显式按钮才解除绑定）
        setPresetBinding(presetName);
        refreshPresetBindState();
        toastr.success(`${translate('ccore_preset_bind_rebound')}「${presetName}」`);
    } else {
        // 未绑定聊天内手动切换 → 记忆为默认预设（所有未绑定聊天的回退目标）
        setDefaultPreset(presetName);
    }
}

function applyPresetBinding() {
    try {
        const binding = getPresetBinding();
        if (binding) {
            switchToPreset(binding);
        } else {
            const def = getDefaultPreset();
            if (def) switchToPreset(def);
        }
    } catch (e) {
        errorLog('[PRESET-BIND] 应用聊天预设绑定失败', e);
    }
}

export function removePresetBinding() {
    if (!applied) return;
    applied = false;
    try {
        removePresetBindingUI();
        $(document).off('change.ccPresetBinding');
        eventSource.removeListener(event_types.CHAT_CHANGED, applyPresetBinding);
        debugLog('[PRESET-BIND] 预设绑定当前聊天已移除');
    } catch (e) {
        errorLog('[PRESET-BIND] 移除失败', e);
    }
}
