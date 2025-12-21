// 提示词生成器模块
import { processModuleData, groupProcessResultByMessageIndex, chat, configManager, debugLog, errorLog, infoLog, extension_settings, extensionName, loadModuleConfig } from "../index.js";
import { replaceVariables } from "../utils/variableReplacer.js";

// 默认插入设置
const DEFAULT_INSERTION_SETTINGS = {
    depth: 1,
    role: 'system'
};

/**
 * 生成正式提示词
 * @returns {string} 生成的正式提示词
 */
export function generateFormalPrompt() {
    try {
        const globalSettings = configManager.getGlobalSettings();
        const moduleTag = globalSettings.moduleTag || "module";
        const promptTag = `${moduleTag}_generate_rule`;

        const modules = configManager.getModules() || [];
        debugLog('开始生成正式提示词，模块数量:', modules.length);

        // 过滤掉未启用的模块
        const enabledModules = modules.filter(module => module.enabled !== false);

        if (enabledModules.length === 0) {
            infoLog('没有启用的模块，无法生成提示词');
            return '';
        }

        let prompt = `<${promptTag}>\n`;


        prompt += getOutputRulePrompt('prompt');

        prompt += '# 模块配置\n';

        // 按模块顺序生成提示词，按照新格式组织
        enabledModules.forEach((module, index) => {
            prompt += `${configManager.MODULE_TITLE_LEFT}${module.name}${module.displayName ? ` (${module.displayName})` : ""}${configManager.MODULE_TITLE_RIGHT}\n`;

            prompt += getModuleRules(module, module.outputPosition === 'specific_position');

            // 要求：使用prompt内容
            if (module.prompt) {
                prompt += `requirement:${module.prompt}\n`;
            }

            prompt += 'format:' + generateModuleFormat(module);

            // 模块之间添加空行分隔
            prompt += '\n';
        });

        prompt += `</${promptTag}>\n`;

        // 替换提示词中的变量
        const replacedPrompt = replaceVariables(prompt);

        // infoLog('正式提示词生成成功');

        // 使用logger输出生成的提示词
        // debugLog('=== Continuity 生成的正式提示词 ===');
        // debugLog(replacedPrompt);
        // debugLog('===================================');

        return replacedPrompt;

    } catch (error) {
        errorLog('生成正式提示词失败:', error);
        return '生成提示词时发生错误：' + error.message;
    }
}

export function generateModuleFormat(module, needIdentifier = true) {
    let result = '';
    // 格式：生成变量描述格式
    if (module.variables && module.variables.length > 0) {
        const variableDescriptions = module.variables.map(variable => {
            const variableName = variable.name;
            const variableDesc = variable.description ? `${variable.description}` : '';
            return `${module.outputMode === 'full' ? '' : needIdentifier && variable.isIdentifier ? '*' : needIdentifier && variable.isBackupIdentifier ? '^' : ''}${variableName}:${variableDesc}`;
        }).join('|');

        result = `[${module.name}|${variableDescriptions}]\n`;
    } else {
        result = `[${module.name}]\n`;
    }
    return result;
}

export function generateUsageGuide() {
    try {
        const moduleTag = configManager.getGlobalSettings().moduleTag || "module";
        const promptTag = `${moduleTag}_data_usage_guide`;

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
        let usageGuide = `<${promptTag}>\n`;

        usageGuide += getOutputRulePrompt('usage');

        usageGuide += "# 模块内容使用指导\n\n";

        modulesWithUsagePrompt.forEach(module => {
            usageGuide += `${configManager.MODULE_TITLE_LEFT}${module.name}${module.displayName ? ` (${module.displayName})` : ""}${configManager.MODULE_TITLE_RIGHT}\n`;
            usageGuide += `usage:${module.contentPrompt}\n\n`;
        });

        usageGuide += `</${promptTag}>\n`;

        // 替换提示词中的变量
        const replacedUsageGuide = replaceVariables(usageGuide.trim());

        return replacedUsageGuide;
    } catch (error) {
        errorLog('生成使用指导提示词失败:', error);
        return '生成提示词时发生错误：' + error.message;
    }
}

