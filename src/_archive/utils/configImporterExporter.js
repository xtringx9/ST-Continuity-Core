// 配置导入导出相关功能
import { infoLog, debugLog, errorLog, renderModulesFromConfig, showCustomConfirmDialog, updateModuleOrderNumbers } from "../../index.js";
import { clearAllModules, rebindAllModulesEvents, updateAllModulesPreview, bindModuleEvents, updateModulePreview, bindClearModulesButtonEvent, bindAddModuleButtonEvent } from "../modules/moduleManager.js";
import { MODULE_CONFIG_TEMPLATE, validateConfig, normalizeConfig, CONFIG_CONSTANTS } from "../../modules/moduleConfigTemplate.js";
import { default as configManager, CONTINUITY_CORE_IDENTIFIER, extensionName } from "../../singleton/configManager.js";
import { checkAndInitializeWorldBook } from "../../utils/worldBookUtils.js";
import { registerContinuityRegexPattern } from "../../utils/regexUtils.js";
import { updateMacroOptionsFromConfig } from "../modules/promptPreviewManager.js";

/**
 * 处理导入配置的逻辑
 * @param {Object} config 原始配置
 * @returns {Promise<Object>} 包含导入选项的配置
 */
async function processImportConfig(config, file) {
    // 根据导入的配置内容决定是否显示导入选项
    // 使用原始配置判断，避免normalizeConfig补全空值
    const hasModules = config.modules !== undefined &&
        Array.isArray(config.modules) &&
        config.modules.length > 0;

    if (hasModules) {
        // 有模块数据，显示导入选项弹窗
        const configWithOptions = await showImportOptionsDialog(file, config);
        return configWithOptions;
    } else {
        // 没有模块数据，直接返回配置
        const configWithOptions = {
            ...config,
            importOptions: {
                overrideEnabled: false
            }
        };
        debugLog('导入的配置没有模块数据，跳过导入选项弹窗');
        return configWithOptions;
    }
}

// 配置模板版本跟踪
// let currentTemplateVersion = '1.0.0';
// let templateChangeDetected = false;

// /**
//  * 合并导入配置的启用状态到现有配置
//  * @param {Object} importConfig 导入的配置
//  * @returns {Object} 合并后的配置
//  */
// function mergeEnabledStates(importConfig) {
//     if (!importConfig || !importConfig.modules) return importConfig;

//     // 获取现有配置
//     const currentConfig = configManager.getModuleConfig();
//     if (!currentConfig || !currentConfig.modules) return importConfig;

//     // 创建模块名称到现有模块的映射
//     const currentModuleMap = new Map();
//     currentConfig.modules.forEach(module => {
//         if (module.name) {
//             currentModuleMap.set(module.name, module);
//         }
//     });

//     // 复制导入配置
//     const mergedConfig = JSON.parse(JSON.stringify(importConfig));

//     // 对导入的每个模块，如果现有配置中有同名模块，则使用现有模块的启用状态
//     mergedConfig.modules.forEach(module => {
//         if (module.name && currentModuleMap.has(module.name)) {
//             const currentModule = currentModuleMap.get(module.name);

//             // 合并模块的启用状态
//             module.enabled = currentModule.enabled !== false;

//             // 合并变量的启用状态（如果存在变量）
//             if (module.variables && Array.isArray(module.variables) &&
//                 currentModule.variables && Array.isArray(currentModule.variables)) {

//                 // 创建变量名称到现有变量的映射
//                 const currentVariableMap = new Map();
//                 currentModule.variables.forEach(variable => {
//                     if (variable.name) {
//                         currentVariableMap.set(variable.name, variable);
//                     }
//                 });

//                 // 合并每个变量的启用状态
//                 module.variables.forEach(variable => {
//                     if (variable.name && currentVariableMap.has(variable.name)) {
//                         const currentVariable = currentVariableMap.get(variable.name);
//                         variable.enabled = currentVariable.enabled !== false;
//                     }
//                 });
//             }
//         }
//     });

