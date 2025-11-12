// 变量管理相关功能
import { debugLog, updateModulePreview } from "../index.js";

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
        console.error('[Continuity] 未找到变量容器');
        return;
    }

    // 创建新的变量项HTML（因为模板是空的）
    const variableItemHTML = `
        <div class="variable-item">
            <div class="variable-name-group">
                <label>变量名</label>
                <input type="text" class="variable-name" placeholder="变量名">
            </div>
            <div class="variable-desc-group">
                <label>变量解释</label>
                <input type="text" class="variable-desc" placeholder="变量含义说明">
            </div>
            <div class="variable-actions">
                <button class="btn-small remove-variable">-</button>
            </div>
        </div>
    `;

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

    // 绑定删除变量事件
    variableItem.find('.remove-variable').on('click', function () {
        debugLog('删除变量按钮被点击');
        $(this).closest('.variable-item').remove();
        updateModulePreview(moduleItem);
    });

    // 绑定输入事件
    variableItem.find('input').on('input', function () {
        debugLog('变量输入框内容变化');
        updateModulePreview(moduleItem);
    });

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
    });
}