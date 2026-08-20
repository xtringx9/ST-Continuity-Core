// runModulePipeline.js
// 管线编排入口（Tier 1）。
//
// 取代旧 processModuleData 的 7 位置参数，用单一 options 对象编排：
//   extract(source) → normalize → process → [style] → buildString → [groupByMessage]
// 数据源走 moduleDataSources（源头路由），缓存走 cacheLayer（显式 read/write/both/none）。
//
// 行为保持：与旧 processModuleData 逐分支对齐（含 timeRef 自动并入、缓存读写条件）。
// 旧 processModuleData 薄封装已删除：全部调用方已直调本函数（见 docs/PIPELINE_REFACTOR_HANDOFF.md）。

import configManager from '../../singleton/configManager.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import { chat } from '../../../../../../../script.js';
import {
    processExtractModules,
    processProcessedModules,
    processAutoModules,
    buildModulesString,
} from './output.js';
import { insertCombinedStylesToDetails } from '../../modules/styleCombiner.js';
import { groupProcessResultByMessageIndex } from './groupByMessage.js';
import { getActiveSources } from './moduleDataSources.js';
import { readCache, writeCache } from './cacheLayer.js';
import { rebuildFrom, buildStructuredResult } from '../rebuildProcessor.js';
import { getSnapshotDirtyFloor, resetSnapshotDirty } from '../snapshotStore.js';
import {
    getChatCacheKey,
    getOccurrence,
    setOccurrence,
} from '../occurrenceCache.js';

/**
 * occurrence 缓存启用开关（阶段 1：先关，验证后再开）。
 * 开启后 extract 走「每层全量缓存 + 下游按 filters 过滤」。
 */
const USE_OCCURRENCE_CACHE = true;

/**
 * 3.2 快照管线开关（代码级，源头控制）：
 *   true  → 生产取数（auto 分支）默认走「快照续算」（rebuildFrom → buildStructuredResult）；
 *          未失效时依赖快照 checkpoint 增量、失效后只续算 dirty..end。
 *   false → 与以前一样走全量 processAutoModules（现状安全默认）。
 * 显式传 opts.useSnapshot 时优先于本开关（如 verify 对比）。
 */
const USE_SNAPSHOT_PIPELINE = false;

/**
 * 按 filters 过滤全量 raw 模块（从 raw 解析模块名，匹配 name + compatibleModuleNames）。
 * 与各数据源内部 matchesFilter 语义一致。
 * @param {Array} rawModules 全量 raw 数组
 * @param {Array|null} filters 模块过滤条件；null=不过滤
 * @returns {Array}
 */
function filterRawByModuleNames(rawModules, filters) {
    // ⚠️ 返回副本而非原数组：调用方会 `rawModules.length = 0` 原地清空，
    // 若直接返回 rawModules 会把调用方的数组一起清空（同一引用）。
    if (filters === null || filters.length === 0) return rawModules.slice();
    const filterNames = new Set();
    for (const f of filters) {
        if (f?.name) filterNames.add(f.name);
        if (Array.isArray(f?.compatibleModuleNames)) {
            for (const cn of f.compatibleModuleNames) filterNames.add(cn);
        }
    }
    return rawModules.filter(m => {
        const raw = m?.raw;
        if (typeof raw !== 'string') return false;
        const pipeIdx = raw.indexOf('|');
        const name = pipeIdx > 0 ? raw.slice(1, pipeIdx).trim() : '';
        return filterNames.has(name);
    });
}

/**
 * 从 occurrence 缓存取某层全量 raw；miss 则单层全量提取并写缓存。
 * @param {string} chatKey
 * @param {string} sourceName 源名（'chatText' | 'asyncChat' | 'chatMeta'）
 * @param {Object} impl 数据源实现（getRawModules）
 * @param {number} floor 楼层
 * @returns {Array} 全量 raw
 */
function getLayerRawsCached(chatKey, sourceName, impl, floor) {
    const cached = getOccurrence(chatKey, sourceName, floor);
    if (cached) return cached;
    // 单层全量提取（filters=null → 不过滤）
    const part = impl.getRawModules({ start: floor, end: floor, filters: null });
    const raws = Array.isArray(part) ? part : [];
    setOccurrence(chatKey, sourceName, floor, raws);
    return raws;
}

/**
 * 默认缓存策略推导（对齐旧隐式语义）。
 * 旧：auto && !force → 读优先 miss 则提取并写；非 auto → 不读不写。
 * 新 API 显式 cache 时尊重显式值；'auto' 时按此推导。
 */
function deriveCacheMode(processType, force, cacheOption) {
    if (cacheOption !== 'auto') return cacheOption;
    if (processType !== 'auto') return 'none';
    return force ? 'write' : 'both'; // force 时跳过读，仍按条件写
}

