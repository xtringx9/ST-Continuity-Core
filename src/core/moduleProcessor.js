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

        return normalizedModules;
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
                    // 没有主标识符和备用标识符时，使用所有变量值的组合作为标识符
                    const allValues = Object.values(module.variables).join('__');
                    identifier = allValues || 'default';
                }
            } else {
                // 没有模块配置时，使用所有变量值的组合作为标识符
                const allValues = Object.values(module.variables).join('__');
                identifier = allValues || 'default';
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

        // 处理每个模块组
        for (const [moduleKey, moduleList] of Object.entries(moduleGroups)) {
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
