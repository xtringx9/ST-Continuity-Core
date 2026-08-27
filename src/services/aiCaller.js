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
    showSwipeButtons,
    substituteParams,
} from '../../../../../../script.js';
import {
    sendOpenAIRequest,
    oai_settings,
    openai_settings,
    openai_setting_names,
    settingsToUpdate,
    promptManager,
} from '../../../../../openai.js';
import { MacrosParser } from '../../../../../macros.js';
import { getPromptBindings, WB_BIND_MODE } from '../features/prompt-binding/promptBindingState.js';
import configManager from '../singleton/configManager.js';
import { debugLog, infoLog, errorLog, warnLog } from '../utils/logger.js';
import { SECRET_KEYS, secret_state, readSecretState } from '../../../../../secrets.js';
import { rotateSecretQuiet } from './secretRotator.js';

const LOG_TAG = 'AiCaller';

// ⚠️ 2026-08-27 单飞锁（方案 A）：临时预设应用/恢复是全局共享 oai_settings 上的操作，
//   多个 _callPipeline 并发/重叠时若用"跳过旧恢复"策略会导致 oai_settings 最终停在临时候选
//   预设而非原始值，被 ST saveSettings 落盘即"预设被覆盖保存"。
//   改用语义明确的互斥锁，保证「apply 预设 → Generate dryRun 组装 → restore」整段临界区串行，
//   任一时刻只有一个调用占用 oai_settings，restore 必然回到原始值。
//   锁只覆盖 apply→restore 窗口（含 await Generate），发送阶段（sendOpenAIRequest）在 restore
//   之后，不占锁，避免把网络等待也串行化。
let presetLock = Promise.resolve();
let presetLockRelease = null;

/**
 * 获取预设临界区锁：等待前一个持有者释放后再进入，保证串行。
 * 与 releasePresetLock 配对；释放由调用方在 restore 后（含异常 finally）保证。
 */
async function acquirePresetLock() {
    const prev = presetLock;
    let release;
    presetLock = new Promise((resolve) => { release = resolve; });
    presetLockRelease = release;
    await prev;
}

/** 释放预设临界区锁（幂等由调用方 presetLockReleased 标志保证）。 */
function releasePresetLock() {
    if (presetLockRelease) {
        presetLockRelease();
        presetLockRelease = null;
    }
}

/** 深拷贝应用值：对象/数组字段绝不按引用赋给 oai_settings，避免污染已保存的预设本体。 */
function _clonePresetValue(value) {
    if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch (e) { /* 回退 JSON */ }
    }
    return JSON.parse(JSON.stringify(value));
}

/**
 * 临时把指定 secretId 设为 api_key_custom 的激活密钥（走 ST 服务端 CUSTOM 通道时用）。
 * ⚠️ 方案 B（2026-08-26）：浏览器拿不到 api_key_custom 原文（ST 默认不暴露），只能让服务端
 *    readSecret(CUSTOM) 读「激活」密钥。这里临时切到目标密钥，生成完由调用方 finally 还原，
 *    避免长期改变 ST 全局激活密钥。
 * @param {string} [secretId] 要临时激活的 secretId；缺省则不做任何事
 * @returns {Promise<string|null>} 切换前原本激活的 secretId（供还原），无切换时返回 null
 */
async function _transientlyActivateSecret(secretId) {
    if (!secretId) return null;
    try {
        if (!secret_state[SECRET_KEYS.CUSTOM]) {
            await readSecretState();
        }
        const prior = (secret_state[SECRET_KEYS.CUSTOM] || []).find(s => s && s.active);
        const priorId = prior?.id || null;
        // 静默旋转：不走 ST rotateSecret（会触发 #main_api change → 自动重连 → 切预设/拉模型，卡顿且干扰并发预设保护）
        await rotateSecretQuiet(SECRET_KEYS.CUSTOM, secretId);
        debugLog(LOG_TAG, `已临时激活 secretId=${secretId}（前激活=${priorId || '无'}）`);
        return priorId;
    } catch (e) {
        errorLog(LOG_TAG, '临时激活 secretId 失败:', e);
        return null;
    }
}

/** 调试拦截发送时返回的占位响应（configManager.debug.interceptSend 开启时使用） */
const INTERCEPT_MOCK_RESPONSE = '[拦截测试] aiCaller 发送已被调试开关拦截，未实际调用 API。';

/**
 * 组装失败时的兜底数组构造（2026-08-18 简化，用户拍板）：
 * 不塞历史楼层，仅一条「提示词 + 角色」。
 * @param {number} truncateToMesId 目标楼层（保留签名兼容调用方，不再用于遍历）
 * @param {string} quietPrompt 生成指令
 * @param {string} fallbackPromptRole 补末尾消息角色
 * @param {boolean} alreadyPushed 是否已走 pushpop（保留签名兼容；兜底数组与 pushpop 无关）
 * @returns {Array<{role:string, content:string}>}
 */
function _buildFallbackChat(truncateToMesId, quietPrompt, fallbackPromptRole, alreadyPushed) {
    const out = [];
    if (quietPrompt) {
        out.push({ role: fallbackPromptRole, content: quietPrompt });
    }
    debugLog(LOG_TAG, `兜底数组构造完成：${out.length} 条（仅提示词+角色）`);
    return out;
}

