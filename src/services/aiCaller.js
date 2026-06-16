// src/services/aiCaller.js
// 底层 AI 调用封装：支持 raw（自定义提示词）和 pipeline（走 ST 管线）两种模式
// 支持独立 API（通过 CHAT_COMPLETION_SETTINGS_READY 拦截）
// pipeline 模式：prepareOpenAIMessages 组装提示词 + sendOpenAIRequest 发送请求
// raw 模式：generateRaw 发送自定义提示词
// 每次调用触发 debug 事件，供 debug 面板展示

import {
    generateRaw,
    setExtensionPrompt,
    eventSource,
    event_types,
    chat,
    name2,
    characters,
    this_chid,
} from '../../../../../../script.js';
import { getContext } from '../../../../../extensions.js';
import { prepareOpenAIMessages, sendOpenAIRequest } from '../../../../../openai.js';
import { debugLog, infoLog, warnLog, errorLog } from '../utils/logger.js';

const LOG_TAG = 'AiCaller';

// 临时注入 extension_prompt 的 key
const CCORE_PIPELINE_INJECT_KEY = 'continuity_core_ai_generator_inject';

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
                if (customApi.max_tokens !== undefined) data.max_tokens = customApi.max_tokens;
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
        } finally {
            if (settingsCleanup) settingsCleanup();
        }

        const debugInfo = {
            prompt: capture.prompt,
            response: result,
            apiUsed,
        };

        this._emitDebug(debugInfo);
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
     * Pipeline 模式：走 ST 完整管线
     * 1. setExtensionPrompt 注入指令
     * 2. prepareOpenAIMessages 组装完整提示词
     * 3. sendOpenAIRequest 发送请求
     */
    async _callPipeline(options, capture) {
        const { quietPrompt, injectPrompt, responseLength } = options;

        // 注入指令到 extension_prompts
        if (injectPrompt) {
            setExtensionPrompt(
                CCORE_PIPELINE_INJECT_KEY,
                injectPrompt,
                0,   // position: IN_PROMPT (after system prompt)
                0,   // depth (only for IN_CHAT)
                true, // allow world info scan
                0,   // role: SYSTEM
            );
            infoLog(LOG_TAG, '已注入 pipeline 指令到 extension_prompts');
        }

        // 临时保存/恢复 responseLength
        const savedResponseLength = responseLength || 500;

        try {
            // 构建消息数据
            const character = characters?.[this_chid];
            const context = getContext();

            const messageData = {
                name2,
                charDescription: character?.description || '',
                charPersonality: character?.personality || '',
                Scenario: character?.scenario || '',
                worldInfoBefore: '',
                worldInfoAfter: '',
                extensionPrompts: context?.extensionPrompts || {},
                bias: '',
                type: 'normal',
                quietPrompt: quietPrompt || '',
                quietImage: null,
                cyclePrompt: '',
                systemPromptOverride: character?.data?.system_prompt || '',
                jailbreakPromptOverride: character?.data?.jailbreak_prompt || '',
                personaDescription: '',
                messages: [],
                messageExamples: [],
            };

            infoLog(LOG_TAG, `调用 prepareOpenAIMessages，quietPrompt 长度: ${quietPrompt?.length ?? 0}`);

            // prepareOpenAIMessages 组装完整提示词
            const [prompt] = await prepareOpenAIMessages(messageData, false);

            // 捕获组装后的提示词
            if (Array.isArray(prompt)) {
                capture.prompt = prompt.map(m => ({ ...m }));
            }

            infoLog(LOG_TAG, `提示词组装完成，消息数: ${prompt?.length ?? 0}`);

            // 发送请求
            const abortController = new AbortController();
            const responseData = await sendOpenAIRequest('normal', prompt, abortController.signal);

            // 解析响应
            let resultText = '';
            if (responseData) {
                if (typeof responseData === 'string') {
                    resultText = responseData;
                } else if (responseData.choices?.[0]?.message?.content) {
                    resultText = responseData.choices[0].message.content;
                } else if (responseData.choices?.[0]?.text) {
                    resultText = responseData.choices[0].text;
                }
            }

            infoLog(LOG_TAG, `sendOpenAIRequest 返回，类型: ${typeof responseData}，文本长度: ${resultText.length}`);
            return resultText;
        } finally {
            // 清理：移除注入的 extension_prompt
            if (injectPrompt) {
                setExtensionPrompt(CCORE_PIPELINE_INJECT_KEY, '', 0, 0, false, 0);
                infoLog(LOG_TAG, '已移除 pipeline 注入的 extension_prompt');
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
