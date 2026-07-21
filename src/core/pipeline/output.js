// 输出构建管线步骤
import configManager from '../../singleton/configManager.js';
import { debugLog } from '../../utils/logger.js';
import { IdentifierParser } from '../../utils/identifierParser.js';
import { formatIdValue } from '../../utils/numberParser.js';
import { normalizeModules } from './normalize.js';

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
 * 将模块按模块名和标识符分组
 * @param {Array} modules 标准化后的模块数组
 * @returns {Object} 分组后的模块对象
 */
export function groupModulesByIdentifier(modules, needSort = false) {
    const groups = {};
    const modulesData = configManager.getModules() || [];

    modules.forEach(module => {
        const moduleName = module.moduleName;
        let identifier = 'default';

        const moduleConfig = modulesData.find(config => config.name === moduleName);

        if (moduleConfig) {
            const primaryIdentifiers = moduleConfig.variables
                .filter(variable => variable.isMainIdentifier || variable.isIdentifier)
                .map(variable => variable.name);

            const backupIdentifiers = moduleConfig.variables
                .filter(variable => variable.isBackupIdentifier)
                .map(variable => variable.name);

            if (primaryIdentifiers.length > 0) {
                const identifierValues = primaryIdentifiers.map(id => {
                    const value = module.variables[id];
                    return value !== undefined ? IdentifierParser.parseMultiValues(value) : undefined;
                });

                if (identifierValues.every(values => values !== undefined && values.length > 0)) {
                    const normalizedValues = identifierValues.map(values =>
                        values.sort().join('|')
                    );
                    identifier = normalizedValues.join('__');
                } else {
                    if (backupIdentifiers.length > 0) {
                        const backupValues = backupIdentifiers.map(id => {
                            const value = module.variables[id];
                            return value !== undefined ? IdentifierParser.parseMultiValues(value) : undefined;
                        });

                        if (backupValues.every(values => values !== undefined && values.length > 0)) {
                            const normalizedValues = backupValues.map(values =>
                                values.sort().join('|')
                            );
                            identifier = normalizedValues.join('__');
                        } else {
                            const allValues = Object.values(module.variables).join('__');
                            identifier = allValues || 'default';
                        }
                    } else {
                        const allValues = Object.values(module.variables).join('__');
                        identifier = allValues || 'default';
                    }
                }
            } else if (backupIdentifiers.length > 0) {
                const backupValues = backupIdentifiers.map(id => {
                    const value = module.variables[id];
                    return value !== undefined ? IdentifierParser.parseMultiValues(value) : undefined;
                });

                if (backupValues.every(values => values !== undefined && values.length > 0)) {
                    const normalizedValues = backupValues.map(values =>
                        values.sort().join('|')
                    );
                    identifier = normalizedValues.join('__');
                } else {
                    const allValues = Object.values(module.variables).join('__');
                    identifier = allValues || 'default';
                }
            } else {
                identifier = 'default';
            }
        } else {
            identifier = 'default';
        }

        const groupKey = `__MODULE_GROUP__${moduleName}__IDENTIFIER__${identifier}__`;

        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }
        groups[groupKey].push(module);
    });

    if (needSort) {
        Object.keys(groups).forEach(groupKey => {
            groups[groupKey].sort((a, b) => {
                const aIndex = a.messageIndex || 0;
                const bIndex = b.messageIndex || 0;
                return aIndex - bIndex;
            });
        });
    }

    return groups;
}

/**
 * 按顺序合并模块
 * @param {Array} modules 模块数组
 * @returns {Object} 合并后的模块数据
 */
