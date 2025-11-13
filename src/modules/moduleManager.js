// 模块管理相关功能
import { debugLog, errorLog, addVariable, initParseModule } from "../index.js";

/**
 * 添加新模块
 * @returns {JQuery<HTMLElement>} 新创建的模块元素
 */
export function addModule() {
    const template = $('.module-template').clone();
    template.removeClass('module-template').css('display', 'block');
    $('.custom-modules-container').append(template);

    // 绑定事件
    bindModuleEvents(template);

    // 初始化预览
    updateModulePreview(template.find('.module-item'));

    return template;
}

/**
 * 更新模块预览
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 */
export function updateModulePreview(moduleItem) {
    const moduleName = moduleItem.find('.module-name').val() || '模块名';
    // 只计算可见的变量项，排除隐藏的模板
    const variables = moduleItem.find('.variable-item').filter(function () {
        return $(this).closest('.variable-template').length === 0;
    }).map(function () {
        const varName = $(this).find('.variable-name').val() || '变量名';
        return varName + ':值';
    }).get();

    const previewText = variables.length > 0
        ? `[${moduleName}|${variables.join('|')}]`
        : `[${moduleName}]`;

    moduleItem.find('.module-preview-text').val(previewText);
}

/**
 * 更新所有模块的排序数字
 */
export function updateModuleOrderNumbers() {
    // 使用更精确的选择器，确保只选择真正的模块项
    $('.custom-modules-container > div').not('.module-template, .section-title').each(function (index) {
        const moduleItem = $(this).find('.module-item');
        const moduleNameGroup = moduleItem.find('.module-name-group');
        // 先移除已有的排序数字元素，避免重复
        moduleNameGroup.find('.module-order-number').remove();
        // 添加新的排序数字元素
        moduleNameGroup.prepend(`<div class="module-order-number">${index + 1}</div>`);
    });
}

/**
 * 绑定模块相关事件
 * @param {JQuery<HTMLElement>} moduleElement 模块元素
 */
export function bindModuleEvents(moduleElement) {
    // 如果传入的是.module-item元素，直接使用
    // 如果传入的是父容器，则查找.module-item
    const moduleItem = moduleElement.hasClass('module-item') ? moduleElement : moduleElement.find('.module-item');

    // 先解绑所有事件，避免重复绑定
    moduleItem.find('.module-name').off('input');
    moduleItem.find('.toggle-variables').off('click');
    moduleItem.find('.move-module-up').off('click');
    moduleItem.find('.move-module-down').off('click');
    moduleItem.find('.add-variable').off('click');
    moduleItem.find('.remove-module').off('click');
    moduleItem.find('.variable-item input').off('input');
    moduleItem.find('.variable-item .remove-variable').off('click');
    moduleItem.find('.module-enabled-toggle').off('change');

    // 模块名称输入事件
    moduleItem.find('.module-name').on('input', function () {
        updateModulePreview(moduleItem);
    });

    // 模块启用/禁用滑块开关事件
    moduleItem.find('.module-enabled-toggle').on('change', function () {
        const isEnabled = $(this).prop('checked');
        const moduleItem = $(this).closest('.module-item');

        // 根据启用状态添加或移除disabled类
        if (isEnabled) {
            moduleItem.removeClass('disabled');
        } else {
            moduleItem.addClass('disabled');
        }

        updateModulePreview(moduleItem);
        debugLog('模块启用状态改变:', moduleItem.find('.module-name').val(), isEnabled);
    });

    // 更新变量数量显示
    function updateVariableCount() {
        const variableCount = moduleItem.find('.variable-item').filter(function () {
            return $(this).closest('.variable-template').length === 0;
        }).length;
        const countElement = moduleItem.find('.toggle-variables .variable-count');
        countElement.text(`(${variableCount})`);
    }

    // 初始化变量数量
    updateVariableCount();

    // 设置默认折叠状态
    const wrapper = moduleItem.find('.variables-container-wrapper');
    const button = moduleItem.find('.toggle-variables');
    const arrow = button.find('.arrow');
    const text = button.find('.text');

    // 默认折叠状态
    wrapper.addClass('collapsed');
    button.addClass('collapsed');
    arrow.text('▶');
    text.text('展开变量');

    // 折叠/展开变量按钮事件
    moduleItem.find('.toggle-variables').on('click', function () {
        const wrapper = moduleItem.find('.variables-container-wrapper');
        const button = $(this);
        const arrow = button.find('.arrow');
        const text = button.find('.text');

        if (wrapper.hasClass('collapsed')) {
            // 展开变量
            wrapper.removeClass('collapsed');
            button.removeClass('collapsed');
            arrow.text('▼');
            text.text('折叠变量');
        } else {
            // 折叠变量
            wrapper.addClass('collapsed');
            button.addClass('collapsed');
            arrow.text('▶');
            text.text('展开变量');
        }
    });

    // 添加变量按钮事件
    moduleItem.find('.add-variable').on('click', function () {
        debugLog('添加变量按钮被点击');
        debugLog('按钮元素:', this);
        debugLog('按钮类名:', this.className);
        debugLog('按钮文本:', this.textContent || this.innerText);
        debugLog('模块项:', moduleItem);
        debugLog('模块项长度:', moduleItem.length);
        debugLog('模块项选择器:', moduleItem.selector || '无选择器');
        debugLog('当前模块变量数量:', moduleItem.find('.variable-item').length);

        try {
            addVariable(moduleItem);
            debugLog('addVariable函数调用成功');
            // 更新变量数量
            updateVariableCount();
        } catch (error) {
            errorLog('addVariable函数调用失败:', error);
        }
    });

    // 删除模块按钮事件
    moduleItem.find('.remove-module').on('click', function () {
        if (confirm('确定要删除这个模块吗？')) {
            moduleItem.closest('.custom-modules-container > div').remove();
            // 更新所有模块的排序数字
            updateModuleOrderNumbers();
        }
    });

    // 上移模块按钮事件
    moduleItem.find('.move-module-up').on('click', function () {
        const currentModule = moduleItem.closest('.custom-modules-container > div');
        // 更精确的选择器：只选择包含.module-item的div，排除标题和模板
        const allModules = $('.custom-modules-container > div').has('.module-item').not('.section-title, .module-template');
        const currentIndex = allModules.index(currentModule);

        if (currentIndex > 0) {
            // 将当前模块与前一个模块交换位置
            const prevModule = allModules.eq(currentIndex - 1);
            currentModule.insertBefore(prevModule);
            debugLog('模块上移成功');
            // 更新所有模块的排序数字
            updateModuleOrderNumbers();
        } else {
            debugLog('已是第一个模块，无法上移');
        }
    });

    // 下移模块按钮事件
    moduleItem.find('.move-module-down').on('click', function () {
        const currentModule = moduleItem.closest('.custom-modules-container > div');
        // 更精确的选择器：只选择包含.module-item的div，排除标题和模板
        const allModules = $('.custom-modules-container > div').has('.module-item').not('.section-title, .module-template');
        const currentIndex = allModules.index(currentModule);

        if (currentIndex < allModules.length - 1) {
            // 将当前模块与后一个模块交换位置
            const nextModule = allModules.eq(currentIndex + 1);
            currentModule.insertAfter(nextModule);
            debugLog('模块下移成功');
            // 更新所有模块的排序数字
            updateModuleOrderNumbers();
        } else {
            debugLog('已是最后一个模块，无法下移');
        }
    });

    // 已有的变量事件绑定
    moduleItem.find('.variable-item').each(function () {
        const variableItem = $(this);

        // 先解绑事件
        variableItem.find('input').off('input');
        variableItem.find('.remove-variable').off('click');

        // 变量输入事件
        variableItem.find('input').on('input', function () {
            updateModulePreview(moduleItem);
        });

        // 删除变量事件
        variableItem.find('.remove-variable').on('click', function () {
            variableItem.remove();
            updateModulePreview(moduleItem);
            // 更新变量数量
            updateVariableCount();
        });
    });

    // 更新排序数字
    updateModuleOrderNumbers();
}

