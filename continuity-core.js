// 主模块 - ST-Continuity-Core
// 使用src/index.js作为统一入口
import {
    loadSettingsPanel,
    createFabMenu,
    registerMacros,
    infoLog,
    debugLog,
    getContext,
} from "./src/index.js";

// 导入事件处理器
import { EventHandler } from "./src/core/eventHandler.js";

// 导入配置管理器
import configManager from "./src/singleton/configManager.js";

infoLog("♥️ Continuity Core LOADED!");

jQuery(async function () {

    // 手动加载配置
    configManager.load();
    infoLog("Continuity Core 配置已手动加载");

    // 总是加载设置面板（即使插件禁用，也需要让用户能重新启用）
    await loadSettingsPanel();

    const eventHandler = new EventHandler();

    // 总是注册宏到SillyTavern系统（无论插件是否启用）
    // 这样插件重新启用时不会出现重复注册问题
    const macrosRegistered = registerMacros();

    // 检查全局开关状态
    if (!configManager.extensionConfig.enabled) {
        infoLog("♥️ Continuity Core 已禁用，事件监听器和宏已注册但不会处理事件");
        return;
    }
    infoLog("♥️ Continuity Core 已启用，开始完整初始化");

    // 创建FAB菜单
    createFabMenu();
});
