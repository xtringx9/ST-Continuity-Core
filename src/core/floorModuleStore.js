// floorModuleStore.js
// 异步模式生成内容的楼层级存取收口（F 一期 + swipe 套 swipe 二期）。
//
// 数据落点：chat[floor].extra.ccore
//   结构：
//     generators[genName][outerSwipeId][innerSwipeId] = raw 文本（每层 swipe 各自一份）
//     generatorActive[genName][outerSwipeId] = innerSwipeId（当前激活的生成内容版本）
//   说明：
//     - genName = 'modules'（模块）或 generator.name（小剧场/角色心理等非模块生成内容）
//     - outerSwipeId = 对应正文 chat[floor].swipe_id；innerSwipeId = 同一 generator 的多版本
//     - 复用 floorBridge（FLOOR_NS='ccore'），不直接操作 extra。
//
// 本模块是写侧唯一入口：任何写入/删除后都应调用 notifyFloorModulesUpdated(mesId)，
// eventHandler 统一监听并刷新模块缓存（机制 A，收口一处）。

import * as floorBridge from '../shared/floorBridge.js';
import { errorLog, debugLog } from '../utils/logger.js';

/** floor 数据袋内生成内容存储 key */
export const GENERATORS_KEY = 'generators';

/** floor 数据袋内激活版本指针 key */
export const ACTIVE_KEY = 'generatorActive';

/** 事件名：楼层模块数据变更 */
export const FLOOR_MODULES_UPDATED_EVENT = 'ccore-floor-modules-updated';

/** 兼容旧 key（F 一期 modulesBySwipe 结构，读取时惰性迁移后删除） */
const LEGACY_MODULES_BY_SWIPE_KEY = 'modulesBySwipe';

/**
 * 惰性迁移旧结构（F 一期 modulesBySwipe）到新结构（generators.modules）。
 * 旧：modulesBySwipe = { [swipeId]: raw }
 * 新：generators.modules = { [swipeId]: { '0': raw } }
 * 迁移后删除旧 key。幂等：新结构已存在则不迁移。
 * @param {number} mesId
 */
function migrateLegacyModules(mesId) {
    const legacy = floorBridge.get(mesId, LEGACY_MODULES_BY_SWIPE_KEY);
    if (!legacy || typeof legacy !== 'object') return;
    // 已迁移过（新结构已有 modules）则不重复迁移
    const bag = floorBridge.get(mesId, GENERATORS_KEY);
    if (bag && typeof bag === 'object' && bag.modules) return;
    try {
        const gen = bag && typeof bag === 'object' ? bag : {};
        if (!gen.modules) gen.modules = {};
        for (const [swipeId, raw] of Object.entries(legacy)) {
            if (raw) gen.modules[swipeId] = { '0': raw };
        }
        floorBridge.set(mesId, GENERATORS_KEY, gen);
        floorBridge.del(mesId, LEGACY_MODULES_BY_SWIPE_KEY);
        debugLog(`[floorModuleStore] 楼层 ${mesId} 旧模块结构已迁移到 generators.modules`);
    } catch (err) {
        errorLog('[floorModuleStore] 旧结构迁移失败:', err);
    }
}

/**
 * 取得某楼层某 generator 的存储袋（genName → { outerSwipeId: { innerSwipeId: text } }）。
 * 若不存在则按需创建（create=true）。
 * @param {number} mesId
 * @param {string} genName
 * @param {{create?: boolean}} [opts]
 * @returns {object|null} gen 数据袋（可能为 null：楼层无效）
 */
function genBagOf(mesId, genName, { create = false } = {}) {
    migrateLegacyModules(mesId);
    const bag = floorBridge.get(mesId, GENERATORS_KEY);
    if (!bag || typeof bag !== 'object') {
        if (!create) return null;
    }
    let gen = bag?.[genName];
    if (!gen || typeof gen !== 'object') {
        if (!create) return null;
        gen = {};
        floorBridge.set(mesId, GENERATORS_KEY, { ...(bag || {}), [genName]: gen });
    }
    return gen;
}

/**
 * 取得某楼层某 generator 在指定外层 swipe 下的版本袋（innerSwipeId → text）。
 * @param {number} mesId
 * @param {string} genName
 * @param {number|string} outerSwipeId
 * @returns {object|null}
 */
function versionsOf(mesId, genName, outerSwipeId) {
    const gen = genBagOf(mesId, genName);
    if (!gen) return null;
    const versions = gen[String(outerSwipeId)];
    if (!versions || typeof versions !== 'object') return null;
    return versions;
}

// ============================================================
// 版本读写
// ============================================================

/**
 * 写入某楼层某 generator 指定外层 swipe + 内层 swipe 的文本（覆盖该版本）。
 * 写后触发 FLOOR_MODULES_UPDATED_EVENT。
 * @param {number} mesId 楼层索引
 * @param {string} genName 'modules' 或 generator.name
 * @param {number|string} outerSwipeId 外层 swipe（对应正文 swipe_id）
 * @param {number|string} innerSwipeId 内层 swipe（生成内容版本）
 * @param {string} text 内容文本
 * @returns {boolean} 是否写入成功
 */
