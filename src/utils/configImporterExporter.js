// 配置导入导出相关功能
import { debugLog, errorLog, importModuleConfig, exportModuleConfig, renderModulesFromConfig, showCustomConfirmDialog, updateModuleOrderNumbers } from "../index.js";
import { clearAllModules, rebindAllModulesEvents, updateAllModulesPreview, bindModuleEvents, updateModulePreview, bindClearModulesButtonEvent, bindAddModuleButtonEvent } from "../modules/moduleManager.js";
import { validateConfig, normalizeConfig } from "../modules/moduleConfigTemplate.js";

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
            const config = await importModuleConfigWithValidation(target.files[0]);
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

    // 清空模块按钮事件 - 使用moduleManager.js中的clearAllModules函数
    bindClearModulesButtonEvent(function () {
        clearAllModules();
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
        const moduleDisplayName = $(this).find('.module-display-name').val();
        if (!moduleName) return; // 跳过没有名称的模块

        // 获取模块启用状态（默认为true）
        const isEnabled = $(this).find('.module-enabled-toggle').prop('checked') !== false;

        // 获取模块提示词（生成提示词）
        const modulePrompt = $(this).find('.module-prompt-input').val();

        // 获取模块生成时机提示词
        const timingPrompt = $(this).find('.module-timing-prompt-input').val();

        // 获取模块使用提示词（内容提示词）
        const contentPrompt = $(this).find('.module-content-prompt-input').val();

        // 获取模块生成位置
        const outputPosition = $(this).find('.module-output-position').val();

        // 获取模块顺序提示词
        const positionPrompt = $(this).find('.module-position-prompt').val();

        // 获取模块输出模式
        const outputMode = $(this).find('.module-output-mode').val();

        // 获取模块数量范围（根据模式处理）
        const rangeMode = $(this).find('.module-range-mode').val();
        let itemMin = 0;
        let itemMax = 0;

        switch (rangeMode) {
            case 'unlimited':
                itemMin = 0;
                itemMax = 0; // 0表示无限制
                break;
            case 'specified':
                itemMin = 0;
                itemMax = parseInt($(this).find('.module-item-specified').val()) || 1;
                break;
            case 'range':
                itemMin = parseInt($(this).find('.module-item-min').val()) || 0;
                itemMax = parseInt($(this).find('.module-item-specified').val()) || 1;
                break;
        }

        const variables = [];
        $(this).find('.variable-item').each(function () {
            const varName = $(this).find('.variable-name').val();
            const varDisplayName = $(this).find('.variable-display-name').val();
            const varDesc = $(this).find('.variable-desc').val();
            // 获取变量类型标识
            const varIsIdentifier = $(this).find('.variable-is-identifier').val() === 'true';
            const varIsBackupIdentifier = $(this).find('.variable-is-backup-identifier').val() === 'true';
            const varIsHideCondition = $(this).find('.variable-is-hide-condition').val() === 'true';
            const varHideConditionValues = $(this).find('.variable-desc').eq(1).val() || '';

            if (varName) {
                variables.push({
                    name: varName,
                    displayName: varDisplayName || '',
                    description: varDesc || '',
                    compatibleVariableNames: $(this).find('.variable-compatible-names').val() || '', // 添加兼容变量名字段
                    isIdentifier: varIsIdentifier,
                    isBackupIdentifier: varIsBackupIdentifier,
                    isHideCondition: varIsHideCondition,
                    hideConditionValues: varHideConditionValues
                });
            }
        });

        // 获取模块保留层数
        const retainLayers = parseInt($(this).find('.module-retain-layers').val()) || -1;

        // 获取时间参考标准状态
        const timeReferenceStandard = $(this).find('.module-time-reference-standard').val() === 'true' || false;

        modules.push({
            name: moduleName,
            displayName: moduleDisplayName || '',
            enabled: isEnabled,
            variables: variables,
            prompt: modulePrompt || '',
            timingPrompt: timingPrompt || '', // 添加生成时机提示词字段
            contentPrompt: contentPrompt || '',
            outputPosition: outputPosition || 'after_body',
            positionPrompt: positionPrompt || '', // 添加顺序提示词字段
            outputMode: outputMode || 'full', // 添加输出模式字段，默认值为full（全量输出）
            retainLayers: retainLayers, // 添加保留层数字段
            itemMin: itemMin,
            itemMax: itemMax,
            rangeMode: rangeMode || 'specified', // 添加rangeMode字段，默认值为specified
            compatibleModuleNames: $(this).find('.module-compatible-names').val() || '', // 添加兼容模块名字段
            timeReferenceStandard: timeReferenceStandard // 添加时间参考标准字段，默认为false
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
            const moduleDisplayName = $(this).find('.module-display-name').val();
            if (!moduleName) return; // 跳过没有名称的模块

            // 获取模块启用状态（默认为true）
            const isEnabled = $(this).find('.module-enabled-toggle').prop('checked') !== false;

            // 获取模块提示词（生成提示词）
            const modulePrompt = $(this).find('.module-prompt-input').val();

            // 获取模块生成时机提示词
            const timingPrompt = $(this).find('.module-timing-prompt-input').val();

            // 获取模块使用提示词（内容提示词）
            const contentPrompt = $(this).find('.module-content-prompt-input').val();

            // 获取模块生成位置
            const outputPosition = $(this).find('.module-output-position').val();

            // 获取模块顺序提示词
            const positionPrompt = $(this).find('.module-position-prompt').val();

            // 获取模块输出模式
            const outputMode = $(this).find('.module-output-mode').val();

            // 获取模块数量范围（根据模式处理）
            const rangeMode = $(this).find('.module-range-mode').val();
            let itemMin = 0;
            let itemMax = 0;

            switch (rangeMode) {
                case 'unlimited':
                    itemMin = 0;
                    itemMax = 0; // 0表示无限制
                    break;
                case 'specified':
                    itemMin = 0;
                    itemMax = parseInt($(this).find('.module-item-specified').val()) || 1;
                    break;
                case 'range':
                    itemMin = parseInt($(this).find('.module-item-min').val()) || 0;
                    itemMax = parseInt($(this).find('.module-item-specified').val()) || 1;
                    break;
            }

            const variables = [];
            $(this).find('.variable-item').each(function () {
                const varName = $(this).find('.variable-name').val();
                const varDisplayName = $(this).find('.variable-display-name').val();
                const varDesc = $(this).find('.variable-desc').eq(0).val();
                const varIsIdentifier = $(this).find('.variable-is-identifier').val() === 'true';
                const varIsBackupIdentifier = $(this).find('.variable-is-backup-identifier').val() === 'true';
                const varIsHideCondition = $(this).find('.variable-is-hide-condition').val() === 'true';
                const varHideConditionValues = $(this).find('.variable-desc').eq(1).val();

                if (varName) {
                    variables.push({
                        name: varName,
                        displayName: varDisplayName || '',
                        description: varDesc || '',
                        compatibleVariableNames: $(this).find('.variable-compatible-names').val() || '', // 添加兼容变量名字段
                        isIdentifier: varIsIdentifier,
                        isBackupIdentifier: varIsBackupIdentifier,
                        isHideCondition: varIsHideCondition,
                        hideConditionValues: varHideConditionValues || ''
                    });
                }
            });

            // 获取模块保留层数
            const retainLayers = parseInt($(this).find('.module-retain-layers').val()) || -1;

            // 获取时间参考标准状态
            const timeReferenceStandard = $(this).find('.module-time-reference-standard').val() === 'true' || false;

            modules.push({
                name: moduleName,
                displayName: moduleDisplayName || '',
                enabled: isEnabled,
                variables: variables,
                prompt: modulePrompt || '',
                timingPrompt: timingPrompt || '', // 添加生成时机提示词字段
                contentPrompt: contentPrompt || '',
                outputPosition: outputPosition || 'body',
                positionPrompt: positionPrompt || '', // 添加顺序提示词字段
                outputMode: outputMode || 'full', // 添加输出模式字段，默认值为full（全量输出）
                retainLayers: retainLayers, // 添加保留层数字段
                itemMin: itemMin,
                itemMax: itemMax,
                rangeMode: rangeMode || 'specified', // 添加rangeMode字段，默认值为specified
                compatibleModuleNames: $(this).find('.module-compatible-names').val() || '', // 添加兼容模块名字段
                timeReferenceStandard: timeReferenceStandard, // 添加时间参考标准字段，默认为false
                order: index // 添加排序索引
            });
        });

        // 收集全局设置数据
        const globalSettings = {
            corePrinciples: $('#core-principles-input').val() || '',
            formatDescription: $('#format-description-input').val() || ''
        };

        // 调用回调函数，传递modules和globalSettings
        if (typeof onSaveSuccess === 'function') {
            onSaveSuccess(modules, globalSettings);
        }
    });
}

