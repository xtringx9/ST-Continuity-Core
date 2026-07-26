// floorBridge.js
// 桥接"按楼层（单条消息）存取的扩展数据袋"。
//
// 与 ST 原生变量无关：ST 没有楼层级变量 API（全仓无 getChatVariable/setChatVariable）。
// 数据落在 chat[floor].extra[FLOOR_NS]，随该消息那一行写入 jsonl，刷新/重载后仍在。
//
// 命名约定：
//   - FLOOR_NS 用项目专属缩写 'ccore'（与 __ccore__ / ccore_range_* 命名体系一致），
//     定义为常量，调用处统一走 FLOOR_NS，切勿裸写字符串，避免与其他插件或
//     ST 原生字段的 key 发生碰撞。
//   - 与 variableBridge 的区别：本模块类型完全保真（对象/数组原样存取），适合存
//     结构化内部数据；variableBridge 走 ST 原生变量（文本/数字导向、会被强制转换）。

import { chat } from '../../../../../../script.js';
import { saveChatDebounced } from '../../../../../../script.js';

/** 楼层数据袋在消息 extra 下的命名空间 key（勿裸写 'ccore'） */
export const FLOOR_NS = 'ccore';

/**
 * 取得（或按需创建）第 floor 层的 ccore 数据袋。
 * @param {number} floor 楼层索引（chat 数组下标）
 * @param {{ create?: boolean }} [opts]
 * @returns {object|null} 数据袋对象；楼层无效返回 null
 */
function bagOf(floor, { create = false } = {}) {
    const mes = chat[floor];
    if (!mes) return null;
    if (!mes.extra) mes.extra = {};
    if (!mes.extra[FLOOR_NS]) {
        if (!create) return null;
        mes.extra[FLOOR_NS] = {};
    }
    return mes.extra[FLOOR_NS];
}

/**
 * 读取第 floor 层某个 key。
 * @param {number} floor
 * @param {string} key
 * @returns {*} 不存在返回 undefined
 */
export function get(floor, key) {
    const bag = bagOf(floor);
    return bag ? bag[key] : undefined;
}

/**
 * 读取第 floor 层整个数据袋的浅拷贝。
 * @param {number} floor
 * @returns {object}
 */
export function getAll(floor) {
    const bag = bagOf(floor);
    return bag ? { ...bag } : {};
}

/**
 * 判断第 floor 层是否存在某个 key。
 * @param {number} floor
 * @param {string} key
 * @returns {boolean}
 */
export function has(floor, key) {
    const bag = bagOf(floor);
    return !!bag && Object.prototype.hasOwnProperty.call(bag, key);
}

/**
 * 写入第 floor 层某个 key（默认触发持久化）。
 * @param {number} floor
 * @param {string} key
 * @param {*} value
 * @param {{ save?: boolean }} [opts] save=false 时跳过自动保存（批量操作后调 save()）
 * @returns {*} 写入的值；楼层无效返回 undefined
 */
export function set(floor, key, value, { save = true } = {}) {
    const bag = bagOf(floor, { create: true });
    if (!bag) {
        console.warn(`[floorBridge] 无效楼层索引：${floor}`);
        return undefined;
    }
    bag[key] = value;
    if (save) saveChatDebounced();
    return value;
}

/**
 * 批量写入第 floor 层多个 key。
 * @param {number} floor
 * @param {object} entries { key: value, ... }
 * @param {{ save?: boolean }} [opts]
 */
export function setMany(floor, entries, { save = true } = {}) {
    const bag = bagOf(floor, { create: true });
    if (!bag) {
        console.warn(`[floorBridge] 无效楼层索引：${floor}`);
        return;
    }
    Object.assign(bag, entries);
    if (save) saveChatDebounced();
}

/**
 * 删除第 floor 层某个 key（默认触发持久化）。
 * @param {number} floor
 * @param {string} key
 * @param {{ save?: boolean }} [opts]
 */
export function del(floor, key, { save = true } = {}) {
    const bag = bagOf(floor);
    if (!bag) return;
    delete bag[key];
    if (save) saveChatDebounced();
}

/**
 * 强制持久化当前楼层改动（批量 set 后调用，saveChat 会重写整个聊天文件）。
 */
export function save() {
    saveChatDebounced();
}
