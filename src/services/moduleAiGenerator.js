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
import { showDebugPanel } from '../ui/generatorDebugPanel.js';

const LOG_TAG = 'ModuleAiGenerator';

// === 待处理结果状态管理 ===
// 手动重新生成(skipStorage=true)成功后,结果暂存于此,等用户在调试面板中决定保存/抛弃
// 用户关闭面板后此结果仍保留,再次点击"重新生成"会重新打开面板显示该结果
let pendingResult = null;
// {
//     context: { mesId, swipeId, generatorName, isModule, extracted, text },
//     debugData: { ...传给 showDebugPanel 的完整数据 }
// }

/**
 * 创建保存回调（供调试面板"保存"按钮调用）
 */
function _createSaveCallback(ctx) {
    return async () => {
        const { mesId, swipeId, generatorName, isModule, extracted, text } = ctx;
        const swipeData = isModule ? extracted : { [generatorName]: text };
        const swipesData = { [swipeId]: swipeData };
        await perMessageStorage.writeMessage(mesId, swipeId, swipesData);
        if (!isModule) {
            generatedContentCache.set(mesId, generatorName, text);
        }
        clearPendingResult();
        infoLog(LOG_TAG, `楼层 ${mesId} ${generatorName} 数据已保存（用户确认）`);
    };
}

/**
 * 创建抛弃回调（供调试面板"抛弃"按钮调用）
 */
function _createDiscardCallback() {
    return () => {
        clearPendingResult();
        infoLog(LOG_TAG, '用户抛弃了上次生成结果');
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
 * 是否有待处理结果（用户尚未决定保存/抛弃）
 */
export function hasPendingResult() {
    return pendingResult !== null;
}

/**
 * 清除待处理结果
 */
export function clearPendingResult() {
    pendingResult = null;
}

/**
 * 重新打开调试面板显示待处理结果
 * 用户手误关闭面板后,再次点击"重新生成"时调用
 */
export function reopenPendingDebugPanel() {
    if (!pendingResult) return false;
    const { context, debugData } = pendingResult;
    // 重新绑定回调（每次 showDebugPanel 创建新 IframeModal）
    debugData.onSave = _createSaveCallback(context);
    debugData.onDiscard = _createDiscardCallback();
    debugData.onLoadCurrentContent = _createLoadCurrentCallback(context);
    showDebugPanel(debugData);
    infoLog(LOG_TAG, '重新打开待处理结果的调试面板');
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
            // Pipeline 模式：injectPrompt 完全来自用户配置或 generator_config
            if (!effectivePipelineModifier) {
                warnLog(LOG_TAG, 'pipeline 模式未配置追加指令，请在设置中填写');
                return { success: false, text: '', debug: null, storedCount: 0 };
            }

            const injectPrompt = effectivePipelineModifier;

            // quietPrompt 放所有消息内容
            const quietPrompt = messages.map(m =>
                `--- 楼层 ${m.mesId} (${m.is_user ? '用户' : m.name}) ---\n${m.text}`
            ).join('\n\n');

            callOptions = {
                mode: 'pipeline',
                quietPrompt,
                injectPrompt,
                customApi,
                responseLength,
            };

            sentInfo = { type: 'pipeline', quietPrompt, injectPrompt };
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
                    // 构造 swipe 数据:模块用 extracted,其他用 { [generatorName]: result.text }
                    const swipeData = isModule ? extracted : { [generatorName]: result.text };

                    // 非模块生成内容写入内存缓存（供 promptInjector 注入时同步读取）
                    if (!isModule) {
                        for (const msg of messages) {
                            generatedContentCache.set(msg.mesId, generatorName, result.text);
                        }
                    }

                    if (isSingle) {
                        const msg = messages[0];
                        const swipesData = { [msg.activeSwipeId]: swipeData };
                        await perMessageStorage.writeMessage(msg.mesId, msg.activeSwipeId, swipesData);
                        storedCount = 1;
                        infoLog(LOG_TAG, `楼层 ${msg.mesId} ${generatorName} 数据已存储`);
                    } else {
                        for (const msg of messages) {
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
                };

                // 手动重新生成(skipStorage)且单条成功时,暂存结果供用户在面板中决定保存/抛弃
                if (skipStorage && result.text && isSingle) {
                    const context = {
                        mesId: messages[0].mesId,
                        swipeId: messages[0].activeSwipeId,
                        generatorName,
                        isModule,
                        extracted,
                        text: result.text,
                    };
                    pendingResult = { context, debugData };
                    debugData.onSave = _createSaveCallback(context);
                    debugData.onDiscard = _createDiscardCallback();
                    debugData.onLoadCurrentContent = _createLoadCurrentCallback(context);
                }

                showDebugPanel(debugData);
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
