// 模块解析器 - 用于解析模块格式字符串
import { debugLog, errorLog } from "../utils/logger.js";
import { IdentifierParser } from "../utils/identifierParser.js";

/**
 * 解析模块格式字符串
 * @param {string} moduleString 模块格式字符串，如 [item|own:所属人|loc:当前位置/所在地|type:类型|name:名称|desc:物品描述]
 * @returns {Object|null} 解析后的模块对象，包含模块名和变量数组，解析失败返回null
 */
export function parseModuleString(moduleString) {
    if (!moduleString || typeof moduleString !== 'string') {
        errorLog('模块字符串为空或不是字符串类型');
        return null;
    }

    // 移除首尾空格
    const trimmedString = moduleString.trim();

    // 检查是否符合模块格式 [模块名|变量1:描述1|变量2:描述2|...]
    const moduleRegex = /^\[(.+?)\|(.+)\]$/;
    const match = trimmedString.match(moduleRegex);

    if (!match) {
        // 尝试更宽松的匹配，允许只有模块名的情况
        const simpleModuleRegex = /^\[(.+?)\]$/;
        const simpleMatch = trimmedString.match(simpleModuleRegex);

        if (simpleMatch) {
            const { name: moduleName, displayName: moduleDisplayName } = splitDisplayName(simpleMatch[1].trim());
            if (moduleName) {
                debugLog(`解析简单模块: ${moduleName}${moduleDisplayName ? ` (${moduleDisplayName})` : ''}, 无变量`);
                return {
                    name: moduleName,
                    displayName: moduleDisplayName,
                    variables: []
                };
            }
        }

        errorLog('模块字符串格式不正确，不符合 [模块名|变量:描述|...] 格式');
        return null;
    }

    const { name: moduleName, displayName: moduleDisplayName } = splitDisplayName(match[1].trim());
    const variablesString = match[2];

    if (!moduleName) {
        errorLog('模块名为空');
        return null;
    }

    // 解析变量部分 - 支持嵌套模块
    const variables = parseVariablesString(variablesString);

    debugLog(`成功解析模块: ${moduleName}${moduleDisplayName ? ` (${moduleDisplayName})` : ''}, 变量数量: ${variables.length}`);

    return {
        name: moduleName,
        displayName: moduleDisplayName,
        variables: variables
    };
}

/**
 * 解析变量字符串，支持嵌套模块结构
 * @param {string} variablesString 变量字符串，如 "own:所属人|loc:当前位置/所在地|cont:消息内容[item|own:test|type:类型]"
 * @returns {Array} 解析后的变量数组
 */
function parseVariablesString(variablesString) {
    const variables = [];
    let currentPos = 0;
    let inNestedModule = 0;
    let lastPipePos = 0;

    for (let i = 0; i < variablesString.length; i++) {
        const char = variablesString[i];

        if (char === '[') {
            inNestedModule++;
        } else if (char === ']') {
            inNestedModule--;
        } else if (char === '|' && inNestedModule === 0) {
            // 只在顶级管道符处分割
            const part = variablesString.substring(lastPipePos, i).trim();
            parseSingleVariable(part, variables);
            lastPipePos = i + 1;
        }
    }

    // 处理最后一个变量部分
    const lastPart = variablesString.substring(lastPipePos).trim();
    parseSingleVariable(lastPart, variables);

    return variables;
}

/**
 * 解析单个变量部分
 * @param {string} part 单个变量部分，如 "own:所属人"
 * @param {Array} variables 变量数组，用于存储解析结果
 */
/**
 * 从「名称(显示名)」中拆分出真实名称与显示名。
 * 格式来源：generateModuleFormat 开启 showDisplayName 时生成 `变量名(变量显示名)`。
 * @param {string} nameWithSuffix 可能带 (显示名) 后缀的名称部分
 * @returns {{name:string, displayName:string}}
 */
function splitDisplayName(nameWithSuffix) {
    const trimmed = (nameWithSuffix || '').trim();
    const m = trimmed.match(/^(.+)\((.+)\)$/);
    if (m && m[2].trim() !== '') {
        return { name: m[1].trim(), displayName: m[2].trim() };
    }
    return { name: trimmed, displayName: '' };
}

