// UI管理模块 - 基础UI功能
import { 
    extensionFolderPath, 
    loadSettingsToUI, 
    onEnabledToggle, 
    onBackendUrlChange, 
    onDebugLogsToggle,
    sendToBackend,
    saveModuleConfig, 
    loadModuleConfig, 
    renderModulesFromConfig, 
    setBindModuleEvents, 
    setOnRenderComplete,
    addModule, 
    bindModuleEvents, 
    updateModuleOrderNumbers,
    debugLog, 
    errorLog,
    initJsonImportExport, 
    bindSaveButtonEvent, 
    bindAddModuleButtonEvent, 
    rebindAllModulesEvents, 
    updateAllModulesPreview 
} from "../index.js";

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
        $("#continuity_debug_logs").on("input", onDebugLogsToggle);

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

            // 设置bindModuleEvents函数引用给moduleConfigManager
            setBindModuleEvents(bindModuleEvents);

            // 设置渲染完成回调，确保模块渲染后更新排序数字
            setOnRenderComplete(updateModuleOrderNumbers);

            // 绑定确认保存按钮事件
            bindSaveButtonEvent(function (modules) {
                // 保存配置到本地存储
                if (saveModuleConfig(modules)) {
                    toastr.success("模块配置已保存！");
                    closeModuleConfigWindow();
                } else {
                    toastr.error("保存模块配置失败");
                }
            });

            // 绑定添加模块按钮事件
            bindAddModuleButtonEvent(addModule);

            // 初始化JSON导入导出功能
            initJsonImportExport();

            // 尝试从本地存储加载配置
            const savedConfig = loadModuleConfig();
            if (savedConfig) {
                renderModulesFromConfig(savedConfig);
                // 重新绑定所有模块的事件
                rebindAllModulesEvents();
                // 更新所有模块的预览
                updateAllModulesPreview();
            } else {
                // 如果没有保存的配置，绑定现有模块的事件
                rebindAllModulesEvents();
            }
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
