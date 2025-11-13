// 事件处理器 - 处理SillyTavern扩展事件
import { extension_settings, extensionName } from "../index.js";
import { debugLog, errorLog, infoLog } from "../utils/logger.js";

// 获取SillyTavern上下文
const { eventSource, event_types } = SillyTavern.getContext();

/**
 * 事件处理器类 - 采用st-memory-enhancement扩展的简单模式
 */
export class EventHandler {
    constructor() {
        this.isInitialized = false;
        this.eventHandlers = new Map(); // 存储事件处理器引用
    }

    /**
     * 初始化事件处理器
     */
    initialize() {
        try {
            if (this.isInitialized) {
                debugLog('事件处理器已经初始化');
                return;
            }

            // 注册事件处理器
            this.registerChatCompletionPromptReady();

            this.isInitialized = true;
            infoLog('事件处理器初始化完成');
        } catch (error) {
            errorLog('事件处理器初始化失败:', error);
        }
    }

    /**
     * 注册聊天完成前提示词准备事件
     */
    registerChatCompletionPromptReady() {
        try {
            // 如果已经注册过，先移除旧的事件监听器
            if (this.eventHandlers.has(event_types.CHAT_COMPLETION_PROMPT_READY)) {
                const oldHandler = this.eventHandlers.get(event_types.CHAT_COMPLETION_PROMPT_READY);
                if (eventSource && eventSource.off) {
                    eventSource.off(event_types.CHAT_COMPLETION_PROMPT_READY, oldHandler);
                    debugLog('移除旧的chatCompletionPromptReady事件处理器');
                }
            }

            const handler = (eventData) => {
                debugLog('chatCompletionPromptReady事件触发', eventData);
                
                // 调用提示词注入器处理事件
                if (window.continuityPromptInjector) {
                    return window.continuityPromptInjector.onChatCompletionPromptReady(eventData);
                } else {
                    debugLog('提示词注入器未初始化');
                    return eventData; // 返回原始数据
                }
            };

            // 注册到SillyTavern事件系统
            if (eventSource && eventSource.on) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handler);
                // 存储事件处理器引用
                this.eventHandlers.set(event_types.CHAT_COMPLETION_PROMPT_READY, handler);
                infoLog('chatCompletionPromptReady事件处理器注册成功');
            } else {
                errorLog('无法注册事件处理器：eventSource不存在');
            }
        } catch (error) {
            errorLog('注册chatCompletionPromptReady事件处理器失败:', error);
        }
    }

    /**
     * 销毁事件处理器
     */
    destroy() {
        try {
            // 移除所有注册的事件监听器
            if (eventSource && eventSource.off && this.eventHandlers.size > 0) {
                for (const [eventType, handler] of this.eventHandlers) {
                    eventSource.off(eventType, handler);
                    debugLog(`移除事件监听器: ${eventType}`);
                }
                this.eventHandlers.clear();
            }
            
            this.isInitialized = false;
            infoLog('事件处理器已销毁，所有事件监听器已移除');
        } catch (error) {
            errorLog('销毁事件处理器失败:', error);
        }
    }

    /**
     * 重新注册事件处理器（当全局开关状态变化时调用）
     */
    reinitializeEventHandlers() {
        try {
            // 采用st-memory-enhancement模式：直接重新初始化
            this.destroy();
            this.initialize();
            debugLog('事件处理器已重新初始化');
        } catch (error) {
            errorLog('重新初始化事件处理器失败:', error);
        }
    }
}