//     return mergedConfig;
// }

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
            const configWithOptions = await importModuleConfig(target.files[0]);
            if (configWithOptions) {
                // 根据导入选项处理配置合并
                const finalConfig = configManager.processImportConfig(configWithOptions);
                if (finalConfig) {
                    renderModulesFromConfig(finalConfig);
                    // 使用专门的函数重新绑定所有模块事件并更新预览
                    rebindAllModulesEvents();
                    updateAllModulesPreview();
                    configManager.autoSave();
                    toastr.success('模块配置导入成功！');
                }
            }
            // 清空文件输入，允许重复选择同一文件
            target.value = '';
        }
    });

    // 导出按钮事件
    $('#export-config-btn').on('click', async function () {
        // 先保存UI数据到配置
        configManager.saveFromUI(true);

        // 显示导出选项弹窗
        const exportOptions = await showExportOptionsDialog();
        if (!exportOptions) {
            // 用户取消了导出
            return;
        }

        // 使用新的导出函数
        exportModuleConfig(exportOptions);
    });

    // 清空模块按钮事件 - 使用moduleManager.js中的clearAllModules函数
    bindClearModulesButtonEvent(function () {
        clearAllModules();
    });
}

// /**
//  * 基于配置模板自动收集模块数据
//  * @returns {Array} 模块配置数组
//  */
// export function collectModulesForExport() {
//     return collectModulesDataFromUI();
// }

// /**
//  * 基于配置模板自动收集模块数据
//  * @returns {Array} 模块配置数组
//  */
// export function collectModulesDataFromUI() {
//     const modules = [];

//     // 收集所有模块数据
//     $('.module-item').each(function (index) {
//         const moduleData = collectModuleDataFromUI($(this), index);
//         if (moduleData) {
//             modules.push(moduleData);
//         }
//     });

//     return modules;
// }

// /**
//  * 基于配置模板自动收集单个模块数据
//  * @param {jQuery} moduleElement 模块DOM元素
//  * @param {number} index 模块索引
//  * @returns {Object|null} 模块配置对象或null
//  */
// export function collectModuleDataFromUI(moduleElement, index = 0) {
//     const moduleName = moduleElement.find('.module-name').val();
//     if (!moduleName) return null; // 跳过没有名称的模块

//     // 基于配置模板结构收集数据
//     const moduleData = {
//         name: moduleName,
//         displayName: moduleElement.find('.module-display-name').val() || '',
//         order: index,
//         enabled: moduleElement.find('.module-enabled-toggle').prop('checked') !== false,
//         prompt: moduleElement.find('.module-prompt-input').val() || '',
//         timingPrompt: moduleElement.find('.module-timing-prompt-input').val() || '',
//         contentPrompt: moduleElement.find('.module-content-prompt-input').val() || '',
//         outputPosition: moduleElement.find('.module-output-position').val() || 'after_body',
//         positionPrompt: moduleElement.find('.module-position-prompt').val() || '',
//         outputMode: moduleElement.find('.module-output-mode').val() || 'full',
//         retainLayers: !isNaN(parseInt(moduleElement.find('.module-retain-layers').val())) ? parseInt(moduleElement.find('.module-retain-layers').val()) : -1,
//         compatibleModuleNames: moduleElement.find('.module-compatible-names').val() || '',
//         timeReferenceStandard: moduleElement.find('.module-time-reference-standard').val() === 'true' || false,
//         containerStyles: moduleElement.find('.module-container-styles').val() || '',
//         customStyles: moduleElement.find('.module-custom-styles').val() || '',
//         variables: collectVariablesDataFromUI(moduleElement)
//     };

//     // 处理数量范围
//     const rangeMode = moduleElement.find('.module-range-mode').val();
//     let itemMin = 0;
//     let itemMax = 0;

