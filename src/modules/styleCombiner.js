// 样式组合器 - 用于组合模块级和变量级的customStyles
import { infoLog, debugLog, errorLog } from "../utils/logger.js";
import { getUserAndCharNames } from "../utils/variableReplacer.js"

/**
 * 自动生成样式内容
 * @param {Object} moduleConfig 模块配置对象
 * @param {Object} moduleData 模块数据对象
 * @returns {string} 自动生成的样式字符串
 */
function generateAutoStyles(moduleConfig) {
    try {
        debugLog('[CUSTOM STYLES] 开始自动生成样式');

        if (!moduleConfig || !moduleConfig.variables || !Array.isArray(moduleConfig.variables)) {
            debugLog('[CUSTOM STYLES] 模块配置或变量数组为空，返回空样式');
            return '';
        }

        const variables = moduleConfig.variables;
        const moduleName = moduleConfig.displayName || moduleConfig.name || '模块';

        // 生成微缩样式的占位符
        let autoStyles = `<!-- ${moduleName} 模块 (自动生成样式) -->
<style>
  .auto-module-micro:empty { display: none; }
</style>
<div class="auto-module-micro" style="display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 0 0.8em; background-color: #f8f9fa; border: 1px solid #e9ecef; border-radius: 16px; padding: 4px 10px; margin: 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; line-height: 1.5; color: #495057;">

    <!-- 模块名称 -->
    <span style="font-size: 11px; font-weight: bold; color: #ffffff; background-color: #6D6A67; padding: 1px 6px; border-radius: 8px;">${moduleName}</span>`;

        // 遍历所有变量，生成${变量名.displayName}:${变量名.value}格式的占位符
        variables.forEach((variable, index) => {
            if (variable.enabled !== false) {
                // 在变量之间添加分隔符（第一个变量前不加，最后一个变量后不加）
                if (index > 0) {
                    autoStyles += `

    <!-- 分隔符 -->
    <span style="color: #c0b8b3;">|</span>`;
                }

                autoStyles += `

    <!-- ${variable.displayName || variable.name} -->
    <span style="display: inline-flex; align-items: baseline; flex-wrap: wrap;">
        <span style="color: #6c757d; font-weight: 500; white-space: nowrap;">${variable.displayName || variable.name}:</span>
        <span style="color: #495057; margin-left: 0.3em;">\${${variable.name}.value}</span>
    </span>`;
            }
        });

        autoStyles += `

</div>`;

        debugLog('[CUSTOM STYLES] 自动生成样式完成');
        return autoStyles;
    } catch (error) {
        errorLog('[CUSTOM STYLES] 自动生成样式失败:', error);
        return '';
    }
}

/**
 * 获取组合的自定义样式内容
 * @param {Object} moduleConfig 模块配置对象
 * @param {Object} moduleData 模块数据对象（可选），用于替换${id.value}等变量
 */
export function getCombinedCustomStyles(moduleConfig, moduleData) {
    try {
        debugLog('[CUSTOM STYLES] 开始单个条目的样式处理', moduleData);

        // 如果moduleConfig.customStyles为空，则使用自动生成的样式
        moduleData.customStyles = moduleConfig.customStyles || generateAutoStyles(moduleConfig);

        if (!moduleConfig) {
            errorLog('获取组合样式失败：模块配置为空');
            return '';
        }

        // 如果有模块数据，进行变量替换
        if (moduleData.customStyles && (moduleConfig || moduleData)) {
            // 先处理嵌套的customStyles引用（优先替换${某变量.customStyles}）
            moduleData.customStyles = resolveNestedCustomStyles(moduleData.customStyles, moduleConfig);

            // 再处理其他变量替换
            moduleData.customStyles = replaceVariablesInStyles(moduleData.customStyles, moduleConfig, moduleData.moduleData, false, moduleData.moduleData.isIncremental);
        }

        if (moduleData.moduleData.timeline) {
            moduleData.moduleData.timeline.forEach((entry) => {
                // 如果moduleConfig.customStyles为空，则使用自动生成的样式
                entry.customStyles = moduleConfig.customStyles || generateAutoStyles(moduleConfig);
                // 如果有模块数据，进行变量替换
                if (entry.customStyles && (moduleConfig || moduleData)) {
                    // 先处理嵌套的customStyles引用（优先替换${某变量.customStyles}）
                    entry.customStyles = resolveNestedCustomStyles(entry.customStyles, moduleConfig);

                    // 再处理其他变量替换
                    entry.customStyles = replaceVariablesInStyles(entry.customStyles, moduleConfig, entry, false, moduleData.moduleData.isIncremental);
                }
            })
        }
    } catch (error) {
        errorLog('获取组合样式失败:', error);
    }
}

