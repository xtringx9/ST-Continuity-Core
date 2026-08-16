// runModulePipeline.js
// 管线编排入口（Tier 1）。
//
// 取代旧 processModuleData 的 7 位置参数，用单一 options 对象编排：
//   extract(source) → normalize → process → [style] → buildString → [groupByMessage]
// 数据源走 moduleDataSources（源头路由），缓存走 cacheLayer（显式 read/write/both/none）。
//
// 行为保持：与旧 processModuleData 逐分支对齐（含 timeRef 自动并入、缓存读写条件）。
// 旧 processModuleData 改为 @deprecated 薄封装调用本函数（见 moduleProcessor.js）。

import configManager from '../../singleton/configManager.js';
import { debugLog, errorLog } from '../../utils/logger.js';
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
            });
            if (hit) {
                if (groupByMessage) hit.byMessage = groupByMessageIndex({ content: hit.content });
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
        for (const { impl } of sources) {
            const part = impl.getRawModules({ start, end, filters: effectiveFilters });
            if (Array.isArray(part)) rawModules.push(...part);
        }
        debugLog(`[runModulePipeline] 多源合并 raw 模块：${rawModules.length} 个（源：${sources.map(s => s.name).join(',')}）`);

        // ---- 处理 ----
        let resultContent = '';
        let displayTitle = '';
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
                resultContent = processAutoModules(rawModules, selectedModuleNames);
                displayTitle = '自动处理模块结果';
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
            contentString = buildModulesString(resultContent, showModuleNames, showProcessInfo, showRule);
        }

        const result = {
            success: true,
            content: resultContent,
            contentString,
            displayTitle,
            moduleCount: count,
            hasContent,
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
            result.byMessage = groupByMessageIndex({ content: result.content });
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
