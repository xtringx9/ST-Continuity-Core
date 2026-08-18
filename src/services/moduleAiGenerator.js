// src/services/moduleAiGenerator.js
// 高层生成内容生成器：构建提示词 + 调用 aiCaller + 解析响应 + 存储
// 核心原则：无论单条还是多条，都只做一次 AI 调用
// 支持模块(generatorName='modules')和其他生成内容(generatorName=generator.name)

import { aiCaller } from './aiCaller.js';
// perMessageStorage 已停用（F 二期：统一走 floor 存储）；保留 import 注释以备将来回用
// import perMessageStorage from './perMessageStorage.js';
import configManager from '../singleton/configManager.js';
import generatedContentCache from '../singleton/generatedContentCache.js';
import { chat, getCurrentChatDetails } from '../../../../../../script.js';
import { expandPrompts } from '../utils/variableReplacer.js';
import { debugLog, warnLog, errorLog, infoLog } from '../utils/logger.js';
import { readFloorModules, readGeneratorContent, appendGeneratorContent, overwriteGeneratorContent, getActiveGeneratorSwipe } from '../core/floorModuleStore.js';
import { setGenerationContextEndFloor, setGenerationContextMode, clearGenerationContext } from '../core/generationContext.js';
import { taskRegistry } from '../core/taskRegistry.js';

const LOG_TAG = 'ModuleAiGenerator';

/**
 * 从 AI 回复文本中提取所有顶层模块 raw，合并为单个换行分隔文本块。
 * 逻辑同 perMessageStorage.extractMessageModules（已停用 perMessageStorage，此处内联）。
 * 嵌套模块包含在顶层模块的 raw 内，不单独提取。
 * @param {string} text
 * @returns {{ modules: string }}
 */
function _extractTopLevelModules(text) {
    if (!text || typeof text !== 'string') return { modules: '' };
    const results = [];
    const stack = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '[') {
            stack.push({ start: i, level: stack.length });
        } else if (text[i] === ']' && stack.length > 0) {
            const frame = stack.pop();
            const content = text.substring(frame.start + 1, i);
            if (content.includes('|')) {
                const pipeIdx = content.indexOf('|');
                const name = content.substring(0, pipeIdx).trim();
                if (!name.includes(':') && !name.includes('|')) {
                    if (stack.length === 0) {
                        results.push(text.substring(frame.start, i + 1));
                    }
                }
            }
        }
    }
    return { modules: results.join('\n') };
}

/**
 * 展开生成提示词中的宏（2026-08-18 升级为通用）：先自家宏（{{module_data}}）再 ST 全套宏。
 * 委托 utils/variableReplacer.expandPrompts（保留此薄封装，调用点不变）。
 * @param {string} text 提示词文本
 * @param {number} mesId 目标楼层
 * @returns {string}
 */
function _expandPromptMacros(text, mesId) {
    return expandPrompts(text, mesId);
}

// === 待处理结果状态管理 ===
// 手动重新生成(skipStorage=true)成功后,结果按 聊天标识 + generatorName + mesId 组合暂存
// 不同聊天/角色/楼层的待处理结果互相独立
// 持久化到 sessionStorage,刷新页面后仍可恢复
const PENDING_STORAGE_KEY = 'ccore_pending_results';
// key: `${chatKey}::${generatorName}::${mesId}`, value: Array<record>
// record = { id, status('pending'|'saved'|'discarded'|'error'), createdAt, context, debugData, note? }
// 2026-08-18 多记录化：同一楼层并发多次生成各占一条记录，互不覆盖，均可独立处理/回溯。
const pendingResults = new Map();

let pendingIdCounter = 0;
function _nextPendingId() {
    pendingIdCounter++;
    return `${Date.now()}_${pendingIdCounter}`;
}

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

/**
 * 获取某 generator+楼层 的全部记录数组（不存在返回空数组）。
 */
function _getPendingRecords(generatorName, mesId) {
    return pendingResults.get(_pendingKey(generatorName, mesId)) || [];
}