/**
 * 构造 pushpop 的临时消息（生成指令）。
 * ⚠️ 2026-08-18 简化：pushpop 是「生成指令作为最后 user 消息」语义，恒为 user 消息；
 *   提示词组角色（fallbackPromptRole）仅用于组装后兜底 push（_callPipeline 391 行），与 pushpop 无关。
 * @param {string} quietPrompt 生成指令
 * @param {string} name 用户名
 * @returns {{is_user:true, mes:string, name:string}}
 */
function _buildPushedMessage(quietPrompt, name) {
    return { is_user: true, mes: quietPrompt, name };
}

/**
 * 弹出临时 push 的生成指令 user 消息。只在临时消息仍存在时移除，绝不误删其他消息。
 * ⚠️ 2026-08-23：正常路径临时消息必在 chat[last]，用「位置+引用」判断最安全（主路径）。
 *   但异常/中断时 await Generate 等异步窗口可能被 ST 追加/重排 chat，导致临时消息不再位于
 *   chat[last] → 仅位置判断会漏 pop、残留 is_user 脏楼层（用户复现：api 未连接时 push 没 pop）。
 *   故加引用兜底：chat.indexOf 用 === 按对象身份匹配，只能命中本次创建的 pushedUserMessage，
 *   命中即 splice 移除，杜绝误删其他消息。
 * @param {object} pushedUserMessage 本次创建的临时消息对象（不存在则返回 false）
 * @returns {boolean} 是否实际移除
 */
function _popPushedMessage(pushedUserMessage) {
    if (!pushedUserMessage || !Array.isArray(chat)) return false;
    // 1) 主路径：临时消息仍在末尾 → pop 最安全
    if (chat[chat.length - 1] === pushedUserMessage) {
        chat.pop();
        return true;
    }
    // 2) 引用兜底：chat 元素被重排但对象未变 → 按引用定位移除（只匹配本对象）
    const refIdx = chat.indexOf(pushedUserMessage);
    if (refIdx !== -1) {
        chat.splice(refIdx, 1);
        return true;
    }
    // 3) 内容兜底（2026-08-23）：ST 生成期间可能对 chat 重建/深拷（swipe 机制），临时消息以
    //    新对象复制进新数组 → 上面引用判断全失效 → 残留。末尾往前找「is_user + name===name1 +
    //    mes 与本条指令完全一致」的消息移除；命中条件苛刻，误删他消息概率极低。
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (m && m.is_user && m.mes === pushedUserMessage.mes && m.name === pushedUserMessage.name) {
            chat.splice(i, 1);
            return true;
        }
    }
    return false;
}

/**
 * 临时预设被覆盖了 prompt_order/prompts 时，强制 PromptManager 用已恢复的原数据重绘一次，
 * 以覆盖 dryRun 组装期间延迟异步渲染可能残留的“临时预设条目”帧。
 * 仅当确实覆盖过 prompt_order/prompts 时才重绘（避免无谓触发 ST UI）。
 * @param {Array<{setting:string, oldValue:*}>|null} presetBackup 本次临时应用的备份数组
 */
function _refreshPromptManagerAfterPresetRestore(presetBackup) {
    const touchedList = Array.isArray(presetBackup) && presetBackup.some(f => f.setting === 'prompt_order' || f.setting === 'prompts');
    if (!touchedList) return;
    if (!promptManager || typeof promptManager.render !== 'function') return;
    try {
        // afterTryGenerate=false：只重绘列表，不触发 tryGenerate/二次组装
        promptManager.render(false);
        debugLog(LOG_TAG, '临时预设已还原，强制 PromptManager 用原数据重绘（清除临时预设条目残留）');
    } catch (e) {
        debugLog(LOG_TAG, `恢复预设后刷新 PromptManager UI 失败（忽略）:`, e);
    }
}

/**
 * 临时应用 ST OpenAI 预设到 oai_settings（dryRun 组装期间用，2026-08-18）。
 * ⚠️ 只覆盖「组装内容相关」字段：按 settingsToUpdate 映射遍历，跳过 isConnection（模型/URL/source 等
 *   连接绑定字段——组装内容无关，且发送阶段反正被 customApi 拦截覆盖）。
 * ⚠️ 不触发 OAI_PRESET_CHANGED 事件/UI 刷新（纯内存覆盖，无副作用）。
 * ⚠️ 2026-08-18 增强：若「提示词条目·聊天绑定」（promptBinding）功能开启，把当前聊天的条目绑定
 *   （on/off）应用到目标预设的 prompt_order 条目 enabled 上，实现对拿来 dryRun 组装的那个预设的条目开关。
 * @param {string} presetName ST OpenAI 预设名（openai_setting_names 的 key，空=用当前预设不覆盖）
 * @returns {Array<{setting:string, oldValue:*}>|null} 备份数组（供 _restorePresetForAssembly 恢复）
 */
