// 模块管理相关功能
import { debugLog, errorLog, addVariable, initParseModule, showCustomConfirmDialog } from "../index.js";
import { saveModuleConfig } from "./moduleConfigManager.js";
import { loadModuleConfigFromExtension } from "./moduleStorageManager.js";

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

    // 初始化范围模式显示状态（默认指定数量模式）
    const moduleItem = template.find('.module-item');
    const rangeModeSelect = moduleItem.find('.module-range-mode');
    const rangeInputGroup = moduleItem.find('.range-input-group');
    const minInput = moduleItem.find('.module-item-min');
    const maxInput = moduleItem.find('.module-item-specified');
    const separator = moduleItem.find('.range-separator');

    // 设置默认指定数量模式并显示输入框
    rangeModeSelect.val('specified');
    rangeInputGroup.show();
    minInput.hide();
    separator.hide();
    maxInput.show().val(1);

    // 初始化变量序号显示
    const variablesContainer = moduleItem.find('.variables-container');
    if (variablesContainer.length > 0) {
        // 先移除隐藏的变量模板，避免影响序号计算
        variablesContainer.find('.variable-template').remove();
        updateVariableOrderNumbers(variablesContainer);
    }

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
        return varName + ':';
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
    moduleItem.find('.add-variable').off('click');
    moduleItem.find('.remove-module').off('click');
    moduleItem.find('.variable-item input').off('input');
    moduleItem.find('.variable-item .remove-variable').off('click');
    moduleItem.find('.module-enabled-toggle').off('change');
    moduleItem.find('.drag-handle').off('mousedown touchstart');

    // 绑定模块名称输入事件
    moduleItem.find('.module-name').on('input', function () {
        updateModulePreview(moduleItem);
        // 自动保存配置
        autoSaveModuleConfig();
    });

    // 绑定模块提示词输入事件
    moduleItem.find('.module-prompt-input, .module-content-prompt-input').on('input', function () {
        // 自动保存配置
        autoSaveModuleConfig();
    });

    // 绑定范围模式选择事件
    moduleItem.find('.module-range-mode').on('change', function () {
        const mode = $(this).val();
        const rangeInputGroup = moduleItem.find('.range-input-group');
        const minInput = moduleItem.find('.module-item-min');
        const maxInput = moduleItem.find('.module-item-specified');
        const separator = moduleItem.find('.range-separator');

        // 根据模式显示/隐藏输入框并设置默认值
        switch (mode) {
            case 'unlimited':
                rangeInputGroup.hide();
                minInput.val(0);
                maxInput.val(0);
                break;
            case 'specified':
                rangeInputGroup.show();
                minInput.hide();
                separator.hide();
                maxInput.show().val(1);
                break;
            case 'range':
                rangeInputGroup.show();
                minInput.show().val(0);
                separator.show();
                maxInput.show().val(1);
                break;
        }

        // 自动保存配置
        autoSaveModuleConfig();
    });

    // 绑定数量范围输入事件
    moduleItem.find('.module-item-min, .module-item-specified').on('input', function () {
        // 自动保存配置
        autoSaveModuleConfig();
    });

    // 绑定生成位置选择事件
    moduleItem.find('.module-output-position').on('change', function () {
        // 自动保存配置
        autoSaveModuleConfig();
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
        // 自动保存配置
        autoSaveModuleConfig();
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
            // 展开变量时更新序号显示
            updateVariableOrderNumbers(wrapper.find('.variables-container'));
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
        // 显示自定义确认弹窗
        showCustomConfirmDialog(
            '删除模块',
            '确定要删除这个模块吗？',
            function () {
                // 用户确认删除
                moduleItem.closest('.custom-modules-container > div').remove();
                // 更新所有模块的排序数字
                updateModuleOrderNumbers();
            },
            function () {
                // 用户取消删除
                console.log('用户取消了模块删除操作');
            }
        );
    });

    // 拖拽手柄事件
    moduleItem.find('.drag-handle').on('mousedown touchstart', function (e) {
        const moduleContainer = moduleItem.closest('.custom-modules-container > div');
        startDragging(moduleContainer, e);
        e.preventDefault();
        e.stopPropagation();
    });

    // 已有的变量事件绑定
    moduleItem.find('.variable-item').each(function () {
        const variableItem = $(this);

        // 先解绑事件
        variableItem.find('input').off('input');
        variableItem.find('.remove-variable').off('click');
        variableItem.find('.variable-drag-handle').off('mousedown touchstart');

        // 变量输入事件
        variableItem.find('input').on('input', function () {
            updateModulePreview(moduleItem);
            // 自动保存配置
            autoSaveModuleConfig();
        });

        // 删除变量事件
        variableItem.find('.remove-variable').on('click', function () {
            variableItem.remove();
            updateModulePreview(moduleItem);
            // 更新变量数量
            updateVariableCount();
        });

        // 变量拖拽手柄事件
        variableItem.find('.variable-drag-handle').on('mousedown touchstart', function (e) {
            const variablesContainer = variableItem.closest('.variables-container');
            startVariableDragging(variableItem, variablesContainer, e);
            e.preventDefault();
            e.stopPropagation();
        });
    });

    // 更新排序数字
    updateModuleOrderNumbers();

}

