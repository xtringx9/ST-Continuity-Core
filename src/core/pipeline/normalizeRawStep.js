// normalizeRawStep.js
// 标准化单个 raw → normalizedModule（F 二期快照阶段 2）。
// 从 normalize.js 第一步抽出，无 ST 依赖（模块配置注入），供 rebuildProcessor 逐模块使用。
//
// ⚠️ 行为与原 normalizeModules 第一步逐行一致：
//   解析 [模块名|key:value|...]，按模块配置的 variables 归一化，兼容模块名/变量名。

import { removeSpecialSymbols, removeHyphens } from '../../utils/stringUtils.js';
import { tryParseNumber } from '../../utils/numberParser.js';

/** 构建变量名映射表（兼容变量名 -> 当前变量名） */
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

/** 解析单个变量部分（支持嵌套模块，跳过冒号在嵌套内的情况） */
export function parseSingleVariableInProcess(part, variablesMap, variableNameMap, module, moduleConfig) {
    if (!part) return;

    let colonIndex = -1;
    let inNestedModule = 0;
    for (let i = 0; i < part.length; i++) {
        const char = part[i];
        if (char === '[') inNestedModule++;
        else if (char === ']') inNestedModule--;
        else if (char === ':' && inNestedModule === 0) { colonIndex = i; break; }
    }
    if (colonIndex === -1) return;

    const varName = removeSpecialSymbols(part.substring(0, colonIndex).trim());
    const varValue = part.substring(colonIndex + 1).trim();
    const isNestedVar = module.nestedInfo ? module.nestedInfo.nestedVariables.includes(varName) : false;

    if (varName && varValue) {
        const currentVarName = variableNameMap[varName];
        if (variableNameMap.hasOwnProperty(varName)) {
            const variableConfig = (moduleConfig.variables || []).find(v => v.name === currentVarName);
            const isNoNormalize = variableConfig?.isNoNormalize;
            let finalValue = (!isNoNormalize && !isNestedVar && currentVarName !== 'time' && currentVarName !== 'id' && currentVarName !== 'log') ? removeHyphens(varValue) : varValue;
            if (currentVarName === 'id') finalValue = tryParseNumber(varValue);
            variablesMap[currentVarName] = finalValue;
        }
    }
}

/**
 * 标准化单个 raw 模块（等价于 normalizeModules 第一步对单个 module 的处理）。
 * @param {Object} rawModule 原始模块 { raw, messageIndex, ... }
 * @param {Array} modulesData 模块配置数组
 * @returns {Object|null} normalizedModule（含 moduleName / variables / messageIndex 等）；无匹配配置返回 null
 */
export function normalizeRawModule(rawModule, modulesData) {
    const raw = rawModule?.raw;
    if (typeof raw !== 'string' || !raw.trim()) return null;

    const [originalModuleName, ...parts] = raw.slice(1, -1).split('|');
    const moduleName = removeSpecialSymbols(originalModuleName.trim());

    let isValid = false;
    const originalVariables = {};
    parts.forEach(part => {
        const colonIndex = part.indexOf(':');
        if (colonIndex === -1) return;
        const key = removeSpecialSymbols(part.substring(0, colonIndex).trim());
        const value = part.substring(colonIndex + 1).trim();
        if (value) isValid = true;
        if (key) originalVariables[key] = value;
    });

    if (!isValid) return null;

    const moduleConfig = (modulesData || []).find(configModule => {
        if (configModule.name === moduleName) return true;
        if (configModule.compatibleModuleNames) {
            return configModule.compatibleModuleNames.includes(originalModuleName) ||
                configModule.compatibleModuleNames.includes(moduleName);
        }
        return false;
    });
    if (!moduleConfig) return null;

    const variableNameMap = buildVariableNameMap(moduleConfig);
    const normalizedVariables = {};
    moduleConfig.variables.forEach(variable => {
        normalizedVariables[variable.name] = '';
    });

    const content = raw.slice(1, -1);
    let lastPipePos = content.indexOf('|') + 1;
    let inNestedModule = 0;
    for (let i = lastPipePos; i < content.length; i++) {
        const char = content[i];
        if (char === '[') inNestedModule++;
        else if (char === ']') inNestedModule--;
        else if (char === '|' && inNestedModule === 0) {
            const varPart = content.substring(lastPipePos, i).trim();
            parseSingleVariableInProcess(varPart, normalizedVariables, variableNameMap, rawModule, moduleConfig);
            lastPipePos = i + 1;
        }
    }
    const lastPart = content.substring(lastPipePos).trim();
    parseSingleVariableInProcess(lastPart, normalizedVariables, variableNameMap, rawModule, moduleConfig);

    return {
        ...rawModule,
        originalModuleName,
        moduleName: moduleConfig.name,
        variables: normalizedVariables,
    };
}
