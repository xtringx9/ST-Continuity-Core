// 模块数据处理器 - 独立管理模块数据的文本处理方法
import { configManager, debugLog, errorLog } from '../index.js';
import { extractModulesFromChat } from './moduleExtractor.js';
import { IdentifierParser } from '../utils/identifierParser.js';

// /**
//  * 模块数据处理器类
//  */
// export class ModuleProcessor {
//     constructor() {
//         moduleExtractor = new ModuleExtractor();
//     }

/**
 * 提取模块数据
 * @param {number} startIndex 起始索引
 * @param {number} endIndex 结束索引
 * @param {Array} moduleFilters 模块过滤条件数组，每个过滤条件包含name和compatibleModuleNames
 * @returns {Promise<Array>} 提取到的原始模块数组
 */
async function extractModules(startIndex, endIndex, moduleFilters) {
    return await extractModulesFromChat(startIndex, endIndex, moduleFilters);
}

/**
 * 处理原生模块提取
 * @param {Array} rawModules 原始模块数组
 * @param {Array} selectedModuleNames 选中的模块名数组
 * @param {boolean} returnString 是否返回字符串格式
 * @returns {Object} 包含resultContent和displayTitle的对象
 */
export function processExtractModules(rawModules, selectedModuleNames, returnString) {
    // 对于extract类型，直接返回原生的模块数据，不进行标准化处理
    const modules = rawModules;

    // 过滤出选中的模块（支持多选）
    const filteredModules = modules.filter(module => {
        // 如果没有选择任何模块，显示所有模块
        if (!selectedModuleNames || selectedModuleNames.length === 0) {
            return true;
        }

        // 由于是原生数据，需要解析模块名来匹配
        const originalModuleName = module.raw.slice(1, module.raw.indexOf('|') > 0 ? module.raw.indexOf('|') : module.raw.length - 1);

        // 获取所有模块配置
        const modulesData = configManager.getModules() || [];

        // 检查是否匹配选中的模块名（支持兼容模块名）
        return selectedModuleNames.some(selectedModuleName => {
            // 直接匹配模块名
            if (selectedModuleName === originalModuleName) {
                return true;
            }

            // 查找对应的模块配置
            const moduleConfig = modulesData.find(configModule => configModule.name === selectedModuleName);
            if (moduleConfig && moduleConfig.compatibleModuleNames) {
                // 检查兼容模块名是否包含当前原生模块名
                return moduleConfig.compatibleModuleNames.includes(originalModuleName);
            }

            return false;
        });
    });

    let resultContent = '';
    const displayTitle = '原生模块提取结果';

    // 根据参数决定返回格式
    if (returnString) {
        // 直接返回原始模块字符串
        resultContent = filteredModules.map(module => module.raw).join('\n');
    } else {
        // 返回原生结构化数据
        resultContent = filteredModules.map(module => {
            // 解析模块名和变量
            const content = module.raw.slice(1, -1);
            const [moduleName, ...parts] = content.split('|');

            // 解析变量
            const variables = {};
            parts.forEach(part => {
                const colonIndex = part.indexOf(':');
                if (colonIndex === -1) return;
                const key = part.substring(0, colonIndex).trim();
                const value = part.substring(colonIndex + 1).trim();
                if (key) {
                    variables[key] = value;
                }
            });

            // 构建原生模块的结构化数据
            const moduleData = {
                moduleName: moduleName,
                identifier: module.identifier || '',
                variables: variables,
                raw: module.raw,
                moduleConfig: null // 原生数据不包含模块配置
            };

            return moduleData;
        });
    }

    return { resultContent, displayTitle };
}

/**
 * 处理标准化后的模块
 * @param {Array} rawModules 原始模块数组
 * @param {Array} selectedModuleNames 选中的模块名数组
 * @param {boolean} returnString 是否返回字符串格式
 * @returns {Object} 包含resultContent和displayTitle的对象
 */
export function processProcessedModules(rawModules, selectedModuleNames, returnString) {
    // 标准化模块数据
    const modules = normalizeModules(rawModules);

    // 过滤出选中的模块（支持多选）
    const filteredModules = modules.filter(module => {
        // 如果没有选择任何模块，显示所有模块
        if (!selectedModuleNames || selectedModuleNames.length === 0) {
            return true;
        }
        // 如果选择了模块，只显示选中的模块
        return selectedModuleNames.includes(module.moduleName);
    });

    let resultContent = '';
    const displayTitle = '整理后模块结果';

    // 根据参数决定返回格式
    if (returnString) {
        // 构建处理后的模块字符串
        const processedModules = filteredModules.map(module => {
            if (!module.moduleConfig) {
                // 没有模块配置，返回原始内容
                return module.raw;
            }

            // 构建当前模块的字符串
            let moduleString = `[${module.moduleName}`;

            // 按照模块配置中的变量顺序添加变量
            module.moduleConfig.variables.forEach(variable => {
                // 获取变量值
                let varValue = module.variables[variable.name] || '';

                moduleString += `|${variable.name}:${varValue}`;
            });

            moduleString += ']';

            return moduleString;
        });

        resultContent = processedModules.join('\n');
    } else {
        // 返回结构化数据
        resultContent = filteredModules.map(module => {
            // 构建当前模块的结构化数据
            const moduleData = {
                moduleName: module.moduleName,
                identifier: module.identifier || '',
                variables: module.variables || {},
                raw: module.raw,
                moduleConfig: module.moduleConfig || null
            };

            return moduleData;
        });
    }

    return { resultContent, displayTitle };
}

/**
 * 标准化模块数据，处理兼容模块名和兼容变量
 * @param {Array} modules 提取到的原始模块数组
 * @returns {Array} 标准化后的模块数组
 */
export function normalizeModules(modules) {
    const modulesData = configManager.getModules() || [];
    const normalizedModules = [];

    // 第一步：标准化所有模块
    modules.forEach(module => {
        // 解析模块名和变量
        const [originalModuleName, ...parts] = module.raw.slice(1, -1).split('|');

        // 解析当前模块的变量
        const originalVariables = {};
        parts.forEach(part => {
            const colonIndex = part.indexOf(':');
            if (colonIndex === -1) return;

            const key = part.substring(0, colonIndex).trim();
            const value = part.substring(colonIndex + 1).trim();

            if (key) {
                originalVariables[key] = value;
            }
        });

        // 查找模块配置（支持兼容模块名）
        const moduleConfig = modulesData.find(configModule => {
            // 检查主模块名是否匹配
            if (configModule.name === originalModuleName) return true;
            // 检查兼容模块名是否包含当前模块名
            if (configModule.compatibleModuleNames) {
                // const compatibleNames = configModule.compatibleModuleNames.split(',').map(name => name.trim());
                return configModule.compatibleModuleNames.includes(originalModuleName);
            }
            return false;
        });

        if (moduleConfig) {
            // 构建变量名映射（兼容变量名 -> 当前变量名）
            const variableNameMap = buildVariableNameMap(moduleConfig);

            // 标准化变量
            const normalizedVariables = {};
            moduleConfig.variables.forEach(variable => {
                normalizedVariables[variable.name] = '';
            });

            // 提取模块内容（去掉首尾的[]）
            const content = module.raw.slice(1, -1);

            // 解析变量字符串
            let lastPipePos = content.indexOf('|') + 1;
            let inNestedModule = 0;

            for (let i = lastPipePos; i < content.length; i++) {
                const char = content[i];

                if (char === '[') {
                    inNestedModule++;
                } else if (char === ']') {
                    inNestedModule--;
                } else if (char === '|' && inNestedModule === 0) {
                    // 只在顶级管道符处分割
                    const varPart = content.substring(lastPipePos, i).trim();
                    parseSingleVariableInProcess(varPart, normalizedVariables, variableNameMap);
                    lastPipePos = i + 1;
                }
            }

            // 处理最后一个变量部分
            const lastPart = content.substring(lastPipePos).trim();
            parseSingleVariableInProcess(lastPart, normalizedVariables, variableNameMap);

            // 构建标准化模块
            const normalizedModule = {
                ...module,
                originalModuleName,
                moduleName: moduleConfig.name, // 使用配置中的标准模块名
                variables: normalizedVariables,
                moduleConfig
            };

            normalizedModules.push(normalizedModule);
        } else {
            // 如果没有找到模块配置，使用原始模块数据
            normalizedModules.push({
                ...module,
                originalModuleName,
                moduleName: originalModuleName,
                variables: originalVariables,
                moduleConfig: null
            });
        }
    });

    // 第二步：智能补全time变量
    completeTimeVariables(normalizedModules);

    // 第三步：对模块进行排序
    const sortedModules = sortModules(normalizedModules);

    // 第四步：智能补全id变量
    completeIdVariables(sortedModules);

    return sortedModules;
}

