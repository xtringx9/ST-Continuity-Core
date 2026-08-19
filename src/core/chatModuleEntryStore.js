// chatModuleEntryStore.js
// 聊天级模块内容条目存储（F 二期「聊天级模块条目」功能）。
//
// 定位：玩家在 module-editor 角色覆盖面板（聊天级）维护的模块内容条目，
// 每条 { id, name, content, messageIndex }，随聊天文件走（chat_metadata.ccore）。
// 与 floorModuleStore 的区别：
//   - floorModuleStore：chat[floor].extra.ccore.generators（逐楼层生成结果）
//   - 本模块：chat_metadata.ccore.chatModuleEntries（聊天级共享，条目独立于消息生命周期）
// 楼层号(messageIndex)只是锚点：消息删/切 swipe 与条目无关；支持负数（-1/更前=起始状态）。
//
// 数据源：moduleDataSources 的 chatMetaSource 读这里（正文 > floor > 条目，三源合并）。
// 变更后 dispatch CHAT_MODULE_ENTRIES_UPDATED_EVENT，eventHandler 统一刷新模块缓存。

import * as chatFileBridge from '../shared/chatFileBridge.js';
import { debugLog } from '../utils/logger.js';
import { resolveModuleChangeAffect } from './pipeline/resolveModuleChangeAffect.js';
import { incrementalModulesChanged } from './pipeline/incrementalModuleCompare.js';

/** chat_metadata.ccore 内的存储 key */
export const CHAT_MODULE_ENTRIES_KEY = 'chatModuleEntries';

/** 事件名：聊天级模块条目变更 */
export const CHAT_MODULE_ENTRIES_UPDATED_EVENT = 'ccore-chat-module-entries-updated';

/** 默认配置（无数据时返回，不写入存储） */
function defaultConfig() {
    return { enabled: true, entries: [] };
}

/** 读取完整配置（enabled + entries），缺省/损坏时给默认值 */
export function getChatModuleEntryConfig() {
    const cfg = chatFileBridge.get(CHAT_MODULE_ENTRIES_KEY);
    if (!cfg || typeof cfg !== 'object') return defaultConfig();
    const entries = Array.isArray(cfg.entries)
        ? cfg.entries.filter(e => e && typeof e === 'object')
        : [];
    return { enabled: cfg.enabled !== false, entries };
}

/** 读取条目数组（浅拷贝，勿直接改对象） */
export function getChatModuleEntries() {
    return getChatModuleEntryConfig().entries;
}

/**
 * 持久化 + 通知缓存刷新。
 * @param {object} cfg
 * @param {{ floor:number, affect:'single'|'suffix'|'full' }} info
 *   floor：影响的最小楼层（负数=起始态条目）
 *   affect：single=只该层；suffix=该层到末尾；full=全量（整体/清空）
 */
function persist(cfg, info) {
    chatFileBridge.set(CHAT_MODULE_ENTRIES_KEY, cfg);
    try {
        window.dispatchEvent(new CustomEvent(CHAT_MODULE_ENTRIES_UPDATED_EVENT, {
            detail: info || { floor: undefined, affect: 'full' },
        }));
    } catch (e) {
        // 事件派发失败不影响存储
    }
}

let idCounter = 0;
/** 生成稳定 id（同会话内递增，跨会话含时间戳） */
function nextId() {
    idCounter++;
    return `${Date.now()}_${idCounter}`;
}

