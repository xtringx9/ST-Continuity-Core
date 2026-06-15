// 统一配置管理类 - 实现配置的内存缓存、自动加载和保存
import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";
import { infoLog, errorLog, debugLog } from "../utils/logger.js";
import { normalizeConfig, DEFAULT_CONFIG_VALUES } from '../modules/moduleConfigTemplate.js';

// 扩展基本信息
export const extensionName = "ST-Continuity-Core";
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// 默认设置，包含全局开关
export const EXTENSION_CONFIG_KEY = 'extension_config';
export const DEFAULT_EXTENSION_CONFIG = {
    version: "1.0.0",
    enabled: true, // 全局开关默认开启
    backendUrl: "http://localhost:8888", // 后端服务器地址
    debugLogs: false, // 调试日志开关，默认关闭
    autoInject: false, // 自动注入开关，默认关闭
    buttonType: "embedded", // 按钮类型，默认嵌入按钮
    moduleConfigAuthor: "", // 模块配置作者，默认空字符串
    moduleConfigVersion: "", // 模块配置版本，默认1.0.0
};

export const CONTINUITY_CORE_IDENTIFIER = "[CCore]";

// 配置在扩展设置中的键名
const MODULE_CONFIG_KEY = 'module_config';

// 开发用保存开关（仅开发/重构时使用，不保存到配置）
const ENABLE_DEV_SAVE_GUARD = true; // true=允许保存，false=禁止保存

class ConfigManager {
    constructor() {
        this.isLoaded = false;
        this.extensionConfig = null;
        this.isExtensionConfigLoaded = false; // 配置是否已加载
        this.moduleConfig = null; // 内存中的配置缓存
        this.isModuleConfigLoaded = false; // 配置是否已加载
        this.autoSaveTimeout = null; // 自动保存的超时ID
        this.autoSaveDelay = 1000; // 自动保存延迟（毫秒）
        // 事件监听系统
        this.loadCallbacks = []; // 存储加载完成时的回调函数
        this.loadCallbacksExecuted = false; // 标记回调是否已执行
    }

    MODULE_TITLE_LEFT = "## "
    MODULE_TITLE_RIGHT = "";

    /**
     * 加载模块配置到内存缓存
     */
    loadModuleConfig() {
        try {
            debugLog(`开始加载模块配置，扩展名称: ${extensionName}, 配置键名: ${MODULE_CONFIG_KEY}`);

            // 从扩展设置加载配置
            if (extension_settings[extensionName] && extension_settings[extensionName][MODULE_CONFIG_KEY]) {
                this.moduleConfig = extension_settings[extensionName][MODULE_CONFIG_KEY];
                this.isModuleConfigLoaded = true;
                debugLog('模块配置已从扩展设置加载到内存缓存:', this.moduleConfig);
                return;
            }

            // 如果没有配置，使用默认配置
            this.moduleConfig = { ...DEFAULT_CONFIG_VALUES };
            this.isModuleConfigLoaded = true;
            debugLog('使用默认配置初始化内存缓存');
        } catch (error) {
            errorLog('加载模块配置失败:', error);
            // 加载失败时使用默认配置
            this.moduleConfig = { ...DEFAULT_CONFIG_VALUES };
            this.isModuleConfigLoaded = true;
        }
    }

    /**
     * 加载扩展配置到内存缓存
     */
    loadExtensionConfig() {
        try {
            debugLog(`开始加载扩展配置，扩展名称: ${extensionName}, 配置键名: ${EXTENSION_CONFIG_KEY}`);

            // 从扩展设置加载配置
            if (extension_settings[extensionName] && extension_settings[extensionName][EXTENSION_CONFIG_KEY]) {
                this.extensionConfig = extension_settings[extensionName][EXTENSION_CONFIG_KEY];
                this.isExtensionConfigLoaded = true;
                debugLog('扩展配置已从扩展设置加载到内存缓存:', this.extensionConfig);
                return;
            }

            // 如果没有配置，使用默认配置
            this.extensionConfig = { ...DEFAULT_EXTENSION_CONFIG };
            this.isExtensionConfigLoaded = true;
            debugLog('使用默认扩展配置初始化内存缓存');
        } catch (error) {
            errorLog('加载扩展配置失败:', error);
            // 加载失败时使用默认配置
            this.extensionConfig = { ...DEFAULT_EXTENSION_CONFIG };
            this.isExtensionConfigLoaded = true;
        }
    }

