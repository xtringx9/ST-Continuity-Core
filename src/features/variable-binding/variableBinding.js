// variableBinding.js
// C 变量绑定 · 运行时调度
// 主窗侧：监听切换聊天（CHAT_CHANGED）时把当前聊天的有效变量集写入运行时。
// 应用逻辑在 variableBindingState.js（iframe 侧 CharacterBinding 也复用 applyCurrentVariables）。

import { eventSource, event_types } from '../../../../../../../script.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import { applyCurrentVariables } from './variableBindingState.js';

let applied = false;

/**
 * 初始化变量绑定（幂等；随扩展启用触发）
 */
export function initVariableBinding() {
    if (applied) return;
    applied = true;
    try {
        // 切换聊天 → 应用当前聊天的有效变量集
        eventSource.on(event_types.CHAT_CHANGED, applyCurrentVariables);
        // 当前聊天立即应用一次（启动 / 开关打开时）
        applyCurrentVariables();
        debugLog('[VAR-BIND] 变量绑定已初始化');
    } catch (e) {
        errorLog('[VAR-BIND] 初始化失败', e);
    }
}

/**
 * 移除变量绑定（HMR / 扩展禁用）
 */
export function removeVariableBinding() {
    if (!applied) return;
    applied = false;
    try {
        eventSource.removeListener(event_types.CHAT_CHANGED, applyCurrentVariables);
        debugLog('[VAR-BIND] 变量绑定已移除');
    } catch (e) {
        errorLog('[VAR-BIND] 移除失败', e);
    }
}