//     switch (rangeMode) {
//         case 'unlimited':
//             itemMin = 0;
//             itemMax = 0;
//             break;
//         case 'specified':
//             itemMin = 0;
//             itemMax = parseInt(moduleElement.find('.module-item-specified').val()) || 1;
//             break;
//         case 'range':
//             itemMin = parseInt(moduleElement.find('.module-item-min').val()) || 0;
//             itemMax = parseInt(moduleElement.find('.module-item-specified').val()) || 1;
//             break;
//     }

//     moduleData.itemMin = itemMin;
//     moduleData.itemMax = itemMax;
//     moduleData.rangeMode = rangeMode || 'specified';

//     return moduleData;
// }

// /**
//  * 基于配置模板自动收集变量数据
//  * @param {jQuery} moduleElement 模块DOM元素
//  * @returns {Array} 变量配置数组
//  */
// export function collectVariablesDataFromUI(moduleElement) {
//     const variables = [];

//     moduleElement.find('.variable-item').each(function () {
//         const varElement = $(this);
//         const varName = varElement.find('.variable-name').val();
//         if (!varName) return;

//         // 基于配置模板结构收集变量数据
//         const variableData = {
//             name: varName,
//             displayName: varElement.find('.variable-display-name').val() || '',
//             description: varElement.find('.variable-desc').val() || '',
//             compatibleVariableNames: varElement.find('.variable-compatible-names').val() || '',
//             isIdentifier: varElement.find('.variable-is-identifier').val() === 'true',
//             isBackupIdentifier: varElement.find('.variable-is-backup-identifier').val() === 'true',
//             isHideCondition: varElement.find('.variable-is-hide-condition').val() === 'true',
//             hideConditionValues: varElement.find('.variable-desc').eq(1).val() || '',
//             customStyles: varElement.find('.variable-custom-styles').val() || ''
//         };

//         variables.push(variableData);
//     });

//     return variables;
// }

// /**
//  * 检测配置模板是否发生变化
//  * @returns {boolean} 是否检测到模板变化
//  */
// function detectTemplateChanges() {
//     try {
//         const schema = MODULE_CONFIG_TEMPLATE;
//         const newVersion = schema?.version || '1.0.0';

//         if (newVersion !== currentTemplateVersion) {
//             console.warn(`📋 检测到配置模板版本变化: ${currentTemplateVersion} -> ${newVersion}`);
//             currentTemplateVersion = newVersion;
//             templateChangeDetected = true;
//             return true;
//         }
//         return false;
//     } catch (error) {
//         console.error('模板变化检测失败:', error);
//         return false;
//     }
// }

// /**
//  * 验证数据收集器与配置模板的同步性
//  * 在开发模式下检查数据收集器是否与模板结构一致
//  */
// export function validateDataCollectorSync() {
//     // 检测模板变化
//     if (detectTemplateChanges()) {
//         console.warn('⚠️ 检测到配置模板变化，建议更新数据收集器');
//     }

//     try {
//         // 获取配置模板结构
//         // const templateSchema = getUIConfigSchema();

//         // 检查模块级别的字段同步
//         const moduleFields = ['name', 'displayName', 'enabled', 'variables', 'prompt',
//             'timingPrompt', 'contentPrompt', 'outputPosition', 'positionPrompt',
//             'outputMode', 'retainLayers', 'compatibleModuleNames',
//             'timeReferenceStandard', 'order', 'itemMin', 'itemMax', 'rangeMode',
//             'containerStyles', 'customStyles'];

//         // 检查变量级别的字段同步
//         const variableFields = ['name', 'displayName', 'description', 'compatibleVariableNames',
//             'isIdentifier', 'isBackupIdentifier', 'isHideCondition', 'hideConditionValues'];

//         console.log('✅ 数据收集器与配置模板同步验证通过');
//         console.log('模块字段:', moduleFields);
//         console.log('变量字段:', variableFields);

//     } catch (error) {
//         console.error('❌ 数据收集器同步验证失败:', error);
//     }
// }

