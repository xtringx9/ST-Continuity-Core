// floorModuleStore.js
// 异步模式生成内容的楼层级存取收口（F 一期 + swipe 套 swipe 二期）。
//
// 数据落点：chat[floor].extra.ccore
//   结构：
//     generators[genName][outerSwipeId] = {
//         swipe_id: innerSwipeId,                  // 当前激活的生成内容版本（内层 swipe）
//         swipes: { [innerSwipeId]: text }          // 该外层 swipe 下的全部版本
//     }
//   说明：
//     - genName = 'modules'（模块）或 generator.name（小剧场/角色心理等非模块生成内容）
//     - outerSwipeId = 对应正文 chat[floor].swipe_id；innerSwipeId = 同一 generator 的多版本
//     - active 指针内嵌在 swipe 节点内（方案 A：随消息/复制迁移不悬空）
//     - swipes 沿用 ST 概念（ST 正文即 chat[floor].swipes），语义对齐
//     - 复用 floorBridge（FLOOR_NS='ccore'），不直接操作 extra。
//
// 本模块是写侧唯一入口：任何写入/删除后都应调用 notifyFloorModulesUpdated(mesId)，
// eventHandler 统一监听并刷新模块缓存（机制 A，收口一处）。

import * as floorBridge from '../shared/floorBridge.js';
import { errorLog, debugLog } from '../utils/logger.js';

/** floor 数据袋内生成内容存储 key */
export const GENERATORS_KEY = 'generators';

/** 版本集合 key（swipe 节点内，沿用 ST 概念：chat[floor].swipes） */
export const CONTENT_KEY = 'swipes';

/** 激活版本指针 key（swipe 节点内，沿用 ST 概念：chat[floor].swipe_id 即当前激活 swipe 索引） */
export const ACTIVE_KEY = 'swipe_id';

/** 事件名：楼层模块数据变更 */
export const FLOOR_MODULES_UPDATED_EVENT = 'ccore-floor-modules-updated';

/** 兼容旧 key：F 一期 modulesBySwipe = { [swipeId]: raw }（最旧结构） */
const LEGACY_MODULES_BY_SWIPE_KEY = 'modulesBySwipe';

/** 兼容旧 key：13f9e91 独立激活层 generatorActive[genName][outerSwipe] = innerSwipe（已迁移进节点） */
const LEGACY_ACTIVE_KEY = 'generatorActive';

/**
 * 惰性迁移旧结构到新结构（swipe 节点 = { active, swipes }）。
 * 兼容三种来源：
 *   a) 最旧 modulesBySwipe：{ [swipeId]: raw } → 节点 { swipes: { '0': raw } }
 *   b) 13f9e91 generators[genName][outerSwipe][inner] = text（纯版本表）→ 包一层 swipes
 *   c) 13f9e91 独立 generatorActive 层 → 合并进对应节点 active
 * 迁移后删除旧 key。幂等：新结构（节点含 swipes）已存在则不迁移。
 * @param {number} mesId
 */
function migrateLegacyStructures(mesId) {
    const bag = floorBridge.get(mesId, GENERATORS_KEY);
    const genBag = bag && typeof bag === 'object' ? bag : {};

    // 1) 最旧 modulesBySwipe → generators.modules[swipe].swipes（仅在 generators.modules 不存在时）
    const legacyModules = floorBridge.get(mesId, LEGACY_MODULES_BY_SWIPE_KEY);
    if (legacyModules && typeof legacyModules === 'object') {
        if (!genBag.modules || typeof genBag.modules !== 'object' || !genBag.modules[Object.keys(legacyModules)[0]]?.[CONTENT_KEY]) {
            const modules = genBag.modules && typeof genBag.modules === 'object' ? genBag.modules : {};
            for (const [swipeId, raw] of Object.entries(legacyModules)) {
                if (raw) modules[swipeId] = { swipe_id: 0, swipes: { '0': raw } };
            }
            genBag.modules = modules;
        }
        floorBridge.del(mesId, LEGACY_MODULES_BY_SWIPE_KEY);
    }

    // 2) 13f9e91 纯版本表结构（节点直接是 { inner: text }，无 swipes）→ 包一层 swipes
    let changed = false;
    for (const genName of Object.keys(genBag)) {
        const gen = genBag[genName];
        if (!gen || typeof gen !== 'object') continue;
        for (const oKey of Object.keys(gen)) {
            const node = gen[oKey];
            if (!node || typeof node !== 'object') continue;
            // 纯版本表特征：不含 swipes 键，且值都是字符串（版本文本）
            if (node[CONTENT_KEY] === undefined) {
                const isPureVersions = Object.values(node).every(v => typeof v === 'string');
                if (isPureVersions) {
                    gen[oKey] = { swipe_id: undefined, swipes: { ...node } };
                    changed = true;
                }
            }
        }
    }

    // 3) 独立 generatorActive 层 → 合并进节点 active
    const legacyActive = floorBridge.get(mesId, LEGACY_ACTIVE_KEY);
    if (legacyActive && typeof legacyActive === 'object') {
        for (const [genName, outerMap] of Object.entries(legacyActive)) {
            if (!outerMap || typeof outerMap !== 'object') continue;
            const gen = genBag[genName];
            if (!gen || typeof gen !== 'object') continue;
            for (const [oKey, innerSwipe] of Object.entries(outerMap)) {
                const node = gen[oKey];
                if (node && typeof node === 'object') {
                    node.swipe_id = Number(innerSwipe);
                    changed = true;
                }
            }
        }
        floorBridge.del(mesId, LEGACY_ACTIVE_KEY);
    }

    if (changed || legacyModules) {
        floorBridge.set(mesId, GENERATORS_KEY, genBag);
        debugLog(`[floorModuleStore] 楼层 ${mesId} 旧存储结构已迁移到节点格式（active + swipes）`);
    }
}

