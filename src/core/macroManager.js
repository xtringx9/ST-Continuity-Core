/**
 * 宏管理器 - 负责注册和管理提示词宏
 * 允许用户在提示词中使用 {{CONTINUITY_PROMPT}} 等宏来自动插入模块提示词
 */

import { groupProcessResultByMessageIndex, chat, processModuleData, configManager, debugLog, errorLog, infoLog } from '../index.js';
import { generateSingleChatModuleData, generateModuleDataPrompt, generateModuleOrderPrompt, generateUsageGuide, generateFormalPrompt } from '../modules/promptGenerator.js';
import { extension_settings, extensionName, loadModuleConfig } from '../index.js';
import { replaceVariables } from '../utils/variableReplacer.js';

/**
 * 获取完整的连续性提示词
 * 返回所有模块的格式化提示词内容
 * @returns {string} 完整的提示词内容
 */
export function getContinuityPrompt() {
    try {
        if (!configManager.isExtensionEnabled()) {
            debugLog("[Macro]宏管理器: 扩展未启用，返回空提示词");
            return "";
        }

        // 生成正式提示词
        const prompt = generateFormalPrompt();

        // // 替换提示词中的变量
        // const replacedPrompt = replaceVariables(prompt);

        debugLog("[Macro]宏管理器: 成功生成并替换变量后的连续性提示词");
        return prompt;
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
        if (!configManager.isExtensionEnabled()) {
            debugLog("[Macro]宏管理器: 扩展未启用，返回空提示词");
            return "";
        }
        debugLog("[Macro]宏管理器: 获取模块配置数据");

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
        if (!configManager.isExtensionEnabled()) {
            debugLog("[Macro]宏管理器: 扩展未启用，返回空提示词");
            return "";
        }
        debugLog("[Macro]宏管理器: 获取模块名称列表");


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
        if (!configManager.isExtensionEnabled()) {
            debugLog("[Macro]宏管理器: 扩展未启用，返回空提示词");
            return "";
        }

        debugLog("[Macro]宏管理器: 获取模块使用指导提示词");

        const prompt = generateUsageGuide();

        debugLog("[Macro]宏管理器: 成功生成并替换变量后的模块使用指导提示词");
        return prompt;
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
        if (!configManager.isExtensionEnabled()) {
            debugLog("[Macro]宏管理器: 扩展未启用，返回空提示词");
            return "";
        }

        debugLog("[Macro]宏管理器: 获取连续性顺序提示词");

        // 生成连续性顺序提示词
        const prompt = generateModuleOrderPrompt();

        debugLog("[Macro]宏管理器: 成功生成并替换变量后的连续性顺序提示词");
        return prompt;
    } catch (error) {
        errorLog("[Macro]宏管理器: 获取连续性顺序提示词失败", error);
        return "";
    }
}


function getContinuityModuleData() {
    try {
        if (!configManager.isExtensionEnabled()) {
            debugLog("[Macro]宏管理器: 扩展未启用，返回空提示词");
            return "";
        }

        debugLog("[Macro]宏管理器: 获取连续性模块数据");

        // 生成连续性模块数据提示词
        const prompt = generateModuleDataPrompt();

        debugLog("[Macro]宏管理器: 成功生成并替换变量后的连续性模块数据提示词");
        return prompt;
    } catch (error) {
        errorLog("[Macro]宏管理器: 获取连续性模块数据失败", error);
        return "";
    }
}


function getContinuityChatModule(index) {
    try {
        if (!configManager.isExtensionEnabled()) {
            debugLog("[Macro]宏管理器: 扩展未启用，返回空提示词");
            return "";
        }

        debugLog(`[Macro]宏管理器: 获取聊天消息 ${index} 的连续性模块数据`);

        // 生成连续性模块数据提示词
        const prompt = generateSingleChatModuleData(index);

        debugLog(`[Macro]宏管理器: 成功生成并替换变量后的聊天消息 ${index} 的连续性模块数据提示词`);
        return prompt;
    } catch (error) {
        errorLog(`[Macro]宏管理器: 获取聊天消息 ${index} 的连续性模块数据失败`, error);
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

            context.registerMacro('CONTINUITY_MODULE_DATA', getContinuityModuleData);
            debugLog("[Macro]宏管理器: 注册 {{CONTINUITY_MODULE_DATA}} 宏");

            const entryCount = configManager.getGlobalSettings().contentRemainLayers || 9;
            for (let i = 0; i < entryCount; i++) {
                // 只在奇数索引时生成
                if (i % 2 === 1) {
                    // 创建包装函数来传递索引值
                    const getContinuityChatModuleWithIndex = () => getContinuityChatModule(i);
                    context.registerMacro(`CONTINUITY_CHAT_MODULE_${i}`, getContinuityChatModuleWithIndex);
                    debugLog(`[Macro]宏管理器: 注册 {{CONTINUITY_CHAT_MODULE_${i}}} 宏，索引值: ${i}`);
                }
            }

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
