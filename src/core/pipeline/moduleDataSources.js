// moduleDataSources.js
// 模块数据源抽象层（Tier 1 数据源接缝 + F 一期混合源）。
//
// 管线的 normalize 及以下阶段对数据源无知：只消费 { raw, messageIndex, ... } 对象。
// 本模块只负责「从哪里拿 raw 模块文本」这一件事。
//
// 数据源：
//   - chatText：扫 chat[].mes 文本 + 世界书条目（同步模式；正文内模块也在此）
//   - asyncChat：读 floor generators['modules'] 当前激活版本（异步模式；正文后模块）
//
// 同步模式只激活 [chatText]；异步模式激活 [chatText, asyncChat]（混合源：正文内 + 正文后）。
// 源头判断（符合「判断放源头、下游不散落」约定）：getActiveSources() 单点路由。

import { chat } from '../../../../../../../script.js';
import { extractModulesFromChat, parseNestedModules } from '../moduleExtractor.js';
import configManager from '../../singleton/configManager.js';
import { readFloorModules } from '../floorModuleStore.js';
import { getChatModuleEntryConfig, getChatModuleEntries } from '../chatModuleEntryStore.js';
import { getCurrentCharBooksEnabledEntries } from '../../utils/worldBookUtils.js';
import { debugLog } from '../../utils/logger.js';
import { processTextForMatching } from '../../utils/textConverter.js';

/**
 * 世界书模块条目统一起始态楼层（负数）。
 * 语义：世界书中启用的模块内容条目（!disable）作为「初始模块」，从聊天起始态（第 0 层之前）参与。
 * 用 -99 与聊天级条目的 -1/-2/-3 起始态在楼层轴上隔离，输出排序恒排最前。
 * 负数只在楼层 0 的提取中并入 → 世界书变更只需失效第 0 层 occurrence（与 chatMeta 负数一致）。
 */
export const WORLD_BOOK_MODULE_INDEX = -99;

/** 源注册表 */
const sources = new Map();

/**
 * 注册一个数据源实现。
 * @param {string} name 源名（'chatText' | 'asyncChat'）
 * @param {{ getRawModules: (opts:{start:number,end:number|null,filters:Array|null}) => Array }} impl
 */
export function registerModuleDataSource(name, impl) {
    sources.set(name, impl);
}

/**
 * 当前激活的数据源数组（源头判断单点）。
 * 同步模式=[chatText]；异步模式=[chatText, asyncChat]（正文内模块仍从正文扫，正文后模块从 floor 读）。
 * 聊天级模块条目（chatMeta）同步/异步都启用——它是聊天级事实，与 async 无关。
 * 顺序：chatText > asyncChat > chatMeta（同层冲突并存，排序靠注册顺序，见 HANDOFF-F2-CHAT-MODULE-ENTRIES）。
 * @returns {string[]}
 */
export function getActiveSourceNames() {
    const asyncCfg = configManager.getModuleDomainConfig().asyncModule;
    const names = ['chatText'];
    if (asyncCfg?.enabled && sources.has('asyncChat')) {
        names.push('asyncChat');
    }
    if (sources.has('chatMeta')) {
        names.push('chatMeta');
    }
    if (sources.has('charBook')) {
        names.push('charBook');
    }
    return names;
}

/**
 * 取当前激活源实现数组。
 * @returns {Array<{name:string, impl:object}>}
 */
export function getActiveSources() {
    return getActiveSourceNames().map(name => ({ name, impl: sources.get(name) }));
}

/** @deprecated 用 getActiveSources()（多源合并） */
export function getActiveSource() {
    return sources.get(getActiveSourceNames()[0]);
}

/** @deprecated 用 getActiveSourceNames()（多源合并） */
export function getActiveSourceName() {
    return getActiveSourceNames()[0];
}

// ============================================================
// chatTextSource：复用 extractModulesFromChat（行为保持）
// ============================================================
// 注：extractModulesFromChat 内部同时处理 chat 文本 + 世界书条目（moduleIndex=-1）。
// 同步/异步都启用本源：正文内模块始终从正文扫（免费），异步时 floor 只补充正文后模块。
registerModuleDataSource('chatText', {
    /**
     * @param {{start:number, end:number|null, filters:Array|null}} opts
     * @returns {Array<{raw,messageIndex,...}>}
     */
    getRawModules({ start, end, filters }) {
        return extractModulesFromChat(start, end, filters);
    },
});

