// 主模块 - ST-Continuity-Core
// 使用src/index.js作为统一入口
import {
    SettingsPanel,
    EntryButton,
    registerMacros,
    infoLog,
    debugLog,
    getContext,
    extensionFolderPath,
} from "./src/index.js";

// 导入配置管理器
import { default as configManager } from "./src/singleton/configManager.js";

// 导入事件处理器
import { EventHandler } from "./src/core/eventHandler.js";

// infoLog("♥️ Continuity Core LOADED!");

jQuery(async function () {

    // 手动加载配置
    configManager.load();

    // 总是加载设置面板（即使插件禁用，也需要让用户能重新启用）
    await new SettingsPanel().load();

    const eventHandler = new EventHandler();

    // 总是注册宏到SillyTavern系统（无论插件是否启用）
    // 这样插件重新启用时不会出现重复注册问题
    const macrosRegistered = registerMacros();

    // 检查全局开关状态
    if (!configManager.extensionConfig.enabled) {
        infoLog("♥️ Continuity Core 已禁用，事件监听器和宏已注册但不会处理事件");
        return;
    }
    infoLog("♥️ Continuity Core 已启用");

    // 初始化入口按钮 (EntryButton 内部会根据配置决定显示方式)
    new EntryButton(extensionFolderPath).init();
});
