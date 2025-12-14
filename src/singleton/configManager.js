// 统一配置管理类 - 实现配置的内存缓存、自动加载和保存
import { extension_settings, saveSettingsDebounced, infoLog, errorLog, debugLog } from "../index.js";
import { IdentifierParser } from '../utils/identifierParser.js';
import { normalizeConfig } from '../modules/moduleConfigTemplate.js';

// 扩展基本信息
export const extensionName = "ST-Continuity-Core";
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// 默认设置，包含全局开关
export const EXTENSION_CONFIG_KEY = 'extension_config';
export const DEFAULT_EXTENSION_CONFIG = {
    enabled: true, // 全局开关默认开启
    backendUrl: "", // 后端服务器地址 http://192.168.0.119:8888/simple-process
    debugLogs: false, // 调试日志开关，默认关闭
    autoInject: false, // 自动注入开关，默认开启
};

export const CONTINUITY_CORE_IDENTIFIER = "[CCore]";

// 配置在扩展设置中的键名
const MODULE_CONFIG_KEY = 'module_config';

// 默认配置结构
const DEFAULT_MODULE_CONFIG = {
    version: '1.1.0',
    lastUpdated: new Date().toISOString(),
    globalSettings: {
        prompt: '',
        orderPrompt: '',
        usagePrompt: '',
        moduleDataPrompt: '',
        containerStyles: '',
        timeFormat: '${year}-${month}-${day} ${weekday} ${hour}:${minute}:${second}'
    },
    modules: [],
};