/**
 * 按记录 id 标记状态（saved/discarded/error）。
 * ⚠️ 2026-08-18 保留已处理记录（历史面板可查看已处理项），仅当 key 下无任何记录时删除 key。
 * @param {string} generatorName
 * @param {number} mesId
 * @param {string} recordId
 * @param {'saved'|'discarded'|'error'} status
 * @param {string} [note]
 */
function _markPendingStatus(generatorName, mesId, recordId, status, note = '') {
    const key = _pendingKey(generatorName, mesId);
    const records = pendingResults.get(key);
    if (!records) return;
    for (const r of records) {
        if (r.id === recordId) {
            r.status = status;
            if (note) r.note = note;
        }
    }
    // 仅当 key 下无任何记录时删除 key（已处理记录保留供历史面板查看）
    if (records.length === 0) {
        pendingResults.delete(key);
    }
    _savePendingToStorage();
    window.dispatchEvent(new CustomEvent('ccore-pending-cleared', { detail: { generatorName, mesId } }));
}

// 初始化时从 sessionStorage 恢复
(function _loadPendingFromStorage() {
    try {
        const raw = sessionStorage.getItem(PENDING_STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        for (const [key, value] of Object.entries(data)) {
            // 兼容旧格式（单条 {context,debugData}）→ 包成数组单条记录
            if (Array.isArray(value)) {
                pendingResults.set(key, value.filter(r => r && typeof r === 'object'));
            } else if (value && typeof value === 'object') {
                pendingResults.set(key, [{
                    id: value.id || `legacy_${Date.now()}`,
                    status: 'pending',
                    createdAt: value.createdAt || Date.now(),
                    context: value.context,
                    debugData: value.debugData,
                }]);
            }
        }
        let count = 0;
        pendingResults.forEach(arr => { count += arr.length; });
        if (count > 0) {
            infoLog(LOG_TAG, `从 sessionStorage 恢复 ${count} 条生成记录`);
        }
    } catch (e) {
        // 忽略解析错误
    }
})();

/** 每个 key 保留的已处理记录上限（2026-08-18 惰性清理，防 sessionStorage 堆积） */
const PENDING_KEEP_HANDLED = 20;

function _savePendingToStorage() {
    try {
        const data = {};
        for (const [key, records] of pendingResults) {
            if (!Array.isArray(records) || records.length === 0) continue;
            // 惰性清理：已处理记录（saved/discarded/error）超过上限时，丢最旧的（保留最新 PENDING_KEEP_HANDLED 条）
            const handled = records.filter(r => r.status !== 'pending');
            const pending = records.filter(r => r.status === 'pending');
            const keptHandled = handled.slice(-PENDING_KEEP_HANDLED);
            const kept = [...pending, ...keptHandled];
            if (kept.length !== records.length) {
                pendingResults.set(key, kept);
            }
            if (kept.length > 0) data[key] = kept;
        }
        sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        // 写入失败（如 sessionStorage 已满）：丢弃最老的已处理记录后重试一次
        try {
            for (const [key, records] of pendingResults) {
                const handled = (records || []).filter(r => r.status !== 'pending');
                if (handled.length > 5) {
                    pendingResults.set(key, handled.slice(-5).concat((records || []).filter(r => r.status === 'pending')));
                }
            }
            const data2 = {};
            for (const [key, records] of pendingResults) {
                if (Array.isArray(records) && records.length > 0) data2[key] = records;
            }
            sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(data2));
        } catch (e2) {
            // 仍失败则放弃持久化（仅内存保留）
        }
    }
}

/**
 * 创建保存回调（供调试面板"保存"按钮调用）
 * @param {Object} ctx 生成上下文
 * @param {Object} [ctx] 扩展字段
 */
