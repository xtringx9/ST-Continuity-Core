// chatFileBridge.js
// 桥接"按聊天文件（chat_metadata）存取的扩展数据袋"。
//
// 与 floorBridge 的区别：
//   - floorBridge 落点是 chat[floor].extra[FLOOR_NS]（单条消息楼层级，随该行写入 jsonl）。
//   - 本模块落点是 chat_metadata[FLOOR_NS]（聊天文件级，随 .jsonl 元数据写入，跨楼层共享）。
// 两者共用同一个命名空间常量 FLOOR_NS='ccore'，与 __ccore__ / ccore_range_* 命名体系一致，
// 调用处统一走该常量，切勿裸写 'ccore'，避免与其他插件或 ST 原生字段的 key 碰撞。
//
// 与 variableBridge 的区别：本模块类型完全保真（对象/数组原样存取），适合存结构化
// 内部数据；variableBridge 走 ST 原生变量（文本/数字导向、会被强制转换）。

import { chat_metadata } from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { FLOOR_NS } from './floorBridge.js';

/**
 * 取得（或按需创建）聊天文件级的 ccore 数据袋。
 * @param {{ create?: boolean }} [opts]
 * @returns {object} 数据袋对象（聊天级始终存在，无"无效"概念）
 */
function bagOf({ create = false } = {}) {
    if (!chat_metadata) return {};
    if (!chat_metadata[FLOOR_NS]) {
        if (!create) return {};
        chat_metadata[FLOOR_NS] = {};
    }
    return chat_metadata[FLOOR_NS];
}

/**
 * 读取聊天文件级某个 key。
 * @param {string} key
 * @returns {*} 不存在返回 undefined
 */
export function get(key) {
    const bag = bagOf();
    return bag ? bag[key] : undefined;
}

/**
 * 读取整个聊天文件级数据袋的浅拷贝。
 * @returns {object}
 */
export function getAll() {
    const bag = bagOf();
    return bag ? { ...bag } : {};
}

/**
 * 判断聊天文件级是否存在某个 key。
 * @param {string} key
 * @returns {boolean}
 */
export function has(key) {
    const bag = bagOf();
    return !!bag && Object.prototype.hasOwnProperty.call(bag, key);
}

/**
 * 写入聊天文件级某个 key（默认触发持久化）。
 * @param {string} key
 * @param {*} value
 * @param {{ save?: boolean }} [opts] save=false 时跳过自动保存（批量操作后调 save()）
 * @returns {*} 写入的值
 */
export function set(key, value, { save = true } = {}) {
    const bag = bagOf({ create: true });
    bag[key] = value;
    if (save) saveChatFile();
    return value;
}

/**
 * 批量写入聊天文件级多个 key。
 * @param {object} entries { key: value, ... }
 * @param {{ save?: boolean }} [opts]
 */
export function setMany(entries, { save = true } = {}) {
    const bag = bagOf({ create: true });
    Object.assign(bag, entries);
    if (save) saveChatFile();
}

/**
 * 删除聊天文件级某个 key（默认触发持久化）。
 * @param {string} key
 * @param {{ save?: boolean }} [opts]
 */
export function del(key, { save = true } = {}) {
    const bag = bagOf();
    if (!bag) return;
    delete bag[key];
    if (save) saveChatFile();
}

/**
 * 强制持久化当前聊天文件改动（重写 .jsonl 元数据）。
 */
export function save() {
    saveChatFile();
}

function saveChatFile() {
    try {
        const context = getContext();
        if (context && typeof context.saveMetadata === 'function') {
            context.saveMetadata();
        }
    } catch (e) {
        console.error('[chatFileBridge] saveMetadata 失败', e);
    }
}