/**
 * 取得某楼层某 generator 的存储袋（genName → { outerSwipeId: node }）。
 * 若不存在则按需创建（create=true）。
 * @param {number} mesId
 * @param {string} genName
 * @param {{create?: boolean}} [opts]
 * @returns {object|null} gen 数据袋（可能为 null：楼层无效）
 */
function genBagOf(mesId, genName, { create = false } = {}) {
    migrateLegacyStructures(mesId);
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
 * 取得某楼层某 generator 指定外层 swipe 下的节点（{ active, swipes }）。
 * 若节点不存在则按需创建（create=true）。
 * @param {number} mesId
 * @param {string} genName
 * @param {number|string} outerSwipeId
 * @param {{create?: boolean}} [opts]
 * @returns {object|null}
 */
function nodeOf(mesId, genName, outerSwipeId, { create = false } = {}) {
    const gen = genBagOf(mesId, genName, { create });
    if (!gen) return null;
    const oKey = String(outerSwipeId);
    let node = gen[oKey];
    if (!node || typeof node !== 'object' || node[CONTENT_KEY] === undefined) {
        if (!create) return null;
        node = { swipe_id: 0, swipes: {} };
        gen[oKey] = node;
    }
    return node;
}

/**
 * 取得某楼层某 generator 指定外层 swipe 下的版本表（swipes）。
 * @param {number} mesId
 * @param {string} genName
 * @param {number|string} outerSwipeId
 * @returns {object|null} { innerSwipeId: text }
 */
function versionsOf(mesId, genName, outerSwipeId) {
    const node = nodeOf(mesId, genName, outerSwipeId);
    if (!node) return null;
    return node[CONTENT_KEY];
}

/** 持久化 gen 数据袋到 floor（写后触发 floorBridge.set） */
function persistGen(mesId, genName, gen) {
    floorBridge.set(mesId, GENERATORS_KEY, { ...(floorBridge.get(mesId, GENERATORS_KEY) || {}), [genName]: gen });
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
    const node = nodeOf(mesId, genName, outerSwipeId, { create: true });
    node[CONTENT_KEY][String(innerSwipeId)] = text;
    persistGen(mesId, genName, gen);
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
    const node = nodeOf(mesId, genName, outerSwipeId, { create: true });
    const versions = node[CONTENT_KEY];
    // 找出当前最大内层 id（支持数字字符串），新版本 = max + 1
    const existingIds = Object.keys(versions)
        .map(Number)
        .filter(n => Number.isFinite(n));
    const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 0;
    versions[nextId] = text;
    node.swipe_id = nextId;
    persistGen(mesId, genName, gen);
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
    const node = gen[oKey];
    if (!node || typeof node !== 'object' || node[CONTENT_KEY] === undefined) return false;
    const versions = node[CONTENT_KEY];
    if (!Object.prototype.hasOwnProperty.call(versions, String(innerSwipeId))) return false;
    delete versions[String(innerSwipeId)];
    // 若删除的是激活版本，回退到剩余最大版本
    if (String(node.swipe_id) === String(innerSwipeId)) {
        const remaining = Object.keys(versions).map(Number).filter(n => Number.isFinite(n));
        node.swipe_id = remaining.length > 0 ? Math.max(...remaining) : 0;
    }
    persistGen(mesId, genName, gen);
    notifyFloorModulesUpdated(mesId);
    return true;
}

// ============================================================
// 激活版本指针（内嵌在 swipe 节点内）
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
    const node = nodeOf(mesId, genName, outerSwipeId);
    if (node && node.swipe_id !== undefined && node.swipe_id !== null) {
        const n = Number(node.swipe_id);
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
    const gen = genBagOf(mesId, genName, { create: true });
    if (!gen) return false;
    const node = nodeOf(mesId, genName, outerSwipeId, { create: true });
    node.swipe_id = String(innerSwipeId);
    persistGen(mesId, genName, gen);
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
    for (const [outerSwipeId, node] of Object.entries(modules)) {
        if (!node || typeof node !== 'object' || node[CONTENT_KEY] === undefined) continue;
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
