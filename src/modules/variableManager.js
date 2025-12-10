// 变量管理相关功能
import { debugLog, errorLog, updateModulePreview } from "../index.js";
import { getEmptyVariableItemTemplate } from "./templateManager.js";
import configManager from "../singleton/configManager.js";

/**
 * 添加新变量到模块
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 */
export function addVariable(moduleItem) {
    debugLog('addVariable函数开始执行');
    debugLog('传入的moduleItem:', moduleItem);
    debugLog('moduleItem长度:', moduleItem.length);
    debugLog('moduleItem选择器:', moduleItem.selector || '无选择器');

    // 检查变量容器
    const variablesContainer = moduleItem.find('.variables-container');
    debugLog('找到的变量容器数量:', variablesContainer.length);

    if (variablesContainer.length === 0) {
        errorLog('[Continuity] 未找到变量容器');
        return;
    }

    // 使用模板管理模块创建新的变量项HTML
    const variableItemHTML = getEmptyVariableItemTemplate();

    debugLog('创建变量项HTML成功');

    // 将HTML转换为jQuery对象
    const variableItem = $(variableItemHTML);
    debugLog('变量项创建成功');
    debugLog('变量项类名:', variableItem.attr('class'));

    variablesContainer.append(variableItem);
    debugLog('变量项添加到容器成功');

    // 检查添加后的容器内容
    debugLog('添加后容器内.variable-item数量:', variablesContainer.find('.variable-item').length);
    // debugLog('添加后容器内HTML:', variablesContainer.html());

    // 使用bindVariableEvents函数绑定所有事件（包括删除变量事件）
    bindVariableEvents(variableItem, moduleItem);

    // 绑定变量拖拽事件
    bindVariableDragEvents(variableItem, moduleItem);

    // 更新变量序号
    updateVariableOrderNumbers(variablesContainer);

    // 根据✨按钮的状态设置新变量的自定义样式框显隐
    const toggleBtn = moduleItem.find('.module-custom-styles-toggle-btn');
    const isVisible = toggleBtn.attr('data-custom-styles-visible') === 'true';
    const newVariableCustomStylesGroup = variableItem.find('.variable-custom-styles-group');
    if (!isVisible) {
        newVariableCustomStylesGroup.hide();
    }

    // 更新预览
    updateModulePreview(moduleItem);

    // 检查是否需要显示标识符警告
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

    debugLog('addVariable函数执行完成');
}

/**
 * 为变量项绑定事件
 * @param {JQuery<HTMLElement>} variableItem 变量项jQuery对象
 * @param {JQuery<HTMLElement>} moduleItem 所属模块jQuery对象
 */
