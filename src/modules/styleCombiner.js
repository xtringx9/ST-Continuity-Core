// 样式组合器 - 用于组合模块级和变量级的customStyles
import { debugLog, errorLog } from "../index.js";
import { loadModuleConfig } from "./moduleConfigManager.js";

/**
 * 样式组合器类
 * 负责组合模块配置中的customStyles和模块变量名中的customStyles
 */
class StyleCombiner {
    constructor() {
        this.styleCache = new Map(); // 样式缓存
        this.combinedStyles = new Map(); // 组合后的样式缓存
    }

    /**
     * 获取模块级的customStyles
     * @param {Object} moduleConfig 模块配置对象
     * @returns {string} 模块级样式字符串
     */
    getModuleStyles(moduleConfig) {
        try {
            if (!moduleConfig) {
                debugLog('模块配置为空，返回空样式');
                return '';
            }

            // 从模块配置中获取customStyles
            const moduleStyles = moduleConfig.customStyles || '';
            debugLog('获取模块级样式:', moduleStyles);

            return this.normalizeStyles(moduleStyles);
        } catch (error) {
            errorLog('获取模块级样式失败:', error);
            return '';
        }
    }

    /**
     * 获取变量级的customStyles
     * @param {Object} moduleConfig 模块配置对象
     * @param {string} variableName 变量名称
     * @returns {string} 变量级样式字符串
     */
    getVariableStyles(moduleConfig, variableName) {
        try {
            if (!moduleConfig || !variableName) {
                debugLog('模块配置或变量名称为空，返回空样式');
                return '';
            }

            // 从模块配置的变量数组中查找指定变量的customStyles
            const variables = moduleConfig.variables || [];
            const variable = variables.find(v => v.name === variableName);

            if (!variable) {
                debugLog(`未找到变量 ${variableName} 的配置`);
                return '';
            }

            const variableStyles = variable.customStyles || '';
            debugLog(`获取变量 ${variableName} 的样式:`, variableStyles);

            return this.normalizeStyles(variableStyles);
        } catch (error) {
            errorLog(`获取变量 ${variableName} 样式失败:`, error);
            return '';
        }
    }

    /**
     * 组合模块级和变量级的customStyles
     * @param {Object} moduleConfig 模块配置对象
     * @param {string} variableName 变量名称（可选）
     * @returns {string} 组合后的样式字符串
     */
    combineStyles(moduleConfig, variableName = null) {
        try {
            debugLog('[CUSTOM STYLES] combineStyles被调用');
            debugLog('[CUSTOM STYLES] 模块配置:', moduleConfig ? '存在' : '不存在');
            debugLog('[CUSTOM STYLES] 变量名称:', variableName || '未提供');

            const cacheKey = this.getCacheKey(moduleConfig, variableName);
            debugLog('[CUSTOM STYLES] 缓存键:', cacheKey);

            // 检查缓存
            if (this.combinedStyles.has(cacheKey)) {
                debugLog('[CUSTOM STYLES] 从缓存中获取组合样式');
                return this.combinedStyles.get(cacheKey);
            }

            // 获取模块级样式
            const moduleStyles = this.getModuleStyles(moduleConfig);
            debugLog('[CUSTOM STYLES] 模块级样式:', moduleStyles);

            // 获取变量级样式（如果提供了变量名称）
            const variableStyles = variableName ?
                this.getVariableStyles(moduleConfig, variableName) : '';
            debugLog('[CUSTOM STYLES] 变量级样式:', variableStyles);

            // 组合样式
            const combined = this.mergeStyles(moduleStyles, variableStyles);
            debugLog('[CUSTOM STYLES] 合并后的样式:', combined);

            // 缓存结果
            this.combinedStyles.set(cacheKey, combined);
            debugLog('[CUSTOM STYLES] 样式已缓存，缓存大小:', this.combinedStyles.size);

            debugLog('[CUSTOM STYLES] 组合样式完成');
            return combined;
        } catch (error) {
            errorLog('[CUSTOM STYLES] 组合样式失败:', error);
            return '';
        }
    }

