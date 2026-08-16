// src/services/moduleAiGenerator.js
// 高层生成内容生成器：构建提示词 + 调用 aiCaller + 解析响应 + 存储
// 核心原则：无论单条还是多条，都只做一次 AI 调用
// 支持模块(generatorName='modules')和其他生成内容(generatorName=generator.name)

import { aiCaller } from './aiCaller.js';
import perMessageStorage from './perMessageStorage.js';
import configManager from '../singleton/configManager.js';
import generatedContentCache from '../singleton/generatedContentCache.js';
import { chat, getCurrentChatDetails } from '../../../../../../script.js';
import { debugLog, warnLog, errorLog, infoLog } from '../utils/logger.js';
import { showDebugPanel, updateDebugPanelResponse, updateDebugPanelPrompt, isDebugPanelOpen, finishDebugPanel } from '../ui/generatorDebugPanel.js';
import { writeFloorModules } from '../core/floorModuleStore.js';
import { setGenerationContextEndFloor, clearGenerationContext } from '../core/generationContext.js';
import { taskRegistry } from '../core/taskRegistry.js';

const LOG_TAG = 'ModuleAiGenerator';

// === 待处理结果状态管理 ===
// 手动重新生成(skipStorage=true)成功后,结果按 聊天标识 + generatorName + mesId 组合暂存
// 不同聊天/角色/楼层的待处理结果互相独立
// 持久化到 sessionStorage,刷新页面后仍可恢复
const PENDING_STORAGE_KEY = 'ccore_pending_results';
const pendingResults = new Map(); // key: `${chatKey}::${generatorName}::${mesId}`, value: { context, debugData }

/**
 * 获取当前聊天标识（角色名 + 聊天文件名）
 * 不同聊天/角色的 mesId 重复,需用聊天标识隔离
 */
function _getChatKey() {
    try {
        const details = getCurrentChatDetails();
        return `${details?.characterName || ''}::${details?.sessionName || ''}`;
    } catch {
        return 'unknown';
    }
}

function _pendingKey(generatorName, mesId) {
    return `${_getChatKey()}::${generatorName}::${mesId}`;
}