    /**
     * 加载所有配置到内存缓存
     */
    load() {
        this.loadExtensionConfig();
        this.loadModuleConfig();
        this.isLoaded = true;

        // 执行所有注册的加载完成回调
        this.executeLoadCallbacks();

        infoLog("♥️ Continuity Core 配置已手动加载");
    }

    isExtensionEnabled() {
        if (!this.isExtensionConfigLoaded) {
            this.loadExtensionConfig();
        }
        return this.extensionConfig.enabled;
    }

    /**
     * 获取扩展配置（从内存缓存）
     * @returns {Object} 扩展配置
     */
    getExtensionConfig() {
        if (!this.isExtensionConfigLoaded) {
            this.loadExtensionConfig();
        }
        return this.extensionConfig;
    }

    /**
     * 设置扩展配置并触发自动保存
     * @param {Object} newConfig 新的扩展配置对象
     */
    setExtensionConfig(newConfig) {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，setExtensionConfig 阻止保存。');
            return;
        }
        try {
            if (typeof newConfig !== 'object' || newConfig === null) {
                throw new Error('无效的配置结构：配置必须是对象');
            }

            this.extensionConfig = {
                ...newConfig,
                version: DEFAULT_EXTENSION_CONFIG.version,
                lastUpdated: new Date().toISOString()
            };

            extension_settings[extensionName][EXTENSION_CONFIG_KEY] = this.extensionConfig;
            infoLog('扩展配置已更新到内存缓存:', this.extensionConfig);
            saveSettingsDebounced(true);
        } catch (error) {
            errorLog('设置扩展配置失败:', error);
            throw error;
        }
    }

    /**
     * 获取模块配置（从内存缓存）
     * @returns {Object} 模块配置
     */
    getModuleConfig() {
        if (!this.isModuleConfigLoaded) {
            this.loadModuleConfig();
        }
        return this.moduleConfig;
    }

    /**
     * 设置配置并触发自动保存
     * @param {Object} newConfig 新的配置对象
     */
    setModuleConfig(newConfig) {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，setModuleConfig 阻止自动保存。');
            return;
        }
        try {
            if (!newConfig.modules || !Array.isArray(newConfig.modules)) {
                throw new Error('无效的配置结构：缺少modules数组');
            }

            this.moduleConfig = {
                ...newConfig,
                lastUpdated: new Date().toISOString()
            };

            debugLog('配置已更新到内存缓存');
            this.scheduleAutoSave();
        } catch (error) {
            errorLog('设置配置失败:', error);
            throw error;
        }
    }

    /**
     * 获取模块配置
     * @returns {Array} 模块配置数组（只返回enabled为true的模块和变量）
     */
    getModules(needAll = false) {
        const config = this.getModuleConfig();
        const modules = config.modules || [];

        if (needAll) {
            return modules;
        }

        const enabledModules = modules.filter(module => module.enabled !== false);

        return enabledModules.map(module => {
            if (module.variables && Array.isArray(module.variables)) {
                return {
                    ...module,
                    variables: module.variables.filter(variable => variable.enabled !== false)
                };
            }
            return module;
        });
    }

    /**
     * 按照模块名获取对应模块配置
     * @param {string} moduleName 模块名称
     * @returns {Object|null} 模块配置对象，如果找不到则返回null
     */
    getModuleByName(moduleName) {
        if (!moduleName || typeof moduleName !== 'string') {
            debugLog('getModuleByName: 模块名参数无效');
            return null;
        }

        const modules = this.getModules();
        const module = modules.find(m => m.name === moduleName);

        if (!module) {
            debugLog(`getModuleByName: 未找到名为"${moduleName}"的模块`);
            return null;
        }

        debugLog(`getModuleByName: 成功找到模块"${moduleName}"`);
        return module;
    }

    /**
     * 按照模块名和变量名获取对应变量配置
     * @param {string} moduleName 模块名称
     * @param {string} variableName 变量名称
     * @returns {Object|null} 变量配置对象，如果找不到则返回null
     */
    getVariableByName(moduleName, variableName) {
        if (!variableName || typeof variableName !== 'string') {
            errorLog('getVariableByName: 变量名参数无效');
            return null;
        }

        const module = this.getModuleByName(moduleName);
        if (!module) {
            debugLog(`getVariableByName: 未找到模块"${moduleName}"`);
            return null;
        }

        if (!module.variables || !Array.isArray(module.variables)) {
            debugLog(`getVariableByName: 模块"${moduleName}"没有变量配置`);
            return null;
        }

        const variable = module.variables.find(v => v.name === variableName);

        if (!variable) {
            debugLog(`getVariableByName: 在模块"${moduleName}"中未找到变量"${variableName}"`);
            return null;
        }

        debugLog(`getVariableByName: 成功找到变量"${variableName}"`);
        return variable;
    }

    /**
     * 按照模块配置和变量名获取对应变量配置
     * @param {Object} moduleConfig 模块配置对象
     * @param {string} variableName 变量名称
     * @returns {Object|null} 变量配置对象，如果找不到则返回null
     */
    getVariableByModuleConfig(moduleConfig, variableName) {
        const variable = moduleConfig?.variables.find(v => v.name === variableName);

        if (!variable) {
            debugLog(`getVariableByModuleConfig: 在模块配置中未找到变量"${variableName}"`);
            return null;
        }

        debugLog(`getVariableByModuleConfig: 成功找到变量"${variableName}"`);
        return variable;
    }

    /**
     * 设置模块配置
     * @param {Array} modules 模块配置数组
     */
    setModules(modules) {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，setModules 阻止自动保存。');
            return;
        }
        const config = this.getModuleConfig();
        config.modules = modules;
        if (!config.metadata) {
            config.metadata = {};
        }
        config.metadata.lastUpdated = new Date().toISOString();
        this.scheduleAutoSave();
        debugLog('模块配置已更新到内存缓存');
    }

    /**
     * 注册加载完成回调函数
     * @param {Function} callback 回调函数
     * @param {string} [name] 回调函数名称（可选，用于调试）
     */
    registerLoadCallback(callback, name = 'anonymous') {
        if (typeof callback !== 'function') {
            errorLog('注册加载回调失败：回调必须是函数');
            return;
        }

        if (this.isLoaded && !this.loadCallbacksExecuted) {
            try {
                callback();
                debugLog(`立即执行加载回调: ${name}`);
            } catch (error) {
                errorLog(`执行加载回调失败 (${name}):`, error);
            }
            return;
        }

        if (this.loadCallbacksExecuted) {
            debugLog(`配置已加载完成，不再注册新回调: ${name}`);
            return;
        }

        this.loadCallbacks.push({ callback, name });
        debugLog(`注册加载回调: ${name}, 当前回调数量: ${this.loadCallbacks.length}`);
    }

    /**
     * 执行所有注册的加载完成回调
     */
    executeLoadCallbacks() {
        if (this.loadCallbacksExecuted) {
            return;
        }

        debugLog(`开始执行加载回调，数量: ${this.loadCallbacks.length}`);

        this.loadCallbacks.forEach(({ callback, name }) => {
            try {
                callback();
                debugLog(`执行加载回调成功: ${name}`);
            } catch (error) {
                errorLog(`执行加载回调失败 (${name}):`, error);
            }
        });

        this.loadCallbacksExecuted = true;
        this.loadCallbacks = [];
        debugLog('所有加载回调执行完成');
    }

    /**
     * 获取全局设置
     * @returns {Object} 全局设置对象
     */
    getGlobalSettings() {
        const config = this.getModuleConfig();
        return config.globalSettings || DEFAULT_CONFIG_VALUES.globalSettings;
    }

    /**
     * 设置全局设置
     * @param {Object} globalSettings 全局设置对象
     */
    setGlobalSettings(globalSettings) {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，setGlobalSettings 阻止自动保存。');
            return;
        }
        const config = this.getModuleConfig();
        config.globalSettings = {
            ...config.globalSettings,
            ...globalSettings
        };
        config.metadata.lastUpdated = new Date().toISOString();
        this.scheduleAutoSave();
        debugLog('全局设置已更新到内存缓存');
    }

    /**
     * 立即保存模块配置到存储
     * @returns {boolean} 是否保存成功
     */
    saveModuleConfigNow() {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，已阻止配置保存。');
            return false;
        }
        try {
            if (!this.isModuleConfigLoaded) {
                this.load();
            }

            debugLog('开始保存配置，当前配置:', this.moduleConfig);
            debugLog('扩展设置结构:', extension_settings);
            this.moduleConfig = normalizeConfig(this.moduleConfig);

            if (!extension_settings[extensionName]) {
                extension_settings[extensionName] = {};
                debugLog('创建了新的扩展设置对象');
            }

            extension_settings[extensionName][MODULE_CONFIG_KEY] = this.moduleConfig;
            debugLog('配置已设置到扩展设置中');

            saveSettingsDebounced(true);

            setTimeout(() => {
                const savedConfig = extension_settings[extensionName] && extension_settings[extensionName][MODULE_CONFIG_KEY];
                if (savedConfig) {
                    debugLog('配置保存验证成功:', savedConfig);
                } else {
                    errorLog('配置保存验证失败：保存后无法读取');
                }
            }, 100);

            return true;
        } catch (error) {
            errorLog('保存配置失败:', error);
            return false;
        }
    }

    /**
     * 安排自动保存
     */
    scheduleAutoSave() {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，已阻止自动保存。');
            return;
        }
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        this.autoSaveTimeout = setTimeout(() => {
            this.saveModuleConfigNow();
        }, this.autoSaveDelay);
    }

    /**
     * 重置配置为默认值
     */
    resetModuleConfigToDefault() {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，resetModuleConfigToDefault 阻止自动保存。');
            return;
        }
        this.moduleConfig = { ...DEFAULT_CONFIG_VALUES };
        this.scheduleAutoSave();
        infoLog('配置已重置为默认值');
    }

    /**
     * 获取配置统计信息
     * @returns {Object} 统计信息
     */
    getModuleConfigStats() {
        const config = this.getModuleConfig();
        const modules = config.modules || [];
        const enabledModules = modules.filter(module => module.enabled !== false).length;

        return {
            totalModules: modules.length,
            enabledModules: enabledModules,
            lastUpdated: config.metadata?.lastUpdated || config.lastUpdated,
            version: config.metadata?.version || config.version || DEFAULT_CONFIG_VALUES.metadata.version
        };
    }

    outputCache() {
        infoLog("[Module Cache]打印当前配置缓存数据:", configManager.extensionConfig, configManager.moduleConfig);
    }

    /**
     * 判断模块配置是否包含特定变量
     * @param {Object} moduleData 单一模块的数据对象
     * @param {string} variableName 需要判断的变量名
     * @returns {boolean} 是否包含该变量
     */
    hasModuleVariable(moduleData, variableName) {
        try {
            if (!moduleData || !variableName) {
                debugLog('hasModuleVariable: 参数无效');
                return false;
            }

            if (!moduleData.variables || !Array.isArray(moduleData.variables)) {
                debugLog('hasModuleVariable: 模块数据中不包含有效的variables数组');
                return false;
            }

            const hasVariable = moduleData.variables.some(variable =>
                variable.name === variableName
            );

            debugLog(`hasModuleVariable: 模块${moduleData.name || ''}${hasVariable ? '包含' : '不包含'}变量${variableName}`);
            return hasVariable;
        } catch (error) {
            errorLog('hasModuleVariable执行失败:', error);
            return false;
        }
    }

    /**
     * 根据模块名和变量名判断模块配置是否包含特定变量
     * @param {string} moduleName 模块名称
     * @param {string} variableName 需要判断的变量名
     * @returns {boolean} 是否包含该变量
     */
    hasVariableByModuleName(moduleName, variableName) {
        try {
            if (!moduleName || !variableName) {
                debugLog('hasVariableByModuleName: 参数无效');
                return false;
            }

            const modules = this.getModules();
            const targetModule = modules.find(module => module.name === moduleName);

            if (!targetModule) {
                debugLog(`hasVariableByModuleName: 未找到名称为${moduleName}的模块`);
                return false;
            }

            return this.hasModuleVariable(targetModule, variableName);
        } catch (error) {
            errorLog('hasVariableByModuleName执行失败:', error);
            return false;
        }
    }
}

// 创建单例实例
const configManager = new ConfigManager();

export default configManager;
