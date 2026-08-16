// moduleDataSources.js
// 模块数据源抽象层（Tier 1 数据源接缝 + F 一期混合源）。
//
// 管线的 normalize 及以下阶段对数据源无知：只消费 { raw, messageIndex, ... } 对象。
// 本模块只负责「从哪里拿 raw 模块文本」这一件事。
//
// 数据源：
//   - chatText：扫 chat[].mes 文本 + 世界书条目（同步模式；正文内模块也在此）
//   - asyncChat：读 chat[floor].extra.ccore.modulesBySwipe（异步模式；正文后模块）
//
// 同步模式只激活 [chatText]；异步模式激活 [chatText, asyncChat]（混合源：正文内 + 正文后）。
// 源头判断（符合「判断放源头、下游不散落」约定）：getActiveSources() 单点路由。

import { chat } from '../../../../../../../script.js';
import { extractModulesFromChat } from '../moduleExtractor.js';
import configManager from '../../singleton/configManager.js';
import { readFloorModules } from '../floorModuleStore.js';
import { debugLog } from '../../utils/logger.js';

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
 * @returns {string[]}
 */
export function getActiveSourceNames() {
    const asyncCfg = configManager.getModuleDomainConfig().asyncModule;
    if (asyncCfg?.enabled && sources.has('asyncChat')) {
        return ['chatText', 'asyncChat'];
    }
    return ['chatText'];
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
// asyncChatSource：读 floor 的正文后模块 raw（F 一期）
// ============================================================
// 数据落点见 floorModuleStore：chat[floor].extra.ccore.modulesBySwipe[currentSwipeId]。
// 产出与 chatText 同构（{raw, messageIndex, ...}），供 runModulePipeline 合并。
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

            // 按换行拆成单个模块 raw（与 extractMessageModules 的合并格式一致）
            const blocks = rawText.split('\n');
            for (const block of blocks) {
                const trimmed = block.trim();
                if (!trimmed) continue;
                // 仅接受形如 [模块|...] 的条目
                if (!trimmed.startsWith('[') || !trimmed.includes('|')) continue;
                // 按 filters 过滤模块名
                const moduleName = trimmed.slice(1, trimmed.indexOf('|')).trim();
                if (!matchesFilter(moduleName)) continue;
                extracted.push({
                    raw: trimmed,
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
