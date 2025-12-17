// 模块配置管理器 - 用于管理模块的添加、编辑、删除等操作
import { debugLog, errorLog, addVariable, showCustomConfirmDialog, bindVariableEvents } from "../index.js";
import { default as configManager } from "../singleton/configManager.js";

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
        // 检查变量是否启用（variable-enabled的值为'true'）
        const isEnabled = $(this).find('.variable-enabled').val() === 'true';
        if (isEnabled) {
            const varName = $(this).find('.variable-name').val() || '变量名';
            // 检查标识符状态和隐藏条件状态
            const isIdentifier = $(this).find('.variable-is-identifier').val() === 'true';
            const isBackupIdentifier = $(this).find('.variable-is-backup-identifier').val() === 'true';
            const isHideCondition = $(this).find('.variable-is-hide-condition').val() === 'true';

            let prefix = '';
            if (isIdentifier) {
                prefix = '*';
            } else if (isBackupIdentifier) {
                prefix = '^';
            } else if (isHideCondition) {
                prefix = '~';
            }

            return prefix + varName + ':';
        }
        return null; // 返回null表示跳过此变量
    }).get().filter(variable => variable !== null); // 过滤掉null值

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
        moduleNameGroup.find('.module-toggle-expand-btn').remove();
        // 添加新的展开/折叠按钮
        moduleNameGroup.prepend(`
            <button class="module-toggle-expand-btn" title="展开/折叠模块">
                <span class="module-order-number">${index + 1}</span>
            </button>
        `);

        // 绑定展开/折叠按钮事件
        const toggleBtn = moduleNameGroup.find('.module-toggle-expand-btn');
        toggleBtn.off('click').on('click', function () {
            if (moduleItem.hasClass('collapsed')) {
                // 展开模块
                moduleItem.removeClass('collapsed').addClass('expanded');
                // 保存展开状态到localStorage
                saveModuleCollapsedState(moduleItem, false);
            } else {
                // 折叠模块
                moduleItem.removeClass('expanded').addClass('collapsed');
                // 保存折叠状态到localStorage
                saveModuleCollapsedState(moduleItem, true);
            }
        });

        // 默认展开状态
        if (!moduleItem.hasClass('collapsed') && !moduleItem.hasClass('expanded')) {
            moduleItem.addClass('expanded');
        }
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
    moduleItem.find('.module-time-reference-standard-btn').off('click');
    moduleItem.find('.module-external-display-btn').off('click');
    moduleItem.find('.drag-handle').off('mousedown touchstart');

    // 绑定模块名称输入事件
    moduleItem.find('.module-name').on('input', function () {
        updateModulePreview(moduleItem);
        // 自动保存配置
        configManager.autoSave();
    });

    // 绑定模块提示词输入事件
    moduleItem.find('.module-prompt-input, .module-content-prompt-input').on('input', function () {
        // 自动保存配置
        configManager.autoSave();
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
        configManager.autoSave();
    });

    // 检查模块是否需要显示标识符警告
    function checkIdentifierWarning() {
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

        if (outputMode === 'incremental' && !hasAnyIdentifier) {
            warningElement.show();
        } else {
            warningElement.hide();
        }
    }

    // 绑定输出模式选择事件，控制保留层数输入框的显示/隐藏和标识符警告
    moduleItem.find('.module-output-mode').on('change', function () {
        const mode = $(this).val();
        const retainLayersInput = moduleItem.find('.module-retain-layers');

        if (mode === 'full') {
            retainLayersInput.show();
        } else {
            retainLayersInput.hide();
        }

        // 检查是否需要显示标识符警告
        checkIdentifierWarning();

        // 自动保存配置
        configManager.autoSave();
    });

    // 初始状态下根据输出模式设置保留层数输入框的显示/隐藏
    const initialOutputMode = moduleItem.find('.module-output-mode').val();
    const initialRetainLayersInput = moduleItem.find('.module-retain-layers');
    if (initialOutputMode !== 'full') {
        initialRetainLayersInput.hide();
    }

    // 初始化时检查是否需要显示标识符警告
    checkIdentifierWarning();

    // 绑定数量范围输入事件
    moduleItem.find('.module-item-min, .module-item-specified, .module-retain-layers').on('input', function () {
        // 自动保存配置
        configManager.autoSave();
    });

    // 绑定生成位置选择事件
    moduleItem.find('.module-output-position').on('change', function () {
        const positionSelect = $(this);
        const positionPromptInput = positionSelect.siblings('.module-position-prompt');

        // 显示/隐藏顺序提示词输入框
        if (positionSelect.val() === 'specific_position') {
            positionPromptInput.show();
        } else {
            positionPromptInput.hide();
        }

        // 自动保存配置
        configManager.autoSave();
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
        configManager.autoSave();
    });

    // 时间参考标准按钮点击事件
    moduleItem.find('.module-time-reference-standard-btn').on('click', function () {
        const button = $(this);
        const moduleItem = button.closest('.module-item');
        const hiddenInput = moduleItem.find('.module-time-reference-standard');

        // 切换状态
        const currentState = hiddenInput.val() === 'true';
        const newState = !currentState;

        // 更新隐藏输入框的值
        hiddenInput.val(newState.toString());

        // 更新按钮状态
        button.attr('data-time-reference-standard', newState.toString());
        if (newState) {
            button.addClass('active');
        } else {
            button.removeClass('active');
        }

        debugLog('时间参考标准状态改变:', moduleItem.find('.module-name').val(), newState);
        // 自动保存配置
        configManager.autoSave();
    });

    // 外部显示按钮点击事件
    moduleItem.find('.module-external-display-btn').on('click', function () {
        const button = $(this);
        const moduleItem = button.closest('.module-item');
        const hiddenInput = moduleItem.find('.module-is-external-display');

        // 切换状态
        const currentState = hiddenInput.val() === 'true';
        const newState = !currentState;

        // 更新隐藏输入框的值
        hiddenInput.val(newState.toString());

        // 更新按钮状态
        button.attr('data-external-display', newState.toString());
        if (newState) {
            button.addClass('active');
        } else {
            button.removeClass('active');
        }

        debugLog('外部显示状态改变:', moduleItem.find('.module-name').val(), newState);
        // 自动保存配置
        configManager.autoSave();
    });

    // 样式框显示/隐藏按钮点击事件
    // 先解绑事件，避免重复绑定
    moduleItem.find('.module-custom-styles-toggle-btn').off('click');
    moduleItem.find('.module-custom-styles-toggle-btn').on('click', function () {
        const button = $(this);
        const moduleItem = button.closest('.module-item');
        // 查找所有样式输入框容器（包括容器样式和自定义样式）
        const styleSections = moduleItem.find('.module-settings-inline:has(.module-container-styles), .module-settings-inline:has(.module-custom-styles)');
        // 查找所有变量级自定义样式框
        const variableCustomStylesGroups = moduleItem.find('.variable-custom-styles-group');

        // 切换状态
        const currentVisible = button.attr('data-custom-styles-visible') === 'true';
        const newVisible = !currentVisible;

        // 更新按钮状态
        button.attr('data-custom-styles-visible', newVisible.toString());
        // 切换激活状态类
        button.toggleClass('active', newVisible);
        if (newVisible) {
            styleSections.show();
            variableCustomStylesGroups.show();
        } else {
            styleSections.hide();
            variableCustomStylesGroups.hide();
        }

        // 保存状态到localStorage
        saveCustomStylesVisibleState(moduleItem, newVisible);
    });

    // 为每个变量项绑定事件
    moduleItem.find('.variable-item').each(function () {
        const variableItem = $(this);
        // 使用从index.js导入的bindVariableEvents函数
        bindVariableEvents(variableItem, moduleItem);
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
        // debugLog('添加变量按钮被点击');
        // debugLog('按钮元素:', this);
        // debugLog('按钮类名:', this.className);
        // debugLog('按钮文本:', this.textContent || this.innerText);
        // debugLog('模块项:', moduleItem);
        // debugLog('模块项长度:', moduleItem.length);
        // debugLog('模块项选择器:', moduleItem.selector || '无选择器');
        // debugLog('当前模块变量数量:', moduleItem.find('.variable-item').length);

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
                debugLog('用户取消了模块删除操作');
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
        // 调用variableManager.js中的bindVariableEvents函数来绑定所有变量事件，包括标识符按钮的事件
        bindVariableEvents(variableItem, moduleItem);

        // 重新绑定拖拽事件（因为bindVariableEvents可能没有包含拖拽事件）
        variableItem.find('.variable-drag-handle').off('mousedown touchstart');
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

/**
 * 清空所有模块
 */
export function clearAllModules() {
    // 显示自定义确认弹窗
    showCustomConfirmDialog(
        '清空所有模块',
        '确定要清空所有模块吗？此操作将删除所有自定义模块，且无法撤销！',
        function () {
            // 用户确认清空 - 只删除模块项，保留标题栏和模板
            // 使用更精确的选择器，确保只删除真正的模块项，保留.module-template
            $('.custom-modules-container > div').not('.section-title, .module-template').remove();
            // 更新模块排序数字
            updateModuleOrderNumbers();
            // 重新绑定所有模块事件
            rebindAllModulesEvents();
            // 更新所有模块的预览
            updateAllModulesPreview();
            toastr.success('所有模块已清空');
        },
        function () {
            // 用户取消清空
            debugLog('用户取消了清空模块操作');
        }
    );
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

        // 使用统一的配置管理器立即保存配置
        configManager.saveImmediately();

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
        configManager.autoSave();

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
        // 只更新变量项最左侧的序号，不影响标识符按钮中的emoji
        $(this).find('.variable-order-group > .variable-order-number:first-child').text(orderNumber);
    });
}