/** 规范化楼层号（支持负数；无效回退 0） */
function normalizeMessageIndex(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * 新增一条聊天级模块条目。
 * @param {{ name?:string, content?:string, messageIndex?:number }} data
 * @returns {object} 新建的条目（含 id/createdAt/updatedAt）
 */
export function addChatModuleEntry({ name = '', content = '', messageIndex = 0, enabled = true } = {}) {
    const cfg = getChatModuleEntryConfig();
    const now = Date.now();
    const entry = {
        id: nextId(),
        name: String(name ?? ''),
        content: String(content ?? ''),
        messageIndex: normalizeMessageIndex(messageIndex),
        enabled: enabled !== false,
        createdAt: now,
        updatedAt: now,
    };
    cfg.entries.push(entry);
    const affectInfo = resolveModuleChangeAffect(entry.content);
    persist(cfg, {
        floor: entry.messageIndex,
        affect: affectInfo.affect,
        inline: affectInfo.inline,
    });
    debugLog(`[chatModuleEntryStore] 新增条目 ${entry.id} @${entry.messageIndex} (${entry.name}) enabled=${entry.enabled} affect=${affectInfo.affect} inline=${affectInfo.inline}`);
    return entry;
}

/**
 * 更新一条聊天级模块条目（字段级 patch）。
 * @param {string} id
 * @param {{ name?:string, content?:string, messageIndex?:number, enabled?:boolean }} patch
 * @returns {object|null} 更新后的条目；不存在返回 null
 */
export function updateChatModuleEntry(id, patch = {}) {
    const cfg = getChatModuleEntryConfig();
    const entry = cfg.entries.find(e => e.id === id);
    if (!entry) return null;
    const oldFloor = entry.messageIndex;
    const oldContent = entry.content;
    const oldEnabled = entry.enabled;

    if (typeof patch.name === 'string') entry.name = patch.name;
    if (typeof patch.content === 'string') entry.content = patch.content;
    if (patch.messageIndex !== undefined) entry.messageIndex = normalizeMessageIndex(patch.messageIndex);
    if (typeof patch.enabled === 'boolean') entry.enabled = patch.enabled;
    entry.updatedAt = Date.now();

    // ⚠️ 渲染相关字段无变化（仅改名称等）→ 不触发任何重渲染（affect:'none'）
    const contentChanged = entry.content !== oldContent;
    const floorChanged = entry.messageIndex !== oldFloor;
    const enabledChanged = entry.enabled !== oldEnabled;
    if (!contentChanged && !floorChanged && !enabledChanged) {
        debugLog(`[chatModuleEntryStore] 更新条目 ${entry.id}（仅非渲染字段变化，跳过刷新）`);
        return entry;
    }

    // ⚠️ 增量模块文本未变化（只改了非增量模块 / name 等）→ 不触发跨层刷新。
    // 复用原有 _incrementalModulesChanged 逻辑（incrementalModuleCompare.js）。
    const floor = Math.min(oldFloor, entry.messageIndex);
    if (!incrementalModulesChanged(oldContent, entry.content)) {
        // 增量模块文本没变：即使楼层/开关变了，也只刷该层（不跨层累积影响）
        persist(cfg, {
            floor,
            affect: 'single',
            inline: false,
        });
        debugLog(`[chatModuleEntryStore] 更新条目 ${entry.id}（增量模块文本未变，只刷该层）`);
        return entry;
    }

    // 增量模块文本变了 → 影响后续楼层；是否影响正文内由 outputPosition 决定
    const affectInfo = resolveModuleChangeAffect(entry.content);
    persist(cfg, {
        floor,
        affect: affectInfo.affect,
        inline: affectInfo.inline,
    });
    debugLog(`[chatModuleEntryStore] 更新条目 ${entry.id} @${entry.messageIndex} (${entry.name}) enabled=${entry.enabled} affect=${affectInfo.affect} inline=${affectInfo.inline}`);
    return entry;
}

/**
 * 开关单条聊天级模块条目（与世界书条目 disable 语义对齐）。
 * @param {string} id
 * @param {boolean} enabled
 * @returns {boolean} 是否更新成功；条目不存在返回 false
 */
export function setChatModuleEntryEnabled(id, enabled) {
    return !!updateChatModuleEntry(id, { enabled: !!enabled });
}

/**
 * 删除一条聊天级模块条目。
 * @param {string} id
 * @returns {boolean} 是否删除成功
 */
export function deleteChatModuleEntry(id) {
    const cfg = getChatModuleEntryConfig();
    const target = cfg.entries.find(e => e.id === id);
    const before = cfg.entries.length;
    cfg.entries = cfg.entries.filter(e => e.id !== id);
    if (cfg.entries.length === before) return false;
    const affectInfo = target ? resolveModuleChangeAffect(target.content) : { affect: 'full', inline: false };
    persist(cfg, {
        floor: target?.messageIndex,
        affect: affectInfo.affect,
        inline: affectInfo.inline,
    });
    debugLog(`[chatModuleEntryStore] 删除条目 ${id}`);
    return true;
}

/**
 * 清空全部聊天级模块条目。
 * @returns {boolean}
 */
export function clearChatModuleEntries() {
    const cfg = getChatModuleEntryConfig();
    if (cfg.entries.length === 0) return false;
    cfg.entries = [];
    persist(cfg, { floor: undefined, affect: 'full' });
    debugLog('[chatModuleEntryStore] 清空全部条目');
    return true;
}

/**
 * 开关聊天级模块条目（整体启用/停用）。
 * @param {boolean} enabled
 * @returns {boolean} 新状态
 */
export function setChatModuleEntriesEnabled(enabled) {
    const cfg = getChatModuleEntryConfig();
    cfg.enabled = !!enabled;
    persist(cfg, { floor: undefined, affect: 'full' });
    debugLog(`[chatModuleEntryStore] 条目开关 → ${cfg.enabled}`);
    return cfg.enabled;
}

/**
 * 通知缓存刷新（供外部批量写后调用，避免每次 persist 触发事件）。
 * 直接调用 chatFileBridge 修改后用它收口。
 */
export function notifyChatModuleEntriesUpdated() {
    try {
        window.dispatchEvent(new CustomEvent(CHAT_MODULE_ENTRIES_UPDATED_EVENT, { detail: {} }));
    } catch (e) {
        // ignore
    }
}
