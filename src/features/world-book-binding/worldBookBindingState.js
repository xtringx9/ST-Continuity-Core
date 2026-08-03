// 世界书条目·聊天绑定 状态层
// 给原生世界书条目增加「绑定当前聊天」三态：inherit（继承）/ on（本聊开）/ off（本聊关）
// 状态持久化到当前聊天的 chat_metadata.ccore.wbBindings（走 chatFileBridge）
// 生效方式：原地修改 worldInfoCache 中条目对象的 entry.disable（绕过 cloneOnGet 取真实引用）

import {
    world_info,
    loadWorldInfo,
    worldInfoCache,
} from '../../../../../../world-info.js';
import { getContext } from '../../../../../../extensions.js';
import configManager from '../../singleton/configManager.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import * as chatFileBridge from '../../shared/chatFileBridge.js';

// 本功能在聊天文件级 ccore 数据袋下的子键（落 chat_metadata.ccore.wbBindings）
export const WB_BINDINGS_KEY = 'wbBindings';

// 三态值
export const WB_BIND_MODE = {
    INHERIT: 'inherit', // 继承全局默认（不干预）
    ON: 'on',           // 仅本聊生效（强制启用）
    OFF: 'off',         // 仅本聊关闭（强制禁用）
};

/**
 * 读取当前聊天的所有绑定记录
 * @returns {Object} { [bookName]: { [uid]: 'on'|'off' } }
 */
export function getBindings() {
    try {
        return chatFileBridge.get(WB_BINDINGS_KEY) || {};
    } catch (e) {
        errorLog('[WB-BIND] getBindings 失败', e);
        return {};
    }
}

/**
 * 读取某条目当前的绑定模式（默认 inherit）
 * @param {string} worldName
 * @param {string|number} uid
 * @returns {'inherit'|'on'|'off'}
 */
export function getBinding(worldName, uid) {
    try {
        const bindings = getBindings();
        return bindings?.[worldName]?.[String(uid)] || WB_BIND_MODE.INHERIT;
    } catch (e) {
        errorLog('[WB-BIND] getBinding 失败', e);
        return WB_BIND_MODE.INHERIT;
    }
}

/**
 * 设置某条目的绑定模式并（可选）持久化
 * @param {string} worldName
 * @param {string|number} uid
 * @param {'inherit'|'on'|'off'} mode
 * @param {boolean} [save=true]
 */
export function setBinding(worldName, uid, mode, save = true) {
    try {
        const uidStr = String(uid);
        // 读现有绑定（可能为 {}），原地修改后再整体写回 chatFileBridge
        const bindings = { ...getBindings() };
        if (!bindings[worldName]) bindings[worldName] = {};

        if (mode === WB_BIND_MODE.INHERIT) {
            delete bindings[worldName][uidStr];
            if (Object.keys(bindings[worldName]).length === 0) delete bindings[worldName];
        } else {
            bindings[worldName][uidStr] = mode;
        }

        // 空绑定整体清掉键，保持 chat_metadata.ccore 干净
        if (Object.keys(bindings).length === 0) {
            chatFileBridge.del(WB_BINDINGS_KEY, { save });
        } else {
            chatFileBridge.set(WB_BINDINGS_KEY, bindings, { save });
        }
    } catch (e) {
        errorLog('[WB-BIND] setBinding 失败', e);
    }
}

/**
 * 持久化绑定记录到当前聊天元数据（经由 chatFileBridge）
 */
export function saveBindings() {
    try {
        chatFileBridge.save();
    } catch (e) {
        errorLog('[WB-BIND] saveBindings 失败', e);
    }
}

/**
 * 遍历所有可用的世界书（全局 world_info + 角色世界书 charLore）
 * @param {(bookName:string, entries:Object)=>void} callback
 */
function forEachWorldBook(callback) {
    try {
        const context = getContext();
        const this_chid = context?.characterId;

        // 全局世界书
        if (world_info && typeof world_info === 'object') {
            for (const [name, book] of Object.entries(world_info)) {
                if (name === 'charLore') continue;
                if (book?.entries) callback(name, book.entries);
            }
        }

        // 角色世界书（charLore 数组）
        const charLore = world_info?.charLore;
        if (Array.isArray(charLore)) {
            for (const book of charLore) {
                if (book?.name && book?.entries) callback(book.name, book.entries);
            }
        }

        // 注：本扩展的"本聊绑定"数据落在 chat_metadata.ccore.wbBindings（经
        // chatFileBridge），不是世界书对象，无需在此遍历。聊天世界书由 ST 原生
        // chat_metadata['world_info']（字符串文件名）指向，条目在 world_info 内。
    } catch (e) {
        errorLog('[WB-BIND] forEachWorldBook 失败', e);
    }
}

