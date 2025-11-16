// 模块配置存储管理器 - 将模块配置存储在SillyTavern扩展设置中
import { extension_settings, saveSettingsDebounced, extensionName, infoLog, errorLog, debugLog } from "../index.js";

// 模块配置在扩展设置中的键名
const MODULE_CONFIG_KEY = 'module_config';

// 这些函数已被configManager替代，保留用于向后兼容
/**
 * 保存模块配置到SillyTavern扩展设置
 * @deprecated 使用configManager.setModules()和configManager.saveNow()替代
 */
export function saveModuleConfigToExtension(modules, globalSettings = {}) {
    return import('./configManager.js').then(({ default: configManager }) => {
        configManager.setModules(modules);
        if (Object.keys(globalSettings).length > 0) {
            configManager.setGlobalSettings(globalSettings);
        }
        return configManager.saveNow();
    });
}

/**
 * 从SillyTavern扩展设置加载模块配置
 * @deprecated 使用configManager.get()替代
 */
export function loadModuleConfigFromExtension() {
    return import('./configManager.js').then(({ default: configManager }) => {
        return configManager.get();
    });
}

/**
 * 检查模块配置是否存在
 * @deprecated 使用configManager.get().modules.length > 0替代
 */
export function hasModuleConfig() {
    return import('./configManager.js').then(({ default: configManager }) => {
        const config = configManager.get();
        return config.modules && config.modules.length > 0;
    });
}

/**
 * 清除模块配置
 * @deprecated 使用configManager.resetToDefault()替代
 */
export function clearModuleConfig() {
    return import('./configManager.js').then(({ default: configManager }) => {
        configManager.resetToDefault();
        return configManager.saveNow();
    });
}

/**
 * 获取模块配置统计信息
 * @deprecated 使用configManager.getStats()替代
 */
export function getModuleConfigStats() {
    return import('./configManager.js').then(({ default: configManager }) => {
        return configManager.getStats();
    });
}

/**
 * 备份模块配置到本地文件
 * @param {Array} modules 模块配置数组（可选，如果不提供则使用当前配置）
 */
export function backupModuleConfig(modules) {
    try {
        // 导入configManager以获取当前配置
        import('./configManager.js').then(({ default: configManager }) => {
            // 获取当前的完整配置（包括globalSettings）
            const currentConfig = configManager.get();

            const config = {
                modules: modules || currentConfig.modules,
                globalSettings: currentConfig.globalSettings,
                backupDate: new Date().toISOString(),
                version: '1.1.0',
                source: 'ST-Continuity-Core'
            };

            const dataStr = JSON.stringify(config, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

            const exportFileDefaultName = `continuity-modules-backup-${new Date().toISOString().split('T')[0]}.json`;

            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();

            infoLog('模块配置已备份到本地文件');
        });
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

                // 使用configManager导入配置
                import('./configManager.js').then(({ default: configManager }) => {
                    const success = configManager.importConfig(config);
                    if (success) {
                        toastr.success(`成功恢复 ${config.modules.length} 个模块配置`);
                        resolve(config);
                    } else {
                        throw new Error('保存恢复的配置失败');
                    }
                });
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
