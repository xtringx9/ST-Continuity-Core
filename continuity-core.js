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
    event_types,
    initContextBottomUI,
    insertUItoContextBottom
} from "./src/index.js";

// 导入配置管理器
import configManager from "./src/modules/configManager.js";

infoLog("♥️ Continuity Core LOADED!");

// 一次性注册事件监听器
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

    // 一次性注册事件监听器
    // 使用全局的eventSource和event_types对象
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady);

    // 一次性注册所有事件监听器，在回调函数内部检查开关状态
    // 使用SillyTavern实际可用的事件类型
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (settings.enabled) {
            infoLog("[UI Event][CHAT_CHANGED]检测到聊天变更，重新插入上下文底部UI");
            insertUItoContextBottom();
        }
    });

    // CHAT_SWITCHED事件不存在，使用CHAT_CHANGED替代
    // CHAT_LOADED事件不存在，使用CHAT_CHANGED和MESSAGE_RECEIVED组合
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        if (settings.enabled) {
            infoLog("[UI Event][MESSAGE_RECEIVED]检测到新消息接收，重新插入上下文底部UI");
            insertUItoContextBottom();
        }
    });

    // 监听消息相关事件，确保UI在消息操作后保持正确位置
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        if (settings.enabled) {
            infoLog("[UI Event][CHARACTER_MESSAGE_RENDERED]检测到角色消息渲染完成，重新插入上下文底部UI");
            // 使用更长的延迟确保消息完全渲染
            setTimeout(() => {
                insertUItoContextBottom();
            }, 200);
        }
    });

    eventSource.on(event_types.MESSAGE_EDITED, () => {
        if (settings.enabled) {
            infoLog("[UI Event][MESSAGE_EDITED]检测到消息编辑，重新插入上下文底部UI");
            insertUItoContextBottom();
        }
    });

    eventSource.on(event_types.MESSAGE_DELETED, () => {
        if (settings.enabled) {
            infoLog("[UI Event][MESSAGE_DELETED]检测到消息删除，重新插入上下文底部UI");
            insertUItoContextBottom();
        }
    });

    infoLog("Continuity Core 事件监听器已注册（一次性注册模式）");

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
