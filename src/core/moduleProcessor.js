// 模块数据处理器 - 入口文件
// 核心管线逻辑已拆分到 pipeline/ 子模块；编排入口见 pipeline/runModulePipeline.js
//
// @deprecated：processModuleData 保留为薄封装，调用 runModulePipeline，行为保持。
// 新代码请直接 import { runModulePipeline } from './pipeline/runModulePipeline.js'。
// groupProcessResultByMessageIndex 已迁至 pipeline/groupByMessage.js，此处 re-export 保持外部 import 路径不变。

import { errorLog } from '../utils/logger.js';
import { runModulePipeline } from './pipeline/runModulePipeline.js';
import { groupProcessResultByMessageIndex } from './pipeline/groupByMessage.js';

/** @deprecated 直接 import from './pipeline/groupByMessage.js' */
export { groupProcessResultByMessageIndex };

/**
 * 统一处理模块数据（支持多选）—— 薄封装，转发到 runModulePipeline。
 * @param {Object} extractParams 提取参数对象，包含startIndex, endIndex, moduleFilters
 * @param {string} processType 处理类型：'extract' | 'processed' | 'auto'
 * @param {Array} selectedModuleNames 选中的模块名数组
 * @param {boolean} isForce 是否强制刷新缓存
 * @param {boolean} showModuleNames 是否显示模块名
 * @param {boolean} showProcessInfo 是否显示处理方式说明
 * @param {boolean} showRule 是否显示规则
 * @returns {Object} 包含处理结果和显示信息的对象
 * @deprecated 请改用 runModulePipeline（options 对象签名）
 */
export function processModuleData(extractParams, processType, selectedModuleNames = undefined, isForce = false, showModuleNames = false, showProcessInfo = false, showRule = false) {
    try {
        if (!extractParams || typeof extractParams !== 'object') {
            throw new Error('提取参数无效');
        }
        const { startIndex, endIndex, moduleFilters } = extractParams;
        return runModulePipeline({
            range: { start: startIndex, end: endIndex },
            modules: moduleFilters,
            processType,
            selectedModuleNames,
            force: isForce,
            cache: 'auto',          // 按旧语义推导（auto+!force→读优先miss则写）
            showModuleNames,
            showProcessInfo,
            showRule,
        });
    } catch (error) {
        errorLog(`处理模块数据失败（类型：${processType}）:`, error);
        return {
            success: false,
            error: error.message,
            content: '',
            displayTitle: '处理失败',
            moduleCount: 0,
            hasContent: false,
        };
    }
}
