// 变量管理相关功能
import { debugLog, errorLog, updateModulePreview } from "../index.js";
import { getEmptyVariableItemTemplate } from "./templateManager.js";

/**
 * 添加新变量到模块
 * @param {JQuery<HTMLElement>} moduleItem 模块项jQuery对象
 */
export function addVariable(moduleItem) {
    console.log('[Continuity] addVariable函数开始执行');
    console.log('[Continuity] 传入的moduleItem:', moduleItem);
    console.log('[Continuity] moduleItem长度:', moduleItem.length);
    console.log('[Continuity] moduleItem选择器:', moduleItem.selector || '无选择器');

    // 检查变量容器
    const variablesContainer = moduleItem.find('.variables-container');
    console.log('[Continuity] 找到的变量容器数量:', variablesContainer.length);

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
    debugLog('添加后容器内HTML:', variablesContainer.html());

    // 使用bindVariableEvents函数绑定所有事件（包括删除变量事件）
    bindVariableEvents(variableItem, moduleItem);

    // 绑定变量拖拽事件
    bindVariableDragEvents(variableItem, moduleItem);

    // 更新变量序号
    updateVariableOrderNumbers(variablesContainer);

    // 更新预览
    updateModulePreview(moduleItem);
    debugLog('addVariable函数执行完成');
}

/**
 * 为变量项绑定事件
 * @param {JQuery<HTMLElement>} variableItem 变量项jQuery对象
 * @param {JQuery<HTMLElement>} moduleItem 所属模块jQuery对象
 */
export function bindVariableEvents(variableItem, moduleItem) {
    // 先解绑事件
    variableItem.find('input').off('input');
    variableItem.find('.remove-variable').off('click');

    // 变量输入事件
    variableItem.find('input').on('input', function () {
        debugLog('变量输入框内容变化');
        updateModulePreview(moduleItem);
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
    });
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
function updateVariableOrderNumbers(variablesContainer) {
    // 只处理可见的变量项，排除隐藏的模板
    variablesContainer.find('.variable-item').filter(function () {
        return $(this).closest('.variable-template').length === 0;
    }).each(function (index) {
        const orderNumber = index + 1;
        $(this).find('.variable-order-number').text(orderNumber);
    });
}