    /**
     * 合并样式字符串，处理优先级和冲突
     * @param {string} baseStyles 基础样式（模块级）
     * @param {string} overrideStyles 覆盖样式（变量级）
     * @returns {string} 合并后的样式字符串
     */
    mergeStyles(baseStyles, overrideStyles) {
        if (!baseStyles && !overrideStyles) {
            return '';
        }

        if (!baseStyles) {
            return overrideStyles;
        }

        if (!overrideStyles) {
            return baseStyles;
        }

        // 直接合并样式字符串，变量级样式优先级更高
        return `${baseStyles}\n${overrideStyles}`;
    }



    /**
     * 规范化样式字符串
     * @param {string} styles 样式字符串
     * @returns {string} 规范化后的样式字符串
     */
    normalizeStyles(styles) {
        if (!styles || typeof styles !== 'string') {
            return '';
        }

        // 去除多余空格和换行
        return styles.trim().replace(/\s+/g, ' ');
    }

    /**
     * 生成缓存键
     * @param {Object} moduleConfig 模块配置
     * @param {string} variableName 变量名称
     * @returns {string} 缓存键
     */
    getCacheKey(moduleConfig, variableName) {
        const moduleId = moduleConfig?.id || moduleConfig?.name || 'unknown';
        return variableName ? `${moduleId}_${variableName}` : moduleId;
    }

    /**
     * 清除缓存
     */
    clearCache() {
        this.styleCache.clear();
        this.combinedStyles.clear();
        debugLog('样式组合器缓存已清除');
    }

    /**
     * 获取缓存统计信息
     * @returns {Object} 缓存统计
     */
    getCacheStats() {
        return {
            styleCacheSize: this.styleCache.size,
            combinedStylesSize: this.combinedStyles.size,
            totalCacheSize: this.styleCache.size + this.combinedStyles.size
        };
    }
}

// 创建单例实例
const styleCombiner = new StyleCombiner();

/**
 * 获取所有模块配置
 * @returns {Array} 模块配置数组
 */
export function getAllModuleConfigs() {
    try {
        const config = loadModuleConfig();
        const modules = config?.modules || [];
        debugLog('[CUSTOM STYLES] getAllModuleConfigs获取到的模块数量:', modules.length);
        return modules;
    } catch (error) {
        errorLog('获取所有模块配置失败:', error);
        return [];
    }
}

/**
 * 获取组合后的样式
 * @param {Object} moduleConfig 模块配置对象（可选，如果为空则获取所有模块的样式）
 * @param {string} variableName 变量名称（可选）
 * @returns {Object|string} 组合后的样式对象或字符串
 */