/**
 * 智能补全time变量
 * 对于time变量为空或只有时分的模块，根据同一条message内其他模块的time变量来补足
 * @param {Array} modules 标准化后的模块数组
 */
export function completeTimeVariables(modules) {
    // debugLog('[TimeCompletion] 开始智能补全time变量，模块数量:', modules.length);

    // 按messageIndex分组
    const messageModulesMap = {};

    // 第一步：分组
    modules.forEach(module => {
        const messageIndex = module.messageIndex;
        if (!messageModulesMap[messageIndex]) {
            messageModulesMap[messageIndex] = [];
        }
        messageModulesMap[messageIndex].push(module);
    });

    // debugLog('[TimeCompletion] 按messageIndex分组完成，分组数量:', Object.keys(messageModulesMap).length);

    // 第二步：为每组message中的模块补全time变量
    Object.values(messageModulesMap).forEach((messageModules, index) => {
        // debugLog(`[TimeCompletion] 处理第${index + 1}组message，包含${messageModules.length}个模块`);

        // 查找该message中包含完整time信息的模块
        let referenceTime = null;
        let referenceTimeStr = '';
        let referenceModuleName = '';

        // 策略1：优先查找开启了时间参考标准的模块
        // debugLog(`[TimeCompletion] 策略1：优先查找开启时间参考标准的模块`);

        // 获取所有模块配置
        const modulesData = configManager.getModules() || [];

        for (const module of messageModules) {
            if (module.variables) {
                // 查找当前模块的配置
                const moduleConfig = modulesData.find(config => config.name === module.moduleName);

                // 检查模块是否开启了时间参考标准
                if (moduleConfig && moduleConfig.timeReferenceStandard) {
                    // debugLog(`[TimeCompletion] 模块 ${module.moduleName} 开启了时间参考标准`);

                    // 遍历所有变量，查找包含time的变量名
                    for (const [variableName, timeVal] of Object.entries(module.variables)) {
                        if (variableName.toLowerCase().includes('time') && timeVal) {
                            // debugLog(`[TimeCompletion] 发现time变量 ${variableName}: ${timeVal}`);
                            const parsedTime = parseTime(timeVal);
                            // debugLog(`[TimeCompletion] 解析后的时间戳: ${parsedTime}`);

                            // 检查是否是完整的年月日时间
                            if (parsedTime > 0) {
                                const date = new Date(parsedTime);
                                // debugLog(`[TimeCompletion] 解析后的日期对象: ${date}`);
                                // 如果时间包含年月日（不是只有时分）
                                if (date.getFullYear() > 1970 && date.getMonth() >= 0 && date.getDate() > 0) {
                                    referenceTime = parsedTime;
                                    referenceTimeStr = timeVal;
                                    referenceModuleName = module.moduleName;
                                    // debugLog(`[TimeCompletion] 找到参考时间: ${referenceTimeStr} (来自开启时间参考标准的模块 ${referenceModuleName})`);
                                    break;
                                } else {
                                    // debugLog(`[TimeCompletion] 时间不完整: 年份=${date.getFullYear()}, 月份=${date.getMonth()}, 日期=${date.getDate()}`);
                                }
                            } else {
                                debugLog(`[TimeCompletion] 无法解析时间: ${timeVal}`);
                            }
                        }
                    }
                    if (referenceTime) break;
                }
            }
        }

        // 策略2：如果策略1没找到，查找有完整年月日的time变量（支持所有包含time的变量名）
        if (!referenceTime) {
            // debugLog(`[TimeCompletion] 策略1未找到参考时间，尝试策略2：查找有完整年月日的time变量`);

            for (const module of messageModules) {
                if (module.variables) {
                    // debugLog(`[TimeCompletion] 检查模块 ${module.moduleName} 的变量:`, Object.keys(module.variables));

                    // 遍历所有变量，查找包含time的变量名
                    for (const [variableName, timeVal] of Object.entries(module.variables)) {
                        if (variableName.toLowerCase().includes('time') && timeVal) {
                            // debugLog(`[TimeCompletion] 发现time变量 ${variableName}: ${timeVal}`);
                            const parsedTime = parseTime(timeVal);
                            // debugLog(`[TimeCompletion] 解析后的时间戳: ${parsedTime}`);

                            // 检查是否是完整的年月日时间
                            if (parsedTime > 0) {
                                const date = new Date(parsedTime);
                                // debugLog(`[TimeCompletion] 解析后的日期对象: ${date}`);
                                // 如果时间包含年月日（不是只有时分）
                                if (date.getFullYear() > 1970 && date.getMonth() >= 0 && date.getDate() > 0) {
                                    referenceTime = parsedTime;
                                    referenceTimeStr = timeVal;
                                    referenceModuleName = module.moduleName;
                                    // debugLog(`[TimeCompletion] 找到参考时间: ${referenceTimeStr} (来自模块 ${referenceModuleName})`);
                                    break;
                                } else {
                                    // debugLog(`[TimeCompletion] 时间不完整: 年份=${date.getFullYear()}, 月份=${date.getMonth()}, 日期=${date.getDate()}`);
                                }
                            } else {
                                debugLog(`[TimeCompletion] 无法解析时间: ${timeVal}`);
                            }
                        }
                    }
                    if (referenceTime) break;
                }
            }
        }

        if (!referenceTime) {
            // debugLog(`[TimeCompletion] 第${index + 1}组message中未找到完整的参考时间`);
        }

        // 如果找到了参考时间，为其他模块补全
        if (referenceTime) {
            // debugLog(`[TimeCompletion] 使用参考时间 ${referenceTimeStr} 补全其他模块`);
            let completionCount = 0;

            for (const module of messageModules) {
                if (module.variables) {
                    // 遍历所有变量，补全包含time的变量
                    for (const [variableName, timeVal] of Object.entries(module.variables)) {
                        if (variableName.toLowerCase().includes('time') && timeVal !== undefined) {
                            // debugLog(`[TimeCompletion] 检查模块 ${module.moduleName} 的time变量 ${variableName}: ${timeVal}`);

                            // 如果time变量为空或只有时分
                            if (!timeVal || /^\d{1,2}:\d{1,2}$/.test(timeVal)) {
                                const originalValue = timeVal;
                                // 使用统一的标识符解析工具处理时间变量
                                module.variables[variableName] = IdentifierParser.parseTimeVariable(timeVal, referenceTimeStr, new Date(referenceTime));
                                completionCount++;
                                // debugLog(`[TimeCompletion] 补全time变量: ${variableName} 从 "${originalValue}" 变为 "${module.variables[variableName]}"`);
                            } else {
                                // debugLog(`[TimeCompletion] time变量 ${variableName} 已完整，无需补全: ${timeVal}`);
                            }
                        }
                    }
                }
            }

            // debugLog(`[TimeCompletion] 第${index + 1}组message完成补全，共补全${completionCount}个time变量`);
        }
    });

    // debugLog('[TimeCompletion] 智能补全time变量完成');
}

