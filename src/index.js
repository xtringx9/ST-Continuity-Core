/**
 * ST-Continuity-Core 总入口文件
 * 统一导出所有核心模块和外部依赖，便于外部引用
 */

// ==========================================
// 1. 外部依赖导入与导出
// ==========================================

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

export {
    chat_metadata, findChar, getRegexScripts, saveScriptsByType, SCRIPT_TYPES, uuidv4,
    extension_settings, loadExtensionSettings, getContext, getApiUrl,
    chat, characters, eventSource, event_types, getCurrentChatId, messageFormatting, reloadCurrentChat, saveSettingsDebounced, this_chid
};

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

// ==========================================
// 2. Singleton 模块
// ==========================================

export { default as configManager, extensionName, extensionFolderPath, CONTINUITY_CORE_IDENTIFIER, EXTENSION_CONFIG_KEY } from './singleton/configManager.js';
export { default as moduleCacheManager } from './singleton/moduleCacheManager.js';

// ==========================================
// 3. Core 核心模块
// ==========================================

export { ExtractModuleController } from './core/extractModuleController.js';
export { PromptInjector } from './core/promptInjector.js';
export { EventHandler } from './core/eventHandler.js';
export { groupProcessResultByMessageIndex, processModuleData, htmlEscape } from './core/moduleProcessor.js';
export { extractModulesFromChat } from './core/moduleExtractor.js';
export { removeUIfromContextBottom, isInChatPage } from './core/contextBottomUI.js';
export {
    getContinuityPrompt,
    getContinuityConfig,
    getContinuityModules,
    registerMacros,
    areMacrosRegistered,
} from './core/macroManager.js';

// ==========================================
// 4. UI 模块
// ==========================================

export {
    loadSettingsToUI,
    onEnabledToggle,
    onBackendUrlChange,
    onDebugLogsToggle,
    onAutoInjectToggle,
    updateInjectionSettingsVisibility,
    updateExtensionUIState,
    onPromptChange,
    onOrderPromptChange,
    onUsagePromptChange,
    onModuleDataPromptChange,
    onContainerStylesChange,
    onExternalStylesChange,
    onTimeFormatChange,
} from './ui/settingsManager.js';

export {
    loadSettingsPanel,
    openModuleConfigWindow,
    closeModuleConfigWindow,
    createMenu,
    showCustomConfirmDialog,
} from './ui/uiManager.js';

// ==========================================
// 5. Modules 功能模块
// ==========================================

export {
    saveModuleConfig,
    loadModuleConfig,
    renderModulesFromConfig,
    setBindModuleEvents,
    setOnRenderComplete,
    getModuleConfigStatsInfo,
    hasModuleConfigData,
    clearModuleConfigData,
} from './modules/moduleConfigManager.js';

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

export {
    generateFormalPrompt,
    generateStructurePreview,
    copyToClipboard,
} from './modules/promptGenerator.js';

export {
    togglePromptPreview,
    updatePromptPreview,
    copyPromptToClipboard,
    bindPromptPreviewEvents,
    initPromptPreview,
} from './modules/promptPreviewManager.js';

export {
    addVariable,
    bindVariableEvents,
} from './modules/variableManager.js';

export {
    getVariableItemTemplate,
    getEmptyVariableItemTemplate,
} from './modules/templateManager.js';

export {
    parseModuleString,
    validateModuleString,
    generateModulePreview,
} from './modules/moduleParser.js';

export {
    initParseModule,
} from './modules/parseModuleManager.js';

// ==========================================
// 6. Utils 工具模块
// ==========================================

export {
    isDebugLogsEnabled,
    debugLog,
    errorLog,
    warnLog,
    infoLog,
} from './utils/logger.js';

export { sendToBackend } from './utils/backendService.js';

export {
    initJsonImportExport,
    bindSaveButtonEvent,
    showExportOptionsDialog
} from './utils/configImporterExporter.js';

export {
    updateCurrentCharWorldBookCache,
    getCurrentCharBooksModuleEntries,
    getCurrentCharBooksEnabledEntries,
    checkAndInitializeWorldBook,
    getTestData,
    getCurrentCharBooks
} from './utils/worldBookUtils.js';

export { registerContinuityRegexPattern } from './utils/regexUtils.js';


