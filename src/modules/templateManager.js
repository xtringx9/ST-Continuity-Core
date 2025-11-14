// 模板管理模块 - 集中管理所有HTML模板

/**
 * 获取变量项的HTML模板
 * @param {Object} variable 变量对象（可选）
 * @returns {string} 变量项HTML字符串
 */
export function getVariableItemTemplate(variable = {}) {
    const name = variable.name || '';
    const description = variable.description || '';
    const displayName = variable.displayName || '';
    const compatibleNames = variable.compatibleVariableNames || '';

    return `
        <div class="variable-item">
            <div class="variable-order-group">
                <span class="variable-order-number"></span>
            </div>
            <div class="variable-name-group">
                <label>变量名</label>
                <input type="text" class="variable-name" placeholder="变量名" value="${name}">
            </div>
            <div class="variable-display-name-group">
                <label>显示名</label>
                <input type="text" class="variable-display-name" placeholder="显示名" value="${displayName}">
            </div>
            <div class="variable-desc-group">
                <label>描述</label>
                <input type="text" class="variable-desc" placeholder="变量描述" value="${description}">
            </div>
            <div class="variable-compatible-names-group">
                <label>兼容</label>
                <input type="text" class="variable-compatible-names" placeholder="兼容变量名（逗号分隔）" value="${compatibleNames}">
            </div>
            <div class="variable-actions">
                <button class="btn-small remove-variable">-</button>
                <button class="btn-small variable-drag-handle">⋮⋮</button>
            </div>
        </div>
    `;
}

/**
 * 获取空变量项的HTML模板（用于添加新变量）
 * @returns {string} 空变量项HTML字符串
 */
export function getEmptyVariableItemTemplate() {
    return getVariableItemTemplate();
}