export function getCombinedStyles(moduleConfig = null, variableName = null) {
    try {
        debugLog('[CUSTOM STYLES] getCombinedStyles被调用');
        debugLog('[CUSTOM STYLES] 参数moduleConfig:', moduleConfig);
        debugLog('[CUSTOM STYLES] 参数variableName:', variableName);

        if (moduleConfig) {
            // 如果提供了模块配置，返回单个模块的组合样式
            const result = styleCombiner.combineStyles(moduleConfig, variableName);
            debugLog('[CUSTOM STYLES] 单个模块组合样式结果:', result);
            return result;
        } else {
            // 如果没有提供模块配置，获取所有模块的样式信息
            debugLog('[CUSTOM STYLES] 开始获取所有模块的样式信息');

            // 获取所有模块配置
            const allModuleConfigs = getAllModuleConfigs();
            debugLog('[CUSTOM STYLES] 所有模块配置数量:', allModuleConfigs.length);
            debugLog('[CUSTOM STYLES] 所有模块配置:', JSON.stringify(allModuleConfigs, null, 2));

            const combinedStyles = {
                moduleStyles: {},
                variableStyles: {},
                combinedStyles: {}
            };

            // 遍历所有模块，收集样式信息
            allModuleConfigs.forEach(moduleConfig => {
                const moduleName = moduleConfig.name || moduleConfig.id || 'unknown';
                debugLog(`[CUSTOM STYLES] 处理模块 ${moduleName}`);

                // 获取模块级样式
                const moduleStyles = styleCombiner.getModuleStyles(moduleConfig);
                debugLog(`[CUSTOM STYLES] 模块 ${moduleName} 的模块级样式:`, moduleStyles);

                if (moduleStyles) {
                    combinedStyles.moduleStyles[moduleName] = {
                        order: moduleConfig.order || 0,
                        styles: moduleStyles
                    };
                }

                // 获取变量级样式
                const variables = moduleConfig.variables || [];
                debugLog(`[CUSTOM STYLES] 模块 ${moduleName} 的变量数量:`, variables.length);

                variables.forEach(variable => {
                    const varName = variable.name || 'unknown';
                    const variableStyles = styleCombiner.getVariableStyles(moduleConfig, varName);
                    debugLog(`[CUSTOM STYLES] 变量 ${varName} 的样式:`, variableStyles);

                    if (variableStyles) {
                        const fullVarName = `${moduleName}.${varName}`;
                        combinedStyles.variableStyles[fullVarName] = {
                            styles: variableStyles
                        };
                    }
                });

                // 获取组合样式
                const combined = styleCombiner.combineStyles(moduleConfig);
                debugLog(`[CUSTOM STYLES] 模块 ${moduleName} 的组合样式:`, combined);

                if (combined) {
                    combinedStyles.combinedStyles[moduleName] = combined;
                }
            });

            debugLog('[CUSTOM STYLES] 最终组合样式对象:', JSON.stringify(combinedStyles, null, 2));
            return combinedStyles;
        }
    } catch (error) {
        errorLog('获取组合样式失败:', error);
        return moduleConfig ? '' : { moduleStyles: {}, variableStyles: {}, combinedStyles: {} };
    }
}

/**
 * 获取组合的自定义样式内容
 * @param {Object} moduleConfig 模块配置对象
 * @param {string} variableName 变量名称（可选），如果为'container'则获取容器样式
 * @param {Object} moduleData 模块数据对象（可选），用于替换${id.value}等变量
 * @returns {string} 组合后的自定义样式内容
 */
export function getCombinedCustomStyles(moduleConfig, variableName = null, moduleData = null) {
    try {
        debugLog('[CUSTOM STYLES] getCombinedCustomStyles被调用');
        debugLog('[CUSTOM STYLES] 模块配置:', moduleConfig);
        debugLog('[CUSTOM STYLES] 变量名称:', variableName);
        debugLog('[CUSTOM STYLES] 模块数据:', moduleData);

        if (!moduleConfig) {
            errorLog('获取组合样式失败：模块配置为空');
            return '';
        }

        // 获取原始的自定义样式内容
        let rawStyles = '';
        if (variableName === 'container') {
            // 获取容器样式
            rawStyles = moduleConfig.containerStyles || '';
        } else if (variableName) {
            // 获取变量级样式
            const variables = moduleConfig.variables || [];
            const variable = variables.find(v => v.name === variableName);
            if (variable) {
                rawStyles = variable.customStyles || '';
            }
        } else {
            // 获取模块级样式（每条模块条目）
            rawStyles = moduleConfig.customStyles || '';
        }

        debugLog('[CUSTOM STYLES] 获取到的原始自定义样式:', rawStyles);

        // 如果有模块数据，进行变量替换
        if (rawStyles && (moduleConfig || moduleData)) {
            // 先处理嵌套的customStyles引用（优先替换${某变量.customStyles}）
            rawStyles = resolveNestedCustomStyles(rawStyles, moduleConfig, moduleData);

            // 再处理其他变量替换
            rawStyles = replaceVariablesInStyles(rawStyles, moduleConfig, moduleData);
        }

        debugLog('[CUSTOM STYLES] 处理后的自定义样式:', rawStyles);
        return rawStyles;
    } catch (error) {
        errorLog('获取组合样式失败:', error);
        return '';
    }
}

/**
 * 为多个模块条目生成组合样式
 * @param {Array} moduleEntries 结构化模块条目数组
 * @returns {string} 所有模块条目的组合样式
 */