// export function generateModuleOrderPrompt() {
//     try {
//         const globalSettings = configManager.getGlobalSettings();
//         const moduleTag = globalSettings.moduleTag || "module";
//         const promptTag = `${moduleTag}_output_rule`;
//         const contentTag = globalSettings.contentTag || "content";
//         let contentTagString = Array.isArray(contentTag) ? contentTag.join(',') : contentTag;
//         contentTagString = contentTagString + ",...";

//         // 获取模块数据
//         const modulesData = configManager.getModules() || [];

//         if (!modulesData || modulesData.length === 0) {
//             debugLog("[Macro]宏管理器: 未找到模块数据，返回空提示词");
//             return "";
//         }

//         // 过滤启用的模块
//         const enabledModules = modulesData.filter(module => module.enabled !== false);

//         if (enabledModules.length === 0) {
//             debugLog("[Macro]宏管理器: 没有启用的模块，返回空提示词");
//             return "";
//         }

//         // 按照生成位置和序号分组
//         const embeddableModules = []; // 可嵌入模块
//         const bodyModules = []; // 正文内模块
//         const specificPositionModules = []; // 正文内特定位置模块
//         const afterBodyModules = []; // 正文后模块

//         // 分类模块
//         enabledModules.forEach(module => {
//             switch (module.outputPosition) {
//                 case 'embedded':
//                     embeddableModules.push(module);
//                     break;
//                 case 'body':
//                     bodyModules.push(module);
//                     break;
//                 case 'specific_position':
//                     specificPositionModules.push(module);
//                     break;
//                 case 'after_body':
//                     afterBodyModules.push(module);
//                     break;
//                 default:
//                     // 默认归为正文后模块
//                     afterBodyModules.push(module);
//             }
//         });

//         // 构建顺序提示词
//         let orderPrompt = `<${promptTag}>\n`;
//         // orderPrompt += "模块生成顺序和配置：\n\n";

//         let formatPrompt = getOutputRulePrompt('order');
//         if (formatPrompt) {
//             orderPrompt += formatPrompt;
//             // orderPrompt += "# 格式与顺序\n";
//         }


//         // orderPrompt += "Format: [Module]|Trigger|Qty|Mode|Pos/Note*\n\n";

//         // 可嵌入模块（按序号排序）
//         if (embeddableModules.length > 0) {
//             embeddableModules.sort((a, b) => (a.order || 0) - (b.order || 0));
//             // orderPrompt += "[DURING GENERATION]\n";
//             orderPrompt += "# 可嵌入模块，不限制位置，应积极插入正文内\n";
//             embeddableModules.forEach(module => {
//                 orderPrompt += buildModulePrompt(module);
//             });
//             orderPrompt += "\n\n";
//         }

//         // 正文内模块（按序号排序）
//         if (bodyModules.length > 0) {
//             bodyModules.sort((a, b) => (a.order || 0) - (b.order || 0));
//             // orderPrompt += "[STRUCTURED IN-TEXT]\n";
//             orderPrompt += `# 正文内模块(位于<${contentTagString}></${contentTagString}>内):\n`;
//             bodyModules.forEach(module => {
//                 orderPrompt += buildModulePrompt(module);
//             });
//             orderPrompt += "\n\n";
//         }

//         // 正文内特定位置模块（使用顺序提示词）
//         if (specificPositionModules.length > 0) {
//             specificPositionModules.sort((a, b) => (a.order || 0) - (b.order || 0));
//             // orderPrompt += "[STRUCTURED IN-TEXT]\n";
//             orderPrompt += `# 正文内特定位置模块(位于\`<${contentTagString}>\`后，被<${contentTagString}></${contentTagString}>包裹):\n`;
//             orderPrompt += `<${contentTagString}>\n`;
//             specificPositionModules.forEach(module => {
//                 orderPrompt += buildModulePrompt(module, false, false, true);
//             });
//             orderPrompt += `</${contentTagString}>\n`;
//             orderPrompt += "\n\n";
//         }

