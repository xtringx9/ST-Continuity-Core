// variableBindingState.js
// C 变量绑定 · 应用层（供 iframe 侧 CharacterBinding 与主窗 variableBinding 复用）。
// 只依赖 extensions.js（6 层，iframe 内可用），不 import script.js。
// - 读取 configManager 角色级/聊天级变量绑定 → 计算有效变量集（Model A：角色 < 聊天，各层 enabled 门控）
// - 经 variableBridge 写入 chat_metadata.variables（{{getvar}} 可直接读取）
// - 仅写入「有效集里 enabled=true」的变量，绝不删除聊天里其它业务写入的无关变量。

import { getContext } from '../../../../../../extensions.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import configManager from '../../singleton/configManager.js';
import * as variableBridge from '../../shared/variableBridge.js';

/**
 * 把「当前聊天」的变量绑定有效集写入运行时。
 * 多变量循环调用 variableBridge.set（内部各自 saveMetadataDebounced，去抖合并为一次存档）。
 */
export function applyCurrentVariables() {
    try {
        if (!configManager.isLoaded) return;
        const ctx = getContext();
        const charName = ctx?.characters?.[ctx.characterId]?.name || '';
        const chatFile = ctx?.chatId ?? '';
        if (!charName || !chatFile) return; // 角色/聊天未知（如临时聊天）时不动

        const effective = configManager.getEffectiveVariables(charName, chatFile);
        let count = 0;
        for (const name in effective) {
            const entry = effective[name];
            if (!entry || entry.enabled !== true) continue;
            variableBridge.set('chat', name, entry.value);
            count++;
        }
        debugLog(`[VAR-BIND] 已应用 ${count} 个变量（char=${charName}, chat=${chatFile}）`);
    } catch (e) {
        errorLog('[VAR-BIND] 应用变量绑定失败', e);
    }
}