// ============================================================
// asyncChatSource：读 floor 的正文后模块 raw（F 一期 + 二期多版本）
// ============================================================
// 数据落点见 floorModuleStore：chat[floor].ccore.generators['modules'][outerSwipe][activeInnerSwipe]（顶层独立键）。
// readFloorModules 自动读当前激活版本。产出与 chatText 同构（{raw, messageIndex, ...}），供 runModulePipeline 合并。
registerModuleDataSource('asyncChat', {
    /**
     * 遍历 [start, end] 楼层，读当前 swipe 的 floor 模块 raw，按 \n 拆成 raw 块。
     * @param {{start:number, end:number|null}} opts
     * @returns {Array<{raw, messageIndex, source, isUserMessage, speakerName}>}
     */
    getRawModules({ start, end, filters }) {
        const extracted = [];
        if (!chat || !Array.isArray(chat) || chat.length === 0) return extracted;

        const effectiveStartIndex = Math.max(0, start);
        const effectiveEndIndex = end !== null ? Math.min(end, chat.length - 1) : chat.length - 1;

        // 提取模块名（含兼容名）判定集合，与 chatTextSource 的 filters 语义对齐
        const filterNames = new Set();
        if (Array.isArray(filters)) {
            for (const f of filters) {
                if (f?.name) filterNames.add(f.name);
                if (Array.isArray(f?.compatibleModuleNames)) {
                    for (const cn of f.compatibleModuleNames) filterNames.add(cn);
                }
            }
        }

        const matchesFilter = (moduleName) => {
            if (filters === null || filterNames.size === 0) return true;
            return filterNames.has(moduleName);
        };

        for (let index = effectiveStartIndex; index <= effectiveEndIndex; index++) {
            const message = chat[index];
            if (!message) continue;
            const swipeId = message.swipe_id ?? 0;
            const rawText = readFloorModules(index, swipeId);
            if (!rawText || rawText.trim() === '') continue;

            const isUserMessage = message.is_user || message.role === 'user';
            const speakerName = message.name || (isUserMessage ? 'user' : 'assistant');

            // 跨行解析：整段文本交给 parseNestedModules（修复换行被误判为模块结束，且保留嵌套）
            const blocks = parseRawTextIntoModules(rawText, matchesFilter);
            for (const block of blocks) {
                const trimmed = block.raw;
                extracted.push({
                    raw: trimmed,
                    processedRaw: processTextForMatching(trimmed) || trimmed,
                    messageIndex: index,
                    isUserMessage,
                    speakerName,
                    timestamp: new Date().toISOString(),
                    source: 'floor',
                    nestedInfo: {
                        level: 0,
                        isNested: false,
                        isContainer: false,
                        parentModule: null,
                        childrenCount: 0,
                        childrenModules: [],
                        nestedVariables: [],
                    },
                });
            }
        }

        debugLog(`[asyncChatSource] 提取到 ${extracted.length} 个 floor 模块块（楼层 ${effectiveStartIndex}-${effectiveEndIndex}）`);
        return extracted;
    },
});

/**
 * 把整段模块文本解析为模块数组（修复：换行不再视为模块结束，且保留嵌套子模块）。
 *
 * 旧实现用 rawText.split('\n') 按行拆分，每行当一个模块——一旦某 [模块|...] 内部含换行
 * （AI 生成多行变量值很常见），就会被劈成多行、后继行不再是 [..| 开头而被丢弃。
 * 现改为复用与 chatText 同源的 parseNestedModules（逐字符 [ ] 配对，天然支持跨行模块），
 * 返回 parseNestedModules 解析出的全部模块（含嵌套子模块），与 extractModulesFromChat
 * 行为完全对齐（其 modules.forEach 同样不区分 parent，逐条 push）。
 *
 * ⚠️ floor/chatMeta 文本也可能含嵌套（如 [外层|var:值[内层|...]），不可只取 parent===null，
 * 否则会丢失嵌套子模块（与之前 split('\n') 一样的 bug，只是换了个丢法）。
 *
 * @param {string} rawText 整段模块文本（多个 [模块|...] 可能用换行拼接，单个模块内可能含换行/嵌套）
 * @param {(moduleName:string)=>boolean} matchesFilter 模块名过滤回调（null/filters 为空时返回 true）
 * @returns {Array<{raw:string, moduleName:string}>}
 */
