// 快照阶段 0 回归测试：mergeStep + dedupStep + idCompletionStep + time 层可组合性等价性。
// 运行：node scripts/verify_snapshot_steps.mjs
// 验证「从 X 分段 == 全段」对每个 X 切点成立。用完即删（或保留为回归资产）。

import { createMergeStepState, mergeStep, mergeModulesToState } from '../src/core/pipeline/mergeStep.js';
import { createDedupState, dedupStep, dedupToState, uniqueModulesFromState } from '../src/core/pipeline/deduplicateStep.js';
import { createIdCompletionState, idCompletionStep, idCompletionToState } from '../src/core/pipeline/idCompletionStep.js';
import { createTimeState, attachTimeToState, completeTimeForMessage, completeTimeToState } from '../src/core/pipeline/timeCompletionStep.js';
import { compressLevelToState } from '../src/core/pipeline/levelCompressionStep.js';

// level 压缩测试的 mock sortFn（按 messageIndex 升序——足够复刻「可见模块排序」语义）
const mockSortFn = (modules) => [...modules].sort((a, b) => a.messageIndex - b.messageIndex);

// timeCompletionStep 的 mock 解析器（复刻真实 timeParser 关键语义，避免浏览器依赖链）：
// - 完整格式 'YYYY-MM-DD 周X HH:MM' → isComplete:true, formattedString=原文
// - 纯时间 'HH:MM' → isComplete:false, formattedString=null（可被补全）
// - completeTimeDataWithStandard：把纯时间补成标准时间的完整格式
function mockParseTimeDetailed(timeStr, standardTimeData) {
    if (!timeStr || typeof timeStr !== 'string') {
        return { isValid: false, isComplete: false, originalText: timeStr, startTime: null, formattedString: null };
    }
    // 完整日期时间范围：2024-11-12 周二 01:54~02:14
    const fullRange = timeStr.match(/^(\d{4}-\d{2}-\d{2}) .+? (\d{1,2}:\d{2})~(\d{1,2}:\d{2})$/);
    if (fullRange) {
        return {
            isValid: true,
            isComplete: true,
            isRange: true,
            originalText: timeStr,
            startTime: { timestamp: Date.parse(fullRange[1] + 'T' + fullRange[2]) },
            endTime: { timestamp: Date.parse(fullRange[1] + 'T' + fullRange[3]) },
            formattedString: timeStr,
        };
    }
    // 完整日期时间：2024-05-08 周三 15:38
    const fullMatch = timeStr.match(/^(\d{4}-\d{2}-\d{2}) .+? (\d{1,2}:\d{2})$/);
    if (fullMatch) {
        return {
            isValid: true,
            isComplete: true,
            originalText: timeStr,
            startTime: { timestamp: Date.parse(fullMatch[1] + 'T' + fullMatch[2]) },
            formattedString: timeStr,
        };
    }
    // 纯时间范围：01:54~02:14
    const timeRange = timeStr.match(/^(\d{1,2}:\d{2})~(\d{1,2}:\d{2})$/);
    if (timeRange) {
        return {
            isValid: true,
            isComplete: false,
            isRange: true,
            originalText: timeStr,
            startTime: { timestamp: null },
            endTime: { timestamp: null },
            formattedString: null,
        };
    }
    // 纯时间：15:38
    const timeOnly = timeStr.match(/^\d{1,2}:\d{2}$/);
    if (timeOnly) {
        return {
            isValid: true,
            isComplete: false,
            originalText: timeStr,
            startTime: { timestamp: null },
            formattedString: null,
        };
    }
    return { isValid: false, isComplete: false, originalText: timeStr, startTime: null, formattedString: null };
}

