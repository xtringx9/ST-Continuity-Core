// UI管理模块
import { extensionFolderPath } from "./config.js";
import { loadSettingsToUI, onEnabledToggle, onBackendUrlChange } from "./settingsManager.js";
import { sendToBackend } from "./backendService.js";

// 加载CSS文件
function loadCSS() {
    // 加载窗口样式
    const windowStyleLink = document.createElement('link');
    windowStyleLink.rel = 'stylesheet';
    windowStyleLink.href = `${extensionFolderPath}/assets/css/window-style.css`;
    document.head.appendChild(windowStyleLink);
}

/**
 * 加载设置面板
 * @returns {Promise<void>}
 */
export async function loadSettingsPanel() {
    try {
        // 加载CSS文件
        loadCSS();

        // 从外部HTML文件加载设置面板结构
        const settingsHtml = await $.get(`${extensionFolderPath}/assets/html/settings-panel.html`);
        $("#extensions_settings").append(settingsHtml);

        // 绑定设置变更事件
        $("#continuity_enabled").on("input", onEnabledToggle);
        $("#continuity_backend_url").on("input", onBackendUrlChange);

        // 加载设置到UI
        loadSettingsToUI();
    } catch (error) {
        console.error("加载设置面板失败:", error);
        toastr.error("加载设置面板失败，请刷新页面重试。");
    }
}

/**
 * 创建模态背景
 */
function createModalBackdrop() {
    const backdrop = $(`<div class="continuity-modal-backdrop" id="continuity-modal-backdrop"></div>`);
    $("body").append(backdrop);

    // 点击背景关闭窗口
    backdrop.on('click', function () {
        closeModuleConfigWindow();
    });
}

/**
 * 打开模块配置窗口
 */
export async function openModuleConfigWindow() {
    try {
        // 检查是否已创建模态背景
        if (!$("#continuity-modal-backdrop").length) {
            createModalBackdrop();
        }

        // 检查窗口是否已加载
        if (!$("#continuity-module-config-window").length) {
            // 加载窗口HTML
            const windowHtml = await $.get(`${extensionFolderPath}/assets/html/module-config-window.html`);
            $("body").append(windowHtml);

            // 绑定关闭事件
            $("#continuity-window-close").on('click', closeModuleConfigWindow);
            $("#module-cancel-btn").on('click', closeModuleConfigWindow);

            // 绑定确认按钮事件
            $("#module-save-btn").on('click', function () {
                // 获取所有模块配置
                const moduleConfigs = {
                    // 伏笔模块配置
                    seedModule: {
                        enabled: $("#seed-module-toggle").is(":checked"),
                        updateInterval: $("#seed-update-interval").val(),
                        maxCount: $("#seed-max-count").val(),
                        formatTemplate: $("#seed-format-template").val()
                    },
                    // 人物关系模块配置
                    relationshipModule: {
                        enabled: $("#relationship-module-toggle").is(":checked"),
                        trackingMode: $("#relationship-tracking-mode").val(),
                        strengthRange: $("#relationship-strength-range").val()
                    },
                    // 世界设定模块配置
                    worldModule: {
                        enabled: $("#world-module-toggle").is(":checked"),
                        autoIncludePriority: $("#world-auto-include").val(),
                        categories: $("#world-categories").val()
                    }
                };

                console.log("模块配置数据:", moduleConfigs);
                toastr.success("模块配置已保存！");
                closeModuleConfigWindow();
            });
        }

        // 显示窗口和背景
        $("#continuity-module-config-window").addClass('show');
        $("#continuity-modal-backdrop").addClass('show');
    } catch (error) {
        console.error("打开模块配置窗口失败:", error);
        toastr.error("打开窗口失败，请刷新页面重试。");
    }
}

/**
 * 关闭模块配置窗口
 */
export function closeModuleConfigWindow() {
    $("#continuity-module-config-window").removeClass('show');
    $("#continuity-modal-backdrop").removeClass('show');
    // 移除背景点击事件，避免内存泄漏
    $("#continuity-modal-backdrop").off('click');
}

/**
 * 创建FAB按钮和菜单
 */
export function createFabMenu() {
    // 创建更复杂的HTML结构，默认关闭菜单
    const fabContainer = $(`
        <div id="continuity-fab-container">
            <div class="continuity-fab-menu">
                <button id="send-to-backend-btn" class="continuity-fab-item">发送最新楼层</button>
                <button id="open-module-config-btn" class="continuity-fab-item">模块配置</button>
                <button class="continuity-fab-item">功能三</button>
            </div>
            <button id="continuity-fab-main-btn" class="continuity-fab-item">
                <span>&#43;</span>
            </button>
        </div>
    `);

    // 将整个容器添加到body
    $("body").append(fabContainer);

    // 为主按钮绑定点击事件，用于展开/收起菜单
    $("#continuity-fab-main-btn").on('click', function () {
        $("#continuity-fab-container").toggleClass('open');
    });

    // 为"发送最新楼层"按钮绑定功能
    $("#send-to-backend-btn").on('click', sendToBackend);

    // 为"模块配置"按钮绑定功能
    $("#open-module-config-btn").on('click', function () {
        // 先关闭菜单
        $("#continuity-fab-container").removeClass('open');
        // 然后打开模块配置窗口
        openModuleConfigWindow();
    });
}