//         // 正文后模块（按序号排序）
//         if (afterBodyModules.length > 0) {
//             afterBodyModules.sort((a, b) => (a.order || 0) - (b.order || 0));
//             // orderPrompt += "[AFTER TEXT GENERATION]\n";
//             orderPrompt += `# 正文后的模块(位于\`</${contentTagString}>\`后，被<${moduleTag}></${moduleTag}>包裹):\n`;
//             orderPrompt += `</${contentTagString}>\n`;
//             orderPrompt += `<${moduleTag}_update>\n`;
//             afterBodyModules.forEach(module => {
//                 orderPrompt += buildModulePrompt(module, true);
//             });
//         }
//         orderPrompt += `</${moduleTag}_update>\n\n`;
//         orderPrompt += `</${promptTag}>\n`;

//         // 替换提示词中的变量
//         const replacedOrderPrompt = replaceVariables(orderPrompt.trim());
//         return replacedOrderPrompt;
//     } catch (error) {
//         errorLog('生成模块顺序提示词失败:', error);
//         return '生成提示词时发生错误：' + error.message;
//     }
// }

export function generateModuleOrderPrompt() {
    try {
        const globalSettings = configManager.getGlobalSettings();
        const moduleTag = globalSettings.moduleTag || "module";
        const moduleUpdateTag = globalSettings.moduleUpdateTag || "module_update";
        const promptTag = `${moduleTag}_output_rule`;
        const contentTag = globalSettings.contentTag;
        let contentTagString = Array.isArray(contentTag) ? contentTag.join(',') : contentTag;
        if (Array.isArray(contentTag) && contentTag.length > 1) contentTagString = contentTagString + ",...";

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
        const bodyStartModules = []; // 正文内开头模块
        const bodyEndModules = []; // 正文内结尾模块
        const bodySurroundModules = []; // 正文内模块
        const specificPositionModules = []; // 正文内特定位置模块
        const afterBodyModules = []; // 正文后模块

        const inBodyModules = []; // 正文内模块

        // 分类模块
        enabledModules.forEach(module => {
            switch (module.outputPosition) {
                case 'embedded':
                    embeddableModules.push(module);
                    break;
                case 'body':
                    bodyModules.push(module);
                    inBodyModules.push(module);
                    break;
                case 'body_start':
                    bodyStartModules.push(module);
                    inBodyModules.push(module);
                    break;
                case 'body_end':
                    bodyEndModules.push(module);
                    inBodyModules.push(module);
                    break;
                case 'body_surround':
                    bodySurroundModules.push(module);
                    inBodyModules.push(module);
                    break;
                case 'specific_position':
                    specificPositionModules.push(module);
                    inBodyModules.push(module);
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
        let orderPrompt = `<${promptTag}>\n`;
        // orderPrompt += "模块生成顺序和配置：\n\n";

        let formatPrompt = getOutputRulePrompt('order');
        if (formatPrompt) {
            orderPrompt += formatPrompt;
            // orderPrompt += "# 格式与顺序\n";
        }


        // orderPrompt += "Format: [Module]|Trigger|Qty|Mode|Pos/Note*\n\n";

        // 可嵌入模块（按序号排序）
        if (embeddableModules.length > 0) {
            embeddableModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            // orderPrompt += "[DURING GENERATION]\n";
            orderPrompt += "# 可嵌入模块，不限制位置，应积极插入正文内\n";
            embeddableModules.forEach(module => {
                orderPrompt += buildModulePrompt(module);
            });
            orderPrompt += "\n\n";
        }

        const contentTagPrompt = contentTagString ? `(位于<${contentTagString}></${contentTagString}>内)` : "";
        // 正文内模块（按序号排序）
        if (bodyModules.length > 0 || bodySurroundModules.length > 0 || specificPositionModules.length > 0) {
            if (bodyModules.length > 0) bodyModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            if (bodySurroundModules.length > 0) bodySurroundModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            if (specificPositionModules.length > 0) specificPositionModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            orderPrompt += `# 正文内模块${contentTagPrompt}:\n`;
            if (contentTagString) { orderPrompt += `<${contentTagString}>\n`; }
            bodyStartModules.forEach(module => {
                orderPrompt += buildModulePrompt(module, false, false, true, "正文内首先输出");
            });
            bodySurroundModules.forEach(module => {
                orderPrompt += buildModulePrompt(module, false, false, true, "正文内首先输出");
            });
            specificPositionModules.forEach(module => {
                orderPrompt += buildModulePrompt(module, false, false, true);
            });
            bodyModules.forEach(module => {
                orderPrompt += buildModulePrompt(module);
            });
            // inBodyModules.forEach(module => {
            //     orderPrompt += buildModulePrompt(module, false, false, specificPositionModules.includes(module) ? true : false);
            // });
            bodySurroundModules.forEach(module => {
                orderPrompt += buildModulePrompt(module, false, false, true, "正文内最后输出");
            });
            bodyEndModules.forEach(module => {
                orderPrompt += buildModulePrompt(module, false, false, true, "正文内最后输出");
            });
            if (contentTagString) { orderPrompt += `</${contentTagString}>\n`; }
            orderPrompt += "\n";
        }

        const afterContentTagPrompt = contentTagString ? `位于\`</${contentTagString}>\`后，` : "";
        // 正文后模块（按序号排序）
        if (afterBodyModules.length > 0) {
            afterBodyModules.sort((a, b) => (a.order || 0) - (b.order || 0));
            // orderPrompt += "[AFTER TEXT GENERATION]\n";
            orderPrompt += `# 正文后的模块(${afterContentTagPrompt}被<${moduleUpdateTag}></${moduleUpdateTag}>包裹):\n`;
            // orderPrompt += `</${contentTagString}>\n`;
            orderPrompt += `<${moduleUpdateTag}>\n`;
            afterBodyModules.forEach(module => {
                orderPrompt += buildModulePrompt(module, true);
            });
        }
        orderPrompt += `</${moduleUpdateTag}>\n\n`;
        orderPrompt += `</${promptTag}>\n`;

        // 替换提示词中的变量
        const replacedOrderPrompt = replaceVariables(orderPrompt.trim());
        return replacedOrderPrompt;
    } catch (error) {
        errorLog('生成模块顺序提示词失败:', error);
        return '生成提示词时发生错误：' + error.message;
    }
}

function getOutputRulePrompt(type, title = "# 模块输出要求") {
    const globalSettings = configManager.getGlobalSettings();

    // let prompt = title + '\n';
    let settingPrompt = '';
    switch (type) {
        case 'prompt':
            // 添加核心原则提示词（如果设置了）
            if (globalSettings?.prompt) {
                settingPrompt += `${globalSettings.prompt}\n\n`;
            }
            break;
        case 'order':
            // 添加通用格式描述提示词（如果设置了）
            if (globalSettings?.orderPrompt) {
                settingPrompt += `${globalSettings.orderPrompt}\n\n`;
            }
            break;
        case 'usage':
            // 添加使用说明提示词（如果设置了）
            if (globalSettings?.usagePrompt) {
                settingPrompt += `${globalSettings.usagePrompt}\n\n`;
            }
            break;
        case 'moduleData':
            // 添加模块数据提示词（如果设置了）
            if (globalSettings?.moduleDataPrompt) {
                settingPrompt += `${globalSettings.moduleDataPrompt}\n\n`;
            }
            break;
        case 'all':
            // 添加核心原则提示词（如果设置了）
            if (globalSettings?.prompt) {
                settingPrompt += `${globalSettings.prompt}\n\n`;
            }
            // 添加通用格式描述提示词（如果设置了）
            if (globalSettings?.orderPrompt) {
                settingPrompt += `${globalSettings.orderPrompt}\n\n`;
            }
            break;
        default:
            return '';
    }

    // // 添加输出模式说明
    // prompt += "[OUTPUT PROTOCOL]\n";
    // prompt += "增量(INC): Initialize full. ALWAYS output keys marked * or ^ + ONLY changed fields.\n";
    // prompt += "全量(FULL): Must output ALL fields. NO omissions allowed.\n\n";
    // if (settingPrompt) return prompt + settingPrompt;
    return settingPrompt
    // return '';
}

/**
 * 构建模块提示词字符串
 * @param {Object} module 模块对象
 * @param {boolean} includePosition 是否包含位置提示词
 * @returns {string} 模块提示词字符串
 */
function buildModulePrompt(module, needTitle = false, needRules = false, includePosition = false, positionPrompt = "") {
    let prompt = needTitle ? `${configManager.MODULE_TITLE_LEFT}${module.name}${configManager.MODULE_TITLE_RIGHT}\n` : '';
    if (needRules) {
        prompt += `> ` + getModuleRules(module, includePosition, true);
    }
    if ((!needTitle || !needRules) && includePosition) {
        prompt += `[${module.name}|...](${positionPrompt || getModulePositionPrompt(module, includePosition)})\n`;
    }
    else {
        prompt += `[${module.name}|...]\n`;
    }
    if (module.outputPosition !== 'embedded' && module.outputPosition !== 'body' && module.outputPosition !== 'body_surround' && !(module.rangeMode === 'specified' || module.itemMax == 1)) {
        prompt += '...\n';
        prompt += `[${module.name}|...]\n`;
    }
    return prompt;
}

function getModuleRules(module, includePosition = false, oneline = false) {
    const positionPrompt = getModulePositionPrompt(module, includePosition);
    const timingPrompt = getModuleTimingPrompt(module);
    const rangePrompt = getRangePrompt(module);
    const outputModePrompt = getOutputModePrompt(module);

    // 构建提示词，如果内容不为空则添加分号分隔
    const parts = [];
    if (timingPrompt) parts.push(timingPrompt);
    if (rangePrompt) parts.push(rangePrompt);
    if (outputModePrompt) parts.push(outputModePrompt);
    if (positionPrompt) parts.push(positionPrompt);

    let prompt = '';
    if (oneline) {
        prompt = parts.length > 0 ? parts.join('; ') + '\n' : '';
    }
    else {
        prompt = parts.length > 0 ? parts.join('\n') + '\n' : '';
    }
    return prompt;
}

function getModulePositionPrompt(module, includePosition = false) {
    return includePosition && module.positionPrompt ? `position:${module.positionPrompt}` : "";
}

function getModuleTimingPrompt(module) {
    return module.timingPrompt ? `trigger:${module.timingPrompt}` : "";
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
            return "quantity:∞";
        case 'specified': {
            const maxCount = module.itemMax || 1;
            return `quantity:${maxCount}`;
        }
        case 'range': {
            const minCount = module.itemMin || 0;
            const maxCount = module.itemMax || 1;
            if (minCount === maxCount) {
                return `quantity:${minCount}`;
            } else {
                return `quantity:${minCount}-${maxCount}`;
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
            return "output mode:全量";
        case 'incremental':
            return "output mode:增量";
        default:
            return "";
    }
}


export function generateModuleDataPrompt() {
    try {
        const moduleTag = configManager.getGlobalSettings().moduleTag || "module";
        const promptTag = `${moduleTag}_data`;
        if (!chat || chat.length < 1) return `<${promptTag}>\n</${promptTag}>`;
        // infoLog("Chat:", chat);
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
            true,
            // false,
            // false,
            // false,
            // true
        );
        let moduleDataPrompt = `<${promptTag}>\n`;
        moduleDataPrompt += getOutputRulePrompt('moduleData');
        moduleDataPrompt += `# 最新模块数据\n\n${processResult.contentString}\n</${promptTag}>\n`;
        // 替换提示词中的变量
        const replacedModuleDataPrompt = replaceVariables(moduleDataPrompt.trim());
        return replacedModuleDataPrompt;
    } catch (error) {
        errorLog('生成模块数据提示词失败:', error);
        return '生成提示词时发生错误：' + error.message;
    }
}
function getContextBottomFilteredModuleConfigs() {
    // 获取所有模块配置
    const allModuleConfigs = configManager.getModules();
    // 过滤出符合条件的模块：outputPosition为after_body且outputMode为full的模块，和所有outputMode为incremental的模块
    const filteredModuleConfigs = allModuleConfigs.filter(config => {
        const result = (config.outputPosition === 'after_body' && config.outputMode === 'full' && config.retainLayers !== 0) ||
            config.outputMode === 'incremental';
        // debugLog(`模块 ${config.name} 过滤结果: ${result}, outputPosition: ${config.outputPosition}, outputMode: ${config.outputMode}`);
        return result;
    });
    // debugLog(`[CUSTOM STYLES] 总模块数: ${allModuleConfigs.length}, 过滤后模块数: ${filteredModuleConfigs.length}`);
    // debugLog(`[CUSTOM STYLES] 过滤后的模块列表: ${filteredModuleConfigs.map(config => config.name).join(', ')}`);
    // 构建模块过滤条件数组
    const moduleFilters = filteredModuleConfigs.map(config => ({
        name: config.name,
        compatibleModuleNames: config.compatibleModuleNames || []
    }));
    return moduleFilters;
}

export function generateSingleChatModuleData(index) {
    try {
        debugLog('[MACRO] 模块内容索引:', index);

        const moduleUpdateTag = configManager.getGlobalSettings().moduleUpdateTag || "module_update";
        const promptTag = `${moduleUpdateTag}`;
        if (!chat || chat.length < 1) return `<${promptTag}>\n</${promptTag}>`;
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

        let resultString = '';
        if (modulesForThisMessage.length > 0) {
            let lastModuleName = '';
            modulesForThisMessage.forEach((entry, index) => {
                // 判断模块名是否连续一致
                if (index === 0 || entry.moduleName !== lastModuleName) {
                    if (lastModuleName !== '') {
                        resultString += '\n';
                    }
                    // 第一条或模块名不同时，输出模块名标题
                    resultString += `${configManager.MODULE_TITLE_LEFT}${entry.moduleName}${configManager.MODULE_TITLE_RIGHT}\n`;
                }
                // 获取当前entry的模块配置
                const moduleConfig = configManager.getModules().find(module => module.name === entry.moduleName);
                let shouldFilter = false;
                let retainLayers = moduleConfig.retainLayers * 2;
                if (retainLayers >= 0) {
                    if (index > retainLayers) {
                        shouldFilter = true;
                    }
                }
                // if (!entry.shouldHide) {
                if (!shouldFilter) {
                    resultString += entry.moduleString + '\n';
                }
                // }
                lastModuleName = entry.moduleName;
            });
        }

        debugLog(`[MACRO] 当前聊天索引为${curIndex}模块输出:`, resultString);

        const prompt = `<${promptTag}>\n${resultString}\n</${promptTag}>`;
        // 替换提示词中的变量
        const replacedPrompt = replaceVariables(prompt.trim());
        return replacedPrompt;

    } catch (error) {
        errorLog(`生成聊天消息 ${index} 的模块数据提示词失败:`, error);
        return "";
    }
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
    // debugLog(`[CUSTOM STYLES] 总模块数: ${allModuleConfigs.length}, 过滤后模块数: ${filteredModuleConfigs.length}`);
    // debugLog(`[CUSTOM STYLES] 过滤后的模块列表: ${filteredModuleConfigs.map(config => config.name).join(', ')}`);
    // 构建模块过滤条件数组
    const moduleFilters = filteredModuleConfigs.map(config => ({
        name: config.name,
        compatibleModuleNames: config.compatibleModuleNames || []
    }));
    return moduleFilters;
}

/**
 * 生成模块组织后的提示词（不包含结构化信息）
 * @returns {string} 模块组织后的提示词
 */
export function generateModulePrompt() {
    try {
        return generateFormalPrompt();
    } catch (error) {
        errorLog('生成模块提示词失败:', error);
        return '生成提示词时发生错误：' + error.message;
    }
}

/**
 * 生成带有插入设置的提示词
 * @param {Object} insertionSettings 插入设置
 * @param {number} insertionSettings.depth 插入深度
 * @param {string} insertionSettings.role 插入角色
 * @returns {string} 带有插入设置的提示词
 */
export function generatePromptWithInsertion(insertionSettings = DEFAULT_INSERTION_SETTINGS) {
    try {
        const { depth, role } = insertionSettings;
        const prompt = generateFormalPrompt();

        // 生成扩展提示词
        const extensionPrompt = `{
    "depth": ${depth},
    "role": "${role}",
    "content": "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"
}`;

        debugLog(`生成带有插入设置的提示词: 深度=${depth}, 角色=${role}`);

        // 使用logger输出生成的扩展提示词
        debugLog('=== Continuity 生成的扩展提示词（带插入设置） ===');
        debugLog(extensionPrompt);
        debugLog('================================================');

        return extensionPrompt;

    } catch (error) {
        errorLog('生成带有插入设置的提示词失败:', error);
        return '生成提示词时发生错误：' + error.message;
    }
}

/**
 * 生成模块结构预览HTML
 * @returns {string} 模块结构预览HTML
 */
export function generateStructurePreview() {
    try {
        const modules = configManager.getModules() || [];
        debugLog('生成模块结构预览，模块数量:', modules.length);

        // 过滤掉未启用的模块
        const enabledModules = modules.filter(module => module.enabled !== false);

        if (enabledModules.length === 0) {
            return '<div class="structure-item">暂无启用的模块配置</div>';
        }

        let structureHTML = '';

        enabledModules.forEach((module, index) => {
            const moduleNumber = index + 1;

            structureHTML += `<div class="structure-item">
                <div class="structure-module-name">${moduleNumber}. ${module.name}</div>`;

            if (module.variables && module.variables.length > 0) {
                structureHTML += '<div class="structure-variables">';
                module.variables.forEach(variable => {
                    const description = variable.description ? ` - ${variable.description}` : '';
                    structureHTML += `<div class="structure-variable">• ${variable.name}${description}</div>`;
                });
                structureHTML += '</div>';
            }

            // 添加模块格式预览
            const variablesPreview = module.variables && module.variables.length > 0
                ? module.variables.map(v => `${v.name}:值`).join('|')
                : '';

            const moduleFormat = variablesPreview
                ? `[${module.name}|${variablesPreview}]`
                : `[${module.name}]`;

            structureHTML += `<div style="margin-top: 5px; font-size: 11px; color: rgba(255,255,255,0.6);">格式：${moduleFormat}</div>`;

            structureHTML += '</div>';
        });

        infoLog('模块结构预览生成成功');
        return structureHTML;

    } catch (error) {
        errorLog('生成模块结构预览失败:', error);
        return '<div class="structure-item">生成预览时发生错误</div>';
    }
}

/**
 * 复制提示词到剪贴板
 * @param {string} text 要复制的文本
 */
export function copyToClipboard(text, info) {
    try {
        navigator.clipboard.writeText(text).then(() => {
            infoLog(info);
            toastr.success(info);
        }).catch(err => {
            errorLog('复制到剪贴板失败:', err);
            toastr.error('复制失败，请手动复制');
        });
    } catch (error) {
        errorLog('复制到剪贴板失败:', error);
        // 备用方法：使用textarea方式复制
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            infoLog(info + '（备用方法）');
            toastr.success(info);
        } catch (err) {
            errorLog('备用复制方法也失败:', err);
            toastr.error('复制失败，请手动复制');
        }
        document.body.removeChild(textarea);
    }
}