function parseRawTextIntoModules(rawText, matchesFilter) {
    const parsed = parseNestedModules(rawText);
    const out = [];
    for (const m of parsed) {
        const moduleName = m.moduleName;
        if (matchesFilter && !matchesFilter(moduleName)) continue;
        out.push({ raw: m.raw, moduleName });
    }
    return out;
}

// ============================================================
// chatMetaSource：读聊天级模块内容条目（F 二期，第三数据源）
// ============================================================
// 数据落点：chat_metadata.ccore.chatModuleEntries（chatModuleEntryStore）。
// 语义（用户拍板）：
//   - 条目楼层号(messageIndex)只是锚点；消息删/切 swipe 与条目无关。
//   - messageIndex >= 0：锚定楼层，随 [start,end] 过滤（与正文/floor 同层并存）。
//   - messageIndex < 0（-1/更前）：起始状态（第 0 层之前），不受 range 过滤，始终参与。
//   - 顺序：chatText > asyncChat > chatMeta（本源最后注册，getActiveSources 按序合并）。
// 产出与 chatText/asyncChat 同构，供 runModulePipeline 合并 + deduplicateModules 去重。
registerModuleDataSource('chatMeta', {
    /**
     * @param {{start:number, end:number|null, filters:Array|null}} opts
     * @returns {Array<{raw, messageIndex, source, isUserMessage, speakerName}>}
     */
    getRawModules({ start, end, filters }) {
        const extracted = [];
        // 整体开关：enabled === false 时整个聊天级条目源停用（与 entry.enabled 独立）
        if (getChatModuleEntryConfig().enabled === false) return extracted;
        const entries = getChatModuleEntries();
        if (!Array.isArray(entries) || entries.length === 0) return extracted;

        // 提取模块名（含兼容名）判定集合，与其它源 filters 语义对齐
        const filterNames = new Set();
        if (Array.isArray(filters)) {
            for (const f of filters) {
                if (f?.name) filterNames.add(f.name);
                if (Array.isArray(f?.compatibleModuleNames)) {
                    for (const cn of f.compatibleModuleNames) filterNames.add(cn);
                }
            }
        }
        const matchesFilter = (moduleName) => {
            if (filters === null || filterNames.size === 0) return true;
            return filterNames.has(moduleName);
        };

        const effStart = start ?? 0;
        // ⚠️ 负数条目（起始态）只在 start===0 时并入（合并到楼层 0 最前，按 messageIndex 从小到大）。
        // start>0 时不带负数条目（用户决策 2026-08-19：模块数据放正确楼层号，不需要负数随行）。
        // 与 occurrence 缓存配合：负数只在楼层 0 缓存一份 → 负数变更只需失效第 0 层。
        const includeStartState = effStart === 0;
        // 收集负数条目（start=0 时），按楼层从小到大
        const startStateEntries = [];
        for (const entry of entries) {
            if (entry?.enabled === false) continue;
            const messageIndex = Number(entry.messageIndex);
            if (messageIndex < 0) startStateEntries.push(entry);
        }
        startStateEntries.sort((a, b) => Number(a.messageIndex) - Number(b.messageIndex));

        const pendingEntries = includeStartState ? startStateEntries : [];
        // 非负条目按 [start,end] 过滤（start>0 时也正常过滤）
        for (const entry of entries) {
            if (entry?.enabled === false) continue;
            const messageIndex = Number(entry.messageIndex);
            if (messageIndex < 0) continue;
            if (messageIndex < effStart) continue;
            if (end !== null && end !== undefined && messageIndex > end) continue;
            pendingEntries.push(entry);
        }

        for (const entry of pendingEntries) {
            const rawText = entry?.content;
            if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') continue;

            const messageIndex = Number(entry.messageIndex);

            // 跨行解析：整段文本交给 parseNestedModules（与 asyncChatSource 一致，修复换行被误判，且保留嵌套）
            const blocks = parseRawTextIntoModules(rawText, matchesFilter);
            for (const block of blocks) {
                const trimmed = block.raw;
                extracted.push({
                    raw: trimmed,
                    processedRaw: processTextForMatching(trimmed) || trimmed,
                    messageIndex,
                    isUserMessage: false,
                    speakerName: 'chatmeta',
                    timestamp: new Date().toISOString(),
                    source: 'chatmeta',
                    nestedInfo: {
                        level: 0,
                        isNested: false,
                        isContainer: false,
                        parentModule: null,
                        childrenCount: 0,
                        childrenModules: [],
                        nestedVariables: [],
                    },
                });
            }
        }

        debugLog(`[chatMetaSource] 提取到 ${extracted.length} 个聊天级条目模块块`);
        return extracted;
    },
});

