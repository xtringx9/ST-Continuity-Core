// timeCompletionStep.js
// 时间处理层纯函数（F 二期快照：可组合性改造）。
// 本文件无 ST 依赖（模块配置 + 时间解析器都作为参数注入），可在纯 node 下单元测试。
//
// 解析器注入：真实运行由 time.js 注入 utils/timeParser.js 的实现（timeParser→logger→
// 浏览器链，不能在此 import）；纯 node 测试可注入等价 mock。
//
// ⚠️ attachStructuredTimeData 是「先全段定基准、再全段应用」两阶段：基准 = 全段第一个
// timeReferenceStandard 模块的有效完整 time，且**基准确定前的模块在应用阶段也用最终基准
// 参考解析**（parseTimeDetailed(time, standardTimeData) 用基准补全日期/weekday）。
// 因此 **不能逐模块流式**（基准确定前的模块会用 null 参考解析，与全量结果不同——用户
// 实测 bug：同层两条 sum，第一条时间段被后续基准覆盖）。
// 正确做法：段级两阶段 + 可从快照基准继续——
//   attachTimeToState(modules[X..end], configs, parsers, { standardTimeData, standardFound })
//   段内：若 standardFound 为 false → 先扫描本段找第一个基准；再用（最终）基准统一解析全段。
// 快照每层只需存 { standardTimeData, standardFound }。
//
// completeTimeVariables 按 messageIndex 分组，组内独立、无跨楼层状态 → 天然逐层续传。

/**
 * 创建时间解析初始状态。
 * @param {Array} moduleConfigs 模块配置数组
 * @returns {{ standardTimeData: object|null, standardFound: boolean, referenceModuleName: string|null }}
 */
export function createTimeState(moduleConfigs) {
    const refConfig = (moduleConfigs || []).find(config => config.timeReferenceStandard === true);
    return {
        standardTimeData: null,
        standardFound: false,
        referenceModuleName: refConfig?.name || null,
    };
}

/** 从模块变量中取第一个含 time 的变量值 */
function getTimeVariable(module) {
    if (!module.variables) return null;
    for (const [variableName, timeVal] of Object.entries(module.variables)) {
        if (variableName.toLowerCase().includes('time') && timeVal) {
            return { variableName, timeVal };
        }
    }
    return null;
}

/**
 * 段级两阶段：附加一段模块的时间数据（等价于原 attachStructuredTimeData）。
 * ⚠️ 不是逐模块流式！保持「先定基准再统一应用」语义。
 * @param {Array} modules 模块数组（X..end 段）
 * @param {Array} moduleConfigs 模块配置
 * @param {Object} parsers 解析器 { parseTimeDetailed }
 * @param {Object} [initialState] 可选的初始状态（快照续传用：{ standardTimeData, standardFound, referenceModuleName }）
 * @returns {Object} 新状态（standardTimeData / standardFound；module 就地修改 timeData / variables）
 */
export function attachTimeToState(modules, moduleConfigs, parsers, initialState) {
    const { parseTimeDetailed } = parsers;
    let state = initialState || createTimeState(moduleConfigs);

    // 阶段 1：若基准未定，扫描本段找「第一个 timeReferenceStandard 模块的有效完整 time」
    if (!state.standardFound && state.referenceModuleName) {
        for (const module of modules) {
            if (module.moduleName !== state.referenceModuleName) continue;
            const tv = getTimeVariable(module);
            if (!tv) continue;
            try {
                const testTimeData = parseTimeDetailed(tv.timeVal);
                if (testTimeData && testTimeData.isValid && testTimeData.isComplete) {
                    state = { ...state, standardTimeData: testTimeData, standardFound: true };
                    break;
                }
            } catch (e) {
                // 解析失败继续找
            }
        }
    }

    // 阶段 2：用（最终）基准统一解析本段所有模块（与全量应用阶段一致）
    for (const module of modules) {
        const tv = getTimeVariable(module);
        if (!tv) continue;
        try {
            const timeData = parseTimeDetailed(tv.timeVal, state.standardTimeData);
            if (timeData) {
                module.timeData = timeData;
                if (timeData.formattedString) {
                    module.variables[tv.variableName] = timeData.formattedString;
                }
            }
        } catch (e) {
            // 解析失败跳过
        }
    }

    return state;
}