/**
 * 自动保存模块配置
 */
function autoSaveModuleConfig() {
    // 使用防抖机制，避免频繁保存
    if (window.autoSaveTimeout) {
        clearTimeout(window.autoSaveTimeout);
    }

    window.autoSaveTimeout = setTimeout(() => {
        const modules = getModulesData();
        saveModuleConfig(modules);
        debugLog('配置已自动保存');
    }, 1000); // 1秒后保存
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

            // 获取模块显示名和兼容模块名
            const moduleDisplayName = $(this).find('.module-display-name').val();
            const moduleCompatibleNames = $(this).find('.module-compatible-names').val();

            const variables = [];
            $(this).find('.variable-item').each(function () {
                const varName = $(this).find('.variable-name').val();
                const varDesc = $(this).find('.variable-desc').val();
                const varDisplayName = $(this).find('.variable-display-name').val();
                const varCompatibleNames = $(this).find('.variable-compatible-names').val();

                if (varName) {
                    variables.push({
                        name: varName,
                        description: varDesc,
                        displayName: varDisplayName || '',
                        compatibleVariableNames: varCompatibleNames || ''
                    });
                }
            });

            // 获取模块提示词
            const modulePrompt = $(this).find('.module-prompt-input').val();

            // 获取新的配置项
            const contentPrompt = $(this).find('.module-content-prompt-input').val();
            const outputPosition = $(this).find('.module-output-position').val();
            const itemMin = parseInt($(this).find('.module-item-min').val()) || 0;
            const itemMax = parseInt($(this).find('.module-item-specified').val()) || -1;

            modules.push({
                name: moduleName,
                displayName: moduleDisplayName || '',
                compatibleModuleNames: moduleCompatibleNames || '',
                enabled: isEnabled,
                variables: variables,
                prompt: modulePrompt || '',
                contentPrompt: contentPrompt || '',
                outputPosition: outputPosition || 'body',
                itemMin: itemMin,
                itemMax: itemMax,
                order: index // 添加排序索引
            });
        });
    }

    // 如果DOM中没有模块数据，则从扩展设置加载
    if (modules.length === 0) {
        try {
            // 使用新的扩展设置API加载配置
            const config = loadModuleConfigFromExtension();
            if (config && config.modules && Array.isArray(config.modules)) {
                // 确保每个模块都有启用状态（默认为true）
                const modulesWithEnabledState = config.modules.map(module => ({
                    ...module,
                    enabled: module.enabled !== false // 如果未定义enabled，默认为true
                }));
                modules.push(...modulesWithEnabledState);
                debugLog('从扩展设置加载模块配置:', modules.length, '个模块');
            } else {
                // 降级处理：尝试从旧版localStorage加载
                const configStr = localStorage.getItem('continuity_module_config');
                if (configStr) {
                    const oldConfig = JSON.parse(configStr);
                    if (oldConfig.modules && Array.isArray(oldConfig.modules)) {
                        // 确保每个模块都有启用状态（默认为true）
                        const modulesWithEnabledState = oldConfig.modules.map(module => ({
                            ...module,
                            enabled: module.enabled !== false // 如果未定义enabled，默认为true
                        }));
                        modules.push(...modulesWithEnabledState);
                        debugLog('从本地存储加载模块配置:', modules.length, '个模块');
                    }
                }
            }
        } catch (error) {
            errorLog('加载模块配置失败:', error);
        }
    }

    return modules;
}

