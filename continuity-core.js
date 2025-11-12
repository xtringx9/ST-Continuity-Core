// 主模块 - ST-Continuity-Core
import { initializeSettings } from "./src/settingsManager.js";
import { loadSettingsPanel, createFabMenu } from "./src/uiManager.js";
import { infoLog } from "./src/logger.js";

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