export function mergeModulesByOrder(modules) {
    if (modules.length === 0) {
        return null;
    }

    const lastModule = modules[modules.length - 1];
    const merged = {
        ...lastModule,
        variables: {},
        timeline: []
    };

    let cumulativeVariables = {};
    let hasTimeVar = false;
    let lastTimeData = undefined;
    let lastTimeString = undefined;

    modules.forEach((module, index) => {
        const currentVariables = { ...cumulativeVariables };
        const lastVariables = { ...cumulativeVariables };
        const changedKeys = [];

        Object.keys(module.variables).forEach(key => {
            let value = module.variables[key];

            if (value !== '' && value !== undefined) {
                let canSave = true;
                if (key === 'time') {
                    hasTimeVar = true;
                }
                if (hasTimeVar && key === 'time') {
                    if (lastTimeString === undefined && module.variables[key] && module.variables[key].trim() !== '') {
                        lastTimeString = module.variables[key].trim();
                    }
                    if (lastTimeData === undefined && module.timeData !== undefined && module.timeData.isValid && module.timeData.isComplete) {
                        lastTimeData = module.timeData;
                        lastTimeString = module.variables[key].trim();
                    }
                    else if (module.isAddTime === undefined || (module.isAddTime != undefined && !module.isAddTime)) {
                        lastTimeData = module.timeData;
                        lastTimeString = module.variables[key].trim();
                    }
                    else if (module.isAddTime !== undefined && module.isAddTime) {
                        module.timeData = lastTimeData !== undefined ? lastTimeData : module.timeData;
                        module.variables[key] = lastTimeString !== undefined ? lastTimeString : module.variables[key];
                        value = lastTimeString !== undefined ? lastTimeString : value;
                        canSave = false;
                    }
                }

                if (currentVariables[key] !== value && canSave) {
                    changedKeys.push(key);
                }
                currentVariables[key] = value;
                cumulativeVariables[key] = value;
            }
        });

        if (changedKeys.length > 0) {
            merged.timeline.push({
                moduleName: module.moduleName,
                messageIndex: module.messageIndex || 0,
                messageIndexHistory: module.messageIndexHistory || [module.messageIndex],
                raw: module.raw || '',
                processedRaw: module.processedRaw || '',
                nestedInfo: module.nestedInfo,
                variables: { ...currentVariables },
                lastVariables: { ...lastVariables },
                changedKeys: changedKeys,
            });
        }
    });

    merged.variables = cumulativeVariables;

    debugLog('[ModuleMerge] 合并后的模块数据:', merged);
    return merged;
}

/**
 * 构建模块字符串
 * @param {Object} moduleData 模块数据
 * @param {Object} moduleConfig 模块配置
 * @param {boolean} isIncremental 是否增量模式
 * @returns {string} 模块字符串
 */
export function buildModuleString(moduleData, moduleConfig, isIncremental = false) {
    let moduleStr = `[${moduleData.moduleName}`;

    if (moduleConfig && moduleConfig.variables) {
        if (isIncremental) {
            const identifierVariables = moduleConfig.variables.filter(variable => variable.isIdentifier);
            const backupIdentifierVariables = moduleConfig.variables.filter(variable => variable.isBackupIdentifier);
            const variablesToInclude = [...identifierVariables, ...backupIdentifierVariables];

            const changedKeys = moduleData.changedKeys || [];

            const includedVariables = new Set();

            variablesToInclude.forEach(variable => {
                includedVariables.add(variable.name);
            });

            changedKeys.forEach(key => {
                includedVariables.add(key);
            });

            moduleConfig.variables.forEach(variable => {
                if (includedVariables.has(variable.name)) {
                    let value = String(moduleData.variables[variable.name] !== undefined ? moduleData.variables[variable.name] : '') || '';
                    if (variable.name === 'id') {
                        value = formatIdValue(value);
                    }
                    moduleStr += `|${variable.name}:${value}`;
                }
            });
        } else {
            moduleConfig.variables.forEach(variable => {
                let value = String(moduleData.variables[variable.name] !== undefined ? moduleData.variables[variable.name] : '') || '';
                if (variable.name === 'id') {
                    value = formatIdValue(value);
                }
                moduleStr += `|${variable.name}:${value}`;
            });
        }
    } else {
        Object.keys(moduleData.variables).sort().forEach(key => {
            const value = String(moduleData.variables[key] !== undefined ? moduleData.variables[key] : '') || '';
            moduleStr += `|${key}:${value}`;
        });
    }

    moduleStr += ']';
    return moduleStr;
}

/**
 * 将结构化的模块数据转换为字符串
 * @param {Object} structuredModules 按模块名分组的结构化数据
 * @param {boolean} showModuleNames 是否显示模块名
 * @param {boolean} showProcessInfo 是否显示处理信息
 * @returns {string} 转换后的模块字符串
 */
