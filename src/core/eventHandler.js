// 事件处理器 - 处理SillyTavern扩展事件
import { extension_settings, extensionName, initializeSettings, insertUItoContextBottom } from "../index.js";
import { debugLog, errorLog, infoLog } from "../utils/logger.js";

// 获取SillyTavern上下文
const { eventSource, event_types } = SillyTavern.getContext();

/**
 * 事件处理器类
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
            this.registerUIEvents();
            // this.registerSettingsChangeHandler();

            this.isInitialized = true;
            infoLog('事件处理器初始化完成');
        } catch (error) {
            errorLog('事件处理器初始化失败:', error);
        }
    }

    /**
     * 注册UI相关事件（聊天变更、消息接收等）
     */
    registerUIEvents() {
        try {
            // 注册聊天变更事件
            this.registerUIEvent(event_types.CHAT_CHANGED, () => {
                const settings = initializeSettings();
                if (settings.enabled) {
                    infoLog("[UI EVENTS][CHAT_CHANGED]检测到聊天变更，检查页面状态并插入UI");
                    this.checkPageStateAndInsertUI();
                } else {
                    debugLog("[UI EVENTS][CHAT_CHANGED]插件已禁用，移除UI");
                    removeUIfromContextBottom();
                }
            });

            // 注册消息接收事件
            this.registerUIEvent(event_types.MESSAGE_RECEIVED, () => {
                const settings = initializeSettings();
                if (settings.enabled) {
                    infoLog("[UI EVENTS][MESSAGE_RECEIVED]检测到新消息接收，检查页面状态并插入UI");
                    this.checkPageStateAndInsertUI();
                } else {
                    debugLog("[UI EVENTS][MESSAGE_RECEIVED]插件已禁用，移除UI");
                    removeUIfromContextBottom();
                }
            });

            // 注册角色消息渲染完成事件
            this.registerUIEvent(event_types.CHARACTER_MESSAGE_RENDERED, () => {
                const settings = initializeSettings();
                if (settings.enabled) {
                    infoLog("[UI EVENTS][CHARACTER_MESSAGE_RENDERED]检测到角色消息渲染完成，检查页面状态并插入UI");
                    // 使用更长的延迟确保消息完全渲染
                    setTimeout(() => {
                        this.checkPageStateAndInsertUI();
                    }, 200);
                } else {
                    debugLog("[UI EVENTS][CHARACTER_MESSAGE_RENDERED]插件已禁用，移除UI");
                    removeUIfromContextBottom();
                }
            });

            // 注册消息编辑事件
            this.registerUIEvent(event_types.MESSAGE_EDITED, () => {
                const settings = initializeSettings();
                if (settings.enabled) {
                    infoLog("[UI EVENTS][MESSAGE_EDITED]检测到消息编辑，检查页面状态并插入UI");
                    this.checkPageStateAndInsertUI();
                } else {
                    debugLog("[UI EVENTS][MESSAGE_EDITED]插件已禁用，移除UI");
                    removeUIfromContextBottom();
                }
            });

            // 注册消息删除事件
            this.registerUIEvent(event_types.MESSAGE_DELETED, () => {
                const settings = initializeSettings();
                if (settings.enabled) {
                    infoLog("[UI EVENTS][MESSAGE_DELETED]检测到消息删除，检查页面状态并插入UI");
                    this.checkPageStateAndInsertUI();
                } else {
                    debugLog("[UI EVENTS][MESSAGE_DELETED]插件已禁用，移除UI");
                    removeUIfromContextBottom();
                }
            });

            infoLog('UI相关事件处理器注册成功');
        } catch (error) {
            errorLog('注册UI相关事件处理器失败:', error);
        }
    }

    /**
     * 通用UI事件注册方法
     */
    registerUIEvent(eventType, handler) {
        try {
            // 如果已经注册过，先移除旧的事件监听器
            if (this.eventHandlers.has(eventType)) {
                const oldHandler = this.eventHandlers.get(eventType);
                if (eventSource && eventSource.off) {
                    eventSource.off(eventType, oldHandler);
                    debugLog(`移除旧的${eventType}事件处理器`);
                }
            }

            // 注册到SillyTavern事件系统
            if (eventSource && eventSource.on) {
                eventSource.on(eventType, handler);
                // 存储事件处理器引用
                this.eventHandlers.set(eventType, handler);
                debugLog(`${eventType}事件处理器注册成功`);
            } else {
                errorLog(`无法注册事件处理器：eventSource不存在（${eventType}）`);
            }
        } catch (error) {
            errorLog(`注册${eventType}事件处理器失败:`, error);
        }
    }

    // /**
    //  * 注册设置变化处理器
    //  * 监听全局开关状态变化，自动管理UI的插入和移除
    //  */
    // registerSettingsChangeHandler() {
    //     try {
    //         // 监听设置变化事件
    //         const handler = () => {
    //             const settings = initializeSettings();

    //             if (!settings.enabled) {
    //                 // 全局开关关闭时，移除已插入的UI
    //                 infoLog('[SETTINGS_CHANGE] 全局开关已关闭，移除UI');
    //                 removeUIfromContextBottom();
    //             } else {
    //                 // 全局开关开启时，检测页面状态并插入UI
    //                 infoLog('[SETTINGS_CHANGE] 全局开关已开启，检测页面状态并插入UI');
    //                 this.checkPageStateAndInsertUI();
    //             }
    //         };

    //         // 注册设置变化事件
    //         if (eventSource && eventSource.on) {
    //             eventSource.on('extension_settings_updated', handler);
    //             this.eventHandlers.set('extension_settings_updated', handler);
    //             debugLog('设置变化事件处理器注册成功');
    //         } else {
    //             errorLog('无法注册设置变化事件处理器：eventSource不存在');
    //         }
    //     } catch (error) {
    //         errorLog('注册设置变化事件处理器失败:', error);
    //     }
    // }

    /**
     * 检测页面状态并插入UI
     * 确保只有在合适的页面状态下才插入UI
     */
    checkPageStateAndInsertUI() {
        try {
            // 检查是否在聊天页面
            if (!this.isInChatPage()) {
                debugLog('[PAGE_CHECK] 当前不在聊天页面，不插入UI');
                return false;
            }

            // 检查是否有有效的消息容器
            if (!this.hasValidMessageContainer()) {
                debugLog('[PAGE_CHECK] 没有有效的消息容器，不插入UI');
                return false;
            }

            // 检查UI是否已经存在
            const existingUI = document.getElementById('continuity-context-bottom-ui');
            if (existingUI) {
                debugLog('[PAGE_CHECK] UI已存在，无需重新插入');
                return true;
            }

            // 所有检查通过，插入UI
            infoLog('[PAGE_CHECK] 页面状态检查通过，插入UI');
            insertUItoContextBottom();
            return true;
        } catch (error) {
            errorLog('检测页面状态并插入UI失败:', error);
            return false;
        }
    }

    /**
     * 检查是否在聊天页面
     */
    isInChatPage() {
        try {
            // 检查是否存在聊天容器
            const chatContainer = $('#chat');
            if (!chatContainer.length) {
                return false;
            }

            // 检查聊天容器是否可见
            if (chatContainer.css('display') === 'none') {
                return false;
            }

            // 检查是否有消息容器
            const messageContainers = $('.mes');
            if (messageContainers.length === 0) {
                return false;
            }

            return true;
        } catch (error) {
            errorLog('检查聊天页面状态失败:', error);
            return false;
        }
    }

    /**
     * 检查是否有有效的消息容器
     */
    hasValidMessageContainer() {
        try {
            // 查找合适的消息容器
            const lastMessageContainer = $('.last_mes');
            if (lastMessageContainer.length === 0) {
                return false;
            }

            // 检查消息容器是否有内容
            const messageText = lastMessageContainer.find('.mes_text');
            if (messageText.length === 0 || messageText.text().trim() === '') {
                return false;
            }

            return true;
        } catch (error) {
            errorLog('检查消息容器状态失败:', error);
            return false;
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
            // 直接重新初始化
            this.destroy();
            this.initialize();
            debugLog('事件处理器已重新初始化');
        } catch (error) {
            errorLog('重新初始化事件处理器失败:', error);
        }
    }
}
