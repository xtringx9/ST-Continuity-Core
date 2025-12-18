// 模块提取器 - 用于从聊天记录中提取模块数据
import { debugLog, errorLog, infoLog } from "../utils/logger.js";
import { chat, getCurrentCharBooksModuleEntries, configManager } from "../index.js";
import { processTextForMatching } from '../utils/textConverter.js';

export const MODULE_REGEX = /\[([^:|]+?)\|(.*?)\]/g;
export const MODULE_NAME_REGEX = /^\[([^:|]+?)\|/;

/**
 * 从聊天记录中提取模块数据的帮助函数
 * @param {number} startIndex 可选的起始索引
 * @param {number} endIndex 可选的结束索引
 * @param {Array} moduleFilters 可选的模块过滤条件数组，每个过滤条件包含name和compatibleModuleNames
 * @returns {Promise<Array>} 解析出的模块数据数组
 */
export function extractModulesFromChat(startIndex = 0, endIndex = null, moduleFilters = null) {
    const extractedModules = [];

    try {
        // 1. 从聊天记录中提取模块
        const targetChat = chat;

        // 检查是否有权限访问聊天记录
        if (!targetChat || !Array.isArray(targetChat)) {
            errorLog('[MODULE EXTRACTOR]无法访问聊天记录或聊天记录格式错误');
        } else {
            // 确定提取范围
            const effectiveStartIndex = Math.max(0, startIndex);
            const effectiveEndIndex = endIndex !== null ? Math.min(endIndex, targetChat.length - 1) : targetChat.length - 1;

            debugLog(`[MODULE EXTRACTOR]开始从第${effectiveStartIndex}到${effectiveEndIndex}条聊天记录中提取模块数据`);

            // 遍历指定范围的聊天消息
            for (let index = effectiveStartIndex; index <= effectiveEndIndex; index++) {
                const message = targetChat[index];

                // 检查消息对象是否有效
                if (!message || (message.mes === undefined && message.content === undefined)) {
                    continue;
                }

                // 支持两种消息格式：SillyTavern原生格式(mes)和标准格式(content)
                const rawMessageContent = message.mes !== undefined ? message.mes : message.content;

                // 使用新方法处理消息内容，根据正文标签提取内容
                const messageContent = processMessageWithContentTags(rawMessageContent);
                const isUserMessage = message.is_user || message.role === 'user';
                const speakerName = message.name || (isUserMessage ? 'user' : 'assistant');

                // 使用栈来解析嵌套的模块结构
                const modules = parseNestedModules(messageContent);

                // 将提取到的模块添加到结果数组
                modules.forEach(moduleObj => {
                    // 如果有模块过滤条件，检查模块名是否匹配
                    if (moduleFilters && moduleFilters.length > 0) {
                        // 使用模块对象中的模块名进行过滤
                        const moduleName = moduleObj.moduleName;
                        // 检查模块名是否在任意一个过滤条件中匹配
                        const matchesAnyFilter = moduleFilters.some(moduleFilter => {
                            return moduleFilter.name === moduleName ||
                                (moduleFilter.compatibleModuleNames &&
                                    moduleFilter.compatibleModuleNames.includes(moduleName));
                        });
                        // 如果不匹配任何过滤条件，跳过这个模块
                        if (!matchesAnyFilter) {
                            return;
                        }
                    }

                    const processedRaw = processTextForMatching(moduleObj.raw);
                    const moduleData = {
                        raw: moduleObj.raw,
                        processedRaw: processedRaw ? processedRaw : moduleObj.raw,
                        messageIndex: index,
                        isUserMessage: isUserMessage,
                        speakerName: speakerName,
                        timestamp: new Date().toISOString(),
                        source: 'chat', // 标记来源为聊天记录
                        // 嵌套关系信息
                        nestedInfo: {
                            level: moduleObj.level,
                            isNested: moduleObj.isNested,
                            isContainer: moduleObj.isContainer,
                            parentModule: moduleObj.parent ? moduleObj.parent.moduleName : null,
                            childrenCount: moduleObj.children.length,
                            childrenModules: moduleObj.children.map(child => child.moduleName),
                            nestedVariables: moduleObj.nestedVariables // 包含嵌套模块的变量名数组
                        }
                    };

                    extractedModules.push(moduleData);
                    // debugLog(`[MODULE EXTRACTOR]在第${index}条消息中发现模块:`, moduleData);
                });
            }
        }

        // 2. 从世界书条目中提取模块
        debugLog('[MODULE EXTRACTOR]开始从世界书条目中提取模块数据');
        try {
            const worldBookEntries = getCurrentCharBooksModuleEntries();
            debugLog(`[MODULE EXTRACTOR]获取到${worldBookEntries.length}个世界书条目`);

            for (const entry of worldBookEntries) {
                if (entry.content) {
                    const modules = parseNestedModules(entry.content);

                    modules.forEach(moduleObj => {
                        // 如果有模块过滤条件，检查模块名是否匹配
                        if (moduleFilters && moduleFilters.length > 0) {
                            // 使用模块对象中的模块名进行过滤
                            const moduleName = moduleObj.moduleName;
                            // 检查模块名是否在任意一个过滤条件中匹配
                            const matchesAnyFilter = moduleFilters.some(moduleFilter => {
                                return moduleFilter.name === moduleName ||
                                    (moduleFilter.compatibleModuleNames &&
                                        moduleFilter.compatibleModuleNames.includes(moduleName));
                            });
                            // 如果不匹配任何过滤条件，跳过这个模块
                            if (!matchesAnyFilter) {
                                return;
                            }
                        }

                        const moduleData = {
                            raw: moduleObj.raw,
                            messageIndex: -1, // 世界书条目统一设置为-1
                            isUserMessage: false, // 世界书条目不是用户消息
                            speakerName: 'worldbook', // 标记为世界书来源
                            timestamp: new Date().toISOString(),
                            source: 'worldbook', // 标记来源为世界书条目
                            // 嵌套关系信息
                            nestedInfo: {
                                level: moduleObj.level,
                                isNested: moduleObj.isNested,
                                isContainer: moduleObj.isContainer,
                                parentModule: moduleObj.parent ? moduleObj.parent.moduleName : null,
                                childrenCount: moduleObj.children.length,
                                childrenModules: moduleObj.children.map(child => child.moduleName),
                                nestedVariables: moduleObj.nestedVariables // 包含嵌套模块的变量名数组
                            }
                            // worldBookEntry: {
                            //     uid: entry.uid,
                            //     name: entry.name,
                            //     comment: entry.comment
                            // }
                        };

                        extractedModules.push(moduleData);
                        debugLog(`[MODULE EXTRACTOR]在世界书条目${entry.comment}中发现模块:`, moduleData);
                    });
                }
            }
        } catch (worldBookError) {
            errorLog('[MODULE EXTRACTOR]从世界书条目中提取模块数据失败:', worldBookError);
        }

        infoLog(`[MODULE EXTRACTOR]总共成功提取了${extractedModules.length}个模块（聊天记录: ${extractedModules.filter(m => m.source === 'chat').length}个, 世界书: ${extractedModules.filter(m => m.source === 'worldbook').length}个）`);
    } catch (error) {
        errorLog('[MODULE EXTRACTOR]解析模块数据失败:', error);
    }

    return extractedModules;
}

/**
 * 解析嵌套的模块结构，并标记嵌套关系
 * @param {string} content 包含模块的文本内容
 * @returns {Array} 提取到的所有模块对象，包含嵌套关系信息
 */
function parseNestedModules(content) {
    const modules = [];
    const stack = [];
    const moduleStack = []; // 用于跟踪嵌套模块层级

    for (let i = 0; i < content.length; i++) {
        const char = content[i];

        if (char === '[') {
            // 记录模块开始位置和当前嵌套层级
            stack.push(i);
            moduleStack.push({
                start: i,
                level: stack.length - 1
            });
        } else if (char === ']' && stack.length > 0) {
            // 找到模块的结束
            const start = stack.pop();
            const currentModuleInfo = moduleStack.pop();

            // 检查这个[ ]对是否包含|字符，并且确保|在当前的[和]之间
            const substringBetweenBrackets = content.substring(start + 1, i);
            if (substringBetweenBrackets.includes('|')) {
                // 进一步验证模块名格式：模块名不能包含冒号或竖线
                const firstPipeIndex = substringBetweenBrackets.indexOf('|');
                const moduleName = substringBetweenBrackets.substring(0, firstPipeIndex);

                // 检查模块名是否包含冒号或竖线
                if (!moduleName.includes(':') && !moduleName.includes('|')) {
                    // 这是一个有效的模块
                    const moduleString = content.substring(start, i + 1);

                    // 创建模块对象，包含嵌套关系信息
                    const moduleObj = {
                        raw: moduleString,
                        startIndex: start,
                        endIndex: i,
                        level: currentModuleInfo.level,
                        parent: null, // 将在后续处理中设置
                        children: [], // 子模块数组
                        isNested: currentModuleInfo.level > 0, // 是否嵌套在其他模块中
                        isContainer: false, // 是否包含子模块（将在后续处理中设置）
                        moduleName: moduleName.trim(),
                        nestedVariables: [] // 包含嵌套模块的变量名数组
                    };

                    // 分析模块中的变量，识别哪些变量包含嵌套模块
                    analyzeNestedVariables(moduleObj);

                    modules.push(moduleObj);
                }
            }
        }
    }

    // 构建嵌套关系
    return buildNestedRelationships(modules);
}

/**
 * 分析模块中的变量，识别哪些变量包含嵌套模块
 * @param {Object} moduleObj 模块对象
 */
function analyzeNestedVariables(moduleObj) {
    try {
        const moduleString = moduleObj.raw;

        // 提取变量部分（模块名后面的内容）
        const firstPipeIndex = moduleString.indexOf('|');
        if (firstPipeIndex === -1) return;

        const variablesPart = moduleString.substring(firstPipeIndex + 1, moduleString.length - 1);

        // 解析变量字符串，识别包含嵌套模块的变量
        const variables = parseVariablesStringWithNestedDetection(variablesPart);

        // 找出包含嵌套模块的变量
        const nestedVars = variables.filter(variable => variable.containsNestedModule);
        moduleObj.nestedVariables = nestedVars.map(variable => variable.name);

        debugLog(`模块 ${moduleObj.moduleName} 中包含嵌套模块的变量: ${moduleObj.nestedVariables.join(', ')}`);
    } catch (error) {
        errorLog('分析嵌套变量失败:', error);
    }
}

/**
 * 解析变量字符串，检测哪些变量包含嵌套模块
 * @param {string} variablesString 变量字符串
 * @returns {Array} 变量数组，包含是否包含嵌套模块的信息
 */
function parseVariablesStringWithNestedDetection(variablesString) {
    const variables = [];
    let currentPos = 0;
    let inNestedModule = 0;
    let lastPipePos = 0;

    for (let i = 0; i < variablesString.length; i++) {
        const char = variablesString[i];

        if (char === '[') {
            inNestedModule++;
        } else if (char === ']') {
            inNestedModule--;
        } else if (char === '|' && inNestedModule === 0) {
            // 只在顶级管道符处分割
            const part = variablesString.substring(lastPipePos, i).trim();
            if (part) {
                const variable = parseSingleVariableWithNestedDetection(part);
                variables.push(variable);
            }
            lastPipePos = i + 1;
        }
    }

    // 处理最后一个变量部分
    const lastPart = variablesString.substring(lastPipePos).trim();
    if (lastPart) {
        const variable = parseSingleVariableWithNestedDetection(lastPart);
        variables.push(variable);
    }

    return variables;
}

/**
 * 解析单个变量，检测是否包含嵌套模块
 * @param {string} part 单个变量部分
 * @returns {Object} 变量对象，包含是否包含嵌套模块的信息
 */
function parseSingleVariableWithNestedDetection(part) {
    let colonIndex = -1;
    let inNestedModule = 0;

    // 找到第一个顶级冒号
    for (let i = 0; i < part.length; i++) {
        const char = part[i];

        if (char === '[') {
            inNestedModule++;
        } else if (char === ']') {
            inNestedModule--;
        } else if (char === ':' && inNestedModule === 0) {
            colonIndex = i;
            break;
        }
    }

    if (colonIndex === -1) {
        // 如果没有冒号，作为简单变量名处理
        const simpleVariableName = part.trim();
        return {
            name: simpleVariableName,
            description: '',
            containsNestedModule: false
        };
    } else {
        // 有冒号，解析为变量名和值
        const variableName = part.substring(0, colonIndex).trim();
        const variableDesc = part.substring(colonIndex + 1).trim();

        // 检查变量描述中是否包含嵌套模块
        const containsNestedModule = checkIfContainsNestedModule(variableDesc);

        return {
            name: variableName,
            description: variableDesc || '',
            containsNestedModule: containsNestedModule
        };
    }
}

/**
 * 检查字符串中是否包含嵌套模块
 * @param {string} text 要检查的文本
 * @returns {boolean} 是否包含嵌套模块
 */
function checkIfContainsNestedModule(text) {
    if (!text) return false;

    let bracketCount = 0;
    let hasPipeInBrackets = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === '[') {
            bracketCount++;
        } else if (char === ']') {
            if (bracketCount > 0) {
                bracketCount--;
                if (bracketCount === 0 && hasPipeInBrackets) {
                    return true;
                }
            }
        } else if (char === '|' && bracketCount > 0) {
            hasPipeInBrackets = true;
        }
    }

    return false;
}