export function writeGeneratorContent(mesId, genName, outerSwipeId, innerSwipeId, text) {
    if (mesId === undefined || mesId === null) return false;
    const gen = genBagOf(mesId, genName, { create: true });
    if (!gen) {
        errorLog(`[floorModuleStore] 写入失败：楼层 ${mesId} 无效`);
        return false;
    }
    const oKey = String(outerSwipeId);
    const versions = gen[oKey] && typeof gen[oKey] === 'object' ? gen[oKey] : {};
    versions[String(innerSwipeId)] = text;
    gen[oKey] = versions;
    floorBridge.set(mesId, GENERATORS_KEY, { ...(floorBridge.get(mesId, GENERATORS_KEY) || {}), [genName]: gen });
    notifyFloorModulesUpdated(mesId);
    return true;
}

/**
 * 读取某楼层某 generator 指定外层 swipe + 内层 swipe 的文本；无则返回 ''。
 * @param {number} mesId
 * @param {string} genName
 * @param {number|string} outerSwipeId
 * @param {number|string} innerSwipeId
 * @returns {string}
 */
export function readGeneratorContent(mesId, genName, outerSwipeId, innerSwipeId) {
    const versions = versionsOf(mesId, genName, outerSwipeId);
    if (!versions) return '';
    return versions[String(innerSwipeId)] || '';
}

/**
 * 读取某楼层某 generator 指定外层 swipe 的全部版本。
 * @param {number} mesId
 * @param {string} genName
 * @param {number|string} outerSwipeId
 * @param {{includeEmpty?: boolean}} [opts] includeEmpty=true 时包含空文本版本（编辑区需要；默认过滤空）
 * @returns {Object<number|string, string>} { innerSwipeId: text }
 */
export function readAllGeneratorContents(mesId, genName, outerSwipeId, { includeEmpty = false } = {}) {
    const versions = versionsOf(mesId, genName, outerSwipeId);
    if (!versions) return {};
    const out = {};
    for (const [innerSwipeId, text] of Object.entries(versions)) {
        if (includeEmpty || text) out[innerSwipeId] = text;
    }
    return out;
}

/**
 * 追加一个新版本（innerSwipeId = 当前最大 + 1），并设为当前激活版本。
 * @param {number} mesId
 * @param {string} genName
 * @param {number|string} outerSwipeId
 * @param {string} text
 * @returns {number} 新版本 innerSwipeId；失败返回 -1
 */
export function appendGeneratorContent(mesId, genName, outerSwipeId, text) {
    if (mesId === undefined || mesId === null) return -1;
    const gen = genBagOf(mesId, genName, { create: true });
    if (!gen) {
        errorLog(`[floorModuleStore] 追加失败：楼层 ${mesId} 无效`);
        return -1;
    }
    const oKey = String(outerSwipeId);
    const versions = gen[oKey] && typeof gen[oKey] === 'object' ? gen[oKey] : {};
    // 找出当前最大内层 id（支持数字字符串），新版本 = max + 1
    const existingIds = Object.keys(versions)
        .map(Number)
        .filter(n => Number.isFinite(n));
    const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 0;
    versions[nextId] = text;
    gen[oKey] = versions;
    floorBridge.set(mesId, GENERATORS_KEY, { ...(floorBridge.get(mesId, GENERATORS_KEY) || {}), [genName]: gen });
    // 追加后自动设为激活版本
    setActiveGeneratorSwipe(mesId, genName, outerSwipeId, nextId, { notify: false });
    notifyFloorModulesUpdated(mesId);
    return nextId;
}

/**
 * 覆盖当前激活版本（若无激活版本则覆盖 0）。
 * @param {number} mesId
 * @param {string} genName
 * @param {number|string} outerSwipeId
 * @param {string} text
 * @returns {boolean}
 */
export function overwriteGeneratorContent(mesId, genName, outerSwipeId, text) {
    const active = getActiveGeneratorSwipe(mesId, genName, outerSwipeId);
    return writeGeneratorContent(mesId, genName, outerSwipeId, active, text);
}

/**
 * 删除某楼层某 generator 指定外层 swipe + 内层 swipe 的版本。
 * @param {number} mesId
 * @param {string} genName
 * @param {number|string} outerSwipeId
 * @param {number|string} innerSwipeId
 * @returns {boolean} 是否删除了某版本
 */
