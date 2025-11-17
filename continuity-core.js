// 主模块 - ST-Continuity-Core
// 使用src/index.js作为统一入口
import {
    initializeSettings,
    loadSettingsPanel,
    createFabMenu,
    PromptInjector,
    registerMacros,
    infoLog,
    extension_settings,
    extensionName,
    initContextBottomUI,
    insertUItoContextBottom
} from "./src/index.js";

// 导入事件处理器
import { EventHandler } from "./src/core/eventHandler.js";

// 导入配置管理器
import configManager from "./src/modules/configManager.js";

infoLog("♥️ Continuity Core LOADED!");



// 当文档加载完毕后执行
jQuery(async function () {
    // 初始化设置
    const settings = initializeSettings();

    // 总是加载设置面板（即使插件禁用，也需要让用户能重新启用）
    await loadSettingsPanel();

    // 创建事件处理器实例
    window.continuityEventHandler = new EventHandler();

    // 初始化事件处理器（一次性注册所有事件）
    window.continuityEventHandler.initialize();
    infoLog("Continuity Core 事件监听器已注册（事件处理器模式）");

    // 总是注册宏到SillyTavern系统（无论插件是否启用）
    // 这样插件重新启用时不会出现重复注册问题
    const macrosRegistered = registerMacros();
    if (macrosRegistered) {
        infoLog("Continuity Core 宏已成功注册（一次性注册模式）");
    } else {
        infoLog("Continuity Core 宏注册失败，但插件将继续运行");
    }

    // 检查全局开关状态
    if (!settings.enabled) {
        infoLog("♥️ Continuity Core 已禁用，事件监听器和宏已注册但不会处理事件");
        return;
    }

    infoLog("♥️ Continuity Core 已启用，开始完整初始化");

    // 手动加载配置（避免过早加载）
    configManager.load();
    infoLog("Continuity Core 配置已手动加载");

    // 创建FAB菜单
    createFabMenu();

    // 直接创建或重新初始化实例
    if (!window.continuityPromptInjector) {
        window.continuityPromptInjector = new PromptInjector();
    }
    window.continuityPromptInjector.initialize();
    infoLog("Continuity Core 提示词注入管理器已初始化");

    // 初始化上下文底部UI
    initContextBottomUI();
    infoLog("Continuity Core 上下文底部UI已初始化");
});