function _createSaveCallback(ctx) {
    return async (saveMode) => {
        const { mesId, swipeId, generatorName, isModule, extracted, text, chatKey, recordId } = ctx;

        // 聊天归属校验：生成时的聊天 ≠ 当前聊天 → 拒绝保存（避免写错聊天文件），不破坏 pending 可稍后重试
        if (chatKey && chatKey !== _getChatKey()) {
            warnLog(LOG_TAG, `保存被拒绝：生成时聊天 ${chatKey} ≠ 当前聊天 ${_getChatKey()}`);
            toastr.warning('聊天已切换，无法保存。请回到原聊天后，在该楼层的生成按钮处重新打开调试面板再保存。');
            return;
        }

        const rawText = text || extracted?.modules || '';
        const oSwipe = swipeId;
        // saveMode：'append'（默认，新增一个版本并激活）| 'overwrite'（覆盖当前激活版本）
        const mode = saveMode === 'overwrite' ? 'overwrite' : 'append';

        try {
            let targetInnerSwipe;
            if (mode === 'overwrite') {
                targetInnerSwipe = getActiveGeneratorSwipe(mesId, generatorName, oSwipe);
                overwriteGeneratorContent(mesId, generatorName, oSwipe, rawText);
            } else {
                targetInnerSwipe = appendGeneratorContent(mesId, generatorName, oSwipe, rawText);
                if (targetInnerSwipe < 0) {
                    const msg = `保存失败：楼层 ${mesId} ${generatorName} 无法追加新版本（楼层可能已不存在）`;
                    errorLog(LOG_TAG, msg);
                    toastr.error(msg);
                    return;
                }
            }
            // 非模块生成内容同步内存缓存（注入提示词用）
            if (!isModule) {
                generatedContentCache.set(mesId, generatorName, rawText);
            }
            // 立即读回验证
            const back = readGeneratorContent(mesId, generatorName, oSwipe, targetInnerSwipe);
            infoLog(LOG_TAG, `保存到 floor：mesId=${mesId}, gen=${generatorName}, outerSwipe=${oSwipe}, innerSwipe=${targetInnerSwipe}, mode=${mode}, 长度=${back.length}`);
        } catch (err) {
            const msg = `保存失败：楼层 ${mesId} ${generatorName} 写入存储异常`;
            errorLog(LOG_TAG, msg, err);
            toastr.error(`${msg}：${err.message}`);
            return;
        }

        // 移除 taskRegistry 任务 + 标记该记录为已保存（多记录并存时只处理本条）
        taskRegistry.remove(`${_getChatKey()}::${mesId}::${generatorName}`);
        if (recordId) {
            _markPendingStatus(generatorName, mesId, recordId, 'saved', `${mode}`);
        } else {
            clearPendingResult(generatorName, mesId);
        }
        infoLog(LOG_TAG, `楼层 ${mesId} ${generatorName} 数据已保存（用户确认，${mode}）`);
    };
}

/**
 * 创建抛弃回调（供调试面板"抛弃"按钮调用）
 */
function _createDiscardCallback(generatorName, mesId, recordId) {
    return () => {
        taskRegistry.remove(`${_getChatKey()}::${mesId}::${generatorName}`);
        if (recordId) {
            _markPendingStatus(generatorName, mesId, recordId, 'discarded');
        } else {
            clearPendingResult(generatorName, mesId);
        }
        infoLog(LOG_TAG, `用户抛弃了 楼层${mesId} ${generatorName} 的生成结果`);
    };
}

/**
 * 处理（保存/抛弃）后自动跳下一条 pending：由生成记录面板的 onPendingChanged 统一负责
 * （详情中当前记录已处理 → 跳结果集内下一条 pending，无则回列表），此处无需重复处理。
 */

/**
 * 创建"查看当前内容"回调（供详情面板按钮调用，异步返回当前存储内容）
 */
function _createLoadCurrentCallback(ctx) {
    return async () => {
        const { mesId, swipeId, generatorName, isModule } = ctx;
        if (isModule) {
            // 模块数据在 floor，读当前激活版本
            return readFloorModules(mesId, swipeId) || '';
        }
        // 非模块生成内容也在 floor，读当前激活版本
        const active = getActiveGeneratorSwipe(mesId, generatorName, swipeId);
        return readGeneratorContent(mesId, generatorName, swipeId, active) || '';
    };
}

