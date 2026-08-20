// rebuildProcessor.js
// 快照重建处理器（F 二期快照阶段 2）。
//
// 职责：从最近 checkpoint 增量重建 process 累积态到指定范围。
// 与 occurrenceCache（每层 raw）协作：occurrence 提供 X..end 的每层 raw，
// 本模块用快照累积态续算 process（dedup/attach/complete/id/level/merge）。
//
// 算法（用户确认，checkpoint K=10）：
//   rebuildFrom(targetFloor):
//     C = findNearestCheckpoint(targetFloor) ?? -1   // 最近未失效 checkpoint
//     state = C>=0 ? getSnapshot(C) : createEmptySnapshot()
//     for f in [C+1 .. end]:
//       该层所有源 raw（occurrence）→ 标准化 → dedup 续传
//       → 更新 groupModules（并入该层模块）
//       → 组内 sort/id/level（全量，保证正确）
//       → merge 续算（incremental 组）
//       → isCheckpointFloor(f) ? putSnapshot(f, state)
//     return state
//
// ⚠️ v1 正确性优先：组内 sort/id/level 对 groupModules 全量重跑（未细分变化组），
//    省的是 checkpoint 前的 extract/dedup/标准化；后续再优化变化组判断。

// ⚠️ 不能 import script.js（rebuildProcessor 被 iframe 内 Toolbox import，会 404）。
// 用 getContext().chat 拿实时聊天数组（extensions.js 可 import，同 CharacterBinding）。
import { getContext } from '../../../../../extensions.js';
import configManager from '../singleton/configManager.js';
import { getChatCacheKey, getOccurrence } from './occurrenceCache.js';
import { getSnapshot, putSnapshot, findNearestCheckpoint, createEmptySnapshot, isCheckpointFloor } from './snapshotStore.js';
import { normalizeRawModule } from './pipeline/normalizeRawStep.js';
import { dedupStep, uniqueModulesFromState } from './pipeline/deduplicateStep.js';
import { attachTimeToState, completeTimeToState } from './pipeline/timeCompletionStep.js';
import { idCompletionStep } from './pipeline/idCompletionStep.js';
import { compressLevelToState } from './pipeline/levelCompressionStep.js';
import { mergeStep, createMergeStepState } from './pipeline/mergeStep.js';
import { sortModules } from './pipeline/sort.js';
import { groupModulesByIdentifier, processIncrementalModules, processFullModules } from './pipeline/output.js';
import { getActiveSources } from './pipeline/moduleDataSources.js';
import { debugLog } from '../utils/logger.js';

/** time 解析器（真实实现注入） */
import { parseTimeDetailed, completeTimeDataWithStandard } from '../utils/timeParser.js';
const timeParsers = { parseTimeDetailed, completeTimeDataWithStandard };

/**
 * 处理一层：标准化该层 raw → dedup 续传 → 更新 groupModules → 组内 sort/id/level → merge 续算。
 * ⚠️ 就地修改 state（groupModules / merged / dedup / idCompletion / time 累积）。
 * @param {Object} state 累积态（FloorSnapshot）
 * @param {number} floor 当前层
 * @param {string} chatKey occurrence 缓存 key
 */
function processFloor(state, floor, chatKey) {
    // ⚠️ 与主管线一致用 getModules()（effective 配置）而非 getModules(true)（全量含禁用）：
    // 否则 dedup 的 moduleKey 会因 variables 键集不一致而膨胀（sum 184 vs 107），
    // 且会多输出被 effective 过滤的禁用模块（14 vs 9 keys）。
    const modulesData = configManager.getModules() || [];
    const layerRaws = [];
    // 该层所有源 raw（occurrence 缓存；负数起始态已并入第 0 层缓存）
    for (const { name } of getActiveSources()) {
        const raws = getOccurrence(chatKey, name, floor);
        if (Array.isArray(raws)) layerRaws.push(...raws);
    }
    if (layerRaws.length === 0) return; // 该层无模块

    // 1. 标准化 + dedup 续传（逐模块）
    const newModules = [];
    for (const raw of layerRaws) {
        const norm = normalizeRawModule(raw, modulesData);
        if (!norm) continue;
        state.dedup = dedupStep(state.dedup, norm);
        newModules.push(norm);
    }
    if (newModules.length === 0) return;

    // 2. attach（段级，携带 state.time 基准；只对新模块）
    state.time = attachTimeToState(newModules, modulesData, timeParsers, state.time);

    // 3. complete（per messageIndex 组，对新模块）
    completeTimeToState(newModules, modulesData, timeParsers);

    // 4. 重建 groupModules（基于【去重后】的全部模块，避免重复累加）
    //    ⚠️ 不能用 newModules（该层原始标准化模块）增量 push——dedup 会把同值楼层合并，
    //    增量 push 会把 dedup 应合并的重复也加进去（实测 sum 185 vs 全量 107 的根因）。
    state.groupModules = new Map();
    for (const m of uniqueModulesFromState(state.dedup)) {
        if (!state.groupModules.has(m.moduleName)) state.groupModules.set(m.moduleName, []);
        state.groupModules.get(m.moduleName).push(m);
    }

    // 5. 组内：sort → id → level（对【所有组】全量，正确性优先）
    //    ⚠️ 必须所有组：第 4 步重建的 groupModules 是「去重后未压缩」，
    //    若只压缩 touched 组，非本轮触及的组（如 sum）会残留未压缩状态
    //    → 后续 buildStructuredResult 的 processFullModules 结果偏大（184 vs 107 的根因）。
    for (const name of state.groupModules.keys()) {
        const group = state.groupModules.get(name);
        if (!group || group.length === 0) continue;
        const sorted = sortModules(group);
        const moduleConfig = modulesData.find(c => c.name === name);
        if (moduleConfig && moduleConfig.variables?.some(v => v.name === 'id')) {
            // 逐模块 id 续传（组计数器 state.idCompletion）
            for (const m of sorted) {
                state.idCompletion = idCompletionStep(state.idCompletion, m, modulesData);
            }
        }
        if (moduleConfig && moduleConfig.variables?.some(v => v.name === 'level')) {
            state.groupModules.set(name, compressLevelToState(sorted, modulesData, sortModules));
        } else {
            state.groupModules.set(name, sorted);
        }
    }

    // 6. merge（incremental 组）：新模块按 groupModulesByIdentifier 分组，mergeStep 续算 state.merged
    const groups = groupModulesByIdentifier(newModules, true);
    for (const [groupKey, list] of Object.entries(groups)) {
        const isIncremental = list.some(m => {
            const cfg = modulesData.find(c => c.name === m.moduleName);
            return cfg?.outputMode === 'incremental';
        });
        if (!isIncremental) continue;
        if (!state.merged.has(groupKey)) state.merged.set(groupKey, createMergeStepState());
        let st = state.merged.get(groupKey);
        for (const m of list) {
            st = mergeStep(st, m, true);
        }
        state.merged.set(groupKey, st);
    }
}

