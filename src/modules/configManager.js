// 统一配置管理类 - 实现配置的内存缓存、自动加载和保存
import { extension_settings, saveSettingsDebounced, extensionName, infoLog, errorLog, debugLog } from "../index.js";

// 配置在扩展设置中的键名
const CONFIG_KEY = 'module_config';

// 默认配置结构
const DEFAULT_CONFIG = {
    modules: [],
    globalSettings: {
        corePrinciples: '',
        formatDescription: ''
    },
    lastUpdated: new Date().toISOString(),
    version: '1.1.0'
};

class ConfigManager {
    constructor() {
        this.config = null; // 内存中的配置缓存
        this.isLoaded = false; // 配置是否已加载
        this.autoSaveTimeout = null; // 自动保存的超时ID
        this.autoSaveDelay = 1000; // 自动保存延迟（毫秒）

        // 注意：配置加载现在需要在初始化流程中手动调用，避免过早加载
        // this.load(); // 已移除，将在continuity-core.js的初始化流程中调用
    }

    /**
     * 加载配置到内存缓存
     * @returns {Object} 加载的配置
     */
    load() {
        try {
            debugLog('开始加载配置，检查扩展设置结构:', extension_settings);
            debugLog('扩展名称:', extensionName);
            debugLog('配置键名:', CONFIG_KEY);

            // 从扩展设置加载配置
            if (extension_settings[extensionName] && extension_settings[extensionName][CONFIG_KEY]) {
                this.config = extension_settings[extensionName][CONFIG_KEY];
                this.isLoaded = true;
                debugLog('配置已从扩展设置加载到内存缓存:', this.config);
                return this.config;
            }

            // 检查是否有旧的配置格式（兼容性处理）
            if (extension_settings[extensionName] && extension_settings[extensionName].modules) {
                debugLog('检测到旧的配置格式，进行迁移');
                this.config = {
                    modules: extension_settings[extensionName].modules || [],
                    globalSettings: extension_settings[extensionName].globalSettings || DEFAULT_CONFIG.globalSettings,
                    lastUpdated: new Date().toISOString(),
                    version: DEFAULT_CONFIG.version
                };
                // 保存新格式
                this.saveNow();
                this.isLoaded = true;
                debugLog('旧配置已迁移到新格式:', this.config);
                return this.config;
            }

            // 如果没有配置，使用默认配置
            this.config = { ...DEFAULT_CONFIG };
            this.isLoaded = true;
            debugLog('使用默认配置初始化内存缓存');
            return this.config;
        } catch (error) {
            errorLog('加载配置失败:', error);
            // 加载失败时使用默认配置
            this.config = { ...DEFAULT_CONFIG };
            this.isLoaded = true;
            return this.config;
        }
    }

    /**
     * 获取当前配置（从内存缓存）
     * @returns {Object} 当前配置
     */
    get() {
        if (!this.isLoaded) {
            this.load();
        }
        return this.config;
    }

    /**
     * 设置配置并触发自动保存
     * @param {Object} newConfig 新的配置对象
     */
    set(newConfig) {
        try {
            // 验证配置结构
            if (!newConfig.modules || !Array.isArray(newConfig.modules)) {
                throw new Error('无效的配置结构：缺少modules数组');
            }

            // 更新内存缓存
            this.config = {
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
     * @returns {Array} 模块配置数组
     */
    getModules() {
        const config = this.get();
        return config.modules || [];
    }

    /**
     * 设置模块配置
     * @param {Array} modules 模块配置数组
     */
    setModules(modules) {
        const config = this.get();
        config.modules = modules;
        config.lastUpdated = new Date().toISOString();
        this.scheduleAutoSave();
        debugLog('模块配置已更新到内存缓存');
    }

    /**
     * 获取全局设置
     * @returns {Object} 全局设置对象
     */
    getGlobalSettings() {
        const config = this.get();
        return config.globalSettings || DEFAULT_CONFIG.globalSettings;
    }

    /**
     * 设置全局设置
     * @param {Object} globalSettings 全局设置对象
     */
    setGlobalSettings(globalSettings) {
        const config = this.get();
        config.globalSettings = {
            ...config.globalSettings,
            ...globalSettings
        };
        config.lastUpdated = new Date().toISOString();
        this.scheduleAutoSave();
        debugLog('全局设置已更新到内存缓存');
    }

    /**
     * 立即保存配置到存储
     * @returns {boolean} 是否保存成功
     */
    saveNow() {
        try {
            // 确保配置已加载
            if (!this.isLoaded) {
                this.load();
            }

            debugLog('开始保存配置，当前配置:', this.config);
            debugLog('扩展设置结构:', extension_settings);

            // 确保扩展设置对象存在
            if (!extension_settings[extensionName]) {
                extension_settings[extensionName] = {};
                debugLog('创建了新的扩展设置对象');
            }

            // 保存配置到扩展设置
            extension_settings[extensionName][CONFIG_KEY] = this.config;
            debugLog('配置已设置到扩展设置中');

            // 立即保存设置
            saveSettingsDebounced(true); // 参数为true表示立即保存

            // 输出保存的模块配置对象到控制台
            debugLog('保存的模块配置:', this.config.modules);
            infoLog('配置已保存到扩展设置');

            // 验证保存是否成功
            setTimeout(() => {
                const savedConfig = extension_settings[extensionName] && extension_settings[extensionName][CONFIG_KEY];
                if (savedConfig) {
                    debugLog('配置保存验证成功:', savedConfig.modules);
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
            this.saveNow();
        }, this.autoSaveDelay);
    }

    /**
     * 导出配置为JSON字符串
     * @returns {string} JSON格式的配置字符串
     */
    exportConfig() {
        try {
            const config = this.get();
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
    importConfig(configData) {
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
            this.set(newConfig);

            // 立即保存
            this.saveNow();

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
    resetToDefault() {
        this.config = { ...DEFAULT_CONFIG };
        this.scheduleAutoSave();
        infoLog('配置已重置为默认值');
    }

    /**
     * 获取配置统计信息
     * @returns {Object} 统计信息
     */
    getStats() {
        const config = this.get();
        const modules = config.modules || [];
        const enabledModules = modules.filter(module => module.enabled !== false).length;

        return {
            totalModules: modules.length,
            enabledModules: enabledModules,
            lastUpdated: config.lastUpdated,
            version: config.version || DEFAULT_CONFIG.version
        };
    }
}

// 创建单例实例
const configManager = new ConfigManager();

export default configManager;
