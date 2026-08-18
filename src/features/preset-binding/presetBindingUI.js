// 预设绑定当前聊天 UI 注入层
// 在 ST 原生 OpenAI 预设下拉框（#settings_preset_openai）右侧注入「绑定/取消绑定」按钮。
// 两态：未绑定（fa-comment-slash 灰）/ 已绑定（fa-comment 绿），点击切换。
// 绑定来源：点击时抓取当前下拉选中的预设名（getCurrentPreset）。

import { eventSource, event_types } from '../../../../../../../script.js';
import { translate } from '../../../../../../i18n.js';
import { getPresetBinding, setPresetBinding, getCurrentPreset } from './presetBindingState.js';
import { debugLog, errorLog } from '../../utils/logger.js';

// 按钮样式（注入到页面 <style> 一次）
const CC_PRESET_BIND_STYLES = `
#cc-preset-bind {
    margin-left: 6px;
}
#cc-preset-bind[data-bound="true"] {
    color: var(--SmartThemeSuccessColor, #5c5) !important;
}
#cc-preset-bind[data-bound="true"]:hover {
    color: var(--SmartThemeSuccessColor, #5c5) !important;
}
#cc-preset-bind[data-bound="false"] {
    color: var(--SmartThemeDimColor, #8a8a8a) !important;
}
#cc-preset-bind[data-bound="false"]:hover {
    color: var(--SmartThemeQuoteColor, #6cf) !important;
}
`;

let heartbeatTimer = null;
let clicking = false;

/** 心跳：确保按钮存在（ST 可能重建面板），并刷新绑定状态 */
function onTick() {
    const $sel = $('#settings_preset_openai');
    if (!$sel.length) return;
    if ($('#cc-preset-bind').length) {
        refreshPresetBindState();
        return;
    }
    const $wrap = $sel.closest('.flex-container.flexNoGap');
    if (!$wrap.length) return;
    const $btn = $('<div>', {
        id: 'cc-preset-bind',
        class: 'menu_button menu_button_icon',
        title: translate('ccore_preset_bind_unbound'),
    }).html('<i class="fa-fw fa-solid fa-comment-slash"></i>');
    $btn.on('click', onToggleClick);
    $sel.after($btn);
    debugLog('[PRESET-BIND] 已注入预设绑定按钮');
}

export function refreshPresetBindState() {
    const $btn = $('#cc-preset-bind');
    if (!$btn.length) return;
    const bound = !!getPresetBinding();
    $btn.attr('data-bound', bound ? 'true' : 'false');
    $btn.find('i').attr('class', bound ? 'fa-fw fa-solid fa-comment' : 'fa-fw fa-solid fa-comment-slash');
    $btn.attr('title', bound ? `${translate('ccore_preset_bind_bound')}「${getPresetBinding()}」` : translate('ccore_preset_bind_unbound'));
}

async function onToggleClick() {
    if (clicking) return;
    clicking = true;
    try {
        const bound = !!getPresetBinding();
        if (bound) {
            await setPresetBinding('');
            toastr.success(translate('ccore_preset_bind_unbound_done'));
        } else {
            const presetName = getCurrentPreset();
            if (!presetName) {
                toastr.warning(translate('ccore_preset_bind_no_preset'));
                return;
            }
            await setPresetBinding(presetName);
            toastr.success(`${translate('ccore_preset_bind_bound_done')}「${presetName}」`);
        }
        refreshPresetBindState();
    } catch (e) {
        errorLog('[PRESET-BIND] 切换绑定失败', e);
    } finally {
        clicking = false;
    }
}

export function initPresetBindingUI() {
    if ($('#cc-preset-bind-style').length === 0) {
        $('<style>').attr('id', 'cc-preset-bind-style').text(CC_PRESET_BIND_STYLES).appendTo('head');
    }
    // 心跳：设置面板区域为常驻 DOM，但 ST 可能重建；500ms 轻量确保按钮存在并刷新状态
    heartbeatTimer = setInterval(onTick, 500);
    onTick();
    // 切换聊天后刷新按钮绑定状态
    eventSource.on(event_types.CHAT_CHANGED, refreshPresetBindState);
    debugLog('[PRESET-BIND] 预设绑定 UI 已初始化');
}

export function removePresetBindingUI() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    eventSource.removeListener(event_types.CHAT_CHANGED, refreshPresetBindState);
    $('#cc-preset-bind').remove();
}
