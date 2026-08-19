// snapshotStore.js
// 快照累积态存储（F 二期快照阶段 2）。
//
// 定位：存「process 层每层的累积中间态」，供「从 X 重算」使用（rebuildFrom）。
// 与 occurrenceCache 的区别：
//   - occurrenceCache：每层 extract raw（输入，逐层独立，惰性失效）
//   - snapshotStore：每层 process 累积态（输出，跨楼层延续，后缀失效）
//
// 每层快照 = 阶段 0 各 step 的纯函数状态 + 未压缩组内模块集合：
//   {
//     dedup: DedupState,            // deduplicateStep.createDedupState
//     idCompletion: IdState,        // idCompletionStep.createIdCompletionState
//     time: TimeState,              // timeCompletionStep.createTimeState
//     groupModules: Map<moduleName, Array<module>>,  // 去重+id+time 后未压缩（levelCompression 输入）
//     merged: Map<groupKey, MergeStepState>,         // mergeStep 累积态（incremental 模块）
//   }
//
// ⚠️ 所有状态必须【深拷贝】存取：下游 process 会就地修改 module/状态对象，
// 快照必须是「某层处理完的纯净快照」（同 occurrenceCache 教训）。
//
// ⚠️ 失效是【后缀】：process 有跨楼层累积（incremental/level/timeline），
// 改 X 层 → X..end 全部重算 → invalidateFrom(floor) 删 snapshots[floor..end]。

import { createDedupState } from './pipeline/deduplicateStep.js';
import { createIdCompletionState } from './pipeline/idCompletionStep.js';
import { createTimeState } from './pipeline/timeCompletionStep.js';
import { createMergeStepState } from './pipeline/mergeStep.js';

/** snapshots: Map<floor, FloorSnapshot> */
const snapshots = new Map();

/** 深拷贝（structuredClone 兜底 JSON） */
function clone(v) {
    try {
        return structuredClone(v);
    } catch (e) {
        return JSON.parse(JSON.stringify(v));
    }
}

/**
 * 创建空 FloorSnapshot（各 step 初始态）。
 * @returns {Object}
 */
export function createEmptySnapshot() {
    return {
        dedup: createDedupState([]),
        idCompletion: createIdCompletionState(),
        time: createTimeState([]),
        groupModules: new Map(),
        merged: new Map(),
    };
}

/**
 * 读取某层快照（深拷贝，防污染）。
 * @param {number} floor
 * @returns {Object|null} 快照副本；未缓存返回 null
 */
export function getSnapshot(floor) {
    const s = snapshots.get(floor);
    return s ? clone(s) : null;
}

/**
 * 写入某层快照（存深拷贝）。
 * @param {number} floor
 * @param {Object} snapshot
 */
export function putSnapshot(floor, snapshot) {
    snapshots.set(floor, clone(snapshot));
}

/**
 * 失效从某层起的所有快照（后缀失效，process 跨楼层累积）。
 * @param {number} floor
 */
export function invalidateFrom(floor) {
    for (const key of snapshots.keys()) {
        if (Number(key) >= floor) snapshots.delete(key);
    }
}

/** 清空全部快照（切聊天/插件禁用）。 */
export function clearSnapshots() {
    snapshots.clear();
}

/** 调试：统计。 */
export function getSnapshotStats() {
    let total = 0;
    let minFloor = Infinity;
    let maxFloor = -Infinity;
    for (const key of snapshots.keys()) {
        total++;
        const n = Number(key);
        if (n < minFloor) minFloor = n;
        if (n > maxFloor) maxFloor = n;
    }
    return { total, minFloor: minFloor === Infinity ? null : minFloor, maxFloor: maxFloor === -Infinity ? null : maxFloor };
}

/** 调试：直接打印原始快照 Map。 */
export function outputSnapshots() {
    console.log('[SnapshotStore] 当前快照（原始）:', snapshots);
    return snapshots;
}