function mockCompleteTimeDataWithStandard(target, standard) {
    if (!target || !target.isValid || target.isComplete || !standard || !standard.isValid || !standard.isComplete) {
        return target;
    }
    // 把纯时间/纯时间范围补全为标准时间的完整格式：借用标准日期 + 自身时间（范围保留）
    const targetTime = target.originalText; // 'HH:MM' 或 'HH:MM~HH:MM'
    const standardFull = standard.formattedString; // 'YYYY-MM-DD 周X HH:MM'
    const datePart = standardFull.replace(/ \d{1,2}:\d{2}$/, '');
    const completed = { ...target, isComplete: true, formattedString: `${datePart} ${targetTime}` };
    return completed;
}

const timeParsers = { parseTimeDetailed: mockParseTimeDetailed, completeTimeDataWithStandard: mockCompleteTimeDataWithStandard };

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

/* ================= time 层 ================= */
// timeReferenceStandard 模块配置（env 为标准时间模块）
const timeModuleConfigs = [
    {
        name: 'env', outputMode: 'full', outputPosition: 'body',
        timeReferenceStandard: true,
        variables: [{ name: 'time' }, { name: 'loc' }],
    },
    {
        name: 'item', outputMode: 'incremental', outputPosition: 'embedded',
        variables: [{ name: 'id', isIdentifier: true }, { name: 'name' }, { name: 'time' }],
    },
];

function tmod(name, mi, vars) {
    return { moduleName: name, messageIndex: mi, variables: { ...vars } };
}

// 场景：env 提供完整标准时间；item 用纯时间（可被补全）+ 无时间模块
const timeScenarios = [
    [
        tmod('env', 0, { time: '2024-05-08 周三 15:38', loc: '客厅' }),   // 完整标准时间
        tmod('item', 1, { id: '1', name: 'A', time: '15:40' }),           // 纯时间 → 用 env 补全
        tmod('item', 2, { id: '2', name: 'B', time: '16:00' }),           // 纯时间 → 用 env 补全
        tmod('item', 3, { id: '3', name: 'C' }),                          // 无 time 变量 → 不受影响
    ],
    [
        // 场景2：标准时间模块不在最前（验证「第一个基准」从 X 继续的语义）
        tmod('item', 0, { id: '1', name: 'A', time: '15:40' }),           // 此时无基准 → 解析失败（isValid 或补全不同）
        tmod('env', 1, { time: '2024-05-08 周三 16:00', loc: '客厅' }),   // 第一个标准时间基准
        tmod('item', 2, { id: '2', name: 'B', time: '16:10' }),           // 用 env 补全
        tmod('item', 3, { id: '3', name: 'C', time: '16:20' }),           // 用 env 补全
    ],
    [
        // 场景3（用户 bug 回归）：同一楼层两条 sum（env 配置名用于基准），
        // 第一条是完整日期范围，第二条也是完整日期范围。处理后第一条 time 必须保持原值
        //（不能被误判无效覆盖成第二条）。
        // ⚠️ item 放独立楼层（messageIndex=2），避免测试切点落在同 messageIndex 组内
        //（complete 按 messageIndex 分组，快照切点应落在楼层边界）。
        tmod('env', 0, { time: '2024-11-12 周二 01:54~02:14', loc: '公寓' }),
        tmod('env', 0, { time: '2024-11-12 周二 02:15~02:25', loc: '客厅' }),
        tmod('env', 1, { time: '2024-11-12 周二 02:30~02:40', loc: '门口' }),
        tmod('item', 2, { id: '9', name: 'Z', time: '02:35' }),
    ],
];

function cloneDeep(v) {
    return JSON.parse(JSON.stringify(v));
}

