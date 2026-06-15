import configManager from '../../singleton/configManager.js';
import { debugLog } from '../../utils/logger.js';

function toModuleFilters(moduleConfigs) {
    return moduleConfigs.map(config => ({
        name: config.name,
        compatibleModuleNames: config.compatibleModuleNames || [],
    }));
}

/**
 * 获取上下文底部UI需要显示的模块配置
 * @returns {Array} 符合条件的模块配置数组
 */
export function getContextBottomUIFilteredModuleConfigs() {
    const allModuleConfigs = configManager.getModules();
    const filteredModuleConfigs = allModuleConfigs.filter(config => {
        const result = (config.outputPosition === 'after_body' && config.outputMode === 'full' && config.retainLayers != 0) ||
            config.outputMode === 'incremental';
        return result;
    });
    debugLog(`[CUSTOM STYLES] 总模块数: ${allModuleConfigs.length}, 过滤后模块数: ${filteredModuleConfigs.length}`);
    debugLog(`[CUSTOM STYLES] 过滤后的模块列表: ${filteredModuleConfigs.map(config => config.name).join(', ')}`);
    return toModuleFilters(filteredModuleConfigs);
}

/**
 * 获取消息底部UI需要显示的模块配置
 * @returns {Array} 符合条件的模块配置数组
 */
export function getMsgUIFilteredModuleConfigs() {
    const allModuleConfigs = configManager.getModules();
    const filteredModuleConfigs = allModuleConfigs.filter(config => {
        const result = (config.outputPosition === 'after_body') ||
            config.outputMode === 'incremental';
        return result;
    });
    debugLog(`[CUSTOM STYLES] 总模块数: ${allModuleConfigs.length}, 过滤后模块数: ${filteredModuleConfigs.length}`);
    debugLog(`[CUSTOM STYLES] 过滤后的模块列表: ${filteredModuleConfigs.map(config => config.name).join(', ')}`);
    return toModuleFilters(filteredModuleConfigs);
}

/**
 * 获取消息内部渲染UI需要显示的模块配置
 * @returns {Array} 符合条件的模块配置数组
 */
export function getRenderUIFilteredModuleConfigs() {
    const allModuleConfigs = configManager.getModules();
    const filteredModuleConfigs = allModuleConfigs.filter(config => {
        const result = config.outputPosition !== 'after_body';
        return result;
    });
    debugLog(`[CUSTOM STYLES] 渲染 总模块数: ${allModuleConfigs.length}, 过滤后模块数: ${filteredModuleConfigs.length}`);
    debugLog(`[CUSTOM STYLES] 渲染 过滤后的模块列表: ${filteredModuleConfigs.map(config => config.name).join(', ')}`);
    return toModuleFilters(filteredModuleConfigs);
}
