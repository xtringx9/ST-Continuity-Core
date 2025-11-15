// 模块解析管理器 - 处理模块解析的UI和事件
import { debugLog, errorLog, infoLog, updateModulePreview, bindVariableEvents } from "../index.js";
import { parseModuleString, validateModuleString } from "./moduleParser.js";
import { getVariableItemTemplate } from "./templateManager.js";
import { addModule } from "./moduleManager.js";
import { loadModuleConfigFromExtension } from "./moduleStorageManager.js";

/**
 * 初始化模块解析功能
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 */
export function initParseModule(moduleItem) {
    debugLog('初始化模块解析功能');

    // 如果传入模块项，直接解析该模块
    if (moduleItem && moduleItem.length > 0) {
        parseModuleFromInput(moduleItem[0]);
    } else {
        // 否则使用全局初始化方式
        // 等待DOM加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initParseModuleFunctionality);
        } else {
            initParseModuleFunctionality();
        }
    }
}

/**
 * 初始化解析模块功能
 */
function initParseModuleFunctionality() {
    debugLog('初始化解析模块功能');

    // 添加解析区域事件绑定
    addParseAreaEvents();

    infoLog('模块解析功能初始化完成');
}

/**
 * 添加解析区域事件绑定
 */
function addParseAreaEvents() {
    // 查找解析按钮
    const parseButton = document.getElementById('parse-modules-btn');
    if (!parseButton) {
        debugLog('未找到解析按钮，稍后重试');
        setTimeout(addParseAreaEvents, 1000);
        return;
    }

    // 绑定解析按钮点击事件
    parseButton.addEventListener('click', function () {
        parseMultipleModules();
    });

    debugLog('解析区域事件绑定完成');
}



/**
 * 批量解析多个模块
 */
/**
 * 批量解析模块字符串并更新模块配置
 * @param {string} inputText 要解析的模块字符串
 * @param {Array} existingModules 现有的模块配置数组
 * @returns {Array} 更新后的模块配置数组
 */