/**
 * 导入模块配置并进行验证
 * @param {File} file 选择的JSON文件
 * @returns {Promise<Object|null>} 验证并规范化后的配置对象或null
 */
export function importModuleConfigWithValidation(file) {
    return new Promise((resolve) => {
        if (!file) {
            resolve(null);
            return;
        }

        if (file.type && file.type !== 'application/json') {
            errorLog('文件类型错误，需要JSON文件');
            toastr.error('文件类型错误，请选择JSON文件');
            resolve(null);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const result = e.target.result;
                if (typeof result !== 'string') {
                    throw new Error('文件内容不是文本格式');
                }
                const config = JSON.parse(result);
                
                // 验证配置是否符合模板规范
                const validation = validateConfig(config);
                
                if (!validation.isValid) {
                    // 显示验证错误
                    const errorMessage = `配置验证失败:\n${validation.errors.join('\n')}`;
                    if (validation.warnings.length > 0) {
                        errorMessage += `\n警告:\n${validation.warnings.join('\n')}`;
                    }
                    
                    errorLog('配置验证失败:', validation.errors);
                    toastr.error('配置验证失败，请检查文件格式');
                    
                    // 显示详细错误信息
                    if (validation.errors.length > 0) {
                        showCustomConfirmDialog(
                            '配置验证失败',
                            `配置验证失败，发现以下错误：<br><br>${validation.errors.join('<br>')}<br><br>是否继续导入？`,
                            () => {
                                // 用户选择继续导入，进行规范化处理
                                const normalizedConfig = normalizeConfig(config);
                                resolve(normalizedConfig);
                            },
                            () => {
                                // 用户选择取消导入
                                resolve(null);
                            }
                        );
                        return;
                    }
                }
                
                // 如果有警告但无错误，显示警告信息
                if (validation.warnings.length > 0) {
                    showCustomConfirmDialog(
                        '配置验证警告',
                        `配置验证通过，但有以下警告：<br><br>${validation.warnings.join('<br>')}<br><br>是否继续导入？`,
                        () => {
                            // 用户选择继续导入，进行规范化处理
                            const normalizedConfig = normalizeConfig(config);
                            resolve(normalizedConfig);
                        },
                        () => {
                            // 用户选择取消导入
                            resolve(null);
                        }
                    );
                    return;
                }
                
                // 验证通过，进行规范化处理
                const normalizedConfig = normalizeConfig(config);
                debugLog('配置验证通过，已规范化:', normalizedConfig);
                resolve(normalizedConfig);
                
            } catch (error) {
                errorLog('解析JSON文件失败:', error);
                toastr.error('解析JSON文件失败，请检查文件格式');
                resolve(null);
            }
        };
        reader.onerror = () => {
            errorLog('读取文件失败');
            toastr.error('读取文件失败');
            resolve(null);
        };
        reader.readAsText(file);
    });
}






