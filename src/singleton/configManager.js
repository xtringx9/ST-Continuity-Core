// 统一配置管理类 - 实现配置的内存缓存、自动加载和保存
import { extension_settings, getContext } from "../../../../../extensions.js";
import { saveSettings } from "../../../../../../script.js";
import { infoLog, errorLog, debugLog } from "../utils/logger.js";
import { normalizeConfig, DEFAULT_CONFIG_VALUES } from '../config/moduleConfigTemplate.js';
import { normalizeGeneratorConfig, DEFAULT_GENERATOR_CONFIG_VALUES } from '../config/generatorConfigTemplate.js';
import { normalizePhoneConfig, DEFAULT_PHONE_CONFIG_VALUES } from '../config/phoneConfigTemplate.js';
import { normalizeCharacterBindingConfig, DEFAULT_CHARACTER_BINDING_VALUES } from '../config/characterBindingTemplate.js';

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
    asyncModule: {
        enabled: false, // 异步模块存储（需服务器插件）
        snapshotInterval: 5, // 快照间隔（层）
        generationMode: 'pipeline', // AI 生成模式: 'pipeline' | 'raw'
        useIndependentApi: false, // 是否使用独立 API（false=主API, true=独立API）
        customApi: { // 独立 API 配置（useIndependentApi=true 时生效）
            apiurl: '',
            key: '',
            model: '',
            source: 'openai',
            temperature: 0.3,
            max_tokens: 0, // 0=不限制
        },
        rawSystemPrompt: '你是一个模块数据提取助手。请从用户提供的文本中提取模块数据，使用 [模块名|键:值|键:值] 格式输出。只输出模块数据，不要输出其他内容。', // raw 模式的系统提示词
        rawUserPromptTemplate: '--- 楼层 {{mesId}} ({{senderType}}) ---\n{{messageText}}', // raw 模式的用户提示词模板
        pipelineModifier: '请根据以上对话内容，生成模块数据。使用 [模块名|键:值|键:值] 格式输出，每个模块占一行。只输出模块数据，不要输出其他内容。', // pipeline 模式追加的指令
        showDebug: true, // 生成后是否显示调试面板
    },
};

export const CONTINUITY_CORE_IDENTIFIER = "[CCore]";

// 配置在扩展设置中的键名
const MODULE_CONFIG_KEY = 'module_config';
const GENERATOR_CONFIG_KEY = 'generator_config';
const PHONE_CONFIG_KEY = 'phone_config';
const CHARACTER_BINDING_KEY = 'character_bindings';

// 开发用保存开关（仅开发/重构时使用，不保存到配置）
const ENABLE_DEV_SAVE_GUARD = true; // true=允许保存，false=禁止保存