/**
 * 保存模块折叠状态到localStorage
 * @param {jQuery} moduleItem 模块元素
 * @param {boolean} isCollapsed 是否折叠
 */
function saveModuleCollapsedState(moduleItem, isCollapsed) {
    const moduleName = moduleItem.find('.module-name').val();
    if (!moduleName) return;

    // 获取当前保存的折叠状态
    const collapsedStates = JSON.parse(localStorage.getItem('moduleCollapsedStates') || '{}');

    // 更新当前模块的折叠状态
    collapsedStates[moduleName] = isCollapsed;

    // 保存到localStorage
    localStorage.setItem('moduleCollapsedStates', JSON.stringify(collapsedStates));

    debugLog('模块折叠状态已保存:', moduleName, isCollapsed);
}

/**
 * 保存自定义样式框的显示状态到localStorage
 * @param {jQuery} moduleItem 模块元素
 * @param {boolean} isVisible 是否可见
 */
function saveCustomStylesVisibleState(moduleItem, isVisible) {
    const moduleName = moduleItem.find('.module-name').val();
    if (!moduleName) return;

    // 获取当前保存的自定义样式框显示状态
    const customStylesVisibleStates = JSON.parse(localStorage.getItem('moduleCustomStylesVisibleStates') || '{}');

    // 更新当前模块的自定义样式框显示状态
    customStylesVisibleStates[moduleName] = isVisible;

    // 保存到localStorage
    localStorage.setItem('moduleCustomStylesVisibleStates', JSON.stringify(customStylesVisibleStates));

    debugLog('自定义样式框显示状态已保存:', moduleName, isVisible);
}