/**
 * 构建模块之间的嵌套关系
 * @param {Array} modules 模块对象数组
 * @returns {Array} 包含嵌套关系的模块数组
 */
function buildNestedRelationships(modules) {
    // 按开始位置排序，便于处理嵌套关系
    modules.sort((a, b) => a.startIndex - b.startIndex);

    const rootModules = [];
    const stack = [];

    for (const module of modules) {
        // 弹出栈中所有已经结束的模块
        while (stack.length > 0 && stack[stack.length - 1].endIndex < module.startIndex) {
            stack.pop();
        }

        // 设置父模块关系
        if (stack.length > 0) {
            const parent = stack[stack.length - 1];
            module.parent = parent;
            parent.children.push(module);
            parent.isContainer = parent.children.length > 0;
        } else {
            rootModules.push(module);
        }

        // 将当前模块压入栈
        stack.push(module);
    }

    return modules;
}

// /**
//  * 模块提取器类 - 提供从聊天记录中提取模块的功能
//  */
// export class ModuleExtractor {
//     constructor() {
//         this.currentEventData = null;
//     }

//     /**
//      * 设置当前事件数据
//      * @param {Object} eventData 事件数据
//      */
//     setCurrentEventData(eventData) {
//         this.currentEventData = eventData;
//     }