class ConfigManager {
    constructor() {
        this.isLoaded = false;
        this.extensionConfig = null;
        this.isExtensionConfigLoaded = false; // 配置是否已加载
        this.moduleConfig = null; // 内存中的配置缓存
        this.isModuleConfigLoaded = false; // 配置是否已加载
        this.generatorConfig = null; // 生成内容配置缓存
        this.isGeneratorConfigLoaded = false;
        this.phoneConfig = null; // 手机模式配置缓存
        this.isPhoneConfigLoaded = false;
        this.characterBindingConfig = null;
        this.isCharacterBindingConfigLoaded = false;
        this.characterBindingAutoSaveTimeout = null;
        this.autoSaveTimeout = null; // 自动保存的超时ID
        this.autoSaveDelay = 1000; // 自动保存延迟（毫秒）
        this.generatorAutoSaveTimeout = null; // 生成内容配置自动保存的超时ID
        this.phoneAutoSaveTimeout = null; // 手机模式配置自动保存的超时ID
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
                // 字段补全：确保新字段有默认值
                this.extensionConfig.asyncModule = {
                    ...DEFAULT_EXTENSION_CONFIG.asyncModule,
                    ...(this.extensionConfig.asyncModule || {}),
                };
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
     * 加载生成内容配置到内存缓存
     */
    loadGeneratorConfig() {
        try {
            debugLog(`开始加载生成内容配置，配置键名: ${GENERATOR_CONFIG_KEY}`);

            if (extension_settings[extensionName] && extension_settings[extensionName][GENERATOR_CONFIG_KEY]) {
                this.generatorConfig = extension_settings[extensionName][GENERATOR_CONFIG_KEY];
                this.isGeneratorConfigLoaded = true;
                debugLog('生成内容配置已从扩展设置加载到内存缓存:', this.generatorConfig);
                return;
            }

            this.generatorConfig = { ...DEFAULT_GENERATOR_CONFIG_VALUES };
            this.isGeneratorConfigLoaded = true;
            debugLog('使用默认生成内容配置初始化内存缓存');
        } catch (error) {
            errorLog('加载生成内容配置失败:', error);
            this.generatorConfig = { ...DEFAULT_GENERATOR_CONFIG_VALUES };
            this.isGeneratorConfigLoaded = true;
        }
    }

    /**
     * 加载手机模式配置到内存缓存
     */
    loadPhoneConfig() {
        try {
            debugLog(`开始加载手机模式配置，配置键名: ${PHONE_CONFIG_KEY}`);

            if (extension_settings[extensionName] && extension_settings[extensionName][PHONE_CONFIG_KEY]) {
                this.phoneConfig = extension_settings[extensionName][PHONE_CONFIG_KEY];
                this.isPhoneConfigLoaded = true;
                debugLog('手机模式配置已从扩展设置加载到内存缓存:', this.phoneConfig);
                return;
            }

            this.phoneConfig = { ...DEFAULT_PHONE_CONFIG_VALUES };
            this.isPhoneConfigLoaded = true;
            debugLog('使用默认手机模式配置初始化内存缓存');
        } catch (error) {
            errorLog('加载手机模式配置失败:', error);
            this.phoneConfig = { ...DEFAULT_PHONE_CONFIG_VALUES };
            this.isPhoneConfigLoaded = true;
        }
    }

    /**
     * 加载所有配置到内存缓存
     */
    load() {
        this.loadExtensionConfig();
        this.loadModuleConfig();
        this.loadGeneratorConfig();
        this.loadPhoneConfig();
        this.loadCharacterBindingConfig();
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

            // 字段补全：确保 asyncModule 子对象完整
            const asyncModule = {
                ...DEFAULT_EXTENSION_CONFIG.asyncModule,
                ...(newConfig.asyncModule || {}),
            };

            this.extensionConfig = {
                ...newConfig,
                asyncModule,
                version: DEFAULT_EXTENSION_CONFIG.version,
                lastUpdated: new Date().toISOString()
            };

            extension_settings[extensionName][EXTENSION_CONFIG_KEY] = this.extensionConfig;
            infoLog('扩展配置已更新到内存缓存:', this.extensionConfig);
            saveSettings();
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
     * 获取模块配置。
     * - needAll=true：原始全量配置（编辑器/导出/normalize/deduplicate 等，不套绑定）。
     * - needAll=false（默认）：运行期有效启用集 = 套用角色/聊天绑定覆盖后的启用模块/变量。
     *   注意：会调 getContext() 并解析绑定，相对昂贵；**切勿在循环/比较器内逐次调用**，
     *   须在循环外取一次复用，否则解析开销会被放大成性能问题。
     * @param {boolean} [needAll=false]
     * @returns {Array}
     */
    getModules(needAll = false) {
        if (needAll) {
            return this.getModuleConfig().modules || [];
        }
        return this.getEffectiveModules();
    }

    /**
     * 原始默认启用集（不套绑定）：模块 enabled!==false 且变量 enabled!==false。
     * 供 getEffectiveModules 在无上下文/无角色/无绑定时回退，避免 getModules()→getEffectiveModules()→回退→getModules() 无限递归。
     * 浅拷贝（与原 getModules 行为一致）。
     * @param {Array} [modules] 不传则用全量配置
     * @returns {Array}
     */
    _getDefaultEnabledModules(modules = null) {
        const source = modules || this.getModuleConfig().modules || [];
        return source.filter(module => module.enabled !== false).map(module => {
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

            saveSettings();

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

    /**
     * 清理扩展设置顶层废弃的配置键。
     * 有效的顶层键仅 5 个（extension_config / module_config / generator_config / phone_config / character_bindings），
     * 其余顶层键（历史遗留、重构前的旧键名等）一律删除并保存。
     * 注意：仅删除顶层未知键；5 个已知配置内部的字段由其各自的 normalize* 函数在保存时负责迁移/清理。
     * @returns {string[]} 被删除的键名列表
     */
    cleanDeprecatedConfigKeys() {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 开发模式，cleanDeprecatedConfigKeys 阻止自动保存。');
            return [];
        }
        try {
            const node = extension_settings[extensionName];
            if (!node || typeof node !== 'object') return [];

            const validTopLevelKeys = new Set([
                EXTENSION_CONFIG_KEY,
                MODULE_CONFIG_KEY,
                GENERATOR_CONFIG_KEY,
                PHONE_CONFIG_KEY,
                CHARACTER_BINDING_KEY,
            ]);

            const removed = [];
            for (const key of Object.keys(node)) {
                if (!validTopLevelKeys.has(key)) {
                    delete node[key];
                    removed.push(key);
                }
            }

            if (removed.length > 0) {
                saveSettings();
                infoLog('[Cleanup] 已清理废弃配置键:', removed);
            } else {
                infoLog('[Cleanup] 无废弃配置键需要清理。');
            }
            return removed;
        } catch (error) {
            errorLog('清理废弃配置键失败:', error);
            return [];
        }
    }

    outputCache() {
        // 1) 打印各内存缓存（便于对比是否一致）
        infoLog("[Module Cache]内存缓存数据:", {
            extensionConfig: configManager.extensionConfig,
            moduleConfig: configManager.moduleConfig,
            generatorConfig: configManager.generatorConfig,
            phoneConfig: configManager.phoneConfig,
        });
        // 2) 直接打印 extension_settings[extensionName] 的完整落盘内容（最权威，含 phone_config 等所有键）
        if (typeof extension_settings !== 'undefined' && extension_settings[extensionName]) {
            infoLog(`[Module Cache]extension_settings["${extensionName}"] 完整内容:`,
                JSON.parse(JSON.stringify(extension_settings[extensionName])));
        } else {
            infoLog(`[Module Cache]未找到 extension_settings["${extensionName}"]`);
        }
    }

    // ===== 生成内容配置（generator_config）=====

    /**
     * 获取生成内容配置（从内存缓存）
     * @returns {Object} 生成内容配置
     */
    getGeneratorConfig() {
        if (!this.isGeneratorConfigLoaded) {
            this.loadGeneratorConfig();
        }
        return this.generatorConfig;
    }

    /**
     * 获取启用的生成内容配置数组
     * @param {boolean} needAll 是否返回全部（含禁用）
     * @returns {Array} 生成内容配置数组
     */
    getGenerators(needAll = false) {
        const config = this.getGeneratorConfig();
        const generators = config.generators || [];
        if (needAll) return generators;
        return generators.filter(g => g.enabled !== false);
    }

    /**
     * 按 name 获取生成内容配置
     * @param {string} name 配置 name
     * @returns {Object|null}
     */
    getGeneratorByName(name) {
        if (!name) return null;
        return this.getGenerators(true).find(g => g.name === name) || null;
    }

    /**
     * 设置生成内容配置并触发自动保存
     * @param {Object} newConfig 新的生成内容配置
     */
    setGeneratorConfig(newConfig) {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，setGeneratorConfig 阻止保存。');
            return;
        }
        try {
            if (!newConfig.generators || !Array.isArray(newConfig.generators)) {
                throw new Error('无效的生成内容配置结构：缺少generators数组');
            }
            this.generatorConfig = {
                ...newConfig,
                metadata: {
                    ...(newConfig.metadata || {}),
                    lastUpdated: new Date().toISOString(),
                },
            };
            debugLog('生成内容配置已更新到内存缓存');
            this.scheduleGeneratorAutoSave();
        } catch (error) {
            errorLog('设置生成内容配置失败:', error);
            throw error;
        }
    }

    /**
     * 立即保存生成内容配置到存储
     * @returns {boolean} 是否保存成功
     */
    saveGeneratorConfigNow() {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，已阻止生成内容配置保存。');
            return false;
        }
        try {
            if (!this.isGeneratorConfigLoaded) {
                this.loadGeneratorConfig();
            }
            this.generatorConfig = normalizeGeneratorConfig(this.generatorConfig);
            if (!extension_settings[extensionName]) {
                extension_settings[extensionName] = {};
            }
            extension_settings[extensionName][GENERATOR_CONFIG_KEY] = this.generatorConfig;
            saveSettings();
            debugLog('生成内容配置已保存');
            return true;
        } catch (error) {
            errorLog('保存生成内容配置失败:', error);
            return false;
        }
    }

    /**
     * 安排生成内容配置自动保存
     */
    scheduleGeneratorAutoSave() {
        if (!ENABLE_DEV_SAVE_GUARD) return;
        if (this.generatorAutoSaveTimeout) {
            clearTimeout(this.generatorAutoSaveTimeout);
        }
        this.generatorAutoSaveTimeout = setTimeout(() => {
            this.saveGeneratorConfigNow();
        }, this.autoSaveDelay);
    }

    // ===== 手机模式配置（phone_config）=====

    /**
     * 获取手机模式配置（从内存缓存）
     * @returns {Object} 手机模式配置
     */
    getPhoneConfig() {
        if (!this.isPhoneConfigLoaded) {
            this.loadPhoneConfig();
        }
        return this.phoneConfig;
    }

    /**
     * 获取启用的手机场景数组
     * @param {boolean} needAll 是否返回全部（含禁用）
     * @returns {Array} 手机场景数组
     */
    getPhoneScenes(needAll = false) {
        const config = this.getPhoneConfig();
        const scenes = config.scenes || [];
        if (needAll) return scenes;
        return scenes.filter(s => s.enabled !== false);
    }

    /**
     * 按 moduleName 获取手机场景
     * @param {string} moduleName 引用的模块名
     * @returns {Object|null}
     */
    getPhoneSceneByModule(moduleName) {
        if (!moduleName) return null;
        return this.getPhoneScenes(true).find(s => s.moduleName === moduleName) || null;
    }

    /**
     * 设置手机模式配置并触发自动保存
     * @param {Object} newConfig 新的手机模式配置
     */
    setPhoneConfig(newConfig) {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，setPhoneConfig 阻止保存。');
            return;
        }
        try {
            if (!newConfig.scenes || !Array.isArray(newConfig.scenes)) {
                throw new Error('无效的手机模式配置结构：缺少scenes数组');
            }
            this.phoneConfig = {
                ...newConfig,
                metadata: {
                    ...(newConfig.metadata || {}),
                    updatedAt: new Date().toISOString(),
                },
            };
            debugLog('手机模式配置已更新到内存缓存');
            this.schedulePhoneAutoSave();
        } catch (error) {
            errorLog('设置手机模式配置失败:', error);
            throw error;
        }
    }

    /**
     * 立即保存手机模式配置到存储
     * @returns {boolean} 是否保存成功
     */
    savePhoneConfigNow() {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，已阻止手机模式配置保存。');
            return false;
        }
        try {
            if (!this.isPhoneConfigLoaded) {
                this.loadPhoneConfig();
            }
            this.phoneConfig = normalizePhoneConfig(this.phoneConfig);
            if (!extension_settings[extensionName]) {
                extension_settings[extensionName] = {};
            }
            extension_settings[extensionName][PHONE_CONFIG_KEY] = this.phoneConfig;
            saveSettings();
            debugLog('手机模式配置已保存');
            return true;
        } catch (error) {
            errorLog('保存手机模式配置失败:', error);
            return false;
        }
    }

