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
import { MacrosParser } from '../../../../../macros.js';
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

        // 注册 API 拦截器（总是监听，用于捕获实际使用的 API 信息）
        // - 有 customApi：覆盖成独立 API（覆盖 source/model/url/key）
        // - 无 customApi：只捕获主 API 的 source/model（调试面板显示用）
        let settingsCleanup = null;
        {
            const handler = (data) => {
                const isCustom = !!(customApi && customApi.apiurl);
                if (isCustom) {
                    data.reverse_proxy = customApi.apiurl;
                    data.chat_completion_source = customApi.source || 'openai';
                    data.proxy_password = customApi.key || '';
                    if (customApi.model) data.model = customApi.model;
                    if (customApi.temperature !== undefined) data.temperature = customApi.temperature;
                    if (customApi.max_tokens > 0) data.max_tokens = customApi.max_tokens;
                }
                apiUsed = {
                    apiurl: isCustom ? customApi.apiurl : (data.reverse_proxy || ''),
                    model: isCustom ? (customApi.model || data.model) : (data.model || ''),
                    source: isCustom ? (customApi.source || 'openai') : (data.chat_completion_source || ''),
                    temperature: isCustom ? (customApi.temperature ?? data.temperature) : (data.temperature),
                    max_tokens: isCustom ? (customApi.max_tokens ?? data.max_tokens) : (data.max_tokens),
                    custom: isCustom, // 标记是否为独立 API
                };
                // 实时推送 API 信息（阶段 2：生成中面板显示「API 信息」）
                options.onApiUsed?.(apiUsed);
                debugLog(LOG_TAG, isCustom ? '独立 API 拦截已生效' : '主 API 信息已捕获', apiUsed);
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
            debugLog(LOG_TAG, `AI 原始响应内容（前500字）: ${String(result).substring(0, 500)}`);
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
                debugLog(LOG_TAG, `临时隐藏 ${hiddenBackup.length} 条楼层（${truncateToMesId + 1}..${chat.length - 1}）`);
            }
        }

        // push 模式：生成指令作为最后一条 user 消息（临时，生成完 pop）
        const shouldPush = pushAsLastUser && quietPrompt && typeof quietPrompt === 'string' && quietPrompt.trim();
        const pushedUserMessage = shouldPush ? { is_user: true, mes: quietPrompt, name: name1 } : null;
        if (pushedUserMessage && Array.isArray(chat)) {
            chat.push(pushedUserMessage);
            debugLog(LOG_TAG, `已临时 push 生成指令 user 消息（第 ${chat.length - 1} 层）`);
        }

        // 组装前提取「最新 user 消息」的原文（lastUserMes），供组装后定位替换。
        // 组装后数组不保留 identifier/name（实测 getChat() 不输出 name），用 content 包含 lastUserMes 匹配。
        let lastUserMes = '';
        if (Array.isArray(chat)) {
            const upper = (typeof truncateToMesId === 'number' && truncateToMesId >= 0) ? Math.min(truncateToMesId, chat.length - 1) : chat.length - 1;
            for (let i = upper; i >= 0; i--) {
                const m = chat[i];
                if (m && m.is_user && !m.is_system) {
                    lastUserMes = m.mes || '';
                    break;
                }
            }
        }
        debugLog(LOG_TAG, lastUserMes
            ? `组装前最新 user 消息（index≤${typeof truncateToMesId === 'number' ? truncateToMesId : 'end'}）：` + lastUserMes.slice(0, 200)
            : `组装前未找到最新 user 消息（index≤${typeof truncateToMesId === 'number' ? truncateToMesId : 'end'}）`);

        // 宏展开前覆盖 {{lastUserMessage}} 宏（push 未开启时无条件覆盖）。
        // 原理：MacrosParser.registerMacro 的宏进 envMacros，在 ST 内置 postEnvMacros 之前展开 → 覆盖生效；
        // 组装后 unregisterMacro 恢复 ST 内置。此时 quiet_prompt 一律传空（生成指令由宏展开/后续手动补末尾承载）。
        const overrideLastUser = !shouldPush && quietPrompt && typeof quietPrompt === 'string' && quietPrompt.trim();
        if (overrideLastUser) {
            MacrosParser.registerMacro('lastUserMessage', () => quietPrompt);
            debugLog(LOG_TAG, '已覆盖 {{lastUserMessage}} 宏为生成指令（宏展开前替换）');
        }

        try {
            // dryRun 组装完整提示词：Generate('quiet', opts, true) 只组装不发请求、不锁发送按钮
            // → 走 ST 原生 coreChat（正则/文件/宏/世界书/预设全保留）
            // → quiet_prompt 一律传空：生成指令由「宏覆盖展开」或「组装后手动补末尾 user」承载，
            //   不依赖 ST 的 system 身份 quietPrompt（避免身份/位置不可控）。
            const effectiveQuietPrompt = ''; // 生成指令全部走宏替换或组装后补末尾
            debugLog(LOG_TAG, `dryRun 组装提示词，模式: ${shouldPush ? 'push-user' : (overrideLastUser ? 'macro-replace' : 'no-prompt')}，指令长度: ${quietPrompt?.length ?? 0}`);

            let assembledChat = null;
            const promptHandler = (eventData) => {
                if (Array.isArray(eventData.chat)) {
                    assembledChat = eventData.chat;
                    capture.prompt = eventData.chat.map(m => ({ ...m }));
                    // 实时推送捕获到的提示词（阶段 2：生成中面板显示「实际发送」）
                    options.onPrompt?.(capture.prompt);
                }
            };
            eventSource.once(event_types.CHAT_COMPLETION_PROMPT_READY, promptHandler);

            await Generate('quiet', { quiet_prompt: effectiveQuietPrompt, force_name2: true }, true);

            // 组装失败兜底
            if (!Array.isArray(assembledChat) || assembledChat.length === 0) {
                throw new Error('提示词组装失败（未捕获到组装结果）');
            }

            // 打印组装后数组结构（诊断用）：一次性打印整个对象（debugLog 可展开对象）
            try {
                debugLog(LOG_TAG, `组装后数组（共 ${assembledChat.length} 条）:`, assembledChat);
            } catch (e) {
                errorLog(LOG_TAG, '打印组装后数组失败:', e);
            }

            // 组装后替换「最新 user 消息」本体（与宏替换并存）。
            // 策略：筛选 role==='user' 的消息，找 content 包含「组装前最新 user 原文」的：
            //   - 恰好 1 条 → 在该消息内部把 lastUserMes 子串替换为生成指令（保留正则加工的其他内容）
            //   - 0 条或多条、或组装前未提取到 lastUserMes → 无法唯一命中 → 把 quietPrompt 补回数组末尾作为最后 user 消息
            if (overrideLastUser) {
                const canMatch = lastUserMes && typeof lastUserMes === 'string' && lastUserMes.trim();
                const userMsgs = canMatch
                    ? assembledChat.filter(msg => msg && msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes(lastUserMes))
                    : [];
                if (userMsgs.length === 1) {
                    const target = userMsgs[0];
                    const idx = assembledChat.indexOf(target);
                    const before = target.content;
                    target.content = target.content.split(lastUserMes).join(quietPrompt);
                    // 同步更新 capture.prompt（它是替换前的浅拷贝，面板显示会旧）
                    if (Array.isArray(capture.prompt) && capture.prompt[idx]) {
                        capture.prompt[idx] = { ...capture.prompt[idx], content: target.content };
                    }
                    debugLog(LOG_TAG, `替换唯一命中 user 消息 index=${idx}：`);
                    debugLog(LOG_TAG, `  替换前 content（len=${before.length}）:`, before.slice(0, 300));
                    debugLog(LOG_TAG, `  替换后 content（len=${target.content.length}）:`, target.content.slice(0, 300));
                } else {
                    // 兜底：quietPrompt 作为最后一条 user 消息补回数组末尾
                    assembledChat.push({ role: 'user', content: quietPrompt });
                    capture.prompt.push({ role: 'user', content: quietPrompt });
                    debugLog(LOG_TAG, `命中 ${userMsgs.length} 条（期望1条，canMatch=${!!canMatch}），兜底：quietPrompt 补为最后 user 消息`);
                }
            }

            // 组装完成 → 立即还原临时隐藏的楼层（发送阶段 chat 已是原状，避免其他代码读到隐藏态）
            // 原 is_system 值精确恢复（原来就隐藏的楼层保持隐藏）
            for (const { index, wasSystem } of hiddenBackup) {
                if (chat[index]) chat[index].is_system = wasSystem;
            }
            if (hiddenBackup.length > 0) {
                debugLog(LOG_TAG, `组装完成已还原 ${hiddenBackup.length} 条临时隐藏楼层`);
            }

            // 自己发送（customApi 拦截在 sendOpenAIRequest 内部生效；不锁 ST 发送按钮）
            debugLog(LOG_TAG, `自行 sendOpenAIRequest，消息数: ${assembledChat.length}`);
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
                        // 流式增量推送（阶段 2：调试面板实时更新）
                        options.onStream?.(chunk.text);
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
            // 恢复 {{lastUserMessage}} 宏（宏替换模式）
            if (overrideLastUser) {
                MacrosParser.unregisterMacro('lastUserMessage');
                debugLog(LOG_TAG, '已恢复 {{lastUserMessage}} 宏');
            }
            // 弹出临时 push 的 user 消息
            if (pushedUserMessage && Array.isArray(chat) && chat[chat.length - 1] === pushedUserMessage) {
                chat.pop();
                debugLog(LOG_TAG, '已弹出临时 push 的生成指令 user 消息');
            }
            // 还原临时隐藏的楼层
            for (const { index, wasSystem } of hiddenBackup) {
                if (chat[index]) chat[index].is_system = wasSystem;
            }
            if (hiddenBackup.length > 0) {
                debugLog(LOG_TAG, `已还原 ${hiddenBackup.length} 条临时隐藏的楼层`);
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
