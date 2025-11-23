/**
 * 宏管理器 - 负责注册和管理提示词宏
 * 允许用户在提示词中使用 {{CONTINUITY_PROMPT}} 等宏来自动插入模块提示词
 */

import { configManager, debugLog, errorLog, infoLog } from '../index.js';
import { generateFormalPrompt } from '../modules/promptGenerator.js';
import { extension_settings, extensionName, loadModuleConfig } from '../index.js';
import { replaceVariables } from '../utils/variableReplacer.js';

/**
 * 获取完整的连续性提示词
 * 返回所有模块的格式化提示词内容
 * @returns {string} 完整的提示词内容
 */
export function getContinuityPrompt() {
    try {
        debugLog("[Macro]宏管理器: 获取连续性提示词");

        // 检查全局开关状态
        const settings = extension_settings[extensionName];
        if (!settings || !settings.enabled) {
            debugLog("[Macro]宏管理器: 全局开关已关闭，返回空提示词");
            return "";
        }

        // 获取模块数据
        const modulesData = configManager.getModules() || [];

        if (!modulesData || modulesData.length === 0) {
            debugLog("[Macro]宏管理器: 未找到模块数据，返回空提示词");
            return "";
        }

        // 生成正式提示词
        const prompt = generateFormalPrompt();

        // 替换提示词中的变量
        const replacedPrompt = replaceVariables(prompt);

        debugLog("[Macro]宏管理器: 成功生成并替换变量后的连续性提示词");
        return replacedPrompt;
    } catch (error) {
        errorLog("[Macro]宏管理器: 获取连续性提示词失败", error);
        return "";
    }
}

/**
 * 获取模块配置数据（JSON格式）
 * 返回所有模块的配置数据，便于其他插件使用
 * @returns {string} JSON格式的模块配置数据
 */
export function getContinuityConfig() {
    try {
        debugLog("[Macro]宏管理器: 获取模块配置数据");

        // 检查全局开关状态
        const settings = extension_settings[extensionName];
        if (!settings || !settings.enabled) {
            debugLog("[Macro]宏管理器: 全局开关已关闭，返回空配置");
            return "";
        }

        // 获取模块数据
        const modulesData = configManager.getModules() || [];

        if (!modulesData || modulesData.length === 0) {
            debugLog("[Macro]宏管理器: 未找到模块数据，返回空配置");
            return "";
        }

        // 转换为JSON格式
        const configJson = JSON.stringify(modulesData, null, 2);

        debugLog("[Macro]宏管理器: 成功生成模块配置数据");
        return configJson;
    } catch (error) {
        errorLog("[Macro]宏管理器: 获取模块配置数据失败", error);
        return "";
    }
}

/**
 * 获取模块名称列表
 * 返回所有模块的名称，便于快速查看可用模块
 * @returns {string} 模块名称列表（逗号分隔）
 */
export function getContinuityModules() {
    try {
        debugLog("[Macro]宏管理器: 获取模块名称列表");

        // 检查全局开关状态
        const settings = extension_settings[extensionName];
        if (!settings || !settings.enabled) {
            debugLog("[Macro]宏管理器: 全局开关已关闭，返回空列表");
            return "";
        }

        // 获取模块数据
        const modulesData = configManager.getModules() || [];

        if (!modulesData || modulesData.length === 0) {
            debugLog("[Macro]宏管理器: 未找到模块数据，返回空列表");
            return "";
        }

        // 提取模块名称
        const moduleNames = modulesData.map(module => module.name).filter(name => name);

        debugLog("[Macro]宏管理器: 成功生成模块名称列表");
        return moduleNames.join(", ");
    } catch (error) {
        errorLog("[Macro]宏管理器: 获取模块名称列表失败", error);
        return "";
    }
}

/**
 * 获取模块使用指导提示词
 * 只显示使用提示词不为空的模块，用于指导AI如何使用模块数据
 * @returns {string} 使用指导提示词内容
 */
