// 提示词预设条目·聊天绑定 状态层
// 给 PromptManager 中每个提示词条目（data-pm-identifier）增加「绑定当前聊天」三态：
//   inherit（继承，按角色/预设原值）/ on（本聊开）/ off（本聊关）
// 状态持久化到当前聊天的 chat_metadata.ccore.promptBindings（走 chatFileBridge）
// 生效方式：
//   1) 包装 isPromptDisabledForActiveCharacter，使注入始终以聊天绑定为权威（零污染、绑定必胜）
//   2) 瞬态修改 serviceSettings.prompt_order 中条目对象的 entry.enabled，仅用于让原生 toggle 视觉反映绑定
//   跨角色/预设时按 characterId#identifier 还原，避免污染其它预设

import { promptManager } from '../../../../../../openai.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import * as chatFileBridge from '../../shared/chatFileBridge.js';

export const WB_BIND_MODE = {
    INHERIT: 'inherit',
    ON: 'on',
    OFF: 'off',
};

const PROMPT_BINDINGS_KEY = 'promptBindings';

// 仅记录「本插件瞬态改过的条目」原始 enabled，按 characterId#identifier 归档
const appliedOverrides = new Map();
let overrideInstalled = false;

export function getPromptBindings() {
    return chatFileBridge.get(PROMPT_BINDINGS_KEY) || {};
}

export function getPromptBinding(identifier) {
    const bindings = getPromptBindings();
    return bindings[identifier] || WB_BIND_MODE.INHERIT;
}

export async function setPromptBinding(identifier, mode, save = true) {
    const bindings = getPromptBindings();
    if (mode === WB_BIND_MODE.INHERIT) {
        delete bindings[identifier];
    } else {
        bindings[identifier] = mode;
    }
    if (Object.keys(bindings).length === 0) {
        chatFileBridge.del(PROMPT_BINDINGS_KEY);
    } else if (save) {
        await chatFileBridge.set(PROMPT_BINDINGS_KEY, bindings);
    }
}

// 包装 isPromptDisabledForActiveCharacter：有聊天绑定时以绑定为权威，否则走原生逻辑
export function installPromptBindingOverride() {
    if (overrideInstalled) return;
    if (!promptManager) return;
    overrideInstalled = true;
    const proto = Object.getPrototypeOf(promptManager);
    const original = proto.isPromptDisabledForActiveCharacter;
    proto.isPromptDisabledForActiveCharacter = function (identifier) {
        const mode = getPromptBinding(identifier);
        if (mode && mode !== WB_BIND_MODE.INHERIT) {
            return mode === WB_BIND_MODE.OFF;
        }
        return original.call(this, identifier);
    };
}

function restoreAllOverrides() {
    if (!promptManager) {
        appliedOverrides.clear();
        return;
    }
    const orderList = promptManager.serviceSettings?.prompt_order || [];
    for (const [key, original] of appliedOverrides.entries()) {
        const [charId, identifier] = key.split('#');
        const charObj = orderList.find(c => c.character_id === charId);
        if (charObj) {
            const entry = (charObj.order || []).find(e => e.identifier === identifier);
            if (entry) entry.enabled = original;
        }
        appliedOverrides.delete(key);
    }
}

export function applyBindingsToPromptManager(rerender = true) {
    if (!promptManager || !promptManager.activeCharacter) return;
    installPromptBindingOverride();
    // 先还原上一次瞬态改动
    restoreAllOverrides();
    // 再按当前聊天绑定重设 entry.enabled（仅视觉）
    const bindings = getPromptBindings();
    const activeId = promptManager.activeCharacter.id;
    for (const [identifier, mode] of Object.entries(bindings)) {
        if (mode === WB_BIND_MODE.INHERIT) continue;
        const entry = promptManager.getPromptOrderEntry(promptManager.activeCharacter, identifier);
        if (!entry) continue;
        const key = `${activeId}#${identifier}`;
        if (!appliedOverrides.has(key)) {
            appliedOverrides.set(key, entry.enabled);
        }
        entry.enabled = (mode === WB_BIND_MODE.ON);
    }
    if (rerender) {
        try {
            promptManager.render(false);
        } catch (e) {
            errorLog('[PM-BIND] 重新渲染提示词管理器失败', e);
        }
    }
}

export function removePromptBindingOverrides() {
    restoreAllOverrides();
    if (promptManager) {
        try {
            promptManager.render(false);
        } catch (e) {
            errorLog('[PM-BIND] 还原后重新渲染提示词管理器失败', e);
        }
    }
}
