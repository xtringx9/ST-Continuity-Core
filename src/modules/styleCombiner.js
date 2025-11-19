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
 * @param {string} variableName 变量名称（可选）
 * @returns {string} 组合后的自定义样式内容
 */
export function getCombinedCustomStyles(moduleConfig, variableName = null) {
    try {
        debugLog('[CUSTOM STYLES] getCombinedCustomStyles被调用');
        debugLog('[CUSTOM STYLES] 模块配置:', moduleConfig);
        debugLog('[CUSTOM STYLES] 变量名称:', variableName);

        if (!moduleConfig) {
            errorLog('获取组合样式失败：模块配置为空');
            return '';
        }

        // 获取原始的自定义样式内容
        let rawStyles = '';
        if (variableName) {
            // 获取变量级样式
            const variables = moduleConfig.variables || [];
            const variable = variables.find(v => v.name === variableName);
            if (variable) {
                rawStyles = variable.customStyles || '';
            }
        } else {
            // 获取模块级样式
            rawStyles = moduleConfig.customStyles || '';
        }

        debugLog('[CUSTOM STYLES] 获取到的自定义样式:', rawStyles);
        return rawStyles;
    } catch (error) {
        errorLog('获取组合样式失败:', error);
        return '';
    }
}

/**
 * 将组合后的自定义样式插入到指定的details元素内部
 * @param {string} selector CSS选择器，默认为'details.bottom-summary'
 * @param {Object} moduleConfig 模块配置对象
 * @param {string} variableName 变量名称（可选）
 */
export function insertCombinedStylesToDetails(selector = 'details.bottom-summary', moduleConfig, variableName = null) {
    try {
        debugLog('[CUSTOM STYLES] insertCombinedStylesToDetails被调用');
        debugLog('[CUSTOM STYLES] 选择器:', selector);
        debugLog('[CUSTOM STYLES] 模块配置:', moduleConfig);
        debugLog('[CUSTOM STYLES] 变量名称:', variableName);

        if (!moduleConfig) {
            errorLog('插入组合样式失败：模块配置为空');
            return;
        }

        // 获取组合的自定义样式内容
        const rawStyles = getCombinedCustomStyles(moduleConfig, variableName);

        if (!rawStyles) {
            debugLog('[CUSTOM STYLES] 没有自定义样式，跳过插入');
            return;
        }

        // 查找目标details元素
        const detailsElement = document.querySelector(selector);
        if (!detailsElement) {
            errorLog('插入组合样式失败：未找到目标元素，选择器:', selector);
            return;
        }

        debugLog('[CUSTOM STYLES] 找到目标元素:', detailsElement);

        // 创建样式容器
        const styleContainer = document.createElement('div');
        styleContainer.className = 'custom-styles-container';

        // 直接插入原始样式内容
        styleContainer.innerHTML = rawStyles;

        // 插入到details元素内部（在summary之后）
        detailsElement.appendChild(styleContainer);

        debugLog('[CUSTOM STYLES] 自定义样式已插入到details元素内部');
    } catch (error) {
        errorLog('插入组合样式到details元素失败:', error);
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