function _applyPresetForAssembly(presetName) {
    if (!presetName || typeof presetName !== 'string') return null;
    const idx = openai_setting_names?.[presetName];
    const preset = idx !== undefined ? openai_settings?.[idx] : null;
    if (!preset || typeof preset !== 'object') {
        warnLog(LOG_TAG, `找不到 ST OpenAI 预设: ${presetName}，本次生成使用当前预设`);
        return null;
    }
    // ⚠️ 2026-08-27：单飞锁（方案 A）已保证本临界区串行，无需 opId 并发校验。
    const fields = [];
    try {
        for (const [presetKey, [, setting, , isConnection]] of Object.entries(settingsToUpdate)) {
            if (isConnection) continue; // 连接绑定字段（模型/URL/source 等）不覆盖
            if (preset[presetKey] === undefined) continue; // 预设没有该字段 → 不动
            // ✅ Hole2：对象/数组字段（prompt_order/prompts/extensions）深拷贝后再赋，
            //   绝不引用预设本体，避免组装期间被就地修改而污染用户已保存的预设。
            const value = typeof preset[presetKey] === 'object' && preset[presetKey] !== null
                ? _clonePresetValue(preset[presetKey])
                : preset[presetKey];
            fields.push({ setting, oldValue: oai_settings[setting] });
            oai_settings[setting] = value;
        }
    } catch (e) {
        // ✅ Hole1：中途抛错时把已记录的备份就地还原，保证 oai_settings 不残留临时预设值，
        //   避免「备份丢失 → finally 空恢复 → 切不回去」。
        for (const { setting, oldValue } of fields) oai_settings[setting] = oldValue;
        errorLog(LOG_TAG, `临时应用 ST OpenAI 预设失败，已还原已改字段:`, e);
        throw e;
    }
    // promptBinding 增强：功能开启才处理，否则保持现有逻辑（用户拍板，2026-08-18）
    // ✅ Hole1 兜底：此附加逻辑单独 try/catch，抛错也不丢弃已收集的备份（fields 一定随返回值返回）。
    if (configManager.getStFeatureEnhanceConfig()?.promptBinding?.enabled === true) {
        try {
            _applyPromptBindingsToPresetOrder(fields);
        } catch (e) {
            errorLog(LOG_TAG, `应用 promptBinding 到目标预设失败，已忽略（预设备份仍保留）:`, e);
        }
    }
    if (fields.length === 0) return null;
    debugLog(LOG_TAG, `已临时应用 ST OpenAI 预设「${presetName}」，覆盖 ${fields.length} 个组装相关字段`);
    return fields;
}

/**
 * 把当前聊天的提示词条目绑定（promptBinding，存在 floor）应用到目标预设的 prompt_order 条目。
 * 生效原理：组装时 getPromptCollection 用 `entry.enabled` 决定是否纳入（PromptManager.js:1533），
 *   与 applyBindingsToPromptManager 瞬态改 entry.enabled 等效。
 * ⚠️ 深拷贝：修改落在副本上，不污染预设本体（openai_settings[idx]）。
 * ⚠️ 备份保护：只要改了 prompt_order 条目就必须把 prompt_order 加入备份（无论是否被预设覆盖），
 *   否则恢复时 finally 不还原 → 残留污染。若无条目命中则撤销该备份。
 * @param {Array<{setting:string, oldValue:*}>} fields 备份数组（_applyPresetForAssembly 传入，可能已含 prompt_order）
 */
function _applyPromptBindingsToPresetOrder(fields) {
    const bindings = getPromptBindings();
    if (!bindings || typeof bindings !== 'object') return;
    const entries = Object.entries(bindings).filter(([, mode]) => mode === WB_BIND_MODE.ON || mode === WB_BIND_MODE.OFF);
    if (entries.length === 0) return;

    const order = oai_settings.prompt_order;
    if (!Array.isArray(order)) return;

    // 定位 activeCharacter 对应的 order 列表（global strategy 下 activeCharacter.id=dummyId）
    const activeId = promptManager?.activeCharacter ? String(promptManager.activeCharacter.id) : null;
    const charOrder = activeId !== null ? order.find(l => String(l.character_id) === activeId) : null;
    if (!charOrder || !Array.isArray(charOrder.order)) return;

    // ⚠️ 备份 prompt_order 原值（引用）；若已被预设覆盖则 fields 已含，勿重复
    if (!fields.some(f => f.setting === 'prompt_order')) {
        fields.push({ setting: 'prompt_order', oldValue: oai_settings.prompt_order });
    }

    // 深拷贝后修改（避免污染预设本体）
    const clonedOrder = structuredClone(order);
    const clonedCharOrder = clonedOrder.find(l => String(l.character_id) === activeId);
    let appliedCount = 0;
    for (const [identifier, mode] of entries) {
        const entry = (clonedCharOrder?.order || []).find(e => e.identifier === identifier);
        if (!entry) continue; // 目标预设没有该条目 → 跳过
        entry.enabled = (mode === WB_BIND_MODE.ON);
        appliedCount++;
    }
    oai_settings.prompt_order = clonedOrder;
    if (appliedCount > 0) {
        debugLog(LOG_TAG, `promptBinding 已应用：${appliedCount} 个条目按聊天绑定开关（目标预设 prompt_order）`);
    } else {
        // 无条目命中：撤销刚加的 prompt_order 备份（引用已换为等价深拷贝，无害）
        const idx = fields.findIndex(f => f.setting === 'prompt_order');
        if (idx >= 0) fields.splice(idx, 1);
    }
}

/**
 * 恢复临时应用的 ST OpenAI 预设（组装完成后立即调用；异常/中止由 finally 兜底）。
 * @param {Array<{setting:string, oldValue:*}>|null} fields _applyPresetForAssembly 返回的备份
 */
