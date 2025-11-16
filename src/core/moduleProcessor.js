// 模块数据处理器 - 独立管理模块数据的文本处理方法
import { debugLog, errorLog, getModulesData } from '../index.js';
import { ModuleExtractor } from './moduleExtractor.js';

/**
 * 模块数据处理器类
 */
export class ModuleProcessor {
    constructor() {
        this.moduleExtractor = new ModuleExtractor();
    }

    /**
     * 提取模块数据
     * @param {number} startIndex 起始索引
     * @param {number} endIndex 结束索引
     * @param {Object} moduleFilter 模块过滤条件
     * @returns {Array} 提取到的原始模块数组
     */
    extractModules(startIndex, endIndex, moduleFilter) {
        return this.moduleExtractor.extractModulesFromChat(/\[.*?\|.*?\]/g, startIndex, endIndex, moduleFilter);
    }

    /**
     * 标准化模块数据，处理兼容模块名和兼容变量
     * @param {Array} modules 提取到的原始模块数组
     * @returns {Array} 标准化后的模块数组
     */
    normalizeModules(modules) {
        const modulesData = getModulesData();
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
                    const compatibleNames = configModule.compatibleModuleNames.split(',').map(name => name.trim());
                    return compatibleNames.includes(originalModuleName);
                }
                return false;
            });

            if (moduleConfig) {
                // 构建变量名映射（兼容变量名 -> 当前变量名）
                const variableNameMap = this.buildVariableNameMap(moduleConfig);

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
                        this.parseSingleVariableInProcess(varPart, normalizedVariables, variableNameMap);
                        lastPipePos = i + 1;
                    }
                }

                // 处理最后一个变量部分
                const lastPart = content.substring(lastPipePos).trim();
                this.parseSingleVariableInProcess(lastPart, normalizedVariables, variableNameMap);

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
        this.completeTimeVariables(normalizedModules);

        // 第三步：对模块进行排序
        return this.sortModules(normalizedModules);
    }

    /**
     * 智能补全time变量
     * 对于time变量为空或只有时分的模块，根据同一条message内其他模块的time变量来补足
     * @param {Array} modules 标准化后的模块数组
     */
    completeTimeVariables(modules) {
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

        // 第二步：为每组message中的模块补全time变量
        Object.values(messageModulesMap).forEach(messageModules => {
            // 查找该message中包含完整time信息的模块
            let referenceTime = null;
            let referenceTimeStr = '';

            // 先找到有完整年月日的time变量
            for (const module of messageModules) {
                if (module.variables && module.variables.time) {
                    const timeVal = module.variables.time;
                    const parsedTime = this.parseTime(timeVal);

                    // 检查是否是完整的年月日时间
                    if (parsedTime > 0) {
                        const date = new Date(parsedTime);
                        // 如果时间包含年月日（不是只有时分）
                        if (date.getFullYear() > 1970 && date.getMonth() >= 0 && date.getDate() > 0) {
                            referenceTime = parsedTime;
                            referenceTimeStr = timeVal;
                            break;
                        }
                    }
                }
            }

            // 如果找到了参考时间，为其他模块补全
            if (referenceTime) {
                for (const module of messageModules) {
                    if (module.variables && module.variables.time !== undefined) {
                        const timeVal = module.variables.time;

                        // 如果time变量为空或只有时分
                        if (!timeVal || /^\d{1,2}:\d{1,2}$/.test(timeVal)) {
                            if (!timeVal) {
                                // time为空，直接使用参考时间
                                module.variables.time = referenceTimeStr;
                            } else {
                                // 只有时分，需要合并到参考时间的年月日
                                const timeParts = timeVal.split(':');
                                const hours = parseInt(timeParts[0], 10);
                                const minutes = parseInt(timeParts[1], 10);

                                // 创建新的时间对象，使用参考时间的年月日和当前模块的时分
                                const referenceDate = new Date(referenceTime);
                                const newDate = new Date(referenceDate.getFullYear(),
                                    referenceDate.getMonth(),
                                    referenceDate.getDate(),
                                    hours, minutes);

                                // 格式化回与参考时间相同的格式
                                module.variables.time = this.formatTimeToSamePattern(referenceTimeStr, newDate);
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * 根据参考时间字符串的格式，格式化新的时间对象
     * @param {string} referenceTimeStr 参考时间字符串
     * @param {Date} date 要格式化的时间对象
     * @returns {string} 格式化后的时间字符串
     */
    formatTimeToSamePattern(referenceTimeStr, date) {
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
    parseTime(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') {
            return 0;
        }

        // 尝试匹配时间段格式，例如 "24年4月11日 周四 08:23 ~ 24年4月22日 周一 18:40"
        const timeRangeMatch = timeStr.match(/(.*?)\s*~\s*(.*)/);
        if (timeRangeMatch) {
            // 如果是时间段，取开始时间
            timeStr = timeRangeMatch[1].trim();
        }

        // 尝试匹配各种时间格式
        const patterns = [
            // 格式：2023年09月30日 21:30
            /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})$/,
            // 格式：24年4月11日 08:23
            /^(\d{2})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})$/,
            // 格式：2023-09-30 21:30
            /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/,
            // 格式：2023/09/30 21:30
            /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/,
            // 格式：2023年09月30日
            /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
            // 格式：24年4月11日
            /^(\d{2})年(\d{1,2})月(\d{1,2})日$/,
            // 格式：2023-09-30
            /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
            // 格式：2023/09/30
            /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
            // 格式：08:23
            /^(\d{1,2}):(\d{1,2})$/,
        ];

        for (const pattern of patterns) {
            const match = timeStr.match(pattern);
            if (match) {
                let year, month, day, hour = 0, minute = 0;

                switch (match.length) {
                    case 4: // 时间格式：HH:MM
                        [, hour, minute] = match;
                        year = new Date().getFullYear();
                        month = new Date().getMonth() + 1;
                        day = new Date().getDate();
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
     * 判断字符串是否可以转换为数值
     * @param {string} str 要检查的字符串
     * @returns {boolean} 是否可以转换为数值
     */
    isNumeric(str) {
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
    sortModules(modules) {
        return modules.sort((a, b) => {
            // 获取模块A的标识符信息
            let aIdentifierValue = '';
            let isATimeIdentifier = false;
            let hasAValidIdentifier = false;
            if (a.moduleConfig) {
                // 检查是否有主标识符
                const aPrimaryIdentifiers = a.moduleConfig.variables
                    .filter(variable => variable.isMainIdentifier || variable.isIdentifier);

                if (aPrimaryIdentifiers.length > 0) {
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
                    } else {
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
                            }
                        }
                    }
                } else {
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
                        }
                    }
                }
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
                    } else {
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
                            }
                        }
                    }
                } else {
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
                        }
                    }
                }
            }

            // 如果双方都有标识符，但都不能数值化（时间除外），则按messageIndex排序
            if (hasAValidIdentifier && hasBValidIdentifier &&
                !isATimeIdentifier && !isBTimeIdentifier &&
                !this.isNumeric(aIdentifierValue) && !this.isNumeric(bIdentifierValue)) {
                return a.messageIndex - b.messageIndex;
            }

            // 处理时间类型的标识符 - 只在同模块内进行时间排序
            if (isATimeIdentifier && isBTimeIdentifier && a.moduleName === b.moduleName) {
                const aTime = this.parseTime(aIdentifierValue);
                const bTime = this.parseTime(bIdentifierValue);
                return aTime - bTime;
            }

            // 处理数值类型的标识符
            if (hasAValidIdentifier && hasBValidIdentifier &&
                this.isNumeric(aIdentifierValue) && this.isNumeric(bIdentifierValue)) {
                return parseFloat(aIdentifierValue) - parseFloat(bIdentifierValue);
            }

            // 处理普通标识符
            if (hasAValidIdentifier && hasBValidIdentifier) {
                return aIdentifierValue.localeCompare(bIdentifierValue);
            }

            // 如果只有一个模块有标识符值，有标识符的排在前面
            if (hasAValidIdentifier && !hasBValidIdentifier) {
                return -1;
            }
            if (!hasAValidIdentifier && hasBValidIdentifier) {
                return 1;
            }

            // 没有标识符的模块按messageIndex排序
            return a.messageIndex - b.messageIndex;
        });
    }

    /**
     * 将模块按模块名和标识符分组
     * @param {Array} modules 标准化后的模块数组
     * @returns {Object} 分组后的模块对象
     */
    groupModulesByIdentifier(modules) {
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
                    // 收集所有主标识符的值
                    const identifierValues = primaryIdentifiers.map(id => {
                        return module.variables[id] || undefined;
                    });

                    // 如果所有主标识符都有值，使用它们的组合作为标识符
                    if (identifierValues.every(value => value !== undefined)) {
                        identifier = identifierValues.join('__');
                    } else {
                        // 主标识符不完整，尝试使用备用标识符
                        if (backupIdentifiers.length > 0) {
                            // 收集所有备用标识符的值
                            const backupValues = backupIdentifiers.map(id => {
                                return module.variables[id] || undefined;
                            });

                            // 如果所有备用标识符都有值，使用它们的组合作为标识符
                            if (backupValues.every(value => value !== undefined)) {
                                identifier = backupValues.join('__');
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
                    // 收集所有备用标识符的值
                    const backupValues = backupIdentifiers.map(id => {
                        return module.variables[id] || undefined;
                    });

                    // 如果所有备用标识符都有值，使用它们的组合作为标识符
                    if (backupValues.every(value => value !== undefined)) {
                        identifier = backupValues.join('__');
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
    buildVariableNameMap(moduleConfig) {
        const variableNameMap = {};

        if (!moduleConfig || !moduleConfig.variables) return variableNameMap;

        moduleConfig.variables.forEach(variable => {
            // 主变量名
            variableNameMap[variable.name] = variable.name;

            // 兼容变量名
            if (variable.compatibleVariableNames) {
                const compatibleNames = variable.compatibleVariableNames.split(',').map(name => name.trim());
                compatibleNames.forEach(name => {
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
    mergeModulesByOrder(modules, moduleConfig) {
        // 初始化合并结果
        const merged = {
            moduleName: modules[0].moduleName,
            variables: {}
        };

        // 构建变量名映射表
        const variableNameMap = this.buildVariableNameMap(moduleConfig);

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
    buildModuleString(moduleData, moduleConfig) {
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
     * 解析单个变量部分，支持嵌套模块
     * @param {string} part 单个变量部分，如 "own:所属人"
     * @param {Object} variablesMap 变量映射表
     * @param {Object} variableNameMap 变量名映射表（兼容变量名 -> 当前变量名）
     */
    parseSingleVariableInProcess(part, variablesMap, variableNameMap) {
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
    htmlEscape(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 处理提取的模块数据（用于提取楼层范围模块按钮）
     * @param {Array} modules 提取到的模块数组
     * @param {string} selectedModuleName 选中的模块名
     * @returns {string} 处理后的模块字符串
     */
    processExtractedModules(modules, selectedModuleName) {
        // 标准化模块数据
        const normalizedModules = this.normalizeModules(modules);

        // 过滤出选中的模块
        const filteredModules = normalizedModules.filter(module => {
            return !selectedModuleName || module.moduleName === selectedModuleName;
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
     * 处理增量更新模块
     * @param {Array} modules 标准化后的模块数组
     * @returns {string} 增量更新模块字符串
     */
    processIncrementalModules(modules) {
        // 按模块名和标识符分组处理
        const moduleGroups = this.groupModulesByIdentifier(modules);

        // 构建结果显示内容
        let resultContent = '';

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
                const mergedModule = this.mergeModulesByOrder(moduleList, moduleConfig);

                // 检查是否需要隐藏该模块条目
                let shouldHide = false;
                for (const variable of moduleConfig.variables) {
                    if (variable.isHideCondition) {
                        const variableValue = mergedModule.variables[variable.name];
                        if (variableValue) {
                            // 分割隐藏条件值（支持逗号分隔）
                            const hideValues = variable.hideConditionValues.split(',').map(v => v.trim());
                            // 修改为包含判断：只要variableValue包含任一条件值即可
                            if (hideValues.some(hideValue => variableValue.includes(hideValue))) {
                                shouldHide = true;
                                break;
                            }
                        }
                    }
                }

                // 如果不需要隐藏，则构建模块字符串
                if (!shouldHide) {
                    // 构建统合后的模块字符串
                    const mergedModuleStr = this.buildModuleString(mergedModule, moduleConfig);

                    // 添加到结果内容
                    resultContent += `${mergedModuleStr}\n`;
                }
            }
        }

        return resultContent;
    }

    /**
     * 处理全量更新模块
     * @param {Array} modules 标准化后的模块数组
     * @returns {string} 全量更新模块字符串
     */
    processFullModules(modules) {
        // 首先按模块名分组，使retainLayers在所有标识符的模块上工作
        const modulesByModuleName = {};
        modules.forEach(module => {
            const moduleName = module.moduleName;
            if (!modulesByModuleName[moduleName]) {
                modulesByModuleName[moduleName] = [];
            }
            modulesByModuleName[moduleName].push(module);
        });

        // 构建结果显示内容
        let resultContent = '';

        // 处理每个模块名组
        for (const [moduleName, allModulesOfName] of Object.entries(modulesByModuleName)) {
            // 获取模块配置
            const moduleConfig = allModulesOfName[0]?.moduleConfig;
            if (!moduleConfig || moduleConfig.outputMode !== 'full') continue;

            // 调试日志：输出模块配置和保留层数
            debugLog(`处理模块：${moduleName}`);
            debugLog(`模块配置：${JSON.stringify(moduleConfig)}`);

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
            const moduleGroups = this.groupModulesByIdentifier(filteredModules);

            // 处理每个标识符组
            for (const [moduleKey, moduleList] of Object.entries(moduleGroups)) {
                // 解析标识符
                const match = moduleKey.match(/^__MODULE_GROUP__(.*?)__IDENTIFIER__(.*?)__$/);
                if (!match) continue;
                const [, , identifier] = match;

                debugLog(`处理模块组：${moduleName}，标识符：${identifier}`);

                // 格式化输出每个模块
                const formattedModulesStr = moduleList.map(module => {
                    // 检查是否需要隐藏该模块条目
                    let shouldHide = false;
                    for (const variable of moduleConfig.variables) {
                        if (variable.isHideCondition) {
                            const variableValue = module.variables[variable.name];
                            if (variableValue) {
                                // 分割隐藏条件值（支持逗号分隔）
                                const hideValues = variable.hideConditionValues.split(',').map(v => v.trim());
                                // 修改为包含判断：只要variableValue包含任一条件值即可
                                if (hideValues.some(hideValue => variableValue.includes(hideValue))) {
                                    shouldHide = true;
                                    break;
                                }
                            }
                        }
                    }

                    // 如果不需要隐藏，则构建模块字符串
                    if (!shouldHide) {
                        return this.buildModuleString(module, moduleConfig);
                    }
                    return null;
                }).filter(Boolean).join('\n');

                // 添加到结果内容
                if (formattedModulesStr) {
                    resultContent += `${formattedModulesStr}\n`;
                }
            }
        }

        return resultContent;
    }
}
