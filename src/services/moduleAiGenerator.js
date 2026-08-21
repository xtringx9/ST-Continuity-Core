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
import { expandPrompts, setMsgModuleResolver } from '../utils/variableReplacer.js';
import { debugLog, warnLog, errorLog, infoLog } from '../utils/logger.js';
import { readFloorModules, readGeneratorContent, appendGeneratorContent, overwriteGeneratorContent, getActiveGeneratorSwipe } from '../core/floorModuleStore.js';
import { setGenerationContextEndFloor, setGenerationContextMode, clearGenerationContext } from '../core/generationContext.js';
import { taskRegistry } from '../core/taskRegistry.js';
import { showToast } from '../shared/Toast.js';
import { generateChatModuleDataForFloor } from '../modules/promptGenerator.js';

// 注册 {{ccore_msg_module}} 自有宏的解析器 → generateChatModuleDataForFloor（管线现算，与 CONTINUITY_MSG_MODULE_X 同源）。
// 固定传 async-alone：该宏用于取「当前楼层正文后(after_body)模块数据」注入提示词。
// ⚠️ expandPrompts 在 pipeline 里、生成上下文 mode 置为 async-alone 之前即展开，
//    此刻 getPromptMode() 可能返回 async-body → 触发空返回且过滤掉 after_body，故显式指定。
setMsgModuleResolver(mesId => generateChatModuleDataForFloor(mesId, 'async-alone'));

const LOG_TAG = 'ModuleAiGenerator';

/**
 * 从 AI 回复文本中提取所有顶层模块 raw，合并为单个换行分隔文本块。
 * 逻辑同 perMessageStorage.extractMessageModules（已停用 perMessageStorage，此处内联）。
 * 嵌套模块包含在顶层模块的 raw 内，不单独提取。
 *
 * ⚠️ 2026-08-18 暂注释：当前生成流程不需要提取模块步骤（autoSave 直接存 AI 回复原文），
 *    且提取逻辑曾导致「自动落盘失败但误标 saved」。以后若恢复「模块提取后再存」可重新启用。
 * @param {string} text
 * @returns {{ modules: string }}
 */
/*
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
*/

/**
 * 展开生成提示词中的宏（2026-08-18 升级为通用；2026-08-21 自有宏改名 {{ccore_msg_module}}）：先自家宏再 ST 全套宏。
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

// ⚠️ 运行中任务记录（runId → {chatKey, mesId, generatorName, startedAt, taskKey, debugData}）。
// taskRegistry 按 `${chatKey}::${mesId}::${generatorName}` 作 key，同楼层同 generator 并发会覆盖；
// 此 Map 用唯一 runId 记录，保证并发多个生成都出现在记录列表。
const runningTasks = new Map();

function _trackRunningTask(runId, chatKey, mesId, generatorName, taskKey, startedAt = Date.now()) {
    runningTasks.set(runId, { chatKey, mesId, generatorName, taskKey, startedAt, debugData: {} });
}

function _updateRunningTask(runId, debugData) {
    const entry = runningTasks.get(runId);
    if (entry) entry.debugData = debugData || {};
}

function _untrackRunningTask(runId) {
    runningTasks.delete(runId);
}

let pendingIdCounter = 0;
function _nextPendingId() {
    pendingIdCounter++;
    return `${Date.now()}_${pendingIdCounter}`;
}

let runIdCounter = 0;
/**
 * 生成一次运行任务的唯一标识（runId）。
 * ⚠️ 不能用 taskRegistry 的 key（`chatKey::mesId::generatorName`）——同楼层同
 *   generator 并发时 key 相同会互相覆盖；runId 全局唯一，保证并发都出现在记录列表。
 * @returns {string}
 */