// /**
//  * 从聊天记录中提取模块数据
//  * @param {RegExp} moduleRegex 可选的自定义模块匹配正则表达式，默认为匹配[模块名|键A:值A|键B:值B...]格式
//  * @param {number} startIndex 可选的起始索引
//  * @param {number} endIndex 可选的结束索引
//  * @param {Array} moduleFilters 可选的模块过滤条件数组，每个过滤条件包含name和compatibleModuleNames
//  * @returns {Array} 提取的模块数据数组
//  */
// export function extractModulesFromChat(moduleRegex = /\[.*?\|.*?\]/g, startIndex = 0, endIndex = null, moduleFilters = null) {
//     try {
//         debugLog('[MODULE EXTRACTOR]开始从聊天记录中提取模块数据');

//         // 调用帮助函数提取模块
//         const modules = extractModulesFromChatHistory(moduleRegex, null, startIndex, endIndex, moduleFilters);

//         // // 也可以从当前的eventData.chat中提取（如果在事件处理上下文中）
//         // if (this.currentEventData && this.currentEventData.chat) {
//         //     debugLog('[MODULE EXTRACTOR]同时从当前事件数据中提取模块');
//         //     const eventChatModules = extractModulesFromChatHistory(moduleRegex, this.currentEventData.chat, startIndex, endIndex, moduleFilters);
//         //     modules.push(...eventChatModules);
//         // }

