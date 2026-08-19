// occurrenceCache.js
// 每层 extract 结果缓存（F 二期快照阶段 1）。
//
// 定位：缓存「每层提取出的 raw 模块」，避免重复 extract（性能实测 extract 约 30% 成本且线性）。
// 每层 extract 独立（正文/floor/聊天级条目都基于楼层），编辑某层只失效该层。
//
// 结构：Map<chatKey, Map<source, Map<floor, Array<rawModule>>>>
//   - source：'chatText' | 'asyncChat' | 'chatMeta'
//   - floor：该层楼层号；负数 = 起始态层（聊天级条目 messageIndex=-1/-2...；世界书已搬迁不再参与）
//
// ⚠️ 按「源 × 层」缓存而非「mode × 层」：
//   - 提取时每个源独立；失效精确到源（编辑正文→chatText 层，floor 变更→asyncChat 层，条目变更→chatMeta 层）
//   - 合并时按 mode（sync/async）取源集合（getActiveSourceNames 决定），无需跨 modeKey 失效
//
// 变更入口（2026-08-19 用户确认，见 HANDOFF-F2-SNAPSHOT）：
//   - 编辑消息正文 / 切 swipe  → invalidateSource('chatText', floor)
//   - floor generators 写/切/删版本 → invalidateSource('asyncChat', mesId)
//   - 聊天级条目内容/开关/增删 → invalidateSource('chatMeta', 锚定层)
//   - 聊天级条目楼层号改 → invalidateSource('chatMeta', 旧层) + invalidateSource('chatMeta', 新层)
//   - 聊天级条目总开关 → chatMeta 所有层（invalidateSourceAll('chatMeta')）
//   - 切聊天 → invalidateChat(chatKey)

/** chatKey → source → floor → raws */
const cache = new Map();

import { getContext } from '../../../../../extensions.js';

/**
 * 获取当前聊天的缓存键（与 moduleCacheManager 一致：chatId + chat_id_hash）。
 * @returns {string}
 */
export function getChatCacheKey() {
    try {
        const ctx = getContext();
        return String(ctx?.chatId || '') + '_' + String(ctx?.chatMetadata?.chat_id_hash || '');
    } catch (e) {
        return 'unknown';
    }
}

/** 内部：source 层 Map 获取（不存在返回 null，不创建） */
function sourceMapOf(chatKey, source) {
    return cache.get(chatKey)?.get(source) || null;
}

/**
 * 深拷贝 raw 模块（structuredClone 兜底 JSON）。
 * ⚠️ 必须：下游 normalize/dedup/merge 会就地修改 module 对象（messageIndexHistory、
 * messageIndex、isAddTime、variables 等），缓存必须存「提取时的纯净快照」，
 * 否则缓存对象被污染导致二次读取数据/样式错乱。
 */
function cloneRaws(raws) {
    try {
        return structuredClone(raws);
    } catch (e) {
        return Array.isArray(raws) ? raws.map(r => JSON.parse(JSON.stringify(r))) : raws;
    }
}

/**
 * 读取某层 extract 缓存（返回深拷贝，避免下游就地修改污染缓存）。
 * @param {string} chatKey
 * @param {string} source 'chatText' | 'asyncChat' | 'chatMeta'
 * @param {number} floor
 * @returns {Array|null} 缓存的 raw 模块数组副本；未缓存返回 null
 */
export function getOccurrence(chatKey, source, floor) {
    const raws = sourceMapOf(chatKey, source)?.get(floor);
    return raws ? cloneRaws(raws) : null;
}

/**
 * 写入某层 extract 缓存（存深拷贝，保证缓存纯净）。
 * @param {string} chatKey
 * @param {string} source
 * @param {number} floor
 * @param {Array} raws
 */
export function setOccurrence(chatKey, source, floor, raws) {
    if (!cache.has(chatKey)) cache.set(chatKey, new Map());
    const src = cache.get(chatKey);
    if (!src.has(source)) src.set(source, new Map());
    src.get(source).set(floor, cloneRaws(raws));
}

/**
 * 判断某层是否有缓存。
 * @param {string} chatKey
 * @param {string} source
 * @param {number} floor
 * @returns {boolean}
 */
export function hasOccurrence(chatKey, source, floor) {
    return sourceMapOf(chatKey, source)?.has(floor) ?? false;
}

/**
 * 失效某源某层缓存。
 * @param {string} chatKey
 * @param {string} source
 * @param {number} floor
 */
export function invalidateOccurrence(chatKey, source, floor) {
    sourceMapOf(chatKey, source)?.delete(floor);
}

/**
 * 失效某源全部层（聊天级条目总开关等）。
 * @param {string} chatKey
 * @param {string} source
 */
export function invalidateSourceAll(chatKey, source) {
    cache.get(chatKey)?.delete(source);
}

/**
 * 失效某个聊天的全部缓存（切聊天）。
 * @param {string} chatKey
 */
export function invalidateChat(chatKey) {
    cache.delete(chatKey);
}

/** 清空全部缓存（插件禁用等）。 */
export function clearOccurrenceCache() {
    cache.clear();
}

/** 调试：统计信息。 */
export function getOccurrenceStats() {
    let total = 0;
    let chats = 0;
    for (const [chatKey, srcMap] of cache) {
        chats++;
        for (const [source, floorMap] of srcMap) {
            total += floorMap.size;
        }
    }
    return { chats, total };
}

/**
 * 调试：直接打印当前 occurrence 缓存的原始 Map（chatKey → source → floor → raw 数组）。
 * 不做任何汇总/加工——原原本本输出缓存内容，可在控制台展开查看任意层的模块文本。
 */
export function outputOccurrenceCache() {
    console.log('[OccurrenceCache] 当前缓存（原始）:', cache);
    return cache;
}
