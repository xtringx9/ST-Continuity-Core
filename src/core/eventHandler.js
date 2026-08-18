// 事件处理器 - 处理SillyTavern扩展事件
import { registerContinuityRegexPattern } from "../utils/regexUtils.js";
import { updateCurrentCharWorldBookCache, checkAndInitializeWorldBook, getCurrentCharBooks, getTestData } from "../utils/worldBookUtils.js";
import configManager from "../singleton/configManager.js";
import moduleCacheManager from "../singleton/moduleCacheManager.js";
import generatedContentCache from "../singleton/generatedContentCache.js";
import { eventSource, event_types, getCurrentChatDetails, chat } from "../../../../../../script.js";
import { checkUItoContextBottom, scheduleMsgBottom, checkRenderCurrentMessageContext, isInChatPage } from "./contextBottomUI.js"
import { addAiButtonToMessage, addAiButtonsToAllMessages } from "../ui/messageAiButton.js";
import { moduleAiGenerator } from "../services/moduleAiGenerator.js";
import { debugLog, errorLog, infoLog } from "../utils/logger.js";
import { FLOOR_MODULES_UPDATED_EVENT } from "./floorModuleStore.js";
import { taskRegistry } from "./taskRegistry.js";

/** 构造 taskRegistry 的 chatKey（与 moduleAiGenerator._getChatKey 一致：角色名::聊天文件名） */
function _taskChatKey() {
    try {
        const d = getCurrentChatDetails();
        return `${d?.characterName || ''}::${d?.sessionName || ''}`;
    } catch {
        return 'unknown';
    }
}
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
            this.initializeAutoModuleGenerate();


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
            this.registerEvent(event_types.CHAT_CHANGED, () => {
                // 切聊天时更新 taskRegistry 当前聊天 key（小 Cc 楼层计数/按钮态据此过滤）
                taskRegistry.setCurrentChatKey(_taskChatKey());
                scheduleMsgBottom('full');
            });
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
     * 聊天消息接收完毕（GENERATION_ENDED）自动触发模块异步生成
     *
     * 前置条件（用户拍板 2026-08-17）：
     *   - asyncModule.enabled 开启（异步模块存储）
     *   - asyncModule.autoGenerateOnMessageEnd !== false（默认 true）
     *   - 当前在聊天页
     *   - chat 最后一条为非 user 消息（生成结束的正是角色回复）
     *   - 该楼层没有正在运行的模块生成任务（防重复）
     *
     * 行为：自动为 chat 最后一条消息（chat.length-1）触发 moduleAiGenerator.generate，
     *   skipStorage:false 自动存储为 floor 新版本，showDebug 跟随配置。
     *   ⚠️ 模块生成走 Generate(dryRun)+自 sendOpenAIRequest，不会再次触发 GENERATION_ENDED，无死循环。
     */
    initializeAutoModuleGenerate() {
        this.registerEvent(event_types.GENERATION_ENDED, () => {
            try {
                const asyncModule = configManager.getModuleDomainConfig().asyncModule || {};
                const asyncConfig = configManager.getAsyncConfig();
                if (!asyncModule.enabled) {
                    debugLog('[EVENTS]自动生成跳过：异步模块存储未开启');
                    return;
                }
                if (asyncConfig.autoGenerateOnMessageEnd === false) {
                    debugLog('[EVENTS]自动生成跳过：开关 autoGenerateOnMessageEnd 关闭');
                    return;
                }
                if (!isInChatPage()) return;

                const lastIdx = chat.length - 1;
                if (lastIdx < 0) return;
                const lastMsg = chat[lastIdx];
                if (!lastMsg || lastMsg.is_user) return;

                // 默认生成提示词 = 设为默认的提示词组（无则跳过，避免空指令静默失败）
                const defaultGroup = (asyncConfig.promptGroups || []).find(g => g.isDefault);
                const defaultPrompt = defaultGroup?.prompt || '';
                if (!defaultPrompt.trim()) {
                    debugLog('[EVENTS]自动生成跳过：未配置默认提示词组（提示词组中需勾选「设为默认」）');
                    return;
                }

                // 防重：该楼层已有模块生成任务进行中
                if (taskRegistry.getRunningCountForMes(lastIdx) > 0) {
                    debugLog(`[EVENTS]楼层 ${lastIdx} 已有模块生成任务，跳过自动触发`);
                    return;
                }

                // 构造生成参数（与 messageAiButton.onRegenerate 模块分支一致）
                const useIndependentApi = asyncConfig.useIndependentApi || false;
                let customApi = null;
                if (useIndependentApi) {
                    const apiConfig = asyncConfig.customApi || {};
                    if (apiConfig.apiurl) customApi = { ...apiConfig };
                }
                const options = {
                    generatorName: 'modules',
                    mode: asyncConfig.generationMode || 'pipeline',
                    customApi,
                    showDebug: asyncConfig.showDebug !== false,
                    skipStorage: false, // 自动存储（生成默认追加新版本）
                    rawSystemPrompt: asyncConfig.rawSystemPrompt || '',
                    rawUserPrompt: asyncConfig.rawUserPromptTemplate || '',
                    // 默认生成提示词 = 默认提示词组的 prompt
                    pipelineModifier: defaultPrompt,
                };

                infoLog(`[EVENTS]消息接收完毕，自动触发楼层 ${lastIdx} 的模块异步生成`);
                moduleAiGenerator.generate(lastIdx, options).catch(err => {
                    errorLog(`[EVENTS]楼层 ${lastIdx} 自动模块生成失败:`, err);
                });
            } catch (err) {
                errorLog('[EVENTS]自动触发模块生成异常:', err);
            }
        });
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

        // F 一期：floor 模块数据变更 → 刷新模块缓存 + 刷新该楼层 UI（机制 A，写侧只发事件，收口在此）
        this.floorModulesUpdatedHandler = (e) => {
            const mesId = e?.detail?.mesId;
            debugLog('[Module Cache]楼层模块数据变更，刷新缓存:', e?.detail);
            moduleCacheManager.updateModuleCacheDebounced(true);
            // 同步刷新该楼层的消息底部模块展示区（空保存/编辑走 scheduleMsgBottom 会更新，这里统一收口）
            if (typeof mesId === 'number') {
                scheduleMsgBottom('single', mesId);
            }
        };
        window.addEventListener(FLOOR_MODULES_UPDATED_EVENT, this.floorModulesUpdatedHandler);
        infoLog(`[EVENTS]已监听楼层模块数据变更事件 ${FLOOR_MODULES_UPDATED_EVENT}`);
    }
}

