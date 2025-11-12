/**
 * ST-Continuity-Core 总入口文件
 * 统一导出所有核心模块和外部依赖，便于外部引用
 */

// 导入外部依赖
import { extension_settings, loadExtensionSettings } from '../../../../extensions.js';
import { chat, saveSettingsDebounced } from '../../../../../script.js';

// 导出外部依赖
export { extension_settings, loadExtensionSettings, chat, saveSettingsDebounced };

// 导出核心配置模块
export { extensionName, extensionFolderPath, defaultSettings } from './core/config.js';

// 导出设置管理模块
export {
    initializeSettings,
    loadSettingsToUI,
    onEnabledToggle,
    onBackendUrlChange,
    onDebugLogsToggle,
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
} from './modules/moduleConfigManager.js';

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
