// src/services/moduleAiGenerator.js
// 高层模块生成：构建提示词 + 调用 aiCaller + 解析响应 + 存储
// 核心原则：无论单条还是多条，都只做一次 AI 调用

import { aiCaller } from './aiCaller.js';
import perMessageStorage from './perMessageStorage.js';
import { chat, getCurrentChatDetails } from '../../../../../../script.js';
import { debugLog, warnLog, errorLog, infoLog } from '../utils/logger.js';
import { showDebugPanel } from '../ui/generatorDebugPanel.js';

const LOG_TAG = 'ModuleAiGenerator';

/**
 * 模块 AI 生成器
 *
 * 核心原则：无论单条还是多条消息，都只做一次 AI 来回调用。
 * - 单条：把那条消息内容放进提示词
 * - 多条：把所有消息内容合并放进提示词，让 AI 一次返回所有
 */
export const moduleAiGenerator = {

    /**
     * 为指定楼层生成模块数据（一次 AI 调用）
     * @param {number|number[]} mesIds - 单个楼层 ID 或楼层 ID 数组
     * @param {object} options
     * @param {'raw'|'pipeline'} [options.mode='pipeline'] - 调用模式
     * @param {object} [options.customApi] - 独立 API 配置
     * @param {string} [options.rawSystemPrompt] - raw 模式系统提示词
     * @param {string} [options.rawUserPrompt] - raw 模式用户提示词模板
     * @param {string} [options.pipelineModifier] - pipeline 模式追加指令
     * @param {string[]} [options.cotTags] - contentTag 标签列表
     * @param {number} [options.responseLength] - 响应长度
     * @param {boolean} [options.showDebug=true] - 是否显示 debug 面板
     * @returns {Promise<{success: boolean, text: string, debug: object, hasModules: boolean, storedCount: number}>}
     */
    async generate(mesIds, options = {}) {
        const {
            mode = 'pipeline',
            customApi,
            rawSystemPrompt,
            rawUserPrompt,
            pipelineModifier,
            cotTags = [],
            responseLength,
            showDebug: shouldShowDebug = true,
            skipStorage = false,
        } = options;

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
        debugLog(LOG_TAG, `开始生成，${messages.length} 条消息，模式: ${mode}`);

        let callOptions = {};
        let sentInfo = {};

        if (mode === 'raw') {
            if (!rawSystemPrompt) {
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
                    { role: 'system', content: rawSystemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                customApi,
                responseLength,
            };

            sentInfo = { type: 'raw', prompt: callOptions.prompt };

        } else {
            // Pipeline 模式：injectPrompt 完全来自用户配置
            if (!pipelineModifier) {
                warnLog(LOG_TAG, 'pipeline 模式未配置追加指令，请在设置中填写');
                return { success: false, text: '', debug: null, storedCount: 0 };
            }

            const injectPrompt = pipelineModifier;

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
                // 解析 AI 回复中的模块数据
                extracted = perMessageStorage.extractMessageModules(result.text, cotTags);

                hasModules = extracted.moduleTagModules.length > 0
                    || extracted.contentTagModules.length > 0
                    || extracted.extraModules.length > 0;

                // 存储到每条消息
                if (hasModules) {
                    if (isSingle) {
                        const msg = messages[0];
                        const swipesData = { [msg.activeSwipeId]: extracted };
                        await perMessageStorage.writeMessage(msg.mesId, msg.activeSwipeId, swipesData);
                        storedCount = 1;
                        infoLog(LOG_TAG, `楼层 ${msg.mesId} 模块数据已存储`);
                    } else {
                        for (const msg of messages) {
                            const swipesData = { [msg.activeSwipeId]: extracted };
                            await perMessageStorage.writeMessage(msg.mesId, msg.activeSwipeId, swipesData);
                            storedCount++;
                        }
                        infoLog(LOG_TAG, `${messages.length} 条消息模块数据已存储`);
                    }
                } else {
                    infoLog(LOG_TAG, `AI 回复中未提取到模块数据`);
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

                showDebugPanel({
                    title: `生成调试 ${titleBody}`,
                    statusLabel: '生成调试',
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
                });
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

                // 从 err.debugInfo 读取 aiCaller 已捕获的提示词(API 失败时仍有值)
                const errDebug = err.debugInfo || {};

                showDebugPanel({
                    title: `生成失败 ${titleBody}`,
                    statusLabel: '生成失败',
                    statusType: 'fail',
                    titleBody,
                    mesIds: ids,
                    mode,
                    sentInfo,
                    capturedPrompt: errDebug.prompt || '',
                    response: errDebug.response || `错误: ${err.message}`,
                    extracted: { moduleTagModules: [], contentTagModules: [], extraModules: [] },
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