// /**
//  * 获取当前数据收集器支持的字段列表
//  * @returns {Object} 字段映射表
//  */
// export function getSupportedFields() {
//     return {
//         moduleFields: [
//             'name', 'displayName', 'enabled', 'variables', 'prompt',
//             'timingPrompt', 'contentPrompt', 'outputPosition', 'positionPrompt',
//             'outputMode', 'retainLayers', 'compatibleModuleNames',
//             'timeReferenceStandard', 'order', 'itemMin', 'itemMax', 'rangeMode',
//             'containerStyles', 'customStyles'
//         ],
//         variableFields: [
//             'name', 'displayName', 'description', 'compatibleVariableNames',
//             'isIdentifier', 'isBackupIdentifier', 'isHideCondition', 'hideConditionValues'
//         ]
//     };
// }

/**
 * 绑定确认保存按钮事件
 */
export function bindSaveButtonEvent() {
    // 移除现有的事件监听，避免重复绑定
    $("#module-save-btn").off('click');

    $("#module-save-btn").on('click', async function () {
        try {
            const contentRemainLayers = configManager.getGlobalSettings().contentRemainLayers;
            const moduleTag = configManager.getGlobalSettings().moduleTag;
            const moduleUpdateTag = configManager.getGlobalSettings().moduleUpdateTag;
            // 使用统一的配置管理器进行保存
            const success = configManager.saveFromUI(true); // true表示立即保存
            // 根据保存结果显示提示信息
            if (success) {
                toastr.success('模块配置已保存！');
                const newContentRemainLayers = configManager.getGlobalSettings().contentRemainLayers;
                const newModuleTag = configManager.getGlobalSettings().moduleTag;
                const newModuleUpdateTag = configManager.getGlobalSettings().moduleUpdateTag;
                if (contentRemainLayers !== newContentRemainLayers) {
                    // 调用createConfigEntry方法
                    try {
                        await checkAndInitializeWorldBook();
                    } catch (error) {
                        errorLog('调用createConfigEntry失败:', error);
                    }
                    // 调用更新宏选项列表方法
                    try {
                        updateMacroOptionsFromConfig();
                    } catch (error) {
                        errorLog('调用updateMacroOptionsFromConfig失败:', error);
                    }
                }
                if (contentRemainLayers !== newContentRemainLayers || moduleTag !== newModuleTag || moduleUpdateTag !== newModuleUpdateTag) {
                    // 调用registerConfigRegexPatterns方法
                    try {
                        registerContinuityRegexPattern();
                    } catch (error) {
                        errorLog('调用registerConfigRegexPatterns失败:', error);
                    }
                }
            } else {
                toastr.error('保存模块配置失败');
            }

        } catch (error) {
            errorLog('保存按钮事件处理失败:', error);
            toastr.error('保存模块配置失败');
        }
    });
}

/**
 * 显示导入选项弹窗
 * @param {File} file 选择的JSON文件
 * @param {Object} config 解析后的配置对象
 * @returns {Promise<Object|null>} 包含导入选项的配置对象或null
 */
