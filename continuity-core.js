// 主模块 - ST-Continuity-Core
// 使用src/index.js作为统一入口
import {
    initializeSettings,
    loadSettingsPanel,
    createFabMenu,
    EventHandler,
    PromptInjector,
    registerMacros,
    infoLog,
    extension_settings,
    extensionName
} from "./src/index.js";

infoLog("♥️ Continuity Core LOADED!");

// 当文档加载完毕后执行
jQuery(async function () {
    // 初始化设置
    const settings = initializeSettings();

    // 总是加载设置面板（即使插件禁用，也需要让用户能重新启用）
    await loadSettingsPanel();

    // 检查全局开关状态
    if (!settings.enabled) {
        infoLog("Continuity Core 已禁用，仅保留设置面板功能");
        return;
    }

    infoLog("Continuity Core 已启用，开始完整初始化");

    // 创建FAB菜单
    createFabMenu();

    // 创建并初始化事件处理器（用于提示词注入）
    const eventHandler = new EventHandler();
    eventHandler.initialize();

    // 创建并初始化提示词注入管理器
    const promptInjector = new PromptInjector();
    promptInjector.initialize();

    // 注册宏到SillyTavern系统
    const macrosRegistered = registerMacros();
    if (macrosRegistered) {
        infoLog("Continuity Core 宏已成功注册");
    } else {
        infoLog("Continuity Core 宏注册失败，但插件将继续运行");
    }

    // 将实例暴露到全局，供其他模块使用
    window.continuityEventHandler = eventHandler;
    window.continuityPromptInjector = promptInjector;
});
