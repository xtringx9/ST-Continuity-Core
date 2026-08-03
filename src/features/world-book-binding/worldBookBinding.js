// 世界书条目·聊天绑定 聚合入口
// 把状态层（worldBookBindingState）与 UI 注入层（worldBookBindingUI）串起来，
// 并在聊天切换 / 世界书更新时把当前聊天的绑定应用到 world_info 原生条目。

import { applyBindingsToWorldInfo, restoreAllOverrides } from './worldBookBindingState.js';
import { initWorldBookBindingUI, removeWorldBookBindingUI } from './worldBookBindingUI.js';
import { eventSource, event_types } from '../../../../../../../script.js';
import { debugLog } from '../../utils/logger.js';

let applied = false;

/**
 * 初始化世界书条目·聊天绑定功能
 */
export function initWorldBookBinding() {
    if (applied) return;
    applied = true;

    // 1) 注入 ST 世界书编辑器 UI 控件
    initWorldBookBindingUI();

    // 2) 聊天切换时先恢复上一聊天覆盖，再应用当前聊天的绑定
    eventSource.on(event_types.CHAT_CHANGED, () => {
        applyBindingsToWorldInfo(false);
    });

    // 3) 世界书数据/设置更新后，确保当前聊天绑定仍生效
    eventSource.on(event_types.WORLDINFO_UPDATED, () => {
        applyBindingsToWorldInfo(false);
    });
    eventSource.on(event_types.WORLDINFO_SETTINGS_UPDATED, () => {
        applyBindingsToWorldInfo(false);
    });

    // 4) 初始应用（扩展启用时若已在某聊天内）
    applyBindingsToWorldInfo(false);

    debugLog('[WB-BIND] 世界书条目·聊天绑定已初始化');
}

/**
 * 关闭功能：还原 world_info 条目 disable 改动并移除编辑器控件
 */
export function removeWorldBookBinding() {
    if (!applied) return;
    applied = false;
    removeWorldBookBindingUI();
    restoreAllOverrides();
    debugLog('[WB-BIND] 世界书条目·聊天绑定已关闭');
}