//         debugLog(`[MODULE EXTRACTOR]总共提取到${modules.length}个模块`);
//         return modules;
//     } catch (error) {
//         errorLog('[MODULE EXTRACTOR]提取聊天模块失败:', error);
//         return [];
//     }
// }
// }

/**
 * 根据正文标签处理消息内容
 * 从全局设置获取contentTag，默认值为["content", "game"]
 * 从上到下判断消息中使用的正文标签（需要加上'<>'符号），找到最后一个匹配的标签
 * 保留该标签后的内容
 * @param {string} messageContent 原始消息内容
 * @returns {string} 处理后的消息内容
 */
function processMessageWithContentTags(messageContent) {
    try {
        // 获取全局设置中的contentTag，如果没有则使用默认值
        const globalSettings = configManager.getGlobalSettings();
        const contentTags = globalSettings.contentTag;

        // 如果contentTags为空或长度为0，直接返回原内容
        if (!contentTags || !Array.isArray(contentTags) || contentTags.length === 0) {
            return messageContent;
        }

        // debugLog(`[CONTENT TAG PROCESSOR] 使用的正文标签: ${JSON.stringify(contentTags)}`);

        // 如果消息内容为空，直接返回
        if (!messageContent || messageContent.trim() === '') {
            return messageContent;
        }

        let lastContentTagIndex = -1;
        let foundTag = null;

        // 从上到下遍历标签数组，寻找最后一个匹配的标签
        for (const tag of contentTags) {
            const fullTag = `<${tag}>`;
            const tagIndex = messageContent.lastIndexOf(fullTag);

            if (tagIndex !== -1 && tagIndex > lastContentTagIndex) {
                lastContentTagIndex = tagIndex;
                foundTag = fullTag;
            }
        }

        // 如果找到了匹配的标签，保留该标签后的内容
        if (lastContentTagIndex !== -1 && foundTag) {
            const processedContent = messageContent.substring(lastContentTagIndex + foundTag.length);
            // debugLog(`[CONTENT TAG PROCESSOR] 找到标签 ${foundTag}，保留标签后的内容`);
            return processedContent;
        }

        // 如果没有找到任何匹配的标签，返回原始内容
        // debugLog(`[CONTENT TAG PROCESSOR] 未找到匹配的正文标签，返回原始内容`);
        return messageContent;

    } catch (error) {
        errorLog('[CONTENT TAG PROCESSOR] 处理消息内容失败:', error);
        // 出错时返回原始内容
        return messageContent;
    }
}