/**
 * 在 worldInfoCache 中定位某条目的真实对象引用。
 *
 * 💥 致命坑：worldInfoCache 是 StructuredCloneMap({cloneOnGet:true})，
 * loadWorldInfo(name) / worldInfoCache.get(name) 返回的都是**深拷贝副本**，
 * 改副本的 entry.disable 改完即弃，对编辑器显示和注入都无效。
 * 必须用 Map.prototype.get.call(worldInfoCache, name) 绕过 cloneOnGet 拿到缓存内真实引用。
 * 而 ST 注入链（getGlobalLore/getChatLore/getCharacterLore）恰恰读取的就是这个缓存，
 * 所以改这里才会真正影响注入。
 *
 * @param {string} worldName
 * @param {string|number} uid
 * @returns {Promise<object|null>} 条目对象（可原地修改），找不到返回 null
 */
export async function findEntryObject(worldName, uid) {
    const uidStr = String(uid);
    try {
        // 确保该书已加载进缓存（首次访问时 fetch 并写入）
        if (!worldInfoCache.has(worldName)) {
            await loadWorldInfo(worldName);
        }
        // 绕过 cloneOnGet，取缓存内部真实引用
        const cached = Map.prototype.get.call(worldInfoCache, worldName);
        if (cached?.entries?.[uidStr]) return cached.entries[uidStr];
    } catch (e) {
        errorLog('[WB-BIND] findEntryObject 失败', worldName, uid, e);
    }
    return null;
}

// 记录已覆盖的原始 disable 值，便于切聊天/重载时还原
const appliedOverrides = new Map();

/**
 * 收集当前聊天里所有非 inherit 的绑定（= 需要生效的覆盖）
 * @returns {Array<{worldName,uid,mode}>}
 */
function collectActiveBindings() {
    const out = [];
    const bindings = getBindings();
    for (const [worldName, map] of Object.entries(bindings)) {
        for (const [uid, mode] of Object.entries(map)) {
            if (mode === WB_BIND_MODE.INHERIT) continue;
            out.push({ worldName, uid, mode });
        }
    }
    return out;
}

async function restoreOverrides() {
    for (const [key, originalDisable] of appliedOverrides.entries()) {
        const [worldName, uid] = key.split('#');
        // findEntryObject 返回缓存内真实引用；找不到（书未加载等）则跳过
        const entry = await findEntryObject(worldName, uid);
        if (entry) {
            entry.disable = originalDisable;
            debugLog(`[WB-BIND] 恢复 ${worldName}#${uid} disable=${originalDisable}`);
        }
    }
    appliedOverrides.clear();
}

/**
 * 把当前聊天的绑定应用到 worldInfoCache 原生条目对象上（真实引用，绕过 cloneOnGet）。
 * ST 在注入时每次从 worldInfoCache 重新读取 entry.disable，因此原地修改即可生效。
 * @param {boolean} [reloadEditor=false] 是否触发世界书编辑器刷新以反映 kill switch 状态
 */
export async function applyBindingsToWorldInfo(reloadEditor = false) {
    try {
        // 1) 先恢复上一轮覆盖
        await restoreOverrides();

        // 2) 应用当前聊天绑定
        const active = collectActiveBindings();
        for (const { worldName, uid, mode } of active) {
            const entry = await findEntryObject(worldName, uid);
            if (!entry) continue;
            const originalDisable = !!entry.disable;
            const targetDisable = mode === WB_BIND_MODE.OFF;
            if (originalDisable !== targetDisable) {
                entry.disable = targetDisable;
            }
            // 记录原始值（已存在则不覆盖，保证用户手动改动不被吞）
            const key = `${worldName}#${uid}`;
            if (!appliedOverrides.has(key)) {
                appliedOverrides.set(key, originalDisable);
            }
            debugLog(`[WB-BIND] 应用 ${worldName}#${uid} mode=${mode} -> disable=${targetDisable} (origin=${originalDisable})`);
        }

        if (reloadEditor) {
            try {
                const m = await import('../../../../../../world-info.js');
                if (m.reloadEditor) m.reloadEditor();
            } catch (_) { /* 编辑器可能未打开 */ }
        }
    } catch (e) {
        errorLog('[WB-BIND] applyBindingsToWorldInfo 失败', e);
    }
}

/**
 * 还原所有覆盖（扩展关闭/聊天切换时调用）
 */
export async function restoreAllOverrides() {
    try {
        await restoreOverrides();
    } catch (e) {
        errorLog('[WB-BIND] restoreAllOverrides 失败', e);
    }
}