/**
 * 根据参考时间字符串的格式，格式化新的时间对象
 * @param {string} referenceTimeStr 参考时间字符串
 * @param {Date} date 要格式化的时间对象
 * @returns {string} 格式化后的时间字符串
 */
export function formatTimeToSamePattern(referenceTimeStr, date) {
    // 根据参考时间的格式返回相应格式的时间字符串
    if (/^\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
        // 格式：2023年09月30日 21:30
        return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    } else if (/^\d{2}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
        // 格式：24年4月11日 08:23
        return `${String(date.getFullYear()).slice(-2)}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    } else if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
        // 格式：2023-09-30 21:30
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    } else if (/^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
        // 格式：2023/09/30 21:30
        return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    } else {
        // 默认格式
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
}

/**
 * 解析时间字符串为时间戳
 * 支持多种时间格式，包括时间段
 * @param {string} timeStr 时间字符串
 * @returns {number} 时间戳（毫秒）
 */
export function parseTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') {
        return 0;
    }

    // 尝试匹配时间段格式，例如 "24年4月11日 周四 08:23 ~ 24年4月22日 周一 18:40"
    // 支持中英文时间范围格式：
    // 2023年09月28日 周四 10:10~17:30
    // 2023年09月28日 周四 10:10~2023年09月28日 周五 17:30
    // 2023-09-28 Thursday 10:10~17:30
    // 2023-09-28 Thursday 10:10~2023-09-29 Friday 17:30
    const timeRangeMatch = timeStr.match(/(.*?)\s*~\s*(.*)/);
    if (timeRangeMatch) {
        // 如果是时间段，取开始时间
        timeStr = timeRangeMatch[1].trim();
    }

    // 尝试匹配各种时间格式（按从具体到通用的顺序）
    const patterns = [
        // 最具体的格式：带星期的完整日期时间
        // 格式：2023年09月28日 周四 10:10
        /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(?:周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})$/,
        // 格式：24年4月11日 周四 08:23
        /^(\d{2})年(\d{1,2})月(\d{1,2})日\s+(?:周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})$/,
        // 格式：2023-09-28 Thursday 10:10
        /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(?:周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})$/,
        // 格式：2023/09/28 Thursday 10:10
        /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(?:周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})$/,

        // 完整的日期时间格式
        // 格式：2023年09月30日 21:30
        /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})$/,
        // 格式：24年4月11日 08:23
        /^(\d{2})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})$/,
        // 格式：2023-09-30 21:30
        /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/,
        // 格式：2023/09/30 21:30
        /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/,

        // 仅日期格式
        // 格式：2023年09月30日
        /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
        // 格式：24年4月11日
        /^(\d{2})年(\d{1,2})月(\d{1,2})日$/,
        // 格式：2023-09-30
        /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
        // 格式：2023/09/30
        /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,

        // 仅时间格式（放在最后，因为最通用）
        // 格式：08:23
        /^(\d{1,2}):(\d{1,2})$/,
    ];

    for (const pattern of patterns) {
        const match = timeStr.match(pattern);
        if (match) {
            let year, month, day, hour = 0, minute = 0;

            switch (match.length) {
                case 4: // 时间格式：HH:MM 或 日期格式：YYYY年MM月DD日
                    if (pattern.toString().includes('年') && pattern.toString().includes('月') && pattern.toString().includes('日')) {
                        // 日期格式：YYYY年MM月DD日
                        [, year, month, day] = match;
                    } else {
                        // 时间格式：HH:MM
                        [, hour, minute] = match;
                        year = new Date().getFullYear();
                        month = new Date().getMonth() + 1;
                        day = new Date().getDate();
                    }
                    break;
                case 6: // 日期+时间格式
                    if (match[1].length === 2) {
                        // 两位数年份
                        [, year, month, day, hour, minute] = match;
                        year = parseInt(year, 10) + 2000; // 假设是2000年后
                    } else {
                        // 四位数年份
                        [, year, month, day, hour, minute] = match;
                    }
                    break;
                case 5: // 日期格式
                    if (match[1].length === 2) {
                        // 两位数年份
                        [, year, month, day] = match;
                        year = parseInt(year, 10) + 2000; // 假设是2000年后
                    } else {
                        // 四位数年份
                        [, year, month, day] = match;
                    }
                    break;
            }

            // 转换为数字
            year = parseInt(year, 10);
            month = parseInt(month, 10) - 1; // JavaScript月份从0开始
            day = parseInt(day, 10);
            hour = parseInt(hour, 10);
            minute = parseInt(minute, 10);

            // 创建日期对象
            const date = new Date(year, month, day, hour, minute);
            if (!isNaN(date.getTime())) {
                return date.getTime();
            }
        }
    }

    // 如果无法解析，返回0
    return 0;
}

/**
 * 解析时间字符串为时间戳，支持时间段的中点排序
 * 支持混合时间格式：完整日期时间、仅日期、仅时间、时间段
 * @param {string} timeStr 时间字符串
 * @returns {number} 时间戳（毫秒），对于时间段返回中点时间戳
 */
export function parseTimeForSorting(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') {
        return 0;
    }

    // 尝试匹配时间段格式，例如 "24年4月11日 周四 08:23 ~ 24年4月22日 周一 18:40"
    const timeRangeMatch = timeStr.match(/(.*?)\s*~\s*(.*)/);
    if (timeRangeMatch) {
        // 如果是时间段，计算中点时间
        const startTimeStr = timeRangeMatch[1].trim();
        const endTimeStr = timeRangeMatch[2].trim();

        const startTime = parseTime(startTimeStr);
        const endTime = parseTime(endTimeStr);

        // 如果开始时间和结束时间都有效，计算中点
        if (startTime > 0 && endTime > 0) {
            return (startTime + endTime) / 2;
        }
        // 如果只有开始时间有效，使用开始时间
        else if (startTime > 0) {
            return startTime;
        }
        // 如果只有结束时间有效，使用结束时间
        else if (endTime > 0) {
            return endTime;
        }
        // 如果都无法解析，返回0
        else {
            return 0;
        }
    }

    // 如果不是时间段，使用原有的parseTime逻辑
    return parseTime(timeStr);
}

/**
 * 判断字符串是否可以转换为数值
 * @param {string} str 要检查的字符串
 * @returns {boolean} 是否可以转换为数值
 */
export function isNumeric(str) {
    if (typeof str !== 'string') {
        return false;
    }
    // 检查是否是数字字符串（整数或小数）
    return !isNaN(str) && !isNaN(parseFloat(str));
}

/**
 * 通用模块排序方法
 * 按照主标识符排序，如果主标识符不完整或为空，尝试使用备用标识符排序
 * 如果标识符是时间类型，按时间排序
 * 如果主标识符和备用标识符都不能数值化（时间除外），则按messageIndex排序
 * @param {Array} modules 模块数组
 * @returns {Array} 排序后的模块数组
 */
export function sortModules(modules) {
    // debugLog('[SortModules]', '开始排序模块，模块数量:', modules.length);
    return modules.sort((a, b) => {
        // debugLog('[SortModules]', '比较模块:', a.moduleName, 'vs', b.moduleName, 'messageIndex:', a.messageIndex, 'vs', b.messageIndex);
        // 获取模块A的标识符信息
        let aIdentifierValue = '';
        let isATimeIdentifier = false;
        let hasAValidIdentifier = false;
        if (a.moduleConfig) {
            // 检查是否有主标识符
            const aPrimaryIdentifiers = a.moduleConfig.variables
                .filter(variable => variable.isMainIdentifier || variable.isIdentifier);

            if (aPrimaryIdentifiers.length > 0) {
                // debugLog('[SortModules]', '模块A有主标识符:', aPrimaryIdentifiers.map(v => v.name).join(', '));
                // 收集主标识符的值
                const aPrimaryValues = aPrimaryIdentifiers.map(variable => {
                    // 检查是否是time变量
                    if (variable.name.toLowerCase().includes('time')) {
                        isATimeIdentifier = true;
                    }
                    return a.variables[variable.name] || '';
                });

                // 如果主标识符有值，使用它们的组合
                if (aPrimaryValues.some(val => val)) {
                    aIdentifierValue = aPrimaryValues.join('__');
                    hasAValidIdentifier = true;
                    // debugLog('[SortModules]', '模块A使用主标识符值:', aIdentifierValue, '是时间标识符:', isATimeIdentifier);
                } else {
                    // debugLog('[SortModules]', '模块A主标识符无值，尝试备用标识符');
                    // 主标识符没有值，尝试使用备用标识符
                    const aBackupIdentifiers = a.moduleConfig.variables
                        .filter(variable => variable.isBackupIdentifier);

                    if (aBackupIdentifiers.length > 0) {
                        const aBackupValues = aBackupIdentifiers.map(variable => {
                            // 检查是否是time变量
                            if (variable.name.toLowerCase().includes('time')) {
                                isATimeIdentifier = true;
                            }
                            return a.variables[variable.name] || '';
                        });

                        if (aBackupValues.some(val => val)) {
                            aIdentifierValue = aBackupValues.join('__');
                            hasAValidIdentifier = true;
                            // debugLog('[SortModules]', '模块A使用备用标识符值:', aIdentifierValue, '是时间标识符:', isATimeIdentifier);
                        }
                    }
                }
            } else {
                // debugLog('[SortModules]', '模块A无主标识符，尝试备用标识符');
                // 没有主标识符，尝试使用备用标识符
                const aBackupIdentifiers = a.moduleConfig.variables
                    .filter(variable => variable.isBackupIdentifier);

                if (aBackupIdentifiers.length > 0) {
                    const aBackupValues = aBackupIdentifiers.map(variable => {
                        // 检查是否是time变量
                        if (variable.name.toLowerCase().includes('time')) {
                            isATimeIdentifier = true;
                        }
                        return a.variables[variable.name] || '';
                    });

                    if (aBackupValues.some(val => val)) {
                        aIdentifierValue = aBackupValues.join('__');
                        hasAValidIdentifier = true;
                        // debugLog('[SortModules]', '模块A使用备用标识符值:', aIdentifierValue, '是时间标识符:', isATimeIdentifier);
                    }
                }
            }
        }

        if (!hasAValidIdentifier) {
            // debugLog('[SortModules]', '模块A无有效标识符');
        }

        // 获取模块B的标识符信息
        let bIdentifierValue = '';
        let isBTimeIdentifier = false;
        let hasBValidIdentifier = false;
        if (b.moduleConfig) {
            // 检查是否有主标识符
            const bPrimaryIdentifiers = b.moduleConfig.variables
                .filter(variable => variable.isMainIdentifier || variable.isIdentifier);

            if (bPrimaryIdentifiers.length > 0) {
                // debugLog('[SortModules]', '模块B有主标识符:', bPrimaryIdentifiers.map(v => v.name).join(', '));
                // 收集主标识符的值
                const bPrimaryValues = bPrimaryIdentifiers.map(variable => {
                    // 检查是否是time变量
                    if (variable.name.toLowerCase().includes('time')) {
                        isBTimeIdentifier = true;
                    }
                    return b.variables[variable.name] || '';
                });

                // 如果主标识符有值，使用它们的组合
                if (bPrimaryValues.some(val => val)) {
                    bIdentifierValue = bPrimaryValues.join('__');
                    hasBValidIdentifier = true;
                    // debugLog('[SortModules]', '模块B使用主标识符值:', bIdentifierValue, '是时间标识符:', isBTimeIdentifier);
                } else {
                    // debugLog('[SortModules]', '模块B主标识符无值，尝试备用标识符');
                    // 主标识符没有值，尝试使用备用标识符
                    const bBackupIdentifiers = b.moduleConfig.variables
                        .filter(variable => variable.isBackupIdentifier);

                    if (bBackupIdentifiers.length > 0) {
                        const bBackupValues = bBackupIdentifiers.map(variable => {
                            // 检查是否是time变量
                            if (variable.name.toLowerCase().includes('time')) {
                                isBTimeIdentifier = true;
                            }
                            return b.variables[variable.name] || '';
                        });

                        if (bBackupValues.some(val => val)) {
                            bIdentifierValue = bBackupValues.join('__');
                            hasBValidIdentifier = true;
                            // debugLog('[SortModules]', '模块B使用备用标识符值:', bIdentifierValue, '是时间标识符:', isBTimeIdentifier);
                        }
                    }
                }
            } else {
                // debugLog('[SortModules]', '模块B无主标识符，尝试备用标识符');
                // 没有主标识符，尝试使用备用标识符
                const bBackupIdentifiers = b.moduleConfig.variables
                    .filter(variable => variable.isBackupIdentifier);

                if (bBackupIdentifiers.length > 0) {
                    const bBackupValues = bBackupIdentifiers.map(variable => {
                        // 检查是否是time变量
                        if (variable.name.toLowerCase().includes('time')) {
                            isBTimeIdentifier = true;
                        }
                        return b.variables[variable.name] || '';
                    });

                    if (bBackupValues.some(val => val)) {
                        bIdentifierValue = bBackupValues.join('__');
                        hasBValidIdentifier = true;
                        // debugLog('[SortModules]', '模块B使用备用标识符值:', bIdentifierValue, '是时间标识符:', isBTimeIdentifier);
                    }
                }
            }
        }

        if (!hasBValidIdentifier) {
            // debugLog('[SortModules]', '模块B无有效标识符');
        }

        // 如果双方都有标识符，但都不能数值化（时间除外），则按messageIndex排序
        if (hasAValidIdentifier && hasBValidIdentifier &&
            !isATimeIdentifier && !isBTimeIdentifier &&
            !isNumeric(aIdentifierValue) && !isNumeric(bIdentifierValue)) {
            // debugLog('[SortModules]', '决策: 双方都有非数值标识符，按messageIndex排序');
            return a.messageIndex - b.messageIndex;
        }

        // 处理时间类型的标识符 - 只在同模块内进行时间排序
        if (isATimeIdentifier && isBTimeIdentifier && a.moduleName === b.moduleName) {
            const aTime = parseTimeForSorting(aIdentifierValue);
            const bTime = parseTimeForSorting(bIdentifierValue);
            // debugLog('[SortModules]', '决策: 时间类型标识符排序，A时间:', aTime, 'B时间:', bTime, '差值:', aTime - bTime);
            return aTime - bTime;
        }

        // 处理数值类型的标识符
        if (hasAValidIdentifier && hasBValidIdentifier &&
            isNumeric(aIdentifierValue) && isNumeric(bIdentifierValue)) {
            const aNum = parseFloat(aIdentifierValue);
            const bNum = parseFloat(bIdentifierValue);
            // debugLog('[SortModules]', '决策: 数值类型标识符排序，A值:', aNum, 'B值:', bNum, '差值:', aNum - bNum);
            return aNum - bNum;
        }

        // 处理普通标识符
        if (hasAValidIdentifier && hasBValidIdentifier) {
            const compareResult = aIdentifierValue.localeCompare(bIdentifierValue);
            // debugLog('[SortModules]', '决策: 普通标识符排序，A值:', aIdentifierValue, 'B值:', bIdentifierValue, '比较结果:', compareResult);
            return compareResult;
        }

        // 如果只有一个模块有标识符值，有标识符的排在前面
        if (hasAValidIdentifier && !hasBValidIdentifier) {
            // debugLog('[SortModules]', '决策: 只有模块A有标识符，A排在前面');
            return -1;
        }
        if (!hasAValidIdentifier && hasBValidIdentifier) {
            // debugLog('[SortModules]', '决策: 只有模块B有标识符，B排在前面');
            return 1;
        }

        // 没有标识符的模块按messageIndex排序
        // debugLog('[SortModules]', '决策: 双方都无标识符，按messageIndex排序，A:', a.messageIndex, 'B:', b.messageIndex, '差值:', a.messageIndex - b.messageIndex);
        return a.messageIndex - b.messageIndex;
    });
}

/**
 * 将模块按模块名和标识符分组
 * @param {Array} modules 标准化后的模块数组
 * @returns {Object} 分组后的模块对象
 */
export function groupModulesByIdentifier(modules) {
    const groups = {};

    modules.forEach(module => {
        // 使用标准化后的模块名
        const moduleName = module.moduleName;
        let identifier = 'default';

        if (module.moduleConfig) {
            // 获取模块配置中的主标识符
            const primaryIdentifiers = module.moduleConfig.variables
                .filter(variable => variable.isMainIdentifier || variable.isIdentifier)
                .map(variable => variable.name);

            // 获取模块配置中的备用标识符
            const backupIdentifiers = module.moduleConfig.variables
                .filter(variable => variable.isBackupIdentifier)
                .map(variable => variable.name);

            // 优先使用主标识符
            if (primaryIdentifiers.length > 0) {
                // 收集所有主标识符的值，并使用新的解析工具处理多值
                const identifierValues = primaryIdentifiers.map(id => {
                    const value = module.variables[id];
                    return value !== undefined ? IdentifierParser.parseMultiValues(value) : undefined;
                });

                // 如果所有主标识符都有值，使用它们的规范化组合作为标识符
                if (identifierValues.every(values => values !== undefined && values.length > 0)) {
                    // 对每个标识符的多值进行排序并合并，确保相同组合产生相同标识符
                    const normalizedValues = identifierValues.map(values =>
                        values.sort().join('|')
                    );
                    identifier = normalizedValues.join('__');
                } else {
                    // 主标识符不完整，尝试使用备用标识符
                    if (backupIdentifiers.length > 0) {
                        // 收集所有备用标识符的值，并使用新的解析工具处理多值
                        const backupValues = backupIdentifiers.map(id => {
                            const value = module.variables[id];
                            return value !== undefined ? IdentifierParser.parseMultiValues(value) : undefined;
                        });

                        // 如果所有备用标识符都有值，使用它们的规范化组合作为标识符
                        if (backupValues.every(values => values !== undefined && values.length > 0)) {
                            const normalizedValues = backupValues.map(values =>
                                values.sort().join('|')
                            );
                            identifier = normalizedValues.join('__');
                        } else {
                            // 否则，使用所有变量值的组合作为标识符
                            const allValues = Object.values(module.variables).join('__');
                            identifier = allValues || 'default';
                        }
                    } else {
                        // 没有备用标识符，使用所有变量值的组合作为标识符
                        const allValues = Object.values(module.variables).join('__');
                        identifier = allValues || 'default';
                    }
                }
            } else if (backupIdentifiers.length > 0) {
                // 没有主标识符，使用备用标识符
                // 收集所有备用标识符的值，并使用新的解析工具处理多值
                const backupValues = backupIdentifiers.map(id => {
                    const value = module.variables[id];
                    return value !== undefined ? IdentifierParser.parseMultiValues(value) : undefined;
                });

                // 如果所有备用标识符都有值，使用它们的规范化组合作为标识符
                if (backupValues.every(values => values !== undefined && values.length > 0)) {
                    const normalizedValues = backupValues.map(values =>
                        values.sort().join('|')
                    );
                    identifier = normalizedValues.join('__');
                } else {
                    // 否则，使用所有变量值的组合作为标识符
                    const allValues = Object.values(module.variables).join('__');
                    identifier = allValues || 'default';
                }
            } else {
                // 没有主标识符和备用标识符时，使用'default'作为标识符
                // 这样同一模块的所有实例会分到同一组，然后按messageIndex排序
                identifier = 'default';
            }
        } else {
            // 没有模块配置时，使用'default'作为标识符
            identifier = 'default';
        }

        // 使用特殊分隔符构建组键
        const groupKey = `__MODULE_GROUP__${moduleName}__IDENTIFIER__${identifier}__`;

        // 添加到分组
        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }
        groups[groupKey].push(module);
    });

    return groups;
}

/**
 * 构建变量名映射表
 * @param {Object} moduleConfig 模块配置
 * @returns {Object} 变量名映射表（兼容变量名 -> 当前变量名）
 */
export function buildVariableNameMap(moduleConfig) {
    const variableNameMap = {};

    if (!moduleConfig || !moduleConfig.variables) return variableNameMap;

    moduleConfig.variables.forEach(variable => {
        // 主变量名
        variableNameMap[variable.name] = variable.name;

        // 兼容变量名 - 使用新的标识符解析工具处理多值分隔符
        if (variable.compatibleVariableNames) {
            // const compatibleNames = IdentifierParser.parseMultiValues(variable.compatibleVariableNames);
            variable.compatibleVariableNames.forEach(name => {
                variableNameMap[name] = variable.name;
            });
        }
    });

    return variableNameMap;
}

/**
 * 按顺序合并模块
 * @param {Array} modules 模块数组
 * @param {Object} moduleConfig 模块配置
 * @returns {Object} 合并后的模块数据
 */
export function mergeModulesByOrder(modules, moduleConfig) {
    // 初始化合并结果
    const merged = {
        moduleName: modules[0].moduleName,
        variables: {}
    };

    // 构建变量名映射表
    const variableNameMap = buildVariableNameMap(moduleConfig);

    // 首先用第一个模块的所有变量初始化合并结果
    if (modules.length > 0) {
        const firstModule = modules[0];
        Object.keys(firstModule.variables).forEach(key => {
            merged.variables[key] = firstModule.variables[key] || '';
        });
    }

    // 然后依次处理后续模块，只更新非空值
    modules.slice(1).forEach(module => {
        // 使用标准化后的模块数据
        merged.moduleName = module.moduleName;

        // 处理每个变量，只更新非空值
        Object.keys(module.variables).forEach(key => {
            const value = module.variables[key];

            // 只有当值不为空或undefined时才更新
            if (value !== '' && value !== undefined) {
                merged.variables[key] = value;
            }
            // 空值不覆盖之前的非空值
        });
    });

    return merged;
}

/**
 * 构建模块字符串
 * @param {Object} moduleData 模块数据
 * @param {Object} moduleConfig 模块配置
 * @returns {string} 模块字符串
 */
export function buildModuleString(moduleData, moduleConfig) {
    let moduleStr = `[${moduleData.moduleName}`;

    // 如果有模块配置，按配置的变量顺序构建
    if (moduleConfig && moduleConfig.variables) {
        moduleConfig.variables.forEach(variable => {
            const value = moduleData.variables[variable.name] || '';
            moduleStr += `|${variable.name}:${value}`;
        });
    } else {
        // 没有配置时，按变量名顺序构建
        Object.keys(moduleData.variables).sort().forEach(key => {
            const value = moduleData.variables[key] || '';
            moduleStr += `|${key}:${value}`;
        });
    }

    moduleStr += ']';
    return moduleStr;
}

/**
 * 智能补全id变量
 * 对于有id变量但值为空的模块条目，根据备用标识符智能补全id
 * @param {Array} modules 排序后的模块数组
 */
export function completeIdVariables(modules) {
    debugLog('[IdCompletion] 开始智能补全id变量，模块数量:', modules.length);

    // 按模块名分组
    const moduleGroups = {};
    modules.forEach(module => {
        const moduleName = module.moduleName;
        if (!moduleGroups[moduleName]) {
            moduleGroups[moduleName] = [];
        }
        moduleGroups[moduleName].push(module);
    });

    // 处理每个模块组
    Object.entries(moduleGroups).forEach(([moduleName, moduleList]) => {
        debugLog(`[IdCompletion] 处理模块组 ${moduleName}，包含 ${moduleList.length} 个模块`);

        // 检查该模块是否有id变量
        const hasIdVariable = moduleList.some(module => {
            return module.moduleConfig && module.moduleConfig.variables.some(variable => variable.name === 'id');
        });

        if (!hasIdVariable) {
            debugLog(`[IdCompletion] 模块 ${moduleName} 没有id变量，跳过处理`);
            return;
        }

        // 获取模块配置
        const moduleConfig = moduleList[0].moduleConfig;

        // 获取备用标识符
        const backupIdentifiers = moduleConfig.variables
            .filter(variable => variable.isBackupIdentifier)
            .map(variable => variable.name);

        // 记录已处理的备用标识符组合和对应的id
        const identifierIdMap = new Map();
        let currentId = 1;

        // 处理每个模块条目
        moduleList.forEach(module => {
            let currentIdValue = module.variables.id || '';

            // 如果id值为空，需要补全
            if (!currentIdValue) {
                // 生成备用标识符组合
                let backupKey = '';
                if (backupIdentifiers.length > 0) {
                    backupKey = backupIdentifiers.map(identifier => module.variables[identifier] || '').join('__');
                }

                // 如果有备用标识符，检查是否已存在
                if (backupKey) {
                    if (identifierIdMap.has(backupKey)) {
                        // 已存在，使用相同的id
                        currentIdValue = identifierIdMap.get(backupKey);
                        debugLog(`[IdCompletion] 模块 ${moduleName} 使用已存在的id ${currentIdValue}，备用标识符: ${backupKey}`);
                    } else {
                        // 不存在，生成新id
                        currentIdValue = String(currentId).padStart(3, '0');
                        identifierIdMap.set(backupKey, currentIdValue);
                        currentId++;
                        debugLog(`[IdCompletion] 模块 ${moduleName} 生成新id ${currentIdValue}，备用标识符: ${backupKey}`);
                    }
                } else {
                    // 没有备用标识符，直接递增生成id
                    currentIdValue = String(currentId).padStart(3, '0');
                    currentId++;
                    debugLog(`[IdCompletion] 模块 ${moduleName} 生成新id ${currentIdValue}，无备用标识符`);
                }

                // 更新模块的id值
                module.variables.id = currentIdValue;
            }
        });
    });

    debugLog('[IdCompletion] 智能补全id变量完成');
}

/**
 * 解析单个变量部分，支持嵌套模块
 * @param {string} part 单个变量部分，如 "own:所属人"
 * @param {Object} variablesMap 变量映射表
 * @param {Object} variableNameMap 变量名映射表（兼容变量名 -> 当前变量名）
 */
export function parseSingleVariableInProcess(part, variablesMap, variableNameMap) {
    if (!part) return;

    let colonIndex = -1;
    let inNestedModule = 0;

    // 找到第一个顶级冒号
    for (let i = 0; i < part.length; i++) {
        const char = part[i];

        if (char === '[') {
            inNestedModule++;
        } else if (char === ']') {
            inNestedModule--;
        } else if (char === ':' && inNestedModule === 0) {
            colonIndex = i;
            break;
        }
    }

    if (colonIndex === -1) return;

    const varName = part.substring(0, colonIndex).trim();
    const varValue = part.substring(colonIndex + 1).trim();

    if (varName && varValue) {
        // 检查变量名是否在映射表中
        if (variableNameMap.hasOwnProperty(varName)) {
            const currentVarName = variableNameMap[varName];
            variablesMap[currentVarName] = varValue;
        } else {
            // 处理兼容变量名的精确匹配
            for (const [compatName, currentName] of Object.entries(variableNameMap)) {
                if (varName === compatName) {
                    variablesMap[currentName] = varValue;
                    break;
                }
            }
        }
    }
}

/**
 * HTML转义函数 - 将特殊字符转换为HTML实体，确保标签显示为文本
 * @param {string} text - 需要转义的文本
 * @returns {string} 转义后的文本
 */
export function htmlEscape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 处理提取的模块数据（用于提取楼层范围模块按钮，支持多选）
 * @param {Array} modules 提取到的模块数组
 * @param {Array} selectedModuleNames 选中的模块名数组
 * @returns {string} 处理后的模块字符串
 */
export function processExtractedModules(modules, selectedModuleNames) {
    // 标准化模块数据
    const normalizedModules = normalizeModules(modules);

    // 过滤出选中的模块（支持多选）
    const filteredModules = normalizedModules.filter(module => {
        // 如果没有选择任何模块，显示所有模块
        if (!selectedModuleNames || selectedModuleNames.length === 0) {
            return true;
        }
        // 如果选择了模块，只显示选中的模块
        return selectedModuleNames.includes(module.moduleName);
    });

    // 构建处理后的模块字符串
    const processedModules = filteredModules.map(module => {
        if (!module.moduleConfig) {
            // 没有模块配置，返回原始内容
            return module.raw;
        }

        // 构建当前模块的字符串
        let moduleString = `[${module.moduleName}`;

        // 按照模块配置中的变量顺序添加变量
        module.moduleConfig.variables.forEach(variable => {
            // 获取变量值
            let varValue = module.variables[variable.name] || '';

            moduleString += `|${variable.name}:${varValue}`;
        });

        moduleString += ']';

        return moduleString;
    });

    // 返回所有处理后的模块，用换行符分隔
    return processedModules.join('\n');
}

/**
 * 自动根据模块配置判断处理方式
 * @param {Array} rawModules 原始模块数组
 * @param {Array} selectedModuleNames 选中的模块名数组
 * @param {boolean} showModuleNames 是否显示模块名
 * @param {boolean} showProcessInfo 是否显示处理方式说明
 * @returns {Object} 按模块名分组的结构化数据
 */
export function processAutoModules(rawModules, selectedModuleNames, showModuleNames = false, showProcessInfo = false) {
    debugLog('开始自动处理模块');

    // 标准化模块数据
    const modules = normalizeModules(rawModules);

    // 过滤出选中的模块（支持多选）
    const filteredModules = modules.filter(module => {
        // 如果没有选择任何模块，显示所有模块
        if (!selectedModuleNames || selectedModuleNames.length === 0) {
            return true;
        }
        // 如果选择了模块，只显示选中的模块
        return selectedModuleNames.includes(module.moduleName);
    });

    // 按模块名分组
    const moduleGroups = {};
    filteredModules.forEach(module => {
        if (!moduleGroups[module.moduleName]) {
            moduleGroups[module.moduleName] = [];
        }
        moduleGroups[module.moduleName].push(module);
    });

    // 处理每个模块组并返回结构化数据
    const structuredResult = {};

    Object.keys(moduleGroups).forEach(moduleName => {
        const moduleGroup = moduleGroups[moduleName];
        const moduleConfig = moduleGroup[0]?.moduleConfig;
        let processType = 'full';
        let resultData;

        if (!moduleConfig) {
            // 没有模块配置，使用全量处理
            processType = 'full_without_config';
            resultData = moduleGroup.map(module => module.raw);
        } else {
            // 获取模块的outputMode配置
            const outputMode = moduleConfig.outputMode || 'full';
            processType = outputMode;

            // 根据outputMode选择处理方式
            if (outputMode === 'incremental') {
                // 增量处理
                resultData = processIncrementalModules(moduleGroup);
            } else {
                // 全量处理（默认）
                resultData = processFullModules(moduleGroup);
            }
        }

        structuredResult[moduleName] = {
            processType: processType,
            data: resultData,
            moduleCount: moduleGroup.length
        };
    });

    return structuredResult;
}

/**
 * 将结构化的模块数据转换为字符串
 * @param {Object} structuredModules 按模块名分组的结构化数据
 * @param {boolean} showModuleNames 是否显示模块名
 * @param {boolean} showProcessInfo 是否显示处理信息
 * @returns {string} 转换后的模块字符串
 */
export function buildModulesString(structuredModules, showModuleNames = false, showProcessInfo = false) {
    let result = '';

    // 处理每个模块组
    Object.keys(structuredModules).forEach(moduleName => {
        const moduleData = structuredModules[moduleName];
        const { processType, data } = moduleData;

        if (showModuleNames) {
            result += `## ${moduleName}\n`;
        }

        if (showProcessInfo) {
            let processInfo = '';
            switch (processType) {
                case 'incremental':
                    processInfo = '(增量处理)';
                    break;
                case 'full_without_config':
                    processInfo = '(全量处理 - 无配置)';
                    break;
                default:
                    processInfo = '(全量处理)';
            }
            result += `${processInfo}\n`;
        }

        // 根据数据类型处理
        if (Array.isArray(data)) {
            // 处理结构化条目数组
            data.forEach(item => {
                result += `${item.moduleString || item}\n`;
            });
        } else if (typeof data === 'string') {
            // 处理字符串
            result += data + '\n\n';
        }

        result += '\n';
    });

    return result.trim();
}