export function buildModulesString(structuredModules, showModuleNames = false, showProcessInfo = false, showRule = false) {
    let result = '';

    const allModuleConfigs = configManager.getModules() || [];
    const sortedModuleConfigs = [...allModuleConfigs].sort((a, b) => (a.order || 0) - (b.order || 0));

    sortedModuleConfigs.forEach(moduleConfig => {
        const moduleName = moduleConfig.name;
        const moduleData = structuredModules[moduleName];

        if (moduleData) {
            const { processType, data } = moduleData;

            result += getModuleDataRuleString(moduleConfig, moduleData, processType, showModuleNames, showProcessInfo, showRule);

            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (!item.shouldHide) {
                        if (showProcessInfo) {
                            result += `#${item.moduleData.messageIndex} `;
                        }
                        result += `${item.moduleString || item}\n`;
                    }
                });
                result += '\n';
            } else if (typeof data === 'string') {
                result += data + '\n\n';
            }

        } else if (!showProcessInfo) {
            result += getModuleDataRuleString(moduleConfig, moduleData, null, showModuleNames, showProcessInfo, showRule);
        }
    });

    return result.trim();
}

/**
 * 获取模块数据规则字符串
 */
function getModuleDataRuleString(moduleConfig, moduleData, processType, showModuleNames, showProcessInfo, showRule) {
    let result = '';
    const showAllRules = false;
    if (showModuleNames) {
        if (!showAllRules && (moduleConfig.outputPosition === 'body' || moduleConfig.outputPosition === 'body_surround' || moduleConfig.outputPosition === 'specific_position')) {
            return result;
        }
        result += `${configManager.MODULE_TITLE_LEFT}${moduleConfig.name}${moduleConfig.displayName ? ` (${moduleConfig.displayName})` : ""}${configManager.MODULE_TITLE_RIGHT}\n`;
        result += `> stats:count=${moduleData?.moduleCount || 0}`;
        const hasIdVariable = moduleConfig.variables && moduleConfig.variables.some(variable => variable.name === 'id');
        if (moduleData && (moduleData.isIncremental && hasIdVariable && moduleData.maxId !== undefined)) {
            result += `,next_id=${moduleData.maxId + 1}`;
        }
        else if (hasIdVariable) {
            result += `,next_id=1`;
        }
        if (showProcessInfo && processType) {
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
            result += `${processInfo}`;
        }
        result += `\n`;
        if (!showProcessInfo && showRule) {
            result += `> [INSTRUCTION]\n`;
            if (moduleConfig.contentPrompt) {
                result += `> usage:${moduleConfig.contentPrompt}\n`;
            }
            if (moduleConfig.prompt) {
                result += `> requirement:${moduleConfig.prompt}\n`;
            }

            let formatPrompt = '';
            if (moduleConfig.variables && moduleConfig.variables.length > 0) {
                const variableDescriptions = moduleConfig.variables.map(variable => {
                    const variableName = variable.name;
                    const variableDesc = variable.description ? `${variable.description}` : '';
                    return `${module.outputMode === 'full' ? '' : variable.isIdentifier ? '*' : variable.isBackupIdentifier ? '^' : ''}${variableName}:${variableDesc}`;
                }).join('|');
                formatPrompt += `[${moduleConfig.name}|${variableDescriptions}]\n`;
            } else {
                formatPrompt += `[${moduleConfig.name}]\n`;
            }
            result += `> format:${formatPrompt}`;
        }
    }
    result += moduleData ? '' : '\n';
    return result;
}

/**
 * 处理原生模块提取
 */
export function processExtractModules(rawModules, selectedModuleNames, returnString) {
    const modules = rawModules;

    // 提升到过滤回调外，避免每个模块都深拷贝全部模块 + 解析绑定
    const modulesData = configManager.getModules() || [];
    const filteredModules = modules.filter(module => {
        if (!selectedModuleNames || selectedModuleNames.length === 0) {
            return true;
        }

        const originalModuleName = module.raw.slice(1, module.raw.indexOf('|') > 0 ? module.raw.indexOf('|') : module.raw.length - 1);

        return selectedModuleNames.some(selectedModuleName => {
            if (selectedModuleName === originalModuleName) {
                return true;
            }

            const moduleConfig = modulesData.find(configModule => configModule.name === selectedModuleName);
            if (moduleConfig && moduleConfig.compatibleModuleNames) {
                return moduleConfig.compatibleModuleNames.includes(originalModuleName);
            }

            return false;
        });
    });

    let resultContent = '';
    const displayTitle = '原生模块提取结果';

    resultContent = filteredModules.map(module => module.raw).join('\n');

    return { resultContent, displayTitle };
}