export function generateStylesForModuleEntries(moduleEntries) {
    try {
        debugLog('[CUSTOM STYLES] generateStylesForModuleEntries被调用');
        debugLog('[CUSTOM STYLES] 模块条目数量:', moduleEntries.length);

        if (!Array.isArray(moduleEntries) || moduleEntries.length === 0) {
            debugLog('[CUSTOM STYLES] 没有模块条目，返回空样式');
            return '';
        }

        const allStyles = [];

        // 为每个模块条目生成样式
        moduleEntries.forEach((entry, index) => {
            debugLog(`[CUSTOM STYLES] 处理模块条目 ${index + 1}/${moduleEntries.length}`);
            debugLog(`[CUSTOM STYLES] 模块名称: ${entry.moduleName}`);
            debugLog(`[CUSTOM STYLES] 模块配置: ${entry.moduleConfig ? '存在' : '不存在'}`);
            debugLog(`[CUSTOM STYLES] 模块数据: ${entry.moduleData ? '存在' : '不存在'}`);

            if (!entry.moduleConfig) {
                debugLog('[CUSTOM STYLES] 模块配置为空，跳过');
                return;
            }

            // 生成当前模块条目的样式
            const entryStyles = getCombinedCustomStyles(entry.moduleConfig, null, entry.moduleData);
            if (entryStyles) {
                allStyles.push(entryStyles);
            }
        });

        const combinedStyles = allStyles.join('\n');
        debugLog('[CUSTOM STYLES] 生成的所有模块样式:', combinedStyles);
        return combinedStyles;
    } catch (error) {
        errorLog('为模块条目生成样式失败:', error);
        return '';
    }
}

/**
 * 处理容器样式并注入模块条目样式
 * @param {Object} containerConfig 容器配置对象
 * @param {Array} moduleEntries 结构化模块条目数组
 * @returns {string} 最终的组合样式
 */
export function processContainerStyles(containerConfig, moduleEntries) {
    try {
        debugLog('[CUSTOM STYLES] processContainerStyles被调用');
        debugLog('[CUSTOM STYLES] 容器配置:', containerConfig);
        debugLog('[CUSTOM STYLES] 模块条目数量:', moduleEntries.length);

        if (!containerConfig) {
            debugLog('[CUSTOM STYLES] 容器配置为空，返回空样式');
            return '';
        }

        // 获取容器样式
        let containerStyles = containerConfig.containerStyles || '';
        // 生成所有模块条目的样式
        const moduleStyles = generateStylesForModuleEntries(moduleEntries);

        let finalStyles = '';

        if (containerStyles.includes('${customStyles}')) {
            // 如果containerStyles内部有${customStyles}，则注入处理后的样式
            finalStyles = containerStyles.replace('${customStyles}', moduleStyles);
        } else {
            // 否则将处理后的样式添加到containerStyles下方
            finalStyles = containerStyles;
            if (moduleStyles) {
                finalStyles += '\n' + moduleStyles;
            }
        }

        debugLog('[CUSTOM STYLES] 最终的组合样式:', finalStyles);
        return finalStyles;
    } catch (error) {
        errorLog('处理容器样式失败:', error);
        return '';
    }
}

/**
 * 解析嵌套的customStyles引用
 * @param {string} styles 样式字符串
 * @param {Object} moduleConfig 模块配置对象
 * @param {Object} moduleData 模块数据对象
 * @returns {string} 解析后的样式字符串
 */
function resolveNestedCustomStyles(styles, moduleConfig, moduleData) {
    // 查找${variableName.customStyles}格式的引用
    const customStylesRegex = /\$\{([^.]+)\.customStyles\}/g;
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

        if (targetVariable && targetVariable.customStyles) {
            // 递归处理嵌套的customStyles
            const nestedStyles = resolveNestedCustomStyles(targetVariable.customStyles, moduleConfig, moduleData);

            // 替换当前引用
            processedStyles = processedStyles.replace(match[0], nestedStyles);

            // 重置正则表达式的lastIndex，以便重新匹配
            customStylesRegex.lastIndex = 0;
        }

        maxDepth--;
    }

    return processedStyles;
}

/**
 * 替换样式字符串中的变量
 * @param {string} styles 样式字符串
 * @param {Object} moduleConfig 模块配置对象
 * @param {Object} moduleData 模块数据对象
 * @returns {string} 替换后的样式字符串
 */
