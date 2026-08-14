// moduleDataSources.js
// 模块数据源抽象层（Tier 1 数据源接缝）。
//
// 管线的 normalize 及以下阶段对数据源无知：只消费 { raw, messageIndex, ... } 对象。
// 本模块只负责「从哪里拿 raw 模块文本」这一件事。
//
// - chatTextSource：扫 chat[].mes 文本 + 世界书条目（同步模式现状）
// - asyncChatSource：读 chat[floor].extra.ccore（异步模式，P 阶段不实现，预留注册位）
//
// 源头判断（符合「判断放源头、下游不散落」约定）：getActiveSourceName() 单点路由。
//
// P 阶段行为保持：chatTextSource 直接复用现有 extractModulesFromChat，
// 不重写其内部扫描逻辑，避免行为漂移。

import { extractModulesFromChat } from '../moduleExtractor.js';
import configManager from '../../singleton/configManager.js';

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
 * 当前激活的数据源名（源头判断单点）。
 * P 阶段只有 chatText；asyncChat 预留，待 F 阶段实现并注册后生效。
 * @returns {string}
 */
export function getActiveSourceName() {
    const asyncCfg = configManager.getModuleDomainConfig().asyncModule;
    // asyncChat 未注册时退回 chatText，避免运行期崩
    if (asyncCfg?.enabled && sources.has('asyncChat')) return 'asyncChat';
    return 'chatText';
}

/** 取当前激活源实现 */
export function getActiveSource() {
    return sources.get(getActiveSourceName());
}

// ============================================================
// chatTextSource：复用 extractModulesFromChat（行为保持）
// ============================================================
// 注：extractModulesFromChat 内部同时处理 chat 文本 + 世界书条目（moduleIndex=-1）。
// P 阶段保持这一耦合（行为不变）；未来 asyncChat 源落地时，再把世界书部分拆为共享步。
registerModuleDataSource('chatText', {
    /**
     * @param {{start:number, end:number|null, filters:Array|null}} opts
     *   filters 保持原 moduleFilters 形态（[{name, compatibleModuleNames}] | null），
     *   以便复用 extractModulesFromChat 的过滤分支（含 compatibleModuleNames 判定）。
     * @returns {Array<{raw,messageIndex,...}>}
     */
    getRawModules({ start, end, filters }) {
        return extractModulesFromChat(start, end, filters);
    },
});