/**
 * 是否有指定 generator + 楼层的待处理结果（pending 记录）
 * @param {string} generatorName - 'modules' 或 generator.name
 * @param {number} mesId - 楼层 ID
 */
export function hasPendingResult(generatorName, mesId) {
    return _getPendingRecords(generatorName, mesId).some(r => r.status === 'pending');
}

/**
 * 清除指定 generator + 楼层的待处理结果（全部记录）
 */
export function clearPendingResult(generatorName, mesId) {
    const key = _pendingKey(generatorName, mesId);
    pendingResults.delete(key);
    _savePendingToStorage();
    // 通知 UI 更新按钮图标
    window.dispatchEvent(new CustomEvent('ccore-pending-cleared', { detail: { generatorName, mesId } }));
}

/**
 * 获取指定 generator + 楼层的全部生成记录（含已处理，供历史面板）。
 * @returns {Array<{id,status,createdAt,context,debugData,note?}>}
 */
export function getPendingRecords(generatorName, mesId) {
    return _getPendingRecords(generatorName, mesId);
}

/**
 * 全局生成记录平铺（供大 Cc 历史面板）：跨角色/聊天/楼层/状态。
 * @returns {Array<{key, chatKey, generatorName, mesId, ...record}>}
 */
export function getAllPendingRecords() {
    const out = [];
    for (const [key, records] of pendingResults) {
        // ⚠️ key = `${chatKey}::${generatorName}::${mesId}`，且 chatKey = `角色名::聊天文件名`（内部含 ::）！
        // 故 split('::') 后：parts[0]=角色名, parts[1]=聊天文件名, parts[2]=generatorName, parts[3]=mesId
        const parts = String(key).split('::');
        const chatKey = `${parts[0] || ''}::${parts[1] || ''}`;
        const generatorName = parts[2] || '';
        const mesId = Number(parts[3]);
        (records || []).forEach(r => {
            if (r && typeof r === 'object') {
                out.push({ key, chatKey, generatorName, mesId, ...r });
            }
        });
    }
    // 按创建时间新→旧
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return out;
}

/**
 * 待处理（pending）记录总数（大 Cc 角标 / 小 Cc 计数用）。
 */
export function getPendingCount() {
    let count = 0;
    pendingResults.forEach(records => {
        (records || []).forEach(r => { if (r.status === 'pending') count++; });
    });
    return count;
}

/**
 * 指定楼层的待处理记录数（当前聊天归属，小 Cc 计数用）。
 */
export function getPendingCountForMes(mesId) {
    const chatKey = _getChatKey();
    let count = 0;
    pendingResults.forEach((records, key) => {
        if (!String(key).startsWith(`${chatKey}::`)) return;
        // ⚠️ key = chatKey::generatorName::mesId（chatKey 内部含 ::），parts[3] 才是 mesId
        const parts = String(key).split('::');
        if (Number(parts[3]) === mesId) {
            (records || []).forEach(r => { if (r.status === 'pending') count++; });
        }
    });
    return count;
}

/**
 * 在生成记录面板展示某条生成记录（自动跳下一条 / 历史面板点卡片用）。
 * 详情视图由 generationRecordsPanel 负责：定位记录 + buildRecordCallbacks 绑定保存/抛弃。
 * @param {object} record { id, status, generatorName, mesId, context, debugData, note? }
 */
export function showRecordDebugPanel(record) {
    if (!record) return;
    // 优先用平铺记录（含 chatKey/generatorName/mesId 顶层字段）；
    // 传入的原始记录可能缺这些字段（reopenPendingDebugPanel 场景），按 id 重新定位。
    const full = getAllPendingRecords().find(r => r.id === record.id) || record;
    const parts = String(full.chatKey || '').split('::');
    window.openGenerationRecords?.({
        view: 'detail',
        recordId: full.id,
        filters: {
            gen: full.generatorName || '',
            char: parts[0] || '',
            chat: parts[1] || '',
            floor: String(full.mesId ?? ''),
            status: 'all',
        },
    });
}