function replaceVariablesInStyles(styles, moduleConfig, moduleData) {
    // 查找${variablePath}格式的变量引用
    const variableRegex = /\$\{([^}]+)\}/g;

    return styles.replace(variableRegex, (match, variablePath) => {
        // 特殊处理${customStyles}，用于在容器样式中引用模块级样式
        if (variablePath === 'customStyles') {
            // 获取模块级的自定义样式
            const moduleStyles = moduleConfig.customStyles || '';
            // 递归处理模块级样式中的变量
            return replaceVariablesInStyles(moduleStyles, moduleConfig, moduleData);
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
                // 特殊处理${id.value}，从模块数据中获取值
                if (propName === 'value' && moduleData) {
                    // 首先尝试从moduleData.variables获取（支持标准模块数据结构）
                    if (moduleData.variables && moduleData.variables[varName] !== undefined) {
                        return String(moduleData.variables[varName]);
                    }
                    // 然后尝试直接从moduleData获取（支持旧版数据结构）
                    else if (moduleData[varName] !== undefined) {
                        return String(moduleData[varName]);
                    }
                    // 最后尝试从moduleData.moduleData获取（支持结构化模块条目）
                    else if (moduleData.moduleData && moduleData.moduleData[varName] !== undefined) {
                        return String(moduleData.moduleData[varName]);
                    }
                    // 还可以从moduleData.variables.variables获取（处理多层嵌套的情况）
                    else if (moduleData.variables && moduleData.variables.variables && moduleData.variables.variables[varName] !== undefined) {
                        return String(moduleData.variables.variables[varName]);
                    }
                }
                // 处理其他属性，如${id.name}
                else if (targetVariable[propName] !== undefined) {
                    return String(targetVariable[propName]);
                }
            }
        }

        // 如果未找到匹配的变量，保留原始格式
        return match;
    });
}

/**
 * 将组合后的自定义样式插入到指定的模块内容容器中
 * @param {string} selector CSS选择器，默认为'.modules-content-container'
 * @param {Object} moduleConfig 模块配置对象
 * @param {string} variableName 变量名称（可选），如果为'container'则处理容器样式
 * @param {Object} moduleData 模块数据对象（可选），用于替换样式中的变量
 */
export function insertCombinedStylesToDetails(selector = '.modules-content-container', moduleConfig, variableName = null, moduleData = null) {
    try {
        debugLog('[CUSTOM STYLES] insertCombinedStylesToDetails被调用');
        debugLog('[CUSTOM STYLES] 选择器:', selector);
        debugLog('[CUSTOM STYLES] 模块配置:', moduleConfig);
        debugLog('[CUSTOM STYLES] 变量名称:', variableName);
        debugLog('[CUSTOM STYLES] 模块数据:', moduleData);

        if (!moduleConfig) {
            errorLog('插入组合样式失败：模块配置为空');
            return '';
        }

        let finalStyles = '';

        // 处理不同格式的模块数据
        let moduleEntries = [];
        let isMultiEntry = false;

        if (moduleData[moduleConfig.name] && moduleData[moduleConfig.name].data && Array.isArray(moduleData[moduleConfig.name].data)) {
            debugLog('[CUSTOM STYLES] 多条目模块数据:', moduleData[moduleConfig.name].data);
            isMultiEntry = true;
            moduleEntries = moduleData[moduleConfig.name].data.map(data => ({
                moduleName: data.moduleName || moduleConfig.name || moduleConfig.id || 'unknown',
                moduleConfig: data.moduleConfig || moduleConfig,  // 优先使用条目自身的配置
                moduleData: data.moduleData || data  // 优先使用条目下的moduleData字段
            }));
        }

        if (moduleEntries.length > 0) {
            // 处理容器样式并注入模块条目样式
            finalStyles = processContainerStyles(moduleConfig, moduleEntries);
        } else {
            // 没有模块数据，只处理自定义样式
            finalStyles = getCombinedCustomStyles(moduleConfig, variableName, moduleData);
        }

        debugLog('[CUSTOM STYLES] 处理后的最终样式:', finalStyles);
        return finalStyles;
    } catch (error) {
        errorLog('插入样式失败:', error);
        return '';
    }
}