// 初始化时从 sessionStorage 恢复
(function _loadPendingFromStorage() {
    try {
        const raw = sessionStorage.getItem(PENDING_STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        for (const [key, result] of Object.entries(data)) {
            pendingResults.set(key, result);
        }
        if (pendingResults.size > 0) {
            infoLog(LOG_TAG, `从 sessionStorage 恢复 ${pendingResults.size} 个待处理结果`);
        }
    } catch (e) {
        // 忽略解析错误
    }
})();

function _savePendingToStorage() {
    try {
        const data = {};
        for (const [key, result] of pendingResults) {
            data[key] = result;
        }
        sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        // 忽略写入错误（如 sessionStorage 已满）
    }
}

/**
 * 创建保存回调（供调试面板"保存"按钮调用）
 */
function _createSaveCallback(ctx) {
    return async () => {
        const { mesId, swipeId, generatorName, isModule, extracted, text, chatKey } = ctx;

        // 聊天归属校验：生成时的聊天 ≠ 当前聊天 → 拒绝保存（避免写错聊天文件），不破坏 pending 可稍后重试
        if (chatKey && chatKey !== _getChatKey()) {
            warnLog(LOG_TAG, `保存被拒绝：生成时聊天 ${chatKey} ≠ 当前聊天 ${_getChatKey()}`);
            toastr.warning('聊天已切换，无法保存。请回到原聊天后，在该楼层的生成按钮处重新打开调试面板再保存。');
            return;
        }

        if (isModule) {
            // 模块数据存 floor（F 一期：正文后模块），写入触发楼层模块变更事件
            writeFloorModules(mesId, swipeId, extracted?.modules || '');
        } else {
            const swipeData = { [generatorName]: text };
            const swipesData = { [swipeId]: swipeData };
            await perMessageStorage.writeMessage(mesId, swipeId, swipesData);
            generatedContentCache.set(mesId, generatorName, text);
        }
        // 移除 taskRegistry 任务 + 清 pending
        taskRegistry.remove(`${_getChatKey()}::${mesId}::${generatorName}`);
        clearPendingResult(generatorName, mesId);
        infoLog(LOG_TAG, `楼层 ${mesId} ${generatorName} 数据已保存（用户确认）`);
    };
}

/**
 * 创建抛弃回调（供调试面板"抛弃"按钮调用）
 */
function _createDiscardCallback(generatorName, mesId) {
    return () => {
        taskRegistry.remove(`${_getChatKey()}::${mesId}::${generatorName}`);
        clearPendingResult(generatorName, mesId);
        infoLog(LOG_TAG, `用户抛弃了 楼层${mesId} ${generatorName} 的生成结果`);
    };
}

/**
 * 创建"查看当前内容"回调（供调试面板按钮调用，异步返回当前存储内容）
 */
function _createLoadCurrentCallback(ctx) {
    return async () => {
        const { mesId, swipeId, generatorName, isModule } = ctx;
        const msgData = await perMessageStorage.getMessage(mesId, swipeId);
        if (!msgData) return '';
        return isModule ? (msgData.modules || '') : (msgData[generatorName] || '');
    };
}

/**
 * 是否有指定 generator + 楼层的待处理结果
 * @param {string} generatorName - 'modules' 或 generator.name
 * @param {number} mesId - 楼层 ID
 */
export function hasPendingResult(generatorName, mesId) {
    return pendingResults.has(_pendingKey(generatorName, mesId));
}

/**
 * 清除指定 generator + 楼层的待处理结果
 */
export function clearPendingResult(generatorName, mesId) {
    const key = _pendingKey(generatorName, mesId);
    pendingResults.delete(key);
    _savePendingToStorage();
    // 通知 UI 更新按钮图标
    window.dispatchEvent(new CustomEvent('ccore-pending-cleared', { detail: { generatorName, mesId } }));
}

/**
 * 重新打开调试面板显示待处理结果
 * 用户手误关闭面板后,再次点击"重新生成"时调用
 */
export function reopenPendingDebugPanel(generatorName, mesId) {
    const pending = pendingResults.get(_pendingKey(generatorName, mesId));
    if (!pending) return false;
    const { context, debugData } = pending;
    // 重新绑定回调（每次 showDebugPanel 创建新 IframeModal）
    debugData.onSave = _createSaveCallback(context);
    debugData.onDiscard = _createDiscardCallback(generatorName, mesId);
    debugData.onLoadCurrentContent = _createLoadCurrentCallback(context);
    showDebugPanel(debugData);
    infoLog(LOG_TAG, `重新打开 楼层${mesId} ${generatorName} 的待处理结果调试面板`);
    return true;
}

/**
 * 生成内容 AI 生成器
 *
 * 核心原则：无论单条还是多条消息，都只做一次 AI 来回调用。
 * - 单条：把那条消息内容放进提示词
 * - 多条：把所有消息内容合并放进提示词，让 AI 一次返回所有
 *
 * 支持两种生成内容：
 * - 模块(generatorName='modules')：从 AI 回复提取模块文本,存 modules key
 * - 其他生成内容(generatorName=generator.name)：直接存 AI 回复到对应 key
 */
export const moduleAiGenerator = {

    /**
     * 为指定楼层生成内容（一次 AI 调用）
     * @param {number|number[]} mesIds - 单个楼层 ID 或楼层 ID 数组
     * @param {object} options
     * @param {string} [options.generatorName='modules'] - 生成内容标识,'modules' 或 generator.name
     * @param {'raw'|'pipeline'} [options.mode='pipeline'] - 调用模式
     * @param {object} [options.customApi] - 独立 API 配置
     * @param {string} [options.rawSystemPrompt] - raw 模式系统提示词(模块用,其他从 generator_config 读)
     * @param {string} [options.rawUserPrompt] - raw 模式用户提示词模板
     * @param {string} [options.pipelineModifier] - pipeline 模式追加指令(模块用,其他从 generator_config 读)
     * @param {string[]} [options.selectedPrompts] - select 模式已选提示词 label 数组(其他生成内容用)
     * @param {number} [options.responseLength] - 响应长度
     * @param {boolean} [options.showDebug=true] - 是否显示 debug 面板
     * @param {boolean} [options.skipStorage=false] - 是否跳过存储
     * @returns {Promise<{success: boolean, text: string, debug: object, hasModules: boolean, storedCount: number}>}
     */
    async generate(mesIds, options = {}) {
        const {
            generatorName = 'modules',
            mode = 'pipeline',
            customApi,
            rawSystemPrompt,
            rawUserPrompt,
            pipelineModifier,
            selectedPrompts,
            responseLength,
            showDebug: shouldShowDebug = true,
            skipStorage = false,
        } = options;

        const isModule = generatorName === 'modules';

        // 统一为数组
        const ids = Array.isArray(mesIds) ? mesIds : [mesIds];

        // 收集消息
        const messages = [];
        for (const mesId of ids) {
            const message = chat[mesId];
            if (message) {
                messages.push({
                    mesId,
                    text: message.mes || message.content || '',
                    activeSwipeId: message.swipe_id ?? 0,
                    name: message.name || '',
                    is_user: message.is_user ?? false,
                });
            }
        }

        if (messages.length === 0) {
            warnLog(LOG_TAG, '没有有效的消息');
            return { success: false, text: '', debug: null, storedCount: 0 };
        }

        const isSingle = messages.length === 1;
        debugLog(LOG_TAG, `开始生成 ${generatorName}，${messages.length} 条消息，模式: ${mode}`);

        // F 重构：重新生成第 X 层时，让 AI 只看到 0..X 的正文上下文。
        // aiCaller 通过 truncateToMesId 临时隐藏 X 之后的楼层（is_system 标记，生成完还原）。
        // 正文给到 X 层（含目标层正文自然涵盖），生成指令作为 X+1 层 user 消息（quietPrompt）。
        const truncateToMesId = Math.max(...messages.map(m => m.mesId));
        debugLog(LOG_TAG, `生成上下文截断到楼层 ${truncateToMesId}`);

        // 根据 generatorName 决定提示词来源
        let effectivePipelineModifier = pipelineModifier;
        let effectiveRawSystemPrompt = rawSystemPrompt;

        if (!isModule) {
            // 其他生成内容：从 generator_config 查找提示词
            const generator = configManager.getGeneratorByName(generatorName);
            if (!generator) {
                warnLog(LOG_TAG, `找不到生成内容配置: ${generatorName}`);
                return { success: false, text: '', debug: null, storedCount: 0 };
            }

            // 按 promptMode 选提示词
            let selectedItems = [];
            if (selectedPrompts && selectedPrompts.length > 0) {
                // select 模式：外部传入已选 label 数组
                selectedItems = generator.prompts.filter(p => selectedPrompts.includes(p.label));
            } else if (generator.promptMode === 'random') {
                // random 模式：随机选一个
                if (generator.prompts.length > 0) {
                    selectedItems = [generator.prompts[Math.floor(Math.random() * generator.prompts.length)]];
                }
            } else {
                // select 模式但未传入：用所有 prompts
                selectedItems = generator.prompts;
            }

            if (selectedItems.length === 0) {
                warnLog(LOG_TAG, `生成内容 ${generatorName} 没有可用提示词`);
                return { success: false, text: '', debug: null, storedCount: 0 };
            }

            // 合并提示词 content
            const combinedPrompt = selectedItems.map(p => p.content).join('\n\n');

            if (mode === 'raw') {
                effectiveRawSystemPrompt = combinedPrompt;
            } else {
                effectivePipelineModifier = combinedPrompt;
            }

            debugLog(LOG_TAG, `生成内容 ${generatorName}(${generator.displayName}) 选中 ${selectedItems.length} 条提示词`);
        }

        let callOptions = {};
        let sentInfo = {};

        if (mode === 'raw') {
            if (!effectiveRawSystemPrompt) {
                warnLog(LOG_TAG, 'raw 模式未配置系统提示词，请在设置中填写');
                return { success: false, text: '', debug: null, storedCount: 0 };
            }

            // 用户提示词：用模板或默认格式
            const userPrompt = rawUserPrompt
                ? rawUserPrompt
                : messages.map(m =>
                    `--- 楼层 ${m.mesId} (${m.is_user ? '用户' : m.name}) ---\n${m.text}`
                ).join('\n\n');

            callOptions = {
                mode: 'raw',
                prompt: [
                    { role: 'system', content: effectiveRawSystemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                customApi,
                responseLength,
            };

            sentInfo = { type: 'raw', prompt: callOptions.prompt };

        } else {
            // Pipeline 模式：走 ST 完整管线（generateQuietPrompt）。
            // - quietPrompt = 生成指令（作为「第 X+1 层的 user 消息」，即用户在该层正文后发送的指令）
            // - truncateToMesId = 临时隐藏 X 之后楼层，让 AI 只看 0..X 正文
            if (!effectivePipelineModifier) {
                warnLog(LOG_TAG, 'pipeline 模式未配置追加指令，请在设置中填写');
                return { success: false, text: '', debug: null, storedCount: 0 };
            }

            // 生成指令作为最后一条 user 消息
            const quietPrompt = effectivePipelineModifier;

            // 开关：true=push 进 chat 作为最后 user 消息（{{lastUserMessage}} 可取）；false=经 quietPrompt（system 角色末尾）
            const pushAsLastUser = !!configManager.getModuleDomainConfig().asyncModule?.pushUserMessageAsLast;

            callOptions = {
                mode: 'pipeline',
                quietPrompt,
                truncateToMesId,
                pushAsLastUser,
                customApi,
                responseLength,
            };

            sentInfo = { type: 'pipeline', quietPrompt, truncateToMesId, pushAsLastUser };
        }

        // 生成期上下文：宏 {{CONTINUITY_MODULE_DATA}} 只读到目标层前一楼（目标层模块正要生成）
        const isPipeline = mode === 'pipeline';
        if (isPipeline) {
            setGenerationContextEndFloor(truncateToMesId - 1);
            debugLog(LOG_TAG, `设置生成上下文截止楼层 ${truncateToMesId - 1}（宏 moduleData 截断）`);
        }

        // 全局任务注册：记录生成所属聊天（保存校验用）+ running 状态（按钮计数/防重）
        const taskChatKey = _getChatKey();
        taskRegistry.setCurrentChatKey(taskChatKey);
        const taskKeys = [];
        for (const m of messages) {
            taskKeys.push(taskRegistry.start({ chatKey: taskChatKey, mesId: m.mesId, generatorName }));
        }

        // 中止能力：aiCaller 暴露 abort 后注入对应任务（调试面板「中止」按钮用）
        callOptions.onAbort = (abortFn) => {
            for (const k of taskKeys) taskRegistry.setAbort(k, abortFn);
        };

        // 流式增量（阶段 2）：aiCaller 每收到 chunk 就推送，更新 taskRegistry debugData + 已打开面板
        callOptions.onStream = (text) => {
            if (taskKeys.length === 0) return;
            const k = taskKeys[0];
            // 更新任务 debugData（后续「重新打开面板」显示最终响应）
            const task = taskRegistry.get(taskChatKey, messages[0]?.mesId, generatorName);
            if (task?.debugData) {
                task.debugData.response = text;
                task.debugData.statusLabel = `${isModule ? '生成调试' : `生成调试 [${generatorName}]`}（生成中）`;
            }
            // 实时更新已打开的面板「完整响应」
            updateDebugPanelResponse(k, text);
        };

        // 捕获到提示词后实时推送（阶段 2：生成中面板显示「实际发送」而非「未捕获到」）
        callOptions.onPrompt = (prompt) => {
            if (taskKeys.length === 0) return;
            const k = taskKeys[0];
            const task = taskRegistry.get(taskChatKey, messages[0]?.mesId, generatorName);
            if (task?.debugData) {
                task.debugData.capturedPrompt = prompt;
            }
            updateDebugPanelPrompt(k, prompt);
        };

        // 生成中 debugData（供「生成中点击按钮打开调试面板」用；完整响应生成后由 finish 更新）
        if (taskKeys.length > 0) {
            const m0 = messages[0];
            const scope = isSingle ? `#${m0.mesId}` : `#${ids[0]}-${ids[ids.length - 1]}`;
            const details = getCurrentChatDetails();
            const titleBody = `${scope} - ${details?.characterName || ''} / ${details?.sessionName || ''}`;
            const titleLabel = isModule ? '生成调试' : `生成调试 [${generatorName}]`;
            const runningTaskKey = taskKeys[0];
            taskRegistry.setDebugData(runningTaskKey, {
                title: `${titleLabel} ${titleBody}`,
                statusLabel: `${titleLabel}（生成中）`,
                statusType: 'info',
                titleBody,
                mesIds: ids,
                mode,
                sentInfo,
                capturedPrompt: '',
                response: '生成中…',
                extracted: isModule ? { modules: '' } : null,
                apiUsed: null,
                hasModules: false,
                // taskKey：面板据此注册流式实时更新（阶段 2）
                taskKey: runningTaskKey,
                // 中止按钮（生成中打开面板时显示）
                onAbort: () => taskRegistry.abortTask(runningTaskKey),
            });
        }

        try {
            const result = await aiCaller.call(callOptions);

            let extracted = null;
            let storedCount = 0;
            let hasModules = false;

            if (!skipStorage) {
                if (isModule) {
                    // 模块：从 AI 回复提取模块文本,存 modules key
                    extracted = perMessageStorage.extractMessageModules(result.text);
                    hasModules = extracted.modules.length > 0;
                } else {
                    // 其他生成内容：直接存 AI 回复到 generatorName key
                    hasModules = result.text.length > 0;
                }

                // 存储到每条消息
                if (hasModules) {
                    if (isModule) {
                        // 模块数据存 floor（F 一期：正文后模块），写入触发楼层模块变更事件
                        if (isSingle) {
                            const msg = messages[0];
                            writeFloorModules(msg.mesId, msg.activeSwipeId, extracted?.modules || '');
                            storedCount = 1;
                            infoLog(LOG_TAG, `楼层 ${msg.mesId} ${generatorName} 数据已存储（floor）`);
                        } else {
                            for (const msg of messages) {
                                writeFloorModules(msg.mesId, msg.activeSwipeId, extracted?.modules || '');
                                storedCount++;
                            }
                            infoLog(LOG_TAG, `${messages.length} 条消息 ${generatorName} 数据已存储（floor）`);
                        }
                    } else {
                        // 非模块生成内容：仍走 perMessageStorage + 内存缓存
                        const swipeData = { [generatorName]: result.text };
                        for (const msg of messages) {
                            generatedContentCache.set(msg.mesId, generatorName, result.text);
                            const swipesData = { [msg.activeSwipeId]: swipeData };
                            await perMessageStorage.writeMessage(msg.mesId, msg.activeSwipeId, swipesData);
                            storedCount++;
                        }
                        infoLog(LOG_TAG, `${messages.length} 条消息 ${generatorName} 数据已存储`);
                    }
                } else {
                    infoLog(LOG_TAG, `AI 回复中未提取到 ${generatorName} 数据`);
                }
            }

            // 显示 debug 面板
            if (shouldShowDebug) {
                const details = getCurrentChatDetails();
                const charName = details?.characterName || '';
                const chatName = details?.sessionName || '';
                const scope = isSingle
                    ? `#${messages[0].mesId}`
                    : `#${ids[0]}-${ids[ids.length - 1]}`;
                const titleBody = `${scope} - ${charName} / ${chatName}`;
                const titleLabel = isModule ? '生成调试' : `生成调试 [${generatorName}]`;

                const debugData = {
                    title: `${titleLabel} ${titleBody}`,
                    statusLabel: titleLabel,
                    statusType: 'info',
                    titleBody,
                    mesIds: ids,
                    mode,
                    sentInfo,
                    capturedPrompt: result.debug.prompt,
                    response: result.text,
                    extracted,
                    apiUsed: result.debug.apiUsed,
                    hasModules,
                    storedCount,
                    taskKey: taskKeys[0] || undefined, // 供「面板是否已打开」判断，避免重复弹
                };

                // 手动重新生成(skipStorage)且单条成功时,暂存结果供用户在面板中决定保存/抛弃
                if (skipStorage && result.text && isSingle) {
                    const mesId = messages[0].mesId;
                    const context = {
                        mesId,
                        swipeId: messages[0].activeSwipeId,
                        generatorName,
                        isModule,
                        extracted,
                        text: result.text,
                        chatKey: taskChatKey, // 生成归属聊天，保存校验用
                    };
                    pendingResults.set(_pendingKey(generatorName, mesId), { context, debugData });
                    _savePendingToStorage();
                    debugData.onSave = _createSaveCallback(context);
                    debugData.onDiscard = _createDiscardCallback(generatorName, mesId);
                    debugData.onLoadCurrentContent = _createLoadCurrentCallback(context);
                }

                // 生成中面板已打开 → 不重复弹新面板，改为更新为完成态
                if (taskKeys[0] && isDebugPanelOpen(taskKeys[0])) {
                    finishDebugPanel(taskKeys[0], debugData);
                } else {
                    showDebugPanel(debugData);
                }
            }

            if (isPipeline) clearGenerationContext();
            // 成功：完整 debugData 写入任务（供后续「重新打开面板」显示真实结果）
            const successDebug = typeof debugData === 'object' ? debugData : null;
            for (const k of taskKeys) {
                taskRegistry.finish(k, 'success', successDebug);
                if (successDebug) taskRegistry.setDebugData(k, successDebug);
            }
            return {
                success: !!result.text,
                text: result.text,
                debug: result.debug,
                extracted,
                hasModules,
                storedCount,
            };
        } catch (err) {
            if (isPipeline) clearGenerationContext();
            for (const k of taskKeys) taskRegistry.finish(k, 'error', { mesId: messages[0]?.mesId, generatorName, success: false, error: err.message });
            errorLog(LOG_TAG, `AI 生成失败:`, err);

            if (shouldShowDebug) {
                const details = getCurrentChatDetails();
                const charName = details?.characterName || '';
                const chatName = details?.sessionName || '';
                const scope = isSingle
                    ? `#${messages[0].mesId}`
                    : `#${ids[0]}-${ids[ids.length - 1]}`;
                const titleBody = `${scope} - ${charName} / ${chatName}`;
                const titleLabel = isModule ? '生成失败' : `生成失败 [${generatorName}]`;

                // 从 err.debugInfo 读取 aiCaller 已捕获的提示词(API 失败时仍有值)
                const errDebug = err.debugInfo || {};

                showDebugPanel({
                    title: `${titleLabel} ${titleBody}`,
                    statusLabel: titleLabel,
                    statusType: 'fail',
                    titleBody,
                    mesIds: ids,
                    mode,
                    sentInfo,
                    capturedPrompt: errDebug.prompt || '',
                    response: errDebug.response || `错误: ${err.message}`,
                    extracted: isModule ? { modules: '' } : null,
                    apiUsed: errDebug.apiUsed || {},
                    hasModules: false,
                    error: err.message,
                });
            }

            return { success: false, text: '', debug: err.debugInfo || null, error: err.message, hasModules: false, storedCount: 0 };
        }
    },
};

export default moduleAiGenerator;
