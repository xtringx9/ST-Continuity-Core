// 模块解析管理器 - 纯基于配置的模块解析处理
import { debugLog, errorLog, infoLog } from "../index.js";
import { parseModuleString, validateModuleString } from "./moduleParser.js";
import { loadModuleConfigFromExtension } from "./moduleStorageManager.js";

/**
 * 初始化模块解析功能
 * 注意：此函数已不再初始化UI事件，仅保留接口兼容性
 */
export function initParseModule() {
    debugLog('模块解析功能已初始化（纯配置模式）');
    infoLog('模块解析功能初始化完成（纯配置模式）');
}

/**
 * 添加解析区域事件绑定
 */
// 不再需要addParseAreaEvents函数，因为现在使用纯配置解析API



/**
 * 批量解析多个模块
 */
/**
 * 批量解析模块字符串并更新模块配置
 * @param {string} inputText 要解析的模块字符串
 * @param {Array} existingModules 现有的模块配置数组
 * @returns {Object} 包含更新后模块配置和处理信息的结果对象
 */
export function parseMultipleModules(inputText, existingModules = []) {
    debugLog('开始批量解析模块');

    if (!inputText || inputText.trim() === '') {
        errorLog('请输入要解析的模块字符串');
        return {
            modules: existingModules,
            oldModules: [...existingModules],
            createdCount: 0,
            updatedCount: 0,
            message: '请输入要解析的模块字符串'
        };
    }

    debugLog(`输入文本: ${inputText}`);

    // 使用支持嵌套的解析器查找所有符合 [模块名|变量:描述|...] 格式的字符串
    const moduleMatches = parseNestedModules(inputText);
    debugLog(`找到的模块匹配: ${moduleMatches}`);

    if (!moduleMatches || moduleMatches.length === 0) {
        errorLog('未找到有效的模块格式字符串');
        return {
            modules: existingModules,
            oldModules: [...existingModules],
            createdCount: 0,
            updatedCount: 0,
            message: '未找到有效的模块格式字符串'
        };
    }

    const moduleMap = new Map(); // 用于去重，同模块名视为同一个模块

    moduleMatches.forEach(match => {
        debugLog(`处理模块字符串: ${match}`);
        if (validateModuleString(match)) {
            debugLog(`模块字符串格式验证通过`);
            const parsedModule = parseModuleString(match);
            debugLog(`解析结果:`, parsedModule);
            if (parsedModule) {
                // 如果模块名已存在，合并变量
                if (moduleMap.has(parsedModule.name)) {
                    const existingModule = moduleMap.get(parsedModule.name);
                    // 合并变量，避免重复
                    parsedModule.variables.forEach(newVar => {
                        if (!existingModule.variables.some(existingVar =>
                            existingVar.name === newVar.name)) {
                            existingModule.variables.push(newVar);
                        }
                    });
                } else {
                    moduleMap.set(parsedModule.name, parsedModule);
                }
            }
        } else {
            debugLog(`模块字符串格式验证失败: ${match}`);
        }
    });

    if (moduleMap.size === 0) {
        errorLog('未找到有效的模块格式字符串');
        return {
            modules: existingModules,
            oldModules: [...existingModules],
            createdCount: 0,
            updatedCount: 0,
            message: '未找到有效的模块格式字符串'
        };
    }

    debugLog(`找到 ${moduleMap.size} 个不同的模块`);

    // 创建或更新模块
    let createdCount = 0;
    let updatedCount = 0;
    const updatedModules = [...existingModules];
    const processingResults = [];

    moduleMap.forEach((parsedModule, moduleName) => {
        // 查找是否已存在同名模块
        const existingModuleIndex = updatedModules.findIndex(module => module.name === moduleName);

        if (existingModuleIndex !== -1) {
            // 更新现有模块
            const updateResult = updateModuleFromParse(updatedModules[existingModuleIndex], parsedModule);
            updatedModules[existingModuleIndex] = updateResult.moduleConfig;
            processingResults.push({
                moduleName: moduleName,
                action: 'updated',
                oldVariables: updateResult.oldVariables,
                newVariables: updateResult.moduleConfig.variables,
                updatedVariables: updateResult.updatedVariables,
                addedVariables: updateResult.addedVariables
            });
            updatedCount++;
        } else {
            // 创建新模块
            const newModule = createModuleFromParse(parsedModule);
            updatedModules.push(newModule);
            processingResults.push({
                moduleName: moduleName,
                action: 'created',
                oldVariables: [],
                newVariables: newModule.variables,
                updatedVariables: 0,
                addedVariables: newModule.variables.length
            });
            createdCount++;
        }
    });

    // 记录结果
    let message = `成功解析并处理了 ${moduleMap.size} 个模块`;
    if (createdCount > 0) {
        message += `，创建了 ${createdCount} 个新模块`;
    }
    if (updatedCount > 0) {
        message += `，更新了 ${updatedCount} 个现有模块`;
    }

    infoLog(message);

    // 返回包含更新后模块配置和处理信息的结果对象
    return {
        modules: updatedModules,
        oldModules: existingModules,
        processingResults: processingResults,
        createdCount: createdCount,
        updatedCount: updatedCount,
        totalModules: moduleMap.size,
        message: message
    };
}

