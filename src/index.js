/**
 * ST-Continuity-Core 总入口文件
 * 统一导出所有核心模块和外部依赖，便于外部引用
 */

// 导入外部依赖
import { extension_settings, loadExtensionSettings } from '../../../../extensions.js';
import { chat, saveSettingsDebounced, eventSource, event_types } from '../../../../../script.js';

// 导入核心模块
import { extensionName, defaultSettings } from './core/config.js';
import { initializeSettings, onEnabledToggle, updateExtensionUIState } from './core/settingsManager.js';
import { EventHandler } from './core/eventHandler.js';
import { PromptInjector } from './core/promptInjector.js';

// 导出外部依赖
export { extension_settings, loadExtensionSettings, chat, saveSettingsDebounced, eventSource, event_types };

// 导出核心配置模块
export { extensionName, extensionFolderPath, defaultSettings } from './core/config.js';

// 导出设置管理模块
export {
    initializeSettings,
    loadSettingsToUI,
    onEnabledToggle,
    onBackendUrlChange,
    onDebugLogsToggle,
    onAutoInjectToggle,
    updateInjectionSettingsVisibility,
    updateExtensionUIState,
} from './core/settingsManager.js';

// 导出UI管理模块
export {
    loadSettingsPanel,
    openModuleConfigWindow,
    closeModuleConfigWindow,
    createFabMenu,
} from './core/uiManager.js';

// 导出模块配置管理模块
export {
    saveModuleConfig,
    loadModuleConfig,
    exportModuleConfig,
    importModuleConfig,
    renderModulesFromConfig,
    setBindModuleEvents,
    setOnRenderComplete,
    restoreModuleConfigFromFile,
    getModuleConfigStatsInfo,
    hasModuleConfigData,
    clearModuleConfigData,
} from './modules/moduleConfigManager.js';

// 导出模块存储管理模块
export {
    saveModuleConfigToExtension,
    loadModuleConfigFromExtension,
    hasModuleConfig,
    clearModuleConfig,
    getModuleConfigStats,
    backupModuleConfig,
    restoreModuleConfig,
} from './modules/moduleStorageManager.js';

// 导出模块管理模块
export {
    addModule,
    updateModulePreview,
    updateModuleOrderNumbers,
    bindModuleEvents,
    getModulesData,
} from './modules/moduleManager.js';

// 导出提示词生成模块
export {
    generateFormalPrompt,
    generateStructurePreview,
    copyToClipboard,
} from './modules/promptGenerator.js';

// 导出提示词预览管理模块
export {
    togglePromptPreview,
    updatePromptPreview,
    copyPromptToClipboard,
    bindPromptPreviewEvents,
    initPromptPreview,
} from './modules/promptPreviewManager.js';

// 导出变量管理模块
export {
    addVariable,
    bindVariableEvents,
} from './modules/variableManager.js';

// 导出日志管理模块
export {
    isDebugLogsEnabled,
    debugLog,
    errorLog,
    warnLog,
    infoLog,
} from './utils/logger.js';

// 导出后端服务模块
export {
    sendToBackend,
} from './utils/backendService.js';

// 导出配置导入导出模块
export {
    initJsonImportExport,
    collectModulesForExport,
    bindSaveButtonEvent,
    bindAddModuleButtonEvent,
    rebindAllModulesEvents,
    updateAllModulesPreview,
} from './utils/configImporterExporter.js';

// 导出提示词注入管理器
export { PromptInjector } from './core/promptInjector.js';

// 导出事件处理器
export { EventHandler } from './core/eventHandler.js';

// 导出宏管理器
export {
    getContinuityPrompt,
    getContinuityConfig,
    getContinuityModules,
    registerMacros,
    areMacrosRegistered,
} from './core/macroManager.js';

// 导出模板管理模块
export {
    getVariableItemTemplate,
    getEmptyVariableItemTemplate,
} from './modules/templateManager.js';

// 导出模块解析器模块
export {
    parseModuleString,
    validateModuleString,
    generateModulePreview,
} from './modules/moduleParser.js';

// 导出模块解析管理模块
export {
    initParseModule,
} from './modules/parseModuleManager.js';
