// groupByMessage.js
// 按 messageIndex / messageIndexHistory 分组 processResult（原 moduleProcessor.groupProcessResultByMessageIndex）。
// 迁出 moduleProcessor.js 以切断与 runModulePipeline 的循环依赖。
// 行为保持：逻辑与原函数逐行一致。

import configManager from '../../singleton/configManager.js';
import { debugLog, errorLog } from '../../utils/logger.js';

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
            errorLog('[groupByMessage] processResult格式无效');
            return {};
        }

        const groupedResult = {};

        Object.keys(processResult.content).forEach(moduleName => {
            const moduleData = processResult.content[moduleName];

            if (!moduleData || !moduleData.data || !Array.isArray(moduleData.data)) {
                debugLog(`[groupByMessage]模块 ${moduleName} 没有有效的数据数组`);
                return;
            }

            moduleData.data.forEach(entry => {
                if (!entry || !entry.moduleData) {
                    debugLog(`[groupByMessage]模块 ${moduleName} 的条目缺少moduleData`);
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
                        debugLog(`[groupByMessage]模块 ${moduleName} 的条目 ${entry.moduleData.moduleName} 缺少有效的messageIndexHistory数组`);
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

        // 提升到循环外，避免每个 messageIndex 都深拷贝全部模块 + 解析绑定
        const modulesData = configManager.getModules() || [];
        Object.keys(groupedResult).forEach(messageIndex => {
            const entries = groupedResult[messageIndex];

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

        debugLog(`[groupByMessage]按messageIndex和messageIndexHistory分组完成，共 ${Object.keys(groupedResult).length} 个不同的messageIndex，moveEmbeddedToLast: ${moveIncrementalEmbeddedToLast}，前后数据：`, processResult, groupedResult);
        return groupedResult;

    } catch (error) {
        errorLog('[groupByMessage]按messageIndex和messageIndexHistory分组处理失败:', error);
        return {};
    }
}