// ============================================================
// charBookSource：读世界书启用条目中的模块内容（第四数据源，初始模块）
// ============================================================
// 数据落点：角色相关世界书（getCurrentCharBooksEnabledEntries，读 charWorldBookCache 里
//   角色世界书 extensions.world + 附加世界书 + 聊天世界书 的全部 !disable 条目）。
// 语义（用户拍板 2026-08-28）：
//   - 判断 = 条目开关（!disable）：启用的世界书条目，其 content 含模块格式即作为「初始模块」。
//   - 旧 [CCore] 条目通常 disable=true（搬迁后关闭）→ !disable 天然排除，自动兼容旧数据。
//   - 统一 messageIndex = WORLD_BOOK_MODULE_INDEX（-99，起始态，恒排最前，与聊天级 -1/-2/-3 隔离）。
//   - 只在楼层 0 并入（start===0），变更只需失效第 0 层 occurrence（与 chatMeta 负数一致）。
//   - 注册在 chatMeta 之后：同 key 去重「先到先得」时聊天级负数先入 → 聊天级覆盖世界书默认。
// 产出与 chatText/asyncChat/chatMeta 同构，供 runModulePipeline 合并 + deduplicateModules 去重。
registerModuleDataSource('charBook', {
    /**
     * @param {{start:number, end:number|null, filters:Array|null}} opts
     * @returns {Array<{raw, messageIndex, source, isUserMessage, speakerName}>}
     */
    getRawModules({ start, end, filters }) {
        const extracted = [];
        // 世界书模块条目统一 -99 起始态，只在楼层 0 并入（start===0 时）
        if ((start ?? 0) > 0) return extracted;
        const entries = getCurrentCharBooksEnabledEntries();
        if (!Array.isArray(entries) || entries.length === 0) return extracted;

        // 提取模块名（含兼容名）判定集合，与其它源 filters 语义对齐
        const filterNames = new Set();
        if (Array.isArray(filters)) {
            for (const f of filters) {
                if (f?.name) filterNames.add(f.name);
                if (Array.isArray(f?.compatibleModuleNames)) {
                    for (const cn of f.compatibleModuleNames) filterNames.add(cn);
                }
            }
        }
        const matchesFilter = (moduleName) => {
            if (filters === null || filterNames.size === 0) return true;
            return filterNames.has(moduleName);
        };

        for (const entry of entries) {
            const rawText = entry?.content;
            if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') continue;

            // 跨行解析：与 asyncChat/chatMeta 一致，保留嵌套子模块
            const blocks = parseRawTextIntoModules(rawText, matchesFilter);
            for (const block of blocks) {
                const trimmed = block.raw;
                extracted.push({
                    raw: trimmed,
                    processedRaw: processTextForMatching(trimmed) || trimmed,
                    messageIndex: WORLD_BOOK_MODULE_INDEX,
                    isUserMessage: false,
                    speakerName: 'worldbook',
                    timestamp: new Date().toISOString(),
                    source: 'worldbook',
                    nestedInfo: {
                        level: 0,
                        isNested: false,
                        isContainer: false,
                        parentModule: null,
                        childrenCount: 0,
                        childrenModules: [],
                        nestedVariables: [],
                    },
                });
            }
        }

        debugLog(`[charBookSource] 提取到 ${extracted.length} 个世界书模块块（起始态 ${WORLD_BOOK_MODULE_INDEX}）`);
        return extracted;
    },
});