function _nextRunId() {
    runIdCounter++;
    return `gen_${Date.now()}_${runIdCounter}`;
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
 * 按记录 id 全局定位记录（跨聊天操作：生成记录面板可在任意聊天打开并处理记录）。
 * recordId 由 _nextPendingId 生成（Date.now()_counter），全局唯一。
 * @param {string} recordId
 * @returns {{key:string, chatKey:string, record:object}|null}
 */
function _findRecordEntry(recordId) {
    for (const [key, records] of pendingResults) {
        if (!Array.isArray(records)) continue;
        const record = records.find(r => r && r.id === recordId);
        if (record) {
            // key = chatKey::generatorName::mesId（chatKey 内部含 ::，故 parts[0]=角色、parts[1]=聊天文件）
            const parts = String(key).split('::');
            const chatKey = `${parts[0] || ''}::${parts[1] || ''}`;
            return { key, chatKey, record };
        }
    }
    return null;
}

/**
 * 按记录 id 标记状态（saved/discarded/error）。
 * ⚠️ 2026-08-18 保留已处理记录（历史面板可查看已处理项）。
 * ⚠️ 2026-08-18 改为按 recordId 全局定位：抛弃可跨聊天执行（不依赖当前 _getChatKey()）。
 * @param {string} generatorName
 * @param {number} mesId
 * @param {string} recordId
 * @param {'saved'|'discarded'|'error'} status
 * @param {string} [note]
 */
function _markPendingStatus(generatorName, mesId, recordId, status, note = '') {
    const entry = _findRecordEntry(recordId);
    if (!entry) return;
    entry.record.status = status;
    if (note) entry.record.note = note;
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
            debugLog(LOG_TAG, `从 sessionStorage 恢复 ${count} 条生成记录`);
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
        // 保存成功 toast（全局通知）
        const modeLabel = mode === 'overwrite' ? '覆盖当前版本' : '追加为新版本';
        showToast(`已保存 #${mesId} ${generatorName || 'modules'}（${modeLabel}）`, 'success');
    };
}

/**
 * 创建抛弃回调（供生成记录面板「抛弃」按钮调用）。
 * ⚠️ 2026-08-18 抛弃全局有效：优先用记录所属 chatKey 移除任务（跨聊天也能执行），
 * 不再依赖当前 _getChatKey()（否则在其他聊天打开面板时抛弃无效）。
 * @param {string} generatorName
 * @param {number} mesId
 * @param {string} recordId
 * @param {string} [chatKey] 记录所属聊天标识（生成时归属；无则回退当前聊天）
 */
