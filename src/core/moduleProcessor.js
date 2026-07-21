// 模块数据处理器 - 入口文件
// 核心管线逻辑已拆分到 pipeline/ 子模块
import { chat } from '../../../../../../script.js';
import moduleCacheManager from '../singleton/moduleCacheManager.js';
import configManager from '../singleton/configManager.js';
import { debugLog, errorLog } from '../utils/logger.js';
import { extractModulesFromChat } from './moduleExtractor.js';

// 从管线子模块导入
import { processExtractModules, processProcessedModules, processAutoModules, buildModulesString } from './pipeline/output.js';

/**
 * 提取模块数据
 * @param {number} startIndex 起始索引
 * @param {number} endIndex 结束索引
 * @param {Array} moduleFilters 模块过滤条件数组
 * @returns {Promise<Array>} 提取到的原始模块数组
 */
function extractModules(startIndex, endIndex, moduleFilters) {
    return extractModulesFromChat(startIndex, endIndex, moduleFilters);
}

/**
 * 统一处理模块数据（支持多选）
 * @param {Object} extractParams 提取参数对象，包含startIndex, endIndex, moduleFilters
 * @param {string} processType 处理类型：'extract' | 'processed' | 'incremental' | 'full' | 'auto'
 * @param {Array} selectedModuleNames 选中的模块名数组
 * @param {boolean} isForce 是否强制刷新缓存
 * @param {boolean} showModuleNames 是否显示模块名
 * @param {boolean} showProcessInfo 是否显示处理方式说明
 * @param {boolean} showRule 是否显示规则
 * @returns {Object} 包含处理结果和显示信息的对象
 */