for (const [si, mods] of timeScenarios.entries()) {
    // 全段参考：完整跑 attach → complete
    const fullMods = cloneDeep(mods);
    attachTimeToState(fullMods, timeModuleConfigs, timeParsers);
    completeTimeToState(fullMods, timeModuleConfigs, timeParsers);
    const fullSig = fullMods.map(m => ({
        timeData: m.timeData ? { isValid: m.timeData.isValid, isComplete: m.timeData.isComplete, originalText: m.timeData.originalText, formattedString: m.timeData.formattedString } : null,
        time: m.variables.time ?? '',
        isAddTime: m.isAddTime,
    }));

    for (let X = 0; X <= mods.length; X++) {
        // 分段：0..X-1 副本跑 attach+complete；X..end 从快照继续
        const prefixMods = cloneDeep(mods.slice(0, X));
        const suffixMods = cloneDeep(mods.slice(X));
        const prefixState = attachTimeToState(prefixMods, timeModuleConfigs, timeParsers);
        completeTimeToState(prefixMods, timeModuleConfigs, timeParsers);
        // 从 X 继续：段级 attach（携带快照基准 { standardTimeData, standardFound }）
        attachTimeToState(suffixMods, timeModuleConfigs, timeParsers, prefixState);
        // 从 X 继续 complete（逐 messageIndex 组）
        completeTimeToState(suffixMods, timeModuleConfigs, timeParsers);

        const allMods = [...prefixMods, ...suffixMods];
        const sig = allMods.map(m => ({
            timeData: m.timeData ? { isValid: m.timeData.isValid, isComplete: m.timeData.isComplete, originalText: m.timeData.originalText, formattedString: m.timeData.formattedString } : null,
            time: m.variables.time ?? '',
            isAddTime: m.isAddTime,
        }));
        assert(deepEqual(sig, fullSig), `time 层场景${si + 1}: 从 X=${X} 分段 == 全段（attach+complete）`);
    }
}

/* ================= level 压缩 ================= */
// sum 模块：id 主键 + level + time；level>0 的压缩模块按 id 范围折叠更低 level 的模块
const levelModuleConfigs = [
    {
        name: 'sum', outputMode: 'full', outputPosition: 'after_body',
        variables: [
            { name: 'id', isIdentifier: true },
            { name: 'level' },
            { name: 'event' },
            { name: 'time' },
        ],
    },
];

function lmod(mi, id, level, event) {
    return {
        moduleName: 'sum',
        messageIndex: mi,
        variables: { id, level, event, time: '2024-11-12 周二 10:00' },
        messageIndexHistory: [mi],
    };
}

// 场景1：level=0 明细 + level=1 压缩（id 范围折叠）
const levelScenarios = [
    [
        lmod(0, '1', 0, '事件1'),
        lmod(1, '2', 0, '事件2'),
        lmod(2, '3', 0, '事件3'),
        lmod(3, '1-3', 1, '压缩1-3'),   // level=1，折叠 id 1-3
        lmod(4, '4', 0, '事件4'),        // 压缩范围外，保留
        lmod(5, '4-5', 1, '压缩4-5'),   // level=1，折叠 id 4-5（含刚新增的 4）
    ],
];

// 快照语义：存「压缩前」干净副本集合，从 X 继续 = 快照[X-1] ∪ X..end → 组内全量重跑
for (const [si, mods] of levelScenarios.entries()) {
    // 全量参考
    const fullMods = cloneDeep(mods);
    const fullVisible = compressLevelToState(fullMods, levelModuleConfigs, mockSortFn);
    // 签名：可见模块（id+level）+ 压缩模块 timeline 内容
    const sigOf = (visible) => visible.map(m => ({
        id: m.variables.id,
        level: m.variables.level,
        timeline: (m.timeline || []).map(t => t.variables?.id ?? t.variables?.event ?? ''),
    }));

    for (let X = 0; X <= mods.length; X++) {
        // 分段：0..X-1 干净副本跑压缩；X..end 合并后组内全量重跑
        const prefixMods = cloneDeep(mods.slice(0, X));
        const suffixMods = cloneDeep(mods.slice(X));
        // 快照[X-1] = 压缩前集合（干净副本），续传时直接取 prefix 全部模块
        const merged = [...prefixMods, ...suffixMods];
        const visible = compressLevelToState(merged, levelModuleConfigs, mockSortFn);
        assert(deepEqual(sigOf(visible), sigOf(fullVisible)), `level 压缩场景${si + 1}: 从 X=${X} 合并重跑 == 全量（可见+timeline）`);
    }
}

console.log(failures ? `\n存在 ${failures} 个失败` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
