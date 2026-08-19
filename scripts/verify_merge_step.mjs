// 临时验证脚本：mergeStep 可组合性等价性（阶段 0）。
// 运行：node scripts/verify_merge_step.mjs
// 验证：
//   1. 全段 merge == 分段 merge（0..X-1 再逐层继续到 end）——「从 X-1 状态继续」正确
//   2. 含 time/isAddTime 的增量模块逐层结果一致
//   3. timeline / cumulativeVariables / hasTimeVar / lastTimeData 完全一致
// 用完即删。

import { createMergeStepState, mergeStep, mergeModulesToState } from '../src/core/pipeline/mergeStep.js';

function assert(cond, msg) {
    if (!cond) {
        console.error('❌ FAIL:', msg);
        process.exitCode = 1;
    } else {
        console.log('✅ PASS:', msg);
    }
}

function deepEqual(a, b, path = '') {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (typeof a === 'object') {
        const ka = Object.keys(a);
        const kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        for (const k of ka) {
            if (!deepEqual(a[k], b[k], `${path}.${k}`)) {
                console.error(`   diff @ ${path}.${k}:`, a[k], 'vs', b[k]);
                return false;
            }
        }
        return true;
    }
    return false;
}

// 构造增量模块数据（含 time 变量 + isAddTime 场景）
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

const timeDataValid = (v) => ({ isValid: true, isComplete: true, startTime: { timestamp: v } });

// 场景 1：普通增量（无 time 变量）
const modules1 = [
    makeModule({ mi: 0, vars: { id: '1', name: 'A', time: '08:00' }, timeData: timeDataValid(100) }),
    makeModule({ mi: 3, vars: { id: '1', name: 'B', time: '09:00' }, timeData: timeDataValid(200) }),
    makeModule({ mi: 7, vars: { id: '1', name: 'B', time: '09:30' }, isAddTime: true, timeData: timeDataValid(210) }),
    makeModule({ mi: 10, vars: { id: '1', name: 'C', time: '10:00' }, timeData: timeDataValid(300) }),
];

// 场景 2：time 变量 + isAddTime（从快照继续的关键）
const modules2 = [
    makeModule({ mi: 0, vars: { id: '5', name: 'X', time: '08:00' }, timeData: timeDataValid(100) }),
    makeModule({ mi: 2, vars: { id: '5', name: 'Y', time: '08:30' }, isAddTime: true, timeData: timeDataValid(130) }),
    makeModule({ mi: 5, vars: { id: '5', name: 'Z', time: '09:00' }, timeData: timeDataValid(200) }),
];

for (const [name, mods] of [['场景1', modules1], ['场景2', modules2]]) {
    // 全段
    const full = mergeModulesToState(mods, true);

    // 分段：先 0..X-1，再从 X 逐层继续
    for (let X = 0; X <= mods.length; X++) {
        const prefix = mergeModulesToState(mods.slice(0, X), true);
        let suffixState = { ...prefix, timeline: prefix.timeline.slice() };
        for (let i = X; i < mods.length; i++) {
            suffixState = mergeStep(suffixState, mods[i], true);
        }
        assert(deepEqual(suffixState, full), `${name}: 从 X=${X} 分段合并 == 全段合并`);
    }
}

// 场景 3：非增量（full 模式）
const modules3 = [
    { moduleName: 'loc', messageIndex: 0, messageIndexHistory: [0], raw: '[loc|name:Tavern]', variables: { name: 'Tavern' } },
    { moduleName: 'loc', messageIndex: 5, messageIndexHistory: [5], raw: '[loc|name:Forest]', variables: { name: 'Forest' } },
];
const full3 = mergeModulesToState(modules3, false);
const prefix3 = mergeModulesToState(modules3.slice(0, 1), false);
const suffix3 = mergeStep(prefix3, modules3[1], false);
assert(deepEqual(suffix3, full3), '场景3(非增量): 分段 == 全段');

// 场景 4：跨切点的时间基准恢复（isAddTime 依赖 lastTimeData/lastTimeString）
const modules4 = [
    makeModule({ mi: 0, vars: { id: '9', name: 'P', time: '08:00' }, timeData: timeDataValid(100) }),
    makeModule({ mi: 1, vars: { id: '9', name: 'Q', time: '08:15' }, isAddTime: true, timeData: timeDataValid(115) }),
    makeModule({ mi: 2, vars: { id: '9', name: 'R', time: '08:30' }, timeData: timeDataValid(130) }),
    makeModule({ mi: 3, vars: { id: '9', name: 'S', time: '08:45' }, isAddTime: true, timeData: timeDataValid(145) }),
];
const full4 = mergeModulesToState(modules4, true);
for (let X = 0; X <= modules4.length; X++) {
    const prefix4 = mergeModulesToState(modules4.slice(0, X), true);
    let st = { ...prefix4, timeline: prefix4.timeline.slice() };
    for (let i = X; i < modules4.length; i++) {
        st = mergeStep(st, modules4[i], true);
    }
    assert(deepEqual(st, full4), `场景4(时间基准): 从 X=${X} 分段 == 全段`);
}

console.log(process.exitCode ? '\n存在失败项' : '\n全部通过');