/**
 * 根据模块名查找现有模块
 * @param {string} moduleName 模块名
 * @returns {Object|null} 模块配置对象或null
 */
function findModuleByName(moduleName) {
    // 完全基于JSON配置查找模块
    return findModuleInConfigByName(moduleName);
}

/**
 * 根据模块名从JSON配置中查找模块
 * @param {string} moduleName 模块名
 * @returns {Object|null} 模块配置对象或null
 */
function findModuleInConfigByName(moduleName) {
    try {
        const config = loadModuleConfigFromExtension();
        if (!config || !Array.isArray(config)) return null;

        // 检查模块名是否匹配
        const exactMatch = config.find(module => module.name === moduleName);
        if (exactMatch) return exactMatch;

        // 检查兼容模块名是否匹配
        return config.find(module => {
            if (!module.compatibleModuleNames) return false;
            const compatibleNames = module.compatibleModuleNames.split(/[,，\s]+/).filter(name => name.trim());
            return compatibleNames.includes(moduleName);
        });
    } catch (error) {
        errorLog('从配置中查找模块失败:', error);
        return null;
    }
}

/**
 * 从解析结果创建新模块
 * @param {Object} parsedModule 解析后的模块对象
 */
/**
 * 从解析结果创建新模块配置
 * @param {Object} parsedModule 解析后的模块对象
 * @returns {Object} 新模块配置
 */
export function createModuleFromParse(parsedModule) {
    debugLog(`创建新模块: ${parsedModule.name}`);

    // 创建新模块配置对象
    const newModuleConfig = {
        name: parsedModule.name,
        displayName: parsedModule.displayName || parsedModule.name,
        enabled: true,
        outputMode: 'full', // 默认输出模式
        variables: parsedModule.variables || []
    };

    // 返回新创建的模块配置
    return newModuleConfig;
}

/**
 * 从解析结果更新现有模块
 * @param {HTMLElement} moduleItem 模块项元素
 * @param {Object} parsedModule 解析后的模块对象
 */
/**
 * 更新现有模块配置
 * @param {Object} moduleConfig 模块配置对象
 * @param {Object} parsedModule 解析后的模块对象
 * @returns {Object} 包含更新后模块配置和旧条目的结果对象
 */
export function updateModuleFromParse(moduleConfig, parsedModule) {
    debugLog(`更新现有模块: ${parsedModule.name}`);
    return fillModuleFromParse(moduleConfig, parsedModule);
}

/**
 * 从解析结果填充模块配置
 * @param {Object} moduleConfig 模块配置对象
 * @param {Object} parsedModule 解析后的模块对象
 * @returns {Object} 包含更新后模块配置和旧条目的结果对象
 */
export function fillModuleFromParse(moduleConfig, parsedModule) {
    // 创建模块配置的副本，避免直接修改原对象
    const updatedModule = { ...moduleConfig };

    // 保存旧的变量列表副本，用于输出处理结果
    const oldVariables = [...(moduleConfig.variables || [])];

    // 设置模块名称
    updatedModule.name = parsedModule.name;

    let updatedVariables = 0;
    let addedVariables = 0;

    // 获取模块的输出模式，默认使用full
    const outputMode = updatedModule.outputMode || 'full';

    // 确保variables数组存在
    if (!updatedModule.variables) {
        updatedModule.variables = [];
    }

    // 添加解析出的变量
    if (parsedModule.variables && parsedModule.variables.length > 0) {
        parsedModule.variables.forEach(variable => {
            // 处理增量更新模式
            if (outputMode === 'incremental') {
                // 查找具有相同标识符的变量
                const variableWithSameIdentifierIndex = updatedModule.variables.findIndex(v =>
                    v.identifier === variable.identifier
                );
                if (variableWithSameIdentifierIndex !== -1) {
                    // 更新现有变量的内容
                    updatedModule.variables[variableWithSameIdentifierIndex] = {
                        ...updatedModule.variables[variableWithSameIdentifierIndex],
                        ...variable
                    };
                    updatedVariables++;
                } else {
                    // 添加新变量
                    updatedModule.variables.push(variable);
                    addedVariables++;
                }
            } else {
                // 全量更新模式
                // 检查是否已存在同名变量
                const existingVariableIndex = updatedModule.variables.findIndex(v => v.name === variable.name);
                if (existingVariableIndex !== -1) {
                    // 更新现有变量
                    updatedModule.variables[existingVariableIndex] = variable;
                    updatedVariables++;
                } else {
                    // 添加新变量
                    updatedModule.variables.push(variable);
                    addedVariables++;
                }
            }
        });
    }

    // 记录更新信息
    let message = `成功更新模块 "${parsedModule.name}"`;
    if (addedVariables > 0) {
        message += `，新增 ${addedVariables} 个变量`;
    }
    if (updatedVariables > 0) {
        message += `，更新 ${updatedVariables} 个变量描述`;
    }
    if (addedVariables === 0 && updatedVariables === 0) {
        message += `，无变量变更`;
    }

    debugLog(message);

    // 返回包含更新后模块配置和旧条目的结果对象
    return {
        moduleConfig: updatedModule,
        oldVariables: oldVariables,
        updatedVariables: updatedVariables,
        addedVariables: addedVariables
    };
}