export function parseMultipleModules(inputText, existingModules = []) {
    debugLog('开始批量解析模块');

    if (!inputText || inputText.trim() === '') {
        toastr.warning('请输入要解析的模块字符串');
        return existingModules;
    }

    debugLog(`输入文本: ${inputText}`);

    // 使用支持嵌套的解析器查找所有符合 [模块名|变量:描述|...] 格式的字符串
    const moduleMatches = parseNestedModules(inputText);
    debugLog(`找到的模块匹配: ${moduleMatches}`);

    if (!moduleMatches || moduleMatches.length === 0) {
        toastr.error('未找到有效的模块格式字符串');
        return existingModules;
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
        toastr.error('未找到有效的模块格式字符串');
        return existingModules;
    }

    debugLog(`找到 ${moduleMap.size} 个不同的模块`);

    // 创建或更新模块
    let createdCount = 0;
    let updatedCount = 0;
    const updatedModules = [...existingModules];

    moduleMap.forEach((parsedModule, moduleName) => {
        // 查找是否已存在同名模块
        const existingModuleIndex = updatedModules.findIndex(module => module.name === moduleName);

        if (existingModuleIndex !== -1) {
            // 更新现有模块
            updatedModules[existingModuleIndex] = updateModuleFromParse(updatedModules[existingModuleIndex], parsedModule);
            updatedCount++;
        } else {
            // 创建新模块
            const newModule = createModuleFromParse(parsedModule);
            updatedModules.push(newModule);
            createdCount++;
        }
    });

    // 显示结果（使用info而不是success，避免覆盖单个模块的success提示）
    let message = `成功解析并处理了 ${moduleMap.size} 个模块`;
    if (createdCount > 0) {
        message += `，创建了 ${createdCount} 个新模块`;
    }
    if (updatedCount > 0) {
        message += `，更新了 ${updatedCount} 个现有模块`;
    }

    toastr.info(message);
    return updatedModules;
    infoLog(message);
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
 * @returns {Object} 更新后的模块配置
 */
export function updateModuleFromParse(moduleConfig, parsedModule) {
    debugLog(`更新现有模块: ${parsedModule.name}`);
    return fillModuleFromParse(moduleConfig, parsedModule);
}

/**
 * 从解析结果填充模块配置
 * @param {Object} moduleConfig 模块配置对象
 * @param {Object} parsedModule 解析后的模块对象
 * @returns {Object} 更新后的模块配置
 */
export function fillModuleFromParse(moduleConfig, parsedModule) {
    // 创建模块配置的副本，避免直接修改原对象
    const updatedModule = { ...moduleConfig };

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
            // 检查是否已存在同名变量
            const existingVariableIndex = updatedModule.variables.findIndex(v => v.name === variable.name);

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

    // 显示成功提示
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

    toastr.success(message);
    return updatedModule;

    debugLog(`成功填充模块: ${parsedModule.name}`);
}

/**
 * 从输入框解析模块并自动填充
 * @param {HTMLElement} moduleItem 模块项元素
 */
function parseModuleFromInput(moduleItem) {
    const moduleNameInput = moduleItem.querySelector('.module-name');
    if (!moduleNameInput) {
        errorLog('未找到模块名称输入框');
        return;
    }

    const moduleString = moduleNameInput.value.trim();
    if (!moduleString) {
        toastr.warning('请输入要解析的模块字符串');
        return;
    }

    // 验证模块字符串格式
    if (!validateModuleString(moduleString)) {
        toastr.error('模块字符串格式不正确，请使用 [模块名|变量:描述|...] 格式');
        return;
    }

    // 解析模块字符串
    const parsedModule = parseModuleString(moduleString);
    if (!parsedModule) {
        toastr.error('解析模块失败，请检查格式是否正确');
        return;
    }

    // 填充模块名称
    moduleNameInput.value = parsedModule.name;

    // 清空现有变量
    const variablesContainer = moduleItem.querySelector('.variables-container');
    if (variablesContainer) {
        variablesContainer.innerHTML = '';
    }

    // 添加解析出的变量
    if (parsedModule.variables && parsedModule.variables.length > 0) {
        parsedModule.variables.forEach(variable => {
            addVariableFromParse(moduleItem, variable);
        });

        toastr.success(`成功解析模块 "${parsedModule.name}"，添加了 ${parsedModule.variables.length} 个变量`);
    } else {
        toastr.success(`成功解析模块 "${parsedModule.name}"，无变量`);
    }

    // 触发输入事件以更新预览
    const inputEvent = new Event('input', { bubbles: true });
    moduleNameInput.dispatchEvent(inputEvent);

    debugLog(`成功解析并填充模块: ${parsedModule.name}`);
}

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
function findVariableByIdentifierContent(moduleItem, parsedModule) {
    const variableItems = moduleItem.find('.variable-item');

    // 获取当前模块的所有标识符变量
    const identifierVariables = moduleItem.find('.variable-is-identifier').filter((index, elem) => $(elem).val() === 'true');

    // 如果没有标识符变量，则不进行特殊处理
    if (identifierVariables.length === 0) {
        return null;
    }

    // 遍历所有变量项
    for (let i = 0; i < variableItems.length; i++) {
        const variableItem = $(variableItems[i]);
        let allIdentifiersMatch = true;

        // 检查所有标识符变量的内容是否都匹配
        identifierVariables.each((index, identifierInput) => {
            const identifierVariable = $(identifierInput).closest('.variable-item');
            const identifierVariableName = identifierVariable.find('.variable-name').val();

            // 找到当前变量项中对应的标识符变量
            const currentIdentifierVariable = variableItem.find('.variable-name').filter((idx, elem) => $(elem).val() === identifierVariableName);
            if (currentIdentifierVariable.length === 0) {
                allIdentifiersMatch = false;
                return false; // 退出each循环
            }

            // 检查标识符变量的内容是否匹配
            const currentIdentifierDesc = currentIdentifierVariable.closest('.variable-item').find('.variable-desc').val();

            // 从整个parsedModule中查找对应标识符变量的内容
            const newIdentifier = parsedModule.variables.find(v => v.name === identifierVariableName);
            const newIdentifierValue = newIdentifier ? newIdentifier.description : null;

            // 如果在新变量中找不到对应的标识符变量内容，或者内容不匹配，则认为不匹配
            if (!newIdentifierValue || currentIdentifierDesc !== newIdentifierValue) {
                allIdentifiersMatch = false;
                return false; // 退出each循环
            }
        });

        if (allIdentifiersMatch) {
            return variableItem;
        }
    }

    return null;
}

/**
 * 更新现有变量的内容
 * @param {JQuery<HTMLElement>} existingVariable 现有变量项jQuery对象
 * @param {Object} newVariable 新变量对象
 */
function updateVariableContent(existingVariable, newVariable) {
    // 更新变量描述
    const descriptionInput = existingVariable.find('.variable-desc');
    if (descriptionInput.length > 0) {
        descriptionInput.val(newVariable.description);

        // 触发输入事件以更新预览
        const inputEvent = new Event('input', { bubbles: true });
        descriptionInput[0].dispatchEvent(inputEvent);

        // 强制刷新UI显示
        descriptionInput.trigger('change');

        debugLog(`变量内容已更新: ${newVariable.name} -> ${newVariable.description}`);
    }
}

/**
 * 从解析结果添加变量
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 * @param {Object} variable 变量对象
 */
function addVariableFromParse(moduleItem, variable) {
    const variablesContainer = moduleItem.find('.variables-container');
    if (variablesContainer.length === 0) {
        errorLog('未找到变量容器');
        return;
    }

    debugLog(`添加变量: ${variable.name} - ${variable.description}`);

    // 检查是否已存在同名变量
    const existingVariable = findVariableByName(moduleItem, variable.name);
    if (existingVariable) {
        debugLog(`变量 ${variable.name} 已存在，更新描述`);

        // 更新现有变量的描述
        const descriptionInput = existingVariable.find('.variable-desc');
        if (descriptionInput.length > 0) {
            descriptionInput.val(variable.description);

            // 触发输入事件以更新预览
            const inputEvent = new Event('input', { bubbles: true });
            descriptionInput[0].dispatchEvent(inputEvent);

            // 强制刷新UI显示
            descriptionInput.trigger('change');

            // 更新模块预览
            updateModulePreview(moduleItem);

            debugLog(`变量描述已更新: ${variable.name} -> ${variable.description}`);
        }

        return;
    }

    // 使用模板管理模块创建变量项HTML
    const variableItemHTML = getVariableItemTemplate(variable);
    debugLog(`变量项HTML: ${variableItemHTML}`);

    // 将HTML转换为jQuery对象并添加到容器
    const variableItem = $(variableItemHTML);
    variablesContainer.append(variableItem);

    // 绑定变量事件
    bindVariableEvents(variableItem, moduleItem);

    debugLog(`变量添加完成: ${variable.name}`);
}

/**
 * 更新变量数量显示
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 */
function updateVariableCountDisplay(moduleItem) {
    const variableCount = moduleItem.find('.variable-item').filter(function () {
        return $(this).closest('.variable-template').length === 0;
    }).length;
    const countElement = moduleItem.find('.toggle-variables .variable-count');
    countElement.text(`(${variableCount})`);
    debugLog(`更新变量数量显示: ${variableCount}`);
}

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
