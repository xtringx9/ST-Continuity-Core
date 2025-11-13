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
    eventSource,
    event_types
} from "./src/index.js";

infoLog("♥️ Continuity Core LOADED!");

// 采用st-memory-enhancement模式：一次性注册事件监听器
// 事件监听器始终存在，只在处理函数内部检查开关状态
function onChatCompletionPromptReady(eventData) {
    // 检查插件是否启用
    const settings = initializeSettings();
    if (!settings.enabled) {
        return eventData; // 插件未启用，直接返回原始数据
    }
    
    // 检查提示词注入管理器是否存在
    if (!window.continuityPromptInjector) {
        return eventData; // 注入器不存在，返回原始数据
    }
    
    // 调用提示词注入管理器处理事件
    return window.continuityPromptInjector.onChatCompletionPromptReady(eventData);
}

// 当文档加载完毕后执行
jQuery(async function () {
    // 初始化设置
    const settings = initializeSettings();

    // 总是加载设置面板（即使插件禁用，也需要让用户能重新启用）
    await loadSettingsPanel();

    // 一次性注册事件监听器（采用st-memory-enhancement模式）
    // 使用全局的eventSource和event_types对象
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);
    infoLog("Continuity Core 事件监听器已注册（一次性注册模式）");

    // 检查全局开关状态
    if (!settings.enabled) {
        infoLog("Continuity Core 已禁用，事件监听器已注册但不会处理事件");
        return;
    }

    infoLog("Continuity Core 已启用，开始完整初始化");

    // 创建FAB菜单
    createFabMenu();

    // 采用st-memory-enhancement模式：直接创建或重新初始化实例
    if (!window.continuityPromptInjector) {
        window.continuityPromptInjector = new PromptInjector();
    }
    window.continuityPromptInjector.initialize();
    infoLog("Continuity Core 提示词注入管理器已初始化");

    // 注册宏到SillyTavern系统
    const macrosRegistered = registerMacros();
    if (macrosRegistered) {
        infoLog("Continuity Core 宏已成功注册");
    } else {
        infoLog("Continuity Core 宏注册失败，但插件将继续运行");
    }
});