class ConfigManager {
    constructor() {
        this.isLoaded = false;
        this.extensionConfig = null;
        this.isExtensionConfigLoaded = false; // 配置是否已加载
        this.moduleConfig = null; // 内存中的配置缓存
        this.isModuleConfigLoaded = false; // 配置是否已加载
        this.autoSaveTimeout = null; // 自动保存的超时ID
        this.autoSaveDelay = 1000; // 自动保存延迟（毫秒）
        this.uiDataCollector = new UIDataCollector(); // UI数据收集器

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

            // 检查是否有旧的配置格式（兼容性处理）
            if (extension_settings[extensionName] && extension_settings[extensionName].modules) {
                debugLog('检测到旧的配置格式，进行迁移');
                this.moduleConfig = {
                    modules: extension_settings[extensionName].modules || [],
                    globalSettings: extension_settings[extensionName].globalSettings || DEFAULT_MODULE_CONFIG.globalSettings,
                    lastUpdated: new Date().toISOString(),
                    version: DEFAULT_MODULE_CONFIG.version
                };
                // 保存新格式
                this.saveModuleConfigNow();
                this.isModuleConfigLoaded = true;
                debugLog('旧配置已迁移到新格式:', this.moduleConfig);
                return;
            }

            // 如果没有配置，使用默认配置
            this.moduleConfig = { ...DEFAULT_MODULE_CONFIG };
            this.isModuleConfigLoaded = true;
            debugLog('使用默认配置初始化内存缓存');
        } catch (error) {
            errorLog('加载模块配置失败:', error);
            // 加载失败时使用默认配置
            this.moduleConfig = { ...DEFAULT_MODULE_CONFIG };
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
        try {
            // 验证配置结构
            if (typeof newConfig !== 'object' || newConfig === null) {
                throw new Error('无效的配置结构：配置必须是对象');
            }

            // 更新内存缓存
            this.extensionConfig = {
                ...newConfig,
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
        try {
            // 验证配置结构
            if (!newConfig.modules || !Array.isArray(newConfig.modules)) {
                throw new Error('无效的配置结构：缺少modules数组');
            }

            // 更新内存缓存
            this.moduleConfig = {
                ...newConfig,
                lastUpdated: new Date().toISOString()
            };

            debugLog('配置已更新到内存缓存');

            // 触发自动保存
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
    getModules() {
        const config = this.getModuleConfig();
        const modules = config.modules || [];

        // 过滤掉enabled为false的模块
        const enabledModules = modules.filter(module => module.enabled !== false);

        // 对每个模块，过滤掉enabled为false的变量
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
            errorLog('getModuleByName: 模块名参数无效');
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
     * 设置模块配置
     * @param {Array} modules 模块配置数组
     */
    setModules(modules) {
        const config = this.getModuleConfig();
        config.modules = modules;
        config.lastUpdated = new Date().toISOString();
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

        // 如果配置已经加载完成，立即执行回调
        if (this.isLoaded && !this.loadCallbacksExecuted) {
            try {
                callback();
                debugLog(`立即执行加载回调: ${name}`);
            } catch (error) {
                errorLog(`执行加载回调失败 (${name}):`, error);
            }
            return;
        }

        // 如果回调已经执行过，不再注册
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

        // 执行所有回调
        this.loadCallbacks.forEach(({ callback, name }) => {
            try {
                callback();
                debugLog(`执行加载回调成功: ${name}`);
            } catch (error) {
                errorLog(`执行加载回调失败 (${name}):`, error);
            }
        });

        // 标记为已执行，清空回调数组
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
        return config.globalSettings || DEFAULT_MODULE_CONFIG.globalSettings;
    }

    /**
     * 设置全局设置
     * @param {Object} globalSettings 全局设置对象
     */
    setGlobalSettings(globalSettings) {
        const config = this.getModuleConfig();
        config.globalSettings = {
            ...config.globalSettings,
            ...globalSettings
        };
        config.lastUpdated = new Date().toISOString();
        this.scheduleAutoSave();
        debugLog('全局设置已更新到内存缓存');
    }

    /**
     * 检查模块配置是否存在
     * @deprecated 使用configManager.get().modules.length > 0替代
     */
    hasModuleConfig() {
        const config = this.getModuleConfig();
        return config.modules && config.modules.length > 0;
    }

    /**
     * 清除模块配置
     * @deprecated 使用configManager.resetToDefault()替代
     */
    clearModuleConfig() {
        this.resetModuleConfigToDefault();
        return this.saveModuleConfigNow();
    }


    /**
     * 立即保存模块配置到存储
     * @returns {boolean} 是否保存成功
     */
    saveModuleConfigNow() {
        try {
            // 确保配置已加载
            if (!this.isModuleConfigLoaded) {
                this.load();
            }

            debugLog('开始保存配置，当前配置:', this.moduleConfig);
            debugLog('扩展设置结构:', extension_settings);
            this.moduleConfig = normalizeConfig(this.moduleConfig);

            // 确保扩展设置对象存在
            if (!extension_settings[extensionName]) {
                extension_settings[extensionName] = {};
                debugLog('创建了新的扩展设置对象');
            }

            // 保存配置到扩展设置
            extension_settings[extensionName][MODULE_CONFIG_KEY] = this.moduleConfig;
            debugLog('配置已设置到扩展设置中');

            // 立即保存设置
            saveSettingsDebounced(true); // 参数为true表示立即保存

            // 输出保存的模块配置对象到控制台
            // debugLog('保存的模块配置:', this.moduleConfig.modules);
            // infoLog('配置已保存到扩展设置');

            // 验证保存是否成功
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
        // 清除之前的超时
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        // 设置新的超时
        this.autoSaveTimeout = setTimeout(() => {
            this.saveModuleConfigNow();
        }, this.autoSaveDelay);
    }

    /**
 * 备份模块配置到本地文件
 */
    backupModuleConfig() {
        try {
            // 获取当前的完整配置（包括globalSettings）
            const currentConfig = normalizeConfig(this.getModuleConfig());

            // const config = {
            //     modules: currentConfig.modules,
            //     globalSettings: currentConfig.globalSettings,
            //     backupDate: new Date().toISOString(),
            //     version: '1.1.0',
            //     source: 'ST-Continuity-Core'
            // };

            const dataStr = JSON.stringify(currentConfig, null, 2);
            const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

            const exportFileDefaultName = `continuity-modules-backup-${new Date().toISOString().split('T')[0]}.json`;

            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();

            infoLog('模块配置已备份到本地文件');
            return true;
        }
        catch (error) {
            errorLog('备份模块配置失败:', error);
            return false;
        }
    }


    /**
     * 导出配置为JSON字符串
     * @returns {string} JSON格式的配置字符串
     */
    exportModuleConfig() {
        try {
            const config = this.getModuleConfig();
            return JSON.stringify(config, null, 2);
        } catch (error) {
            errorLog('导出配置失败:', error);
            return null;
        }
    }

    /**
     * 导入配置
     * @param {string|Object} configData JSON字符串或配置对象
     * @returns {boolean} 是否导入成功
     */
    importModuleConfig(configData) {
        try {
            let newConfig;

            // 如果是字符串，解析为对象
            if (typeof configData === 'string') {
                newConfig = JSON.parse(configData);
            } else if (typeof configData === 'object' && configData !== null) {
                newConfig = configData;
            } else {
                throw new Error('无效的配置数据类型');
            }

            // 验证配置结构
            if (!newConfig.modules || !Array.isArray(newConfig.modules)) {
                throw new Error('无效的配置结构：缺少modules数组');
            }

            // 更新配置
            this.setModuleConfig(newConfig);

            // 立即保存
            this.saveModuleConfigNow();

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
    resetModuleConfigToDefault() {
        this.moduleConfig = { ...DEFAULT_MODULE_CONFIG };
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
            lastUpdated: config.lastUpdated,
            version: config.version || DEFAULT_MODULE_CONFIG.version
        };
    }

    /**
     * 从UI收集并保存配置（统一入口方法）
     * @param {boolean} immediate 是否立即保存（默认使用自动保存延迟）
     * @returns {boolean} 是否保存成功
     */
    saveFromUI(immediate = false) {
        try {
            // 收集模块数据
            const modules = this.uiDataCollector.collectModulesDataFromUI();

            // 收集全局设置数据
            const globalSettings = this.uiDataCollector.collectGlobalSettingsFromUI();

            // 更新配置
            this.setModules(modules);
            this.setGlobalSettings(globalSettings);

            // 根据参数决定保存方式
            if (immediate) {
                return this.saveModuleConfigNow();
            } else {
                // 使用自动保存机制
                this.scheduleAutoSave();
                return true;
            }
        } catch (error) {
            errorLog('从UI保存配置失败:', error);
            return false;
        }
    }

    /**
     * 自动保存配置（带防抖机制）
     */
    autoSave() {
        this.saveFromUI(false); // 使用自动保存延迟
    }

    /**
     * 立即保存配置（无延迟）
     * @returns {boolean} 是否保存成功
     */
    saveImmediately() {
        return this.saveFromUI(true);
    }

    /**
     * 获取UI数据收集器（用于外部访问）
     * @returns {UIDataCollector} UI数据收集器实例
     */
    getUIDataCollector() {
        return this.uiDataCollector;
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
            // 检查参数有效性
            if (!moduleData || !variableName) {
                debugLog('hasModuleVariable: 参数无效');
                return false;
            }

            // 检查模块是否包含variables数组
            if (!moduleData.variables || !Array.isArray(moduleData.variables)) {
                debugLog('hasModuleVariable: 模块数据中不包含有效的variables数组');
                return false;
            }

            // 检查是否存在指定名称的变量
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
            // 检查参数有效性
            if (!moduleName || !variableName) {
                debugLog('hasVariableByModuleName: 参数无效');
                return false;
            }

            // 获取所有模块配置
            const modules = this.getModules();

            // 根据模块名查找模块
            const targetModule = modules.find(module => module.name === moduleName);

            if (!targetModule) {
                debugLog(`hasVariableByModuleName: 未找到名称为${moduleName}的模块`);
                return false;
            }

            // 使用已有的hasModuleVariable方法判断变量是否存在
            return this.hasModuleVariable(targetModule, variableName);
        } catch (error) {
            errorLog('hasVariableByModuleName执行失败:', error);
            return false;
        }
    }
}

/**
 * UI数据收集器类 - 负责从UI界面收集模块和全局设置数据
 */
class UIDataCollector {
    constructor() {
        this.moduleFields = [
            'name', 'displayName', 'enabled', 'variables', 'prompt',
            'timingPrompt', 'contentPrompt', 'outputPosition', 'positionPrompt',
            'outputMode', 'retainLayers', 'compatibleModuleNames',
            'timeReferenceStandard', 'order', 'itemMin', 'itemMax', 'rangeMode',
            'containerStyles', 'customStyles', 'isExternalDisplay'
        ];
        this.variableFields = [
            'name', 'displayName', 'description', 'compatibleVariableNames', 'enabled',
            'isIdentifier', 'isBackupIdentifier', 'isHideCondition', 'hideConditionValues', 'customStyles'
        ];
    }

    /**
     * 从UI收集所有模块数据
     * @returns {Array} 模块配置数组
     */
    collectModulesDataFromUI() {
        const modules = [];

        // 遍历所有模块容器（排除父级为module-template的元素）
        $('.module-item').not('.module-template .module-item').each((index, container) => {
            const moduleData = this.collectSingleModuleData($(container), index);
            if (moduleData) {
                modules.push(moduleData);
            }
        });

        debugLog('从UI收集模块数据完成，共收集到', modules.length, '个模块');
        return modules;
    }

    /**
     * 收集单个模块的数据
     * @param {jQuery} moduleContainer 模块容器jQuery对象
     * @returns {Object|null} 模块数据对象
     */
    collectSingleModuleData(moduleContainer, index = 0) {
        try {
            // debugLog('开始收集模块', index, '的数据', moduleContainer);

            const moduleData = {};

            // 收集模块级别的字段
            this.moduleFields.forEach(field => {
                const value = this.collectFieldValue(moduleContainer, field);
                if (value !== undefined) {
                    moduleData[field] = value;
                }
            });

            // 收集变量数据
            moduleData.variables = this.collectVariablesData(moduleContainer);

            // 后处理
            this.processRangeModeData(moduleData);

            // // 验证必要字段
            // if (!moduleData.name) {
            //     debugLog('跳过无效模块：缺少模块名称');
            //     return null;
            // }

            return moduleData;
        } catch (error) {
            errorLog('收集模块数据失败:', error);
            return null;
        }
    }

    /**
     * 后处理：根据rangeMode处理itemMin和itemMax
     * @param {Object} moduleData 模块数据对象
     */
    processRangeModeData(moduleData) {
        switch (moduleData.rangeMode) {
            case 'unlimited':
                moduleData.itemMin = 0;
                moduleData.itemMax = 0;
                break;
            case 'specified':
                moduleData.itemMin = 0;
                break;
        }
    }

    /**
     * 收集字段值
     * @param {jQuery} container 容器元素
     * @param {string} field 字段名
     * @returns {*} 字段值
     */
    collectFieldValue(container, field) {
        try {
            switch (field) {
                case 'name':
                    return container.find('.module-name').val() || '';
                case 'displayName':
                    return container.find('.module-display-name').val() || '';
                case 'enabled':
                    return container.find('.module-enabled-toggle').prop('checked') !== false;
                case 'order':
                    const orderText = container.find('.module-order-number').text();
                    return parseInt(orderText) || 0;
                case 'prompt':
                    return container.find('.module-prompt-input').val() || '';
                case 'timingPrompt':
                    return container.find('.module-timing-prompt-input').val() || '';
                case 'contentPrompt':
                    return container.find('.module-content-prompt-input').val() || '';
                case 'positionPrompt':
                    return container.find('.module-position-prompt').val() || '';
                case 'outputPosition':
                    return container.find('.module-output-position').val() || 'after_body';
                case 'outputMode':
                    return container.find('.module-output-mode').val() || 'full';
                case 'retainLayers':
                    return !isNaN(parseInt(container.find('.module-retain-layers').val())) ? parseInt(container.find('.module-retain-layers').val()) : -1;
                case 'rangeMode':
                    return container.find('.module-range-mode').val() || 'unlimited';
                case 'itemMin':
                    return parseInt(container.find('.module-item-min').val()) || 0;
                case 'itemMax':
                    return parseInt(container.find('.module-item-specified').val()) || 0;
                case 'timeReferenceStandard':
                    return container.find('.module-time-reference-standard').val() === 'true' || false;
                case 'isExternalDisplay':
                    return container.find('.module-is-external-display').val() === 'true' || false;
                case 'compatibleModuleNames':
                    const names = container.find('.module-compatible-names').val() || '';
                    return IdentifierParser.parseMultiValues(names);
                case 'containerStyles':
                    return container.find('.module-container-styles').val() || '';
                case 'customStyles':
                    return container.find('.module-custom-styles').val() || '';
                default:
                    return undefined;
            }
        } catch (error) {
            debugLog(`收集字段 ${field} 失败:`, error);
            return undefined;
        }
    }

    /**
     * 收集变量数据
     * @param {jQuery} moduleContainer 模块容器
     * @returns {Array} 变量数组
     */
    collectVariablesData(moduleContainer) {
        const variables = [];

        moduleContainer.find('.variable-item').each((index, variableElement) => {
            const variableData = this.collectSingleVariableData($(variableElement));
            if (variableData) {
                variables.push(variableData);
            }
        });

        return variables;
    }

    /**
     * 收集单个变量数据
     * @param {jQuery} variableElement 变量元素
     * @returns {Object|null} 变量数据
     */
    collectSingleVariableData(variableElement) {
        try {
            const variableData = {};

            this.variableFields.forEach(field => {
                const value = this.collectVariableFieldValue(variableElement, field);
                if (value !== undefined) {
                    variableData[field] = value;
                }
            });

            // 验证必要字段
            if (!variableData.name) {
                debugLog('跳过无效变量：缺少变量名称');
                return null;
            }

            return variableData;
        } catch (error) {
            errorLog('收集变量数据失败:', error);
            return null;
        }
    }

    /**
     * 收集变量字段值
     * @param {jQuery} variableElement 变量元素
     * @param {string} field 字段名
     * @returns {*} 字段值
     */
    collectVariableFieldValue(variableElement, field) {
        try {
            switch (field) {
                case 'name':
                    return variableElement.find('.variable-name').val() || '';
                case 'displayName':
                    return variableElement.find('.variable-display-name').val() || '';
                case 'description':
                    return variableElement.find('.variable-desc').val() || '';
                case 'enabled':
                    return variableElement.find('.variable-enabled').val() === 'true';
                case 'isIdentifier':
                    return variableElement.find('.variable-is-identifier').val() === 'true';
                case 'isBackupIdentifier':
                    return variableElement.find('.variable-is-backup-identifier').val() === 'true';
                case 'isHideCondition':
                    return variableElement.find('.variable-is-hide-condition').val() === 'true';
                case 'hideConditionValues':
                    const values = variableElement.find('.variable-desc').eq(1).val() || '';
                    return IdentifierParser.parseMultiValues(values);
                case 'compatibleVariableNames':
                    const names = variableElement.find('.variable-compatible-names').val() || '';
                    return IdentifierParser.parseMultiValues(names);
                case 'customStyles':
                    return variableElement.find('.variable-custom-styles').val() || '';
                default:
                    return undefined;
            }
        } catch (error) {
            debugLog(`收集变量字段 ${field} 失败:`, error);
            return undefined;
        }
    }

    /**
     * 收集全局设置数据
     * @returns {Object} 全局设置对象
     */
    collectGlobalSettingsFromUI() {
        return {
            moduleTag: $('#module-tags').val() || '',
            compatibleModuleTags: IdentifierParser.parseMultiValues($('#module-compatible-tags').val() || ''),
            contentTag: IdentifierParser.parseMultiValues($('#content-tags').val() || ''),
            contentRemainLayers: parseInt($('#content-layers').val()) || 0,
            prompt: $('#global-prompt-input').val() || '',
            orderPrompt: $('#global-order-prompt-input').val() || '',
            usagePrompt: $('#global-usage-prompt-input').val() || '',
            moduleDataPrompt: $('#global-module-data-prompt-input').val() || '',
            containerStyles: $('#global-container-styles-input').val() || '',
            timeFormat: $('#global-time-format-input').val() || '${year}-${month}-${day} ${weekday} ${hour}:${minute}:${second}'
        };
    }
}

// 创建单例实例
const configManager = new ConfigManager();

export default configManager;
