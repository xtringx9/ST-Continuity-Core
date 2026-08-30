// snapshotStore.js
// 快照累积态存储（F 二期快照阶段 2，checkpoint 稀疏化）。
//
// 定位：存「process 层累积中间态」的 checkpoint，供「从某层重算」使用（rebuildFrom）。
// 与 occurrenceCache 的区别：
//   - occurrenceCache：每层 extract raw（输入，逐层独立，惰性失效）
//   - snapshotStore：process 累积态 checkpoint（输出，跨楼层延续，后缀失效）
//
// ⚠️ checkpoint 稀疏化（用户确认，K=10）：
//   - 每 K 层存一个【完整】FloorSnapshot（0、10、20...）
//   - 中间层不存 → 内存 O(N²/K) 而非 O(N²)
//   - 从 X 重算：找最近未失效 checkpoint C（≤ X）→ 从 C 增量处理 C+1..end
//     （不需要 X-1：checkpoint 离 X 至多 K 步，直接整个 checkpoint..end 增量）
//
// 每层快照 = 阶段 0 各 step 的纯函数状态 + 未压缩组内模块集合：
//   {
//     dedup: DedupState,            // deduplicateStep.createDedupState
//     time: TimeState,              // timeCompletionStep.createTimeState
//     groupModules: Map<moduleName, Array<module>>,  // 去重+time 后未压缩（sort→补id→levelCompression 延后到 build 时）
//     semanticDedup: Map<string, module>,            // 语义级二次去重的跨层累积态（见 dedupSemanticStep.js）
//   }
//
// ⚠️ 所有状态必须【深拷贝】存取：快照必须是「某层处理完的纯净快照」（同 occurrenceCache 教训），
// 避免下游 process 就地修改 module/状态对象污染累积态。
//
// ⚠️ 失效是【后缀】：process 有跨楼层累积（incremental/level/timeline），
// 改 X 层 → X..end 全部重算 → invalidateFrom(floor) 删 checkpoints[floor..end]。

import { createDedupState } from './pipeline/deduplicateStep.js';
import { createTimeState } from './pipeline/timeCompletionStep.js';

/** checkpoint 间隔 */
export const CHECKPOINT_INTERVAL = 10;

/** checkpoints: Map<floor, FloorSnapshot>（仅每 K 层存） */
const checkpoints = new Map();

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
        time: createTimeState([]),
        groupModules: new Map(),
        // 语义级二次去重的跨层累积态（key → module），见 dedupSemanticStep.js
        semanticDedup: new Map(),
    };
}

/**
 * 某层是否应是 checkpoint 层（每 K 层）。
 * @param {number} floor
 * @returns {boolean}
 */
export function isCheckpointFloor(floor) {
    return floor >= 0 && floor % CHECKPOINT_INTERVAL === 0;
}

/**
 * 读取某层 checkpoint 快照（深拷贝，防污染）。
 * 仅 checkpoint 层有；中间层返回 null（需从最近 checkpoint 增量重建）。
 * @param {number} floor
 * @returns {Object|null} 快照副本；未缓存返回 null
 */
export function getSnapshot(floor) {
    const s = checkpoints.get(floor);
    return s ? clone(s) : null;
}

/**
 * 写入 checkpoint 快照（存深拷贝）。仅 checkpoint 层调用。
 * @param {number} floor
 * @param {Object} snapshot
 */
export function putSnapshot(floor, snapshot) {
    if (!isCheckpointFloor(floor)) return; // 中间层不存
    checkpoints.set(floor, clone(snapshot));
}

/**
 * 找最近未失效的 checkpoint（≤ floor）。
 * @param {number} floor
 * @returns {number|null} checkpoint 楼层；无则 null（需从空态起步）
 */
export function findNearestCheckpoint(floor) {
    let best = null;
    for (const key of checkpoints.keys()) {
        const n = Number(key);
        if (n <= floor && (best === null || n > best)) best = n;
    }
    return best;
}

/**
 * 失效从某层起的所有 checkpoint（后缀失效，process 跨楼层累积）。
 * @param {number} floor
 */
export function invalidateFrom(floor) {
    for (const key of checkpoints.keys()) {
        if (Number(key) >= floor) checkpoints.delete(key);
    }
}

// ⚠️ 3.2：运行期 dirty 会话。
// 记录「自哪层起累积态已失效（需续算）」。null = 当前快照到 end 有效（干净）。
// 事件失效时 mark 该层；续算成功（runModulePipeline useSnapshot）后 reset。
// 供「失效后增量续算」（从最近 checkpoint 续算 dirty..end），而非每次全段重算。
let dirtyFrom = null;

/** 标记自某层起失效（取更小楼层）。负数起始态 → 0。 */
export function markSnapshotDirty(floor) {
    const f = Math.max(0, Number(floor) || 0);
    if (dirtyFrom === null) dirtyFrom = f;
    else dirtyFrom = Math.min(dirtyFrom, f);
}

/** 复位 dirty（续算到 end 后调用 / 切聊天）。 */
export function resetSnapshotDirty() {
    dirtyFrom = null;
}

/** 获取 dirty 起点；null=干净。 */
export function getSnapshotDirtyFloor() {
    return dirtyFrom;
}

/** 清空全部快照（切聊天/插件禁用）。 */
export function clearSnapshots() {
    checkpoints.clear();
}

/** 调试：统计。 */
export function getSnapshotStats() {
    const floors = [...checkpoints.keys()].map(Number).sort((a, b) => a - b);
    return {
        total: floors.length,
        interval: CHECKPOINT_INTERVAL,
        floors,
    };
}

/** 调试：直接打印原始 checkpoint Map。 */
export function outputSnapshots() {
    console.log('[SnapshotStore] 当前 checkpoint（原始）:', checkpoints);
    return checkpoints;
}