/**
 * 处理标准化后的模块
 */
export function processProcessedModules(rawModules, selectedModuleNames, returnString) {
    const moduleGroups = normalizeModules(rawModules, selectedModuleNames);

    const filteredModules = Object.values(moduleGroups).flat();

    let resultContent = '';
    const displayTitle = '整理后模块结果';

    // 提升到 map 回调外，避免每个模块都解析绑定
    const modulesData = configManager.getModules() || [];
    const processedModules = filteredModules.map(module => {
        // 使用有效模块配置（含角色/聊天绑定的变量级覆盖），
        // 使被禁用的变量不进入最终注入提示词。
        // 使用有效模块配置（含角色/聊天绑定的模块级/变量级覆盖），
        // 禁用的变量/模块已在 getModules() 源头过滤。
        const moduleConfig = modulesData.find(config => config.name === module.moduleName);

        if (!moduleConfig) {
            return module.raw;
        }

        let moduleString = `[${module.moduleName}`;

        moduleConfig.variables.forEach(variable => {
            let varValue = module.variables[variable.name] || '';
            moduleString += `|${variable.name}:${varValue}`;
        });

        moduleString += ']';

        return moduleString;
    });

    resultContent = processedModules.join('\n');

    return { resultContent, displayTitle };
}

/**
 * 处理增量更新模块
 */
export function processIncrementalModules(modules, moduleConfig) {
    const moduleGroups = groupModulesByIdentifier(modules, true);

    const resultItems = [];

    let maxId = 0;
    const hasIdVariable = moduleConfig.variables.some(variable => variable.name === 'id');

    const moduleGroupsArray = Object.entries(moduleGroups);

    moduleGroupsArray.sort(([keyA, modulesA], [keyB, modulesB]) => {
        const moduleA = modulesA[0];
        const moduleB = modulesB[0];

        if (hasIdVariable) {
            const idValueA = moduleA.variables.id;
            if (idValueA) {
                const idNumA = parseInt(idValueA, 10);
                if (!isNaN(idNumA) && idNumA > maxId) {
                    maxId = idNumA;
                }
            }
            const idValueB = moduleB.variables.id;
            if (idValueB) {
                const idNumB = parseInt(idValueB, 10);
                if (!isNaN(idNumB) && idNumB > maxId) {
                    maxId = idNumB;
                }
            }
        }

        return moduleA.messageIndex - moduleB.messageIndex;
    });

    debugLog('处理增量更新模块', moduleGroupsArray);

    // 提升到循环外，避免每组都深拷贝全部模块 + 解析绑定
    const modulesData = configManager.getModules() || [];
    for (const [moduleKey, moduleList] of moduleGroupsArray) {
        const match = moduleKey.match(/^__MODULE_GROUP__(.*?)__IDENTIFIER__(.*?)__$/);
        if (!match) continue;
        const [, moduleName, identifier] = match;

        const currentModuleConfig = modulesData.find(config => config.name === moduleName);

        if (currentModuleConfig && currentModuleConfig.outputMode === 'incremental') {
            debugLog('处理增量更新模块', moduleName + ':' + identifier, '合并模块按顺序', moduleList);

            const mergedModule = mergeModulesByOrder(moduleList, currentModuleConfig);
            mergedModule.isIncremental = true;

            let shouldHide = false;
            for (const variable of currentModuleConfig.variables) {
                if (variable.isHideCondition) {
                    const variableValue = mergedModule.variables[variable.name];
                    if (variableValue) {
                        if (variable.hideConditionValues.some(hideValue => variableValue.includes(hideValue))) {
                            shouldHide = true;
                            break;
                        }
                    }
                }
            }

            const moduleString = buildModuleString(mergedModule, currentModuleConfig);
            mergedModule.shouldHide = shouldHide;
            mergedModule.moduleString = moduleString;

            mergedModule.timeline.forEach(module => {
                module.shouldHide = shouldHide;
                module.moduleString = buildModuleString(module, currentModuleConfig, true);
            });

            resultItems.push({
                moduleName,
                identifier,
                moduleData: mergedModule,
                moduleString,
                maxId: maxId > 0 ? maxId : 1,
                shouldHide: shouldHide,
            });
        }
    }

    return resultItems;
}

/**
 * 处理全量更新模块
 */
