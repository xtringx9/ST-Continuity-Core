// 标准化管线步骤
import configManager from '../../singleton/configManager.js';
import { debugLog } from '../../utils/logger.js';
import { removeHyphens, removeSpecialSymbols } from '../../utils/stringUtils.js';
import { tryParseNumber } from '../../utils/numberParser.js';
import { deduplicateModules } from './deduplicate.js';
import { attachStructuredTimeData, completeTimeVariables } from './time.js';
import { sortModules, completeIdVariables, processLevelVariables } from './sort.js';

/**
 * 构建变量名映射表
 * @param {Object} moduleConfig 模块配置
 * @returns {Object} 变量名映射表（兼容变量名 -> 当前变量名）
 */
export function buildVariableNameMap(moduleConfig) {
    const variableNameMap = {};

    if (!moduleConfig || !moduleConfig.variables) return variableNameMap;

    moduleConfig.variables.forEach(variable => {
        variableNameMap[variable.name] = variable.name;

        if (variable.compatibleVariableNames) {
            variable.compatibleVariableNames.forEach(name => {
                variableNameMap[name] = variable.name;
            });
        }
    });

    return variableNameMap;
}

/**
 * 解析单个变量部分，支持嵌套模块
 * @param {string} part 单个变量部分，如 "own:所属人"
 * @param {Object} variablesMap 变量映射表
 * @param {Object} variableNameMap 变量名映射表（兼容变量名 -> 当前变量名）
 */
export function parseSingleVariableInProcess(part, variablesMap, variableNameMap, module, moduleConfig) {
    if (!part) return;

    let colonIndex = -1;
    let inNestedModule = 0;

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

    const varName = removeSpecialSymbols(part.substring(0, colonIndex).trim());
    const varValue = part.substring(colonIndex + 1).trim();

    const isNestedVar = module.nestedInfo ? module.nestedInfo.nestedVariables.includes(varName) : false;

    if (varName && varValue) {
        const currentVarName = variableNameMap[varName];
        if (variableNameMap.hasOwnProperty(varName)) {
            const isNoNormalize = configManager.getVariableByModuleConfig(moduleConfig, currentVarName)?.isNoNormalize;
            let finalValue = (!isNoNormalize && !isNestedVar && currentVarName !== 'time' && currentVarName !== 'id' && currentVarName !== 'log') ? removeHyphens(varValue) : varValue;
            if (currentVarName === 'id') {
                finalValue = tryParseNumber(varValue);
            }
            variablesMap[currentVarName] = finalValue;
        }
        else {
            debugLog(`[parseSingleVariableInProcess] ${moduleConfig.name} 中变量 ${varName} 未映射到任何变量名`);
        }
    }
}

/**
 * 标准化模块数据，处理兼容模块名和兼容变量
 * @param {Array} modules 提取到的原始模块数组
 * @param {Array} selectedModuleNames 选中的模块名称数组（可选）
 * @returns {Object} 按模块名分组的标准化模块对象
 */
