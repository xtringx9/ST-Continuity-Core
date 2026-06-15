// 时间处理管线步骤
import configManager from '../../singleton/configManager.js';
import { debugLog } from '../../utils/logger.js';
import { parseTimeDetailed, completeTimeDataWithStandard } from '../../utils/timeParser.js';

/**
 * 为包含time变量的模块附加结构化时间数据
 * 使用timeParser.js中的parseTimeDetailed函数解析时间并添加结构化数据
 * @param {Array} modules 标准化后的模块数组
 */
export function attachStructuredTimeData(modules) {
    debugLog('[TimeDataAttachment] 开始为模块附加结构化时间数据，模块数量:', modules.length);

    let attachmentCount = 0;
    let formattedCount = 0;

    // 动态获取模块配置
    const modulesData = configManager.getModules() || [];
    const moduleConfig = modulesData.find(config => config.timeReferenceStandard === true);

    let standardTimeData = null;
    if (moduleConfig) {
        // 查找标准时间条目：moduleConfig.timeReferenceStandard为true且time值可被解析且完整
        for (const standardModule of modules) {
            if (standardModule.moduleName !== moduleConfig.name) continue;
            if (standardModule.variables) {
                for (const [variableName, timeVal] of Object.entries(standardModule.variables)) {
                    if (variableName.toLowerCase().includes('time') && timeVal) {
                        try {
                            const testTimeData = parseTimeDetailed(timeVal);
                            if (testTimeData && testTimeData.isValid && testTimeData.isComplete) {
                                standardTimeData = testTimeData;
                                debugLog(`[TimeDataAttachment WEEKDAY] 找到标准时间参考值: ${timeVal}`);
                                break;
                            }
                        } catch (error) {
                            // 如果解析失败，继续查找下一个
                        }
                    }
                }
                if (standardTimeData) break;
            }
        }
    }

    modules.forEach(module => {
        if (module.variables) {
            for (const [variableName, timeVal] of Object.entries(module.variables)) {
                if (variableName.toLowerCase().includes('time') && timeVal) {
                    try {
                        const timeData = parseTimeDetailed(timeVal, standardTimeData);

                        if (timeData) {
                            module.timeData = timeData;
                            attachmentCount++;

                            if (timeData.formattedString) {
                                module.variables[variableName] = timeData.formattedString;
                                formattedCount++;
                            }
                        }
                    } catch (error) {
                        debugLog(`[TimeDataAttachment] 解析时间变量失败: ${variableName} = ${timeVal}`, error);
                    }

                    break;
                }
            }
        }
    });

    debugLog('[TimeDataAttachment] 结构化时间数据附加完成，共处理模块数:', attachmentCount, '格式化变量数:', formattedCount);
}

/**
 * 智能补全time变量
 * 利用已附加的timeData属性，为同一message内的模块补全时间数据
 * @param {Array} modules 标准化后的模块数组
 */
export function completeTimeVariables(modules) {
    // 按messageIndex分组
    const messageModulesMap = {};

    // 第一步：分组
    modules.forEach(module => {
        const messageIndex = module.messageIndex;
        if (messageIndex >= 0) {
            if (!messageModulesMap[messageIndex]) {
                messageModulesMap[messageIndex] = [];
            }
            messageModulesMap[messageIndex].push(module);
        }
    });

    // 第二步：为每组message中的模块补全time变量
    Object.values(messageModulesMap).forEach((messageModules, index) => {
        const modulesData = configManager.getModules() || [];

        let standardTimeData = null;
        let standardTimeModuleName = '';

        // 策略1：优先查找开启了时间参考标准且timeData有效且完整的模块
        for (const module of messageModules) {
            if (module.timeData && module.timeData.isValid && module.timeData.isComplete) {
                const moduleConfig = modulesData.find(config => config.name === module.moduleName);

                if (moduleConfig && moduleConfig.timeReferenceStandard) {
                    standardTimeData = module.timeData;
                    standardTimeModuleName = module.moduleName;
                    break;
                }
            }
        }

        // 策略2：如果策略1没找到，查找任何timeData有效且完整的模块
        if (!standardTimeData) {
            for (const module of messageModules) {
                if (module.timeData && module.timeData.isValid && module.timeData.isComplete) {
                    standardTimeData = module.timeData;
                    standardTimeModuleName = module.moduleName;
                    debugLog(`[TimeCompletion] 找到标准时间数据，来自模块 ${standardTimeModuleName}`);
                    break;
                }
            }
        }

        if (!standardTimeData) {
            return;
        }

        let completionCount = 0;

        for (const module of messageModules) {
            if (module.timeData === standardTimeData) continue;

            for (const [variableName] of Object.entries(module.variables)) {
                if (variableName.toLowerCase().includes('time')) {
                    if (!module.timeData || (!module.timeData.isValid && !module.timeData.originalText)) {
                        debugLog(`[TimeCompletion] 模块 ${module.moduleName} 的时间数据无效，${module.timeData?.originalText}`, module);
                        module.timeData = standardTimeData;
                        module.variables[variableName] = module.timeData.formattedString;
                        module.isAddTime = true;
                        completionCount++;
                        break;
                    }
                }
            }
            for (const [variableName] of Object.entries(module.variables)) {
                if (variableName.toLowerCase().includes('time')) {
                    if (module.timeData && module.timeData.isValid && !module.timeData.isComplete) {
                        const formattedString = module.timeData.formattedString;

                        const updatedTimeData = completeTimeDataWithStandard(module.timeData, standardTimeData);

                        if (updatedTimeData !== module.timeData) {
                            module.timeData = updatedTimeData;
                        }
                        debugLog(`[TimeCompletion] 补全模块 ${module.moduleName} 的时间数据，添加年月日信息${module.timeData.formattedString}，旧时间：${formattedString}`, module);

                        if (module.variables && module.timeData.isComplete) {
                            debugLog(`[TimeCompletion] 补全模块 ${module.moduleName} 的时间数据，添加年月日信息${module.timeData.formattedString}，旧时间：${formattedString}`, module);
                            module.variables[variableName] = module.timeData.formattedString;
                            completionCount++;
                            break;
                        }
                    }
                }
            }
        }

        if (completionCount > 0) {
            debugLog(`[TimeCompletion] 第${index + 1}组message完成时间补全，共补全${completionCount}个模块`);
        }
    });
    debugLog('[TimeCompletion] 智能补全time变量完成');
}