export function processModuleData(extractParams, processType, selectedModuleNames = undefined, isForce = false, showModuleNames = false, showProcessInfo = false, showRule = false) {
    try {
        debugLog(`[EVENTS]开始处理模块数据，类型：${processType}`);

        if (!extractParams || typeof extractParams !== 'object') {
            throw new Error('提取参数无效');
        }

        let { startIndex, endIndex, moduleFilters } = extractParams;

        const isAllModule = moduleFilters === null;

        let checkEndIndex = endIndex;
        if (checkEndIndex === null) {
            checkEndIndex = chat?.length - 1;
        }

        if (processType === 'auto' && moduleCacheManager.hasCurrentChatData(startIndex, checkEndIndex) && !isForce) {
            const cachedData = moduleCacheManager.getCurrentChatData(startIndex, checkEndIndex);
            let content = {};
            let tmpSelectedModuleNames = selectedModuleNames;
            if (tmpSelectedModuleNames === undefined) {
                if (isAllModule) {
                    tmpSelectedModuleNames = configManager.getEffectiveModules().map(module => module.moduleName);
                }
                else {
                    tmpSelectedModuleNames = moduleFilters.map(config => config.name);
                }
            }
            Object.keys(cachedData.content).forEach(moduleName => {
                if (tmpSelectedModuleNames.includes(moduleName)) {
                    content[moduleName] = cachedData.content[moduleName];
                }
            });

            let contentString = '';
            if (typeof content !== 'string') {
                contentString = buildModulesString(content, showModuleNames, showProcessInfo, showRule);
            }
            let count = 0;
            let hasContent = false;
            if (Array.isArray(content)) {
                count = content.length;
                hasContent = count > 0;
            } else if (content && typeof content === 'object') {
                count = Object.keys(content).length;
                hasContent = count > 0;
            }
            const returnContent = {
                success: cachedData.success,
                content: content,
                contentString: contentString,
                displayTitle: cachedData.displayTitle,
                moduleCount: count,
                hasContent: hasContent
            };
            debugLog(`从缓存中获取模块数据，范围：${startIndex} - ${checkEndIndex}`, cachedData, returnContent);
            return returnContent;
        }

        if (moduleFilters !== null) {
            const modulesData = configManager.getEffectiveModules() || [];
            if (modulesData && Array.isArray(modulesData)) {
                const modulesToInclude = new Set();

                if (moduleFilters && Array.isArray(moduleFilters)) {
                    moduleFilters.forEach(filter => {
                        modulesToInclude.add(filter.name);
                    });
                } else {
                    moduleFilters = [];
                }

                modulesData.forEach(module => {
                    if (module.timeReferenceStandard) {
                        modulesToInclude.add(module.name);
                    }
                });

                modulesToInclude.forEach(moduleName => {
                    const moduleData = modulesData.find(m => m.name === moduleName);
                    if (moduleData && !moduleFilters.some(f => f.name === moduleName)) {
                        moduleFilters.push({
                            name: moduleName,
                            compatibleModuleNames: moduleData.compatibleModuleNames || []
                        });
                    }
                });
            }
        }

        const rawModules = extractModules(startIndex, endIndex, moduleFilters);

        let resultContent = '';
        let displayTitle = '';

        switch (processType) {
            case 'extract':
                const extractResult = processExtractModules(rawModules, selectedModuleNames);
                resultContent = extractResult.resultContent;
                displayTitle = extractResult.displayTitle;
                break;

            case 'processed':
                const processedResult = processProcessedModules(rawModules, selectedModuleNames);
                resultContent = processedResult.resultContent;
                displayTitle = processedResult.displayTitle;
                break;

            case 'auto':
                const structuredResult = processAutoModules(rawModules, selectedModuleNames);
                resultContent = structuredResult;
                displayTitle = '自动处理模块结果';
                break;
            default:
                throw new Error(`不支持的处理类型：${processType}`);
        }

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

        let contentString = resultContent;
        if (typeof resultContent !== 'string') {
            contentString = buildModulesString(resultContent, showModuleNames, showProcessInfo, showRule);
        }

        const moduleFinalData = {
            success: true,
            content: resultContent,
            contentString: contentString,
            displayTitle: displayTitle,
            moduleCount: count,
            hasContent: hasContent
        };

        if (processType === 'auto' && isAllModule) {
            moduleCacheManager.setCurrentChatData(startIndex, checkEndIndex, moduleFinalData);
        }

        debugLog(`模块处理结果：`, moduleFinalData);
        return moduleFinalData;

    } catch (error) {
        errorLog(`处理模块数据失败（类型：${processType}）:`, error);
        return {
            success: false,
            error: error.message,
            content: '',
            displayTitle: '处理失败',
            moduleCount: 0,
            hasContent: false
        };
    }
}

/**
 * 按messageIndex和messageIndexHistory分组处理processResult数据
 * @param {Object} processResult 处理结果对象
 * @param {boolean} moveIncrementalEmbeddedToLast 是否将可嵌入模块排到最后
 * @param {boolean} needAllIndex 是否需要所有索引
 * @returns {Object} 按messageIndex分组的条目数据
 */