    /**
     * 安排手机模式配置自动保存
     */
    schedulePhoneAutoSave() {
        if (!ENABLE_DEV_SAVE_GUARD) return;
        if (this.phoneAutoSaveTimeout) {
            clearTimeout(this.phoneAutoSaveTimeout);
        }
        this.phoneAutoSaveTimeout = setTimeout(() => {
            this.savePhoneConfigNow();
        }, this.autoSaveDelay);
    }


    // ===== 角色绑定配置（character_bindings）=====

    /**
     * 加载角色绑定配置到内存缓存
     */
    loadCharacterBindingConfig() {
        try {
            debugLog(`开始加载角色绑定配置，配置键名: ${CHARACTER_BINDING_KEY}`);
            if (extension_settings[extensionName] && extension_settings[extensionName][CHARACTER_BINDING_KEY]) {
                this.characterBindingConfig = extension_settings[extensionName][CHARACTER_BINDING_KEY];
                this.isCharacterBindingConfigLoaded = true;
                debugLog('角色绑定配置已从扩展设置加载到内存缓存:', this.characterBindingConfig);
                return;
            }
            this.characterBindingConfig = { ...DEFAULT_CHARACTER_BINDING_VALUES };
            this.isCharacterBindingConfigLoaded = true;
            debugLog('使用默认角色绑定配置初始化内存缓存');
        } catch (error) {
            errorLog('加载角色绑定配置失败:', error);
            this.characterBindingConfig = { ...DEFAULT_CHARACTER_BINDING_VALUES };
            this.isCharacterBindingConfigLoaded = true;
        }
    }

