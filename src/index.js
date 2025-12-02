/**
 * ST-Continuity-Core 总入口文件
 * 统一导出所有核心模块和外部依赖，便于外部引用
 */

// 导入外部依赖
import { extension_settings, loadExtensionSettings, getContext, getApiUrl } from '../../../../extensions.js';
import {
    chat_metadata, chat, characters, eventSource, event_types, getCurrentChatId, messageFormatting, reloadCurrentChat, saveSettingsDebounced, this_chid
} from '../../../../../script.js';
import { uuidv4, findChar } from '../../../../utils.js';
import {
    METADATA_KEY,
    world_info,
    world_names,
    selected_world_info,
    createNewWorldInfo,
    createWorldInfoEntry, newWorldInfoEntryTemplate,
    getWorldInfoSettings,
    worldInfoCache,
    onWorldInfoChange, convertCharacterBook, getWorldInfoPrompt, loadWorldInfo, reloadEditor, saveWorldInfo, updateWorldInfoList
} from '../../../../world-info.js';
import { getRegexScripts, saveScriptsByType, SCRIPT_TYPES } from '../../../regex/engine.js';

// 导出外部依赖
export { chat_metadata, findChar, getRegexScripts, saveScriptsByType, SCRIPT_TYPES, uuidv4, extension_settings, loadExtensionSettings, getContext, getApiUrl, chat, characters, eventSource, event_types, getCurrentChatId, messageFormatting, reloadCurrentChat, saveSettingsDebounced, this_chid };
export {
    METADATA_KEY,
    world_info,
    world_names,
    selected_world_info,
    createNewWorldInfo,
    createWorldInfoEntry, newWorldInfoEntryTemplate,
    getWorldInfoSettings,
    worldInfoCache,
    onWorldInfoChange, convertCharacterBook, getWorldInfoPrompt, loadWorldInfo, reloadEditor, saveWorldInfo, updateWorldInfoList
};

// 导出核心模块
export { default as configManager, extensionName, extensionFolderPath, CONTINUITY_CORE_IDENTIFIER } from './singleton/configManager.js';
export { ExtractModuleController } from './core/extractModuleController.js';
export { default as moduleCacheManager } from './singleton/moduleCacheManager.js';


// 导出设置管理模块
export {
    loadSettingsToUI,
    onEnabledToggle,
    onBackendUrlChange,
    onDebugLogsToggle,
    onAutoInjectToggle,
    updateInjectionSettingsVisibility,
    updateExtensionUIState,
    onCorePrinciplesChange,
    onFormatDescriptionChange
} from './ui/settingsManager.js';

// 导出UI管理模块
export {
    loadSettingsPanel,
    openModuleConfigWindow,
    closeModuleConfigWindow,
    createFabMenu,
    showCustomConfirmDialog,
} from './ui/uiManager.js';

// 导出模块配置管理模块
export {
    saveModuleConfig,
    loadModuleConfig,
    exportModuleConfig,
    importModuleConfig,
    renderModulesFromConfig,
    setBindModuleEvents,
    setOnRenderComplete,
    getModuleConfigStatsInfo,
    hasModuleConfigData,
    clearModuleConfigData,
} from './modules/moduleConfigManager.js';

// 导出模块管理模块
export {
    addModule,
    updateModulePreview,
    updateModuleOrderNumbers,
    bindModuleEvents,
    bindAddModuleButtonEvent,
    bindClearModulesButtonEvent,
    rebindAllModulesEvents,
    updateAllModulesPreview,
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
    // collectModulesForExport,
    bindSaveButtonEvent,
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

export { processModuleData, htmlEscape } from './core/moduleProcessor.js';
export { extractModulesFromChat } from './core/moduleExtractor.js';

// 导出上下文底部UI管理模块
export {
    removeUIfromContextBottom,
    isInChatPage,
    checkPageStateAndUpdateUI,
    UpdateUI
} from './core/contextBottomUI.js';

export { updateCurrentCharWorldBookCache, getCurrentCharBooksModuleEntries, getCurrentCharBooksEnabledEntries, checkAndInitializeWorldBook, getTestData, getCurrentCharBooks } from './utils/worldBookUtils.js';
export { registerContinuityRegexPattern } from './utils/regexUtils.js';


