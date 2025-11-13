// 主模块 - ST-Continuity-Core
// 使用src/index.js作为统一入口
import {
    initializeSettings,
    loadSettingsPanel,
    createFabMenu,
    eventHandler,
    infoLog
} from "./src/index.js";

infoLog("♥️ Continuity Core LOADED!");

// 当文档加载完毕后执行
jQuery(async function () {
    // 初始化设置
    initializeSettings();

    // 加载设置面板
    await loadSettingsPanel();

    // 创建FAB菜单
    createFabMenu();

    // 初始化事件处理器（用于提示词注入）
    eventHandler.initialize();
});
