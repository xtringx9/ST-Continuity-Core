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
    const enabled = variable.enabled ?? true;
    const isIdentifier = variable.isIdentifier || false;
    const isBackupIdentifier = variable.isBackupIdentifier || false;
    const isHideCondition = variable.isHideCondition || false;
    const hideConditionValues = variable.hideConditionValues || '';
    const customStyles = variable.customStyles || '';

    return `
        <div class="variable-item">
            <div class="variable-order-group">
                <button class="module-toggle-expand-btn variable-enabled-btn" data-is-enabled="true" title="启用/禁用变量">
                <span class="variable-order-number"></span>
                </button>
                <button class="module-toggle-expand-btn variable-identifier-btn" data-is-identifier="true" title="设置为主标识符">
                    <span class="variable-order-number">🔑</span>
                </button>
                <button class="module-toggle-expand-btn variable-backup-identifier-btn" data-is-backup-identifier="true" title="设置为备用标识符">
                    <span class="variable-order-number">🔗</span>
                </button>
                <button class="module-toggle-expand-btn variable-hide-condition-btn" data-is-hide-condition="true" title="设置为隐藏条件">
                    <span class="variable-order-number">👁️</span>
                </button>
            </div>
            <div class="variable-name-group">
                <label>变量名</label>
                <input type="text" class="variable-name" placeholder="变量名" value="${name}">
                <input type="hidden" class="variable-enabled" value="${enabled ? 'true' : 'false'}">
                <input type="hidden" class="variable-is-identifier" value="${isIdentifier ? 'true' : 'false'}">
                <input type="hidden" class="variable-is-backup-identifier" value="${isBackupIdentifier ? 'true' : 'false'}">
                <input type="hidden" class="variable-is-hide-condition" value="${isHideCondition ? 'true' : 'false'}">
            </div>
            <div class="variable-display-name-group">
                <input type="text" class="variable-display-name" placeholder="显示名" value="${displayName}">
            </div>
            <div class="variable-desc-group" style="display: flex; gap: 2px; align-items: center; flex: 1; max-width: 400px;">
                <label style="white-space: nowrap;">描述</label>
                <input type="text" class="variable-desc" placeholder="变量描述" value="${description}" style="flex: ${isHideCondition ? '3' : '1'};">
                <input type="text" class="variable-desc" placeholder="隐藏条件值（逗号分隔）" value="${hideConditionValues}" style="display: ${isHideCondition ? 'block' : 'none'}; flex: 1; max-width: 200px;">
            </div>
            <div class="variable-compatible-names-group">
                <label>兼容</label>
                <input type="text" class="variable-compatible-names" placeholder="兼容变量名（逗号分隔）" value="${compatibleNames}">
            </div>
            <div class="variable-actions">
                <button class="btn-small remove-variable">-</button>
                <button class="btn-small variable-drag-handle">⋮⋮</button>
            </div>
            <div class="variable-custom-styles-group" style="width: 100%;">
                <label>自定样式</label>
                <textarea class="variable-custom-styles" placeholder="输入CSS/HTML代码，支持多行">${customStyles}</textarea>
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