/**
 * 处理增量更新模块
 * @param {Array} modules 标准化后的模块数组
 * @returns {Array} 结构化的增量更新模块条目数组
 */
export function processIncrementalModules(modules) {
    // 按模块名和标识符分组处理
    const moduleGroups = groupModulesByIdentifier(modules);

    // 构建结果数组
    const resultItems = [];

    // 转换模块组为数组，以便排序
    const moduleGroupsArray = Object.entries(moduleGroups);

    // 对模块组进行排序（使用每个组的第一个模块来确定排序）
    moduleGroupsArray.sort(([keyA, modulesA], [keyB, modulesB]) => {
        // 使用第一个模块作为代表进行排序
        const moduleA = modulesA[0];
        const moduleB = modulesB[0];

        // 直接比较messageIndex即可，因为模块已经在标准化阶段排序过
        return moduleA.messageIndex - moduleB.messageIndex;
    });

    // 处理每个排序后的模块组
    for (const [moduleKey, moduleList] of moduleGroupsArray) {
        // 解析模块名和标识符（使用特殊分隔符）
        const match = moduleKey.match(/^__MODULE_GROUP__(.*?)__IDENTIFIER__(.*?)__$/);
        if (!match) continue;
        const [, moduleName, identifier] = match;

        // 获取模块配置
        const moduleConfig = moduleList[0].moduleConfig;

        // 只处理outputMode为"incremental"的模块
        if (moduleConfig && moduleConfig.outputMode === 'incremental') {
            // 统合处理模块
            const mergedModule = mergeModulesByOrder(moduleList, moduleConfig);

            // 检查是否需要隐藏该模块条目
            let shouldHide = false;
            for (const variable of moduleConfig.variables) {
                if (variable.isHideCondition) {
                    const variableValue = mergedModule.variables[variable.name];
                    if (variableValue) {
                        // 使用新的标识符解析工具分割隐藏条件值（支持中英文逗号、分号分隔）
                        // const hideValues = IdentifierParser.parseMultiValues(variable.hideConditionValues);
                        // 修改为包含判断：只要variableValue包含任一条件值即可
                        if (variable.hideConditionValues.some(hideValue => variableValue.includes(hideValue))) {
                            shouldHide = true;
                            break;
                        }
                    }
                }
            }

            // 如果不需要隐藏，则构建模块条目
            if (!shouldHide) {
                // 构建统合后的模块字符串
                const moduleString = buildModuleString(mergedModule, moduleConfig);

                // 添加结构化条目到结果数组
                resultItems.push({
                    moduleName,
                    identifier,
                    moduleData: mergedModule,
                    moduleString
                });
            }
        }
    }

    return resultItems;
}

