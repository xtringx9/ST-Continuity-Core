// 提示词预设条目·聊天绑定 编排层
// 对应世界书条目绑定的 prompt 版本：逐条提示词（data-pm-identifier）按当前聊天记忆三态开关

import { eventSource, event_types } from '../../../../../../../script.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import configManager from '../../singleton/configManager.js';
import { initPromptBindingUI, removePromptBindingUI } from './promptBindingUI.js';
import { applyBindingsToPromptManager, installPromptBindingOverride, removePromptBindingOverrides } from './promptBindingState.js';

let applied = false;

export function initPromptBinding() {
    // 按配置门控：未启用时不注入。启动、HMR、动态开关统一走此入口，门控集中在此一处。
    if (configManager.extensionConfig.promptBinding?.enabled === false) return;
    if (applied) return;
    applied = true;
    try {
        installPromptBindingOverride();
        initPromptBindingUI();
        // 切换聊天时：先还原上一次瞬态改动，再按新聊天绑定重设
        eventSource.on(event_types.CHAT_CHANGED, () => {
            applyBindingsToPromptManager(false);
        });
        // 初次进入即应用（若提示词管理器已展示）
        applyBindingsToPromptManager(false);
    } catch (e) {
        errorLog('[PM-BIND] 初始化预设条目聊天绑定失败', e);
    }
}

export function removePromptBinding() {
    if (!applied) return;
    applied = false;
    try {
        removePromptBindingUI();
        // 还原所有瞬态改动
        removePromptBindingOverrides();
    } catch (e) {
        errorLog('[PM-BIND] 移除预设条目聊天绑定失败', e);
    }
}