function _createDiscardCallback(generatorName, mesId, recordId, chatKey) {
    return () => {
        const taskChatKey = chatKey || _getChatKey();
        taskRegistry.remove(`${taskChatKey}::${mesId}::${generatorName}`);
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

    // 合并运行中任务（生成记录列表可见生成中记录，点击进入运行中详情支持流式）
    // ⚠️ 用 runningTasks（runId 唯一）而非 taskRegistry：taskRegistry 按
    //   chatKey::mesId::generatorName 作 key，同楼层同 generator 并发会覆盖；
    //   runningTasks 记录每个独立生成（runId 唯一），保证并发都出现在列表。
    for (const [runId, t] of runningTasks) {
        if (!t.chatKey || t.mesId === undefined) continue;
        out.push({
            key: `running::${t.chatKey}::${t.generatorName}::${t.mesId}`,
            chatKey: t.chatKey,
            generatorName: t.generatorName,
            mesId: t.mesId,
            id: `running_${runId}`,
            status: 'running',
            createdAt: t.startedAt || Date.now(),
            context: {},
            debugData: t.debugData || {},
            isRunning: true,
            taskKey: runId,
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
 * 清理全部已处理记录（saved/discarded/error），只保留 pending 与运行中任务。
 * 供生成记录列表底栏「清理已处理」按钮调用。
 * @returns {number} 清理的记录条数
 */
export function clearHandledRecords() {
    let removed = 0;
    for (const [key, records] of pendingResults) {
        if (!Array.isArray(records)) continue;
        const pending = records.filter(r => r && r.status === 'pending');
        removed += records.length - pending.length;
        if (pending.length > 0) {
            pendingResults.set(key, pending);
        } else {
            pendingResults.delete(key);
        }
    }
    if (removed > 0) {
        _savePendingToStorage();
        window.dispatchEvent(new CustomEvent('ccore-pending-cleared', { detail: {} }));
    }
    return removed;
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
 * 指定楼层的运行中任务数（当前聊天归属，小 Cc 计数用）。
 * ⚠️ 基于 runningTasks（runId 唯一）而非 taskRegistry——taskRegistry 同楼层同
 *   generator 并发会覆盖（key=chatKey::mesId::generatorName），并发多个只算 1。
 */
export function getRunningCountForMes(mesId) {
    const chatKey = _getChatKey();
    let count = 0;
    for (const t of runningTasks.values()) {
        if (t.chatKey === chatKey && Number(t.mesId) === Number(mesId)) count++;
    }
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
 * 抛弃不涉及保存/聊天归属校验，随时可执行；按 recordId 全局定位（跨聊天）。
 * @param {string} generatorName
 * @param {number} mesId
 * @param {string} recordId
 */
export function discardPendingRecord(generatorName, mesId, recordId) {
    const entry = _findRecordEntry(recordId);
    const cb = _createDiscardCallback(generatorName, mesId, recordId, entry?.chatKey);
    cb();
}

/**
 * 构建记录的操作回调（生成记录面板用）：onSave / onDiscard / onLoadCurrentContent。
 * pending 记录重新绑定（recordId 只处理本条）；已处理返回 null（只读）。
 * @param {object} record { id, status, generatorName, mesId, context, chatKey }
 * @returns {{onSave:Function, onDiscard:Function, onLoadCurrentContent:Function}|null}
 */
export function buildRecordCallbacks(record) {
    if (!record) return null;
    if (record.status !== 'pending') return null;
    const context = { ...(record.context || {}), recordId: record.id };
    return {
        onSave: _createSaveCallback(context),
        onDiscard: _createDiscardCallback(record.generatorName, record.mesId, record.id, record.chatKey),
        onLoadCurrentContent: _createLoadCurrentCallback(context),
    };
}

/**
 * 重新打开调试面板显示某条待处理记录。
 * 用户手误关闭面板后,再次点击"重新生成"时调用（取第一条 pending）。
 */
export function reopenPendingDebugPanel(generatorName, mesId) {
    const records = _getPendingRecords(generatorName, mesId);
    // ⚠️ 取最新一条 pending（records 按 push 旧→新；reverse 后 find 是最近生成）
    const pending = records.slice().reverse().find(r => r.status === 'pending');
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
     * @param {string} [options.presetName] - 指定 ST OpenAI 预设（pipeline 组装时临时使用，默认取 generator_config/asyncConfig 配置）
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
            skipStorage = false, // ⚠️ 历史参数（原「是否跳过存储」）；统一路径后不再参与行为判定，保留兼容
            fallbackPromptRole, // 可选：本次生成的补末尾消息角色覆盖（提示词组 role）
            presetName, // 可选：显式指定 ST OpenAI 预设（优先于 generator_config/asyncConfig 配置）
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
        // ST OpenAI 预设：pipeline 模式 dryRun 组装时临时使用（空=用当前预设）。
        // 优先级：显式 options.presetName > generator_config 的 generator.presetName > asyncConfig.presetName
        let generator = null;
        let effectivePresetName = presetName || null;

        if (!isModule) {
            // 其他生成内容：从 generator_config 查找提示词
            generator = configManager.getGeneratorByName(generatorName);
            if (!generator) {
                warnLog(LOG_TAG, `找不到生成内容配置: ${generatorName}`);
                return { success: false, text: '', debug: null, storedCount: 0 };
            }
            effectivePresetName = effectivePresetName || generator.presetName || null;

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
        } else {
            // 模块生成：ST OpenAI 预设从 asyncConfig 读（显式 options / generator_config 优先在上面已处理）
            effectivePresetName = effectivePresetName || (configManager.getAsyncConfig().presetName || null);
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

            // 生成指令作为最后一条 user 消息（先展开简单宏，如 {{ccore_msg_module}} → 该楼层正文现算的模块数据）
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
                // 指定 ST OpenAI 预设（dryRun 组装时临时使用；空=用当前预设）
                ...(effectivePresetName ? { presetName: effectivePresetName } : {}),
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
        // ⚠️ runId：本次生成唯一标识（runningTasks 的 key，支持同楼层并发多任务不互相覆盖）
        const runId = _nextRunId();
        for (const m of messages) {
            const k = taskRegistry.start({ chatKey: taskChatKey, mesId: m.mesId, generatorName });
            taskKeys.push(k);
            // 独立跟踪运行中任务（taskRegistry 同 key 并发会覆盖；此 Map 按唯一 runId 记录）
            _trackRunningTask(runId, taskChatKey, m.mesId, generatorName, k);
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
                _updateRunningTask(runId, task.debugData);
            }
            // 实时更新已打开的生成记录面板「运行中详情」（按 runId 定位）
            window.updateRunningRecord?.(runId, task?.debugData || {});
        };

        // 捕获到提示词后实时推送（阶段 2：生成中面板显示「实际发送」而非「未捕获到」）
        callOptions.onPrompt = (prompt) => {
            if (taskKeys.length === 0) return;
            const k = taskKeys[0];
            const task = taskRegistry.get(taskChatKey, messages[0]?.mesId, generatorName);
            if (task?.debugData) {
                task.debugData.capturedPrompt = prompt;
                _updateRunningTask(runId, task.debugData);
            }
            window.updateRunningRecord?.(runId, task?.debugData || {});
        };

        // 捕获到 API 信息后实时推送（阶段 2：生成中面板显示「API 信息」）
        callOptions.onApiUsed = (apiUsed) => {
            if (taskKeys.length === 0) return;
            const k = taskKeys[0];
            const task = taskRegistry.get(taskChatKey, messages[0]?.mesId, generatorName);
            if (task?.debugData) {
                task.debugData.apiUsed = apiUsed;
                _updateRunningTask(runId, task.debugData);
            }
            window.updateRunningRecord?.(runId, task?.debugData || {});
        };

        // 生成中 debugData（供「生成中点击按钮打开调试面板」用；完整响应生成后由 finish 更新）
        if (taskKeys.length > 0) {
            const m0 = messages[0];
            const scope = isSingle ? `#${m0.mesId}` : `#${ids[0]}-${ids[ids.length - 1]}`;
            const details = getCurrentChatDetails();
            const titleBody = `${scope} - ${details?.characterName || ''} / ${details?.sessionName || ''}`;
            const titleLabel = isModule ? '生成调试' : `生成调试 [${generatorName}]`;
            const runningTaskKey = taskKeys[0];
            const runningDebugData = {
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
                // runId：本次生成唯一标识（运行中详情定位/流式更新用）
                runId,
                // 中止按钮（生成中打开面板时显示）
                onAbort: () => taskRegistry.abortTask(runningTaskKey),
            };
            taskRegistry.setDebugData(runningTaskKey, runningDebugData);
            _updateRunningTask(runId, runningDebugData);
        }

        try {
            const result = await aiCaller.call(callOptions);

            let extracted = null;
            let storedCount = 0;
            let hasModules = false;

            // ⚠️ 2026-08-18 统一路径：是否自动落盘只由「生成完成弹出面板手动确认」（showDebug）决定：
            //   - 勾选（shouldShowDebug=true）→ 不落盘，创建 pending，弹面板等手动保存/抛弃
            //   - 不勾选（shouldShowDebug=false）→ 自动落盘，创建 pending 并自动标记 saved，不弹窗
            //   （无论手动/自动生成，行为一致；skipStorage 为历史参数，不再参与判定）
            const autoSave = !shouldShowDebug;
            if (autoSave) {
                // ⚠️ 2026-08-18：模块提取已注释（_extractTopLevelModules），当前直接存 AI 回复原文；
                //   不再区分 isModule 的提取步骤（曾导致自动落盘失败但误标 saved）
                hasModules = result.text.length > 0;
                // 存储到每条消息（统一 floor：模块 + 非模块都走 appendGeneratorContent，新版本自动激活）
                if (hasModules) {
                    const storeText = result.text;
                    if (isSingle) {
                        const msg = messages[0];
                        const newId = appendGeneratorContent(msg.mesId, generatorName, msg.activeSwipeId, storeText);
                        if (newId >= 0) {
                            storedCount = 1;
                            if (!isModule) generatedContentCache.set(msg.mesId, generatorName, storeText);
                            debugLog(LOG_TAG, `楼层 ${msg.mesId} ${generatorName} 数据已存储（floor，innerSwipe=${newId}）`);
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
                        debugLog(LOG_TAG, `${savedCount}/${messages.length} 条消息 ${generatorName} 数据已存储（floor）`);
                    }
                } else {
                    debugLog(LOG_TAG, `AI 回复中未提取到 ${generatorName} 数据`);
                }
            }

            // ⚠️ 先移除运行中记录（在 push pending/通知刷新之前），避免「pending 行已出现、running 行延迟消失」
            _untrackRunningTask(runId);

            // ── 统一路径（2026-08-18）：勾选/不勾选弹面板走同一套逻辑 ──
            // 构造统一 debugData（不依赖 shouldShowDebug 块）
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
                runId,
            };

            // ⚠️ 空响应兜底：AI 调用成功但返回空文本（result.text 为空）时，
            //   不满足下方 pending 创建条件 → 生成记录面板无任何记录（用户看到「自动保存不成功且无记录」）。
            //   此处补一条 error 记录并提示，保证每次生成都在记录里可见。
            if (!result.text && isSingle && messages[0]) {
                const emptyMesId = messages[0].mesId;
                const emptyRecordId = _nextPendingId();
                const emptyContext = {
                    mesId: emptyMesId,
                    swipeId: messages[0].activeSwipeId,
                    generatorName,
                    isModule,
                    extracted: null,
                    text: '',
                    chatKey: taskChatKey,
                    recordId: emptyRecordId,
                };
                const emptyKey = _pendingKey(generatorName, emptyMesId);
                const emptyRecords = pendingResults.get(emptyKey) || [];
                emptyRecords.push({
                    id: emptyRecordId,
                    status: 'error',
                    createdAt: Date.now(),
                    context: emptyContext,
                    debugData: { ...debugData, error: 'AI 响应为空（未返回任何内容），未落盘', response: '' },
                });
                pendingResults.set(emptyKey, emptyRecords);
                _savePendingToStorage();
                window.dispatchEvent(new CustomEvent('ccore-pending-cleared', { detail: { generatorName, mesId: emptyMesId } }));
                showToast(`生成返回为空 #${emptyMesId} ${generatorName || 'modules'}，未保存`, 'error');
            }

            // 总是创建 pending 记录（单条成功有文本；多记录化：并发各占一条，互不覆盖）
            // 详情页操作回调由生成记录面板 buildRecordCallbacks 重建，无需在 debugData 上绑定。
            let openedRecordId = null;
            if (result.text && isSingle && messages[0]) {
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

                // 自动保存（未勾选弹面板，autoSave=!shouldShowDebug）：仅当真正落盘成功才标记 saved
                // ⚠️ 存储依赖 hasModules / appendGeneratorContent 成功；落盘失败时保留 pending（可手动处理）
                //   _markPendingStatus 内部会 dispatch ccore-pending-cleared 通知面板刷新
                if (autoSave && storedCount > 0) {
                    _markPendingStatus(generatorName, mesId, recordId, 'saved', '自动存储');
                }
            }

            // 手动确认（shouldShowDebug）：打开生成记录面板详情等待保存/抛弃；
            // 自动保存（autoSave）：不弹窗，仅通知（面板已打开则静默刷新/切换运行中详情）
            if (shouldShowDebug) {
                // 新记录完成通知：面板已打开 → 静默刷新/切换运行中详情（不打断当前视图）；
                // 面板未打开 → notify 返回 false，此处再打开详情。
                const handledByPanel = window.notifyGenerationCompleted?.({
                    recordId: openedRecordId,
                    runId,
                    generatorName,
                    mesId: messages[0]?.mesId,
                    chatKey: taskChatKey,
                    status: 'pending',
                });
                if (!handledByPanel) {
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
            } else if (openedRecordId) {
                // 自动保存：面板已打开 → 通知刷新（运行中详情若正看该 runId 则切换为 saved 详情）
                window.notifyGenerationCompleted?.({
                    recordId: openedRecordId,
                    runId,
                    generatorName,
                    mesId: messages[0]?.mesId,
                    chatKey: taskChatKey,
                    status: 'saved',
                });
            }

            // 无论 shouldShowDebug 与否都清理运行中详情（用户可能手动打开过生成中面板）
            if (runId) window.closeRunningRecord?.(runId);
            if (isPipeline) clearGenerationContext();
            // 成功：完整 debugData 写入任务（供后续「重新打开面板」显示真实结果）
            const successDebug = typeof debugData === 'object' ? debugData : null;
            for (const k of taskKeys) {
                taskRegistry.finish(k, 'success', successDebug);
                if (successDebug) taskRegistry.setDebugData(k, successDebug);
            }
            _untrackRunningTask(runId);
            // 生成完成 toast（全局通知；面板已打开时不打扰当前视图，仍提示）
            showToast(`生成完成 #${messages[0]?.mesId} ${generatorName || 'modules'}`, 'success');
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

            // ── 统一失败路径（2026-08-18）：无论是否勾选弹面板，失败/中止都创建 error 记录 ──
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

            // 失败/中止也暂存为 error 记录（生成记录面板可查看失败详情），单条时创建；
            // ⚠️ 不再受 shouldShowDebug 限制——任何 pending 最后都会留下记录
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

            // 新记录完成通知：面板已打开 → 静默刷新/切换运行中详情（不打断当前视图）
            const handledByPanel = window.notifyGenerationCompleted?.({
                recordId: failRecordId,
                runId,
                generatorName,
                mesId: messages[0]?.mesId,
                chatKey: taskChatKey,
                status: 'error',
            });

            // 仅勾选弹面板时打开失败详情（不勾选则静默留记录 + toast）
            if (shouldShowDebug && !handledByPanel) {
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
            if (runId) window.closeRunningRecord?.(runId);
            _untrackRunningTask(runId);

            // 生成失败 toast（全局通知；面板已打开时不打扰当前视图，仍提示）
            showToast(`生成失败 #${messages[0]?.mesId} ${generatorName || 'modules'}：${err.message || '未知错误'}`, 'error');

            return { success: false, text: '', debug: err.debugInfo || null, error: err.message, hasModules: false, storedCount: 0 };
        }
    },
};

export default moduleAiGenerator;