/**
 * 统一处理模块数据（支持多选）
 * @param {Object} extractParams 提取参数对象，包含startIndex, endIndex, moduleFilters
 * @param {string} processType 处理类型：'extract' | 'processed' | 'incremental' | 'full' | 'auto'
 * @param {Array} selectedModuleNames 选中的模块名数组，用于在处理阶段过滤已提取的模块
 * @param {boolean} returnString 是否返回字符串（默认：true），如果为false则返回结构化数据
 * @param {boolean} showModuleNames 是否显示模块名
 * @param {boolean} showProcessInfo 是否显示处理方式说明
 * @returns {Promise<Object>} 包含处理结果和显示信息的对象
 *
 * 注意：extractParams.moduleFilters和selectedModuleNames的区别：
 * - moduleFilters: 在提取阶段使用，是一个包含{name, compatibleModuleNames}的数组，用于从聊天记录中过滤出特定类型的模块
 * - selectedModuleNames: 在处理阶段使用，是一个字符串数组，只包含模块名，用于从已提取的模块中选择需要处理的模块
 */
export async function processModuleData(extractParams, processType, selectedModuleNames, returnString = false, showModuleNames = false, showProcessInfo = false) {
    try {
        debugLog(`开始处理模块数据，类型：${processType}`);

        // 提取参数验证
        if (!extractParams || typeof extractParams !== 'object') {
            throw new Error('提取参数无效');
        }

        let { startIndex, endIndex, moduleFilters } = extractParams;

        // 如果moduleFilters为null，则加载全部模块，不需要添加时间标准模块
        if (moduleFilters !== null) {
            // 添加所有激活了时间参考标准的模块到moduleFilters中
            const modulesData = configManager.getModules() || [];
            if (modulesData && Array.isArray(modulesData)) {
                // 创建一个Set来存储所有需要包含的模块名，避免重复
                const modulesToInclude = new Set();

                // 首先添加原有的moduleFilters中的模块
                if (moduleFilters && Array.isArray(moduleFilters)) {
                    moduleFilters.forEach(filter => {
                        modulesToInclude.add(filter.name);
                    });
                } else {
                    moduleFilters = [];
                }

                // 添加所有激活了时间参考标准的模块
                modulesData.forEach(module => {
                    if (module.timeReferenceStandard) {
                        modulesToInclude.add(module.name);
                    }
                });

                // 更新moduleFilters，确保包含所有需要的模块
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

        // 提取模块数据
        const rawModules = await extractModules(startIndex, endIndex, moduleFilters);

        let resultContent = '';
        let displayTitle = '';
        let modules = [];

        // 根据处理类型选择不同的处理逻辑
        switch (processType) {
            case 'extract':
                // 调用独立的原生模块处理函数
                const extractResult = processExtractModules(rawModules, selectedModuleNames, returnString);
                resultContent = extractResult.resultContent;
                displayTitle = extractResult.displayTitle;
                break;

            case 'processed':
                // 调用独立的标准化模块处理函数
                const processedResult = processProcessedModules(rawModules, selectedModuleNames, returnString);
                resultContent = processedResult.resultContent;
                displayTitle = processedResult.displayTitle;
                break;

            case 'auto':
                // 自动根据模块配置判断处理方式
                const structuredResult = processAutoModules(rawModules, selectedModuleNames, showModuleNames, showProcessInfo);

                // 如果需要返回字符串，则转换结构化数据
                // if (returnString) {
                //     resultContent = buildModulesString(structuredResult, showModuleNames, showProcessInfo);
                // } else {
                resultContent = structuredResult;
                // }
                displayTitle = '自动处理模块结果';
                break;

            default:
                throw new Error(`不支持的处理类型：${processType}`);
        }

        // 判断是否有内容
        let hasContent = false;
        if (typeof resultContent === 'string') {
            hasContent = resultContent.trim().length > 0;
        } else if (Array.isArray(resultContent)) {
            hasContent = resultContent.length > 0;
        } else if (resultContent && typeof resultContent === 'object') {
            hasContent = Object.keys(resultContent).length > 0;
        }

        // 构建字符串表示
        let contentString = resultContent;
        if (typeof resultContent !== 'string') {
            contentString = buildModulesString(resultContent, showModuleNames, showProcessInfo);
        }

        return {
            success: true,
            content: resultContent, // 原始内容（可能是结构化数据或字符串）
            contentString: contentString, // 字符串表示
            displayTitle: displayTitle,
            moduleCount: modules.length,
            hasContent: hasContent
        };

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
 * 处理全量更新模块
 * @param {Array} modules 标准化后的模块数组
 * @returns {Array} 结构化的全量更新模块条目数组
 */
export function processFullModules(modules) {
    // 首先按模块名分组，使retainLayers在所有标识符的模块上工作
    const modulesByModuleName = {};
    modules.forEach(module => {
        const moduleName = module.moduleName;
        if (!modulesByModuleName[moduleName]) {
            modulesByModuleName[moduleName] = [];
        }
        modulesByModuleName[moduleName].push(module);
    });

    // 构建结果数组
    const resultItems = [];

    // 处理每个模块名组
    for (const [moduleName, allModulesOfName] of Object.entries(modulesByModuleName)) {
        // 获取模块配置
        const moduleConfig = allModulesOfName[0]?.moduleConfig;
        if (!moduleConfig || moduleConfig.outputMode !== 'full') continue;

        // 调试日志：输出模块配置和保留层数
        debugLog(`处理模块：${moduleName}`);
        // debugLog(`模块配置：${JSON.stringify(moduleConfig)}`);

        // 获取retainLayers值（默认为-1，表示无限）
        const retainLayers = moduleConfig.retainLayers === undefined ? -1 : parseInt(moduleConfig.retainLayers, 10);
        debugLog(`retainLayers值：${retainLayers}`);

        let filteredModules = allModulesOfName;
        debugLog(`原始模块数量：${allModulesOfName.length}`);
        debugLog(`模块messageIndex列表：${allModulesOfName.map(m => m.messageIndex).join(', ')}`);

        // 根据retainLayers值决定显示的模块 - 按楼层而不是条数，在所有标识符的模块上应用
        if (retainLayers === 0) {
            // 0表示不保留任何模块
            filteredModules = [];
            debugLog(`retainLayers为0，不显示任何模块`);
        } else if (retainLayers > 0) {
            // 大于0表示只保留最近的retainLayers个楼层的模块
            debugLog(`retainLayers大于0，开始过滤`);

            // 1. 按楼层分组所有该模块名的模块（跨标识符）
            const modulesByFloor = {};
            allModulesOfName.forEach(module => {
                const floor = module.messageIndex;
                if (!modulesByFloor[floor]) {
                    modulesByFloor[floor] = [];
                }
                modulesByFloor[floor].push(module);
            });
            debugLog(`按楼层分组结果：${JSON.stringify(modulesByFloor)}`);

            // 2. 获取所有楼层并按倒序排列（最近的楼层在前）
            const floors = Object.keys(modulesByFloor).map(Number).sort((a, b) => b - a);
            debugLog(`所有楼层（倒序）：${floors.join(', ')}`);

            // 3. 选择最近的retainLayers个楼层
            const selectedFloors = floors.slice(0, retainLayers);
            debugLog(`选择的楼层：${selectedFloors.join(', ')}`);

            // 4. 收集这些楼层中的所有模块，并按楼层倒序排列
            filteredModules = [];
            selectedFloors.forEach(floor => {
                // 每个楼层内的模块按出现顺序排列
                filteredModules.push(...modulesByFloor[floor]);
            });
            debugLog(`过滤后的模块数量：${filteredModules.length}`);
            debugLog(`过滤后的模块messageIndex列表：${filteredModules.map(m => m.messageIndex).join(', ')}`);
        } else {
            // -1或其他负值表示显示所有模块
            debugLog(`retainLayers为-1或负值，显示所有模块`);
        }

        // 对过滤后的模块按标识符分组
        const moduleGroups = groupModulesByIdentifier(filteredModules);

        // 处理每个标识符组
        for (const [moduleKey, moduleList] of Object.entries(moduleGroups)) {
            // 解析标识符
            const match = moduleKey.match(/^__MODULE_GROUP__(.*?)__IDENTIFIER__(.*?)__$/);
            if (!match) continue;
            const [, , identifier] = match;

            debugLog(`处理模块组：${moduleName}，标识符：${identifier}`);

            // 处理每个模块
            for (const module of moduleList) {
                // 检查是否需要隐藏该模块条目
                let shouldHide = false;
                for (const variable of moduleConfig.variables) {
                    if (variable.isHideCondition) {
                        const variableValue = module.variables[variable.name];
                        if (variableValue) {
                            // 使用新的标识符解析工具分割隐藏条件值（支持中英文逗号、分号分隔）
                            // const hideValues = IdentifierParser.parseMultiValues(variable.hideConditionValues);
                            // 修改为包含判断：只要variableValue包含任一条件值即可
                            if (variable.hideConditionValues.some(hideValue => variableValue.includes(hideValue))) {
                                shouldHide = true;
                                break;
                            }
                        }
                    }
                }

                // 如果不需要隐藏，则构建模块条目
                if (!shouldHide) {
                    // 构建模块字符串
                    const moduleString = buildModuleString(module, moduleConfig);

                    // 添加结构化条目到结果数组
                    resultItems.push({
                        moduleName,
                        identifier,
                        moduleData: module,
                        moduleString
                    });
                }
            }
        }
    }

    return resultItems;
}
// }



