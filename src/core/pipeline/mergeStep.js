// mergeStep.js
// merge 层纯函数（F 二期快照：可组合性改造的核心）。
// 本文件无 ST 依赖（不 import configManager / script.js），可在纯 node 下单元测试。
//
// 用途：
//   - mergeModulesByOrder 作为「从空状态跑全段」的薄封装（调用方零改动）
//   - 快照系统从 X-1 中间态继续：先 createMergeStepState()，逐层 mergeStep(state, module)，
//     得到该层累积态，即可从 X 增量重算
//
// ⚠️ 行为必须与原 mergeModulesByOrder 逐 item 逐行一致（含 isAddTime 对 module 的就地修改）。

/**
 * 合并步进状态。
 * @typedef {Object} MergeStepState
 * @property {Object} cumulativeVariables 跨 item 累积变量
 * @property {boolean} hasTimeVar 是否出现过 time 变量
 * @property {Object|undefined} lastTimeData 时间基准（timeData）
 * @property {string|undefined} lastTimeString 时间基准（time 字符串）
 * @property {Array} timeline 变更历史条目
 */

/**
 * 创建初始合并状态。
 * @returns {MergeStepState}
 */
export function createMergeStepState() {
    return {
        cumulativeVariables: {},
        hasTimeVar: false,
        lastTimeData: undefined,
        lastTimeString: undefined,
        timeline: [],
    };
}

/**
 * 合并单个模块到累积状态（纯函数：不修改 prevState，返回新 state）。
 * ⚠️ isAddTime 分支会就地修改 module.timeData / module.variables[key]（与原逻辑一致，
 * 保留该副作用以保持行为逐行相同）。
 * @param {MergeStepState} prevState 前一个状态
 * @param {Object} module 单个标准化模块（含 variables / timeData / isAddTime / raw 等）
 * @param {boolean} isIncremental 是否增量模块
 * @returns {MergeStepState} 下一个状态
 */
export function mergeStep(prevState, module, isIncremental) {
    const cumulativeVariables = { ...prevState.cumulativeVariables };
    let hasTimeVar = prevState.hasTimeVar;
    let lastTimeData = prevState.lastTimeData;
    let lastTimeString = prevState.lastTimeString;
    const timeline = prevState.timeline.slice();

    const currentVariables = { ...cumulativeVariables };
    const lastVariables = { ...cumulativeVariables };
    const changedKeys = [];

    Object.keys(module.variables).forEach(key => {
        let value = module.variables[key];

        if (value !== '' && value !== undefined) {
            let canSave = true;
            if (key === 'time') {
                hasTimeVar = true;
            }
            if (hasTimeVar && key === 'time') {
                if (lastTimeString === undefined && module.variables[key] && module.variables[key].trim() !== '') {
                    lastTimeString = module.variables[key].trim();
                }
                if (lastTimeData === undefined && module.timeData !== undefined && module.timeData.isValid && module.timeData.isComplete) {
                    lastTimeData = module.timeData;
                    lastTimeString = module.variables[key].trim();
                }
                else if (module.isAddTime === undefined || (module.isAddTime != undefined && !module.isAddTime)) {
                    lastTimeData = module.timeData;
                    lastTimeString = module.variables[key].trim();
                }
                else if (module.isAddTime !== undefined && module.isAddTime) {
                    module.timeData = lastTimeData !== undefined ? lastTimeData : module.timeData;
                    module.variables[key] = lastTimeString !== undefined ? lastTimeString : module.variables[key];
                    value = lastTimeString !== undefined ? lastTimeString : value;
                    canSave = false;
                }
            }

            if (currentVariables[key] !== value && canSave) {
                changedKeys.push(key);
            }
            currentVariables[key] = value;
            cumulativeVariables[key] = value;
        }
    });

    if (changedKeys.length > 0) {
        // 增量模块：timeline 条目的 messageIndex 同样取该模块 history 的最小值，
        // 与 merged.messageIndex 保持一致（与最新内容相同的最早那条楼层）。
        let entryMessageIndex = module.messageIndex || 0;
        if (isIncremental && Array.isArray(module.messageIndexHistory) && module.messageIndexHistory.length > 0) {
            entryMessageIndex = Math.min(...module.messageIndexHistory);
        }
        timeline.push({
            moduleName: module.moduleName,
            messageIndex: entryMessageIndex,
            messageIndexHistory: module.messageIndexHistory || [module.messageIndex],
            raw: module.raw || '',
            processedRaw: module.processedRaw || '',
            nestedInfo: module.nestedInfo,
            variables: { ...currentVariables },
            lastVariables: { ...lastVariables },
            changedKeys: changedKeys,
        });
    }

    return {
        cumulativeVariables,
        hasTimeVar,
        lastTimeData,
        lastTimeString,
        timeline,
    };
}

/**
 * 便捷：从空状态合并一段模块数组，返回最终状态。
 * @param {Array} modules 模块数组（已按楼层排序、去重）
 * @param {boolean} isIncremental
 * @returns {MergeStepState}
 */
export function mergeModulesToState(modules, isIncremental) {
    let state = createMergeStepState();
    for (const module of modules) {
        state = mergeStep(state, module, isIncremental);
    }
    return state;
}