    /**
     * 获取角色绑定配置（从内存缓存）
     * @returns {Object}
     */
    getCharacterBindingConfig() {
        if (!this.isCharacterBindingConfigLoaded) {
            this.loadCharacterBindingConfig();
        }
        return this.characterBindingConfig;
    }

    /**
     * 设置角色绑定配置并触发自动保存
     * @param {Object} newConfig
     */
    setCharacterBindingConfig(newConfig) {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，setCharacterBindingConfig 阻止保存。');
            return;
        }
        try {
            if (!newConfig.bindings || !Array.isArray(newConfig.bindings)) {
                throw new Error('无效的角色绑定配置结构：缺少bindings数组');
            }
            this.characterBindingConfig = {
                ...newConfig,
                metadata: {
                    ...(newConfig.metadata || {}),
                    lastUpdated: new Date().toISOString(),
                },
            };
            debugLog('角色绑定配置已更新到内存缓存');
            this.scheduleCharacterBindingAutoSave();
        } catch (error) {
            errorLog('设置角色绑定配置失败:', error);
            throw error;
        }
    }

    /**
     * 立即保存角色绑定配置到存储
     */
    saveCharacterBindingConfigNow() {
        if (!ENABLE_DEV_SAVE_GUARD) {
            infoLog('[DEV_GUARD] 当前为开发模式，已阻止角色绑定配置保存。');
            return false;
        }
        try {
            if (!this.isCharacterBindingConfigLoaded) {
                this.loadCharacterBindingConfig();
            }
            this.characterBindingConfig = normalizeCharacterBindingConfig(this.characterBindingConfig);
            if (!extension_settings[extensionName]) {
                extension_settings[extensionName] = {};
            }
            extension_settings[extensionName][CHARACTER_BINDING_KEY] = this.characterBindingConfig;
            saveSettings();
            debugLog('角色绑定配置已保存');
            return true;
        } catch (error) {
            errorLog('保存角色绑定配置失败:', error);
            return false;
        }
    }

    /**
     * 安排角色绑定配置自动保存
     */
    scheduleCharacterBindingAutoSave() {
        if (!ENABLE_DEV_SAVE_GUARD) return;
        if (this.characterBindingAutoSaveTimeout) {
            clearTimeout(this.characterBindingAutoSaveTimeout);
        }
        this.characterBindingAutoSaveTimeout = setTimeout(() => {
            this.saveCharacterBindingConfigNow();
        }, this.autoSaveDelay);
    }

    // --- 角色绑定低层存取（合并逻辑在编辑器侧，保持本类存储无关）---

    /**
     * 获取全部绑定数组
     * @returns {Array}
     */
    getBindings() {
        return this.getCharacterBindingConfig().bindings || [];
    }

    /**
     * 按 scope + charName + chatFile 查找绑定
     */
    findBinding(scope, charName, chatFile = null) {
        const file = scope === 'chat' ? chatFile : null;
        return this.getBindings().find(b =>
            b.scope === scope && b.charName === charName && (b.chatFile ?? null) === file
        ) || null;
    }

    /**
     * 写入或更新一个绑定（按 scope+charName+chatFile 去重）
     * @param {Object} binding { scope, charName, chatFile, modules }
     */
    upsertBinding(binding) {
        if (!ENABLE_DEV_SAVE_GUARD) return;
        const config = this.getCharacterBindingConfig();
        if (!Array.isArray(config.bindings)) config.bindings = [];
        const file = binding.scope === 'chat' ? (binding.chatFile ?? '') : null;
        const idx = config.bindings.findIndex(b =>
            b.scope === binding.scope && b.charName === binding.charName && (b.chatFile ?? null) === file
        );
        const normalized = {
            scope: binding.scope === 'chat' ? 'chat' : 'character',
            charName: binding.charName,
            chatFile: file,
            modules: Array.isArray(binding.modules) ? binding.modules : [],
        };
        if (idx !== -1) config.bindings[idx] = normalized;
        else config.bindings.push(normalized);
        this.scheduleCharacterBindingAutoSave();
    }

    /**
     * 删除一个绑定
     */
    removeBinding(scope, charName, chatFile = null) {
        if (!ENABLE_DEV_SAVE_GUARD) return;
        const config = this.getCharacterBindingConfig();
        if (!Array.isArray(config.bindings)) return;
        const file = scope === 'chat' ? chatFile : null;
        config.bindings = config.bindings.filter(b =>
            !(b.scope === scope && b.charName === charName && (b.chatFile ?? null) === file)
        );
        this.scheduleCharacterBindingAutoSave();
    }

    /**
     * 模块/变量改名后迁移绑定覆盖（按名匹配，保留旧 override）
     * @param {Array} moduleRenames [{ oldName, newName }]
     * @param {Array} variableRenames [{ moduleName, oldVar, newVar }] moduleName 为改名后的新模块名
     */
    applyBindingRenames(moduleRenames = [], variableRenames = []) {
        if (!ENABLE_DEV_SAVE_GUARD) return;
        const hasMod = Array.isArray(moduleRenames) && moduleRenames.length > 0;
        const hasVar = Array.isArray(variableRenames) && variableRenames.length > 0;
        if (!hasMod && !hasVar) return;
        const config = this.getCharacterBindingConfig();
        if (!Array.isArray(config.bindings)) return;
        const modMap = new Map((moduleRenames || []).map(r => [r.oldName, r.newName]));
        let changed = false;
        for (const b of config.bindings) {
            if (!Array.isArray(b.modules)) continue;
            // 1) 模块改名：更新模块条目名
            for (const entry of b.modules) {
                if (modMap.has(entry.name)) {
                    entry.name = modMap.get(entry.name);
                    changed = true;
                }
            }
            // 2) 变量改名：在对应（改名后）模块条目内迁移 variableOverrides 键
            for (const vr of (variableRenames || [])) {
                const entry = b.modules.find(m => m.name === vr.moduleName);
                if (entry && entry.variableOverrides
                    && Object.prototype.hasOwnProperty.call(entry.variableOverrides, vr.oldVar)) {
                    entry.variableOverrides[vr.newVar] = entry.variableOverrides[vr.oldVar];
                    delete entry.variableOverrides[vr.oldVar];
                    changed = true;
                }
            }
        }
        if (changed) this.saveCharacterBindingConfigNow();
    }

    /**
     * 把某个（通常已悬空的）角色名下的全部绑定重指到新角色名
     * @param {string} oldName 原角色名
     * @param {string} newName 目标角色名
     */
    renameCharacterInBindings(oldName, newName) {
        if (!ENABLE_DEV_SAVE_GUARD) return;
        if (!oldName || !newName || oldName === newName) return;
        const config = this.getCharacterBindingConfig();
        if (!Array.isArray(config.bindings)) return;
        let changed = false;
        for (const b of config.bindings) {
            if (b.charName === oldName) { b.charName = newName; changed = true; }
        }
        if (changed) this.saveCharacterBindingConfigNow();
    }

    /**
     * 运行时：把角色/聊天绑定覆盖应用到模块列表（Model A：默认 < 角色 < 聊天，逐键覆盖）。
     * 返回浅拷贝新对象（spread），不修改原模块配置；与 getModules 浅拷贝一致性已验证。
     * 依据当前聊天的角色与聊天文件解析绑定；无上下文/无角色/无绑定时回退默认启用集。
     * 性能：无绑定时走快路径（仅过滤，无拷贝循环）；有绑定时才进入覆盖解析循环。
     * 注意仍较昂贵，循环/比较器内须在外部取一次复用。
     * @param {Array} [modules] 不传则用全量配置
     * @returns {Array}
     */
    getEffectiveModules(modules = null) {
        let ctx = null;
        try { ctx = (typeof getContext === 'function') ? getContext() : null; } catch { ctx = null; }
        if (!ctx) return this._getDefaultEnabledModules(modules);
        const charName = ctx.characters?.[ctx.characterId]?.name || '';
        const chatFile = ctx.chatId ?? '';
        if (!charName) return this._getDefaultEnabledModules(modules);
        const charB = this.findBinding('character', charName, null);
        const chatB = chatFile ? this.findBinding('chat', charName, chatFile) : null;
        // 无任何绑定 → 直接返回默认启用集（跳过拷贝+循环；绝大多数聊天的快路径）
        if (!charB && !chatB) return this._getDefaultEnabledModules(modules);
        // 有绑定：套用覆盖。循环用 spread 造新对象，不深拷贝（与 getModules 浅拷贝一致，已验证安全）。
        // 方案A：以全量模块为基（含默认关闭的），套完覆盖后再按 effective 过滤，
        // 从而支持"绑定重新启用默认关闭的模块/变量"。
        const mods = modules || this.getModules(true);
        const result = [];
        for (const mod of mods) {
            const defEnabled = mod.enabled !== false;
            const charEntry = charB?.modules?.find(x => x.name === mod.name);
            const chatEntry = chatB?.modules?.find(x => x.name === mod.name);
            const effMod = (chatEntry && typeof chatEntry.moduleOverride === 'boolean') ? chatEntry.moduleOverride
                : ((charEntry && typeof charEntry.moduleOverride === 'boolean') ? charEntry.moduleOverride : defEnabled);
            // 模块级禁用（默认或绑定覆盖）→ 从源头过滤掉，与 getModules() 一致
            if (effMod === false) continue;
            const newMod = { ...mod, enabled: effMod };
            if (mod.variables && Array.isArray(mod.variables)) {
                const newVars = [];
                for (const v of mod.variables) {
                    const defVar = v.enabled !== false;
                    const charVO = charEntry?.variableOverrides?.[v.name];
                    const chatVO = chatEntry?.variableOverrides?.[v.name];
                    const effVar = typeof chatVO === 'boolean' ? chatVO
                        : (typeof charVO === 'boolean' ? charVO : defVar);
                    // 变量级禁用（默认或绑定覆盖）→ 从源头过滤掉，与 getModules() 一致
                    if (effVar === false) continue;
                    newVars.push({ ...v, enabled: effVar });
                }
                newMod.variables = newVars;
            }
            result.push(newMod);
        }
        return result;
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
