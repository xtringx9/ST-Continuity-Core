/**
 * 宏管理器 - 负责注册和管理提示词宏
 * 允许用户在提示词中使用 {{CONTINUITY_PROMPT}} 等宏来自动插入模块提示词
 */

import { groupProcessResultByMessageIndex, chat, processModuleData, configManager, debugLog, errorLog, infoLog } from '../index.js';
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
        let orderPrompt = "<module_output_rules>\n";
        // orderPrompt += "模块生成顺序和配置：\n\n";

        // 添加输出模式说明
        orderPrompt += "[OUTPUT PROTOCOL]\n";
        orderPrompt += "• 增量(INC): Initialize full. ALWAYS output Identity keys + ONLY changed fields.\n";
        orderPrompt += "• 全量(FULL): Must output ALL fields. NO omissions allowed.\n\n";

        // 可嵌入模块（按序号排序）
        if (embeddableModules.length > 0) {
            embeddableModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += "可嵌入模块，不限制位置，应积极插入正文内：\n";
            embeddableModules.forEach(module => {
                const timingPrompt = module.timingPrompt ? `(Trigger:${module.timingPrompt})` : "";
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
                const timingPrompt = module.timingPrompt ? `(Trigger:${module.timingPrompt})` : "";
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
                const positionPrompt = module.positionPrompt ? `(Position:${module.positionPrompt})` : "";
                const timingPrompt = module.timingPrompt ? `(Trigger:${module.timingPrompt})` : "";
                const rangePrompt = getRangePrompt(module);
                const outputModePrompt = getOutputModePrompt(module);
                orderPrompt += `[${module.name}]${positionPrompt}${timingPrompt}${rangePrompt}${outputModePrompt} `;
                orderPrompt += "\n";
            });
            orderPrompt += "</某正文标签>\n";
            orderPrompt += "\n\n";
        }

        const moduleTag = configManager.getGlobalSettings().moduleTag || "module";

        // 正文后模块（按序号排序）
        if (afterBodyModules.length > 0) {
            afterBodyModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += `正文后的模块（位于正文结束标签后，被<${moduleTag}></${moduleTag}>包裹）：\n`;
            orderPrompt += "</某正文标签>\n";
            orderPrompt += `<${moduleTag}>\n`;
            afterBodyModules.forEach(module => {
                const timingPrompt = module.timingPrompt ? `(Trigger:${module.timingPrompt})` : "";
                const rangePrompt = getRangePrompt(module);
                const outputModePrompt = getOutputModePrompt(module);
                orderPrompt += `[${module.name}]${timingPrompt}${rangePrompt}${outputModePrompt} `;
                orderPrompt += "\n";
            });
        }
        orderPrompt += `</${moduleTag}>\n\n`;
        orderPrompt += "</module_output_rules>\n";

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
            return "(Quantity:∞)";
        case 'specified': {
            const maxCount = module.itemMax || 1;
            return `(Quantity:${maxCount})`;
        }
        case 'range': {
            const minCount = module.itemMin || 0;
            const maxCount = module.itemMax || 1;
            if (minCount === maxCount) {
                return `(Quantity:${minCount})`;
            } else {
                return `(Quantity:${minCount}-${maxCount})`;
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
            return "(Output:FULL,All Fields)";
        case 'incremental':
            return "(Output:INC,Only changes)";
        default:
            return "";
    }
}

function getContinuityModuleData() {
    const isUserMessage = chat[chat.length - 1].is_user || chat[chat.length - 1].role === 'user';
    const endIndex = chat.length - 1 - (isUserMessage ? 0 : 1);
    // 提取全部聊天记录的所有模块数据（一次性获取）
    const extractParams = {
        startIndex: 0,
        endIndex: endIndex, // null表示提取到最新楼层
        moduleFilters: getContextBottomFilteredModuleConfigs() // 只提取符合条件的模块
    };
    const selectedModuleNames = extractParams.moduleFilters.map(config => config.name);

    // 一次性获取所有模块数据
    const processResult = processModuleData(
        extractParams,
        'auto', // 自动处理类型
        selectedModuleNames,
        false,
        true
    );
    return `<module_data>\n最新模块数据：\n${processResult.contentString}\n</module_data>\n`;
}