export function getContinuityUsageGuide() {
    try {
        debugLog("[Macro]宏管理器: 获取模块使用指导提示词");

        // 检查全局开关状态
        const settings = extension_settings[extensionName];
        if (!settings || !settings.enabled) {
            debugLog("[Macro]宏管理器: 全局开关已关闭，返回空提示词");
            return "";
        }

        // 获取模块数据
        const modulesData = configManager.getModules() || [];

        if (!modulesData || modulesData.length === 0) {
            debugLog("[Macro]宏管理器: 未找到模块数据，返回空提示词");
            return "";
        }

        // 过滤启用的模块且使用提示词不为空
        const modulesWithUsagePrompt = modulesData.filter(module =>
            module.enabled !== false &&
            module.contentPrompt &&
            module.contentPrompt.trim() !== ""
        );

        if (modulesWithUsagePrompt.length === 0) {
            debugLog("[Macro]宏管理器: 没有使用提示词不为空的模块，返回空提示词");
            return "";
        }

        // 构建使用指导提示词
        let usageGuide = "<module_usage_guide>\n";
        usageGuide += "模块内容使用指导：\n\n";

        modulesWithUsagePrompt.forEach(module => {
            usageGuide += `【${module.name} (${module.displayName})】\n`;
            usageGuide += `使用指导：${module.contentPrompt}\n\n`;
        });

        usageGuide += "</module_usage_guide>\n";

        // 替换提示词中的变量
        const replacedUsageGuide = replaceVariables(usageGuide.trim());

        debugLog("[Macro]宏管理器: 成功生成并替换变量后的模块使用指导提示词");
        return replacedUsageGuide;
    } catch (error) {
        errorLog("[Macro]宏管理器: 获取模块使用指导提示词失败", error);
        return "";
    }
}

/**
 * 获取连续性顺序提示词
 * 按照模块的生成位置和序号组织输出顺序
 * @returns {string} 顺序提示词内容
 */
export function getContinuityOrder() {
    try {
        debugLog("[Macro]宏管理器: 获取连续性顺序提示词");

        // 检查全局开关状态
        const settings = extension_settings[extensionName];
        if (!settings || !settings.enabled) {
            debugLog("[Macro]宏管理器: 全局开关已关闭，返回空提示词");
            return "";
        }

        // 获取模块数据
        const modulesData = configManager.getModules() || [];

        if (!modulesData || modulesData.length === 0) {
            debugLog("[Macro]宏管理器: 未找到模块数据，返回空提示词");
            return "";
        }

        // 过滤启用的模块
        const enabledModules = modulesData.filter(module => module.enabled !== false);

        if (enabledModules.length === 0) {
            debugLog("[Macro]宏管理器: 没有启用的模块，返回空提示词");
            return "";
        }

        // 按照生成位置和序号分组
        const embeddableModules = []; // 可嵌入模块
        const bodyModules = []; // 正文内模块
        const specificPositionModules = []; // 正文内特定位置模块
        const afterBodyModules = []; // 正文后模块

        // 分类模块
        enabledModules.forEach(module => {
            switch (module.outputPosition) {
                case 'embedded':
                    embeddableModules.push(module);
                    break;
                case 'body':
                    bodyModules.push(module);
                    break;
                case 'specific_position':
                    specificPositionModules.push(module);
                    break;
                case 'after_body':
                    afterBodyModules.push(module);
                    break;
                default:
                    // 默认归为正文后模块
                    afterBodyModules.push(module);
            }
        });

        // 构建顺序提示词
        let orderPrompt = "<module_order>\n";
        orderPrompt += "模块生成顺序和配置：\n\n";

        // 添加输出模式说明
        orderPrompt += "输出模式说明：\n";
        orderPrompt += "• 全量输出（输出：全量）：每次生成时都会完整输出该模块的所有键值对\n";
        orderPrompt += "• 增量更新（输出：增量）：只输出与上次生成相比发生变化的键值对\n\n";

        // 可嵌入模块（按序号排序）
        if (embeddableModules.length > 0) {
            embeddableModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += "可嵌入模块，不限制位置，应积极插入正文内：\n";
            embeddableModules.forEach(module => {
                const timingPrompt = module.timingPrompt ? `（生成时机：${module.timingPrompt}）` : "";
                const rangePrompt = getRangePrompt(module);
                const outputModePrompt = getOutputModePrompt(module);
                orderPrompt += `[${module.name}]${timingPrompt}${rangePrompt}${outputModePrompt} `;
                orderPrompt += "\n";
            });
            orderPrompt += "\n\n";
        }

        // 正文内模块（按序号排序）
        if (bodyModules.length > 0) {
            bodyModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += "正文内模块：\n";
            bodyModules.forEach(module => {
                const timingPrompt = module.timingPrompt ? `（生成时机：${module.timingPrompt}）` : "";
                const rangePrompt = getRangePrompt(module);
                const outputModePrompt = getOutputModePrompt(module);
                orderPrompt += `[${module.name}]${timingPrompt}${rangePrompt}${outputModePrompt} `;
                orderPrompt += "\n";
            });
            orderPrompt += "\n\n";
        }

        // 正文内特定位置模块（使用顺序提示词）
        if (specificPositionModules.length > 0) {
            specificPositionModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += "正文内特定位置模块（位于正文开始标签后，被<某正文标签></某正文标签>包裹）：\n";
            orderPrompt += "<某正文标签>\n";
            specificPositionModules.forEach(module => {
                const positionPrompt = module.positionPrompt ? `（位置：${module.positionPrompt}）` : "";
                const timingPrompt = module.timingPrompt ? `（生成时机：${module.timingPrompt}）` : "";
                const rangePrompt = getRangePrompt(module);
                const outputModePrompt = getOutputModePrompt(module);
                orderPrompt += `[${module.name}]${positionPrompt}${timingPrompt}${rangePrompt}${outputModePrompt} `;
                orderPrompt += "\n";
            });
            orderPrompt += "</某正文标签>\n";
            orderPrompt += "\n\n";
        }

        // 正文后模块（按序号排序）
        if (afterBodyModules.length > 0) {
            afterBodyModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += "正文后的模块（位于正文结束标签后，被<module></module>包裹）：\n";
            orderPrompt += "</某正文标签>\n";
            orderPrompt += "<module>\n";
            afterBodyModules.forEach(module => {
                const timingPrompt = module.timingPrompt ? `（生成时机：${module.timingPrompt}）` : "";
                const rangePrompt = getRangePrompt(module);
                const outputModePrompt = getOutputModePrompt(module);
                orderPrompt += `[${module.name}]${timingPrompt}${rangePrompt}${outputModePrompt} `;
                orderPrompt += "\n";
            });
        }
        orderPrompt += "</module>\n\n";
        orderPrompt += "</module_order>\n";

        // 替换提示词中的变量
        const replacedOrderPrompt = replaceVariables(orderPrompt.trim());

        debugLog("[Macro]宏管理器: 成功生成并替换变量后的连续性顺序提示词");
        return replacedOrderPrompt;
    } catch (error) {
        errorLog("[Macro]宏管理器: 获取连续性顺序提示词失败", error);
        return "";
    }
}

