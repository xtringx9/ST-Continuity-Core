// deduplicateStep.js
// deduplicate 层纯函数（F 二期快照：可组合性改造）。
// 本文件无 ST 依赖（模块配置作为参数注入），可在纯 node 下单元测试。
//
// 跨楼层状态：moduleMap（moduleKey → 去重后的 module 对象，含 messageIndexHistory
// 累积 + incremental 的 messageIndex 推进）。快照从 X 继续时，把 moduleMap 作为
// 初始状态传入，逐个处理 X..end 的新模块即可——因为重复模块的处理只依赖 moduleMap
// 当前内容，不依赖「之前输入的完整顺序」（messageIndexHistory 是 push 累积，
// 续传从 X 继续 push 与全量一致）。
//
// ⚠️ moduleMap 存的是 module 对象引用，后续会被就地修改（push history / 改 messageIndex）。
// 快照必须存引用而非深拷贝，否则续传改的是拷贝、行为不一致。

/**
 * 创建去重初始状态。
 * @param {Array} moduleConfigs 模块配置数组（configManager.getModules()）
 * @returns {{ moduleMap: Map, duplicateCount: number, moduleConfigs: Array }}
 */
export function createDedupState(moduleConfigs) {
    return {
        moduleMap: new Map(),
        duplicateCount: 0,
        moduleConfigs: moduleConfigs || [],
    };
}

/**
 * 去重单个模块（等价于原 deduplicateModules 的 forEach 体）。
 * @param {Object} state 前一个状态（moduleMap / duplicateCount / moduleConfigs）
 * @param {Object} module 单个标准化模块
 * @returns {Object} 新状态（moduleMap 可能就地改了现有 module 对象）
 */
export function dedupStep(state, module) {
    const { moduleMap, moduleConfigs } = state;
    let { duplicateCount } = state;
    const added = [];

    const moduleConfig = moduleConfigs.find(config => config.name === module.moduleName);
    const isIncrementalModule = moduleConfig && moduleConfig.outputMode === 'incremental';
    const notAfterBody = moduleConfig && moduleConfig.outputPosition !== 'after_body';

    // 构建模块的唯一标识符：基于所有变量值的组合
    const moduleKey = JSON.stringify({
        moduleName: module.moduleName,
        variables: module.variables,
        notAfterBody: !isIncrementalModule && notAfterBody ? module.raw : '',
    });

    // 检查是否已经存在相同的模块
    if (moduleMap.has(moduleKey)) {
        const existingModule = moduleMap.get(moduleKey);

        if (!existingModule.messageIndexHistory.includes(module.messageIndex)) {
            existingModule.messageIndexHistory.push(module.messageIndex);
        }

        const currentMessageIndex = module.messageIndex;
        let existingMessageIndex = existingModule.messageIndex;

        if (isIncrementalModule) {
            existingMessageIndex = getMaxMessageIndexFromHistory(existingModule, currentMessageIndex);

            const diff = Math.abs(currentMessageIndex - existingMessageIndex);

            if (diff > 2) {
                existingModule.messageIndex = currentMessageIndex;
            }
        } else {
            // 全量模块使用原有逻辑
            // 比较messageIndex，保留较小的那个，但只在messageIndex都非负数时进行比较
            const shouldCompare = currentMessageIndex >= 0 && existingMessageIndex >= 0;

            if (shouldCompare && currentMessageIndex < existingMessageIndex) {
                existingModule.messageIndex = currentMessageIndex;
            } else if (!shouldCompare && currentMessageIndex >= 0 && existingMessageIndex < 0) {
                existingModule.messageIndex = currentMessageIndex;
            }
        }

        duplicateCount++;
    } else {
        if (isIncrementalModule) {
            // 检查是否只输出了moduleConfig中isIdentifier或isBackupIdentifier的变量，是的话视为无效条目
            let hasValidVariable = false;
            let hasIdentifierVariable = false;
            let identifierValid = false;
            let backupIdentifierValid = false;

            for (const [variableName] of Object.entries(module.variables)) {
                const variableConfig = moduleConfig.variables.find(v => v.name === variableName);
                if (module.variables[variableName] !== "" && variableConfig && !variableConfig.isIdentifier && !variableConfig.isBackupIdentifier) {
                    hasValidVariable = true;
                    break;
                }

                // 检查标识符变量
                if (variableConfig && variableConfig.isIdentifier && module.variables[variableName] !== "") {
                    hasIdentifierVariable = true;
                    identifierValid = true;
                }
                if (variableConfig && variableConfig.isBackupIdentifier && module.variables[variableName] !== "") {
                    hasIdentifierVariable = true;
                    backupIdentifierValid = true;
                }
            }

            // 如果标识符变量存在但两个标识符都无效（值为空），视为无效条目
            if (hasIdentifierVariable && !identifierValid && !backupIdentifierValid) {
                // 无效条目，不存储
            } else if (hasValidVariable) {
                moduleMap.set(moduleKey, module);
                added.push(module);
            } else {
                // 无效变量，不存储
            }
        } else {
            // 第一次遇到这个模块，直接存储
            moduleMap.set(moduleKey, module);
            added.push(module);
        }
        if (!module.messageIndexHistory) {
            module.messageIndexHistory = [module.messageIndex];
        }
    }

    return { moduleMap, duplicateCount, moduleConfigs, added };
}

/**
 * 获取模块历史中最大的messageIndex（排除当前messageIndex）
 * @param {Object} module 模块对象
 * @param {number} currentMessageIndex 当前消息索引
 * @returns {number} 最大的历史messageIndex，无则返回-1
 */
export function getMaxMessageIndexFromHistory(module, currentMessageIndex) {
    if (!module || !module.messageIndexHistory || !Array.isArray(module.messageIndexHistory)) {
        return -1;
    }
    const filteredHistory = module.messageIndexHistory.filter(index => index !== currentMessageIndex);
    if (filteredHistory.length === 0) {
        return -1;
    }
    return Math.max(...filteredHistory);
}

/**
 * 从初始状态去重一段模块数组，返回最终状态。
 * @param {Array} modules 模块数组
 * @param {Array} moduleConfigs 模块配置
 * @param {Object} [initialState] 可选的初始状态（快照续传用）
 * @returns {{ moduleMap: Map, duplicateCount: number, moduleConfigs: Array }}
 */
export function dedupToState(modules, moduleConfigs, initialState) {
    let state = initialState || createDedupState(moduleConfigs);
    for (const module of modules) {
        state = dedupStep(state, module);
    }
    return state;
}

/** 便捷：从状态取去重后的模块数组（与 deduplicateModules 返回值一致） */
export function uniqueModulesFromState(state) {
    return Array.from(state.moduleMap.values());
}