/**
 * 补全同一 messageIndex 组的 time 变量（等价于原 completeTimeVariables 单组体）。
 * 组内独立、无跨层状态 → 逐层调用即可续传。
 *
 * ⚠️ 设计意图（用户确认保留，2026-08-19）：
 *   补全按「模块的 messageIndex（dedup 后 full 模块保留最早创建层）」分组取该层标准时间。
 *   因此旧聊天中「无时间的模块」补全时用的是「最早创建那一层」的基准时间，而不是
 *   「最近一次变化层」（timeline 最后一条）的时间。
 *   这是有意设计：从创建楼层可反向确定该模块的创建楼层；旧聊天数据很少，不改。
 *   若将来要改为「按最近变化层补全」，需在 merge（timeline 生成）之后处理或改基准选择逻辑。
 *
 * @param {Array} messageModules 同一 messageIndex 的模块数组
 * @param {Array} moduleConfigs 模块配置
 * @param {Object} parsers 解析器 { completeTimeDataWithStandard }
 */
export function completeTimeForMessage(messageModules, moduleConfigs, parsers) {
    const { completeTimeDataWithStandard } = parsers;
    let standardTimeData = null;
    let standardTimeModuleName = '';

    // 策略1：优先查找开启了时间参考标准且 timeData 有效且完整的模块
    for (const module of messageModules) {
        if (module.timeData && module.timeData.isValid && module.timeData.isComplete) {
            const moduleConfig = moduleConfigs.find(config => config.name === module.moduleName);
            if (moduleConfig && moduleConfig.timeReferenceStandard) {
                standardTimeData = module.timeData;
                standardTimeModuleName = module.moduleName;
                break;
            }
        }
    }

    // 策略2：如果策略1没找到，查找任何 timeData 有效且完整的模块
    if (!standardTimeData) {
        for (const module of messageModules) {
            if (module.timeData && module.timeData.isValid && module.timeData.isComplete) {
                standardTimeData = module.timeData;
                standardTimeModuleName = module.moduleName;
                break;
            }
        }
    }

    if (!standardTimeData) {
        return;
    }

    for (const module of messageModules) {
        if (module.timeData === standardTimeData) continue;

        for (const [variableName] of Object.entries(module.variables)) {
            if (variableName.toLowerCase().includes('time')) {
                if (!module.timeData || (!module.timeData.isValid && !module.timeData.originalText)) {
                    module.timeData = standardTimeData;
                    module.variables[variableName] = module.timeData.formattedString;
                    module.isAddTime = true;
                    break;
                }
            }
        }
        for (const [variableName] of Object.entries(module.variables)) {
            if (variableName.toLowerCase().includes('time')) {
                if (module.timeData && module.timeData.isValid && !module.timeData.isComplete) {
                    const updatedTimeData = completeTimeDataWithStandard(module.timeData, standardTimeData);
                    if (updatedTimeData !== module.timeData) {
                        module.timeData = updatedTimeData;
                    }
                    if (module.variables && module.timeData.isComplete) {
                        module.variables[variableName] = module.timeData.formattedString;
                        break;
                    }
                }
            }
        }
    }
}

/**
 * 补全一段模块数组的 time 变量（等价于原 completeTimeVariables，按 messageIndex 分组逐组处理）。
 * @param {Array} modules 模块数组
 * @param {Array} moduleConfigs 模块配置
 * @param {Object} parsers 解析器 { completeTimeDataWithStandard }
 */
export function completeTimeToState(modules, moduleConfigs, parsers) {
    // 按 messageIndex 分组
    const messageModulesMap = {};
    for (const module of modules) {
        const messageIndex = module.messageIndex;
        if (messageIndex >= 0) {
            if (!messageModulesMap[messageIndex]) messageModulesMap[messageIndex] = [];
            messageModulesMap[messageIndex].push(module);
        }
    }
    for (const messageModules of Object.values(messageModulesMap)) {
        completeTimeForMessage(messageModules, moduleConfigs, parsers);
    }
}