export function processFullModules(modules) {
    const modulesByModuleName = {};
    modules.forEach(module => {
        const moduleName = module.moduleName;
        if (!modulesByModuleName[moduleName]) {
            modulesByModuleName[moduleName] = [];
        }
        modulesByModuleName[moduleName].push(module);
    });

    const resultItems = [];

    // 提升到循环外，避免每组都解析绑定
    const modulesData = configManager.getModules() || [];
    for (const [moduleName, allModulesOfName] of Object.entries(modulesByModuleName)) {
        const moduleConfig = modulesData.find(config => config.name === moduleName);
        if (!moduleConfig || moduleConfig.outputMode !== 'full') continue;

        debugLog(`处理模块：${moduleName}`);

        const retainLayers = moduleConfig.retainLayers === undefined ? -1 : parseInt(moduleConfig.retainLayers, 10);
        debugLog(`retainLayers值：${retainLayers}`);

        let filteredModules = allModulesOfName;
        debugLog(`原始模块数量：${allModulesOfName.length}`);
        debugLog(`模块messageIndex列表：${allModulesOfName.map(m => m.messageIndex).join(', ')}`);
        const maxMessageIndex = Math.max(...allModulesOfName.map(m => m.messageIndex));
        debugLog(`最大messageIndex：${maxMessageIndex}`);
        filteredModules.forEach(module => {
            module.shouldHide = false;
            if (retainLayers === 0) {
                module.shouldHide = true;
            } else if (retainLayers > 0) {
                module.shouldHide = module.messageIndex < maxMessageIndex - retainLayers;
            }
        });

        const moduleGroups = groupModulesByIdentifier(filteredModules);

        for (const [moduleKey, moduleList] of Object.entries(moduleGroups)) {
            const match = moduleKey.match(/^__MODULE_GROUP__(.*?)__IDENTIFIER__(.*?)__$/);
            if (!match) continue;
            const [, , identifier] = match;

            debugLog(`处理模块组：${moduleName}，标识符：${identifier}`);

            for (const module of moduleList) {
                let shouldHide = module.shouldHide !== undefined ? module.shouldHide : false;
                if (!shouldHide) {
                    for (const variable of moduleConfig.variables) {
                        if (variable.isHideCondition) {
                            const variableValue = module.variables[variable.name];
                            if (variableValue) {
                                if (variable.hideConditionValues.some(hideValue => variableValue.includes(hideValue))) {
                                    shouldHide = true;
                                    break;
                                }
                            }
                        }
                    }
                }

                const moduleString = buildModuleString(module, moduleConfig);
                module.shouldHide = shouldHide;
                module.moduleString = moduleString;

                resultItems.push({
                    moduleName,
                    identifier,
                    moduleData: module,
                    moduleString,
                    shouldHide: shouldHide
                });
            }
        }
    }

    return resultItems;
}

/**
 * 自动根据模块配置判断处理方式
 */
export function processAutoModules(rawModules, selectedModuleNames) {
    debugLog('开始自动处理模块');

    const moduleGroups = normalizeModules(rawModules, selectedModuleNames);

    const structuredResult = {};

    // 提升到循环外，避免每组都解析绑定
    const modulesData = configManager.getModules() || [];
    Object.keys(moduleGroups).forEach(moduleName => {
        const moduleGroup = moduleGroups[moduleName];

        const moduleConfig = modulesData.find(config => config.name === moduleName);

        let processType = 'full';
        let resultData;

        if (moduleConfig) {
            const outputMode = moduleConfig.outputMode || 'full';
            processType = outputMode;

            if (outputMode === 'incremental') {
                resultData = processIncrementalModules(moduleGroup, moduleConfig);
            } else {
                resultData = processFullModules(moduleGroup);
            }

            let maxId = null;
            debugLog(`处理模块获取maxId：`, resultData);
            if (processType === 'incremental' && Array.isArray(resultData) && resultData.length > 0) {
                const maxIds = resultData.map(item => item.maxId).filter(id => id !== null);
                if (maxIds.length > 0) {
                    maxId = Math.max(...maxIds);
                }
            }

            structuredResult[moduleName] = {
                processType: processType,
                data: resultData,
                moduleCount: Array.isArray(resultData) ? resultData.filter(item => !item.shouldHide).length : resultData.length,
                moduleConfig: moduleConfig,
                isIncremental: processType === 'incremental',
                maxId: maxId,
            };
        }

    });

    return structuredResult;
}
