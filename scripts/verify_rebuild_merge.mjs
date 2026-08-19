// 阶段 2 最小验证：merge 累积态可从快照 X-1 续算，且与全量重算一致。
// 运行：node scripts/verify_rebuild_merge.mjs
// 场景：多楼层 incremental 模块（含 time/isAddTime 变化），验证「快照续算 merged == 全量 merged」。
// ⚠️ 只测 merge 层（阶段 0 已单独验证各 step 可续传）；本测试串联「dedup → merge」，
//    模拟快照从 X 续算 merge 累积态的核心路径。
// 用完即删或保留为回归资产。

import { createDedupState, dedupStep, dedupToState, uniqueModulesFromState } from '../src/core/pipeline/deduplicateStep.js';
import { createMergeStepState, mergeStep, mergeModulesToState } from '../src/core/pipeline/mergeStep.js';

let failures = 0;
function assert(cond, msg) {
    if (cond) console.log('✅ PASS:', msg);
    else { console.error('❌ FAIL:', msg); failures++; }
}
function deepEqual(a, b, path = '') {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (typeof a === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        for (const k of ka) if (!deepEqual(a[k], b[k], `${path}.${k}`)) { console.error(`   diff @ ${path}.${k}:`, a[k], 'vs', b[k]); return false; }
        return true;
    }
    return false;
}

// 模块配置：item 增量（id 主键 + name + time）
const moduleConfigs = [
    {
        name: 'item', outputMode: 'incremental', outputPosition: 'embedded',
        variables: [
            { name: 'id', isIdentifier: true },
            { name: 'name' },
            { name: 'time' },
        ],
    },
];

function imod(mi, id, name, time, isAddTime, timeData) {
    return {
        moduleName: 'item',
        messageIndex: mi,
        messageIndexHistory: [mi],
        raw: `[item|id:${id}|name:${name}|time:${time}]`,
        variables: { id, name, time },
        ...(isAddTime !== undefined ? { isAddTime } : {}),
        ...(timeData ? { timeData } : {}),
    };
}
const tdv = (v) => ({ isValid: true, isComplete: true, startTime: { timestamp: v } });

// 场景：多楼层 item 增量变化（id 相同，name/time 逐层变，含 isAddTime）
const modules = [
    imod(0, '1', 'A', '2024-11-12 周二 08:00', undefined, tdv(100)),
    imod(1, '1', 'B', '2024-11-12 周二 08:30', true, tdv(130)),
    imod(2, '1', 'C', '2024-11-12 周二 09:00', undefined, tdv(200)),
    imod(3, '1', 'D', '2024-11-12 周二 09:30', true, tdv(230)),
    imod(4, '1', 'E', '2024-11-12 周二 10:00', undefined, tdv(300)),
    imod(5, '2', 'X', '2024-11-12 周二 10:30', undefined, tdv(330)),  // 不同 id → 另一组
    imod(6, '2', 'Y', '2024-11-12 周二 11:00', true, tdv(360)),
];

// 按 groupModulesByIdentifier 的组 key 近似：id 作为组标识（item 的 id 是主标识符）
function groupKeyOf(m) {
    return `__MODULE_GROUP__${m.moduleName}__IDENTIFIER__${m.variables.id}__`;
}

// 全量参考：dedup 全部 → 分组 → 每组合并（mergeModulesToState）
const fullDedup = dedupToState(modules, moduleConfigs);
const fullUnique = uniqueModulesFromState(fullDedup);
const fullGroups = {};
for (const m of fullUnique) {
    const k = groupKeyOf(m);
    if (!fullGroups[k]) fullGroups[k] = [];
    fullGroups[k].push(m);
}
const fullMerged = {};
for (const [k, list] of Object.entries(fullGroups)) {
    // 组内按 messageIndex 排序（与 normalize 的 sortModules 语义近似——item 的 id 是唯一标识符，保持楼层序）
    list.sort((a, b) => a.messageIndex - b.messageIndex);
    fullMerged[k] = mergeModulesToState(list, true);
}

// 从 X 续算：快照 X-1 的 merged（各组 state）+ X..end 去重新模块 → mergeStep 续算
for (let X = 0; X <= modules.length; X++) {
    // 快照 X-1：dedup 0..X-1 → 分组 → merge 到 X-1
    const prefixDedup = dedupToState(modules.slice(0, X), moduleConfigs);
    const prefixUnique = uniqueModulesFromState(prefixDedup);
    const prefixGroups = {};
    for (const m of prefixUnique) {
        const k = groupKeyOf(m);
        if (!prefixGroups[k]) prefixGroups[k] = [];
        prefixGroups[k].push(m);
    }
    const snapMerged = {};
    for (const [k, list] of Object.entries(prefixGroups)) {
        list.sort((a, b) => a.messageIndex - b.messageIndex);
        snapMerged[k] = mergeModulesToState(list, true);
    }

    // X..end 去重新模块（从全量 dedup 结果里取 messageIndex >= X 的）
    const suffixUnique = fullUnique.filter(m => m.messageIndex >= X);

    // 续算：对每个 suffix 模块，并入对应组 state
    const rebuilt = {};
    for (const [k, state] of Object.entries(snapMerged)) rebuilt[k] = { ...state, timeline: state.timeline.slice() };
    for (const m of suffixUnique) {
        const k = groupKeyOf(m);
        if (!rebuilt[k]) rebuilt[k] = createMergeStepState();
        rebuilt[k] = mergeStep(rebuilt[k], m, true);
    }

    assert(deepEqual(rebuilt, fullMerged), `从 X=${X} 续算 merge 累积态 == 全量`);
}

console.log(failures ? `\n存在 ${failures} 个失败` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
