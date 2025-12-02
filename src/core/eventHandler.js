// 事件处理器 - 处理SillyTavern扩展事件
import { getTestData, registerContinuityRegexPattern, updateCurrentCharWorldBookCache, checkAndInitializeWorldBook, getCurrentCharBooks } from "../index.js";
import { eventSource, event_types, UpdateUI, removeUIfromContextBottom } from "../index.js";
import { debugLog, errorLog, infoLog } from "../utils/logger.js";
/**
 * 事件处理器类
 */
export class EventHandler {
    constructor() {
        this.isInitialized = false;
        this.eventHandlers = new Map(); // 存储事件处理器引用
        this.initialize();
    }

    /**
     * 初始化事件处理器
     */
    initialize() {
        try {
            if (this.isInitialized) {
                debugLog('[EVENTS]事件处理器已经初始化');
                return;
            }

            // 初始化Regex扩展集成
            this.initializeRegexIntegration();
            // 初始化世界书集成
            this.initializeWorldBookIntegration();

            // 注册测试事件处理器（用于调试）
            this.registerTestEvents();

            // 注册事件处理器
            this.registerUIEvents();

            this.isInitialized = true;
            infoLog('[EVENTS]事件处理器初始化完成');
        } catch (error) {
            errorLog('[EVENTS]事件处理器初始化失败:', error);
        }
    }

    /**
     * 注册UI相关事件（聊天变更、消息接收等）
     */
    registerUIEvents() {
        try {
            // 注册聊天变更事件
            this.registerEvent(event_types.CHAT_CHANGED, UpdateUI);
            // 注册消息接收事件
            // this.registerEvent(event_types.MESSAGE_RECEIVED, UpdateUI);
            // 注册角色消息渲染完成事件
            this.registerEvent(event_types.CHARACTER_MESSAGE_RENDERED, UpdateUI);
            // 注册消息编辑事件
            this.registerEvent(event_types.MESSAGE_EDITED, UpdateUI);
            // 注册消息删除事件
            // this.registerEvent(event_types.MESSAGE_DELETED, UpdateUI);
            // 注册消息滑动事件
            this.registerEvent(event_types.MESSAGE_SWIPED, UpdateUI);
            // 注册角色消息渲染完成事件
            this.registerEvent(event_types.CHARACTER_MESSAGE_RENDERED, UpdateUI);
            // 注册用户消息渲染完成事件
            this.registerEvent(event_types.CHAT_COMPLETION_PROMPT_READY, UpdateUI);
            infoLog('[EVENTS]UI相关事件处理器注册成功');
        } catch (error) {
            errorLog('[EVENTS]注册UI相关事件处理器失败:', error);
        }
    }

    /**
     * 通用UI事件注册方法（支持同一事件类型注册多个处理器）
     */
    registerEvent(eventType, handler) {
        try {
            // 检查是否已经注册过相同的事件处理器，避免重复注册
            if (this.eventHandlers.has(eventType)) {
                const existingHandlers = this.eventHandlers.get(eventType);
                // 检查是否已经注册过相同的处理器
                if (existingHandlers.includes(handler)) {
                    debugLog(`跳过重复注册的事件处理器: ${eventType}`);
                    return;
                }
            }

            // 注册到SillyTavern事件系统
            if (eventSource && eventSource.on) {
                eventSource.on(eventType, handler);

                // 存储事件处理器引用（支持多个处理器）
                if (!this.eventHandlers.has(eventType)) {
                    this.eventHandlers.set(eventType, []);
                }
                this.eventHandlers.get(eventType).push(handler);

                debugLog(`${eventType}事件处理器注册成功（当前处理器数量: ${this.eventHandlers.get(eventType).length}）`);
            } else {
                errorLog(`无法注册事件处理器：eventSource不存在（${eventType}）`);
            }
        } catch (error) {
            errorLog(`注册${eventType}事件处理器失败:`, error);
        }
    }


    /**
     * 销毁事件处理器
     */
    destroy() {
        try {
            // 移除所有注册的事件监听器
            if (eventSource && eventSource.removeListener && this.eventHandlers.size > 0) {
                for (const [eventType, handlers] of this.eventHandlers) {
                    for (const handler of handlers) {
                        eventSource.removeListener(eventType, handler);
                        debugLog(`[EVENTS]移除事件监听器: ${eventType}`);
                    }
                }
                this.eventHandlers.clear();
            }

            this.isInitialized = false;
            infoLog('[EVENTS]事件处理器已销毁，所有事件监听器已移除');
        } catch (error) {
            errorLog('[EVENTS]销毁事件处理器失败:', error);
        }
    }

    /**
     * 注册测试事件处理器 - 注册所有事件用于调试
     */
    registerTestEvents() {
        try {
            // 遍历所有事件类型并注册测试处理器
            for (const [eventKey, eventValue] of Object.entries(event_types)) {
                // 跳过已经注册的事件，避免重复处理
                if (this.eventHandlers.has(eventValue)) {
                    debugLog(`[EVENTS][TEST EVENTS] 跳过已注册的事件: ${eventKey} (${eventValue})`);
                    continue;
                }

                // 创建测试事件处理器
                const testHandler = (eventData) => {
                    debugLog(`[EVENTS][TEST EVENTS] 事件触发: ${eventKey} (${eventValue})`, eventData);
                };

                this.registerEvent(eventValue, testHandler);
            }

            infoLog('[EVENTS][TEST EVENTS] 所有测试事件处理器注册完成');
        } catch (error) {
            errorLog('[EVENTS][TEST EVENTS] 注册测试事件处理器失败:', error);
        }
    }

    // /**
    //  * 重新注册事件处理器（当全局开关状态变化时调用）
    //  */
    // reinitializeEventHandlers() {
    //     try {
    //         // 直接重新初始化
    //         this.destroy();
    //         this.initialize();
    //         debugLog('[EVENTS]事件处理器已重新初始化');
    //     } catch (error) {
    //         errorLog('[EVENTS]重新初始化事件处理器失败:', error);
    //     }
    // }

    /**
     * 初始化Regex扩展集成
     */
    initializeRegexIntegration() {
        this.registerEvent(event_types.EXTENSION_SETTINGS_LOADED, registerContinuityRegexPattern);
    }

    /**
     * 初始化世界书集成
     */
    initializeWorldBookIntegration() {
        this.registerEvent(event_types.EXTENSION_SETTINGS_LOADED, checkAndInitializeWorldBook);
        this.registerEvent(event_types.WORLDINFO_SETTINGS_UPDATED, updateCurrentCharWorldBookCache);
        this.registerEvent(event_types.WORLDINFO_UPDATED, updateCurrentCharWorldBookCache);
        this.registerEvent(event_types.CHARACTER_EDITOR_OPENED, updateCurrentCharWorldBookCache);
    }
}

