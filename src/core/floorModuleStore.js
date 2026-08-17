// floorModuleStore.js
// 异步模式模块数据的楼层级存取收口（F 一期）。
//
// 数据落点：chat[floor].extra.ccore.modulesBySwipe = { [swipeId]: raw 模块文本块 }
// 说明：
//   - 复用 floorBridge（FLOOR_NS='ccore'），不直接操作 extra。
//   - 只存「正文后模块」（after_body 等异步独立生成的模块 raw），正文内模块仍在 chat[].mes。
//   - 每 swipe 各自一份（不同 swipe 是独立生成结果）。
//
// 本模块是写侧唯一入口：任何写入/删除后都应调用 notifyFloorModulesUpdated(mesId)，
// eventHandler 统一监听并刷新模块缓存（机制 A，收口一处）。

import * as floorBridge from '../shared/floorBridge.js';
import { errorLog } from '../utils/logger.js';

/** floor 数据袋内模块存储 key */
export const MODULES_BY_SWIPE_KEY = 'modulesBySwipe';

/** 事件名：楼层模块数据变更 */
export const FLOOR_MODULES_UPDATED_EVENT = 'ccore-floor-modules-updated';

/**
 * 写入某楼层指定 swipe 的模块 raw 文本（覆盖该 swipe）。
 * 写后触发 FLOOR_MODULES_UPDATED_EVENT。
 * @param {number} mesId 楼层索引
 * @param {number|string} swipeId
 * @param {string} rawText 模块 raw 文本块（多个模块用换行分隔，同 extractMessageModules 产出格式）
 * @returns {boolean} 是否写入成功（楼层无效/无法写入时返回 false）
 */
export function writeFloorModules(mesId, swipeId, rawText) {
    if (mesId === undefined || mesId === null) return false;
    const map = floorBridge.get(mesId, MODULES_BY_SWIPE_KEY) || {};
    map[String(swipeId)] = rawText;
    const written = floorBridge.set(mesId, MODULES_BY_SWIPE_KEY, map);
    if (written === undefined) {
        errorLog('[floorModuleStore] 写入楼层模块失败：楼层索引无效或无法写入:', mesId);
        return false;
    }
    notifyFloorModulesUpdated(mesId);
    return true;
}

/**
 * 读取某楼层指定 swipe 的模块 raw 文本；该 swipe 无则返回 ''。
 * @param {number} mesId
 * @param {number|string} swipeId
 * @returns {string}
 */
export function readFloorModules(mesId, swipeId) {
    const map = floorBridge.get(mesId, MODULES_BY_SWIPE_KEY);
    if (!map || typeof map !== 'object') return '';
    return map[String(swipeId)] || '';
}

/**
 * 读取某楼层全部 swipe 的模块数据（只含非空项）。
 * @param {number} mesId
 * @returns {Object<number|string, string>}
 */
export function readAllFloorModules(mesId) {
    const map = floorBridge.get(mesId, MODULES_BY_SWIPE_KEY);
    if (!map || typeof map !== 'object') return {};
    const out = {};
    for (const [swipeId, text] of Object.entries(map)) {
        if (text) out[swipeId] = text;
    }
    return out;
}

/**
 * 删除某楼层指定 swipe 的模块数据；删后该 swipe 不再提供。
 * @param {number} mesId
 * @param {number|string} swipeId
 */
export function deleteFloorModules(mesId, swipeId) {
    const map = floorBridge.get(mesId, MODULES_BY_SWIPE_KEY);
    if (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, String(swipeId))) {
        delete map[String(swipeId)];
        floorBridge.set(mesId, MODULES_BY_SWIPE_KEY, map);
        notifyFloorModulesUpdated(mesId);
    }
}

/**
 * 通知缓存层「某楼层模块数据已变更」（机制 A 收口）。
 * 将来若换机制（如直接调 moduleCacheManager），只改此函数。
 * @param {number} mesId
 */
export function notifyFloorModulesUpdated(mesId) {
    try {
        window.dispatchEvent(new CustomEvent(FLOOR_MODULES_UPDATED_EVENT, {
            detail: { mesId },
        }));
    } catch (err) {
        console.warn('[floorModuleStore] 通知模块数据变更失败:', err);
    }
}
