// 模块配置管理模块
import { extensionFolderPath, debugLog, errorLog, infoLog, initParseModule } from "../index.js";
import { getVariableItemTemplate } from "./templateManager.js";
import { updateModulePreview, restoreModuleCollapsedState, restoreCustomStylesVisibleState } from "./moduleManager.js";
import { updateVariableOrderNumbers, bindVariableEvents } from "./variableManager.js";
import configManager from "../singleton/configManager.js";

// 声明外部函数（在uiManager.js中定义）
let bindModuleEvents = null;

/**
 * 设置bindModuleEvents函数引用
 * @param {Function} fn bindModuleEvents函数
 */
export function setBindModuleEvents(fn) {
    bindModuleEvents = fn;
}

/**
 * 保存模块配置
 * @param {Array} modules 模块配置数组
 * @param {Object} globalSettings 全局设置对象（包含核心原则提示词和通用格式描述提示词）
 */
export function saveModuleConfig(modules, globalSettings = {}) {
    try {
        // 使用统一配置管理器
        configManager.setModules(modules);
        if (Object.keys(globalSettings).length > 0) {
            configManager.setGlobalSettings(globalSettings);
        }

        // 立即保存
        const success = configManager.saveModuleConfigNow();
        if (success) {
            infoLog('模块配置已保存');
            return true;
        } else {
            errorLog('保存模块配置失败');
            return false;
        }
    } catch (error) {
        errorLog('保存模块配置失败:', error);
        return false;
    }
}



/**
 * 加载模块配置
 * @returns {Object|null} 模块配置对象或null
 */
export function loadModuleConfig() {
    try {
        // 使用统一配置管理器
        const config = configManager.getModuleConfig();
        debugLog('从配置管理器加载模块配置:', config);
        return config;
    } catch (error) {
        errorLog('加载模块配置失败:', error);
        return null;
    }
}

/**
 * 导出模块配置为JSON文件
 */
export function exportModuleConfig() {
    try {
        // 让backupModuleConfig使用完整配置
        const success = configManager.backupModuleConfig();
        if (success) {
            toastr.success('模块配置已导出');
            infoLog('模块配置已导出为JSON文件');
        } else {
            errorLog('导出模块配置失败');
        }
    } catch (error) {
        toastr.error('模块配置导出失败');
        errorLog('导出模块配置失败:', error);

        // // 降级处理：使用旧的导出方式
        // const config = configManager.getModuleConfig();
        // const dataStr = JSON.stringify(config, null, 2);
        // const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

        // const exportFileDefaultName = `continuity-modules-${new Date().toISOString().split('T')[0]}.json`;

        // const linkElement = document.createElement('a');
        // linkElement.setAttribute('href', dataUri);
        // linkElement.setAttribute('download', exportFileDefaultName);
        // linkElement.click();

        // infoLog('模块配置已导出为JSON文件（降级方式）');
    }
}

/**
 * 导入模块配置从JSON文件
 * @param {File} file 选择的JSON文件
 * @returns {Promise<Object|null>} 解析后的配置对象或null
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
                if (!config.modules || !Array.isArray(config.modules)) {
                    throw new Error('无效的配置格式，缺少modules数组');
                }

                debugLog('成功导入模块配置:', config);

                // 保存到配置管理器，包括globalSettings
                configManager.setModules(config.modules);
                if (config.globalSettings) {
                    configManager.setGlobalSettings(config.globalSettings);
                }

                // 立即保存
                if (configManager.saveModuleConfigNow()) {
                    infoLog('导入的模块配置已保存到SillyTavern扩展设置');
                    resolve(config);
                } else {
                    throw new Error('保存导入的配置失败');
                }
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

/**
 * 获取模块配置统计信息
 * @returns {Object} 统计信息
 */