export function showImportOptionsDialog(file, config) {
    return new Promise((resolve) => {
        // 获取导入配置中的所有模块
        const importModules = config.modules || [];

        // 判断导入配置中是否有设置配置和模块配置
        const hasSettings = config.globalSettings !== undefined &&
            config.globalSettings !== null &&
            Object.keys(config.globalSettings).length > 0;
        const hasModuleConfig = importModules.length > 0;

        // 创建导入选项弹窗HTML
        const importOptionsDialog = $(`
            <div id="continuity-import-options-dialog" class="continuity-confirm-dialog">
                <div class="confirm-dialog-content">
                    <h3 class="confirm-dialog-title">导入选项</h3>
                    ${(config.metadata && (config.metadata.author || config.metadata.authorConfigVersion || config.metadata.version)) ? `
                    <div class="config-info-panel" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 8px 12px; margin: 0 0 12px 0;">
                        ${config.metadata && config.metadata.author ? `<div style="display: flex; align-items: center; margin-bottom: 4px;"><span style="color: rgba(255, 255, 255, 0.7); font-size: 0.9em; margin-right: 8px;">配置作者：</span><span style="color: rgba(255, 255, 255, 0.9); font-size: 0.9em; font-weight: 500;">${config.metadata.author}</span></div>` : ''}
                        ${(config.metadata && (config.metadata.authorConfigVersion || config.metadata.version)) ? `<div style="display: flex; align-items: center; justify-content: space-between;">
                            ${config.metadata && config.metadata.authorConfigVersion ? `<div style="display: flex; align-items: center;"><span style="color: rgba(255, 255, 255, 0.7); font-size: 0.9em; margin-right: 8px;">配置版本：</span><span style="color: rgba(255, 255, 255, 0.9); font-size: 0.9em; font-weight: 500;">${config.metadata.authorConfigVersion}</span></div>` : '<div></div>'}
                            ${config.metadata && config.metadata.version ? `<div style="display: flex; align-items: center;"><span style="color: rgba(255, 255, 255, 0.5); font-size: 0.8em; margin-right: 8px;">插件配置版本：</span><span style="color: rgba(255, 255, 255, 0.5); font-size: 0.8em;">${config.metadata.version}</span></div>` : ''}
                        </div>` : ''}
                    </div>
                    ` : ''}
                    <div class="confirm-dialog-message">
                        <p>请选择导入内容：</p>
                        ${hasSettings || hasModuleConfig ? `
                        <div class="import-options-group">
                            ${hasSettings ? `
                            <label class="import-option" style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="import-settings" checked>
                                <span>设置配置</span>
                            </label>
                            ` : ''}
                            ${hasModuleConfig ? `
                            <label class="import-option" style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="import-module-config" checked>
                                <span>模块配置</span>
                            </label>
                            ` : ''}
                        </div>
                        ` : '<p style="color: #ff6b35;">⚠️ 导入的配置中没有可导入的内容</p>'}
                        ${hasModuleConfig ? `
                        <div id="module-selection-container" class="module-selector-container" style="margin-top: 15px; max-height: 200px; overflow-y: auto;">
                            <div class="module-selector-header">
                                <label>选择要导入的模块：</label>
                                <div class="module-selector-actions">
                                    <button type="button" id="select-all-modules" class="btn-tiny">全选</button>
                                    <button type="button" id="select-enabled-modules" class="btn-tiny">仅启用</button>
                                    <button type="button" id="deselect-all-modules" class="btn-tiny">清空</button>
                                </div>
                            </div>
                            <div id="module-checkbox-container" class="module-checkbox-group">
                                ${importModules.map(module => `
                                    <div class="module-checkbox-item">
                                        <input type="checkbox" id="import-module-${module.name}" value="${module.name}" class="module-checkbox" checked>
                                        <label for="import-module-${module.name}" class="module-checkbox-label">${module.name} (${module.displayName || '无显示名称'})</label>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <div id="override-enabled-container" class="import-options-group" style="margin-top: 10px;">
                            <label class="import-option" style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="import-override-enabled" checked>
                                <span>覆盖模块开关状态</span>
                            </label>
                        </div>
                        ` : ''}
                    </div>
                    <div class="confirm-dialog-message" style="margin-top: 15px;">
                        <p style="color: #ff6b35; font-weight: bold; margin: 0;">⚠️ 安全提示：请务必确保配置来源可信，确认导入吗？</p>
                    </div>
                    <div class="confirm-dialog-buttons">
                        <button class="confirm-dialog-btn confirm-dialog-cancel">取消</button>
                        <button class="confirm-dialog-btn confirm-dialog-confirm">确定导入</button>
                    </div>
                </div>
            </div>
        `);

        // 添加到页面
        $('body').append(importOptionsDialog);

        // 获取DOM元素
        const importModuleConfigCheckbox = importOptionsDialog.find('#import-module-config');
        const moduleSelectionContainer = importOptionsDialog.find('#module-selection-container');
        const overrideEnabledContainer = importOptionsDialog.find('#override-enabled-container');

        // 只在有模块配置时才绑定相关事件
        if (hasModuleConfig) {
            // 绑定模块配置复选框事件
            importModuleConfigCheckbox.on('change', function () {
                if ($(this).prop('checked')) {
                    moduleSelectionContainer.slideDown(300);
                    overrideEnabledContainer.slideDown(300);
                } else {
                    moduleSelectionContainer.slideUp(300);
                    overrideEnabledContainer.slideUp(300);
                }
            });

            // 模块配置默认勾选，所以模块选择器和覆盖选项默认显示
            if (importModuleConfigCheckbox.prop('checked')) {
                moduleSelectionContainer.show();
                overrideEnabledContainer.show();
            }
        }

        // 绑定全选按钮事件
        importOptionsDialog.find('#select-all-modules').on('click', function () {
            importOptionsDialog.find('.module-checkbox').prop('checked', true);
        });

        // 绑定清空按钮事件
        importOptionsDialog.find('#deselect-all-modules').on('click', function () {
            importOptionsDialog.find('.module-checkbox').prop('checked', false);
        });

        // 绑定仅启用按钮事件
        importOptionsDialog.find('#select-enabled-modules').on('click', function () {
            importOptionsDialog.find('.module-checkbox').each(function () {
                const moduleName = $(this).val();
                const module = importModules.find(m => m.name === moduleName);
                $(this).prop('checked', module && module.enabled);
            });
        });

        // 绑定按钮事件
        importOptionsDialog.find('.confirm-dialog-confirm').on('click', function () {
            const importSettings = importOptionsDialog.find('#import-settings').prop('checked');
            const importModuleConfig = importOptionsDialog.find('#import-module-config').prop('checked');
            const overrideEnabled = importOptionsDialog.find('#import-override-enabled').prop('checked');

            // 获取选中的模块
            const selectedModules = [];
            if (importModuleConfig) {
                importOptionsDialog.find('.module-checkbox:checked').each(function () {
                    selectedModules.push($(this).val());
                });
            }

            // 检查是否有实际要导入的内容
            const hasContentToImport =
                (importSettings && hasSettings) ||
                (importModuleConfig && selectedModules.length > 0);

            if (!hasContentToImport) {
                // 没有选择任何导入内容，显示提示并取消操作
                toastr.warning('请至少选择一项要导入的内容', '导入取消');
                return;
            }

            // 保存导入选项到配置对象
            config.importOptions = {
                importSettings: importSettings,
                importModuleConfig: importModuleConfig,
                overrideEnabled: overrideEnabled,
                selectedModules: selectedModules
            };

            resolve(config);
            importOptionsDialog.remove();
        });

        importOptionsDialog.find('.confirm-dialog-cancel').on('click', function () {
            resolve(null);
            importOptionsDialog.remove();
        });

        // 点击背景关闭
        importOptionsDialog.on('click', function (e) {
            if (e.target === this) {
                resolve(null);
                importOptionsDialog.remove();
            }
        });

        // 显示弹窗
        setTimeout(() => {
            importOptionsDialog.addClass('show');
        }, 10);
    });
}

/**
 * 显示导出选项弹窗
 * @returns {Promise<Object|null>} 导出选项对象或null
 */
export function showExportOptionsDialog() {
    return new Promise((resolve) => {
        // 获取所有模块数据
        const modulesData = configManager.getModules(true) || [];

        // 创建导出选项弹窗HTML
        const exportOptionsDialog = $(`
            <div id="continuity-export-options-dialog" class="continuity-confirm-dialog">
                <div class="confirm-dialog-content">
                    <h3 class="confirm-dialog-title">导出选项</h3>
                    <div class="export-info-panel" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; padding: 8px 12px; margin: 0 0 12px 0;">
                        <div class="author-input-group" style="display: flex; align-items: center; margin-bottom: 8px;">
                            <label for="config-author" style="color: rgba(255, 255, 255, 0.7); font-size: 0.9em; margin-right: 8px; white-space: nowrap;">配置作者：</label>
                            <input type="text" id="config-author" class="module-parse-input" placeholder="可选" style="flex: 1; color: rgba(255, 255, 255, 0.9); background-color: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); font-size: 0.9em; padding: 6px 8px;">
                        </div>
                        <div class="version-input-group" style="display: flex; align-items: center;">
                            <label for="config-version" style="color: rgba(255, 255, 255, 0.7); font-size: 0.9em; margin-right: 8px; white-space: nowrap;">配置版本：</label>
                            <input type="text" id="config-version" class="module-parse-input" placeholder="可选" style="flex: 1; color: rgba(255, 255, 255, 0.9); background-color: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); font-size: 0.9em; padding: 6px 8px;">
                        </div>
                    </div>
                    <div class="confirm-dialog-message">
                        <p>请选择导出内容：</p>
                        <div class="export-options-group">
                            <label class="export-option" style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="export-settings" checked>
                                <span>设置配置</span>
                            </label>
                            <label class="export-option" style="display: flex; align-items: center; gap: 8px;">
                                <input type="checkbox" id="export-module-config" checked>
                                <span>模块配置</span>
                            </label>
                        </div>
                        <div id="module-selection-container" class="module-selector-container" style="margin-top: 15px; max-height: 200px; overflow-y: auto;">
                            <div class="module-selector-header">
                                <label>选择要导出的模块：</label>
                                <div class="module-selector-actions">
                                    <button type="button" id="select-all-modules" class="btn-tiny">全选</button>
                                    <button type="button" id="select-enabled-modules" class="btn-tiny">仅启用</button>
                                    <button type="button" id="deselect-all-modules" class="btn-tiny">清空</button>
                                </div>
                            </div>
                            <div id="module-checkbox-container" class="module-checkbox-group">
                                ${modulesData.map(module => `
                                    <div class="module-checkbox-item">
                                        <input type="checkbox" id="export-module-${module.name}" value="${module.name}" class="module-checkbox" checked>
                                        <label for="export-module-${module.name}" class="module-checkbox-label">${module.name} (${module.displayName})</label>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="confirm-dialog-buttons">
                        <button class="confirm-dialog-btn confirm-dialog-cancel">取消</button>
                        <button class="confirm-dialog-btn confirm-dialog-confirm">确定导出</button>
                    </div>
                </div>
            </div>
        `);

        // 添加到页面
        $('body').append(exportOptionsDialog);

        // 获取DOM元素
        const exportModuleConfigCheckbox = exportOptionsDialog.find('#export-module-config');
        const moduleSelectionContainer = exportOptionsDialog.find('#module-selection-container');
        const authorInput = exportOptionsDialog.find('#config-author');
        const versionInput = exportOptionsDialog.find('#config-version');

        // 加载已保存的作者名称和版本号
        const extensionConfig = configManager.getExtensionConfig();
        if (extensionConfig) {
            if (extensionConfig.moduleConfigAuthor) {
                authorInput.val(extensionConfig.moduleConfigAuthor);
            }
            if (extensionConfig.moduleConfigVersion) {
                versionInput.val(extensionConfig.moduleConfigVersion);
            }
        }

        // 绑定模块配置复选框事件
        exportModuleConfigCheckbox.on('change', function () {
            if ($(this).prop('checked')) {
                moduleSelectionContainer.slideDown(300);
            } else {
                moduleSelectionContainer.slideUp(300);
            }
        });

        // 模块配置默认勾选，所以模块选择器默认显示
        if (exportModuleConfigCheckbox.prop('checked')) {
            moduleSelectionContainer.show();
        }

        // 绑定全选按钮事件
        exportOptionsDialog.find('#select-all-modules').on('click', function () {
            exportOptionsDialog.find('.module-checkbox').prop('checked', true);
        });

        // 绑定清空按钮事件
        exportOptionsDialog.find('#deselect-all-modules').on('click', function () {
            exportOptionsDialog.find('.module-checkbox').prop('checked', false);
        });

        // 绑定仅启用按钮事件
        exportOptionsDialog.find('#select-enabled-modules').on('click', function () {
            exportOptionsDialog.find('.module-checkbox').each(function () {
                const moduleName = $(this).val();
                const module = modulesData.find(m => m.name === moduleName);
                $(this).prop('checked', module && module.enabled);
            });
        });

        // 保存作者和版本信息的函数
        const saveAuthorConfig = () => {
            const authorName = authorInput.val().trim();
            const versionName = versionInput.val().trim();
            const extensionConfig = configManager.getExtensionConfig();

            // 更新作者和版本信息
            if (!extensionConfig) return;

            if (authorName) {
                extensionConfig.moduleConfigAuthor = authorName;
            } else {
                // 如果输入为空，删除作者字段
                delete extensionConfig.moduleConfigAuthor;
            }

            if (versionName) {
                extensionConfig.moduleConfigVersion = versionName;
            } else {
                // 如果输入为空，删除版本字段
                delete extensionConfig.moduleConfigVersion;
            }

            // 保存配置
            configManager.setExtensionConfig(extensionConfig);
        };

        // 绑定作者输入框自动保存事件
        // authorInput.on('input', saveAuthorConfig);

        // 绑定确定按钮事件
        exportOptionsDialog.find('.confirm-dialog-confirm').on('click', function () {
            // 保存作者配置
            saveAuthorConfig();

            const exportSettings = exportOptionsDialog.find('#export-settings').prop('checked');
            const exportModuleConfig = exportOptionsDialog.find('#export-module-config').prop('checked');

            // 获取选中的模块
            const selectedModules = [];
            if (exportModuleConfig) {
                exportOptionsDialog.find('.module-checkbox:checked').each(function () {
                    selectedModules.push($(this).val());
                });
            }

            // 保存导出选项
            const exportOptions = {
                exportSettings: exportSettings,
                exportModuleConfig: exportModuleConfig,
                selectedModules: selectedModules
            };

            resolve(exportOptions);
            exportOptionsDialog.remove();
        });

        exportOptionsDialog.find('.confirm-dialog-cancel').on('click', function () {
            // 保存作者配置
            saveAuthorConfig();

            resolve(null);
            exportOptionsDialog.remove();
        });

        // 点击背景关闭
        exportOptionsDialog.on('click', function (e) {
            if (e.target === this) {
                resolve(null);
                exportOptionsDialog.remove();
            }
        });

        // 显示弹窗
        setTimeout(() => {
            exportOptionsDialog.addClass('show');
        }, 10);
    });
}


/**
 * 导出模块配置为JSON文件
 */
export function exportModuleConfig(exportOptions) {
    try {
        // 让backupModuleConfig使用完整配置
        const success = configManager.backupModuleConfig(exportOptions);
        if (success) {
            toastr.success('配置已导出');
            // infoLog('配置已导出为JSON文件');
        } else {
            errorLog('导出配置失败');
        }
    } catch (error) {
        toastr.error('配置导出失败');
        errorLog('导出配置失败:', error);
    }
}

/**
 * 导入模块配置并进行验证
 * @param {File} file 选择的JSON文件
 * @returns {Promise<Object|null>} 验证并规范化后的配置对象或null
 */
export function importModuleConfig(file) {
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
                    let errorMessage = `配置验证失败:\n${validation.errors.join('\n')}`;
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
                            async () => {
                                // 使用统一的导入配置处理函数
                                const configWithOptions = await processImportConfig(config, file);
                                resolve(configWithOptions);
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
                        async () => {
                            // 使用统一的导入配置处理函数
                            const configWithOptions = await processImportConfig(config, file);
                            resolve(configWithOptions);
                        },
                        () => {
                            // 用户选择取消导入
                            resolve(null);
                        }
                    );
                    return;
                }

                // 使用统一的导入配置处理函数
                processImportConfig(config, file).then(configWithOptions => {
                    resolve(configWithOptions);
                });

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



