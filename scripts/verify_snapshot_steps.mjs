// 快照阶段 0 回归测试：mergeStep + dedupStep 可组合性等价性。
// 运行：node scripts/verify_snapshot_steps.mjs
// 验证「从 X 分段 == 全段」对每个 X 切点成立。用完即删（或保留为回归资产）。

import { createMergeStepState, mergeStep, mergeModulesToState } from '../src/core/pipeline/mergeStep.js';
import { createDedupState, dedupStep, dedupToState, uniqueModulesFromState } from '../src/core/pipeline/deduplicateStep.js';

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
        const state = createDedupState(moduleConfigs);
        // 注意：dedupStep 就地改 moduleMap 中的对象，分段续传必须复用同一 state 引用
        let st = state;
        for (let i = 0; i < mods.length; i++) {
            st = dedupStep(st, mods[i]);
            if (i === X - 1) {
                // 记录 X 切点状态快照的模块数组（引用层面，后续继续改同一批对象）
                // 这里只验证「从 X 继续」的最终结果与全量一致
            }
        }
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

console.log(failures ? `\n存在 ${failures} 个失败` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
