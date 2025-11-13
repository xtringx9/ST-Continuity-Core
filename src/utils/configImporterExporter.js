// 配置导入导出相关功能
import { debugLog, importModuleConfig, exportModuleConfig, renderModulesFromConfig, bindModuleEvents, updateModulePreview } from "../index.js";

/**
 * 初始化JSON导入导出功能
 */
export function initJsonImportExport() {
    // 创建隐藏的文件输入框
    let importInput = $('#json-import-input');
    if (!importInput.length) {
        importInput = $(`<input type="file" id="json-import-input" accept=".json" style="display: none;">`);
        $('body').append(importInput);
    }

    // 导入按钮事件
    $('#import-config-btn').on('click', function () {
        importInput.click();
    });

    // 文件选择事件
    importInput.on('change', async function (event) {
        // 使用event.target并断言为HTMLInputElement
        const target = event.target;
        if (target instanceof HTMLInputElement && target.files && target.files[0]) {
            const config = await importModuleConfig(target.files[0]);
            if (config) {
                renderModulesFromConfig(config);
                // 使用专门的函数重新绑定所有模块事件并更新预览
                rebindAllModulesEvents();
                updateAllModulesPreview();
                toastr.success('模块配置导入成功！');
            }
            // 清空文件输入，允许重复选择同一文件
            target.value = '';
        }
    });

    // 导出按钮事件
    $('#export-config-btn').on('click', function () {
        const modules = collectModulesForExport();

        if (modules.length === 0) {
            toastr.warning('没有可导出的模块配置');
            return;
        }

        exportModuleConfig(modules);
        toastr.success('模块配置已导出');
    });
}

/**
 * 收集模块数据用于导出
 * @returns {Array} 模块配置数组
 */
export function collectModulesForExport() {
    const modules = [];

    // 收集所有模块数据
    $('.module-item').each(function () {
        const moduleName = $(this).find('.module-name').val();
        if (!moduleName) return; // 跳过没有名称的模块

        // 获取模块启用状态（默认为true）
        const isEnabled = $(this).find('.module-enabled-toggle').prop('checked') !== false;
        
        // 获取模块提示词（生成提示词）
        const modulePrompt = $(this).find('.module-prompt-input').val();
        
        // 获取模块使用提示词（内容提示词）
        const contentPrompt = $(this).find('.module-content-prompt-input').val();
        
        // 获取模块生成位置
        const outputPosition = $(this).find('.module-output-position').val();
        
        // 获取模块数量限制
        const itemLimit = parseInt($(this).find('.module-item-limit').val()) || -1;

        const variables = [];
        $(this).find('.variable-item').each(function () {
            const varName = $(this).find('.variable-name').val();
            const varDesc = $(this).find('.variable-desc').val();

            if (varName) {
                variables.push({
                    name: varName,
                    description: varDesc
                });
            }
        });

        modules.push({
            name: moduleName,
            enabled: isEnabled,
            variables: variables,
            prompt: modulePrompt || '',
            contentPrompt: contentPrompt || '',
            outputPosition: outputPosition || 'after_body',
            itemLimit: itemLimit
        });
    });

    return modules;
}

/**
 * 绑定确认保存按钮事件
 * @param {Function} onSaveSuccess 保存成功回调
 * @param {Function} onSaveError 保存失败回调
 */
export function bindSaveButtonEvent(onSaveSuccess, onSaveError) {
    // 移除现有的事件监听，避免重复绑定
    $("#module-save-btn").off('click');

    $("#module-save-btn").on('click', function () {
        const modules = [];

        // 收集所有模块数据
        $('.module-item').each(function (index) {
            const moduleName = $(this).find('.module-name').val();
            if (!moduleName) return; // 跳过没有名称的模块

            // 获取模块启用状态（默认为true）
            const isEnabled = $(this).find('.module-enabled-toggle').prop('checked') !== false;
            
            // 获取模块提示词（生成提示词）
            const modulePrompt = $(this).find('.module-prompt-input').val();
            
            // 获取模块使用提示词（内容提示词）
            const contentPrompt = $(this).find('.module-content-prompt-input').val();
            
            // 获取模块生成位置
            const outputPosition = $(this).find('.module-output-position').val();
            
            // 获取模块数量限制
            const itemLimit = parseInt($(this).find('.module-item-limit').val()) || -1;

            const variables = [];
            $(this).find('.variable-item').each(function () {
                const varName = $(this).find('.variable-name').val();
                const varDesc = $(this).find('.variable-desc').val();

                if (varName) {
                    variables.push({
                        name: varName,
                        description: varDesc
                    });
                }
            });

            modules.push({
                name: moduleName,
                enabled: isEnabled,
                variables: variables,
                prompt: modulePrompt || '',
                contentPrompt: contentPrompt || '',
                outputPosition: outputPosition || 'after_body',
                itemLimit: itemLimit,
                order: index // 添加排序索引
            });
        });

        // 调用回调函数
        if (typeof onSaveSuccess === 'function') {
            onSaveSuccess(modules);
        }
    });
}

/**
 * 绑定添加模块按钮事件
 * @param {Function} addModuleCallback 添加模块的回调函数
 */
export function bindAddModuleButtonEvent(addModuleCallback) {
    $('#add-module-btn').off('click');
    $('#add-module-btn').on('click', addModuleCallback);
}

/**
 * 重新绑定所有模块的事件
 */
export function rebindAllModulesEvents() {
    // 选择模块容器而不是.module-item以确保正确绑定
    $('.custom-modules-container > div:not(.module-template)').each(function () {
        bindModuleEvents($(this));
    });
}

/**
 * 更新所有模块的预览
 */
export function updateAllModulesPreview() {
    $('.module-item').each(function () {
        updateModulePreview($(this));
    });
}