/**
 * 从输入框解析模块并自动填充
 * @param {HTMLElement} moduleItem 模块项元素
 */
// 不再需要parseModuleFromInput函数，因为现在使用parseMultipleModules进行纯配置解析

/**
 * 在模块中根据变量名查找变量
 * @param {Object} moduleConfig 模块配置对象
 * @param {string} variableName 变量名
 * @returns {Object|null} 变量配置对象或null
 */
function findVariableByName(moduleConfig, variableName) {
    // 完全基于JSON配置查找变量
    return findVariableInConfigByName(moduleConfig, variableName);
}

/**
 * 在模块配置中根据变量名查找变量
 * @param {Object} moduleConfig 模块配置对象
 * @param {string} variableName 变量名
 * @returns {Object|null} 变量配置对象或null
 */
function findVariableInConfigByName(moduleConfig, variableName) {
    try {
        if (!moduleConfig || !moduleConfig.variables || !Array.isArray(moduleConfig.variables)) return null;

        // 检查变量名是否匹配
        const exactMatch = moduleConfig.variables.find(variable => variable.name === variableName);
        if (exactMatch) return exactMatch;

        // 检查兼容变量名是否匹配
        return moduleConfig.variables.find(variable => {
            if (!variable.compatibleVariableNames) return false;
            const compatibleNames = variable.compatibleVariableNames.split(/[,，\s]+/).filter(name => name.trim());
            return compatibleNames.includes(variableName);
        });
    } catch (error) {
        errorLog('从配置中查找变量失败:', error);
        return null;
    }
}

/**
 * 查找具有相同标识符变量内容的条目
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 * @param {Object} parsedModule 解析后的模块对象
 * @returns {JQuery<HTMLElement>|null} 找到的变量项jQuery对象或null
 */
// 不再需要findVariableByIdentifierContent函数，因为现在使用配置中的identifier字段进行匹配

/**
 * 更新现有变量的内容
 * @param {JQuery<HTMLElement>} existingVariable 现有变量项jQuery对象
 * @param {Object} newVariable 新变量对象
 */
// 不再需要updateVariableContent函数，因为现在使用fillModuleFromParse中的配置更新

/**
 * 从解析结果添加变量
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 * @param {Object} variable 变量对象
 */
// 不再需要addVariableFromParse函数，因为现在使用fillModuleFromParse进行纯配置变量添加

/**
 * 更新变量数量显示
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 */
// 不再需要updateVariableCountDisplay函数，因为现在是纯配置处理，不需要UI显示

/**
 * 绑定变量事件（使用variableManager.js中的实现，确保标识符按钮事件正确绑定）
 * @param {JQuery<HTMLElement>} variableItem 变量项jQuery对象
 * @param {JQuery<HTMLElement>} moduleItem 所属模块jQuery对象
 */
// 使用从index.js导入的bindVariableEvents函数，不需要本地实现

/**
 * 解析嵌套的模块字符串，支持 [[]] 嵌套结构
 * @param {string} inputText 输入文本
 * @returns {Array} 解析出的模块字符串数组
 */
function parseNestedModules(inputText) {
    const results = [];
    let stack = [];
    let currentPos = 0;

    for (let i = 0; i < inputText.length; i++) {
        const char = inputText[i];

        if (char === '[') {
            // 遇到开括号，记录位置
            stack.push(i);
        } else if (char === ']') {
            // 遇到闭括号，检查是否有匹配的开括号
            if (stack.length > 0) {
                const start = stack.pop();

                // 如果栈为空，说明找到了一个完整的模块
                if (stack.length === 0) {
                    const moduleString = inputText.substring(start, i + 1);

                    // 验证模块字符串格式
                    if (validateModuleString(moduleString)) {
                        results.push(moduleString);
                    }

                    currentPos = i + 1;
                }
            }
        }
    }

    // 如果栈中还有未匹配的开括号，尝试处理最外层的情况
    if (stack.length > 0) {
        // 从最后一个开括号开始，尝试匹配到文本末尾
        const start = stack[stack.length - 1];
        const moduleString = inputText.substring(start);

        // 验证模块字符串格式
        if (validateModuleString(moduleString)) {
            results.push(moduleString);
        }
    }

    debugLog(`嵌套解析结果: ${JSON.stringify(results)}`);
    return results;
}