/**
 * 处理并生成最终的模块样式
 * @param {Object} moduleConfig 模块配置对象
 * @param {Array} moduleEntries 结构化模块条目数组
 * @returns {string} 最终的组合样式
 */
export function generateFinalModuleStyles(moduleConfig, moduleEntries) {
    try {
        debugLog('[CUSTOM STYLES] generateFinalModuleStyles被调用');
        debugLog('[CUSTOM STYLES] 模块配置:', moduleConfig);
        debugLog('[CUSTOM STYLES] 模块条目数量:', moduleEntries.length);

        if (!moduleConfig) {
            errorLog('生成最终模块样式失败：模块配置为空');
            return '';
        }

        // 处理容器样式并注入模块条目样式
        return processContainerStyles(moduleConfig, moduleEntries);
    } catch (error) {
        errorLog('生成最终模块样式失败:', error);
        return '';
    }
}

/**
 * 将生成的最终样式插入到指定的模块内容容器中
 * @param {string} selector CSS选择器，默认为'.modules-content-container'
 * @param {Object} moduleConfig 模块配置对象
 * @param {Array} moduleEntries 结构化模块条目数组
 */
export function insertFinalStylesToDetails(selector = '.modules-content-container', moduleConfig, moduleEntries) {
    try {
        debugLog('[CUSTOM STYLES] insertFinalStylesToDetails被调用');
        debugLog('[CUSTOM STYLES] 选择器:', selector);
        debugLog('[CUSTOM STYLES] 模块配置:', moduleConfig);
        debugLog('[CUSTOM STYLES] 模块条目:', moduleEntries);

        if (!moduleConfig) {
            errorLog('插入最终样式失败：模块配置为空');
            return '';
        }

        // 生成最终的模块样式
        const finalStyles = generateFinalModuleStyles(moduleConfig, moduleEntries);

        debugLog('[CUSTOM STYLES] 生成的最终样式:', finalStyles);
        return finalStyles;
    } catch (error) {
        errorLog('插入最终样式失败:', error);
        return '';
    }
}

/**
 * 清除样式组合器缓存
 */
export function clearStyleCombinerCache() {
    try {
        debugLog('[CUSTOM STYLES] clearStyleCombinerCache被调用');

        // 清除样式组合器的缓存
        if (styleCombiner && typeof styleCombiner.clearCache === 'function') {
            styleCombiner.clearCache();
            debugLog('[CUSTOM STYLES] 样式组合器缓存已清除');
        } else {
            debugLog('[CUSTOM STYLES] 样式组合器没有clearCache方法');
        }

        debugLog('[CUSTOM STYLES] 清除缓存完成');
    } catch (error) {
        errorLog('清除样式组合器缓存失败:', error);
    }
}

/**
 * 获取样式组合器统计信息
 * @returns {Object} 统计信息对象
 */
export function getStyleCombinerStats() {
    try {
        debugLog('[CUSTOM STYLES] getStyleCombinerStats被调用');

        const stats = {
            cacheHits: 0,
            cacheMisses: 0,
            totalCombinations: 0,
            lastCleared: new Date().toISOString()
        };

        // 获取样式组合器的统计信息
        if (styleCombiner && typeof styleCombiner.getStats === 'function') {
            const combinerStats = styleCombiner.getStats();
            Object.assign(stats, combinerStats);
            debugLog('[CUSTOM STYLES] 样式组合器统计信息:', combinerStats);
        } else {
            debugLog('[CUSTOM STYLES] 样式组合器没有getStats方法，使用默认统计信息');
        }

        debugLog('[CUSTOM STYLES] 统计信息:', stats);
        return stats;
    } catch (error) {
        errorLog('获取样式组合器统计信息失败:', error);
        return {
            cacheHits: 0,
            cacheMisses: 0,
            totalCombinations: 0,
            lastCleared: new Date().toISOString(),
            error: error.message
        };
    }
}

export default styleCombiner;
