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
import { dedupStep } from './pipeline/deduplicateStep.js';
import { attachTimeToState, completeTimeToState } from './pipeline/timeCompletionStep.js';
import { idCompletionStep, createIdCompletionState } from './pipeline/idCompletionStep.js';
import { compressLevelToState } from './pipeline/levelCompressionStep.js';
import { sortModules } from './pipeline/sort.js';
import { processIncrementalModules, processFullModules } from './pipeline/output.js';
import { getActiveSources } from './pipeline/moduleDataSources.js';
import { debugLog } from '../utils/logger.js';

/** time 解析器（真实实现注入） */
import { parseTimeDetailed, completeTimeDataWithStandard } from '../utils/timeParser.js';
const timeParsers = { parseTimeDetailed, completeTimeDataWithStandard };

// ⚠️ 每层耗时分段在 rebuildFrom 每次调用内独立计时（perf 对象），避免跨调用叠加污染。

// 增量 build 缓存：chatKey → moduleName → structuredResult 的 entry。
// 末层失效时，未新增模块的组直接复用缓存，只重算 touched 组（大幅降低 build 成本）。
// 冷启动/失效靠前时 touchedNames 覆盖全组 → 全量重算并刷新缓存，无需主动失效。
const _buildCache = new Map();

/** 清空 build 增量缓存（切聊天 / 插件禁用）。 */
export function clearBuildCache() {
    _buildCache.clear();
}

/**
 * 处理一层：标准化该层 raw → dedup 续传 → 更新 groupModules（累积去重全集，不 sort/id/compress）。
 * ⚠️ 就地修改 state（groupModules / dedup / time 累积）。
 * @param {Object} state 累积态（FloorSnapshot）
 * @param {number} floor 当前层
 * @param {string} chatKey occurrence 缓存 key
 * @param {Object} perf 本次调用的耗时计数器（就地累加）
 */
function processFloor(state, floor, chatKey, perf) {
    // ⚠️ 与主管线一致用 getModules()（effective 配置）而非 getModules(true)（全量含禁用）：
    // 否则 dedup 的 moduleKey 会因 variables 键集不一致而膨胀（sum 184 vs 107），
    // 且会多输出被 effective 过滤的禁用模块（14 vs 9 keys）。
    const modulesData = configManager.getModules() || [];
    const layerRaws = [];
    // 该层所有源 raw（occurrence 缓存；负数起始态已并入第 0 层缓存）
    const tR0 = performance.now();
    for (const { name } of getActiveSources()) {
        const raws = getOccurrence(chatKey, name, floor);
        if (Array.isArray(raws)) layerRaws.push(...raws);
    }
    perf.read += performance.now() - tR0;
    if (layerRaws.length === 0) return; // 该层无模块

    // 1. 标准化 + dedup 续传（逐模块）。
    //    ⚠️ 只收集 dedup「真正新增」的模块（dedupResult.added）：
    //    重复模块不加入组全集，时间/merge 也只对这些新增模块处理（与全量管线 deduplicateModules 合并语义一致）。
    const tD0 = performance.now();
    const added = [];
    for (const raw of layerRaws) {
        const norm = normalizeRawModule(raw, modulesData);
        if (!norm) continue;
        const dedupResult = dedupStep(state.dedup, norm);
        state.dedup = dedupResult;
        if (dedupResult.added.length) added.push(...dedupResult.added);
    }
    if (added.length === 0) return;
    perf.dedup += performance.now() - tD0;

    const tT0 = performance.now();
    // 2. attach（段级，携带 state.time 基准；只对新增模块）
    state.time = attachTimeToState(added, modulesData, timeParsers, state.time);

    // 3. complete（per messageIndex 组，对新增模块）
    completeTimeToState(added, modulesData, timeParsers);
    perf.time += performance.now() - tT0;

    // 4. 组全集增量 append（只 append 新增模块，不 sort/id/compress）。
    //    ⚠️ 性能关键：把 sort/补id/level-compress 延后到 buildStructuredResult 每组合一次。
    //    旧版每层对 touched 组【全量重跑】sort/id/compress（O(层×组全集)，冷启动 6.5s 的元凶），
    //    且 compress 就地改 visibility/timeline，逐层重跑会叠加污染 —— 延后到最终一次性跑（在副本上）更快也更正确。
    const tG0 = performance.now();
    for (const m of added) {
        if (!state.groupModules.has(m.moduleName)) state.groupModules.set(m.moduleName, []);
        state.groupModules.get(m.moduleName).push(m);
    }
    perf.group += performance.now() - tG0;
    // 记录本批新增模块名（touched 组），供 build 增量判断哪些组合并需重算
    for (const m of added) {
        if (!perf.touched) perf.touched = new Set();
        perf.touched.add(m.moduleName);
    }
    perf.layers++;
}

