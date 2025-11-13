// 模块解析器 - 用于解析模块格式字符串
import { debugLog, errorLog } from "../index.js";

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
            const moduleName = simpleMatch[1].trim();
            if (moduleName) {
                debugLog(`解析简单模块: ${moduleName}, 无变量`);
                return {
                    name: moduleName,
                    variables: []
                };
            }
        }
        
        errorLog('模块字符串格式不正确，不符合 [模块名|变量:描述|...] 格式');
        return null;
    }

    const moduleName = match[1].trim();
    const variablesString = match[2];
    
    if (!moduleName) {
        errorLog('模块名为空');
        return null;
    }

    // 解析变量部分
    const variables = [];
    const variableParts = variablesString.split('|');
    
    for (const part of variableParts) {
        const variableMatch = part.match(/^\s*(.+?)\s*:\s*(.+)\s*$/);
        
        if (variableMatch) {
            const variableName = variableMatch[1].trim();
            const variableDesc = variableMatch[2].trim();
            
            if (variableName) {
                variables.push({
                    name: variableName,
                    description: variableDesc || ''
                });
                debugLog(`解析变量: ${variableName} - ${variableDesc}`);
            }
        } else {
            // 如果不符合变量格式，尝试作为简单变量名处理
            const simpleVariableName = part.trim();
            if (simpleVariableName) {
                variables.push({
                    name: simpleVariableName,
                    description: ''
                });
                debugLog(`解析简单变量: ${simpleVariableName}`);
            }
        }
    }

    debugLog(`成功解析模块: ${moduleName}, 变量数量: ${variables.length}`);
    
    return {
        name: moduleName,
        variables: variables
    };
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