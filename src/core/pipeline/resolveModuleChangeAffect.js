// resolveModuleChangeAffect.js
// 通用：解析「某条模块内容变更」影响哪些渲染目标（single / suffix + inline）。
//
// 语义（用户拍板，2026-08-19 修正）：
//   - 不包含增量模块（outputMode !== 'incremental'）→ 只影响该层本身（single）
//   - 包含增量模块（outputMode === 'incremental'）→ **影响后续所有楼层（suffix，含本层）**，
//     与 outputPosition 无关；区别只在是否影响正文内：
//       - 全部是 after_body → 只影响后续楼层的消息底部（suffix，inline:false）
//       - 含非 after_body（body 系 / embedded）→ 影响后续楼层的消息底部 + 正文内（suffix，inline:true）
//
// ⚠️ 「编辑前后增量模块文本是否变化」的判断在 incrementalModuleCompare.js（incrementalModulesChanged），
// 本函数只回答「这份内容的影响范围」，不负责 before/after 对比。

import configManager from '../../singleton/configManager.js';
import { getIncrementalModuleNames } from './incrementalModuleCompare.js';

/** 解析 content 里的顶层模块名（与 moduleExtractor 的 [模块名|...] 格式一致） */
export function extractModuleNamesFromContent(content) {
    if (typeof content !== 'string') return [];
    const names = new Set();
    // 匹配 [模块名|...]：模块名不含 : | 和 [
    const re = /\[([^:|[\]]+)\|/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        names.add(m[1].trim());
    }
    return [...names];
}

/**
 * 解析某条模块内容的影响范围。
 * @param {string} content 模块内容文本（可能含多个 [模块|...] 块）
 * @returns {{ affect:'single'|'suffix', inline:boolean }}
 *   affect：single=只重渲该层；suffix=从该层到末尾（含本层）
 *   inline：true=影响正文内（需同时触发正文内渲染）；false=只影响消息底部
 */
export function resolveModuleChangeAffect(content) {
    const moduleNames = extractModuleNamesFromContent(content);
    if (moduleNames.length === 0) return { affect: 'single', inline: false };

    const incNames = getIncrementalModuleNames();
    const modulesData = configManager.getModules(true) || [];
    let hasIncremental = false;
    let hasNonAfterBodyIncremental = false;

    for (const name of moduleNames) {
        if (!incNames.has(name)) continue;
        hasIncremental = true;
        const mod = modulesData.find(m => m.name === name);
        if (mod && mod.outputPosition !== 'after_body') {
            hasNonAfterBodyIncremental = true;
            break;
        }
    }

    // 无增量模块 → 只影响该层
    if (!hasIncremental) return { affect: 'single', inline: false };
    // 有增量模块 → 影响后续楼层；是否影响正文内由 outputPosition 决定
    return hasNonAfterBodyIncremental
        ? { affect: 'suffix', inline: true }
        : { affect: 'suffix', inline: false };
}
