// 模块解析管理器 - 处理模块解析的UI和事件
import { debugLog, errorLog, infoLog, updateModulePreview, bindVariableEvents } from "../index.js";
import { parseModuleString, validateModuleString } from "./moduleParser.js";
import { getVariableItemTemplate } from "./templateManager.js";
import { addModule } from "./moduleManager.js";

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
function parseMultipleModules() {
    debugLog('开始批量解析模块');

    // 获取解析输入框内容
    const parseInput = document.getElementById('module-parse-input');
    if (!parseInput) {
        errorLog('未找到模块解析输入框');
        toastr.error('未找到解析输入框');
        return;
    }

    const inputText = parseInput.value.trim();
    if (!inputText) {
        toastr.warning('请输入要解析的模块字符串');
        return;
    }

    debugLog(`输入文本: ${inputText}`);

    // 使用支持嵌套的解析器查找所有符合 [模块名|变量:描述|...] 格式的字符串
    const moduleMatches = parseNestedModules(inputText);
    debugLog(`找到的模块匹配: ${moduleMatches}`);

    if (!moduleMatches || moduleMatches.length === 0) {
        toastr.error('未找到有效的模块格式字符串');
        return;
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
        return;
    }

    debugLog(`找到 ${moduleMap.size} 个不同的模块`);

    // 创建或更新模块
    let createdCount = 0;
    let updatedCount = 0;

    moduleMap.forEach((parsedModule, moduleName) => {
        // 查找是否已存在同名模块
        const existingModule = findModuleByName(moduleName);

        if (existingModule) {
            // 更新现有模块
            updateModuleFromParse(existingModule, parsedModule);
            updatedCount++;
        } else {
            // 创建新模块
            createModuleFromParse(parsedModule);
            createdCount++;
        }
    });

    // 清空输入框
    parseInput.value = '';

    // 显示结果（使用info而不是success，避免覆盖单个模块的success提示）
    let message = `成功解析并处理了 ${moduleMap.size} 个模块`;
    if (createdCount > 0) {
        message += `，创建了 ${createdCount} 个新模块`;
    }
    if (updatedCount > 0) {
        message += `，更新了 ${updatedCount} 个现有模块`;
    }

    toastr.info(message);
    infoLog(message);
}

/**
 * 根据模块名查找现有模块
 * @param {string} moduleName 模块名
 * @returns {HTMLElement|null} 模块元素或null
 */
function findModuleByName(moduleName) {
    const moduleItems = document.querySelectorAll('.module-item');
    for (const moduleItem of moduleItems) {
        const nameInput = moduleItem.querySelector('.module-name');
        const compatibleNamesInput = moduleItem.querySelector('.module-compatible-names');

        // 检查模块名是否匹配
        if (nameInput && nameInput.value === moduleName) {
            return moduleItem;
        }

        // 检查兼容模块名是否匹配
        if (compatibleNamesInput && compatibleNamesInput.value) {
            const compatibleNames = compatibleNamesInput.value.split(/[,，\s]+/).filter(name => name.trim());
            if (compatibleNames.includes(moduleName)) {
                return moduleItem;
            }
        }
    }
    return null;
}

/**
 * 从解析结果创建新模块
 * @param {Object} parsedModule 解析后的模块对象
 */
function createModuleFromParse(parsedModule) {
    debugLog(`创建新模块: ${parsedModule.name}`);

    // 添加新模块
    const newModuleElement = addModule();
    const moduleItem = newModuleElement.find('.module-item');

    // 填充模块数据
    fillModuleFromParse(moduleItem, parsedModule);
}

/**
 * 从解析结果更新现有模块
 * @param {HTMLElement} moduleItem 模块项元素
 * @param {Object} parsedModule 解析后的模块对象
 */
function updateModuleFromParse(moduleItem, parsedModule) {
    debugLog(`更新现有模块: ${parsedModule.name}`);

    // 将HTMLElement转换为jQuery对象
    const moduleItemJQ = $(moduleItem);

    // 填充模块数据
    fillModuleFromParse(moduleItemJQ, parsedModule);
}

/**
 * 从解析结果填充模块数据
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 * @param {Object} parsedModule 解析后的模块对象
 */
function fillModuleFromParse(moduleItem, parsedModule) {
    // 设置模块名称
    const moduleNameInput = moduleItem.find('.module-name');
    if (moduleNameInput.length > 0) {
        moduleNameInput.val(parsedModule.name);
    }

    let updatedVariables = 0;
    let addedVariables = 0;

    // 添加解析出的变量（不清空现有变量，避免重复添加）
    if (parsedModule.variables && parsedModule.variables.length > 0) {
        parsedModule.variables.forEach(variable => {
            // 检查是否已存在同名变量
            const existingVariable = findVariableByName(moduleItem, variable.name);
            if (existingVariable) {
                updatedVariables++;
            } else {
                addedVariables++;
            }
            addVariableFromParse(moduleItem, variable);
        });
    }

    // 强制更新模块预览
    if (updateModulePreview) {
        updateModulePreview(moduleItem);
    }

    // 更新变量数量显示
    updateVariableCountDisplay(moduleItem);

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
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 * @param {string} variableName 变量名
 * @returns {JQuery<HTMLElement>|null} 变量项jQuery对象或null
 */
function findVariableByName(moduleItem, variableName) {
    const variableItems = moduleItem.find('.variable-item');

    for (let i = 0; i < variableItems.length; i++) {
        const variableItem = $(variableItems[i]);
        const nameInput = variableItem.find('.variable-name');
        const compatibleNamesInput = variableItem.find('.variable-compatible-names');

        // 检查变量名是否匹配
        if (nameInput.length > 0 && nameInput.val() === variableName) {
            return variableItem;
        }

        // 检查兼容变量名是否匹配
        if (compatibleNamesInput.length > 0 && compatibleNamesInput.val()) {
            const compatibleNames = compatibleNamesInput.val().split(/[,，\s]+/).filter(name => name.trim());
            if (compatibleNames.includes(variableName)) {
                return variableItem;
            }
        }
    }

    return null;
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