/**
 * 获取模块数据
 * @returns {Array} 模块配置数组
 */
export function getModulesData() {
    const modules = [];

    // 首先尝试从DOM中获取模块数据（如果配置面板已打开）
    if ($('.module-item').length > 0) {
        // 收集所有模块数据
        $('.module-item').each(function (index) {
            const moduleName = $(this).find('.module-name').val();
            if (!moduleName) return; // 跳过没有名称的模块

            // 获取模块启用状态（默认为true）
            const isEnabled = $(this).find('.module-enabled-toggle').prop('checked') !== false;

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

            // 获取模块提示词
            const modulePrompt = $(this).find('.module-prompt-input').val();

            // 获取新的配置项
            const contentPrompt = $(this).find('.module-content-prompt-input').val();
            const outputPosition = $(this).find('.module-output-position').val();
            const itemLimit = parseInt($(this).find('.module-item-limit').val()) || -1;

            modules.push({
                name: moduleName,
                enabled: isEnabled,
                variables: variables,
                prompt: modulePrompt || '',
                contentPrompt: contentPrompt || '',
                outputPosition: outputPosition || 'body',
                itemLimit: itemLimit,
                order: index // 添加排序索引
            });
        });
    }

    // 如果DOM中没有模块数据，则从本地存储加载
    if (modules.length === 0) {
        try {
            const configStr = localStorage.getItem('continuity_module_config');
            if (configStr) {
                const config = JSON.parse(configStr);
                if (config.modules && Array.isArray(config.modules)) {
                    // 确保每个模块都有启用状态（默认为true）
                    const modulesWithEnabledState = config.modules.map(module => ({
                        ...module,
                        enabled: module.enabled !== false // 如果未定义enabled，默认为true
                    }));
                    modules.push(...modulesWithEnabledState);
                    debugLog('从本地存储加载模块配置:', modules.length, '个模块');
                }
            }
        } catch (error) {
            errorLog('从本地存储加载模块配置失败:', error);
        }
    }

    return modules;
}