/**
 * 为多个模块条目生成组合样式
 * @param {Array} moduleData 结构化模块条目数组
 */
export function generateStylesForModuleEntries(moduleData) {
    try {
        debugLog('[CUSTOM STYLES] 开始逐个模块样式处理', moduleData);

        moduleData.customStyles = ''; // 放合并后的所有处理后的条目样式

        const allStyles = [];

        // 为每个模块条目生成样式
        moduleData.data.forEach((entry, index) => {
            // 生成当前模块条目的样式
            getCombinedCustomStyles(moduleData.moduleConfig, entry);
            if (entry.customStyles && !entry.shouldHide) {
                allStyles.push(entry.customStyles);
            }
        });

        const combinedStyles = allStyles.join('\n');
        moduleData.customStyles = combinedStyles;
    } catch (error) {
        errorLog('为模块条目生成样式失败:', error);
    }
}

/**
 * 处理容器样式并注入模块条目样式
 * @param {Object} containerConfig 容器配置对象
 * @param {Array} moduleEntries 结构化模块条目数组
 */
export function processContainerStyles(moduleData) {
    try {
        debugLog('[CUSTOM STYLES] 进入容器样式处理', moduleData);

        const monduleConfig = moduleData.moduleConfig;

        generateStylesForModuleEntries(moduleData); // 生成模块样式，存放到了moduleData中

        moduleData.containerStyles = monduleConfig.containerStyles || '';

        // 处理容器样式中的变量替换
        if (moduleData.containerStyles) {
            // 先处理嵌套的customStyles引用（如${cond.customStyles}），将${var.xxx}转换为${varName.xxx}
            moduleData.containerStyles = resolveNestedCustomStyles(moduleData.containerStyles, monduleConfig);

            // 再处理其他变量替换（包括${count}/${length}/${varName.value}等）
            // 传递isProcessingContainer=true，保留${customStyles}占位符
            moduleData.containerStyles = replaceVariablesInStyles(moduleData.containerStyles, monduleConfig, moduleData, true);
        }

        let finalStyles = '';

        if (moduleData.containerStyles.includes('${customStyles}')) {
            // 如果containerStyles内部有${customStyles}，则注入处理后的样式
            finalStyles = moduleData.containerStyles.replace('${customStyles}', moduleData.customStyles);
        } else {
            // 否则将处理后的样式添加到containerStyles下方
            finalStyles = moduleData.containerStyles;
            if (moduleData.customStyles) {
                finalStyles += '\n' + moduleData.customStyles;
            }
        }
        moduleData.containerStyles = finalStyles;
    } catch (error) {
        errorLog('处理容器样式失败:', error);
    }
}

/**
 * 解析嵌套的customStyles引用
 * @param {string} styles 样式字符串
 * @param {Object} moduleConfig 模块配置对象
 * @returns {string} 解析后的样式字符串
 */
function resolveNestedCustomStyles(styles, moduleConfig) {
    // 查找${variableName.customStyles}格式的引用
    // [^.}]+ 确保变量名不跨过 } 或 .，避免误匹配 ${mesid}层...${level.customStyles} 这种跨标签的情况
    const customStylesRegex = /\$\{([^.}]+)\.customStyles\}/g;
    let processedStyles = styles;
    let match;
    const processedVariables = new Set();

    // 最多处理5层嵌套，避免无限循环
    let maxDepth = 5;

    while ((match = customStylesRegex.exec(processedStyles)) && maxDepth > 0) {
        const varName = match[1];

        // 避免重复处理同一变量导致无限循环
        if (processedVariables.has(varName)) {
            continue;
        }
        processedVariables.add(varName);

        // 查找该变量的customStyles
        const variables = moduleConfig.variables || [];
        const targetVariable = variables.find(v => v.name === varName);

        if (targetVariable) {
            // 禁用变量不渲染customStyles，输出HTML注释占位符
            if (targetVariable.enabled === false) {
                processedStyles = processedStyles.replace(match[0], `<!-- ${varName} (disabled) -->`);
                customStylesRegex.lastIndex = 0;
                maxDepth--;
                continue;
            }
            if (targetVariable.customStyles) {
                // 递归处理嵌套的customStyles
                let nestedStyles = resolveNestedCustomStyles(targetVariable.customStyles, moduleConfig);

                // 处理${var.xxx}和${variable.xxx}变量替换，将var/variable替换为当前变量名
                nestedStyles = replaceRelativeVariables(nestedStyles, varName);

                // 替换当前引用
                processedStyles = processedStyles.replace(match[0], nestedStyles);

                // 重置正则表达式的lastIndex，以便重新匹配
                customStylesRegex.lastIndex = 0;
            }
            else {
                // 变量存在但没有customStyles，替换为空
                processedStyles = processedStyles.replace(match[0], '');
                customStylesRegex.lastIndex = 0;
            }
        }
        else {
            // 变量不存在，输出HTML注释占位符
            processedStyles = processedStyles.replace(match[0], `<!-- ${varName} (not found) -->`);
            customStylesRegex.lastIndex = 0;
        }

        maxDepth--;
    }

    return processedStyles;
}

