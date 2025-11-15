// 模块提取器 - 用于从聊天记录中提取模块数据
import { debugLog, errorLog, infoLog } from "../utils/logger.js";
import { chat } from "../index.js";

/**
 * 从聊天记录中提取模块数据的帮助函数
 * @param {RegExp} moduleRegex 用于匹配模块数据的正则表达式
 * @param {Array} chatArray 可选的聊天数组，如果未提供则使用全局chat数组
 * @param {number} startIndex 可选的起始索引
 * @param {number} endIndex 可选的结束索引
 * @param {Object} moduleFilter 可选的模块过滤条件，包含name和compatibleModuleNames
 * @returns {Array} 解析出的模块数据数组
 */
export function extractModulesFromChatHistory(moduleRegex, chatArray = null, startIndex = 0, endIndex = null, moduleFilter = null) {
    const extractedModules = [];

    try {
        // 确定要使用的聊天数组
        const targetChat = chatArray || chat;

        // 检查是否有权限访问聊天记录
        if (!targetChat || !Array.isArray(targetChat)) {
            errorLog('无法访问聊天记录或聊天记录格式错误');
            return extractedModules;
        }

        // 确定提取范围
        const effectiveStartIndex = Math.max(0, startIndex);
        const effectiveEndIndex = endIndex !== null ? Math.min(endIndex, targetChat.length - 1) : targetChat.length - 1;

        debugLog(`开始从第${effectiveStartIndex}到${effectiveEndIndex}条聊天记录中提取模块数据`);

        // 遍历指定范围的聊天消息
        for (let index = effectiveStartIndex; index <= effectiveEndIndex; index++) {
            const message = targetChat[index];

            // 检查消息对象是否有效
            if (!message || (message.mes === undefined && message.content === undefined)) {
                continue;
            }

            // 支持两种消息格式：SillyTavern原生格式(mes)和标准格式(content)
            const messageContent = message.mes !== undefined ? message.mes : message.content;
            const isUserMessage = message.is_user || message.role === 'user';
            const speakerName = message.name || (isUserMessage ? 'user' : 'assistant');

            // 使用栈来解析嵌套的模块结构
            const modules = parseNestedModules(messageContent);

            // 将提取到的模块添加到结果数组
            modules.forEach(rawModule => {
                // 如果有模块过滤条件，检查模块名是否匹配
                if (moduleFilter) {
                    // 提取模块名
                    const moduleNameMatch = rawModule.match(/^\[(.*?)\|/);
                    if (moduleNameMatch) {
                        const moduleName = moduleNameMatch[1];
                        // 检查模块名是否在过滤列表中
                        const matchesFilter = moduleFilter.name === moduleName ||
                            (moduleFilter.compatibleModuleNames &&
                                moduleFilter.compatibleModuleNames.includes(moduleName));
                        // 如果不匹配，跳过这个模块
                        if (!matchesFilter) {
                            return;
                        }
                    }
                }

                const moduleData = {
                    raw: rawModule,
                    messageIndex: index,
                    isUserMessage: isUserMessage,
                    speakerName: speakerName,
                    timestamp: new Date().toISOString()
                };

                extractedModules.push(moduleData);
                debugLog(`在第${index}条消息中发现模块:`, moduleData);
            });
        }

        infoLog(`从聊天记录中成功提取了${extractedModules.length}个模块`);
    } catch (error) {
        errorLog('解析聊天记录中的模块数据失败:', error);
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
                // 这是一个有效的模块
                const module = content.substring(start, i + 1);
                modules.push(module);
            }
        }
    }

    return modules;
}

/**
 * 模块提取器类 - 提供从聊天记录中提取模块的功能
 */
export class ModuleExtractor {
    constructor() {
        this.currentEventData = null;
    }

    /**
     * 设置当前事件数据
     * @param {Object} eventData 事件数据
     */
    setCurrentEventData(eventData) {
        this.currentEventData = eventData;
    }

    /**
     * 从聊天记录中提取模块数据
     * @param {RegExp} moduleRegex 可选的自定义模块匹配正则表达式，默认为匹配[模块名|键A:值A|键B:值B...]格式
     * @param {number} startIndex 可选的起始索引
     * @param {number} endIndex 可选的结束索引
     * @param {Object} moduleFilter 可选的模块过滤条件，包含name和compatibleModuleNames
     * @returns {Array} 提取的模块数据数组
     */
    extractModulesFromChat(moduleRegex = /\[.*?\|.*?\]/g, startIndex = 0, endIndex = null, moduleFilter = null) {
        try {
            debugLog('开始从聊天记录中提取模块数据');

            // 调用帮助函数提取模块
            const modules = extractModulesFromChatHistory(moduleRegex, null, startIndex, endIndex, moduleFilter);

            // 也可以从当前的eventData.chat中提取（如果在事件处理上下文中）
            if (this.currentEventData && this.currentEventData.chat) {
                debugLog('同时从当前事件数据中提取模块');
                const eventChatModules = extractModulesFromChatHistory(moduleRegex, this.currentEventData.chat, startIndex, endIndex, moduleFilter);
                modules.push(...eventChatModules);
            }

            debugLog(`总共提取到${modules.length}个模块`);
            return modules;
        } catch (error) {
            errorLog('提取聊天模块失败:', error);
            return [];
        }
    }
}
