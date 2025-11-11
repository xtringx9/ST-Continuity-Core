// UI管理模块
import { extensionFolderPath } from "./config.js";
import { loadSettingsToUI, onEnabledToggle, onBackendUrlChange } from "./settingsManager.js";
import { sendToBackend } from "./backendService.js";
import { saveModuleConfig, loadModuleConfig, exportModuleConfig, importModuleConfig, renderModulesFromConfig } from "./moduleConfigManager.js";

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

            // 添加模块功能
        function addModule() {
            const template = $('.module-template').clone();
            template.removeClass('module-template').css('display', 'block');
            $('.custom-modules-container').append(template);
            
            // 绑定事件
            bindModuleEvents(template);
            
            // 初始化预览
            updateModulePreview(template.find('.module-item'));
        }
        
        // 添加变量功能
        function addVariable(moduleItem) {
            const template = moduleItem.find('.variable-template').clone();
            template.removeClass('variable-template').css('display', 'block');
            moduleItem.find('.variables-container').append(template);
            
            // 绑定删除变量事件
            template.find('.remove-variable').on('click', function() {
                $(this).closest('.variable-item').remove();
                updateModulePreview(moduleItem);
            });
            
            // 绑定输入事件
            template.find('input').on('input', function() {
                updateModulePreview(moduleItem);
            });
            
            // 更新预览
            updateModulePreview(moduleItem);
        }
        
        // 更新模块预览
        function updateModulePreview(moduleItem) {
            const moduleName = moduleItem.find('.module-name').val() || '模块名';
            const variables = moduleItem.find('.variable-item').map(function() {
                const varName = $(this).find('.variable-name').val() || '变量名';
                return varName + ':值';
            }).get();
            
            const previewText = variables.length > 0 
                ? `[${moduleName}|${variables.join('|')}]` 
                : `[${moduleName}]`;
                
            moduleItem.find('.module-preview-text').val(previewText);
        }
        
        // 绑定模块相关事件
        function bindModuleEvents(moduleElement) {
            const moduleItem = moduleElement.find('.module-item');
            
            // 模块名称输入事件
            moduleItem.find('.module-name').on('input', function() {
                updateModulePreview(moduleItem);
            });
            
            // 添加变量按钮事件
            moduleItem.find('.add-variable').on('click', function() {
                addVariable(moduleItem);
            });
            
            // 删除模块按钮事件
            moduleItem.find('.remove-module').on('click', function() {
                if (confirm('确定要删除这个模块吗？')) {
                    moduleElement.remove();
                }
            });
            
            // 已有的变量事件绑定
            moduleItem.find('.variable-item').each(function() {
                const variableItem = $(this);
                
                // 变量输入事件
                variableItem.find('input').on('input', function() {
                    updateModulePreview(moduleItem);
                });
                
                // 删除变量事件
                variableItem.find('.remove-variable').on('click', function() {
                    variableItem.remove();
                    updateModulePreview(moduleItem);
                });
            });
        }
        
        // 初始化JSON导入功能
        function initJsonImportExport() {
            // 创建隐藏的文件输入框
            let importInput = $('#json-import-input');
            if (!importInput.length) {
                importInput = $(`<input type="file" id="json-import-input" accept=".json" style="display: none;">`);
                $('body').append(importInput);
            }
            
            // 导入按钮事件
            $('#import-config-btn').on('click', function() {
                importInput.click();
            });
            
            // 文件选择事件
            importInput.on('change', async function(event) {
                // 使用event.target并断言为HTMLInputElement
                const target = event.target;
                if (target instanceof HTMLInputElement && target.files && target.files[0]) {
                    const config = await importModuleConfig(target.files[0]);
                    if (config) {
                        renderModulesFromConfig(config);
                        // 重新绑定所有模块的事件（选择模块容器而不是.module-item）
                        $('.custom-modules-container > div:not(.module-template)').each(function() {
                            bindModuleEvents($(this));
                        });
                        toastr.success('模块配置导入成功！');
                    }
                    // 清空文件输入，允许重复选择同一文件
                    target.value = '';
                }
            });
            
            // 导出按钮事件
            $('#export-config-btn').on('click', function() {
                const modules = [];
                
                // 收集所有模块数据
                $('.module-item').each(function() {
                    const moduleName = $(this).find('.module-name').val();
                    if (!moduleName) return; // 跳过没有名称的模块
                    
                    const variables = [];
                    $(this).find('.variable-item').each(function() {
                        const varName = $(this).find('.variable-name').val();
                        const varDesc = $(this).find('.variable-desc').val();
                        
                        if (varName) {
                            variables.push({
                                name: varName,
                                description: varDesc
                            });
                        }
                    });
                    
                    // 获取模块提示词
                    const modulePrompt = $(this).find('.module-prompt-input').val();
                    
                    modules.push({
                        name: moduleName,
                        variables: variables,
                        prompt: modulePrompt || ''
                    });
                });
                
                if (modules.length === 0) {
                    toastr.warning('没有可导出的模块配置');
                    return;
                }
                
                exportModuleConfig(modules);
                toastr.success('模块配置已导出');
            });
        }
        
        // 绑定确认按钮事件
        $("#module-save-btn").on('click', function () {
            const modules = [];
            
            // 收集所有模块数据
            $('.module-item').each(function() {
                const moduleName = $(this).find('.module-name').val();
                if (!moduleName) return; // 跳过没有名称的模块
                
                const variables = [];
                $(this).find('.variable-item').each(function() {
                    const varName = $(this).find('.variable-name').val();
                    const varDesc = $(this).find('.variable-desc').val();
                    
                    if (varName) {
                        variables.push({
                            name: varName,
                            description: varDesc
                        });
                    }
                });
                
                // 获取模块提示词
                const modulePrompt = $(this).find('.module-prompt-input').val();
                
                modules.push({
                    name: moduleName,
                    variables: variables,
                    prompt: modulePrompt || ''
                });
            });
            
            // 保存配置到本地存储
            if (saveModuleConfig(modules)) {
                toastr.success("模块配置已保存！");
                closeModuleConfigWindow();
            } else {
                toastr.error("保存模块配置失败");
            }
        });
        
        // 添加模块按钮事件
        $('#add-module-btn').on('click', addModule);
        
        // 检查是否有模块项，如果有则绑定事件
        const firstModule = $('.module-item').first();
        if (firstModule.length > 0) {
            bindModuleEvents(firstModule.parent());
        }
        
        // 初始化JSON导入导出功能
        initJsonImportExport();
        
        // 尝试从本地存储加载配置
        const savedConfig = loadModuleConfig();
        if (savedConfig) {
            renderModulesFromConfig(savedConfig);
            // 重新绑定所有模块的事件
            $('.module-item').each(function() {
                bindModuleEvents($(this).parent());
                updateModulePreview($(this));
            });
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