/**
 * 替换相对变量引用（${var.xxx}和${variable.xxx}）
 * @param {string} styles 样式字符串
 * @param {string} currentVarName 当前变量名
 * @returns {string} 替换后的样式字符串
 */
function replaceRelativeVariables(styles, currentVarName) {
    if (!styles || typeof styles !== 'string') {
        return styles || '';
    }

    // 查找${var.xxx}和${variable.xxx}格式的引用
    const relativeVarRegex = /\$\{(var|variable)\.([^}]+)\}/g;

    return styles.replace(relativeVarRegex, (match, varType, propName) => {
        // 将var/variable替换为当前变量名
        return `\${${currentVarName}.${propName}}`;
    });
}

/**
 * 替换样式字符串中的变量
 * @param {string} styles 样式字符串
 * @param {Object} moduleConfig 模块配置对象
 * @param {Object} moduleData 模块数据对象
 * @returns {string} 替换后的样式字符串
 */
function replaceVariablesInStyles(styles, moduleConfig, moduleData, isProcessingContainer = false, isTimeline = false) {
    // 查找${variablePath}格式的变量引用
    const variableRegex = /\$\{([^}]+)\}/g;

    return styles.replace(variableRegex, (match, variablePath) => {
        // 特殊处理${customStyles}
        if (variablePath === 'customStyles') {
            // 如果是处理容器样式，保留${customStyles}占位符，供后续注入所有模块条目样式
            if (isProcessingContainer) {
                return match; // 保留${customStyles}占位符
            } else {
                // 递归处理模块级样式中的变量
                return replaceVariablesInStyles(moduleData.customStyles, moduleConfig, moduleData);
            }
        }

        // 处理${count}和${length}变量
        if (variablePath === 'count' || variablePath === 'length') {
            return String(moduleData.moduleCount !== undefined ? moduleData.moduleCount : 0);
        }

        if (variablePath === 'user' || variablePath === 'char') {
            const { userName, charName } = getUserAndCharNames();
            return variablePath === 'user' ? userName : charName;
        }

        if (variablePath === 'mesid') {
            return moduleData.messageIndex !== undefined ? String(moduleData.messageIndex) : '';
        }

        // 处理模块级别的简单变量，如${name}
        if (!variablePath.includes('.') && moduleConfig[variablePath] !== undefined) {
            return String(moduleConfig[variablePath]);
        }

        // 处理带路径的变量，如${id.name}或${id.value}
        const [varName, propName] = variablePath.split('.');
        if (varName && propName) {
            const variables = moduleConfig.variables || [];
            const targetVariable = variables.find(v => v.name === varName);

            if (targetVariable) {
                // 禁用变量不渲染，输出HTML注释占位符
                if (targetVariable.enabled === false) {
                    return `<!-- ${varName} (disabled) -->`;
                }
                // 特殊处理${id.value}，从模块数据中获取值
                if (propName === 'value' && moduleData) {
                    // 处理moduleData是数组的情况（如从processContainerStyles传递的moduleEntries）
                    if (moduleData.data !== undefined && Array.isArray(moduleData.data)) {
                        // 容器样式中使用变量.value时，优先从最后一条条目数据获取实际值
                        const lastEntry = moduleData.data[moduleData.data.length - 1];
                        if (lastEntry?.moduleData?.variables && lastEntry.moduleData.variables[varName] !== undefined) {
                            return String(lastEntry.moduleData.variables[varName]);
                        }
                        // 回退到默认值
                        return String(targetVariable.defaultValue || '');
                    }
                    // 首先尝试从moduleData.variables获取（支持标准模块数据结构）
                    else if (moduleData.variables && moduleData.variables[varName] !== undefined) {
                        let resultString = String(moduleData.variables[varName]);
                        if (isTimeline) {
                            if (moduleData.changedKeys != undefined && moduleData.changedKeys.includes(varName)) {
                                let lastString = moduleData.lastVariables && moduleData.lastVariables[varName] !== undefined ? String(moduleData.lastVariables[varName]) : '';
                                resultString = generateVariableChangeHTML(lastString, resultString);
                            }
                        }
                        return resultString;
                    }
                    else return `暂无${targetVariable.displayName || varName}`;
                }
                // 处理${varName.customStyles}，需要递归解析内部的${var.xxx}和值
                else if (propName === 'customStyles' && targetVariable.customStyles) {
                    // 先替换相对变量引用，再递归替换值
                    let resolvedStyles = replaceRelativeVariables(targetVariable.customStyles, varName);
                    resolvedStyles = replaceVariablesInStyles(resolvedStyles, moduleConfig, moduleData, isProcessingContainer, isTimeline);
                    return resolvedStyles;
                }
                // 处理其他属性，如${id.name}
                else if (targetVariable[propName] !== undefined) {
                    return String(targetVariable[propName]);
                }
            }
            else {
                debugLog(`[CUSTOM STYLES] 变量${varName}在配置中不存在，替换为HTML注释占位符`);
                return `<!-- ${varName} (not found) -->`;
            }
        }

        // 如果未找到匹配的变量，保留原始格式
        return match;
    });
}

