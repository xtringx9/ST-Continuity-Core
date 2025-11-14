/**
 * 宏管理器 - 负责注册和管理提示词宏
 * 允许用户在提示词中使用 {{CONTINUITY_PROMPT}} 等宏来自动插入模块提示词
 */

import { debugLog, errorLog, infoLog } from '../utils/logger.js';
import { getModulesData } from '../modules/moduleManager.js';
import { generateFormalPrompt } from '../modules/promptGenerator.js';
import { extension_settings, extensionName } from '../index.js';

/**
 * 获取完整的连续性提示词
 * 返回所有模块的格式化提示词内容
 * @returns {string} 完整的提示词内容
 */
export function getContinuityPrompt() {
    try {
        debugLog("宏管理器: 获取连续性提示词");

        // 检查全局开关状态
        const settings = extension_settings[extensionName];
        if (!settings || !settings.enabled) {
            debugLog("宏管理器: 全局开关已关闭，返回空提示词");
            return "";
        }

        // 获取模块数据
        const modulesData = getModulesData();

        if (!modulesData || modulesData.length === 0) {
            debugLog("宏管理器: 未找到模块数据，返回空提示词");
            return "";
        }

        // 生成正式提示词
        const prompt = generateFormalPrompt(modulesData);

        debugLog("宏管理器: 成功生成连续性提示词");
        return prompt;
    } catch (error) {
        errorLog("宏管理器: 获取连续性提示词失败", error);
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
        debugLog("宏管理器: 获取模块配置数据");

        // 检查全局开关状态
        const settings = extension_settings[extensionName];
        if (!settings || !settings.enabled) {
            debugLog("宏管理器: 全局开关已关闭，返回空配置");
            return "";
        }

        // 获取模块数据
        const modulesData = getModulesData();

        if (!modulesData || modulesData.length === 0) {
            debugLog("宏管理器: 未找到模块数据，返回空配置");
            return "";
        }

        // 转换为JSON格式
        const configJson = JSON.stringify(modulesData, null, 2);

        debugLog("宏管理器: 成功生成模块配置数据");
        return configJson;
    } catch (error) {
        errorLog("宏管理器: 获取模块配置数据失败", error);
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
        debugLog("宏管理器: 获取模块名称列表");

        // 检查全局开关状态
        const settings = extension_settings[extensionName];
        if (!settings || !settings.enabled) {
            debugLog("宏管理器: 全局开关已关闭，返回空列表");
            return "";
        }

        // 获取模块数据
        const modulesData = getModulesData();

        if (!modulesData || modulesData.length === 0) {
            debugLog("宏管理器: 未找到模块数据，返回空列表");
            return "";
        }

        // 提取模块名称
        const moduleNames = modulesData.map(module => module.name).filter(name => name);

        debugLog("宏管理器: 成功生成模块名称列表");
        return moduleNames.join(", ");
    } catch (error) {
        errorLog("宏管理器: 获取模块名称列表失败", error);
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
        debugLog("宏管理器: 获取连续性顺序提示词");

        // 检查全局开关状态
        const settings = extension_settings[extensionName];
        if (!settings || !settings.enabled) {
            debugLog("宏管理器: 全局开关已关闭，返回空提示词");
            return "";
        }

        // 获取模块数据
        const modulesData = getModulesData();

        if (!modulesData || modulesData.length === 0) {
            debugLog("宏管理器: 未找到模块数据，返回空提示词");
            return "";
        }

        // 过滤启用的模块
        const enabledModules = modulesData.filter(module => module.enabled !== false);

        if (enabledModules.length === 0) {
            debugLog("宏管理器: 没有启用的模块，返回空提示词");
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

        // 可嵌入模块（按序号排序）
        if (embeddableModules.length > 0) {
            embeddableModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += "可嵌入模块，不限制位置，可在任意位置使用：\n";
            embeddableModules.forEach(module => {
                orderPrompt += `[${module.name}] `;
                orderPrompt += "\n";
            });
            orderPrompt += "\n\n";
        }

        // 正文内模块（按序号排序）
        if (bodyModules.length > 0) {
            bodyModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += "正文内模块：\n";
            bodyModules.forEach(module => {
                orderPrompt += `[${module.name}] `;
                orderPrompt += "\n";
            });
            orderPrompt += "\n\n";
        }

        // 正文内特定位置模块（使用顺序提示词）
        if (specificPositionModules.length > 0) {
            specificPositionModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += "正文内特定位置模块：\n";
            specificPositionModules.forEach(module => {
                const positionPrompt = module.positionPrompt ? `（${module.positionPrompt}）` : "";
                orderPrompt += `[${module.name}]${positionPrompt} `;
                orderPrompt += "\n";
            });
            orderPrompt += "\n\n";
        }

        // 正文后模块（按序号排序）
        if (afterBodyModules.length > 0) {
            afterBodyModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += "正文后的模块：\n";
            afterBodyModules.forEach(module => {
                orderPrompt += `[${module.name}] `;
                orderPrompt += "\n";
            });
        }
        orderPrompt += "</module_order>\n";

        debugLog("宏管理器: 成功生成连续性顺序提示词");
        return orderPrompt.trim();
    } catch (error) {
        errorLog("宏管理器: 获取连续性顺序提示词失败", error);
        return "";
    }
}

import { getContext } from '/scripts/extensions.js';

/**
 * 注册所有宏到SillyTavern系统
 * 使用SillyTavern扩展系统的标准API
 */
export function registerMacros() {
    try {
        debugLog("宏管理器: 开始注册宏");

        // 使用SillyTavern扩展系统的标准方式获取上下文
        const context = getContext();

        if (context && typeof context.registerMacro === 'function') {
            // 注册宏
            context.registerMacro('CONTINUITY_PROMPT', getContinuityPrompt);
            debugLog("宏管理器: 注册 {{CONTINUITY_PROMPT}} 宏");

            context.registerMacro('CONTINUITY_CONFIG', getContinuityConfig);
            debugLog("宏管理器: 注册 {{CONTINUITY_CONFIG}} 宏");

            context.registerMacro('CONTINUITY_MODULES', getContinuityModules);
            debugLog("宏管理器: 注册 {{CONTINUITY_MODULES}} 宏");

            context.registerMacro('CONTINUITY_ORDER', getContinuityOrder);
            debugLog("宏管理器: 注册 {{CONTINUITY_ORDER}} 宏");

            infoLog("宏管理器: 成功注册所有宏");
            return true;
        } else {
            errorLog("宏管理器: 无法获取有效的上下文或registerMacro方法");
            return false;
        }
    } catch (error) {
        errorLog("宏管理器: 注册宏失败", error);
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
