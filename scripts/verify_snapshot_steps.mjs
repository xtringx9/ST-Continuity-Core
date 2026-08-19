// 快照阶段 0 回归测试：mergeStep + dedupStep + idCompletionStep 可组合性等价性。
// 运行：node scripts/verify_snapshot_steps.mjs
// 验证「从 X 分段 == 全段」对每个 X 切点成立。用完即删（或保留为回归资产）。

import { createMergeStepState, mergeStep, mergeModulesToState } from '../src/core/pipeline/mergeStep.js';
import { createDedupState, dedupStep, dedupToState, uniqueModulesFromState } from '../src/core/pipeline/deduplicateStep.js';
import { createIdCompletionState, idCompletionStep, idCompletionToState } from '../src/core/pipeline/idCompletionStep.js';

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

/* ================= mergeStep ================= */
function makeModule({ mi, vars, isAddTime = undefined, timeData = undefined, history }) {
    return {
        moduleName: 'item',
        messageIndex: mi,
        messageIndexHistory: history || [mi],
        raw: `[item|id:${vars.id}|name:${vars.name}|time:${vars.time}]`,
        variables: { ...vars },
        ...(isAddTime !== undefined ? { isAddTime } : {}),
        ...(timeData ? { timeData } : {}),
    };
}
const tdv = (v) => ({ isValid: true, isComplete: true, startTime: { timestamp: v } });

const mergeScenarios = [
    [
        makeModule({ mi: 0, vars: { id: '1', name: 'A', time: '08:00' }, timeData: tdv(100) }),
        makeModule({ mi: 3, vars: { id: '1', name: 'B', time: '09:00' }, timeData: tdv(200) }),
        makeModule({ mi: 7, vars: { id: '1', name: 'B', time: '09:30' }, isAddTime: true, timeData: tdv(210) }),
        makeModule({ mi: 10, vars: { id: '1', name: 'C', time: '10:00' }, timeData: tdv(300) }),
    ],
    [
        makeModule({ mi: 0, vars: { id: '9', name: 'P', time: '08:00' }, timeData: tdv(100) }),
        makeModule({ mi: 1, vars: { id: '9', name: 'Q', time: '08:15' }, isAddTime: true, timeData: tdv(115) }),
        makeModule({ mi: 2, vars: { id: '9', name: 'R', time: '08:30' }, timeData: tdv(130) }),
        makeModule({ mi: 3, vars: { id: '9', name: 'S', time: '08:45' }, isAddTime: true, timeData: tdv(145) }),
    ],
];
for (const [si, mods] of mergeScenarios.entries()) {
    const full = mergeModulesToState(mods, true);
    for (let X = 0; X <= mods.length; X++) {
        const prefix = mergeModulesToState(mods.slice(0, X), true);
        let st = { ...prefix, timeline: prefix.timeline.slice() };
        for (let i = X; i < mods.length; i++) st = mergeStep(st, mods[i], true);
        assert(deepEqual(st, full), `mergeStep 场景${si + 1}: 从 X=${X} 分段 == 全段`);
    }
}

/* ================= dedupStep ================= */
// 模拟模块配置：item 增量(含 id 主键 + name)，loc 全量
const moduleConfigs = [
    {
        name: 'item', outputMode: 'incremental', outputPosition: 'embedded',
        variables: [
            { name: 'id', isIdentifier: true },
            { name: 'name' },
            { name: 'desc' },
            { name: 'time' },
        ],
    },
    { name: 'loc', outputMode: 'full', outputPosition: 'body', variables: [{ name: 'name' }] },
];

function dmod(name, mi, vars) {
    return { moduleName: name, messageIndex: mi, messageIndexHistory: [mi], raw: `[${name}|...]`, variables: { ...vars } };
}

// 场景：含同值楼层（messageIndexHistory 累积）、diff>2 推进、全量模块保留最小楼层
const dedupScenarios = [
    [
        dmod('item', 0, { id: '1', name: 'A', desc: 'x', time: '08:00' }),
        dmod('item', 1, { id: '1', name: 'A', desc: 'x', time: '08:00' }), // 同值，history 累积
        dmod('item', 5, { id: '1', name: 'B', desc: 'y', time: '09:00' }), // 变值，diff>2 推进 messageIndex
        dmod('item', 6, { id: '1', name: 'B', desc: 'y', time: '09:00' }), // 同值
        dmod('loc', 10, { name: 'Tavern' }),
        dmod('loc', 3, { name: 'Tavern' }), // 全量：保留较小楼层 3
    ],
    [
        dmod('item', 0, { id: '5', name: 'X', desc: 'a', time: '08:00' }),
        dmod('item', 4, { id: '5', name: 'X', desc: 'a', time: '08:00' }), // diff>2 但同值
        dmod('item', 9, { id: '5', name: 'Y', desc: 'b', time: '09:00' }),
        dmod('loc', 0, { name: 'Forest' }),
        dmod('loc', 8, { name: 'Forest' }),
        dmod('loc', 2, { name: 'Forest' }),
    ],
];