/**
 * 切换变量显示状态
 * @param {string} id 容器元素ID
 * @param {string} lastValue 旧值
 * @param {string} currentValue 新值
 */
function toggleVariableDisplay(id, lastValue, currentValue) {
    const container = document.getElementById(id);
    if (!container) return;

    const currentSpan = container.children[0];
    const lastSpan = container.children[1];

    if (currentSpan.style.display !== 'none') {
        // 切换到显示旧值
        currentSpan.style.display = 'none';
        lastSpan.style.display = 'inline';
        container.title = '点击显示新值: ' + currentValue;
    } else {
        // 切换回显示新值
        currentSpan.style.display = 'inline';
        lastSpan.style.display = 'none';
        container.title = '点击显示旧值: ' + lastValue;
    }
}

// 将函数挂载到全局作用域，供HTML onclick事件调用
if (typeof window !== 'undefined') {
    window.toggleVariableDisplay = toggleVariableDisplay;
}

/**
 * 生成变量变化的HTML显示
 * @param {string} lastString 旧值
 * @param {string} currentString 新值
 * @returns {string} HTML字符串
 */
function generateVariableChangeHTML(lastString, currentString) {
    let resultString = currentString;
    // 为时间线中发生变化的变量添加优化样式
    if (lastString) {
        // 生成唯一ID避免冲突
        const uniqueId = 'var-change-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        resultString = `
        <span id="${uniqueId}" style="
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            user-select: none;
        " onclick="toggleVariableDisplay('${uniqueId}', '${lastString.replace(/'/g, "\\'")}', '${currentString.replace(/'/g, "\\'")}')">
            <span style="
                color: #28a745;
                font-weight: 600;
            ">${currentString}</span>
            <span style="
                color: #6c757d;
                text-decoration: line-through;
                opacity: 0.7;
                font-weight: 500;
                display: none;
            ">${lastString}</span>
        </span>
    `;
    } else {
        resultString = `<span style="
                                        color: #28a745;
                                        font-weight: 600;
                                    ">${resultString}</span>`;
    }
    return resultString;
}

/**
 * 初始化变量变化样式（只需要调用一次）
 */
function initVariableChangeStyles() {
    if (!document.querySelector('#variable-change-styles')) {
        const style = document.createElement('style');
        style.id = 'variable-change-styles';
        style.textContent = `
            .variable-change-container:hover .current-value {
                opacity: 0;
            }
            .variable-change-container:hover .last-value {
                opacity: 1;
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * 将组合后的自定义样式插入到指定的模块内容容器中
 * @param {Object} moduleData 模块数据对象（可选），用于替换样式中的变量
 */
export function insertCombinedStylesToDetails(moduleData) {
    try {
        debugLog(`[CUSTOM STYLES] 开始获取插入${moduleData.moduleConfig.name}模块的总样式：`, moduleData);

        if (moduleData?.data?.length === 0) {
            debugLog('[CUSTOM STYLES] 没有模块条目，返回空样式');
            return '';
        }

        const moduleConfig = moduleData.moduleConfig;

        if (!moduleConfig) {
            errorLog(`[CUSTOM STYLES]插入组合样式失败：模块${moduleData.moduleConfig.name}配置为空`);
            return '';
        }

        // 统一处理：无论是否有模块条目，都调用processContainerStyles
        processContainerStyles(moduleData);

        debugLog(`[CUSTOM STYLES] 处理后的包含最终样式的${moduleData.moduleConfig.name}模块数据:`, moduleData);
    } catch (error) {
        errorLog(`模块${moduleData.moduleConfig.name}插入组合样式失败:`, error);
    }
}