export function bindVariableEvents(variableItem, moduleItem) {
    // 先解绑事件
    variableItem.find('input, textarea').off('input');
    variableItem.find('.remove-variable').off('click');

    // 检查是否需要显示标识符警告
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

    // 变量输入事件
    variableItem.find('input, textarea').on('input', function () {
        debugLog('变量输入框内容变化');
        updateModulePreview(moduleItem);

        // 检查是否需要显示标识符警告
        checkIdentifierWarning();

        // 自动保存配置
        configManager.autoSave();
    });

    // 删除变量事件
    variableItem.find('.remove-variable').on('click', function () {
        debugLog('删除变量按钮被点击');
        variableItem.remove();
        updateModulePreview(moduleItem);
        // 更新变量数量显示
        const variableCount = moduleItem.find('.variable-item').filter(function () {
            return $(this).closest('.variable-template').length === 0;
        }).length;
        const countElement = moduleItem.find('.toggle-variables .variable-count');
        countElement.text(`(${variableCount})`);

        // 检查是否需要显示标识符警告
        checkIdentifierWarning();

        // 自动保存配置
        configManager.autoSave();
    });

    // 主标识符按钮事件
    variableItem.find('.variable-identifier-btn').on('click', function () {
        // debugLog('主标识符按钮被点击');
        const isIdentifierInput = variableItem.find('.variable-is-identifier');
        // debugLog('找到的isIdentifierInput:', isIdentifierInput);
        // debugLog('isIdentifierInput长度:', isIdentifierInput.length);
        const currentValue = isIdentifierInput.val() === 'true';
        // debugLog('当前值:', currentValue);
        const newValue = !currentValue;
        isIdentifierInput.val(newValue);
        // debugLog('新值:', isIdentifierInput.val());

        if (newValue) {
            // 如果选择了主标识符，取消选择备用标识符
            const backupIdentifierBtn = variableItem.find('.variable-backup-identifier-btn');
            const backupIdentifierInput = variableItem.find('.variable-is-backup-identifier');
            backupIdentifierBtn.removeClass('active');
            backupIdentifierBtn.find('.variable-order-number').css('background-color', 'rgba(255, 255, 255, 0.2)');
            backupIdentifierInput.val('false');
        }

        // 切换激活状态样式
        const button = $(this);
        if (!currentValue) {
            button.addClass('active');
            debugLog('添加active类');
            // 设置激活状态背景色
            button.find('.variable-order-number').css('background-color', 'rgba(100, 200, 100, 0.6)');
        } else {
            button.removeClass('active');
            debugLog('移除active类');
            // 恢复默认背景色
            button.find('.variable-order-number').css('background-color', 'rgba(255, 255, 255, 0.2)');
        }

        updateModulePreview(moduleItem);

        // 检查是否需要显示标识符警告
        checkIdentifierWarning();

        // 自动保存配置
        configManager.autoSave();
    });

    // 备用标识符按钮事件
    variableItem.find('.variable-backup-identifier-btn').on('click', function () {
        const isBackupIdentifierInput = variableItem.find('.variable-is-backup-identifier');
        const currentValue = isBackupIdentifierInput.val() === 'true';
        isBackupIdentifierInput.val(!currentValue);

        // 切换激活状态样式
        const button = $(this);
        if (!currentValue) {
            button.addClass('active');
            // 设置激活状态背景色
            button.find('.variable-order-number').css('background-color', 'rgba(200, 150, 50, 0.6)');
        } else {
            button.removeClass('active');
            // 恢复默认背景色
            button.find('.variable-order-number').css('background-color', 'rgba(255, 255, 255, 0.2)');
        }

        updateModulePreview(moduleItem);

        // 检查是否需要显示标识符警告
        checkIdentifierWarning();

        // 自动保存配置
        configManager.autoSave();
    });

    // 隐藏条件按钮事件
    variableItem.find('.variable-hide-condition-btn').on('click', function () {
        const isHideConditionInput = variableItem.find('.variable-is-hide-condition');
        const currentValue = isHideConditionInput.val() === 'true';
        isHideConditionInput.val(!currentValue);

        // 切换激活状态样式
        const button = $(this);
        const descGroup = variableItem.find('.variable-desc-group');
        const descInput = descGroup.find('.variable-desc').first();
        const hideConditionInput = descGroup.find('.variable-desc').last();

        if (!currentValue) {
            button.addClass('active');
            // 设置激活状态背景色
            button.find('.variable-order-number').css('background-color', 'rgba(150, 150, 255, 0.6)');
            // 显示隐藏条件值输入框
            hideConditionInput.show();
            // 调整描述输入框宽度
            descInput.css('flex', '3');
        } else {
            button.removeClass('active');
            // 恢复默认背景色
            button.find('.variable-order-number').css('background-color', 'rgba(255, 255, 255, 0.2)');
            // 隐藏隐藏条件值输入框
            hideConditionInput.hide();
            // 恢复描述输入框宽度
            descInput.css('flex', '1');
        }

        updateModulePreview(moduleItem);
        // 自动保存配置
        configManager.autoSave();
    });

    // 隐藏条件按钮事件
    variableItem.find('.variable-enabled-btn').on('click', function () {
        const isEnabled = variableItem.find('.variable-enabled');
        const currentValue = isEnabled.val() === 'true';
        isEnabled.val(!currentValue);

        // 切换激活状态样式
        const button = $(this);

        if (!currentValue) {
            button.addClass('active');
            // 设置激活状态背景色
            button.find('.variable-order-number').css('background-color', 'rgba(100, 200, 100, 0.6)');
        } else {
            button.removeClass('active');
            // 恢复默认背景色
            button.find('.variable-order-number').css('background-color', 'rgba(255, 255, 255, 0.2)');
        }

        updateModulePreview(moduleItem);
        // 自动保存配置
        configManager.autoSave();
    });

    const isEnabledBtn = variableItem.find('.variable-enabled-btn');
    if (variableItem.find('.variable-enabled').val() === 'true') {
        isEnabledBtn.addClass('active');
        isEnabledBtn.find('.variable-order-number').css('background-color', 'rgba(100, 200, 100, 0.6)');
    }

    // 初始化激活状态
    const identifierBtn = variableItem.find('.variable-identifier-btn');
    if (variableItem.find('.variable-is-identifier').val() === 'true') {
        identifierBtn.addClass('active');
        identifierBtn.find('.variable-order-number').css('background-color', 'rgba(100, 200, 100, 0.6)');
    }

    const backupIdentifierBtn = variableItem.find('.variable-backup-identifier-btn');
    if (variableItem.find('.variable-is-backup-identifier').val() === 'true') {
        backupIdentifierBtn.addClass('active');
        backupIdentifierBtn.find('.variable-order-number').css('background-color', 'rgba(200, 150, 50, 0.6)');
    }

    const hideConditionBtn = variableItem.find('.variable-hide-condition-btn');
    const descInput = variableItem.find('.variable-desc').first();
    const hideConditionValuesInput = variableItem.find('.variable-desc').last();

    if (variableItem.find('.variable-is-hide-condition').val() === 'true') {
        hideConditionBtn.addClass('active');
        hideConditionBtn.find('.variable-order-number').css('background-color', 'rgba(150, 150, 255, 0.6)');
        hideConditionValuesInput.show();
        hideConditionValuesInput.css('max-width', '200px');
        descInput.css('flex', '3');
    } else {
        hideConditionBtn.removeClass('active');
        hideConditionBtn.find('.variable-order-number').css('background-color', 'rgba(255, 255, 255, 0.2)');
        hideConditionValuesInput.hide();
        descInput.css('flex', '1');
    }
}

