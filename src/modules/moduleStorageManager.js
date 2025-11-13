// 模块配置存储管理器 - 将模块配置存储在SillyTavern扩展设置中
import { extension_settings, saveSettingsDebounced, extensionName, infoLog, errorLog, debugLog } from "../index.js";

// 模块配置在扩展设置中的键名
const MODULE_CONFIG_KEY = 'module_config';

/**
 * 保存模块配置到SillyTavern扩展设置
 * @param {Array} modules 模块配置数组
 * @returns {boolean} 是否保存成功
 */
export function saveModuleConfigToExtension(modules) {
    try {
        // 确保扩展设置对象存在
        if (!extension_settings[extensionName]) {
            extension_settings[extensionName] = {};
        }
        
        // 保存模块配置
        extension_settings[extensionName][MODULE_CONFIG_KEY] = {
            modules: modules,
            lastUpdated: new Date().toISOString(),
            version: '1.0.0'
        };
        
        // 保存设置
        saveSettingsDebounced();
        
        infoLog('模块配置已保存到SillyTavern扩展设置');
        debugLog('保存的模块配置:', extension_settings[extensionName][MODULE_CONFIG_KEY]);
        return true;
    } catch (error) {
        errorLog('保存模块配置到扩展设置失败:', error);
        return false;
    }
}

/**
 * 从SillyTavern扩展设置加载模块配置
 * @returns {Object|null} 模块配置对象或null
 */
export function loadModuleConfigFromExtension() {
    try {
        // 检查扩展设置是否存在
        if (!extension_settings[extensionName]) {
            debugLog('扩展设置不存在，返回空配置');
            return null;
        }
        
        // 获取模块配置
        const config = extension_settings[extensionName][MODULE_CONFIG_KEY];
        
        if (config && config.modules) {
            debugLog('从SillyTavern扩展设置加载模块配置:', config);
            return config;
        }
        
        debugLog('扩展设置中未找到模块配置');
        return null;
    } catch (error) {
        errorLog('从扩展设置加载模块配置失败:', error);
        return null;
    }
}

/**
 * 检查模块配置是否存在
 * @returns {boolean} 是否存在模块配置
 */
export function hasModuleConfig() {
    return !!(extension_settings[extensionName] && extension_settings[extensionName][MODULE_CONFIG_KEY]);
}

/**
 * 清除模块配置
 * @returns {boolean} 是否清除成功
 */
export function clearModuleConfig() {
    try {
        if (extension_settings[extensionName] && extension_settings[extensionName][MODULE_CONFIG_KEY]) {
            delete extension_settings[extensionName][MODULE_CONFIG_KEY];
            saveSettingsDebounced();
            infoLog('模块配置已清除');
            return true;
        }
        return false;
    } catch (error) {
        errorLog('清除模块配置失败:', error);
        return false;
    }
}

/**
 * 获取模块配置统计信息
 * @returns {Object} 统计信息
 */
export function getModuleConfigStats() {
    const config = loadModuleConfigFromExtension();
    if (!config || !config.modules) {
        return {
            totalModules: 0,
            enabledModules: 0,
            lastUpdated: null,
            hasConfig: false
        };
    }
    
    const enabledModules = config.modules.filter(module => module.enabled !== false).length;
    
    return {
        totalModules: config.modules.length,
        enabledModules: enabledModules,
        lastUpdated: config.lastUpdated,
        hasConfig: true
    };
}

/**
 * 备份模块配置到本地文件
 * @param {Array} modules 模块配置数组
 */
export function backupModuleConfig(modules) {
    try {
        const config = {
            modules: modules,
            backupDate: new Date().toISOString(),
            version: '1.0.0',
            source: 'ST-Continuity-Core'
        };
        
        const dataStr = JSON.stringify(config, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `continuity-modules-backup-${new Date().toISOString().split('T')[0]}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        infoLog('模块配置已备份为JSON文件');
        return true;
    } catch (error) {
        errorLog('备份模块配置失败:', error);
        return false;
    }
}

/**
 * 从备份文件恢复模块配置
 * @param {File} file 备份文件
 * @returns {Promise<Object|null>} 恢复的配置对象
 */
export function restoreModuleConfig(file) {
    return new Promise((resolve) => {
        if (!file) {
            resolve(null);
            return;
        }
        
        if (file.type && file.type !== 'application/json') {
            errorLog('文件类型错误，需要JSON文件');
            toastr.error('文件类型错误，请选择JSON文件');
            resolve(null);
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const result = e.target.result;
                if (typeof result !== 'string') {
                    throw new Error('文件内容不是文本格式');
                }
                const config = JSON.parse(result);
                
                // 验证配置格式
                if (!config.modules || !Array.isArray(config.modules)) {
                    throw new Error('无效的备份文件格式，缺少modules数组');
                }
                
                debugLog('成功从备份文件恢复模块配置:', config);
                
                // 保存到扩展设置
                if (saveModuleConfigToExtension(config.modules)) {
                    toastr.success(`成功恢复 ${config.modules.length} 个模块配置`);
                    resolve(config);
                } else {
                    throw new Error('保存恢复的配置失败');
                }
            } catch (error) {
                errorLog('恢复模块配置失败:', error);
                toastr.error('恢复模块配置失败，请检查文件格式');
                resolve(null);
            }
        };
        reader.onerror = () => {
            errorLog('读取备份文件失败');
            toastr.error('读取备份文件失败');
            resolve(null);
        };
        reader.readAsText(file);
    });
}