// idCompletionStep.js
// completeIdVariables 层纯函数（F 二期快照：可组合性改造）。
// 本文件无 ST 依赖（模块配置作为参数注入），可在纯 node 下单元测试。
//
// 跨楼层状态：每组（moduleName）的 { identifierIdMap: Map<backupKey,id>, currentId: number }。
// 原逻辑「先按名分组再逐组处理」，组间独立 → 流式逐模块处理（每模块归组并更新该组状态）
// 与分组后逐组结果一致，只要组内模块到达顺序一致（输入本就是按楼层排序后的）。
// 快照从 X 继续：保存每组的 { identifierIdMap, currentId }，逐模块处理 X..end 即可。

/**
 * 创建补全 id 初始状态。
 * @returns {{ groups: Map<string, { identifierIdMap: Map, currentId: number }> }}
 */
export function createIdCompletionState() {
    return { groups: new Map() };
}

function groupState(state, moduleName) {
    if (!state.groups.has(moduleName)) {
        state.groups.set(moduleName, { identifierIdMap: new Map(), currentId: 1 });
    }
    return state.groups.get(moduleName);
}

/**
 * 补全单个模块的 id（等价于原 completeIdVariables 组内 forEach 体）。
 * ⚠️ 就地修改 module.variables.id（与原逻辑一致）。
 * @param {Object} state 前一个状态（groups）
 * @param {Object} module 单个标准化模块
 * @param {Array} moduleConfigs 模块配置数组
 * @returns {Object} 新状态（groups 就地更新）
 */
export function idCompletionStep(state, module, moduleConfigs) {
    const moduleConfig = moduleConfigs.find(config => config.name === module.moduleName);
    if (!moduleConfig) return state;
    const hasIdVariable = moduleConfig.variables.some(variable => variable.name === 'id');
    if (!hasIdVariable) return state;

    const gs = groupState(state, module.moduleName);
    const backupIdentifiers = moduleConfig.variables
        .filter(variable => variable.isBackupIdentifier)
        .map(variable => variable.name);

    let currentIdValue = module.variables.id || '';

    if (!currentIdValue) {
        let backupKey = '';
        if (backupIdentifiers.length > 0) {
            backupKey = backupIdentifiers.map(identifier => module.variables[identifier] || '').join('__');
        }

        if (backupKey) {
            if (gs.identifierIdMap.has(backupKey)) {
                currentIdValue = gs.identifierIdMap.get(backupKey);
            } else {
                currentIdValue = gs.currentId;
                gs.identifierIdMap.set(backupKey, currentIdValue);
                gs.currentId++;
            }
        } else {
            currentIdValue = gs.currentId;
            gs.currentId++;
        }

        module.variables.id = currentIdValue;
    }

    return state;
}

/**
 * 从初始状态补全一段模块数组的 id，返回最终状态。
 * @param {Array} modules 模块数组（已排序）
 * @param {Array} moduleConfigs 模块配置
 * @param {Object} [initialState] 可选的初始状态（快照续传用）
 * @returns {Object}
 */
export function idCompletionToState(modules, moduleConfigs, initialState) {
    let state = initialState || createIdCompletionState();
    for (const module of modules) {
        state = idCompletionStep(state, module, moduleConfigs);
    }
    return state;
}