/**
 * 运行模块管线。
 * @param {Object} opts
 * @param {{start?:number, end?:number|null}} [opts.range] 默认 {start:0, end:null}
 * @param {Array|null} [opts.modules] 模块过滤条件数组（[{name,compatibleModuleNames}]）| null=全部
 * @param {string} [opts.processType] 'auto' | 'extract' | 'processed'
 * @param {string[]|undefined} [opts.selectedModuleNames] 选中的模块名（undefined 时按 modules 推导）
 * @param {boolean} [opts.force] 强制刷新缓存（跳过读）
 * @param {('auto'|'read'|'write'|'both'|'none')} [opts.cache] 缓存策略；'auto' 按旧语义推导
 * @param {boolean} [opts.style] 是否跑 styleCombiner
 * @param {boolean} [opts.groupByMessage] 是否按 messageIndex 分组
 * @param {boolean} [opts.showModuleNames]
 * @param {boolean} [opts.showProcessInfo]
 * @param {boolean} [opts.showRule]
 * @param {boolean} [opts.skipEmpty] 构建 contentString 时跳过无数据模块（moduleCount===0）
 * @returns {Object} { success, content, contentString, displayTitle, moduleCount, hasContent, byMessage? }
 */
export function runModulePipeline(opts = {}) {
    try {
        const {
            range = {},
            modules: moduleFilters = null,
            processType = 'auto',
            selectedModuleNames = undefined,
            force = false,
            style = false,
            groupByMessage = false,
            showModuleNames = false,
            showProcessInfo = false,
            showRule = false,
            skipEmpty = false,
            // 3.1 等价接入：true 时 auto 分支走快照续算（rebuildFrom → buildStructuredResult），
            // 与 processAutoModules 全段重算等价；默认 false 走原路径。3.2 再由运行期快照接管省成本。
            useSnapshot = opts.useSnapshot !== undefined ? opts.useSnapshot : USE_SNAPSHOT_PIPELINE,
        } = opts;

        const start = range.start ?? 0;
        const end = range.end !== undefined ? range.end : null;
        const cache = deriveCacheMode(processType, force, opts.cache ?? 'auto');

        const isAllModule = moduleFilters === null;

        debugLog(`[runModulePipeline] processType=${processType} range=${start}-${end} isAll=${isAllModule} cache=${cache} force=${force}`);

        // ---- 缓存读 ----
        if (cache === 'read' || cache === 'both') {
            const hit = readCache({
                start, end, processType, isAllModule, force,
                selectedModuleNames, moduleFilters,
                showModuleNames, showProcessInfo, showRule,
                skipEmpty,
            });
            if (hit) {
                if (groupByMessage) hit.byMessage = groupProcessResultByMessageIndex({ content: hit.content });
                return hit;
            }
        }

        // ---- timeRef 自动并入（原 moduleProcessor.js:94-123）----
        // 带 timeReferenceStandard 的模块始终纳入提取，保证时间基准模块不丢。
        let effectiveFilters = moduleFilters;
        if (moduleFilters !== null) {
            const modulesData = configManager.getModules() || [];
            if (modulesData && Array.isArray(modulesData)) {
                const modulesToInclude = new Set();
                if (Array.isArray(moduleFilters)) {
                    moduleFilters.forEach(filter => modulesToInclude.add(filter.name));
                } else {
                    effectiveFilters = [];
                }
                modulesData.forEach(module => {
                    if (module.timeReferenceStandard) {
                        modulesToInclude.add(module.name);
                    }
                });
                modulesToInclude.forEach(moduleName => {
                    const moduleData = modulesData.find(m => m.name === moduleName);
                    if (moduleData && !effectiveFilters.some(f => f.name === moduleName)) {
                        effectiveFilters.push({
                            name: moduleName,
                            compatibleModuleNames: moduleData.compatibleModuleNames || [],
                        });
                    }
                });
            }
        }

        // ---- 提取（数据源路由，F 一期支持多源合并）----
        // 同步模式=[chatText]；异步模式=[chatText, asyncChat]（正文内 + 正文后）。
        // 各源产出同构 raw 数组，合并后交给 normalize 的 dedup 去重（同模块名+同变量值合并）。
        const sources = getActiveSources();
        if (!sources || sources.length === 0) {
            throw new Error('无可用模块数据源');
        }
        const rawModules = [];
        if (USE_OCCURRENCE_CACHE) {
            // 阶段 1：occurrence 缓存（每层全量缓存 + 下游按 filters 过滤）。
            // ⚠️ 负数层（聊天级条目起始态）在 chatMeta 单层提取时自动并入每层缓存；
            // 其变更需全量失效（见 eventHandler）。
            const chatKey = getChatCacheKey();
            const from = Math.max(0, start);
            const to = end !== null ? Math.min(end, chat.length - 1) : chat.length - 1;
            for (const { name, impl } of sources) {
                for (let f = from; f <= to; f++) {
                    const raws = getLayerRawsCached(chatKey, name, impl, f);
                    rawModules.push(...raws);
                }
            }
            // 过滤（全量缓存 → 按 effectiveFilters 筛）
            const filtered = filterRawByModuleNames(rawModules, effectiveFilters);
            rawModules.length = 0;
            rawModules.push(...filtered);
            debugLog(`[runModulePipeline] occurrence 提取：${rawModules.length} 个（源：${sources.map(s => s.name).join(',')}，层 ${from}-${to}）`);
        } else {
            for (const { impl } of sources) {
                const part = impl.getRawModules({ start, end, filters: effectiveFilters });
                if (Array.isArray(part)) rawModules.push(...part);
            }
            debugLog(`[runModulePipeline] 多源合并 raw 模块：${rawModules.length} 个（源：${sources.map(s => s.name).join(',')}）`);
        }

        // ---- 处理 ----
        let resultContent = '';
        let displayTitle = '';
        let resultPerf = null; // 快照续算耗时分布（useSnapshot 时填充）
        switch (processType) {
            case 'extract': {
                const r = processExtractModules(rawModules, selectedModuleNames);
                resultContent = r.resultContent;
                displayTitle = r.displayTitle;
                break;
            }
            case 'processed': {
                const r = processProcessedModules(rawModules, selectedModuleNames);
                resultContent = r.resultContent;
                displayTitle = r.displayTitle;
                break;
            }
            case 'auto': {
                if (useSnapshot) {
                    // 3.1/3.2：快照续算得到累积 groupModules → buildStructuredResult 产出与 processAutoModules 同构 content。
                    // 3.2：用 dirty 起点（失效楼层）增量续算——从最近 checkpoint 续算 dirty..end，省 dirty 前的累积态重算；
                    // 干净（dirty=null）时从 0（冷启动走 checkpoint 加速）。续算成功置干净。
                    const dirty = getSnapshotDirtyFloor();
                    const rebuild = rebuildFrom(dirty ?? 0, false);
                    resetSnapshotDirty();
                    resultContent = buildStructuredResult(rebuild.snapshot.groupModules, configManager.getModules() || [], selectedModuleNames);
                    // 携带本次快照续算耗时分布（供 Verify 性能表格；生产调用不依赖）
                    resultPerf = rebuild.perf
                        ? { layers: rebuild.perf.layers, dedup: rebuild.perf.dedup, time: rebuild.perf.time, group: rebuild.perf.group, rebuild: rebuild.totalMs }
                        : null;
                    displayTitle = '自动处理模块结果(快照)';
                } else {
                    resultContent = processAutoModules(rawModules, selectedModuleNames);
                    displayTitle = '自动处理模块结果';
                }
                break;
            }
            default:
                throw new Error(`不支持的处理类型：${processType}`);
        }

        // ---- 统计 ----
        let hasContent = false;
        let count = 0;
        if (typeof resultContent === 'string') {
            hasContent = resultContent.trim().length > 0;
        } else if (Array.isArray(resultContent)) {
            count = resultContent.length;
            hasContent = count > 0;
        } else if (resultContent && typeof resultContent === 'object') {
            count = Object.keys(resultContent).length;
            hasContent = count > 0;
        }

        // ---- buildString ----
        let contentString = resultContent;
        if (typeof resultContent !== 'string') {
            contentString = buildModulesString(resultContent, showModuleNames, showProcessInfo, showRule, skipEmpty);
        }

        const result = {
            success: true,
            content: resultContent,
            contentString,
            displayTitle,
            moduleCount: count,
            hasContent,
            // 快照续算耗时分布（仅 useSnapshot 有值；供 Verify 性能表格）
            perf: resultPerf,
        };

        // ---- style（可选）----
        if (style && resultContent && typeof resultContent === 'object') {
            Object.keys(resultContent).forEach(moduleName => {
                const moduleData = resultContent[moduleName];
                if (moduleData && moduleData.moduleConfig) {
                    insertCombinedStylesToDetails(moduleData);
                }
            });
        }

        // ---- 缓存写 ----
        if (cache === 'write' || cache === 'both') {
            writeCache({ start, end, processType, isAllModule, result });
        }

        // ---- groupByMessage（可选）----
        if (groupByMessage) {
            result.byMessage = groupProcessResultByMessageIndex({ content: result.content });
        }

        debugLog(`[runModulePipeline] 完成，moduleCount=${count} hasContent=${hasContent}`);
        return result;
    } catch (error) {
        errorLog('[runModulePipeline] 失败:', error);
        return {
            success: false,
            error: error.message,
            content: '',
            contentString: '',
            displayTitle: '处理失败',
            moduleCount: 0,
            hasContent: false,
        };
    }
}
