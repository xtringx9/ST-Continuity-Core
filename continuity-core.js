// 主模块 - ST-Continuity-Core
import { SettingsPanel } from "./src/features/extension-settings/SettingsPanel.js";
import { EntryButton } from "./src/features/entry/EntryButton.js";
import { registerMacros } from "./src/core/macroManager.js";
import { infoLog, debugLog } from "./src/utils/logger.js";
import { getContext } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";
import { extensionFolderPath } from "./src/singleton/configManager.js";

// 导入配置管理器
import { default as configManager } from "./src/singleton/configManager.js";

// 导入事件处理器
import { EventHandler } from "./src/core/eventHandler.js";

// 导入消息 AI 生成按钮
import { initMessageAiButton } from "./src/ui/messageAiButton.js";

// 导入消息区间视图（扩展菜单入口）
import { initMessageRangeView } from "./src/features/message-range-view/MessageRangeView.js";
import { initQuickReplyOptimize } from "./src/features/quick-reply-optimize/QuickReplyOptimize.js";

// 发送键劫持：点击发送键 / 回车改为执行指定 Quick Reply
import { initSendHijack, removeSendHijack } from "./src/features/send-hijack/SendHijack.js";

// 消息「滚动到顶部」按钮（手动版）
import { initMessageScrollToTop } from "./src/features/messageScrollToTop.js";

// 世界书条目·聊天绑定（给原生世界书条目加「绑定当前聊天」三态）
import {
    initWorldBookBinding,
} from "./src/features/world-book-binding/worldBookBinding.js";

// 提示词预设条目·聊天绑定（给 PromptManager 每条提示词加「绑定当前聊天」三态）
import {
    initPromptBinding,
} from "./src/features/prompt-binding/promptBinding.js";

// 预设·绑定当前聊天（在 ST 预设下拉旁绑定聊天↔预设，按打开的聊天切换当前预设）
import {
    initPresetBinding,
} from "./src/features/preset-binding/presetBinding.js";

// 提示词预设条目·扩展操作（复制 / 插入空白 / 移除）
import {
    initPromptEntryActions,
} from "./src/features/prompt-entry-actions/promptEntryActions.js";

// 智绘姬文生图工作台启动器（独立模块，与 EntryButton 解耦）
import { initChatu8Launcher } from "./src/features/chatu8-launcher/chatu8Launcher.js";

// 发送键劫持设置面板：QR 下拉填充
import { populateSendHijackOptions } from "./src/ui/extensionSettingsManager.js";

// 生成记录面板（副作用导入：挂载 window.openGenerationRecords / updateRunningRecord / closeRunningRecord，
// 供 moduleAiGenerator / messageAiButton / EntryButton 调用，避免反向 import 循环依赖）
import "./src/features/generation-records/generationRecordsPanel.js";

// infoLog("♥️ Continuity Core LOADED!");

jQuery(async function () {

    // 手动加载配置
    configManager.load();

    // 总是加载设置面板（即使插件禁用，也需要让用户能重新启用）
    await new SettingsPanel().load();

    // QR 扩展的 quickReplyApi 在 APP_READY 后才完整就绪，此时重填发送劫持的 QR 下拉
    eventSource.on(event_types.APP_READY, () => {
        try { populateSendHijackOptions(); } catch (e) { debugLog('[SendHijack] APP_READY 重填下拉失败', e); }
    });

    const eventHandler = new EventHandler();

    // 总是注册宏到SillyTavern系统（无论插件是否启用）
    // 这样插件重新启用时不会出现重复注册问题
    const macrosRegistered = registerMacros();

    // ── 界面增强功能（不受全局 enabled 控制，各自有独立开关）──
    // 消息区间视图（注入 #extensionsMenu 菜单项）
    initMessageRangeView();

    // 优化原生 Quick Reply（单排横滑 / 按住拖拽平移 / 隐藏滚动条 / 集合分割线）
    if (configManager.getStFeatureEnhanceConfig().quickReplyOptimize) {
        initQuickReplyOptimize();
    }

    // 发送键劫持（受自身开关门控，initSendHijack 内部会做双入口 capture 监听）
    if (configManager.getSendHijackTarget()) {
        initSendHijack();
    }

    // 消息「滚动到顶部」按钮（手动版，单一开关控制）
    initMessageScrollToTop();

    // 世界书条目·聊天绑定：在原生素世界书条目上支持「绑定当前聊天」三态
    initWorldBookBinding();

    // 提示词预设条目·聊天绑定：在 PromptManager 每条提示词上支持「绑定当前聊天」三态
    initPromptBinding();

    // 提示词预设条目·扩展操作：复制 / 插入空白 / 移除（接管原生 Remove）
    initPromptEntryActions();

    // 预设·绑定当前聊天：按打开的聊天切换 ST 当前预设（未绑定聊天切回默认预设）
    initPresetBinding();

    // 智绘姬文生图工作台启动器：独立模块（与 EntryButton 解耦），不受全局 enabled 控制，
    // 仅看自身开关；此处聊天页已就绪、#leftSendForm 存在，保证刷新后自动注入
    // （幂等，自带等待重试应对智绘姬面板时序）。置于 enabled 判定之前以维持独立生命周期。
    initChatu8Launcher();

    // ── 模块核心功能（受全局 enabled 控制）──
    // 检查全局开关状态
    if (!configManager.extensionConfig.enabled) {
        infoLog("♥️ Continuity Core 已禁用");//事件监听器和宏已注册但不会处理事件
        return;
    }
    infoLog("♥️ Continuity Core 已启用");

    // 初始化入口按钮 (EntryButton 内部会根据配置决定显示方式)
    new EntryButton(extensionFolderPath).init();

    // 初始化消息 AI 生成按钮
    initMessageAiButton();
});
