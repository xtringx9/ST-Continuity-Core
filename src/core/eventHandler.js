// 事件处理器 - 处理SillyTavern扩展事件
import { registerContinuityRegexPattern } from "../utils/regexUtils.js";
import { updateCurrentCharWorldBookCache, checkAndInitializeWorldBook, getCurrentCharBooks, getTestData } from "../utils/worldBookUtils.js";
import configManager from "../singleton/configManager.js";
import moduleCacheManager from "../singleton/moduleCacheManager.js";
import generatedContentCache from "../singleton/generatedContentCache.js";
import { eventSource, event_types } from "../../../../../../script.js";
import { checkUItoContextBottom, scheduleMsgBottom, checkRenderCurrentMessageContext } from "./contextBottomUI.js"
import { addAiButtonToMessage, addAiButtonsToAllMessages } from "../ui/messageAiButton.js";
import { debugLog, errorLog, infoLog } from "../utils/logger.js";
import { FLOOR_MODULES_UPDATED_EVENT } from "./floorModuleStore.js";
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

            // 注册测试事件处理器（用于调试）
            if (configManager.isLoaded && configManager.isExtensionEnabled() && configManager.getDebugConfig().global)
                this.registerTestEvents();

            this.initializeModuleCache();
            // 初始化Regex扩展集成
            this.initializeRegexIntegration();
            // 初始化世界书集成
            this.initializeWorldBookIntegration();
            // 注册事件处理器
            this.registerUIEvents();
            this.initializeMessageAiButton();


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
            // 底部固定容器改为弹窗触发（见 openContextBottomAsModal），不再自动更新
            // this.registerEvent(event_types.CHAT_CHANGED, checkUItoContextBottom);
            // this.registerEvent(event_types.MESSAGE_EDITED, checkUItoContextBottom);
            // this.registerEvent(event_types.MESSAGE_SWIPED, checkUItoContextBottom);
            // this.registerEvent(event_types.CHARACTER_MESSAGE_RENDERED, checkUItoContextBottom);
            // this.registerEvent(event_types.CHAT_COMPLETION_PROMPT_READY, checkUItoContextBottom);

            // 消息底部 UI：Q1+Q2 调度器（合并 burst + 精准/后缀刷新）
            // 带 mesid 的事件只刷单条；编辑走后缀刷新（X..末条，覆盖 messageIndexHistory 向后延续）；
            // 切聊天/分页走全量；CHAT_COMPLETION_PROMPT_READY 暂不注册（生成前触发、无 mesid，易致无效全量提取）
            this.registerEvent(event_types.CHAT_CHANGED, () => scheduleMsgBottom('full'));
            this.registerEvent(event_types.MESSAGE_UPDATED, (mesid) => scheduleMsgBottom('suffix', mesid));// 从EDITED改成UPDATED
            this.registerEvent(event_types.MESSAGE_SWIPED, (mesid) => scheduleMsgBottom('single', mesid));
            this.registerEvent(event_types.CHARACTER_MESSAGE_RENDERED, (mesid) => scheduleMsgBottom('single', mesid));
            // this.registerEvent(event_types.CHAT_COMPLETION_PROMPT_READY, (mesid) => scheduleMsgBottom('full')); // 暂不注册
            this.registerEvent(event_types.MORE_MESSAGES_LOADED, () => scheduleMsgBottom('full'));

            this.registerEvent(event_types.CHAT_CHANGED, checkRenderCurrentMessageContext);
            // this.registerEvent(event_types.MESSAGE_EDITED, checkRenderCurrentMessageContext);
            this.registerEvent(event_types.MESSAGE_SWIPED, checkRenderCurrentMessageContext);
            this.registerEvent(event_types.CHARACTER_MESSAGE_RENDERED, checkRenderCurrentMessageContext);
            // this.registerEvent(event_types.CHAT_COMPLETION_PROMPT_READY, checkRenderCurrentMessageContext);
            this.registerEvent(event_types.MORE_MESSAGES_LOADED, checkRenderCurrentMessageContext);
            this.registerEvent(event_types.MESSAGE_UPDATED, checkRenderCurrentMessageContext);
            // infoLog('[EVENTS]UI相关事件处理器注册成功');
        } catch (error) {
            errorLog('[EVENTS]注册UI相关事件处理器失败:', error);
        }
    }

    /**
     * 注册消息 AI 按钮（Cc）相关事件
     *
     * 消息渲染事件触发 addAiButtonToMessage 为新消息添加 Cc 按钮；
     * GENERATION_ENDED 兜底处理生成失败时按钮消失（CHARACTER_MESSAGE_RENDERED 不触发）。
     * MutationObserver（在 initMessageAiButton 中设置）作为最终兜底。
     */
    initializeMessageAiButton() {
        try {
            this.registerEvent(event_types.CHARACTER_MESSAGE_RENDERED, addAiButtonToMessage);
            this.registerEvent(event_types.USER_MESSAGE_RENDERED, addAiButtonToMessage);
            this.registerEvent(event_types.MESSAGE_RECEIVED, addAiButtonToMessage);
            this.registerEvent(event_types.MESSAGE_SENT, addAiButtonToMessage);
            this.registerEvent(event_types.MORE_MESSAGES_LOADED, addAiButtonsToAllMessages);

            // 生成结束（含失败/中止）：兜底重新添加按钮
            this.registerEvent(event_types.GENERATION_ENDED, () => {
                setTimeout(addAiButtonsToAllMessages, 100);
            });
        } catch (error) {
            errorLog('[EVENTS]注册消息AI按钮事件失败:', error);
        }
    }

    /**
     * 通用UI事件注册方法（支持同一事件类型注册多个处理器）
     */
    registerEvent(eventType, func, printEvent = false, printKey = "") {
        try {
            let handler = func;
            if (printEvent) {
                handler = () => {
                    infoLog(`${printKey ? `[${printKey}]` : ""}触发事件: ${eventType}`);
                    func();
                }
            }
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

            // F 一期：移除 floor 模块变更监听
            if (this.floorModulesUpdatedHandler) {
                window.removeEventListener(FLOOR_MODULES_UPDATED_EVENT, this.floorModulesUpdatedHandler);
                this.floorModulesUpdatedHandler = null;
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

    initializeModuleCache() {
        // Tier 2：缓存维护按「是否有同步读约束」分两类。
        // - Immediate（同步）：CHAT_CHANGED（进聊天需新鲜缓存）、MESSAGE_SENT（PROMPT_READY 宏同步读前需含用户新消息）
        // - Debounced（80ms 合并 + force 取并集）：RECEIVED/EDITED/UPDATED/SWIPED 等 burst 事件，无同步读约束
        // - CHAT_COMPLETION_PROMPT_READY 移除：生成前触发、缓存已 warm、立即被后续事件覆盖，纯浪费
        this.registerEvent(event_types.CHAT_CHANGED, () => {
            moduleCacheManager.clearAllCache();
            moduleCacheManager.updateModuleCacheImmediate(false);
        }, true, "Module Cache");
        this.registerEvent(event_types.CHAT_CHANGED, () => generatedContentCache.clear(), true, "Generated Content Cache");
        this.registerEvent(event_types.MESSAGE_SENT, () => moduleCacheManager.updateModuleCacheImmediate(true), true, "Module Cache");
        this.registerEvent(event_types.MESSAGE_RECEIVED, () => moduleCacheManager.updateModuleCacheDebounced(true), true, "Module Cache");
        this.registerEvent(event_types.MESSAGE_EDITED, () => moduleCacheManager.updateModuleCacheDebounced(true), true, "Module Cache");
        this.registerEvent(event_types.MESSAGE_DELETED, () => moduleCacheManager.updateModuleCacheDebounced(true), true, "Module Cache");
        this.registerEvent(event_types.MESSAGE_SWIPED, () => moduleCacheManager.updateModuleCacheDebounced(true), true, "Module Cache");
        this.registerEvent(event_types.MESSAGE_SWIPE_DELETED, () => moduleCacheManager.updateModuleCacheDebounced(true), true, "Module Cache");
        this.registerEvent(event_types.MESSAGE_UPDATED, () => moduleCacheManager.updateModuleCacheDebounced(true), true, "Module Cache");
        this.registerEvent(event_types.CHARACTER_MESSAGE_RENDERED, () => moduleCacheManager.updateModuleCacheDebounced(false), true, "Module Cache");

        // F 一期：floor 模块数据变更 → 刷新模块缓存（机制 A，写侧只发事件，收口在此）
        this.floorModulesUpdatedHandler = (e) => {
            debugLog('[Module Cache]楼层模块数据变更，刷新缓存:', e?.detail);
            moduleCacheManager.updateModuleCacheDebounced(true);
        };
        window.addEventListener(FLOOR_MODULES_UPDATED_EVENT, this.floorModulesUpdatedHandler);
        infoLog(`[EVENTS]已监听楼层模块数据变更事件 ${FLOOR_MODULES_UPDATED_EVENT}`);
    }
}

