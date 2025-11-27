// 模块提取器 - 用于从聊天记录中提取模块数据
import { debugLog, errorLog, infoLog } from "../utils/logger.js";
import { chat, getCurrentCharBooksModuleEntries, configManager } from "../index.js";

export const MODULE_REGEX = /\[([^:|]+?)\|(.*?)\]/g;
export const MODULE_NAME_REGEX = /^\[([^:|]+?)\|/;

/**
 * 从聊天记录中提取模块数据的帮助函数
 * @param {number} startIndex 可选的起始索引
 * @param {number} endIndex 可选的结束索引
 * @param {Array} moduleFilters 可选的模块过滤条件数组，每个过滤条件包含name和compatibleModuleNames
 * @returns {Promise<Array>} 解析出的模块数据数组
 */
export async function extractModulesFromChat(startIndex = 0, endIndex = null, moduleFilters = null) {
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
                modules.forEach(rawModule => {
                    // 如果有模块过滤条件，检查模块名是否匹配
                    if (moduleFilters && moduleFilters.length > 0) {
                        // 提取模块名
                        const moduleNameMatch = rawModule.match(MODULE_NAME_REGEX);
                        if (moduleNameMatch) {
                            const moduleName = moduleNameMatch[1];
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
                    }

                    const moduleData = {
                        raw: rawModule,
                        messageIndex: index,
                        isUserMessage: isUserMessage,
                        speakerName: speakerName,
                        timestamp: new Date().toISOString(),
                        source: 'chat' // 标记来源为聊天记录
                    };

                    extractedModules.push(moduleData);
                    // debugLog(`[MODULE EXTRACTOR]在第${index}条消息中发现模块:`, moduleData);
                });
            }
        }

        // 2. 从世界书条目中提取模块
        debugLog('[MODULE EXTRACTOR]开始从世界书条目中提取模块数据');
        try {
            const worldBookEntries = await getCurrentCharBooksModuleEntries();
            debugLog(`[MODULE EXTRACTOR]获取到${worldBookEntries.length}个世界书条目`);

            for (const entry of worldBookEntries) {
                if (entry.content) {
                    const modules = parseNestedModules(entry.content);

                    modules.forEach(rawModule => {
                        // 如果有模块过滤条件，检查模块名是否匹配
                        if (moduleFilters && moduleFilters.length > 0) {
                            // 提取模块名
                            const moduleNameMatch = rawModule.match(MODULE_NAME_REGEX);
                            if (moduleNameMatch) {
                                const moduleName = moduleNameMatch[1];
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
                        }

                        const moduleData = {
                            raw: rawModule,
                            messageIndex: -1, // 世界书条目统一设置为-1
                            isUserMessage: false, // 世界书条目不是用户消息
                            speakerName: 'worldbook', // 标记为世界书来源
                            timestamp: new Date().toISOString(),
                            source: 'worldbook', // 标记来源为世界书条目
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
 * 解析嵌套的模块结构
 * @param {string} content 包含模块的文本内容
 * @returns {Array} 提取到的所有模块（包括嵌套的）
 */
function parseNestedModules(content) {
    const modules = [];
    const stack = [];
    const potentialModuleStarts = [];

    for (let i = 0; i < content.length; i++) {
        const char = content[i];

        if (char === '[') {
            // 记录潜在的模块开始位置
            potentialModuleStarts.push(i);
            stack.push(i);
        } else if (char === ']' && stack.length > 0) {
            // 找到模块的结束
            const start = stack.pop();

            // 检查这个[ ]对是否包含|字符，并且确保|在当前的[和]之间
            const substringBetweenBrackets = content.substring(start + 1, i);
            if (substringBetweenBrackets.includes('|')) {
                // 进一步验证模块名格式：模块名不能包含冒号或竖线
                const firstPipeIndex = substringBetweenBrackets.indexOf('|');
                const moduleName = substringBetweenBrackets.substring(0, firstPipeIndex);

                // 检查模块名是否包含冒号或竖线
                if (!moduleName.includes(':') && !moduleName.includes('|')) {
                    // 这是一个有效的模块
                    const module = content.substring(start, i + 1);
                    modules.push(module);
                }
            }
        }
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
        const contentTags = globalSettings.contentTag || ["content", "game"];

        debugLog(`[CONTENT TAG PROCESSOR] 使用的正文标签: ${JSON.stringify(contentTags)}`);

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
            debugLog(`[CONTENT TAG PROCESSOR] 找到标签 ${foundTag}，保留标签后的内容`);
            return processedContent;
        }

        // 如果没有找到任何匹配的标签，返回原始内容
        debugLog(`[CONTENT TAG PROCESSOR] 未找到匹配的正文标签，返回原始内容`);
        return messageContent;

    } catch (error) {
        errorLog('[CONTENT TAG PROCESSOR] 处理消息内容失败:', error);
        // 出错时返回原始内容
        return messageContent;
    }
}