/**
 * 直接抛弃某条待处理记录（历史面板列表「抛弃」按钮用）。
 * 抛弃不涉及保存/聊天归属校验，随时可执行。
 * @param {string} generatorName
 * @param {number} mesId
 * @param {string} recordId
 */
export function discardPendingRecord(generatorName, mesId, recordId) {
    const cb = _createDiscardCallback(generatorName, mesId, recordId);
    cb();
}

/**
 * 构建记录的操作回调（生成记录面板用）：onSave / onDiscard / onLoadCurrentContent。
 * pending 记录重新绑定（recordId 只处理本条）；已处理返回 null（只读）。
 * @param {object} record { id, status, generatorName, mesId, context }
 * @returns {{onSave:Function, onDiscard:Function, onLoadCurrentContent:Function}|null}
 */
export function buildRecordCallbacks(record) {
    if (!record) return null;
    if (record.status !== 'pending') return null;
    const context = { ...(record.context || {}), recordId: record.id };
    return {
        onSave: _createSaveCallback(context),
        onDiscard: _createDiscardCallback(record.generatorName, record.mesId, record.id),
        onLoadCurrentContent: _createLoadCurrentCallback(context),
    };
}

/**
 * 重新打开调试面板显示某条待处理记录。
 * 用户手误关闭面板后,再次点击"重新生成"时调用（取第一条 pending）。
 */
