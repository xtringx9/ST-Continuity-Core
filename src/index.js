/**
 * ST-Continuity-Core 总入口文件
 * 统一导出所有核心模块和外部依赖，便于外部引用
 */

// ==========================================
// 1. 外部依赖导入与导出
// ==========================================

import { extension_settings, loadExtensionSettings, getContext, getApiUrl } from '../../../../extensions.js';
import {
    chat_metadata, chat, characters, eventSource, event_types, getCurrentChatId, getRequestHeaders, messageFormatting, reloadCurrentChat, saveSettingsDebounced, this_chid
} from '../../../../../script.js';
import { currentUser, getCurrentUserHandle } from '../../../../user.js';
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
    chat, characters, eventSource, event_types, getCurrentChatId, getRequestHeaders, messageFormatting, reloadCurrentChat, saveSettingsDebounced, this_chid,
    currentUser, getCurrentUserHandle
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

export { SettingsPanel } from './features/extension-settings/SettingsPanel.js';
export { EntryButton } from './features/entry/EntryButton.js';

export {
    setExtensionEnabled,
    loadSettingsToUI,
    onEnabledToggle,
    onBackendUrlChange,
    onDebugLogsToggle,
    onButtonTypeChange,
} from './ui/extensionSettingsManager.js';

// ==========================================
// 5. Modules 功能模块
// ==========================================

export {
    generateFormalPrompt,
    generateStructurePreview,
    copyToClipboard,
} from './modules/promptGenerator.js';

export {
    parseModuleString,
    validateModuleString,
    generateModulePreview,
} from './modules/moduleParser.js';

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

export { sendToBackend } from './services/backendService.js';

export {
    CONTINUITY_CORE_SERVER_API_BASE,
    getContinuityCoreUserHandle,
    continuityCoreServerRequest,
    saveContinuityCoreFile,
    readContinuityCoreFile,
    listContinuityCoreFiles,
    deleteContinuityCoreFile,
    ensureContinuityCoreDir,
    appendContinuityCoreMessage,
    readContinuityCoreMessage,
    writeContinuityCoreMessage,
    readContinuityCoreMessages,
    readContinuityCoreSnapshot,
    writeContinuityCoreSnapshot,
    readContinuityCoreMeta,
    writeContinuityCoreMeta,
    moveContinuityCoreChat,
    deleteContinuityCoreChat,
    listContinuityCoreChats,
} from './services/continuityCoreServerApi.js';

export {
    getSafeCharName,
    getSafeFileName,
    getChatStorageDir,
    getBatchStart,
    getMessageBatchFileName,
    getSnapshotBatchFileName,
    getMessageBatchPath,
    getSnapshotBatchPath,
    getMetaPath,
} from './services/storageKeyBuilder.js';

export { default as perMessageStorage } from './services/perMessageStorage.js';

export {
    updateCurrentCharWorldBookCache,
    getCurrentCharBooksModuleEntries,
    getCurrentCharBooksEnabledEntries,
    checkAndInitializeWorldBook,
    getTestData,
    getCurrentCharBooks
} from './utils/worldBookUtils.js';

export { registerContinuityRegexPattern } from './utils/regexUtils.js';