/**
 * 由累积的 groupModules 生成 structuredResult（processAutoModules 等价物的组级版本）。
 * 结构对齐 processAutoModules：{ [moduleName]: { processType, data, moduleConfig, isIncremental, moduleCount, maxId } }
 * @param {Map<string, Array>} groupModules 累积的组内模块（已 sort/id/level 处理）
 * @param {Array} modulesData 模块配置
 * @returns {Object}
 */
function buildStructuredResult(groupModules, modulesData) {
    const structuredResult = {};
    for (const [moduleName, group] of groupModules) {
        const moduleConfig = modulesData.find(c => c.name === moduleName);
        if (!moduleConfig) continue;
        const processType = moduleConfig.outputMode || 'full';
        let resultData;
        if (processType === 'incremental') {
            resultData = processIncrementalModules(group, moduleConfig);
        } else {
            resultData = processFullModules(group);
        }
        let moduleCount = 0;
        if (Array.isArray(resultData)) {
            moduleCount = resultData.filter(item => !item.shouldHide).length;
        } else {
            moduleCount = Object.keys(resultData || {}).length;
        }
        let maxId = null;
        if (processType === 'incremental' && Array.isArray(resultData) && resultData.length > 0) {
            const maxIds = resultData.map(item => item.maxId).filter(id => id !== null && id !== undefined);
            if (maxIds.length > 0) maxId = Math.max(...maxIds);
        }
        structuredResult[moduleName] = {
            processType,
            data: resultData,
            moduleCount,
            moduleConfig,
            isIncremental: processType === 'incremental',
            maxId,
        };
    }
    return structuredResult;
}

/**
 * 从最近 checkpoint 增量重建到 end。
 * @param {number} targetFloor 失效起点（改动的层）；从最近的未失效 checkpoint（≤targetFloor）增量到 end
 * @returns {{ snapshot: Object, results: Array<{floor:number, content:Object}> }}
 *   snapshot：最终累积态；results：每层 structuredResult（供 buildModulesString / groupByMessage）
 */
export function rebuildFrom(targetFloor) {
    const chatKey = getChatCacheKey();
    const C = findNearestCheckpoint(targetFloor);
    let state = C !== null && C >= 0 ? getSnapshot(C) : createEmptySnapshot();
    debugLog(`[rebuildFrom] target=${targetFloor} 起点 checkpoint=${C} 起始状态=${C >= 0 ? `快照${C}` : '空'}`);

    const end = chatLength() - 1;
    const results = [];
    const modulesData = configManager.getModules() || [];
    // ⚠️ 修复（env 差2根因）：createEmptySnapshot 的 dedup 是 createDedupState([])（moduleConfigs 空）。
    // 若用空 moduleConfigs，dedupStep 里的 `outputPosition !== 'after_body'` 判断失效（moduleConfig=undefined→false），
    // moduleKey 就不含 raw 文本 → body_dynamic 等模块的连字符变体（周宙的-公寓 vs 周宙的公寓）被误判同 key → 误合并。
    // 主管线 deduplicateModules 用 getModules() 作 moduleConfigs，key 含 raw、变体各自保留 → 数量对不上（245 vs 243）。
    // 这里统一把 dedup 状态的 moduleConfigs 设为真实模块配置，保证 notAfterBody 判定与主管线一致。
    state.dedup.moduleConfigs = modulesData;
    // ⚠️ 修复：chatMeta 负数起始态（level>0 的 sum）全在层 0。
    // 从 checkpoint(≥0) 续算时若 f 从 C+1 开始会跳过层 0 → 负数起始态丢失 → 无法 level 压缩。
    // rebuildFrom(0)（全量验证）强制从层 0 开始；targetFloor>0 才用 checkpoint 优化。
    const startFloor = (targetFloor <= 0) ? 0 : (C >= 0 ? C + 1 : 0);
    for (let f = startFloor; f <= end; f++) {
        processFloor(state, f, chatKey);
        if (isCheckpointFloor(f)) {
            putSnapshot(f, state);
        }
        // 每层产出 structuredResult（基于累积 groupModules）
        results.push({ floor: f, content: buildStructuredResult(state.groupModules, modulesData) });
    }
    return { snapshot: state, results };
}

/** chat 长度（getContext().chat，iframe/父窗口通用） */
function chatLength() {
    const c = getContext()?.chat;
    return Array.isArray(c) ? c.length : 0;
}
