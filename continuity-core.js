// 导入必要的模块
import { chat } from "../../../../script.js";
import { extension_settings, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "ST-Continuity-Core";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// 默认设置，包含全局开关
const defaultSettings = {
    enabled: true, // 全局开关默认开启
    backendUrl: "http://192.168.0.119:8888/simple-process" // 后端服务器地址
};

// 初始化扩展设置
function initializeSettings() {
    // 如果设置不存在，创建默认设置
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    return extension_settings[extensionName];
}

// 加载设置到UI
function loadSettingsToUI() {
    const settings = initializeSettings();
    // 更新开关状态
    $("#continuity_enabled").prop("checked", settings.enabled).trigger("input");
    // 更新后端URL输入框
    $("#continuity_backend_url").val(settings.backendUrl).trigger("input");

    // 根据设置启用或禁用扩展UI
    updateExtensionUIState(settings.enabled);
}

// 处理全局开关变更
function onEnabledToggle(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].enabled = enabled;
    saveSettingsDebounced();

    // 更新UI状态
    updateExtensionUIState(enabled);

    toastr.info(enabled ? "Continuity Core 已启用" : "Continuity Core 已禁用");
}

// 处理后端URL变更
function onBackendUrlChange(event) {
    const url = $(event.target).val();
    extension_settings[extensionName].backendUrl = url;
    saveSettingsDebounced();
}

// 更新扩展UI状态（显示或隐藏）
function updateExtensionUIState(enabled) {
    const fabContainer = $("#continuity-fab-container");
    if (enabled) {
        fabContainer.show();
    } else {
        fabContainer.hide();
    }
}

// 发送消息到后端的函数
function sendToBackend() {
    const settings = extension_settings[extensionName];

    // 检查是否启用
    if (!settings.enabled) {
        toastr.warning("Continuity Core 已禁用，请先启用扩展。");
        return;
    }

    // 检查聊天记录
    if (!chat || chat.length === 0) {
        toastr.warning("聊天记录为空，无法发送。");
        return;
    }

    const lastMessageContent = chat[chat.length - 1]?.mes;

    if (!lastMessageContent) {
        toastr.error("找到了聊天记录，但无法读取最后一条消息的内容。");
        return;
    }

    toastr.info(`准备发送: "${lastMessageContent.substring(0, 50)}..."`);

    fetch(settings.backendUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ last_message: lastMessageContent }),
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`后端服务器错误: ${response.status}`);
            }
            return response.json();
        })
        .then(result => {
            toastr.success(`后端返回: "${result.response}"`);
        })
        .catch(error => {
            console.error("发送到后端失败:", error);
            toastr.error(`发送失败: ${error.message}`);
        });
}

console.log("♥️ Continuity Core LOADED!");

// 当文档加载完毕后执行
jQuery(async function () {
    // 初始化设置
    const settings = initializeSettings();

    // 从外部HTML文件加载设置面板结构
    const settingsHtml = await $.get(`${extensionFolderPath}/settings-panel.html`);
    $("#extensions_settings").append(settingsHtml);

    // 1. 创建更复杂的HTML结构，并默认展开
    const fabContainer = $(`
        <div id="continuity-fab-container" class="open">
            <div class="continuity-fab-menu">
                <button id="send-to-backend-btn" class="continuity-fab-item">发送最新楼层</button>
                <button class="continuity-fab-item">功能二</button>
                <button class="continuity-fab-item">功能三</button>
            </div>
            <button id="continuity-fab-main-btn" class="continuity-fab-item">
                <span>&#43;</span>
            </button>
        </div>
    `);

    // 2. 将整个容器添加到body
    $("body").append(fabContainer);

    // 绑定设置变更事件
    $("#continuity_enabled").on("input", onEnabledToggle);
    $("#continuity_backend_url").on("input", onBackendUrlChange);

    // 加载设置到UI (必须在UI元素创建后调用)
    loadSettingsToUI();

    // 3. 为主按钮绑定点击事件，用于展开/收起菜单
    $("#continuity-fab-main-btn").on('click', function () {
        $("#continuity-fab-container").toggleClass('open');
    });

    // 4. 为"发送最新楼层"按钮绑定功能
    $("#send-to-backend-btn").on('click', sendToBackend);
});