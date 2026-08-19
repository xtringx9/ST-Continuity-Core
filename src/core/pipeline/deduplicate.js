// 去重管线步骤
// ⚠️ 可组合性改造（快照阶段 0）：核心逻辑已抽到 deduplicateStep.js（无 ST 依赖纯函数）。
// 本文件保持对外 API 不变（deduplicateModules / getMaxMessageIndexFromHistory），
// 作为「从空状态跑全段」的薄封装。快照系统用 deduplicateStep 的 createDedupState / dedupStep / dedupToState。

import configManager from '../../singleton/configManager.js';
import { debugLog } from '../../utils/logger.js';
import { dedupToState, uniqueModulesFromState } from './deduplicateStep.js';

export { getMaxMessageIndexFromHistory } from './deduplicateStep.js';

/**
 * 模块去重
 * 基于模块名+变量值组合去重，增量模块和全量模块采用不同的messageIndex保留策略
 * @param {Array} modules 模块数组
 * @returns {Array} 去重后的模块数组
 */
export function deduplicateModules(modules) {
    // 获取所有模块配置
    const modulesConfig = configManager.getModules() || [];

    const state = dedupToState(modules, modulesConfig);

    debugLog('[Deduplication] 去重完成，原始模块数:', modules.length, '去重后模块数:', state.moduleMap.size, '重复模块数:', state.duplicateCount);

    return uniqueModulesFromState(state);
}