/**
 * 由累积的 groupModules 生成 structuredResult（processAutoModules 等价物的组级版本）。
 * 结构对齐 processAutoModules：{ [moduleName]: { processType, data, moduleConfig, isIncremental, moduleCount, maxId } }
 *
 * ⚠️ 延后变换（compress 延后）：processFloor 只累积「去重+time后、未排序未压缩」的组全集，
 * 本函数取数时对每组合集执行 sort → 补id → level-compress → 输出（各一次）。
 * 与全量管线 normalizeModules 每组的顺序（sortModules → completeIdVariables → processLevelVariables）一致。
 * 各班在【副本】上跑：sort 不改对象，但 idCompletionStep 就地改 variables.id、compressLevelToState
 * 就地改 visibility/timeline —— 在副本上跑避免污染累积态 groupModules / 快照 / 重复 build 的叠加。
 *
 * ⚠️ 增量 build（末层失效优化）：传入 chatKey + touchedNames 时，本次【未新增任何模块】的组直接复用
 * 上次缓存结果（groupModules 内容未变 → 结果必相同），只重算 touched 组。否则全量 build。
 *
 * @param {Map<string, Array>} groupModules 累积的组内模块（去重+time，未 sort/id/compress）
 * @param {Array} modulesData 模块配置
 * @param {string[]} [selectedModuleNames] 选中的模块名白名单（空/未传=全部），对齐 processAutoModules 的 selected 过滤
 * @param {string} [chatKey] 增量缓存 key（有值且 touchedNames 有值时才走增量）
 * @param {Set<string>|null} [touchedNames] 本次新增的模块名集合；null=全量 build
 * @returns {Object}
 */
