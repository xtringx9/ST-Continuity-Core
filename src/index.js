/**
 * ST-Continuity-Core 总入口文件
 *
 * 此文件仅导出 continuity-core.js（ST扩展加载入口）所需的模块。
 * 内部模块之间请直接从源文件导入，不再通过此文件中转。
 */

// ST 扩展入口所需的导出
export { SettingsPanel } from './features/extension-settings/SettingsPanel.js';
export { EntryButton } from './features/entry/EntryButton.js';
export { registerMacros } from './core/macroManager.js';
export { infoLog, debugLog } from './utils/logger.js';
export { getContext } from '../../../../extensions.js';
export { extensionFolderPath } from './singleton/configManager.js';