export function getModuleConfigStatsInfo() {
    try {
        const config = configManager.getModuleConfig();
        const modules = config.modules || [];

        const moduleCount = modules.length;
        const enabledCount = modules.filter(module => module.enabled !== false).length;
        const variableCount = modules.reduce((total, module) => {
            return total + (Array.isArray(module.variables) ? module.variables.length : 0);
        }, 0);

        return {
            moduleCount,
            enabledCount,
            variableCount,
            lastUpdated: config.lastUpdated || new Date().toISOString()
        };
    } catch (error) {
        errorLog('获取模块配置统计信息失败:', error);
        return { moduleCount: 0, enabledCount: 0, variableCount: 0, error: error.message };
    }
}

/**
 * 检查是否存在模块配置
 * @returns {boolean} 是否存在配置
 */
export function hasModuleConfigData() {
    try {
        const config = configManager.getModuleConfig();
        return !!(config && config.modules && config.modules.length > 0);
    } catch (error) {
        errorLog('检查模块配置存在性失败:', error);
        return false;
    }
}

/**
 * 清除模块配置
 * @returns {boolean} 是否清除成功
 */
export function clearModuleConfigData() {
    try {
        // 使用配置管理器重置到默认值
        configManager.resetModuleConfigToDefault();
        const success = configManager.saveModuleConfigNow();
        if (success) {
            infoLog('模块配置已清除');
        } else {
            errorLog('清除模块配置失败');
        }
        return success;
    } catch (error) {
        errorLog('清除模块配置失败:', error);
        return false;
    }
}

/**
 * 从配置对象渲染模块到UI
 * @param {Object} config 配置对象
 */
// 用于渲染完成后的回调函数
let onRenderCompleteCallback = null;

/**
 * 设置渲染完成回调
 * @param {Function} callback 回调函数
 */
export function setOnRenderComplete(callback) {
    onRenderCompleteCallback = callback;
}

/**
 * 从配置对象渲染模块到UI
 * @param {Object} config 配置对象
 */
