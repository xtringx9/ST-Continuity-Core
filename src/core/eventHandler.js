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
import { CHAT_MODULE_ENTRIES_UPDATED_EVENT } from "./chatModuleEntryStore.js";
import { incrementalModulesChanged } from "./pipeline/incrementalModuleCompare.js";
import { getChatCacheKey, invalidateOccurrence, invalidateSourceAll, clearOccurrenceCache } from "./occurrenceCache.js";
import { markSnapshotDirty, resetSnapshotDirty } from "./snapshotStore.js";
import { clearBuildCache } from "./rebuildProcessor.js";
import { taskRegistry } from "./taskRegistry.js";

/** 编辑前文本缓存：mesId → 编辑框打开时的 chat[mesId].mes（MESSAGE_UPDATED 前对比增量用） */
const _editTextCache = new Map();

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
                // 编辑缓存按聊天隔离，切聊天清空
                _editTextCache.clear();
                // occurrence 缓存：切聊天清空全部（CHAT_CHANGED 触发时已是新聊天 key，
                // 旧聊天缓存无法定位，全清无妨——切聊天频率低）
                clearOccurrenceCache();
                // 快照 dirty 会话：切聊天复位（新聊天从干净开始）
                resetSnapshotDirty();
                // build 增量缓存按聊天隔离，切聊天清空
                clearBuildCache();
            });
            // ⚠️ 监听 ST 编辑框打开（document 委托 .mes_edit 点击）缓存该层旧文本：
            // ST 无编辑开始事件、MESSAGE_UPDATED 触发时 chat 已是新文本，拿不到 before。
            // 这里在编辑框打开瞬间（chat 仍是旧值）缓存，MESSAGE_UPDATED 时用 incrementalModulesChanged 对比。
            this._mesEditOpenHandler = (e) => {
                const btn = e.target?.closest?.('.mes_edit');
                if (!btn) return;
                const mesEl = btn.closest('.mes');
                const mesid = mesEl?.getAttribute('mesid');
                if (mesid == null) return;
                const idx = Number(mesid);
                if (Number.isNaN(idx) || !chat[idx]) return;
                _editTextCache.set(String(idx), chat[idx].mes ?? '');
            };
            document.addEventListener('click', this._mesEditOpenHandler);

            this.registerEvent(event_types.MESSAGE_UPDATED, (mesid) => {
                const x = Number(mesid);
                if (Number.isNaN(x)) { scheduleMsgBottom('suffix', mesid); return; }
                // occurrence 缓存：编辑正文只失效该层 chatText（extract 逐层独立）
                invalidateOccurrence(getChatCacheKey(), 'chatText', x);
                // 快照 dirty：正文变更自该层起累积态失效→增量续算
                markSnapshotDirty(x);
                const before = _editTextCache.get(String(x));
                _editTextCache.delete(String(x));
                const after = chat[x]?.mes ?? '';
                // 有缓存 → 增量模块文本判断：变了 suffix，没变 single（前面楼层不动）
                // 无缓存（非 .mes_edit 触发，如程序化编辑）→ 兜底 suffix（保守）
                if (before !== undefined && !incrementalModulesChanged(before, after)) {
                    scheduleMsgBottom('single', x);
                } else {
                    scheduleMsgBottom('suffix', x);
                }
            });
            this.registerEvent(event_types.MESSAGE_SWIPED, (mesid) => {
                const x = Number(mesid);
                if (!Number.isNaN(x)) {
                    invalidateOccurrence(getChatCacheKey(), 'chatText', x);
                    // 快照 dirty：切 swipe 只影响该层（正文 swipe_id 变）→ 增量续算
                    markSnapshotDirty(x);
                }
                scheduleMsgBottom('single', mesid);
            });
            this.registerEvent(event_types.CHARACTER_MESSAGE_RENDERED, (mesid) => scheduleMsgBottom('single', mesid));
            // this.registerEvent(event_types.CHAT_COMPLETION_PROMPT_READY, (mesid) => scheduleMsgBottom('full')); // 暂不注册
            this.registerEvent(event_types.MORE_MESSAGES_LOADED, () => scheduleMsgBottom('full'));

            this.registerEvent(event_types.CHAT_CHANGED, checkRenderCurrentMessageContext);
            // this.registerEvent(event_types.MESSAGE_EDITED, checkRenderCurrentMessageContext);
            this.registerEvent(event_types.MESSAGE_SWIPED, checkRenderCurrentMessageContext);
            this.registerEvent(event_types.CHARACTER_MESSAGE_RENDERED, checkRenderCurrentMessageContext);
            // this.registerEvent(event_types.CHAT_COMPLETION_PROMPT_READY, checkRenderCurrentMessageContext);
            this.registerEvent(event_types.MORE_MESSAGES_LOADED, checkRenderCurrentMessageContext);
            // 编辑消息正文：正文内从该层到末尾（后缀）渲染，而非只该层/全量。
            // ⚠️ force：后续楼层正文的模块原文已被样式替换，普通路径找不到原文会跳过；
            // 增量模块变化影响后续楼层正文内 → 需 force 重建原文再替换。
            this.registerEvent(event_types.MESSAGE_UPDATED, (mesid) => {
                const x = Number(mesid);
                if (Number.isNaN(x)) { checkRenderCurrentMessageContext(); return; }
                const before = _editTextCache.get(String(x));
                _editTextCache.delete(String(x));
                const after = chat[x]?.mes ?? '';
                // 与消息底部一致的增量判断：增量模块文本没变 → 只刷该层；变了 → 本层到末尾（force）
                if (before !== undefined && !incrementalModulesChanged(before, after)) {
                    checkRenderCurrentMessageContext(x);
                } else {
                    const suffixIds = [];
                    document.querySelectorAll('#chat .mes').forEach(el => {
                        const id = Number(el.getAttribute('mesid'));
                        if (!Number.isNaN(id) && id >= x) suffixIds.push(id);
                    });
                    if (suffixIds.length > 0) checkRenderCurrentMessageContext(suffixIds, true);
                    else checkRenderCurrentMessageContext(null, true);
                }
            });
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

                // 防重：该楼层已有「模块」生成任务进行中（⚠️ 只限 modules，其他 generator 任务不阻止自动模块生成）
                let hasModuleTask = false;
                taskRegistry.forEach(t => {
                    if (t.status === 'running' && Number(t.mesId) === lastIdx && t.generatorName === 'modules') hasModuleTask = true;
                });
                if (hasModuleTask) {
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
                // ⚠️ 统一路径（2026-08-18）：自动落盘与否只由 showDebug 决定——
                //   勾选「生成完成弹出面板手动确认」→ 不落盘弹面板等手动；不勾选 → 自动落盘并标 saved。
                //   skipStorage 为历史参数不再参与判定（此处保留兼容，无实际作用）。
                const options = {
                    generatorName: 'modules',
                    mode: asyncConfig.generationMode || 'pipeline',
                    customApi,
                    showDebug: asyncConfig.showDebug !== false,
                    skipStorage: false,
                    rawSystemPrompt: asyncConfig.rawSystemPrompt || '',
                    rawUserPrompt: asyncConfig.rawUserPromptTemplate || '',
                    // 默认生成提示词 = 默认提示词组的 prompt
                    pipelineModifier: defaultPrompt,
                };

                infoLog(`[EVENTS]消息接收完毕，自动触发楼层 ${lastIdx} 的模块异步生成`);
                // ⚠️ 必须延迟启动（bce35d7 已定位根因）：GENERATION_ENDED 发射时 ST 尚未执行
                //   showSwipeButtons()（在 hideStopButton → emit 之后）。若同步启动 generate →
                //   pipeline 模式会 chat.push 临时 is_user:true 指令消息（aiCaller.js push 模式）→ 污染
                //   chat[last] → ST showSwipeButtons 读到 is_user 直接 return → 该消息 swipe 箭头消失。
                //   延迟到下一帧再启动，让 ST 先跑完 showSwipeButtons；lastIdx 用延迟后 chat.length-1。
                setTimeout(() => {
                    try {
                        const runIdx = chat.length - 1;
                        if (runIdx < 0) return;
                        const runMsg = chat[runIdx];
                        if (!runMsg || runMsg.is_user) return;
                        // 防重（延迟后重新校验：期间可能已有任务开始）
                        let dupTask = false;
                        taskRegistry.forEach(t => {
                            if (t.status === 'running' && Number(t.mesId) === runIdx && t.generatorName === 'modules') dupTask = true;
                        });
                        if (dupTask) return;
                        moduleAiGenerator.generate(runIdx, options).catch(err => {
                            errorLog(`[EVENTS]楼层 ${runIdx} 自动模块生成失败:`, err);
                        });
                    } catch (e2) {
                        errorLog('[EVENTS]延迟自动生成异常:', e2);
                    }
                }, 0);
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

            // F 二期：移除聊天级模块条目变更监听
            if (this.chatModuleEntriesUpdatedHandler) {
                window.removeEventListener(CHAT_MODULE_ENTRIES_UPDATED_EVENT, this.chatModuleEntriesUpdatedHandler);
                this.chatModuleEntriesUpdatedHandler = null;
            }

            // 移除 .mes_edit 编辑框缓存监听（关闭插件时一并去掉）+ 清空缓存
            if (this._mesEditOpenHandler) {
                document.removeEventListener('click', this._mesEditOpenHandler);
                this._mesEditOpenHandler = null;
            }
            _editTextCache.clear();

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
            if (typeof mesId === 'number') {
                // occurrence 缓存：floor generators 变更只失效该层 asyncChat（floorModuleStore 所有写操作统一收口此事件）
                invalidateOccurrence(getChatCacheKey(), 'asyncChat', mesId);
                // 快照 dirty：floor 内容变更自该层起累积态失效
                markSnapshotDirty(mesId);
                // 同步刷新该楼层的消息底部模块展示区（空保存/编辑走 scheduleMsgBottom 会更新，这里统一收口）
                scheduleMsgBottom('single', mesId);
                // ⚠️ 嵌入模块（outputPosition==='embedded'）的 floor 内容变化会影响「正文内」样式注入
                // （正文内渲染把正文里的模块 raw 替换成样式，样式基于累积状态）。
                // force：该层正文内模块原文可能已被替换成样式，需重建原文再替换。
                checkRenderCurrentMessageContext(mesId, true);
            }
        };
        window.addEventListener(FLOOR_MODULES_UPDATED_EVENT, this.floorModulesUpdatedHandler);
        infoLog(`[EVENTS]已监听楼层模块数据变更事件 ${FLOOR_MODULES_UPDATED_EVENT}`);

        // F 二期：聊天级模块条目变更 → 刷新模块缓存 + 按影响范围刷新
        // info = { floor, affect:'single'|'suffix'|'full'|'none', inline:boolean }
        //   single → 只刷该层消息底部
        //   suffix → 从该层到末尾消息底部（增量模块跨层累积）；inline=true 时同时触发正文内后缀渲染
        //   full   → 全量（负数起始态条目 / 整体开关 / 清空）
        //   none   → 渲染相关字段无变化，跳过
        this.chatModuleEntriesUpdatedHandler = (e) => {
            const { floor, affect, inline } = e?.detail || {};
            debugLog('[Module Cache]聊天级模块条目变更，刷新缓存', { floor, affect, inline });
            if (affect === 'none') return;
            // occurrence 缓存：聊天级条目变更失效 chatMeta 源。
            // ⚠️ 负数条目（起始态）只合并到第 0 层缓存（start=0 时并入，按楼层从小到大排最前）→
            // 负数/全量失效只清第 0 层 chatMeta；非负锚定层失效该层。
            const chatKey = getChatCacheKey();
            if (affect === 'full') {
                invalidateOccurrence(chatKey, 'chatMeta', 0);
                markSnapshotDirty(0);
            } else if (typeof floor === 'number' && Number.isFinite(floor) && floor >= 0) {
                invalidateOccurrence(chatKey, 'chatMeta', floor);
                markSnapshotDirty(floor);
            } else if (typeof floor === 'number' && Number.isFinite(floor) && floor < 0) {
                // 负数条目变更：内容在第 0 层缓存里 → 只失效第 0 层
                invalidateOccurrence(chatKey, 'chatMeta', 0);
                markSnapshotDirty(0);
            }
            moduleCacheManager.updateModuleCacheDebounced(true);
            const isFloorValid = typeof floor === 'number' && Number.isFinite(floor) && floor >= 0;
            if (affect === 'single') {
                if (isFloorValid) scheduleMsgBottom('single', floor);
            } else if (affect === 'suffix') {
                if (isFloorValid) {
                    scheduleMsgBottom('suffix', floor);
                    // inline=true：该条包含非 after_body 增量模块 → 影响后续楼层的正文内
                    if (inline) {
                        // 收集 floor..end 的 DOM 楼层（仅渲染存在的消息）
                        const suffixIds = [];
                        document.querySelectorAll('#chat .mes').forEach(el => {
                            const id = Number(el.getAttribute('mesid'));
                            if (!Number.isNaN(id) && id >= floor) suffixIds.push(id);
                        });
                        // ⚠️ force：后续楼层正文内模块 raw 可能已被样式替换（已渲染），
                        // 普通路径找不到原文会跳过 → force 重建原文再替换。
                        if (suffixIds.length > 0) {
                            checkRenderCurrentMessageContext(suffixIds, true);
                        }
                    }
                }
            } else {
                scheduleMsgBottom('full');
                // full 且 inline（负数起始态条目含非 after_body 增量）→ 全量正文内渲染（force）
                if (inline) checkRenderCurrentMessageContext(null, true);
            }
        };
        window.addEventListener(CHAT_MODULE_ENTRIES_UPDATED_EVENT, this.chatModuleEntriesUpdatedHandler);
        infoLog(`[EVENTS]已监听聊天级模块条目变更事件 ${CHAT_MODULE_ENTRIES_UPDATED_EVENT}`);
    }
}