export function deleteGeneratorContent(mesId, genName, outerSwipeId, innerSwipeId) {
    const gen = genBagOf(mesId, genName);
    if (!gen) return false;
    const oKey = String(outerSwipeId);
    const versions = gen[oKey];
    if (!versions || typeof versions !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(versions, String(innerSwipeId))) return false;
    delete versions[String(innerSwipeId)];
    gen[oKey] = versions;
    floorBridge.set(mesId, GENERATORS_KEY, { ...(floorBridge.get(mesId, GENERATORS_KEY) || {}), [genName]: gen });
    // 若删除的是激活版本，回退到剩余最大版本
    const active = getActiveGeneratorSwipe(mesId, genName, outerSwipeId);
    if (String(active) === String(innerSwipeId)) {
        const remaining = Object.keys(versions).map(Number).filter(n => Number.isFinite(n));
        const nextActive = remaining.length > 0 ? Math.max(...remaining) : 0;
        setActiveGeneratorSwipe(mesId, genName, outerSwipeId, nextActive, { notify: false });
    }
    notifyFloorModulesUpdated(mesId);
    return true;
}

// ============================================================
// 激活版本指针
// ============================================================

/**
 * 读取某楼层某 generator 指定外层 swipe 的当前激活版本 id。
 * 无激活指针时回退到该外层 swipe 下最大版本；无任何版本时返回 0。
 * @param {number} mesId
 * @param {string} genName
 * @param {number|string} outerSwipeId
 * @returns {number}
 */
export function getActiveGeneratorSwipe(mesId, genName, outerSwipeId) {
    const activeBag = floorBridge.get(mesId, ACTIVE_KEY);
    const oKey = String(outerSwipeId);
    const stored = activeBag?.[genName]?.[oKey];
    if (stored !== undefined && stored !== null) {
        const n = Number(stored);
        if (Number.isFinite(n)) return n;
    }
    // 无指针 → 回退到该外层 swipe 下最大版本
    const versions = versionsOf(mesId, genName, outerSwipeId);
    if (versions) {
        const ids = Object.keys(versions).map(Number).filter(n => Number.isFinite(n));
        if (ids.length > 0) return Math.max(...ids);
    }
    return 0;
}

/**
 * 设置某楼层某 generator 指定外层 swipe 的激活版本。
 * @param {number} mesId
 * @param {string} genName
 * @param {number|string} outerSwipeId
 * @param {number|string} innerSwipeId
 * @param {{notify?: boolean}} [opts] notify=false 跳过事件（批量写时避免重复）
 * @returns {boolean}
 */
export function setActiveGeneratorSwipe(mesId, genName, outerSwipeId, innerSwipeId, { notify = true } = {}) {
    if (mesId === undefined || mesId === null) return false;
    const bag = floorBridge.get(mesId, ACTIVE_KEY) && typeof floorBridge.get(mesId, ACTIVE_KEY) === 'object'
        ? floorBridge.get(mesId, ACTIVE_KEY)
        : {};
    if (!bag[genName] || typeof bag[genName] !== 'object') bag[genName] = {};
    bag[genName][String(outerSwipeId)] = String(innerSwipeId);
    floorBridge.set(mesId, ACTIVE_KEY, bag);
    if (notify) notifyFloorModulesUpdated(mesId);
    return true;
}

// ============================================================
// 便捷别名（'modules' 专用，兼容旧调用方 + 简化模块读写）
// ============================================================

/**
 * 读取某楼层指定 swipe 的模块数据（当前激活版本）。
 * @param {number} mesId
 * @param {number|string} swipeId 外层 swipe（对应正文 swipe_id）
 * @returns {string}
 */
export function readFloorModules(mesId, swipeId) {
    const active = getActiveGeneratorSwipe(mesId, 'modules', swipeId);
    return readGeneratorContent(mesId, 'modules', swipeId, active);
}

/**
 * 写入某楼层指定 swipe 的模块数据（覆盖当前激活版本，等效旧 writeFloorModules）。
 * @param {number} mesId
 * @param {number|string} swipeId
 * @param {string} rawText
 * @returns {boolean}
 */
export function writeFloorModules(mesId, swipeId, rawText) {
    const active = getActiveGeneratorSwipe(mesId, 'modules', swipeId);
    return writeGeneratorContent(mesId, 'modules', swipeId, active, rawText);
}

/**
 * 读取某楼层全部 swipe 的模块数据（当前激活版本，只含非空项）。
 * @param {number} mesId
 * @returns {Object<number|string, string>}
 */
export function readAllFloorModules(mesId) {
    const bag = floorBridge.get(mesId, GENERATORS_KEY);
    const modules = bag?.modules;
    if (!modules || typeof modules !== 'object') return {};
    const out = {};
    for (const [outerSwipeId, versions] of Object.entries(modules)) {
        const text = readGeneratorContent(mesId, 'modules', outerSwipeId, getActiveGeneratorSwipe(mesId, 'modules', outerSwipeId));
        if (text) out[outerSwipeId] = text;
    }
    return out;
}

/**
 * 删除某楼层指定 swipe 的模块数据（当前激活版本；删后回退剩余最大版本）。
 * @param {number} mesId
 * @param {number|string} swipeId
 */
export function deleteFloorModules(mesId, swipeId) {
    const active = getActiveGeneratorSwipe(mesId, 'modules', swipeId);
    deleteGeneratorContent(mesId, 'modules', swipeId, active);
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
