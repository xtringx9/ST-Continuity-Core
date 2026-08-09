// 模块配置服务 — 负责导入/导出/合并逻辑
import { infoLog, errorLog, debugLog } from '../utils/logger.js';
import { normalizeConfig } from '../config/moduleConfigTemplate.js';
import configManager, { CONTINUITY_CORE_IDENTIFIER } from './configManager.js';

/**
 * 根据导出选项生成配置类型描述
 */
function generateConfigType(exportOptions, currentModules) {
    const totalModules = currentModules ? currentModules.length : 0;

    if (exportOptions.exportSettings && exportOptions.exportModuleConfig) {
        if (exportOptions.selectedModules && exportOptions.selectedModules.length > 0) {
            const moduleCount = exportOptions.selectedModules.length;
            const isSelectAll = moduleCount === totalModules;

            if (isSelectAll) {
                return 'full-config';
            } else {
                if (moduleCount === 1) {
                    return `settings+module-${exportOptions.selectedModules[0]}`;
                } else {
                    const maxModuleNames = 3;
                    const moduleNames = exportOptions.selectedModules.slice(0, maxModuleNames).join('+');
                    if (moduleCount > maxModuleNames) {
                        return `settings+modules-${moduleNames}+${moduleCount - maxModuleNames}more`;
                    } else {
                        return `settings+modules-${moduleNames}`;
                    }
                }
            }
        } else {
            return 'full-config';
        }
    } else if (exportOptions.exportSettings) {
        return 'settings-only';
    } else if (exportOptions.exportModuleConfig) {
        if (exportOptions.selectedModules && exportOptions.selectedModules.length > 0) {
            const moduleCount = exportOptions.selectedModules.length;
            const isSelectAll = moduleCount === totalModules;

            if (isSelectAll) {
                return 'modules-only';
            } else {
                if (moduleCount === 1) {
                    return `module-${exportOptions.selectedModules[0]}`;
                } else {
                    const maxModuleNames = 3;
                    const moduleNames = exportOptions.selectedModules.slice(0, maxModuleNames).join('+');
                    if (moduleCount > maxModuleNames) {
                        return `modules-${moduleNames}+${moduleCount - maxModuleNames}more`;
                    } else {
                        return `modules-${moduleNames}`;
                    }
                }
            }
        } else {
            return 'modules-only';
        }
    }

    return 'unknown-config';
}

/**
 * 备份模块配置到本地文件
 */