/**
 * 开始拖拽模块
 * @param {jQuery} moduleContainer 模块容器jQuery对象
 * @param {Event} e 事件对象
 */
function startDragging(moduleContainer, e) {
    let isDragging = false;
    let dragStartY = e.type === 'touchstart' ? e.originalEvent.touches[0].clientY : e.clientY;

    // 添加拖拽样式
    moduleContainer.addClass('dragging');
    moduleContainer.css({
        'cursor': 'grabbing',
        'opacity': '0.7',
        'transform': 'scale(1.02)',
        'z-index': '1000',
        'box-shadow': '0 4px 12px rgba(0, 0, 0, 0.3)'
    });

    // 添加拖拽占位符
    const placeholder = $('<div class="drag-placeholder"></div>');
    placeholder.css({
        'height': moduleContainer.outerHeight() + 'px',
        'background-color': 'rgba(255, 255, 255, 0.1)',
        'border': '2px dashed rgba(255, 255, 255, 0.3)',
        'border-radius': '6px',
        'margin': '5px 0'
    });
    moduleContainer.before(placeholder);

    isDragging = true;

    // 绑定拖拽移动事件
    $(document).on('mousemove touchmove', handleDragMove);
    $(document).on('mouseup touchend', handleDragEnd);

    debugLog('开始拖拽模块');

    /**
     * 处理拖拽移动
     */
    function handleDragMove(e) {
        if (!isDragging) return;

        const currentY = e.type === 'touchmove' ? e.originalEvent.touches[0].clientY : e.clientY;
        const allModules = $('.custom-modules-container > div').has('.module-item').not('.section-title, .module-template, .dragging');
        const placeholder = $('.drag-placeholder');

        // 找到最接近的模块位置
        let targetIndex = -1;
        allModules.each(function (index) {
            const moduleRect = this.getBoundingClientRect();
            const moduleCenterY = moduleRect.top + moduleRect.height / 2;

            if (currentY < moduleCenterY) {
                targetIndex = index;
                return false; // 退出循环
            }
        });

        // 如果没找到合适位置，放在最后
        if (targetIndex === -1) {
            targetIndex = allModules.length;
        }

        // 移动占位符到目标位置
        if (targetIndex < allModules.length) {
            placeholder.insertBefore(allModules.eq(targetIndex));
        } else {
            placeholder.insertAfter(allModules.last());
        }
    }

    /**
     * 处理拖拽结束
     */
    function handleDragEnd(e) {
        if (!isDragging) return;

        const placeholder = $('.drag-placeholder');
        const draggingModule = $('.dragging');

        // 将模块移动到占位符位置
        if (placeholder.length > 0) {
            draggingModule.insertAfter(placeholder);
            placeholder.remove();
        }

        // 移除拖拽样式
        draggingModule.removeClass('dragging');
        draggingModule.css({
            'cursor': '',
            'opacity': '',
            'transform': '',
            'z-index': '',
            'box-shadow': ''
        });

        // 更新模块顺序
        updateModuleOrderNumbers();

        // 保存模块配置到本地存储
        const modules = getModulesData();
        saveModuleConfig(modules);

        // 移除事件监听
        $(document).off('mousemove touchmove', handleDragMove);
        $(document).off('mouseup touchend', handleDragEnd);

        isDragging = false;
        debugLog('拖拽结束，模块位置已更新');
    }
}