function getContextBottomFilteredModuleConfigs() {
    // 获取所有模块配置
    const allModuleConfigs = configManager.getModules();
    // 过滤出符合条件的模块：outputPosition为after_body且outputMode为full的模块，和所有outputMode为incremental的模块
    const filteredModuleConfigs = allModuleConfigs.filter(config => {
        const result = (config.outputPosition === 'after_body' && config.outputMode === 'full' && config.retainLayers === -1) ||
            config.outputMode === 'incremental';
        // debugLog(`模块 ${config.name} 过滤结果: ${result}, outputPosition: ${config.outputPosition}, outputMode: ${config.outputMode}`);
        return result;
    });
    debugLog(`[CUSTOM STYLES] 总模块数: ${allModuleConfigs.length}, 过滤后模块数: ${filteredModuleConfigs.length}`);
    debugLog(`[CUSTOM STYLES] 过滤后的模块列表: ${filteredModuleConfigs.map(config => config.name).join(', ')}`);
    // 构建模块过滤条件数组
    const moduleFilters = filteredModuleConfigs.map(config => ({
        name: config.name,
        compatibleModuleNames: config.compatibleModuleNames || []
    }));
    return moduleFilters;
}

function getContinuityChatModule(index) {
    debugLog('[MACRO] 模块内容索引:', index);

    const isUserMessage = chat[chat.length - 1].is_user || chat[chat.length - 1].role === 'user';
    const endIndex = chat.length - 1 - (isUserMessage ? 0 : 1);

    // 提取全部聊天记录的所有模块数据（一次性获取）
    const extractParams = {
        startIndex: 0,
        endIndex: endIndex, // null表示提取到最新楼层
        moduleFilters: getChatFilteredModuleConfigs()
    };

    const selectedModuleNames = extractParams.moduleFilters.map(config => config.name);


    // 一次性获取所有模块数据
    const processResult = processModuleData(
        extractParams,
        'auto', // 自动处理类型
        selectedModuleNames
    );
    // debugLog('[MACRO] 模块提取结果:', processResult);



    const curIndex = chat.length - 1 - (isUserMessage ? index : index + 1);
    const groupedByMessageIndex = groupProcessResultByMessageIndex(processResult);
    const modulesForThisMessage = groupedByMessageIndex[curIndex] || [];
    debugLog(`[MACRO] 当前聊天索引为${curIndex}模块index分组结果:`, groupedByMessageIndex);
    // debugLog(`[MACRO] 聊天索引${curIndex}模块结果:`, modulesForThisMessage);

    // todo 可能还要判断remainLayers去决定要不要加进去

    let resultString = '';
    if (modulesForThisMessage.length > 0) {
        let lastModuleName = '';
        modulesForThisMessage.forEach((entry, index) => {
            // 判断模块名是否连续一致
            if (index === 0 || entry.moduleName !== lastModuleName) {
                // 第一条或模块名不同时，输出模块名标题
                resultString += `## ${entry.moduleName}\n`;
            }
            resultString += entry.moduleString + '\n';
            lastModuleName = entry.moduleName;
        });
    }

    debugLog(`[MACRO] 当前聊天索引为${curIndex}模块输出:`, resultString);

    const moduleTag = configManager.getGlobalSettings().moduleTag || "module";
    return `<${moduleTag}>\n${resultString}\n</${moduleTag}>`;
}

function getChatFilteredModuleConfigs() {
    // 获取所有模块配置
    const allModuleConfigs = configManager.getModules();
    // 过滤出符合条件的模块：outputPosition为after_body且outputMode为full的模块，和所有outputMode为incremental的模块
    const filteredModuleConfigs = allModuleConfigs.filter(config => {
        const result = (config.outputPosition === 'after_body' && config.outputMode === 'full') ||
            config.outputMode === 'incremental';
        // debugLog(`模块 ${config.name} 过滤结果: ${result}, outputPosition: ${config.outputPosition}, outputMode: ${config.outputMode}`);
        return result;
    });
    debugLog(`[CUSTOM STYLES] 总模块数: ${allModuleConfigs.length}, 过滤后模块数: ${filteredModuleConfigs.length}`);
    debugLog(`[CUSTOM STYLES] 过滤后的模块列表: ${filteredModuleConfigs.map(config => config.name).join(', ')}`);
    // 构建模块过滤条件数组
    const moduleFilters = filteredModuleConfigs.map(config => ({
        name: config.name,
        compatibleModuleNames: config.compatibleModuleNames || []
    }));
    return moduleFilters;
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