for (const [si, mods] of dedupScenarios.entries()) {
    const full = dedupToState(mods, moduleConfigs);
    const fullArr = uniqueModulesFromState(full);
    for (let X = 0; X <= mods.length; X++) {
        // 从 X 继续：重新从空态跑到 X-1，再从 X 继续
        const prefixSt = dedupToState(mods.slice(0, X), moduleConfigs);
        let contSt = prefixSt;
        for (let i = X; i < mods.length; i++) contSt = dedupStep(contSt, mods[i]);
        assert(
            deepEqual(uniqueModulesFromState(contSt), fullArr),
            `dedupStep 场景${si + 1}: 从 X=${X} 分段 == 全段（模块数组）`,
        );
    }
}

/* ================= idCompletionStep ================= */
// 模块配置：char 有 id 主键 + name backup 标识符；无 id 模块的模块不受影响
const idModuleConfigs = [
    {
        name: 'char', outputMode: 'incremental', outputPosition: 'embedded',
        variables: [
            { name: 'id', isIdentifier: true },
            { name: 'name', isBackupIdentifier: true },
            { name: 'desc' },
        ],
    },
    { name: 'loc', outputMode: 'full', outputPosition: 'body', variables: [{ name: 'name' }] },
];

function imod(name, mi, vars) {
    return { moduleName: name, messageIndex: mi, variables: { ...vars } };
}

// 场景：部分已有 id、部分靠 backup 补全（含同 backupKey 复用）、无 backup 自增
const idScenarios = [
    [
        imod('char', 0, { id: '10', name: 'A', desc: 'x' }), // 已有 id 10，不占计数器
        imod('char', 1, { id: '', name: 'B', desc: 'y' }),   // backup B → 分配 1
        imod('char', 2, { id: '', name: 'B', desc: 'z' }),   // backup B → 复用 1
        imod('char', 3, { id: '', name: 'C', desc: 'w' }),   // backup C → 分配 2
        imod('char', 4, { id: '', name: '', desc: 'no-backup' }), // 无 backup → 分配 3
        imod('loc', 0, { name: 'Tavern' }),                  // 无 id 模块，跳过
        imod('loc', 1, { name: 'Forest' }),
    ],
];

function snapshotIdGroups(state) {
    const out = {};
    for (const [name, gs] of state.groups) {
        out[name] = { currentId: gs.currentId, map: Object.fromEntries([...gs.identifierIdMap]) };
    }
    return out;
}

for (const [si, mods] of idScenarios.entries()) {
    // 全段（深拷贝模块，避免就地改影响全段参考）
    const fullMods = mods.map(m => ({ ...m, variables: { ...m.variables } }));
    const full = idCompletionToState(fullMods, idModuleConfigs);
    const fullIds = fullMods.map(m => m.variables.id);
    const fullGroups = snapshotIdGroups(full);

    for (let X = 0; X <= mods.length; X++) {
        // 分段：0..X-1 用副本，X..end 用另一批副本（模拟「从快照继续」不污染原输入）
        const prefixMods = mods.slice(0, X).map(m => ({ ...m, variables: { ...m.variables } }));
        const suffixMods = mods.slice(X).map(m => ({ ...m, variables: { ...m.variables } }));
        const prefixState = idCompletionToState(prefixMods, idModuleConfigs);
        let st = prefixState;
        for (const m of suffixMods) st = idCompletionStep(st, m, idModuleConfigs);
        const ids = [...prefixMods, ...suffixMods].map(m => m.variables.id);
        assert(
            deepEqual(ids, fullIds) && deepEqual(snapshotIdGroups(st), fullGroups),
            `idCompletionStep 场景${si + 1}: 从 X=${X} 分段 == 全段（id 分配 + 计数器）`,
        );
    }
}

console.log(failures ? `\n存在 ${failures} 个失败` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