/**
 * 获取模块生成数量限制的提示词
 * @param {Object} module 模块对象
 * @returns {string} 数量限制提示词
 */
function getRangePrompt(module) {
    const rangeMode = module.rangeMode || 'specified';

    switch (rangeMode) {
        case 'unlimited':
            return "（数量：无限制）";
        case 'specified': {
            const maxCount = module.itemMax || 1;
            return `（数量：${maxCount}条）`;
        }
        case 'range': {
            const minCount = module.itemMin || 0;
            const maxCount = module.itemMax || 1;
            if (minCount === maxCount) {
                return `（数量：${minCount}条）`;
            } else {
                return `（数量：${minCount}~${maxCount}条）`;
            }
        }
        default:
            return "";
    }
}

/**
 * 获取模块输出模式的提示词
 * @param {Object} module 模块对象
 * @returns {string} 输出模式提示词
 */
function getOutputModePrompt(module) {
    const outputMode = module.outputMode || 'full';

    switch (outputMode) {
        case 'full':
            return "（输出：全量）";
        case 'incremental':
            return "（输出：增量）";
        default:
            return "";
    }
}

import { getContext } from '../../../../../extensions.js';

/**
 * 注册所有宏到SillyTavern系统
 * 使用SillyTavern扩展系统的标准API
 */
export function registerMacros() {
    try {
        debugLog("[Macro]宏管理器: 开始注册宏");

        // 使用SillyTavern扩展系统的标准方式获取上下文
        const context = getContext();

        if (context && typeof context.registerMacro === 'function') {
            // 注册宏
            context.registerMacro('CONTINUITY_PROMPT', getContinuityPrompt);
            debugLog("[Macro]宏管理器: 注册 {{CONTINUITY_PROMPT}} 宏");

            // context.registerMacro('CONTINUITY_CONFIG', getContinuityConfig);
            // debugLog("[Macro]宏管理器: 注册 {{CONTINUITY_CONFIG}} 宏");

            // context.registerMacro('CONTINUITY_MODULES', getContinuityModules);
            // debugLog("[Macro]宏管理器: 注册 {{CONTINUITY_MODULES}} 宏");

            context.registerMacro('CONTINUITY_ORDER', getContinuityOrder);
            debugLog("[Macro]宏管理器: 注册 {{CONTINUITY_ORDER}} 宏");

            context.registerMacro('CONTINUITY_USAGE_GUIDE', getContinuityUsageGuide);
            debugLog("[Macro]宏管理器: 注册 {{CONTINUITY_USAGE_GUIDE}} 宏");

            infoLog("[Macro]宏管理器: 成功注册所有宏");
            return true;
        } else {
            errorLog("[Macro]宏管理器: 无法获取有效的上下文或registerMacro方法");
            return false;
        }
    } catch (error) {
        errorLog("[Macro]宏管理器: 注册宏失败", error);
        return false;
    }
}

/**
 * 检查宏是否已注册
 * @returns {boolean} 宏是否已成功注册
 */
export function areMacrosRegistered() {
    try {
        const context = getContext();
        // 检查registerMacro方法是否存在
        return !!context && typeof context.registerMacro === 'function';
    } catch (error) {
        return false;
    }
}