export function normalizeModules(modules, selectedModuleNames = []) {
    const modulesData = configManager.getModules() || [];
    const normalizedModules = [];

    // 第一步：标准化所有模块
    modules.forEach(module => {
        const [originalModuleName, ...parts] = module.raw.slice(1, -1).split('|');
        const moduleName = removeSpecialSymbols(originalModuleName.trim());

        let isValid = false;
        const originalVariables = {};
        parts.forEach(part => {
            const colonIndex = part.indexOf(':');
            if (colonIndex === -1) return;

            const key = removeSpecialSymbols(part.substring(0, colonIndex).trim());
            const value = part.substring(colonIndex + 1).trim();
            if (value) isValid = true;
            if (key) {
                originalVariables[key] = value;
            }
        });

        if (isValid) {
            const moduleConfig = modulesData.find(configModule => {
                if (configModule.name === moduleName) return true;
                if (configModule.compatibleModuleNames) {
                    return configModule.compatibleModuleNames.includes(originalModuleName) ||
                        configModule.compatibleModuleNames.includes(moduleName);
                }
                return false;
            });

            if (moduleConfig) {
                const variableNameMap = buildVariableNameMap(moduleConfig);

                const normalizedVariables = {};
                moduleConfig.variables.forEach(variable => {
                    normalizedVariables[variable.name] = '';
                });

                const content = module.raw.slice(1, -1);

                let lastPipePos = content.indexOf('|') + 1;
                let inNestedModule = 0;

                for (let i = lastPipePos; i < content.length; i++) {
                    const char = content[i];

                    if (char === '[') {
                        inNestedModule++;
                    } else if (char === ']') {
                        inNestedModule--;
                    } else if (char === '|' && inNestedModule === 0) {
                        const varPart = content.substring(lastPipePos, i).trim();
                        parseSingleVariableInProcess(varPart, normalizedVariables, variableNameMap, module, moduleConfig);
                        lastPipePos = i + 1;
                    }
                }

                const lastPart = content.substring(lastPipePos).trim();
                parseSingleVariableInProcess(lastPart, normalizedVariables, variableNameMap, module, moduleConfig);

                const normalizedModule = {
                    ...module,
                    originalModuleName,
                    moduleName: moduleConfig.name,
                    variables: normalizedVariables
                };
                normalizedModules.push(normalizedModule);
            } else {
                debugLog(`未找到模块配置：${module}`);
            }
        }
    });

    debugLog('[Module Processor] 初步标准化模块完成，模块:', normalizedModules);

    // 第二步：模块内容去重
    const deduplicatedModules = deduplicateModules(normalizedModules);

    // 第三步：为包含time变量的模块附加结构化时间数据（包含格式化）
    attachStructuredTimeData(deduplicatedModules);

    // 第四步：智能补全time变量
    completeTimeVariables(deduplicatedModules);

    // 第四点五步：按模块名分组，同时根据selectedModuleNames进行过滤
    let moduleGroups = {};
    deduplicatedModules.forEach(module => {
        if (!selectedModuleNames || selectedModuleNames.length === 0 ||
            selectedModuleNames.includes(module.moduleName)) {
            if (!moduleGroups[module.moduleName]) {
                moduleGroups[module.moduleName] = [];
            }
            moduleGroups[module.moduleName].push(module);
        }
    });

    // 按照modulesData中模块配置的order属性对moduleGroups进行排序
    debugLog('[Module Processor] 开始对moduleGroups按order排序，原始moduleGroups:', Object.keys(moduleGroups));
    const sortedModuleGroups = {};
    const moduleOrderInfo = Object.keys(moduleGroups)
        .map(moduleName => {
            const moduleConfig = modulesData.find(config => config.name === moduleName);
            const order = moduleConfig?.order !== undefined ? moduleConfig.order : 0;
            debugLog('[Module Processor] 模块排序信息:', moduleName, 'order:', order);
            return { moduleName, order };
        })
        .sort((a, b) => a.order - b.order);

    debugLog('[Module Processor] 排序后的模块顺序:', moduleOrderInfo.map(item => `${item.moduleName} (order: ${item.order})`));

    moduleOrderInfo.forEach(item => {
        sortedModuleGroups[item.moduleName] = moduleGroups[item.moduleName];
    });

    moduleGroups = sortedModuleGroups;
    debugLog('[Module Processor] 排序后的moduleGroups:', Object.keys(moduleGroups));

    // 直接在moduleGroups上处理每个模块组
    Object.entries(moduleGroups).forEach(([moduleName, moduleGroup]) => {
        const sortedGroup = sortModules(moduleGroup);

        const moduleConfig = modulesData.find(config => config.name === moduleName);
        if (configManager.hasModuleVariable(moduleConfig, 'id')) {
            completeIdVariables(sortedGroup);
        }

        if (configManager.hasModuleVariable(moduleConfig, 'level')) {
            moduleGroups[moduleName] = processLevelVariables(sortedGroup, modulesData);
        } else {
            moduleGroups[moduleName] = sortedGroup;
        }
    });

    debugLog('[Module Processor] 标准化模块完成:', moduleGroups);

    return moduleGroups;
}