/**
 * 开始拖拽变量
 * @param {jQuery} variableItem 变量项jQuery对象
 * @param {jQuery} variablesContainer 变量容器jQuery对象
 * @param {Event} e 事件对象
 */
function startVariableDragging(variableItem, variablesContainer, e) {
    let isDragging = false;
    let dragStartY = e.type === 'touchstart' ? e.originalEvent.touches[0].clientY : e.clientY;

    // 添加拖拽样式
    variableItem.addClass('dragging');
    variableItem.css({
        'cursor': 'grabbing',
        'opacity': '0.7',
        'transform': 'scale(1.02)',
        'z-index': '1000',
        'box-shadow': '0 4px 12px rgba(0, 0, 0, 0.3)'
    });

    // 添加拖拽占位符
    const placeholder = $('<div class="variable-drag-placeholder"></div>');
    placeholder.css({
        'height': variableItem.outerHeight() + 'px',
        'background-color': 'rgba(255, 255, 255, 0.1)',
        'border': '2px dashed rgba(255, 255, 255, 0.3)',
        'border-radius': '4px',
        'margin': '3px 0'
    });
    variableItem.before(placeholder);

    isDragging = true;

    // 绑定拖拽移动事件
    $(document).on('mousemove touchmove', handleDragMove);
    $(document).on('mouseup touchend', handleDragEnd);

    debugLog('开始拖拽变量');

    /**
     * 处理拖拽移动
     */
    function handleDragMove(e) {
        if (!isDragging) return;

        const currentY = e.type === 'touchmove' ? e.originalEvent.touches[0].clientY : e.clientY;
        const allVariables = variablesContainer.find('.variable-item').not('.dragging');
        const placeholder = $('.variable-drag-placeholder');

        // 找到最接近的变量位置
        let targetIndex = -1;
        allVariables.each(function (index) {
            const variableRect = this.getBoundingClientRect();
            const variableCenterY = variableRect.top + variableRect.height / 2;

            if (currentY < variableCenterY) {
                targetIndex = index;
                return false; // 退出循环
            }
        });

        // 如果没找到合适位置，放在最后
        if (targetIndex === -1) {
            targetIndex = allVariables.length;
        }

        // 移动占位符到目标位置
        if (targetIndex < allVariables.length) {
            placeholder.insertBefore(allVariables.eq(targetIndex));
        } else {
            placeholder.insertAfter(allVariables.last());
        }
    }

    /**
     * 处理拖拽结束
     */
    function handleDragEnd(e) {
        if (!isDragging) return;

        const placeholder = $('.variable-drag-placeholder');
        const draggingVariable = $('.dragging');

        // 将变量移动到占位符位置
        if (placeholder.length > 0) {
            draggingVariable.insertAfter(placeholder);
            placeholder.remove();
        }

        // 移除拖拽样式
        draggingVariable.removeClass('dragging');
        draggingVariable.css({
            'cursor': '',
            'opacity': '',
            'transform': '',
            'z-index': '',
            'box-shadow': ''
        });

        // 更新变量顺序
        updateVariableOrderNumbers(variablesContainer);

        // 自动保存配置
        autoSaveModuleConfig();

        // 移除事件监听
        $(document).off('mousemove touchmove', handleDragMove);
        $(document).off('mouseup touchend', handleDragEnd);

        isDragging = false;
        debugLog('拖拽结束，变量位置已更新');
    }
}

/**
 * 更新变量顺序数字
 * @param {jQuery} variablesContainer 变量容器jQuery对象
 */
function updateVariableOrderNumbers(variablesContainer) {
    // 只处理可见的变量项，排除隐藏的模板
    variablesContainer.find('.variable-item').filter(function () {
        return $(this).closest('.variable-template').length === 0;
    }).each(function (index) {
        const orderNumber = index + 1;
        $(this).find('.variable-order-number').text(orderNumber);
    });
}