export function renderModulesFromConfig(config) {
    if (!config || !config.modules) return;

    // 更新全局设置输入框
    if (config.globalSettings) {

        // 更新模块标签输入框
        if (config.globalSettings.moduleTag) {
            $('#module-tags').val(config.globalSettings.moduleTag);
        }
        // 更新兼容模块标签输入框
        if (config.globalSettings.compatibleModuleTags && config.globalSettings.compatibleModuleTags.length > 0) {
            $('#module-compatible-tags').val(config.globalSettings.compatibleModuleTags.join(','));
        }
        // 更新内容标签输入框
        if (config.globalSettings.contentTag && config.globalSettings.contentTag.length > 0) {
            $('#content-tags').val(config.globalSettings.contentTag.join(','));
        }
        // 更新内容保留层数输入框
        if (config.globalSettings.contentRemainLayers) {
            $('#content-layers').val(config.globalSettings.contentRemainLayers);
        }

        if (config.globalSettings.prompt) {
            $('#global-prompt-input').val(config.globalSettings.prompt);
        }
        if (config.globalSettings.orderPrompt) {
            $('#global-order-prompt-input').val(config.globalSettings.orderPrompt);
        }
        if (config.globalSettings.usagePrompt) {
            $('#global-usage-prompt-input').val(config.globalSettings.usagePrompt);
        }
        if (config.globalSettings.moduleDataPrompt) {
            $('#global-module-data-prompt-input').val(config.globalSettings.moduleDataPrompt);
        }
        if (config.globalSettings.containerStyles) {
            $('#global-container-styles-input').val(config.globalSettings.containerStyles);
        }
        if (config.globalSettings.timeFormat) {
            $('#global-time-format-input').val(config.globalSettings.timeFormat);
        }
    }

    // 清空现有模块（保留模板和标题区域）
    $('.custom-modules-container > div').each(function () {
        if (!$(this).hasClass('module-template') && !$(this).hasClass('section-title')) {
            $(this).remove();
        }
    });

    // 克隆整个模块模板，与addModule函数保持一致
    const template = $('.module-template').clone();

    // 对模块进行排序，如果没有order属性则使用默认索引
    const sortedModules = [...config.modules].sort((a, b) => {
        const orderA = a.order !== undefined ? a.order : 999;
        const orderB = b.order !== undefined ? b.order : 999;
        return orderA - orderB;
    });

    sortedModules.forEach((module, index) => {
        if (!module.name) return;

        const moduleElement = template.clone();
        moduleElement.removeClass('module-template').css('display', 'block');

        // 获取模块内部的module-item
        const moduleItem = moduleElement.find('.module-item');

        // 设置模块名称
        moduleItem.find('.module-name').val(module.name);
        // 设置模块显示名
        moduleItem.find('.module-display-name').val(module.displayName || '');
        // 设置兼容模块名
        moduleItem.find('.module-compatible-names').val(module.compatibleModuleNames || '');

        // 设置模块启用状态（默认为true）
        const isEnabled = module.enabled !== false; // 如果未定义enabled，默认为true
        moduleItem.find('.module-enabled-toggle').prop('checked', isEnabled);

        // 根据启用状态设置disabled类
        if (isEnabled) {
            moduleItem.removeClass('disabled');
        } else {
            moduleItem.addClass('disabled');
        }

        // 在渲染完成后会通过uiManager.js中的updateModuleOrderNumbers函数统一设置排序数字，这里不再需要手动设置

        // 设置模块提示词
        if (module.prompt) {
            moduleItem.find('.module-prompt-input').val(module.prompt);
        }

        // 设置新的配置项
        if (module.timingPrompt) {
            moduleItem.find('.module-timing-prompt-input').val(module.timingPrompt);
        }
        if (module.contentPrompt) {
            moduleItem.find('.module-content-prompt-input').val(module.contentPrompt);
        }
        if (module.outputPosition) {
            moduleItem.find('.module-output-position').val(module.outputPosition);
            // 根据生成位置显示/隐藏顺序提示词输入框
            const positionPromptInput = moduleItem.find('.module-position-prompt');
            if (module.outputPosition === 'specific_position') {
                positionPromptInput.show();
            } else {
                positionPromptInput.hide();
            }
        }
        // 设置顺序提示词
        if (module.positionPrompt) {
            moduleItem.find('.module-position-prompt').val(module.positionPrompt);
        }
        // 设置自定义容器样式
        if (module.containerStyles) {
            moduleItem.find('.module-container-styles').val(module.containerStyles);
        }
        // 设置自定义样式
        if (module.customStyles) {
            moduleItem.find('.module-custom-styles').val(module.customStyles);
        }
        // 设置输出模式
        const outputMode = module.outputMode || 'full';
        moduleItem.find('.module-output-mode').val(outputMode);

        // 设置保留层数
        if (module.retainLayers !== undefined) {
            moduleItem.find('.module-retain-layers').val(module.retainLayers);
        } else {
            // 设置默认值为-1
            moduleItem.find('.module-retain-layers').val(-1);
        }

        // 设置时间参考标准
        const timeReferenceStandard = module.timeReferenceStandard || false;
        moduleItem.find('.module-time-reference-standard').val(timeReferenceStandard ? 'true' : 'false');
        moduleItem.find('.module-time-reference-standard-btn')
            .attr('data-time-reference-standard', timeReferenceStandard ? 'true' : 'false')
            .toggleClass('active', timeReferenceStandard);

        // 设置外部显示状态
        const isExternalDisplay = module.isExternalDisplay || false;
        moduleItem.find('.module-is-external-display').val(isExternalDisplay ? 'true' : 'false');
        moduleItem.find('.module-external-display-btn')
            .attr('data-external-display', isExternalDisplay ? 'true' : 'false')
            .toggleClass('active', isExternalDisplay);

        // 根据输出模式控制保留层数输入框的显示/隐藏
        const retainLayersInput = moduleItem.find('.module-retain-layers');
        if (outputMode === 'full') {
            retainLayersInput.show();
        } else {
            retainLayersInput.hide();
        }
        // 处理数量范围（使用rangeMode字段优先）
        const rangeModeSelect = moduleItem.find('.module-range-mode');
        const rangeInputGroup = moduleItem.find('.range-input-group');
        const minInput = moduleItem.find('.module-item-min');
        const maxInput = moduleItem.find('.module-item-specified');
        const separator = moduleItem.find('.range-separator');

        // 优先使用rangeMode字段，如果没有则根据数值推断
        const rangeMode = module.rangeMode ||
            (module.itemMin === 0 && module.itemMax === 0 ? 'unlimited' :
                module.itemMin === 0 && module.itemMax > 0 ? 'specified' : 'range');

        rangeModeSelect.val(rangeMode);

        switch (rangeMode) {
            case 'unlimited':
                rangeInputGroup.hide();
                break;
            case 'specified':
                rangeInputGroup.show();
                minInput.hide();
                separator.hide();
                maxInput.show().val(module.itemMax || 1);
                break;
            case 'range':
                rangeInputGroup.show();
                minInput.show().val(module.itemMin || 0);
                separator.show();
                maxInput.show().val(module.itemMax || 1);
                break;
        }

        // 清空默认变量
        moduleItem.find('.variable-item').not('.variable-template').remove();

        // 添加变量
        if (module.variables && Array.isArray(module.variables)) {
            const variableTemplate = moduleItem.find('.variable-template');
            const variablesContainer = moduleItem.find('.variables-container');

            module.variables.forEach(variable => {
                if (!variable.name) return;

                // 使用模板管理模块创建变量项
                const variableItemHTML = getVariableItemTemplate(variable);
                const templateItem = $(variableItemHTML);

                // 设置变量显示名
                templateItem.find('.variable-display-name').val(variable.displayName || '');
                // 设置兼容变量名
                templateItem.find('.variable-compatible-names').val(variable.compatibleVariableNames || '');

                // 添加variable-item到容器
                variablesContainer.append(templateItem);

                // 为变量项绑定事件
                bindVariableEvents(templateItem, moduleItem);
            });

            // 更新变量顺序数字
            if (typeof updateVariableOrderNumbers === 'function') {
                updateVariableOrderNumbers(variablesContainer);
            }
        }

        // 添加到custom-modules-container
        $('.custom-modules-container').append(moduleElement);

        // 绑定模块事件
        if (bindModuleEvents) {
            bindModuleEvents(moduleItem);
        }

        // 更新模块预览
        if (updateModulePreview) {
            updateModulePreview(moduleItem);
        }

        // 恢复模块折叠状态
        if (restoreModuleCollapsedState) {
            restoreModuleCollapsedState(moduleItem);
        }

        // 恢复自定义样式框显示状态
        if (restoreCustomStylesVisibleState) {
            restoreCustomStylesVisibleState(moduleItem);
        }
    });

    // 渲染完成后调用回调
    if (typeof onRenderCompleteCallback === 'function') {
        onRenderCompleteCallback();
    }

    // 为所有模块检查标识符警告状态
    $('.custom-modules-container .module-item').each(function () {
        const moduleItem = $(this);
        const outputMode = moduleItem.find('.module-output-mode').val();
        const warningElement = moduleItem.find('.module-identifier-warning');

        // 检查整个模块中是否有任何一个变量设置了主标识符或备用标识符
        let hasAnyIdentifier = false;

        // 遍历模块中的所有变量项
        moduleItem.find('.variable-item').each(function () {
            const variableItem = $(this);
            const isMainIdentifier = variableItem.find('.variable-is-identifier').val() === 'true';
            const isBackupIdentifier = variableItem.find('.variable-is-backup-identifier').val() === 'true';

            if (isMainIdentifier || isBackupIdentifier) {
                hasAnyIdentifier = true;
                return false; // 跳出循环，因为已经找到一个标识符
            }
        });

        // 如果输出模式是增量且没有任何标识符，则显示警告
        if (outputMode === 'incremental' && !hasAnyIdentifier) {
            warningElement.show();
        } else {
            warningElement.hide();
        }
    });

    // 初始化解析模块功能
    initParseModule();
}