export function backupModuleConfig(exportOptions) {
    try {
        const currentConfig = normalizeConfig(configManager.getModuleConfig(), configManager.getExtensionConfig());

        let exportConfig = {};

        exportConfig.metadata = {
            ...currentConfig.metadata,
            exportOptions: exportOptions
        };

        if (exportOptions.exportSettings) {
            exportConfig.globalSettings = currentConfig.globalSettings;
        }

        if (exportOptions.exportModuleConfig) {
            if (exportOptions.selectedModules && exportOptions.selectedModules.length > 0) {
                exportConfig.modules = currentConfig.modules.filter(module =>
                    exportOptions.selectedModules.includes(module.name)
                );
            } else {
                exportConfig.modules = currentConfig.modules;
            }
        }

        const dataStr = JSON.stringify(exportConfig, null, 2);
        const bom = '\uFEFF';
        const blob = new Blob([bom + dataStr], { type: 'application/json;charset=utf-8' });
        const dataUri = URL.createObjectURL(blob);
        // 导出文件名：读当前激活配置。此处读的是 configManager.getExtensionConfig() 返回的当前配置，
        // 与 moduleConfigTemplate 的导入规范化（外部 config）同形处理，保持直读便于对比，避免引入 getter 差异。
        const extension_config = configManager.getExtensionConfig();
        const author = (extension_config && extension_config.module?.config?.author) ? extension_config.module.config.author + '_' : '';
        const version = (extension_config && extension_config.module?.config?.version) ? 'v' + extension_config.module.config.version + '_' : '';

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1);
        const configType = generateConfigType(exportOptions, currentConfig.modules);
        const exportFileDefaultName = `${CONTINUITY_CORE_IDENTIFIER}${author}${version}${configType}_${timestamp}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();

        URL.revokeObjectURL(dataUri);

        infoLog('模块配置已备份到本地文件');
        return true;
    }
    catch (error) {
        errorLog('备份模块配置失败:', error);
        return false;
    }
}

/**
 * 根据导入选项处理配置合并
 */
export function processImportConfig(configWithOptions) {
    if (!configWithOptions) return null;

    const importOptions = configWithOptions.importOptions || {};
    const importSettings = importOptions.importSettings ?? true;
    const importModuleConfig = importOptions.importModuleConfig ?? true;
    const overrideEnabled = importOptions.overrideEnabled ?? true;
    const selectedModules = importOptions.selectedModules || [];

    const normalizedConfig = normalizeConfig(configWithOptions);
    debugLog('导入配置已规范化:', normalizedConfig);

    const currentConfig = configManager.getModuleConfig();
    if (!currentConfig) return normalizedConfig;

    let finalConfig = JSON.parse(JSON.stringify(currentConfig));

    if (importSettings &&
        configWithOptions.globalSettings !== undefined &&
        configWithOptions.globalSettings !== null &&
        Object.keys(configWithOptions.globalSettings).length > 0) {
        finalConfig.globalSettings = normalizedConfig.globalSettings;
        debugLog("合并 globalSettings");
    }

    if (importModuleConfig &&
        configWithOptions.modules !== undefined &&
        Array.isArray(configWithOptions.modules) &&
        configWithOptions.modules.length > 0) {

        let modulesToProcess = normalizedConfig.modules;
        if (selectedModules.length > 0) {
            modulesToProcess = normalizedConfig.modules.filter(module =>
                selectedModules.includes(module.name)
            );
            debugLog(`用户选择了 ${selectedModules.length} 个模块进行导入`, selectedModules);
        } else {
            modulesToProcess = [];
            debugLog("用户没有选择任何模块，跳过模块导入");
        }

        if (modulesToProcess.length > 0) {
            const mergeOptions = {
                overrideEnabled: overrideEnabled,
                mergeAllFields: false,
                preserveExisting: true
            };

            const tempConfig = {
                ...normalizedConfig,
                modules: modulesToProcess
            };

            const mergedConfig = mergeModules(tempConfig, mergeOptions);
            finalConfig.modules = mergedConfig.modules;

            if (overrideEnabled) {
                debugLog("直接使用导入的 modules（覆盖启用状态）");
            } else {
                debugLog("合并 modules 的启用状态");
            }
        }
    }

    if (configWithOptions.metadata !== undefined &&
        configWithOptions.metadata !== null &&
        Object.keys(configWithOptions.metadata).length > 0) {
        finalConfig.metadata = normalizedConfig.metadata;
        debugLog("合并 metadata");
    }

    finalConfig.importOptions = normalizedConfig.importOptions;

    return finalConfig;
}

/**
 * 统一的模块合并方法
 */
export function mergeModules(importConfig, mergeOptions = {}) {
    if (!importConfig || !importConfig.modules) return importConfig;

    const currentConfig = configManager.getModuleConfig();
    if (!currentConfig || !currentConfig.modules) return importConfig;

    const currentModuleMap = new Map();
    currentConfig.modules.forEach(module => {
        if (module.name) {
            currentModuleMap.set(module.name, module);
        }
    });

    const mergedConfig = JSON.parse(JSON.stringify(currentConfig));

    const mergedModuleMap = new Map();
    mergedConfig.modules.forEach(module => {
        if (module.name) {
            mergedModuleMap.set(module.name, module);
        }
    });

    importConfig.modules.forEach(importModule => {
        if (!importModule.name) return;

        if (mergedModuleMap.has(importModule.name)) {
            const existingModule = mergedModuleMap.get(importModule.name);
            mergeSingleModule(existingModule, importModule, mergeOptions);
        } else {
            if (mergeOptions.preserveExisting) {
                mergedConfig.modules.push(JSON.parse(JSON.stringify(importModule)));
                mergedModuleMap.set(importModule.name, importModule);
            }
        }
    });

    return mergedConfig;
}

/**
 * 合并单个模块的配置
 */
function mergeSingleModule(targetModule, sourceModule, options) {
    if (!options.overrideEnabled) {
        if (sourceModule.enabled !== undefined) {
            sourceModule.enabled = targetModule.enabled;
        }

        preserveVariableEnabledStates(targetModule, sourceModule);
    }

    Object.assign(targetModule, sourceModule);
}

/**
 * 在合并前保留变量启用状态
 */
function preserveVariableEnabledStates(targetModule, sourceModule) {
    if (!sourceModule.variables || !Array.isArray(sourceModule.variables)) return;
    if (!targetModule.variables || !Array.isArray(targetModule.variables)) return;

    const targetVariableMap = new Map();
    targetModule.variables.forEach(variable => {
        if (variable.name) {
            targetVariableMap.set(variable.name, variable);
        }
    });

    sourceModule.variables.forEach(sourceVariable => {
        if (!sourceVariable.name) return;

        if (targetVariableMap.has(sourceVariable.name)) {
            const targetVariable = targetVariableMap.get(sourceVariable.name);
            sourceVariable.enabled = targetVariable.enabled;
        }
    });
}

/**
 * 导出配置为JSON字符串
 */
export function exportModuleConfig() {
    try {
        const config = configManager.getModuleConfig();
        return JSON.stringify(config, null, 2);
    } catch (error) {
        errorLog('导出配置失败:', error);
        return null;
    }
}

/**
 * 导入配置
 */
export function importModuleConfig(configData) {
    try {
        let newConfig;

        if (typeof configData === 'string') {
            newConfig = JSON.parse(configData);
        } else if (typeof configData === 'object' && configData !== null) {
            newConfig = configData;
        } else {
            throw new Error('无效的配置数据类型');
        }

        if (!newConfig.modules || !Array.isArray(newConfig.modules)) {
            throw new Error('无效的配置结构：缺少modules数组');
        }

        configManager.setModuleConfig(newConfig);
        configManager.saveModuleConfigNow();

        infoLog('配置已成功导入');
        return true;
    } catch (error) {
        errorLog('导入配置失败:', error);
        return false;
    }
}

/**
 * 重置配置为默认值
 */
export function resetModuleConfigToDefault() {
    configManager.resetModuleConfigToDefault();
}