export function reopenPendingDebugPanel(generatorName, mesId) {
    const records = _getPendingRecords(generatorName, mesId);
    const pending = records.find(r => r.status === 'pending');
    if (!pending) return false;
    // 生成记录面板详情视图会通过 buildRecordCallbacks 重新绑定保存/抛弃回调
    showRecordDebugPanel(pending);
    infoLog(LOG_TAG, `重新打开 楼层${mesId} ${generatorName} 的待处理结果（记录 ${pending.id}）`);
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
            fallbackPromptRole, // 可选：本次生成的补末尾消息角色覆盖（提示词组 role）
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
                // 弹窗编辑的提示词（pipelineModifier 已传）优先于 generator_config 预设
                effectivePipelineModifier = pipelineModifier || combinedPrompt;
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

            // 生成指令作为最后一条 user 消息（先展开简单宏，如 {{module_data}} → 该楼层 floor 的模块数据）
            const quietPrompt = _expandPromptMacros(effectivePipelineModifier, truncateToMesId);

            // 开关：true=push 进 chat 作为最后 user 消息（{{lastUserMessage}} 可取）；false=经 quietPrompt（system 角色末尾）
            const pushAsLastUser = !!configManager.getAsyncConfig().pushUserMessageAsLast;

            callOptions = {
                mode: 'pipeline',
                quietPrompt,
                truncateToMesId,
                pushAsLastUser,
                customApi,
                responseLength,
                // 提示词组 role 覆盖（可选，弹窗生成时传入）
                ...(fallbackPromptRole ? { fallbackPromptRole } : {}),
            };

            sentInfo = { type: 'pipeline', quietPrompt, truncateToMesId, pushAsLastUser };
        }

        // 生成期上下文：宏 {{CONTINUITY_MODULE_DATA}} 只读到目标层前一楼（目标层模块正要生成）；
        // 三态分流：pipeline 生成时宏按「异步单独生成」输出（after_body+embedded）
        const isPipeline = mode === 'pipeline';
        if (isPipeline) {
            setGenerationContextEndFloor(truncateToMesId - 1);
            setGenerationContextMode('async-alone');
            debugLog(LOG_TAG, `设置生成上下文截止楼层 ${truncateToMesId - 1} + 模式 async-alone（宏 moduleData 截断 + 三态分流）`);
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

        // 流式增量（阶段 2）：aiCaller 每收到 chunk 就推送，更新 taskRegistry debugData + 已打开的生成记录面板（运行中详情）
        callOptions.onStream = (text) => {
            if (taskKeys.length === 0) return;
            const k = taskKeys[0];
            // 更新任务 debugData（后续「重新打开面板」显示最终响应）
            const task = taskRegistry.get(taskChatKey, messages[0]?.mesId, generatorName);
            if (task?.debugData) {
                task.debugData.response = text;
                task.debugData.statusLabel = `${isModule ? '生成调试' : `生成调试 [${generatorName}]`}（生成中）`;
            }
            // 实时更新已打开的生成记录面板「运行中详情」
            window.updateRunningRecord?.(k, task?.debugData || {});
        };

        // 捕获到提示词后实时推送（阶段 2：生成中面板显示「实际发送」而非「未捕获到」）
        callOptions.onPrompt = (prompt) => {
            if (taskKeys.length === 0) return;
            const k = taskKeys[0];
            const task = taskRegistry.get(taskChatKey, messages[0]?.mesId, generatorName);
            if (task?.debugData) {
                task.debugData.capturedPrompt = prompt;
            }
            window.updateRunningRecord?.(k, task?.debugData || {});
        };

        // 捕获到 API 信息后实时推送（阶段 2：生成中面板显示「API 信息」）
        callOptions.onApiUsed = (apiUsed) => {
            if (taskKeys.length === 0) return;
            const k = taskKeys[0];
            const task = taskRegistry.get(taskChatKey, messages[0]?.mesId, generatorName);
            if (task?.debugData) {
                task.debugData.apiUsed = apiUsed;
            }
            window.updateRunningRecord?.(k, task?.debugData || {});
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

            // 存储条件：skipStorage 且调试面板打开时才跳过存储（结果由用户在面板决定保存/抛弃）；
            // 关闭调试面板时（shouldShowDebug=false），手动点击生成也自动存储（不弹面板则无从暂存，直接落盘）
            if (!skipStorage || !shouldShowDebug) {
                if (isModule) {
                    // 模块：从 AI 回复提取模块文本（顶层提取，不依赖 perMessageStorage）
                    extracted = _extractTopLevelModules(result.text);
                    hasModules = extracted.modules.length > 0;
                } else {
                    // 其他生成内容：直接存 AI 回复到 generatorName key
                    hasModules = result.text.length > 0;
                }

                // 存储到每条消息（统一 floor：模块 + 非模块都走 appendGeneratorContent，新版本自动激活）
                if (hasModules) {
                    const storeText = isModule ? (extracted?.modules || '') : result.text;
                    if (isSingle) {
                        const msg = messages[0];
                        const newId = appendGeneratorContent(msg.mesId, generatorName, msg.activeSwipeId, storeText);
                        if (newId >= 0) {
                            storedCount = 1;
                            if (!isModule) generatedContentCache.set(msg.mesId, generatorName, storeText);
                            infoLog(LOG_TAG, `楼层 ${msg.mesId} ${generatorName} 数据已存储（floor，innerSwipe=${newId}）`);
                        } else {
                            errorLog(LOG_TAG, `楼层 ${msg.mesId} ${generatorName} 数据写入失败（楼层可能已不存在）`);
                            toastr.error(`楼层 ${msg.mesId} ${generatorName} 数据写入失败`);
                        }
                    } else {
                        let savedCount = 0;
                        for (const msg of messages) {
                            const newId = appendGeneratorContent(msg.mesId, generatorName, msg.activeSwipeId, storeText);
                            if (newId >= 0) {
                                if (!isModule) generatedContentCache.set(msg.mesId, generatorName, storeText);
                                savedCount++;
                            } else {
                                errorLog(LOG_TAG, `楼层 ${msg.mesId} ${generatorName} 数据写入失败（楼层可能已不存在）`);
                            }
                        }
                        storedCount = savedCount;
                        if (savedCount < messages.length) {
                            toastr.error(`部分楼层 ${generatorName} 数据写入失败（成功 ${savedCount}/${messages.length}）`);
                        }
                        infoLog(LOG_TAG, `${savedCount}/${messages.length} 条消息 ${generatorName} 数据已存储（floor）`);
                    }
                } else {
                    infoLog(LOG_TAG, `AI 回复中未提取到 ${generatorName} 数据`);
                }
            }

            // 打开生成记录面板（生成完成 → 详情视图）
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
                    taskKey: taskKeys[0] || undefined,
                };

                // 手动重新生成(skipStorage)且单条成功时,暂存结果供用户在面板中决定保存/抛弃。
                // 2026-08-18 多记录化：并发多次生成各占一条记录（同 key 数组 push），互不覆盖。
                // 详情页操作回调由生成记录面板 buildRecordCallbacks 重建，无需在 debugData 上绑定。
                let openedRecordId = null;
                if (skipStorage && result.text && isSingle) {
                    const mesId = messages[0].mesId;
                    const recordId = _nextPendingId();
                    const context = {
                        mesId,
                        swipeId: messages[0].activeSwipeId,
                        generatorName,
                        isModule,
                        extracted,
                        text: result.text,
                        chatKey: taskChatKey, // 生成归属聊天，保存校验用
                        recordId,            // 处理时只标记本条记录
                    };
                    const key = _pendingKey(generatorName, mesId);
                    const records = pendingResults.get(key) || [];
                    records.push({
                        id: recordId,
                        status: 'pending',
                        createdAt: Date.now(),
                        context,
                        debugData,
                    });
                    pendingResults.set(key, records);
                    _savePendingToStorage();
                    openedRecordId = recordId;
                }

                // 打开完成记录详情（无记录时打开列表）
                if (openedRecordId) {
                    window.openGenerationRecords?.({
                        view: 'detail',
                        recordId: openedRecordId,
                        filters: {
                            gen: generatorName,
                            char: charName,
                            chat: chatName,
                            floor: String(messages[0]?.mesId ?? ''),
                            status: 'all',
                        },
                    });
                } else {
                    window.openGenerationRecords?.({ view: 'list' });
                }
            }

            // 无论 shouldShowDebug 与否都清理运行中详情（用户可能手动打开过生成中面板）
            if (taskKeys[0]) window.closeRunningRecord?.(taskKeys[0]);
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

                const failDebugData = {
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
                    taskKey: taskKeys[0] || undefined,
                };

                // 失败也暂存为 error 记录（生成记录面板可查看失败详情），单条时打开详情
                let failRecordId = null;
                if (isSingle && messages[0]) {
                    const mesId = messages[0].mesId;
                    failRecordId = _nextPendingId();
                    const context = {
                        mesId,
                        swipeId: messages[0].activeSwipeId,
                        generatorName,
                        isModule,
                        extracted: null,
                        text: '',
                        chatKey: taskChatKey,
                        recordId: failRecordId,
                    };
                    const key = _pendingKey(generatorName, mesId);
                    const records = pendingResults.get(key) || [];
                    records.push({
                        id: failRecordId,
                        status: 'error',
                        createdAt: Date.now(),
                        context,
                        debugData: failDebugData,
                    });
                    pendingResults.set(key, records);
                    _savePendingToStorage();
                }

                // 打开失败记录详情（无记录时打开列表）
                if (failRecordId) {
                    window.openGenerationRecords?.({
                        view: 'detail',
                        recordId: failRecordId,
                        filters: {
                            gen: generatorName,
                            char: charName,
                            chat: chatName,
                            floor: String(messages[0]?.mesId ?? ''),
                            status: 'all',
                        },
                    });
                } else {
                    window.openGenerationRecords?.({ view: 'list' });
                }
            }

            // 无论 shouldShowDebug 与否都清理运行中详情（用户可能手动打开过生成中面板）
            if (taskKeys[0]) window.closeRunningRecord?.(taskKeys[0]);

            return { success: false, text: '', debug: err.debugInfo || null, error: err.message, hasModules: false, storedCount: 0 };
        }
    },
};

export default moduleAiGenerator;
