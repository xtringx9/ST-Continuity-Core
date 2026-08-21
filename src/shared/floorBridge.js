// floorBridge.js
// 桥接"按楼层（单条消息）存取的扩展数据袋"。
//
// 与 ST 原生变量无关：ST 没有楼层级变量 API（全仓无 getChatVariable/setChatVariable）。
//
// ⚠️ 数据落点：chat[floor][FLOOR_NS]（**消息顶层独立键**，而非 extra.ccore）。
//   历史：此前存在 chat[floor].extra[FLOOR_NS]。但 ST 的 swipe 机制会：
//     - 生成时深拷 extra 到 swipe_info[i].extra（每 swipe 复制一份 → 文件臃肿）；
//     - 切 swipe 时用 swipe_info[swipeId].extra **整体覆盖** extra（script.js syncSwipeToMes）
//       → 顶层 data 被历史快照回滚，旧副本残留。
//   改为消息顶层键后，ST 只对 extra 做快照/覆盖，不会触碰 chat[floor].ccore，模块数据成为
//   单一事实源，不随 swipe_info 复制，也不再被回滚。此改动仅影响 floorBridge 落点，
//   下游 floorModuleStore 等通过本模块 get/set 访问，无需改动。
//
// 命名约定：
//   - FLOOR_NS 用项目专属缩写 'ccore'（与 __ccore__ / ccore_range_* 命名体系一致），
//     定义为常量，调用处统一走 FLOOR_NS，切勿裸写字符串，避免与其他插件或
//     ST 原生字段的 key 发生碰撞。
//   - 与 variableBridge 的区别：本模块类型完全保真（对象/数组原样存取），适合存
//     结构化内部数据；variableBridge 走 ST 原生变量（文本/数字导向、会被强制转换）。

import { chat } from '../../../../../../script.js';
import { saveChatDebounced } from '../../../../../../script.js';
import { debugLog } from '../utils/logger.js';

/** 楼层数据袋在消息**顶层**的命名空间 key（勿裸写 'ccore'） */
export const FLOOR_NS = 'ccore';

/** 旧落点：extra 下的命名空间 key（迁移用，勿再新增写入） */
const LEGACY_EXTRA_NS = 'ccore';

/**
 * 楼层数据落点迁移开关（extra.ccore → 顶层 chat[mesId].ccore + 清理 swipe_info 冗余副本）。
 * 一次性迁移任务：默认关闭，当前聊天清理完毕后置 false 即可；需要再次清理时改为 true。
 * ⚠️ 只是历史版本（数据存 extra）升级到顶层键的收尾，非运行期必需——bagOf 读时惰性迁移始终生效。
 */
const RUN_LEGACY_MIGRATION = false;

/**
 * 迁移旧数据：把 chat[floor].extra.ccore 搬移到 chat[floor].ccore（顶层）。
 * 幂等：仅在顶层不存在而旧位存在时执行一次；执行后清空 extra.ccore 避免残留。
 * @param {number} floor
 * @returns {boolean} 是否发生迁移
 */
function migrateLegacy(floor) {
    const mes = chat[floor];
    if (!mes) return false;
    // 顶层已有 → 无需迁移
    if (mes[FLOOR_NS] !== undefined && mes[FLOOR_NS] !== null) return false;
    const legacy = mes.extra?.[LEGACY_EXTRA_NS];
    if (legacy !== undefined && legacy !== null) {
        mes[FLOOR_NS] = legacy;
        delete mes.extra[LEGACY_EXTRA_NS];
        return true;
    }
    return false;
}

/**
 * 取得（或按需创建）第 floor 层的 ccore 数据袋。
 * @param {number} floor 楼层索引（chat 数组下标）
 * @param {{ create?: boolean }} [opts]
 * @returns {object|null} 数据袋对象；楼层无效返回 null
 */
function bagOf(floor, { create = false } = {}) {
    const mes = chat[floor];
    if (!mes) return null;
    // 读时静默迁移旧 extra.ccore（避免每次都走完整性检查的开销，仅首次）
    if (mes[FLOOR_NS] === undefined && mes.extra && mes.extra[LEGACY_EXTRA_NS] !== undefined) {
        migrateLegacy(floor);
    }
    if (mes[FLOOR_NS] === undefined || mes[FLOOR_NS] === null) {
        if (!create) return null;
        mes[FLOOR_NS] = {};
    }
    return mes[FLOOR_NS];
}

/**
 * 清理某楼层 swipe_info 内残留的旧 ccore 快照（供 migrateAllLegacyFloorData 使用）。
 * 旧版本把 ccore 存 extra 内，ST 生成时深拷进 swipe_info[i].extra —— 迁移到顶层后这些是
 * 冗余副本（顶层才是权威），删除 swipe_info[i].extra 里的 ccore 键给文件瘦身，保留其余 ST 数据。
 * @param {number} floor
 * @returns {number} 删除的副本数
 */
function purgeSwipeInfoCcore(floor) {
    const mes = chat[floor];
    if (!mes || !Array.isArray(mes.swipe_info)) { debugLog(`[migrate] 楼层 ${floor} 无 swipe_info 或非数组`, mes?.swipe_info); return 0; }
    let count = 0;
    for (let k = 0; k < mes.swipe_info.length; k++) {
        const info = mes.swipe_info[k];
        if (info && typeof info === 'object' && info.extra && Object.prototype.hasOwnProperty.call(info.extra, LEGACY_EXTRA_NS)) {
            delete info.extra[LEGACY_EXTRA_NS];
            count++;
            debugLog(`[migrate] 楼层 ${floor} swipe_info[${k}] 已清 ccore`);
        }
    }
    return count;
}

/**
 * 为该聊天当前已加载的全部楼层执行旧数据迁移（聊天加载时调用一次）。
 * 依次：迁移 extra.ccore → 顶层 chat[mesId].ccore，清理 swipe_info 内残留 ccore 副本。
 * @returns {number} 迁移/清理条目数
 */
export function migrateAllLegacyFloorData() {
    if (!RUN_LEGACY_MIGRATION) return 0; // 迁移开关关闭（运行期由 bagOf 惰性迁移兜底）
    debugLog('[migrate] migrateAllLegacyFloorData 被调用，chat.length =', Array.isArray(chat) ? chat.length : '非数组');
    let count = 0;
    if (!Array.isArray(chat)) return 0;
    for (let i = 0; i < chat.length; i++) {
        if (migrateLegacy(i)) count++;
        const purged = purgeSwipeInfoCcore(i);
        if (purged > 0) debugLog(`[migrate] 楼层 ${i} 清理 ${purged} 条 swipe_info ccore`);
        count += purged;
    }
    debugLog('[migrate] 迁移/清理结束，count =', count);
    if (count > 0) saveChatDebounced();
    return count;
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
