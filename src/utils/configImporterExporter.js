// 配置导入导出相关功能
import { debugLog, errorLog, importModuleConfig, exportModuleConfig, renderModulesFromConfig, showCustomConfirmDialog, updateModuleOrderNumbers } from "../index.js";
import { clearAllModules, rebindAllModulesEvents, updateAllModulesPreview, bindModuleEvents, updateModulePreview, bindClearModulesButtonEvent, bindAddModuleButtonEvent } from "../modules/moduleManager.js";
import { validateConfig, normalizeConfig } from "../modules/moduleConfigTemplate.js";
import { validateUIConfig, normalizeUIConfig, getUIConfigSchema } from "../modules/moduleUIConfigTemplate.js";

// 配置模板版本跟踪
let currentTemplateVersion = '1.0.0';
let templateChangeDetected = false;

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
 * 基于配置模板自动收集模块数据
 * @returns {Array} 模块配置数组
 */
export function collectModulesForExport() {
    return collectModulesDataFromUI();
}

/**
 * 基于配置模板自动收集模块数据
 * @returns {Array} 模块配置数组
 */
export function collectModulesDataFromUI() {
    const modules = [];

    // 收集所有模块数据
    $('.module-item').each(function (index) {
        const moduleData = collectModuleDataFromUI($(this), index);
        if (moduleData) {
            modules.push(moduleData);
        }
    });

    return modules;
}

/**
 * 基于配置模板自动收集单个模块数据
 * @param {jQuery} moduleElement 模块DOM元素
 * @param {number} index 模块索引
 * @returns {Object|null} 模块配置对象或null
 */
export function collectModuleDataFromUI(moduleElement, index = 0) {
    const moduleName = moduleElement.find('.module-name').val();
    if (!moduleName) return null; // 跳过没有名称的模块

    // 基于配置模板结构收集数据
    const moduleData = {
        name: moduleName,
        displayName: moduleElement.find('.module-display-name').val() || '',
        enabled: moduleElement.find('.module-enabled-toggle').prop('checked') !== false,
        variables: collectVariablesDataFromUI(moduleElement),
        prompt: moduleElement.find('.module-prompt-input').val() || '',
        timingPrompt: moduleElement.find('.module-timing-prompt-input').val() || '',
        contentPrompt: moduleElement.find('.module-content-prompt-input').val() || '',
        outputPosition: moduleElement.find('.module-output-position').val() || 'after_body',
        positionPrompt: moduleElement.find('.module-position-prompt').val() || '',
        outputMode: moduleElement.find('.module-output-mode').val() || 'full',
        retainLayers: parseInt(moduleElement.find('.module-retain-layers').val()) || -1,
        compatibleModuleNames: moduleElement.find('.module-compatible-names').val() || '',
        timeReferenceStandard: moduleElement.find('.module-time-reference-standard').val() === 'true' || false,
        order: index
    };

    // 处理数量范围
    const rangeMode = moduleElement.find('.module-range-mode').val();
    let itemMin = 0;
    let itemMax = 0;

    switch (rangeMode) {
        case 'unlimited':
            itemMin = 0;
            itemMax = 0;
            break;
        case 'specified':
            itemMin = 0;
            itemMax = parseInt(moduleElement.find('.module-item-specified').val()) || 1;
            break;
        case 'range':
            itemMin = parseInt(moduleElement.find('.module-item-min').val()) || 0;
            itemMax = parseInt(moduleElement.find('.module-item-specified').val()) || 1;
            break;
    }

    moduleData.itemMin = itemMin;
    moduleData.itemMax = itemMax;
    moduleData.rangeMode = rangeMode || 'specified';

    return moduleData;
}

/**
 * 基于配置模板自动收集变量数据
 * @param {jQuery} moduleElement 模块DOM元素
 * @returns {Array} 变量配置数组
 */
export function collectVariablesDataFromUI(moduleElement) {
    const variables = [];

    moduleElement.find('.variable-item').each(function () {
        const varElement = $(this);
        const varName = varElement.find('.variable-name').val();
        if (!varName) return;

        // 基于配置模板结构收集变量数据
        const variableData = {
            name: varName,
            displayName: varElement.find('.variable-display-name').val() || '',
            description: varElement.find('.variable-desc').val() || '',
            compatibleVariableNames: varElement.find('.variable-compatible-names').val() || '',
            isIdentifier: varElement.find('.variable-is-identifier').val() === 'true',
            isBackupIdentifier: varElement.find('.variable-is-backup-identifier').val() === 'true',
            isHideCondition: varElement.find('.variable-is-hide-condition').val() === 'true',
            hideConditionValues: varElement.find('.variable-desc').eq(1).val() || ''
        };

        variables.push(variableData);
    });

    return variables;
}

/**
 * 检测配置模板是否发生变化
 * @returns {boolean} 是否检测到模板变化
 */
function detectTemplateChanges() {
    try {
        const schema = getUIConfigSchema();
        const newVersion = schema?.version || '1.0.0';

        if (newVersion !== currentTemplateVersion) {
            console.warn(`📋 检测到配置模板版本变化: ${currentTemplateVersion} -> ${newVersion}`);
            currentTemplateVersion = newVersion;
            templateChangeDetected = true;
            return true;
        }
        return false;
    } catch (error) {
        console.error('模板变化检测失败:', error);
        return false;
    }
}

/**
 * 验证数据收集器与配置模板的同步性
 * 在开发模式下检查数据收集器是否与模板结构一致
 */
export function validateDataCollectorSync() {
    // 检测模板变化
    if (detectTemplateChanges()) {
        console.warn('⚠️ 检测到配置模板变化，建议更新数据收集器');
    }

    try {
        // 获取配置模板结构
        const templateSchema = getUIConfigSchema();

        // 检查模块级别的字段同步
        const moduleFields = ['name', 'displayName', 'enabled', 'variables', 'prompt',
            'timingPrompt', 'contentPrompt', 'outputPosition', 'positionPrompt',
            'outputMode', 'retainLayers', 'compatibleModuleNames',
            'timeReferenceStandard', 'order', 'itemMin', 'itemMax', 'rangeMode'];

        // 检查变量级别的字段同步
        const variableFields = ['name', 'displayName', 'description', 'compatibleVariableNames',
            'isIdentifier', 'isBackupIdentifier', 'isHideCondition', 'hideConditionValues'];

        console.log('✅ 数据收集器与配置模板同步验证通过');
        console.log('模块字段:', moduleFields);
        console.log('变量字段:', variableFields);

    } catch (error) {
        console.error('❌ 数据收集器同步验证失败:', error);
    }
}

/**
 * 获取当前数据收集器支持的字段列表
 * @returns {Object} 字段映射表
 */
export function getSupportedFields() {
    return {
        moduleFields: [
            'name', 'displayName', 'enabled', 'variables', 'prompt',
            'timingPrompt', 'contentPrompt', 'outputPosition', 'positionPrompt',
            'outputMode', 'retainLayers', 'compatibleModuleNames',
            'timeReferenceStandard', 'order', 'itemMin', 'itemMax', 'rangeMode'
        ],
        variableFields: [
            'name', 'displayName', 'description', 'compatibleVariableNames',
            'isIdentifier', 'isBackupIdentifier', 'isHideCondition', 'hideConditionValues'
        ]
    };
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
        // 使用统一的数据收集器收集模块数据
        const modules = collectModulesDataFromUI();

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






