import { debugLog, errorLog } from '../../utils/logger.js';
import { insertCombinedStylesToDetails } from '../../modules/styleCombiner.js';
import { runModulePipeline } from '../pipeline/runModulePipeline.js';

/**
 * Builds module process results and enriches each module with combined styles.
 *
 * The returned object is the runModulePipeline result after mutation by
 * insertCombinedStylesToDetails(), so this is intentionally not a pure getter.
 */
export function buildStyledProcessResult(container, extractParams) {
    try {
        debugLog('[CUSTOM STYLES] 开始更新模块数据和样式', container);

        const selectedModuleNames = extractParams.moduleFilters.map(config => config.name);
        const processResult = runModulePipeline({
            range: { start: extractParams.startIndex, end: extractParams.endIndex },
            modules: extractParams.moduleFilters,
            processType: 'auto',
            selectedModuleNames,
        });
        debugLog('[CUSTOM STYLES] 提取结果:', processResult);

        Object.keys(processResult.content).forEach(moduleName => {
            const moduleData = processResult.content[moduleName];
            const moduleConfig = moduleData.moduleConfig;
            if (!moduleConfig) {
                debugLog(`[CUSTOM STYLES] 模块 ${moduleName} 没有配置`);
                return;
            }
            debugLog(`[CUSTOM STYLES] 处理模块 ${moduleName}`, moduleData);

            insertCombinedStylesToDetails(moduleData);
        });
        return processResult;
    } catch (error) {
        errorLog('插入/更新模块数据和样式到模块内容容器失败:', error);
        return null;
    }
}

export const getProcessResult = buildStyledProcessResult;