/**
 * 恢复模块折叠状态
 * @param {jQuery} moduleItem 模块元素
 */
function restoreModuleCollapsedState(moduleItem) {
    const moduleName = moduleItem.find('.module-name').val();
    if (!moduleName) return;

    // 获取保存的折叠状态
    const collapsedStates = JSON.parse(localStorage.getItem('moduleCollapsedStates') || '{}');

    // 如果该模块有保存的折叠状态
    if (collapsedStates.hasOwnProperty(moduleName)) {
        const isCollapsed = collapsedStates[moduleName];
        const toggleBtn = moduleItem.find('.module-toggle-expand-btn');

        if (isCollapsed) {
            // 折叠模块
            moduleItem.removeClass('expanded').addClass('collapsed');
        } else {
            // 展开模块
            moduleItem.removeClass('collapsed').addClass('expanded');
        }

        // debugLog('模块折叠状态已恢复:', moduleName, isCollapsed);
    }
}

// 导出函数
/**
 * 恢复自定义样式框的显示状态
 * @param {jQuery} moduleItem 模块元素
 */
function restoreCustomStylesVisibleState(moduleItem) {
    const moduleName = moduleItem.find('.module-name').val();
    if (!moduleName) return;

    // 获取保存的自定义样式框显示状态
    const customStylesVisibleStates = JSON.parse(localStorage.getItem('moduleCustomStylesVisibleStates') || '{}');

    // 如果该模块有保存的自定义样式框显示状态
    if (customStylesVisibleStates.hasOwnProperty(moduleName)) {
        const isVisible = customStylesVisibleStates[moduleName];
        const toggleBtn = moduleItem.find('.module-custom-styles-toggle-btn');
        // 查找所有样式输入框容器（包括容器样式和自定义样式）
        const styleSections = moduleItem.find('.module-settings-inline:has(.module-container-styles), .module-settings-inline:has(.module-custom-styles)');
        // 查找所有变量级自定义样式框
        const variableCustomStylesGroups = moduleItem.find('.variable-custom-styles-group');

        if (!isVisible) {
            // 隐藏所有样式框
            styleSections.hide();
            variableCustomStylesGroups.hide();
            toggleBtn.attr('data-custom-styles-visible', 'false');
            toggleBtn.removeClass('active');
        } else {
            // 显示所有样式框
            styleSections.show();
            variableCustomStylesGroups.show();
            toggleBtn.attr('data-custom-styles-visible', 'true');
            toggleBtn.addClass('active');
        }

        debugLog('样式框显示状态已恢复:', moduleName, isVisible);
    }
}

export { updateVariableOrderNumbers, restoreModuleCollapsedState, restoreCustomStylesVisibleState };

/**
 * 绑定添加模块按钮事件
 * @param {Function} addModuleCallback 添加模块的回调函数
 */
export function bindAddModuleButtonEvent(addModuleCallback) {
    $('#add-module-btn').off('click');
    $('#add-module-btn').on('click', addModuleCallback);
}

/**
 * 绑定清空模块按钮事件
 * @param {Function} clearModulesCallback 清空模块的回调函数
 */
export function bindClearModulesButtonEvent(clearModulesCallback) {
    // 移除现有的事件监听，避免重复绑定
    $('#clear-modules-btn').off('click');

    // 绑定新的点击事件
    $('#clear-modules-btn').on('click', function (event) {
        event.preventDefault();
        event.stopPropagation();

        if (typeof clearModulesCallback === 'function') {
            clearModulesCallback();
        }
    });
}