export function buildStructuredResult(groupModules, modulesData, selectedModuleNames, chatKey, touchedNames) {
    const structuredResult = {};
    // 增量判断：仅当请求了增量（chatKey+touchedNames）且未做 selected 过滤时才可复用（过滤会改变结果集）
    const incremental = chatKey && touchedNames && (!selectedModuleNames || selectedModuleNames.length === 0);
    const cacheMap = incremental ? (_buildCache.get(chatKey) ?? new Map()) : null;
    for (const [moduleName, group] of groupModules) {
        if (selectedModuleNames && selectedModuleNames.length && !selectedModuleNames.includes(moduleName)) continue;
        const moduleConfig = modulesData.find(c => c.name === moduleName);
        if (!moduleConfig) continue;
        const processType = moduleConfig.outputMode || 'full';

        // 增量复用：本组未 touched 且缓存命中 → 直接沿用上次结果
        if (incremental && !touchedNames.has(moduleName) && cacheMap?.has(moduleName)) {
            structuredResult[moduleName] = cacheMap.get(moduleName);
            continue;
        }

        // 副本：避免 id/compress 就地改污染累积态 groupModules（compress 会改 visibility/timeline，重复必叠加）。
        const working = group.map(m => ({ ...m, variables: { ...m.variables }, timeline: m.timeline ? [].concat(m.timeline) : undefined }));
        const sorted = sortModules(working);

        // 补 id（组内一次性；idCompletionStep 就地改 variables.id，但变量已浅拷贝，隔离原对象）
        if (moduleConfig.variables?.some(v => v.name === 'id')) {
            let idState = createIdCompletionState();
            for (const m of sorted) {
                idState = idCompletionStep(idState, m, modulesData);
            }
        }

        // level 压缩（在副本上跑一次，返回可见模块；visibility/timeline 改动不污染原累积态）
        const prepared = (moduleConfig.variables?.some(v => v.name === 'level'))
            ? compressLevelToState(sorted, modulesData, sortModules)
            : sorted;

        let resultData;
        if (processType === 'incremental') {
            resultData = processIncrementalModules(prepared, moduleConfig);
        } else {
            resultData = processFullModules(prepared);
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
        const entry = {
            processType,
            data: resultData,
            moduleCount,
            moduleConfig,
            isIncremental: processType === 'incremental',
            maxId,
        };
        // 更新/写入增量缓存（含 touched 组刷新）
        if (cacheMap) {
            cacheMap.set(moduleName, entry);
            _buildCache.set(chatKey, cacheMap);
        }
        structuredResult[moduleName] = entry;
    }
    return structuredResult;
}

/**
 * 从最近 checkpoint 增量重建到 end。
 * @param {number} targetFloor 失效起点（改动的层）；从最近的未失效 checkpoint（≤targetFloor）增量到 end
 * @param {boolean} [needResults=true] 是否每层产出中间 structuredResult（false 只求末层 snapshot）
 * @returns {{ snapshot: Object, results: Array<{floor:number, content:Object}>, perf: Object, touched: Set<string>, chatKey: string, totalMs: number }}
 *   snapshot：最终累积态；results：每层 structuredResult；perf：各阶段耗时；touched：本次新增模块名集合（增量 build 用）
 */
export function rebuildFrom(targetFloor, needResults = true) {
    const chatKey = getChatCacheKey();
    const C = findNearestCheckpoint(targetFloor);
    let state = C !== null && C >= 0 ? getSnapshot(C) : createEmptySnapshot();
    debugLog(`[rebuildFrom] target=${targetFloor} 起点 checkpoint=${C} 起始状态=${C >= 0 ? `快照${C}` : '空'}`);

    // ⚠️ 每次调用独立计时：per-call perf（旧实现里 _perf 是模块级累积，多档验证会叠加污染）。
    // 独立计时：extract（occurrence 读取）+ rebuild 的分段。perf 每次调用内自持。
    const perf = { layers: 0, read: 0, dedup: 0, time: 0, group: 0, snapshot: 0 };
    const tTotal0 = performance.now();

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
        processFloor(state, f, chatKey, perf);
        if (isCheckpointFloor(f)) {
            const tS0 = performance.now();
            putSnapshot(f, state);
            perf.snapshot += performance.now() - tS0;
        }
        // 每层产出 structuredResult（基于累积 groupModules）——仅调用方需要中间结果时才构建（如验证）；
        // 生产取数（useSnapshot）只要末层 snapshot，逐层 build 中间结果是 O(层×组) 的纯浪费。
        if (needResults) {
            results.push({ floor: f, content: buildStructuredResult(state.groupModules, modulesData) });
        }
    }
    const avg = (n) => (perf.layers ? (perf[n] / perf.layers).toFixed(3) : '0');
    debugLog(`[cc-perf] layers=${perf.layers} read=${perf.read.toFixed(1)}(+${avg('read')}/层) dedup=${perf.dedup.toFixed(1)}(+${avg('dedup')}) time=${perf.time.toFixed(1)}(+${avg('time')}) group=${perf.group.toFixed(1)}(+${avg('group')}) snapshot=${perf.snapshot.toFixed(1)}(+${avg('snapshot')})`);
    return { snapshot: state, results, perf, touched: perf.touched ?? new Set(), chatKey, totalMs: performance.now() - tTotal0 };
}

/** chat 长度（getContext().chat，iframe/父窗口通用） */
function chatLength() {
    const c = getContext()?.chat;
    return Array.isArray(c) ? c.length : 0;
}
