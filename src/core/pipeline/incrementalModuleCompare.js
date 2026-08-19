// incrementalModuleCompare.js
// 共享：判断「编辑前后增量模块文本是否变化」。
//
// 来源：从 src/ui/messageAiButton.js 抽取（原 _hasIncrementalModule /
// _extractModuleBlocks / _incrementalModulesChanged），供多处复用：
//   - messageAiButton.js：切模块版本 / 编辑保存后决定 scheduleMsgBottom('suffix'|'single')
//   - chatModuleEntryStore.js：聊天级模块条目变更时判断是否跨层刷新
//   - 快照系统（将来）：决定失效范围
//
// 语义：仅对比增量模块（outputMode === 'incremental'）的 [模块|...] 块文本，
// 存在 ≠ 变化，需文本不同才算变。复用 parseNestedModules 提取（含嵌套全部模块块）。

import configManager from '../../singleton/configManager.js';
import { parseNestedModules } from '../moduleExtractor.js';

/** 判断当前模块配置是否启用了增量模块（outputMode === 'incremental'） */
export function hasIncrementalModule() {
    return (configManager.getModules() || []).some(m => m.outputMode === 'incremental');
}

/** 提取文本中所有模块块（形如 [模块名|...]），含嵌套 */
export function extractModuleBlocks(content) {
    if (typeof content !== 'string' || !content) return [];
    return parseNestedModules(content).map(m => m.raw);
}

/** 当前所有增量模块名集合 */
export function getIncrementalModuleNames() {
    return new Set((configManager.getModules(true) || [])
        .filter(m => m.outputMode === 'incremental')
        .map(m => m.name));
}

/**
 * 判断编辑前后「增量模块文本」是否发生变化。
 * @param {string} before 编辑前内容
 * @param {string} after 编辑后内容
 * @returns {boolean}
 */
export function incrementalModulesChanged(before, after) {
    if (!hasIncrementalModule()) return false;
    const incNames = getIncrementalModuleNames();

    const pickInc = (content) => extractModuleBlocks(content)
        .filter(block => {
            const pipeIdx = block.indexOf('|');
            const name = pipeIdx > 0 ? block.slice(1, pipeIdx).trim() : '';
            return incNames.has(name);
        });

    const beforeInc = pickInc(before);
    const afterInc = pickInc(after);

    // 集合文本对比：长度不同或任一块不同 → 变了
    if (beforeInc.length !== afterInc.length) return true;
    for (let i = 0; i < beforeInc.length; i++) {
        if (beforeInc[i] !== afterInc[i]) return true;
    }
    return false;
}