function _restorePresetForAssembly(fields) {
    if (!Array.isArray(fields) || fields.length === 0) return;
    // ⚠️ 2026-08-27：单飞锁（方案 A）已保证临界区串行，本函数必然对应唯一活跃应用，
    //   无需再校验 opId 跳过——直接恢复全部备份字段，oai_settings 必然回到原始值。
    for (const { setting, oldValue } of fields) {
        oai_settings[setting] = oldValue;
    }
    debugLog(LOG_TAG, `已恢复 oai_settings（${fields.length} 个字段回到原值）`);
}

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
     * @param {string} [options.presetName] - pipeline 模式：dryRun 组装时临时使用的 ST OpenAI 预设名（空=用当前预设）
     * @returns {Promise<{text: string, debug: {prompt: string|Array, response: string, apiUsed: object}}>}
     */
    async call(options = {}) {
        const { mode, customApi, responseLength } = options;
        const callStartedAt = Date.now();
        // 方案 B（2026-08-26）：有 secretId 时走 ST 服务端 CUSTOM 通道——先临时激活目标密钥，
        //   服务端 readSecret(CUSTOM) 读到的即该密钥；明文 key 场景保持原有 reverse_proxy+proxy_password。
        const useSecretChannel = !!(customApi && customApi.secretId);
        let restoreSecretId = null;
        if (useSecretChannel) {
            restoreSecretId = await _transientlyActivateSecret(customApi.secretId);
        }
        // 包装 onStream：统计本次是否收到过流式数据（供“结束情况”诊断）。纯扩展，不改变现有回调语义。
        const userOnStream = options.onStream;
        let streamed = false;
        if (typeof userOnStream === 'function') {
            options.onStream = (t) => { streamed = true; userOnStream(t); };
        }
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
                    if (useSecretChannel) {
                        // secretId 通道：source=custom + custom_url，服务端用临时激活的 CUSTOM 密钥
                        delete data.reverse_proxy;
                        delete data.proxy_password;
                        data.chat_completion_source = 'custom';
                        data.custom_url = customApi.apiurl;
                    } else {
                        // 明文 key 通道：保持原语义（openai/claude + reverse_proxy + proxy_password）
                        data.reverse_proxy = customApi.apiurl;
                        data.chat_completion_source = customApi.source || 'openai';
                        data.proxy_password = customApi.key || '';
                    }
                    if (customApi.model) data.model = customApi.model;
                    if (customApi.temperature !== undefined) data.temperature = customApi.temperature;
                    if (customApi.max_tokens > 0) data.max_tokens = customApi.max_tokens;
                }
                apiUsed = {
                    apiurl: isCustom ? customApi.apiurl : (data.reverse_proxy || ''),
                    model: isCustom ? (customApi.model || data.model) : (data.model || ''),
                    source: isCustom ? (useSecretChannel ? 'custom' : (customApi.source || 'openai')) : (data.chat_completion_source || ''),
                    temperature: isCustom ? (customApi.temperature ?? data.temperature) : (data.temperature),
                    max_tokens: isCustom ? (customApi.max_tokens ?? data.max_tokens) : (data.max_tokens),
                    custom: isCustom, // 标记是否为独立 API
                    viaSecret: useSecretChannel, // 是否经服务端 secretId 通道
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
            // 还原 active 密钥（临时激活的 secretId 用完后切回原激活）
            if (restoreSecretId) {
                try { rotateSecretQuiet(SECRET_KEYS.CUSTOM, restoreSecretId); } catch (e) { /* 忽略还原失败 */ }
            }
        }

        const debugInfo = {
            prompt: capture.prompt,
            response: result,
            apiUsed,
            error: callError?.message || null,
            // 结束外围信息（方案A：纯扩展，不依赖 ST 透传）。status: 'success'|'error'；
            // streamed 表示本次是否收到过流式 chunk；textLength/durationMs 便于排查“半成品当成功”。
            endInfo: {
                status: callError ? 'error' : 'success',
                durationMs: Date.now() - callStartedAt,
                textLength: String(result ?? '').length,
                streamed,
            },
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
            // 调试拦截：不真正发送（raw 模式 prompt 即最终提示词，直接喂给 capture 供面板显示）
            if (configManager.isAiSendIntercepted()) {
                debugLog(LOG_TAG, '调试拦截：raw 模式不发送，返回占位响应');
                capture.prompt = prompt;
                return INTERCEPT_MOCK_RESPONSE;
            }
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
        const { quietPrompt, responseLength, truncateToMesId, pushAsLastUser, presetName, continuePrefix } = options;
        options.onAbort ||= null;

        // 补末尾生成指令消息的角色（默认 user；弹窗提示词组可传 role 覆盖本次生成）
        const fallbackPromptRole = options.fallbackPromptRole || 'user';

        // ⚠️ 2026-08-18 修复：try/finally 范围扩大到「隐藏楼层 + push + 宏注册」之前——
        //   此前这些修改 chat/宏的操作在 try 外，若其间抛错则 finally 的 pop/还原不执行，
        //   导致 chat 数组残留临时消息/楼层 is_system 污染（「中止/异常走不到收尾」）。
        // ⚠️ finally 引用的变量（hiddenBackup/pushedUserMessage/overrideLastUser）必须在 try 外声明
        //   （const 是块级作用域，try 内声明 finally 不可见 → ReferenceError）。
        /** @type {Array<{index:number, wasSystem:boolean}>} */
        const hiddenBackup = [];
        let pushedUserMessage = null;
        let overrideLastUser = false;
        // ⚠️ 2026-08-18 收尾状态标识：避免 finally 对已提前清理的操作重复执行（二次 pop / 重复还原楼层 / 重复还原宏 / 重复恢复预设）。
        //   - hiddenRestored：隐藏楼层是否已还原（提前清理置 true，finally 依据它跳过）
        //   - pushedPopped：push 的生成指令消息是否已弹出（提前清理置 true，finally 依据它跳过）
        //   - macroRestored：{{lastUserMessage}} 宏是否已还原（提前清理置 true，finally 依据它跳过）
        //   - presetRestored：临时应用的 ST OpenAI 预设是否已恢复（提前清理置 true，finally 依据它跳过）
        let hiddenRestored = false;
        let pushedPopped = false;
        let macroRestored = false;
        let presetRestored = false;
        // ⚠️ 2026-08-23 swipe 箭头补刷状态：组装完成 pop 后已补刷则置 true，
        //   finally 据此跳过重复补刷（避免正常路径刷两次；异常早退路径仍由 finally 兜底补刷）。
        let swipeRefreshed = false;
        /** @type {Array<{setting:string, oldValue:*}>|null} */
        let presetBackup = null;
        // ⚠️ 2026-08-27 单飞锁（方案 A）：预设临界区锁释放标志，与 presetRestored 对齐，确保每 acquire 必 release。
        let presetLockReleased = false;
        // ⚠️ 2026-08-23 PromptManager UI 残留修复：临时预设覆盖了 prompt_order/prompts 时，
        //   dryRun 组装会触发 renderPromptManager 的延迟异步重绘，可能抓到“已覆盖、未恢复”的中间态，
        //   把临时预设的条目画出来（数据已还原、UI 残留到下一次 renderDebounced）。故在恢复预设后强制用
        //   原数据重绘一次；此标志避免正常/异常路径重复触发。
        let presetUiRefreshed = false;

        try {
        // 记录需要临时隐藏的楼层及原 is_system 值
        // 隐藏起点（hideStart）规则（用户拍板，2026-08-17）：
        //   - 目标楼层为 user 消息 → 隐藏 truncateToMesId+1 .. 末尾（现状）
        //   - 目标楼层为非 user 消息 → 保留紧邻的下一条（通常为 user 后续输入），隐藏 truncateToMesId+2 .. 末尾
        //   - 边界：目标楼层为非 user 且为最后一层 → 无后续楼层可保留，不隐藏；组装后生成指令直接走兜底 push
        let forceFallbackPush = false;
        // 组装前搜索「最新 user 消息」的上界（与不隐藏楼层保持一致）：
        //   - 目标楼层为 user → 到 truncateToMesId（目标楼层本身即最新 user）
        //   - 目标楼层为非 user 且非末层 → 到 truncateToMesId+1（保留的下一层通常为 user 后续输入，纳入搜索）
        //   - 目标楼层为非 user 且末层 → 走兜底 push，不依赖 lastUserMes（保持 truncateToMesId 即可）
        let lastUserSearchUpper = (typeof truncateToMesId === 'number' && truncateToMesId >= 0) ? truncateToMesId : -1;
        if (typeof truncateToMesId === 'number' && truncateToMesId >= 0 && Array.isArray(chat)) {
            const targetMsg = chat[truncateToMesId];
            const targetIsUser = targetMsg ? (!!targetMsg.is_user || targetMsg.role === 'user') : false;
            let hideStart = truncateToMesId + 1;
            if (targetMsg && !targetIsUser) {
                if (truncateToMesId < chat.length - 1) {
                    hideStart = truncateToMesId + 2;
                    lastUserSearchUpper = truncateToMesId + 1;
                    debugLog(LOG_TAG, `目标楼层 ${truncateToMesId} 为非 user，保留第 ${truncateToMesId + 1} 层，从 ${hideStart} 开始隐藏`);
                } else {
                    forceFallbackPush = true;
                    debugLog(LOG_TAG, `目标楼层 ${truncateToMesId} 为非 user 且为最后一层，不隐藏，组装后走兜底 push`);
                }
            }
            for (let i = hideStart; i < chat.length; i++) {
                if (!chat[i]) continue;
                hiddenBackup.push({ index: i, wasSystem: !!chat[i].is_system });
                chat[i].is_system = true;
            }
            if (hiddenBackup.length > 0) {
                debugLog(LOG_TAG, `临时隐藏 ${hiddenBackup.length} 条楼层（${hideStart}..${chat.length - 1}）`);
            }
        }

        // push 模式：生成指令作为最后一条消息（临时，生成完 pop）。
        // ⚠️ 2026-08-18 用户拍板：组装后「补末尾」兜底也改为 push 到 chat 末尾（复用 pushpop 机制）。
        //   chat.push 是 push 到真实 chat 数组末尾（所有楼层最后一条后面），组装时 ST 过滤 !is_system，
        //   pushed 消息 is_system falsy → 成为组装数组最后一条（紧跟在截断区最后一条=目标楼层后）；
        //   finally pop() 还原且不保存 → 安全。push 是「截断 chat 的最后一条之后」而非「真的所有楼层最后一条之后」。
        const shouldPush = (pushAsLastUser || forceFallbackPush) && quietPrompt && typeof quietPrompt === 'string' && quietPrompt.trim();
        pushedUserMessage = shouldPush ? _buildPushedMessage(quietPrompt, name1) : null;
        if (pushedUserMessage && Array.isArray(chat)) {
            chat.push(pushedUserMessage);
            debugLog(LOG_TAG, `已临时 push 生成指令 user 消息（第 ${chat.length - 1} 层）${forceFallbackPush ? '（非 user 末层兜底）' : ''}`);
        }

        // 组装前提取「最新 user 消息」的原文（lastUserMes），供组装后定位替换。
        // 组装后数组不保留 identifier/name（实测 getChat() 不输出 name），用 content 包含 lastUserMes 匹配。
        // 搜索上界 = lastUserSearchUpper（与隐藏楼层一致：非 user 目标楼层时纳入保留的下一层）
        let lastUserMes = '';
        if (Array.isArray(chat) && lastUserSearchUpper >= 0) {
            const upper = Math.min(lastUserSearchUpper, chat.length - 1);
            for (let i = upper; i >= 0; i--) {
                const m = chat[i];
                if (m && m.is_user && !m.is_system) {
                    lastUserMes = m.mes || '';
                    break;
                }
            }
        }
        debugLog(LOG_TAG, lastUserMes
            ? `组装前最新 user 消息（index≤${lastUserSearchUpper >= 0 ? lastUserSearchUpper : 'end'}）：` + lastUserMes.slice(0, 200)
            : `组装前未找到最新 user 消息（index≤${lastUserSearchUpper >= 0 ? lastUserSearchUpper : 'end'}）`);

        // 宏展开前覆盖 {{lastUserMessage}} 宏（push 未开启时无条件覆盖）。
        // 原理：MacrosParser.registerMacro 的宏进 envMacros，在 ST 内置 postEnvMacros 之前展开 → 覆盖生效；
        // 组装后 unregisterMacro 恢复 ST 内置。此时 quiet_prompt 一律传空（生成指令由宏展开/后续手动补末尾承载）。
        // ⚠️ ST 弃用说明（2026-08-18 调研）：MacrosParser.registerMacro/unregisterMacro 被标记 deprecated，
        //   推荐 macros.registry.registerMacro（scripts/macros/macro-system.js）或 substituteParams({dynamicMacros})。
        //   但当前 ST 版本（本项目）无 macro-system.js、无 macros.registry，substituteParams 在 public/script.js:2225 导出。
        //   → 弃用警告仅是未来兼容提示，当前版本 registerMacro 功能完全正常，**暂不改**；
        //   待 ST 升级到含 macro-system.js 的版本后再适配（改后需同步 unregisterMacro 调用）。
        overrideLastUser = !shouldPush && quietPrompt && typeof quietPrompt === 'string' && quietPrompt.trim();
        if (overrideLastUser) {
            MacrosParser.registerMacro('lastUserMessage', () => quietPrompt);
            debugLog(LOG_TAG, '已覆盖 {{lastUserMessage}} 宏为生成指令（宏展开前替换）');
        }

            // dryRun 组装完整提示词：Generate('quiet', opts, true) 只组装不发请求、不锁发送按钮
            // → 走 ST 原生 coreChat（正则/文件/宏/世界书/预设全保留）
            // → quiet_prompt 一律传空：生成指令由「宏覆盖展开」或「组装后手动补末尾 user」承载，
            //   不依赖 ST 的 system 身份 quietPrompt（避免身份/位置不可控）。
            const effectiveQuietPrompt = ''; // 生成指令全部走宏替换或组装后补末尾
            debugLog(LOG_TAG, `dryRun 组装提示词，模式: ${shouldPush ? 'push-user' : (overrideLastUser ? 'macro-replace' : 'no-prompt')}，指令长度: ${quietPrompt?.length ?? 0}`);

            // JSDoc 类型标注：仅写 `let = null` 会被推断为 null 字面量，Array.isArray 收窄失效（全线报「可能为 null」）
            /** @type {Array|null} */
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

            // ⚠️ 2026-08-27 单飞锁（方案 A）：进入预设临界区前先获取锁，保证 apply→Generate→restore 串行，
            //   避免重叠调用把 oai_settings 永久停在临时候选预设（被 ST saveSettings 落盘即"预设被覆盖保存"）。
            //   锁在 restore 后（含 finally 兜底）release；网络发送阶段在 restore 之后，不占锁。
            await acquirePresetLock();
            // 临时应用指定 ST OpenAI 预设（presetName）→ dryRun 组装用该预设的 prompts/prompt_order/上下文设置
            // ⚠️ 只影响组装：组装完成后立即恢复（提前清理块），finally 兜底；不触发 OAI_PRESET_CHANGED 事件
            presetBackup = _applyPresetForAssembly(presetName);

            await Generate('quiet', { quiet_prompt: effectiveQuietPrompt, force_name2: true }, true);

            // 组装失败兜底：dryRun 未捕获到组装结果（如用户把 ST 其他内容全关、无角色/世界书等）
            // → 自行构造最小可用数组：真实 chat 0..truncateToMesId 楼层转 {role,content} + 末尾生成指令消息
            if (!Array.isArray(assembledChat) || assembledChat.length === 0) {
                warnLog(LOG_TAG, '提示词组装失败（未捕获到组装结果），改用自行构造数组发送');
                assembledChat = _buildFallbackChat(truncateToMesId, quietPrompt, fallbackPromptRole, shouldPush);
                capture.prompt = assembledChat.map(m => ({ ...m }));
                options.onPrompt?.(capture.prompt);
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
            // ⚠️ 2026-08-18：非 user 目标楼层为最后一层（forceFallbackPush）已由 pushpop（chat.push）承载，
            //   组装数组天然含该消息，此处不再重复 push；普通兜底（替换无法唯一命中）保持组装后 push。
            if (overrideLastUser) {
                const canMatch = lastUserMes && typeof lastUserMes === 'string' && lastUserMes.trim();
                // 筛选含 lastUserMes 的 user 消息，记录「消息条数 + 每条内的命中次数」
                const userMsgs = canMatch
                    ? assembledChat.filter(msg => msg && msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes(lastUserMes))
                    : [];
                // 有效替换需：恰好 1 条消息 且 该条内只命中 1 次
                // （若单条内命中多次 → lastUserMes 太短/通用，替换会把所有出现都换掉，结果不对 → 走兜底）
                const singleCount = userMsgs.length === 1
                    ? userMsgs[0].content.split(lastUserMes).length - 1
                    : 0;
                if (userMsgs.length === 1 && singleCount === 1) {
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
                    // 兜底：quietPrompt 作为最后一条消息补回数组末尾（角色可配置，默认 user）
                    assembledChat.push({ role: fallbackPromptRole, content: quietPrompt });
                    capture.prompt.push({ role: fallbackPromptRole, content: quietPrompt });
                    debugLog(LOG_TAG, `命中消息 ${userMsgs.length} 条、单条命中 ${singleCount} 次（期望1条×1次，canMatch=${!!canMatch}），兜底：quietPrompt 补为最后 ${fallbackPromptRole} 消息`);
                }
            }

            // 组装完成 → 立即还原临时隐藏的楼层（发送阶段 chat 已是原状，避免其他代码读到隐藏态）
            // 原 is_system 值精确恢复（原来就隐藏的楼层保持隐藏）
            for (const { index, wasSystem } of hiddenBackup) {
                if (chat[index]) chat[index].is_system = wasSystem;
            }
            hiddenRestored = true; // 标记已还原，finally 据此跳过（避免重复还原）
            if (hiddenBackup.length > 0) {
                debugLog(LOG_TAG, `组装完成已还原 ${hiddenBackup.length} 条临时隐藏楼层`);
            }

            // ⚠️ 组装完成即弹出临时 push 的生成指令消息：此后发送只用 assembledChat 数组，不再读 chat，
            //   无需让 push 消息在 chat 末尾停留整个发送期（缩短 chat 污染窗口；finally 据此跳过）。
            if (pushedUserMessage) {
                // ⚠️ 按对象引用弹出（_popPushedMessage），正常路径走位置+引用、异常/并发改动 chat 走引用兜底，杜绝残留脏楼层；移除成功才置 pushedPopped。
                if (_popPushedMessage(pushedUserMessage)) {
                    pushedPopped = true;
                    debugLog(LOG_TAG, '组装完成已弹出临时 push 的生成指令 user 消息');
                }
                // ⚠️ pop 后立即补刷 swipe 箭头（比 finally 更早恢复，缩短污染窗口）：
                //   is_user 指令消息已移出 chat，此时 showSwipeButtons() 必通过守卫，能尽早把箭头刷回。
            }
            if (pushedPopped && !swipeRefreshed) {
                try {
                    showSwipeButtons();
                    swipeRefreshed = true;
                } catch (err) {
                    debugLog(LOG_TAG, `组装完成后补刷 swipe 箭头失败（忽略）:`, err);
                }
            }

            // ⚠️ 组装完成即恢复 {{lastUserMessage}} 宏：宏只在 Generate dryRun 组装期间被消费，
            //   组装后替换/发送都基于 assembledChat 数组，不再经宏系统 → 提前还原缩短宏覆盖窗口
            //   （发送期间其他代码读 {{lastUserMessage}} 恢复 ST 内置；finally 据此跳过）。
            if (overrideLastUser && !macroRestored) {
                MacrosParser.unregisterMacro('lastUserMessage');
                macroRestored = true; // 标记已还原，finally 据此跳过（避免重复 unregister）
                debugLog(LOG_TAG, '组装完成已恢复 {{lastUserMessage}} 宏');
            }

            // ⚠️ 组装完成即恢复临时应用的 ST OpenAI 预设：预设只在 dryRun 组装期间被消费，
            //   组装后替换/发送都不再读 oai_settings → 提前恢复缩短污染窗口（finally 据此跳过）。
            if (!presetRestored) {
                _restorePresetForAssembly(presetBackup);
                presetRestored = true; // 标记已恢复，finally 据此跳过（避免重复恢复）
                // ⚠️ 2026-08-27 临界区结束：restore 成功后立即释放单飞锁，让下一个并发生成进入。
                if (!presetLockReleased) {
                    releasePresetLock();
                    presetLockReleased = true;
                }
            }
            if (!presetUiRefreshed) {
                _refreshPromptManagerAfterPresetRestore(presetBackup);
                presetUiRefreshed = true;
            }

            // 续写模式（照搬 ST 正文「继续」机制，默认 continue_prefill=false 的 nudge 法）：
            //   - 追加 continue_postfix 后缀到截断文本末尾，作为 assistant 续写种子
            //   - 末尾再跟一条 system 的 continue_nudge 提示（默认「继续上一条、勿重复原文」）
            //   ⚠️ 顺序（按实测 ST 发送的末两条）：先 assistant，后 system（system 是最后一条）
            //   → 不依赖模型「预填充/assistant 引导」能力，ST 即靠此在部分不支持预填充的模型上也能续写。
            //   → 模型只返回续写片段，拼接由调用方（moduleAiGenerator）把 prefix+结果写回原版本。
            if (typeof continuePrefix === 'string' && continuePrefix) {
                const continuePostfix = oai_settings?.continue_postfix ?? ' ';
                // ⚠️ nudge 宏展开对齐 ST：ST 用 substituteParamsExtended + 额外变量 lastChatMessage（=被续写消息）。
                //   普通 substituteParams 不认识 {{lastChatMessage}}，先手动展开它，其余交给 ST 全套宏展开。
                let continueNudge = oai_settings?.continue_nudge_prompt ?? '[Continue your last message without repeating its original content.]';
                try {
                    if (continueNudge.includes('{{lastChatMessage}}')) {
                        continueNudge = continueNudge.split('{{lastChatMessage}}').join(continuePrefix);
                    }
                    continueNudge = substituteParams(continueNudge);
                } catch (e) {
                    errorLog(LOG_TAG, '续写 nudge 宏展开失败（用原文）:', e);
                }
                const seed = continuePrefix + continuePostfix;
                // 先 assistant 续写种子，再 system nudge（末尾）
                assembledChat.push({ role: 'assistant', content: seed });
                assembledChat.push({ role: 'system', content: continueNudge });
                capture.prompt.push({ role: 'assistant', content: seed });
                capture.prompt.push({ role: 'system', content: continueNudge });
                debugLog(LOG_TAG, `续写模式：注入 assistant 续写种子 + 末尾 system continue_nudge（seed长度 ${seed.length}，nudge=${JSON.stringify(continueNudge)}，postfix=${JSON.stringify(continuePostfix)}）`);
            }

            // 自己发送（customApi 拦截在 sendOpenAIRequest 内部生效；不锁 ST 发送按钮）
            // 调试拦截：提示词已组装完成（capture.prompt 已捕获），不真正发送，返回占位响应
            if (configManager.isAiSendIntercepted()) {
                debugLog(LOG_TAG, `调试拦截：pipeline 模式不发送（已组装 ${assembledChat.length} 条），返回占位响应`);
                return INTERCEPT_MOCK_RESPONSE;
            }
            debugLog(LOG_TAG, `自行 sendOpenAIRequest，消息数: ${assembledChat.length}`);
            const abortController = new AbortController();
            // 暴露中止能力（调试面板「中止」按钮用）
            options.onAbort?.(() => abortController.abort());
            // ⚠️ 续写模式必须发 type='continue'：该后端据此把末尾 assistant 当「待继续」；发 normal 会被当普通生成 → 空返回。
            const sendType = (typeof continuePrefix === 'string' && continuePrefix) ? 'continue' : 'normal';
            const responseData = await sendOpenAIRequest(sendType, assembledChat, abortController.signal);

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
            // 恢复 {{lastUserMessage}} 宏（宏替换模式）：仅当组装完成前尚未还原（含异常/中止早退路径）
            if (overrideLastUser && !macroRestored) {
                MacrosParser.unregisterMacro('lastUserMessage');
                macroRestored = true;
                debugLog(LOG_TAG, '已恢复 {{lastUserMessage}} 宏');
            }
            // 弹出临时 push 的 user 消息：仅当组装完成前尚未弹出（含异常/中止早退路径）
            // ⚠️ 用 _popPushedMessage 按对象引用弹出：正常路径走位置+引用、异常路径走引用兜底，
            //   即使 await Generate 等异步窗口导致临时消息不在 chat[last] 也能可靠移除，杜绝残留脏楼层。
            if (!pushedPopped && _popPushedMessage(pushedUserMessage)) {
                pushedPopped = true;
                debugLog(LOG_TAG, '已弹出临时 push 的生成指令 user 消息');
            }
            // 还原临时隐藏的楼层：仅当组装完成前尚未还原（含异常/中止早退路径）
            if (!hiddenRestored) {
                for (const { index, wasSystem } of hiddenBackup) {
                    if (chat[index]) chat[index].is_system = wasSystem;
                }
                if (hiddenBackup.length > 0) {
                    debugLog(LOG_TAG, `已还原 ${hiddenBackup.length} 条临时隐藏的楼层`);
                }
                hiddenRestored = true;
            }
            // 恢复临时应用的 ST OpenAI 预设：仅当组装完成前尚未恢复（含异常/中止早退路径）
            if (!presetRestored) {
                _restorePresetForAssembly(presetBackup);
                presetRestored = true;
                // ⚠️ 2026-08-27 异常早退路径同样释放单飞锁，避免死锁（后续生成永久阻塞在 acquire）。
                if (!presetLockReleased) {
                    releasePresetLock();
                    presetLockReleased = true;
                }
            }
            // 异常早退路径同样强制重绘，覆盖可能残留的临时预设条目
            if (!presetUiRefreshed) {
                _refreshPromptManagerAfterPresetRestore(presetBackup);
                presetUiRefreshed = true;
            }
            // ⚠️ 强制补刷 swipe 箭头（方案B，2026-08-23）：pipeline 曾临时 push 过 is_user:true 指令消息到
            //   chat[last]（本函数 L384-386）。无论何时弹出，期间任何 showSwipeButtons() 读到 chat[last].is_user
            //   都会让最后一条消息的 swipe 箭头消失且不恢复。此处所有清理（pop/还原楼层/宏）已完成后，
            //   chat[last] 必然恢复为非 user → 再调一次 showSwipeButtons() 把所有箭头兜底刷回来。
            //   仅当本次调用确实 push 过指令消息（pushedUserMessage 非空）才需要补刷，避免无谓触发 ST UI。
            if (pushedUserMessage && !swipeRefreshed) {
                try {
                    showSwipeButtons();
                    swipeRefreshed = true;
                } catch (err) {
                    debugLog(LOG_TAG, `补刷 swipe 箭头失败（忽略）:`, err);
                }
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
