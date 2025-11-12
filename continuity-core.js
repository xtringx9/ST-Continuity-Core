// 主模块 - ST-Continuity-Core
import { initializeSettings } from "./core/settingsManager.js";
import { loadSettingsPanel, createFabMenu } from "./core/uiManager.js";
import { infoLog } from "./utils/logger.js";

infoLog("♥️ Continuity Core LOADED!");

// 当文档加载完毕后执行
jQuery(async function () {
    // 初始化设置
    initializeSettings();

    // 加载设置面板
    await loadSettingsPanel();

    // 创建FAB菜单
    createFabMenu();
});
