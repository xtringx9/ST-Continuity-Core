/**
 * 变量列表渲染器
 * 负责渲染模块的变量列表，处理变量项的事件绑定
 */

import { translate } from '../../../../../../i18n.js';
import { errorLog } from '../../utils/logger.js';
import { handleDragStart, handleDragOver, handleDragEnter, handleDragLeave, handleDrop, handleDragEnd } from './DragHandler.js';

/**
 * 渲染变量列表
 * @param {Object} module 模块对象
 * @param {HTMLElement} container 容器元素
 * @param {Document} doc iframe 的 document 对象
 * @param {Function} checkForChanges 检查变更的回调函数
 */
export function renderVariableList(module, container, doc, checkForChanges) {
    if (!container) {
        errorLog("renderVariableList: 容器不存在");
        return;
    }
    container.innerHTML = '';

    if (!module.variables || module.variables.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.9em; border: 1px dashed var(--border-color); border-radius: 4px;">${translate('ccore_msg_no_variables')}</div>`;
        return;
    }

    module.variables.forEach((variable, index) => {
        const item = doc.createElement('div');
        item.className = 'variable-edit-item';
        item.dataset.index = index;

        item.innerHTML = `
            <div class="variable-header-compact">
                <span class="drag-handle" draggable="true" title="${translate('ccore_title_drag_sort')}">⋮⋮</span>
                <label class="toggle-switch" title="${translate('ccore_title_toggle_enabled')}">
                    <input type="checkbox" class="var-enabled" ${variable.enabled !== false ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
                <div class="compact-input-group var-name-group">
                    <label>${translate('ccore_label_var_name')}</label>
                    <input type="text" class="var-name" value="${variable.name || ''}">
                </div>
                <div class="compact-input-group var-display-name-group">
                    <label>${translate('ccore_label_var_display_name')}</label>
                    <input type="text" class="var-display-name" value="${variable.displayName || ''}">
                </div>
                <button class="btn-delete-variable btn-variable-delete" title="${translate('ccore_title_delete_variable')}">✕</button>
            </div>

            <div class="variable-details">
                <div class="variable-toggles">
                    <button class="btn-text-toggle var-identifier ${variable.isIdentifier ? 'active' : ''}">
                        <input type="checkbox" ${variable.isIdentifier ? 'checked' : ''}>
                        ${translate('ccore_label_var_identifier')}
                    </button>
                    <button class="btn-text-toggle var-backup-identifier ${variable.isBackupIdentifier ? 'active' : ''}">
                        <input type="checkbox" ${variable.isBackupIdentifier ? 'checked' : ''}>
                        ${translate('ccore_label_var_backup_identifier')}
                    </button>
                    <button class="btn-text-toggle var-hide-condition ${variable.isHideCondition ? 'active' : ''}">
                        <input type="checkbox" ${variable.isHideCondition ? 'checked' : ''}>
                        ${translate('ccore_label_var_hide_condition')}
                    </button>
                    <button class="btn-text-toggle var-no-normalize ${variable.isNoNormalize ? 'active' : ''}">
                        <input type="checkbox" ${variable.isNoNormalize ? 'checked' : ''}>
                        ${translate('ccore_label_var_no_normalize')}
                    </button>
                </div>
                <div class="form-group">
                    <label>${translate('ccore_label_var_description')}</label>
                    <input type="text" class="var-description" value="${variable.description || ''}">
                </div>
                <div class="form-group">
                    <label>${translate('ccore_label_compatible_variables')}</label>
                    <input type="text" class="var-compatible-names" value="${(variable.compatibleVariableNames || []).join(',')}" placeholder="${translate('ccore_placeholder_compatible_vars')}">
                </div>
                <div class="form-group var-hide-values-group" style="display: ${variable.isHideCondition ? 'flex' : 'none'};">
                    <label>${translate('ccore_label_var_hide_values')}</label>
                    <input type="text" class="var-hide-values" value="${Array.isArray(variable.hideConditionValues) ? variable.hideConditionValues.join(',') : variable.hideConditionValues || ''}">
                </div>
                <div class="form-group">
                    <label>${translate('ccore_label_var_custom_styles')}</label>
                    <textarea class="var-custom-styles" rows="2">${variable.customStyles || ''}</textarea>
                </div>
            </div>
        `;

        const updateVariable = () => {
            variable.name = item.querySelector('.var-name').value;
            variable.displayName = item.querySelector('.var-display-name').value;
            variable.description = item.querySelector('.var-description').value;
            variable.enabled = item.querySelector('.var-enabled').checked;
            variable.isIdentifier = item.querySelector('.var-identifier').classList.contains('active');
            variable.isBackupIdentifier = item.querySelector('.var-backup-identifier').classList.contains('active');
            variable.isNoNormalize = item.querySelector('.var-no-normalize').classList.contains('active');
            variable.isHideCondition = item.querySelector('.var-hide-condition').classList.contains('active');
            variable.hideConditionValues = item.querySelector('.var-hide-values').value.split(',').map(s => s.trim()).filter(s => s);
            variable.compatibleVariableNames = item.querySelector('.var-compatible-names').value.split(',').map(s => s.trim()).filter(s => s);
            variable.customStyles = item.querySelector('.var-custom-styles').value;

            checkForChanges();
        };

        item.querySelectorAll('input, textarea').forEach(input => {
            input.addEventListener('input', updateVariable);
            input.addEventListener('change', updateVariable);
        });

        const hideValuesGroup = item.querySelector('.var-hide-values-group');
        item.querySelectorAll('.btn-text-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                const cb = btn.querySelector('input'); if (cb) cb.checked = btn.classList.contains('active');

                if (btn.classList.contains('var-hide-condition')) {
                    hideValuesGroup.style.display = btn.classList.contains('active') ? 'flex' : 'none';
                }

                updateVariable();
            });
        });

        item.querySelector('.btn-delete-variable').addEventListener('click', () => {
            if (confirm(translate('ccore_msg_confirm_delete_var'))) {
                module.variables.splice(index, 1);
                renderVariableList(module, container, doc, checkForChanges);
                checkForChanges();
            }
        });

        const handle = item.querySelector('.drag-handle');
        handle.addEventListener('dragstart', (e) => handleDragStart(e, item, 'variable', item));
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', (e) => handleDrop(e, item, 'variable', module.variables, () => {
            renderVariableList(module, container, doc, checkForChanges);
            checkForChanges();
        }));
        item.addEventListener('dragend', (e) => handleDragEnd(e, doc));

        container.appendChild(item);
    });
}
