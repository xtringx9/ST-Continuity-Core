// src/services/aiCaller.js
// 底层 AI 调用封装：支持 raw（自定义提示词）和 pipeline（走 ST 管线）两种模式
// 支持独立 API（通过 CHAT_COMPLETION_SETTINGS_READY 拦截）
// pipeline 模式：prepareOpenAIMessages 组装提示词 + sendOpenAIRequest 发送请求
// raw 模式：generateRaw 发送自定义提示词
// 每次调用触发 debug 事件，供 debug 面板展示

import {
    generateRaw,
    Generate,
    eventSource,
    event_types,
    chat,
    name1,
} from '../../../../../../script.js';
import { sendOpenAIRequest } from '../../../../../openai.js';
import { debugLog, infoLog, errorLog } from '../utils/logger.js';

const LOG_TAG = 'AiCaller';

/**
 * AI 调用器
 *
 * 用法：
 *   const result = await aiCaller.call({ mode: 'raw', prompt: [...], customApi: {...} });
 *   const result = await aiCaller.call({ mode: 'pipeline', quietPrompt: '...', injectPrompt: '...', customApi: {...} });
 */
export const aiCaller = {
    /**
     * 调用 AI 生成
     * @param {object} options
     * @param {'raw'|'pipeline'} options.mode - 调用模式
     * @param {Array<{role:string,content:string}>} [options.prompt] - raw 模式的消息数组
     * @param {string} [options.quietPrompt] - pipeline 模式的 quietPrompt（用户输入内容）
     * @param {string} [options.injectPrompt] - pipeline 模式注入到 extension_prompts 的指令文本
     * @param {object} [options.customApi] - 独立 API 配置
     * @param {string} [options.customApi.apiurl] - API URL
     * @param {string} [options.customApi.key] - API Key
     * @param {string} [options.customApi.model] - 模型名
     * @param {string} [options.customApi.source] - API 类型 (openai/etc)
     * @param {number} [options.customApi.temperature] - 温度
     * @param {number} [options.customApi.max_tokens] - 最大 token
     * @param {number} [options.responseLength] - 响应长度限制
     * @returns {Promise<{text: string, debug: {prompt: string|Array, response: string, apiUsed: object}}>}
     */
    async call(options = {}) {
        const { mode, customApi, responseLength } = options;
        let result = '';
        const capture = { prompt: '' };
        let apiUsed = {};

        // 注册独立 API 拦截器
        let settingsCleanup = null;
        if (customApi && customApi.apiurl) {
            const handler = (data) => {
                data.reverse_proxy = customApi.apiurl;
                data.chat_completion_source = customApi.source || 'openai';
                data.proxy_password = customApi.key || '';
                if (customApi.model) data.model = customApi.model;
                if (customApi.temperature !== undefined) data.temperature = customApi.temperature;
                if (customApi.max_tokens > 0) data.max_tokens = customApi.max_tokens;
                apiUsed = {
                    apiurl: customApi.apiurl,
                    model: customApi.model || data.model,
                    source: customApi.source || 'openai',
                    temperature: customApi.temperature ?? data.temperature,
                    max_tokens: customApi.max_tokens ?? data.max_tokens,
                };
                debugLog(LOG_TAG, '独立 API 拦截已生效', apiUsed);
            };
            eventSource.once(event_types.CHAT_COMPLETION_SETTINGS_READY, handler);
            settingsCleanup = () => eventSource.removeListener(event_types.CHAT_COMPLETION_SETTINGS_READY, handler);
        }

        let callError = null;
        try {
            if (mode === 'raw') {
                result = await this._callRaw(options, capture);
            } else if (mode === 'pipeline') {
                result = await this._callPipeline(options, capture);
            } else {
                throw new Error(`未知的调用模式: ${mode}`);
            }
            infoLog(LOG_TAG, `AI 调用完成，响应类型: ${typeof result}，长度: ${result?.length ?? 'null'}`);
            infoLog(LOG_TAG, `AI 原始响应内容（前500字）: ${String(result).substring(0, 500)}`);
        } catch (e) {
            callError = e;
            errorLog(LOG_TAG, `AI 调用失败(仍会触发 debug): ${e?.message || e}`);
        } finally {
            if (settingsCleanup) settingsCleanup();
        }

        const debugInfo = {
            prompt: capture.prompt,
            response: result,
            apiUsed,
            error: callError?.message || null,
        };

        this._emitDebug(debugInfo);

        if (callError) {
            // 把 debugInfo 挂到 error 上,让上层 catch 能读取已捕获的提示词
            callError.debugInfo = debugInfo;
            throw callError;
        }

        return { text: result, debug: debugInfo };
    },

    /**
     * Raw 模式：自定义提示词
     * 使用 generateRaw，触发 CHAT_COMPLETION_PROMPT_READY 事件
     */
    async _callRaw(options, capture) {
        const { prompt, responseLength } = options;

        if (!prompt || !Array.isArray(prompt)) {
            throw new Error('raw 模式需要提供 prompt 消息数组');
        }

        const promptHandler = (eventData) => {
            if (Array.isArray(eventData.chat)) {
                capture.prompt = eventData.chat.map(m => ({ ...m }));
            }
        };
        eventSource.once(event_types.CHAT_COMPLETION_PROMPT_READY, promptHandler);

        const textPromptHandler = (eventData) => {
            if (typeof eventData.prompt === 'string') {
                capture.prompt = eventData.prompt;
            }
        };
        eventSource.once(event_types.GENERATE_AFTER_COMBINE_PROMPTS, textPromptHandler);

        try {
            const result = await generateRaw({
                prompt: prompt,
                responseLength: responseLength || 500,
            });
            return result || '';
        } finally {
            eventSource.removeListener(event_types.CHAT_COMPLETION_PROMPT_READY, promptHandler);
            eventSource.removeListener(event_types.GENERATE_AFTER_COMBINE_PROMPTS, textPromptHandler);
        }
    },

    /**
     * Pipeline 模式：dryRun 组装 ST 完整提示词 + 自行发送
     * 1. 临时隐藏 truncateToMesId 之后的楼层（is_system 标记，不保存，生成完还原）
     *    → 让 AI 只看到 0..truncateToMesId 的正文上下文
     * 2. 生成指令两种模式（开关 pushAsLastUser 控制）：
     *    - true：push 进 chat 作为「第 X+1 层 user 消息」（临时，生成完 pop）
     *      → chatHistory 最后一条是 user 生成指令，{{lastUserMessage}} 可取到它；quiet_prompt 传空
     *    - false：经 quiet_prompt 传入（system 角色，控制提示词末尾），不碰 chat
     * 3. Generate('quiet', opts, true) dryRun 组装完整提示词（ST 原生 coreChat：正则/文件/宏/世界书/预设全保留），
     *    捕获 CHAT_COMPLETION_PROMPT_READY 的 eventData.chat
     *    → dryRun 不锁发送按钮（可边聊边生成），不发请求
     * 4. 自行 sendOpenAIRequest 发送（customApi 拦截在内部生效 → 独立 API 可用）
     */
    async _callPipeline(options, capture) {
        const { quietPrompt, responseLength, truncateToMesId, pushAsLastUser } = options;
        options.onAbort ||= null;

        // 记录需要临时隐藏的楼层及原 is_system 值
        const hiddenBackup = [];
        if (typeof truncateToMesId === 'number' && truncateToMesId >= 0 && Array.isArray(chat)) {
            for (let i = truncateToMesId + 1; i < chat.length; i++) {
                if (!chat[i]) continue;
                hiddenBackup.push({ index: i, wasSystem: !!chat[i].is_system });
                chat[i].is_system = true;
            }
            if (hiddenBackup.length > 0) {
                infoLog(LOG_TAG, `临时隐藏 ${hiddenBackup.length} 条楼层（${truncateToMesId + 1}..${chat.length - 1}）`);
            }
        }

        // push 模式：生成指令作为最后一条 user 消息（临时，生成完 pop）
        const shouldPush = pushAsLastUser && quietPrompt && typeof quietPrompt === 'string' && quietPrompt.trim();
        const pushedUserMessage = shouldPush ? { is_user: true, mes: quietPrompt, name: name1 } : null;
        if (pushedUserMessage && Array.isArray(chat)) {
            chat.push(pushedUserMessage);
            infoLog(LOG_TAG, `已临时 push 生成指令 user 消息（第 ${chat.length - 1} 层）`);
        }

        try {
            // dryRun 组装完整提示词：Generate('quiet', opts, true) 只组装不发请求、不锁发送按钮
            // → 走 ST 原生 coreChat（正则/文件/宏/世界书/预设全保留）
            // → push 模式：生成指令已 push 进 chat（历史最后 user），quiet_prompt 传空
            // → quietPrompt 模式：生成指令经 quiet_prompt（system 角色末尾）
            const effectiveQuietPrompt = shouldPush ? '' : (quietPrompt || '');
            infoLog(LOG_TAG, `dryRun 组装提示词，模式: ${shouldPush ? 'push-user' : 'quietPrompt'}，指令长度: ${quietPrompt?.length ?? 0}`);

            let assembledChat = null;
            const promptHandler = (eventData) => {
                if (Array.isArray(eventData.chat)) {
                    assembledChat = eventData.chat;
                    capture.prompt = eventData.chat.map(m => ({ ...m }));
                }
            };
            eventSource.once(event_types.CHAT_COMPLETION_PROMPT_READY, promptHandler);

            await Generate('quiet', { quiet_prompt: effectiveQuietPrompt, force_name2: true }, true);

            // 组装失败兜底
            if (!Array.isArray(assembledChat) || assembledChat.length === 0) {
                throw new Error('提示词组装失败（未捕获到组装结果）');
            }

            // 自己发送（customApi 拦截在 sendOpenAIRequest 内部生效；不锁 ST 发送按钮）
            infoLog(LOG_TAG, `自行 sendOpenAIRequest，消息数: ${assembledChat.length}`);
            const abortController = new AbortController();
            // 暴露中止能力（调试面板「中止」按钮用）
            options.onAbort?.(() => abortController.abort());
            const responseData = await sendOpenAIRequest('normal', assembledChat, abortController.signal);

            // 解析响应：流式（async generator）与非流式（对象/字符串）
            let resultText = '';
            // 流式：sendOpenAIRequest 返回 async function*，调用得 generator，需 for await 累积 text
            if (typeof responseData === 'function' || (responseData && typeof responseData[Symbol.asyncIterator] === 'function')) {
                const gen = typeof responseData === 'function' ? responseData() : responseData;
                for await (const chunk of gen) {
                    if (typeof chunk?.text === 'string' && chunk.text) {
                        resultText = chunk.text; // 每次 chunk 是累计文本，取最后
                    }
                }
            } else if (responseData && typeof responseData === 'object') {
                if (typeof responseData.content === 'string') {
                    resultText = responseData.content;
                } else if (responseData.choices?.[0]?.message?.content) {
                    resultText = responseData.choices[0].message.content;
                } else if (responseData.choices?.[0]?.text) {
                    resultText = responseData.choices[0].text;
                }
            } else if (typeof responseData === 'string') {
                resultText = responseData;
            }
            infoLog(LOG_TAG, `sendOpenAIRequest 返回，文本长度: ${resultText.length}`);
            return resultText;
        } finally {
            // 弹出临时 push 的 user 消息
            if (pushedUserMessage && Array.isArray(chat) && chat[chat.length - 1] === pushedUserMessage) {
                chat.pop();
                infoLog(LOG_TAG, '已弹出临时 push 的生成指令 user 消息');
            }
            // 还原临时隐藏的楼层
            for (const { index, wasSystem } of hiddenBackup) {
                if (chat[index]) chat[index].is_system = wasSystem;
            }
            if (hiddenBackup.length > 0) {
                infoLog(LOG_TAG, `已还原 ${hiddenBackup.length} 条临时隐藏的楼层`);
            }
        }
    },

    /**
     * 触发 debug 事件
     */
    _emitDebug(debugInfo) {
        const event = new CustomEvent('continuity-core:ai-debug', {
            detail: {
                timestamp: new Date().toISOString(),
                ...debugInfo,
            },
        });
        document.dispatchEvent(event);
        debugLog(LOG_TAG, 'AI 调用完成，debug 事件已触发');
    },
};

export default aiCaller;
