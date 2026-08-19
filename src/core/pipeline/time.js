// 时间处理管线步骤
import configManager from '../../singleton/configManager.js';
import { debugLog } from '../../utils/logger.js';
// ⚠️ 可组合性改造（快照阶段 0）：核心逻辑已抽到 timeCompletionStep.js（无 ST 依赖纯函数，
// 解析器注入），本文件保持对外 API（attachStructuredTimeData / completeTimeVariables）不变。
import { attachTimeToState, completeTimeToState } from './timeCompletionStep.js';
import { parseTimeDetailed, completeTimeDataWithStandard } from '../../utils/timeParser.js';

/** timeCompletionStep 需要的解析器（真实实现注入） */
const timeParsers = { parseTimeDetailed, completeTimeDataWithStandard };

/**
 * 为包含time变量的模块附加结构化时间数据
 * 使用timeParser.js中的parseTimeDetailed函数解析时间并添加结构化数据
 * @param {Array} modules 标准化后的模块数组
 */
export function attachStructuredTimeData(modules) {
    debugLog('[TimeDataAttachment] 开始为模块附加结构化时间数据，模块数量:', modules.length);

    const modulesData = configManager.getModules() || [];
    attachTimeToState(modules, modulesData, timeParsers);

    debugLog('[TimeDataAttachment] 结构化时间数据附加完成');
}

/**
 * 智能补全time变量
 * 利用已附加的timeData属性，为同一message内的模块补全时间数据
 * @param {Array} modules 标准化后的模块数组
 */
export function completeTimeVariables(modules) {
    const modulesData = configManager.getModules() || [];
    completeTimeToState(modules, modulesData, timeParsers);
    debugLog('[TimeCompletion] 智能补全time变量完成');
}