function parseSingleVariable(part, variables) {
    if (!part) return;

    let colonIndex = -1;
    let inNestedModule = 0;
    let inParen = 0;

    // 找到第一个顶级冒号（忽略嵌套模块 [] 与显示名 () 内部，避免显示名含冒号被误切）
    for (let i = 0; i < part.length; i++) {
        const char = part[i];

        if (char === '[') {
            inNestedModule++;
        } else if (char === ']') {
            inNestedModule--;
        } else if (char === '(') {
            inParen++;
        } else if (char === ')') {
            inParen--;
        } else if (char === ':' && inNestedModule === 0 && inParen === 0) {
            colonIndex = i;
            break;
        }
    }

    if (colonIndex === -1) {
        // 如果没有冒号，作为简单变量名处理（支持可选 (显示名) 后缀）
        const simpleVariableName = part.trim();
        if (simpleVariableName) {
            const { name, displayName } = splitDisplayName(simpleVariableName);
            if (name) {
                variables.push({
                    name: name,
                    displayName: displayName,
                    description: ''
                });
                debugLog(`解析简单变量: ${name}${displayName ? ` (${displayName})` : ''}`);
            }
        }
    } else {
        // 有冒号，解析为变量名和值（变量名部分支持可选 (显示名) 后缀）
        const { name: variableName, displayName: variableDisplayName } = splitDisplayName(part.substring(0, colonIndex).trim());
        const variableDesc = part.substring(colonIndex + 1).trim();

        if (variableName) {
            variables.push({
                name: variableName,
                displayName: variableDisplayName,
                description: variableDesc || ''
            });
            debugLog(`解析变量: ${variableName} - ${variableDesc}${variableDisplayName ? ` (显示名: ${variableDisplayName})` : ''}`);
        }
    }
}

/**
 * 验证模块字符串格式
 * @param {string} moduleString 模块格式字符串
 * @returns {boolean} 是否格式正确
 */
export function validateModuleString(moduleString) {
    if (!moduleString || typeof moduleString !== 'string') {
        return false;
    }

    const trimmedString = moduleString.trim();
    const moduleRegex = /^\[(.+?)\|(.+)\]$/;
    const match = trimmedString.match(moduleRegex);

    if (!match) {
        return false;
    }

    const moduleName = match[1].trim();
    if (!moduleName) {
        return false;
    }

    return true;
}

/**
 * 生成模块预览字符串
 * @param {string} moduleName 模块名
 * @param {Array} variables 变量数组
 * @returns {string} 模块预览字符串
 */
export function generateModulePreview(moduleName, variables) {
    if (!moduleName) {
        return '';
    }

    if (!variables || variables.length === 0) {
        return `[${moduleName}]`;
    }

    const variableNames = variables.map(variable => variable.name || '变量名');
    return `[${moduleName}|${variableNames.join('|')}]`;
}

/**
 * 解析兼容名称字符串，支持中英文逗号、中英文分号分隔符
 * @param {string} compatibleNamesString 兼容名称字符串，如"兼容模块名A,兼容模块名B;兼容模块名C"
 * @returns {Array} 解析后的兼容名称数组
 */
export function parseCompatibleNames(compatibleNamesString) {
    if (!compatibleNamesString || typeof compatibleNamesString !== 'string') {
        return [];
    }

    // 使用统一的标识符解析工具
    const namesArray = IdentifierParser.parseMultiValues(compatibleNamesString);

    debugLog(`解析兼容名称: "${compatibleNamesString}" -> ${JSON.stringify(namesArray)}`);

    return namesArray;
}

/**
 * 检查名称是否匹配（包括兼容名称）
 * @param {string} name 要检查的名称
 * @param {string} targetName 目标名称
 * @param {string} compatibleNamesString 兼容名称字符串
 * @returns {boolean} 是否匹配
 */
export function isNameMatch(name, targetName, compatibleNamesString) {
    if (!name || !targetName) {
        return false;
    }

    // 直接匹配
    if (name.trim() === targetName.trim()) {
        return true;
    }

    // 检查兼容名称
    if (compatibleNamesString) {
        const compatibleNames = parseCompatibleNames(compatibleNamesString);
        return compatibleNames.some(compatibleName => compatibleName.trim() === name.trim());
    }

    return false;
}
