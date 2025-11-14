// 模块配置管理模块
import { extensionFolderPath, debugLog, errorLog, infoLog, initParseModule } from "../index.js";
import { getVariableItemTemplate } from "./templateManager.js";
import { updateModulePreview } from "./moduleManager.js";
import {
    saveModuleConfigToExtension,
    loadModuleConfigFromExtension,
    hasModuleConfig,
    clearModuleConfig,
    getModuleConfigStats,
    backupModuleConfig,
    restoreModuleConfig
} from "./moduleStorageManager.js";

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
 * 保存模块配置到SillyTavern扩展设置
 * @param {Array} modules 模块配置数组
 */
export function saveModuleConfig(modules) {
    try {
        // 使用新的扩展设置存储
        const success = saveModuleConfigToExtension(modules);
        if (success) {
            infoLog('模块配置已保存到SillyTavern扩展设置');
            return true;
        } else {
            errorLog('保存模块配置到扩展设置失败');
            return false;
        }
    } catch (error) {
        errorLog('保存模块配置失败:', error);
        return false;
    }
}



/**
 * 从SillyTavern扩展设置加载模块配置
 * @returns {Object|null} 模块配置对象或null
 */
export function loadModuleConfig() {
    try {
        // 使用新的扩展设置加载
        const config = loadModuleConfigFromExtension();
        if (config) {
            debugLog('从SillyTavern扩展设置加载模块配置:', config);
            return config;
        }

        // 向后兼容：检查是否存在旧的localStorage配置
        const oldConfigStr = localStorage.getItem('continuity_module_config');
        if (oldConfigStr) {
            try {
                const oldConfig = JSON.parse(oldConfigStr);
                debugLog('从旧版localStorage加载模块配置:', oldConfig);

                // 迁移到新存储
                if (oldConfig.modules) {
                    saveModuleConfigToExtension(oldConfig.modules);
                    infoLog('已从localStorage迁移模块配置到SillyTavern扩展设置');

                    // 可选：清除旧的localStorage配置
                    // localStorage.removeItem('continuity_module_config');
                }

                return oldConfig;
            } catch (error) {
                errorLog('迁移旧版配置失败:', error);
            }
        }
    } catch (error) {
        errorLog('加载模块配置失败:', error);
    }
    return null;
}

/**
 * 导出模块配置为JSON文件
 * @param {Array} modules 模块配置数组
 */
export function exportModuleConfig(modules) {
    try {
        // 使用新的备份功能
        const success = backupModuleConfig(modules);
        if (success) {
            infoLog('模块配置已导出为JSON文件');
        } else {
            errorLog('导出模块配置失败');
        }
    } catch (error) {
        errorLog('导出模块配置失败:', error);

        // 降级处理：使用旧的导出方式
        const config = { modules };
        const dataStr = JSON.stringify(config, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

        const exportFileDefaultName = `continuity-modules-${new Date().toISOString().split('T')[0]}.json`;

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();

        infoLog('模块配置已导出为JSON文件（降级方式）');
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

                // 保存到扩展设置
                if (saveModuleConfigToExtension(config.modules)) {
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
 * 从备份文件恢复模块配置
 * @param {File} file 备份文件
 * @returns {Promise<Object|null>} 恢复的配置对象
 */
export function restoreModuleConfigFromFile(file) {
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

                debugLog('成功从备份文件恢复模块配置:', config);

                // 保存到扩展设置
                if (saveModuleConfigToExtension(config.modules)) {
                    infoLog('备份的模块配置已恢复到SillyTavern扩展设置');
                    resolve(config);
                } else {
                    throw new Error('保存恢复的配置失败');
                }
            } catch (error) {
                errorLog('解析备份文件失败:', error);
                toastr.error('解析备份文件失败，请检查文件格式');
                resolve(null);
            }
        };
        reader.onerror = () => {
            errorLog('读取备份文件失败');
            toastr.error('读取备份文件失败');
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
        const config = loadModuleConfigFromExtension();
        if (!config || !Array.isArray(config)) {
            return { moduleCount: 0, enabledCount: 0, variableCount: 0 };
        }

        const moduleCount = config.length;
        const enabledCount = config.filter(module => module.enabled !== false).length;
        const variableCount = config.reduce((total, module) => {
            return total + (Array.isArray(module.variables) ? module.variables.length : 0);
        }, 0);

        return {
            moduleCount,
            enabledCount,
            variableCount,
            lastUpdated: new Date().toISOString()
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
        const config = loadModuleConfigFromExtension();
        return !!(config && Array.isArray(config) && config.length > 0);
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
        // 使用扩展设置API清除配置
        if (window.extension_settings) {
            if (window.extension_settings.continuity) {
                delete window.extension_settings.continuity.modules;
                saveSettingsDebounced();
                infoLog('模块配置已从扩展设置中清除');
                return true;
            }
        }

        // 降级处理：尝试清除localStorage
        localStorage.removeItem('continuity_module_config');
        infoLog('模块配置已从localStorage中清除');
        return true;
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

export function renderModulesFromConfig(config) {
    if (!config || !config.modules) return;

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
    });

    // 渲染完成后调用回调
    if (typeof onRenderCompleteCallback === 'function') {
        onRenderCompleteCallback();
    }

    // 初始化解析模块功能
    initParseModule();
}