export function groupProcessResultByMessageIndex(processResult, moveIncrementalEmbeddedToLast = false, needAllIndex = false) {
    try {
        if (!processResult || !processResult.content || typeof processResult.content !== 'object') {
            errorLog('[Module Processor] processResult格式无效');
            return {};
        }

        const groupedResult = {};

        Object.keys(processResult.content).forEach(moduleName => {
            const moduleData = processResult.content[moduleName];

            if (!moduleData || !moduleData.data || !Array.isArray(moduleData.data)) {
                debugLog(`[Module Processor]模块 ${moduleName} 没有有效的数据数组`);
                return;
            }

            moduleData.data.forEach(entry => {
                if (!entry || !entry.moduleData) {
                    debugLog(`[Module Processor]模块 ${moduleName} 的条目缺少moduleData`);
                    return;
                }
                if (entry.moduleData.timeline) {
                    entry.moduleData.timeline.forEach(timelineEntry => {
                        const timelineData = {
                            ...timelineEntry,
                            moduleData: { raw: timelineEntry.raw, processedRaw: timelineEntry.processedRaw, nestedInfo: timelineEntry.nestedInfo }
                        }

                        if (!groupedResult[timelineEntry.messageIndex]) {
                            groupedResult[timelineEntry.messageIndex] = [];
                        }

                        if (!groupedResult[timelineEntry.messageIndex].includes(timelineData)) {
                            groupedResult[timelineEntry.messageIndex].push(timelineData);
                        }
                    });
                }
                if (!entry.moduleData.timeline || needAllIndex) {
                    const messageIndexHistory = entry.moduleData.messageIndexHistory;

                    if (!entry.moduleData.messageIndexHistory || !Array.isArray(entry.moduleData.messageIndexHistory)) {
                        debugLog(`[Module Processor]模块 ${moduleName} 的条目 ${entry.moduleData.moduleName} 缺少有效的messageIndexHistory数组`);
                        if (!groupedResult[entry.moduleData.messageIndex]) {
                            groupedResult[entry.moduleData.messageIndex] = [];
                        }

                        if (!groupedResult[entry.moduleData.messageIndex].includes(entry)) {
                            groupedResult[entry.moduleData.messageIndex].push(entry);
                        }
                        return;
                    }

                    messageIndexHistory.forEach(index => {
                        if (!groupedResult[index]) {
                            groupedResult[index] = [];
                        }

                        if (!groupedResult[index].includes(entry)) {
                            groupedResult[index].push(entry);
                        }
                    });
                }

            });
        });

        Object.keys(groupedResult).forEach(messageIndex => {
            const entries = groupedResult[messageIndex];

            const modulesData = configManager.getEffectiveModules() || [];

            if (moveIncrementalEmbeddedToLast) {
                const embeddedEntries = [];
                const nonEmbeddedEntries = [];

                entries.forEach(entry => {
                    const moduleConfig = modulesData.find(config => config.name === entry.moduleName);
                    if (moduleConfig && moduleConfig.outputPosition === 'embedded' && moduleConfig.outputMode === 'incremental') {
                        embeddedEntries.push(entry);
                    } else {
                        nonEmbeddedEntries.push(entry);
                    }
                });

                nonEmbeddedEntries.sort((a, b) => {
                    const aModuleConfig = modulesData.find(config => config.name === a.moduleName);
                    const bModuleConfig = modulesData.find(config => config.name === b.moduleName);

                    const aOrder = aModuleConfig?.order !== undefined ? aModuleConfig.order : 0;
                    const bOrder = bModuleConfig?.order !== undefined ? bModuleConfig.order : 0;

                    return aOrder - bOrder;
                });

                embeddedEntries.sort((a, b) => {
                    const aModuleConfig = modulesData.find(config => config.name === a.moduleName);
                    const bModuleConfig = modulesData.find(config => config.name === b.moduleName);

                    const aOrder = aModuleConfig?.order !== undefined ? aModuleConfig.order : 0;
                    const bOrder = bModuleConfig?.order !== undefined ? bModuleConfig.order : 0;

                    return aOrder - bOrder;
                });

                groupedResult[messageIndex] = [...nonEmbeddedEntries, ...embeddedEntries];
            } else {
                entries.sort((a, b) => {
                    const aModuleConfig = modulesData.find(config => config.name === a.moduleName);
                    const bModuleConfig = modulesData.find(config => config.name === b.moduleName);

                    const aOrder = aModuleConfig?.order !== undefined ? aModuleConfig.order : 0;
                    const bOrder = bModuleConfig?.order !== undefined ? bModuleConfig.order : 0;

                    return aOrder - bOrder;
                });

                groupedResult[messageIndex] = entries;
            }
        });

        debugLog(`[Module Processor]按messageIndex和messageIndexHistory分组完成，共 ${Object.keys(groupedResult).length} 个不同的messageIndex，moveEmbeddedToLast: ${moveIncrementalEmbeddedToLast}，前后数据：`, processResult, groupedResult);
        return groupedResult;

    } catch (error) {
        errorLog('[Module Processor]按messageIndex和messageIndexHistory分组处理失败:', error);
        return {};
    }
}