/**
 * 为变量项绑定拖拽事件
 * @param {JQuery<HTMLElement>} variableItem 变量项jQuery对象
 * @param {JQuery<HTMLElement>} moduleItem 所属模块jQuery对象
 */
export function bindVariableDragEvents(variableItem, moduleItem) {
    // 先解绑拖拽事件
    variableItem.find('.variable-drag-handle').off('mousedown touchstart');

    // 变量拖拽手柄事件
    variableItem.find('.variable-drag-handle').on('mousedown touchstart', function (e) {
        startVariableDragging(variableItem, moduleItem, e);
        e.preventDefault();
        e.stopPropagation();
    });
}

/**
 * 开始拖拽变量
 * @param {jQuery} variableItem 变量项jQuery对象
 * @param {jQuery} moduleItem 所属模块jQuery对象
 * @param {Event} e 事件对象
 */
function startVariableDragging(variableItem, moduleItem, e) {
    let isDragging = false;
    let dragStartY = e.type === 'touchstart' ? e.originalEvent.touches[0].clientY : e.clientY;
    const variablesContainer = variableItem.closest('.variables-container');

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

        // 更新模块预览
        updateModulePreview(moduleItem);

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
export function updateVariableOrderNumbers(variablesContainer) {
    // 只处理可见的变量项，排除隐藏的模板
    variablesContainer.find('.variable-item').filter(function () {
        return $(this).closest('.variable-template').length === 0;
    }).each(function (index) {
        const orderNumber = index + 1;
        // 更新变量项最左侧的启用按钮中的序号
        $(this).find('.variable-order-group > .variable-enabled-btn > .variable-order-number').text(orderNumber);
    });
}
