/**
 * 变量列表渲染器
 * 负责渲染模块的变量列表，处理变量项的事件绑定
 */

import { translate } from '../../../../../../i18n.js';
import { errorLog } from '../../utils/logger.js';
import { handleDragStart, handleDragOver, handleDragEnter, handleDragLeave, handleDrop, handleDragEnd } from './DragHandler.js';
import { IframeDialog } from '../../shared/IframeDialog.js';

/**
 * 生成在给定名称集合内唯一的变量名
 * @param {string} baseName 原始变量名
 * @param {Set<string>} existingNames 已存在的名称集合
 * @param {boolean} forceSuffix 为 true 时即使 baseName 未冲突也强制追加 _copy（用于同模块复制）
 * @returns {string} 唯一名称
 */
function makeUniqueVarName(baseName, existingNames, forceSuffix = false) {
    const base = baseName || 'var';
    if (!forceSuffix && !existingNames.has(base)) {
        return base;
    }
    let candidate = `${base}_copy`;
    let n = 2;
    while (existingNames.has(candidate)) {
        candidate = `${base}_copy_${n}`;
        n++;
    }
    return candidate;
}

/**
 * 深拷贝一个变量对象
 * @param {Object} variable
 * @returns {Object}
 */
function deepCopyVariable(variable) {
    return JSON.parse(JSON.stringify(variable));
}

/**
 * 弹出「复制到其他模块」对话框
 * @param {Object} variable 源变量
 * @param {Object} sourceModule 源模块（用于从目标列表中排除自身）
 * @param {Array} allModules 全部模块列表（currentModules）
 * @param {Document} doc iframe document
 * @param {Function} checkForChanges 变更回调
 */
function showCopyToDialog(variable, sourceModule, allModules, doc, checkForChanges) {
    const dialog = new IframeDialog(doc);
    const targets = (allModules || []).filter(m => m !== sourceModule);

    if (targets.length === 0) {
        dialog.open({
            title: translate('ccore_title_copy_var_dialog'),
            content: `<div style="padding: 8px 0; color: var(--text-muted);">${translate('ccore_msg_copy_var_no_targets')}</div>`,
            buttons: [
                { text: translate('ccore_btn_cancel'), className: 'btn-secondary' },
            ],
        });
        return;
    }

    const listHtml = targets.map((mod, i) => `
        <label class="pick-item copy-var-item" for="copy-var-${i}">
            <input type="checkbox" id="copy-var-${i}" class="copy-var-target" data-module-index="${allModules.indexOf(mod)}">
            <span class="pick-name">${mod.displayName || mod.name} <span class="pick-id">(${mod.name})</span></span>
        </label>
    `).join('');

    const content = `
        <div style="margin-bottom: 8px; color: var(--text-secondary); font-size: 13px;">${translate('ccore_label_copy_var_targets')}</div>
        <div class="pick-list">${listHtml}</div>
        <div class="copy-var-result" style="display: none; margin-top: 8px; font-size: 12px; color: var(--text-secondary);"></div>
    `;

    dialog.open({
        title: translate('ccore_title_copy_var_dialog'),
        content,
        buttons: [
            { text: translate('ccore_btn_cancel'), className: 'btn-secondary' },
            {
                text: translate('ccore_btn_copy_var_confirm'),
                className: 'btn-primary',
                onClick: (d) => {
                    const checked = Array.from(d.dialogElement.querySelectorAll('.copy-var-target:checked'));
                    const resultDiv = d.dialogElement.querySelector('.copy-var-result');

                    if (checked.length === 0) {
                        if (resultDiv) {
                            resultDiv.textContent = translate('ccore_msg_copy_var_select_none');
                            resultDiv.style.display = 'block';
                        }
                        return;
                    }

                    const copiedNames = [];
                    checked.forEach(cb => {
                        const modIndex = parseInt(cb.dataset.moduleIndex, 10);
                        const targetModule = allModules[modIndex];
                        if (!targetModule) return;
                        if (!Array.isArray(targetModule.variables)) targetModule.variables = [];

                        const copy = deepCopyVariable(variable);
                        const existing = new Set(targetModule.variables.map(v => v.name));
                        copy.name = makeUniqueVarName(variable.name, existing, false);
                        targetModule.variables.push(copy);
                        copiedNames.push(targetModule.displayName || targetModule.name);
                    });

                    checkForChanges();
                    if (refreshSidebar) refreshSidebar();

                    if (resultDiv) {
                        resultDiv.style.color = 'var(--text-secondary)';
                        resultDiv.textContent = translate('ccore_msg_copy_var_success') + copiedNames.join('、');
                        resultDiv.style.display = 'block';
                    }
                    setTimeout(() => d.close(), 900);
                },
            },
        ],
    });
}

/**
 * 渲染变量列表
 * @param {Object} module 模块对象
 * @param {HTMLElement} container 容器元素
 * @param {Document} doc iframe 的 document 对象
 * @param {Function} checkForChanges 检查变更的回调函数
 * @param {Array} allModules 全部模块列表（用于跨模块复制），可选
 * @param {number} highlightIndex 复制后需要高亮的变量索引，可选
 * @param {Function} refreshSidebar 重建侧边栏的回调（变量数量变化后同步侧边栏计数），可选
 */
export function renderVariableList(module, container, doc, checkForChanges, allModules = [], highlightIndex = -1, refreshSidebar = null) {
    if (!container) {
        errorLog("renderVariableList: 容器不存在");
        return;
    }
    container.innerHTML = '';

    const countEl = doc.getElementById('variable-count');
    if (countEl) {
        countEl.textContent = `${module.variables ? module.variables.length : 0}${translate('ccore_label_var_count')}`;
    }

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
                <span class="variable-actions">
                    <button class="btn-copy-variable btn-variable-action" title="${translate('ccore_title_copy_variable')}">⧉</button>
                    <button class="btn-copy-variable-to btn-variable-action" title="${translate('ccore_title_copy_variable_to')}">⇉</button>
                    <button class="btn-delete-variable btn-variable-delete" title="${translate('ccore_title_delete_variable')}">✕</button>
                </span>
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
                    <textarea class="var-description" rows="2">${variable.description || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>${translate('ccore_label_var_usage_prompt')}</label>
                    <textarea class="var-usage-prompt" rows="2" placeholder="${translate('ccore_placeholder_var_usage_prompt')}">${variable.usagePrompt || ''}</textarea>
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
            variable.usagePrompt = item.querySelector('.var-usage-prompt').value;

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

        // 同模块复制：深拷贝到列表末尾，自动重命名
        item.querySelector('.btn-copy-variable').addEventListener('click', () => {
            const copy = deepCopyVariable(variable);
            const existing = new Set(module.variables.map(v => v.name));
            copy.name = makeUniqueVarName(variable.name, existing, true);
            module.variables.push(copy);
            renderVariableList(module, container, doc, checkForChanges, allModules, module.variables.length - 1, refreshSidebar);
            checkForChanges();
            if (refreshSidebar) refreshSidebar();
        });

        // 跨模块复制：弹窗选择目标模块（可多选）
        item.querySelector('.btn-copy-variable-to').addEventListener('click', () => {
            showCopyToDialog(variable, module, allModules, doc, checkForChanges);
        });

        item.querySelector('.btn-delete-variable').addEventListener('click', () => {
            // 通用弹窗确认（重点色在取消），替代浏览器 confirm
            const dlg = new IframeDialog(doc);
            dlg.open({
                title: '删除变量',
                content: `<p>${translate('ccore_msg_confirm_delete_var')}</p><p style="opacity:0.7">此操作不可恢复。</p>`,
                buttons: [
                    { text: '取消', className: 'btn-primary', onClick: () => dlg.close() },
                    {
                        text: '删除',
                        className: 'btn-secondary',
                        onClick: (d) => {
                            d.close();
                            module.variables.splice(index, 1);
                            renderVariableList(module, container, doc, checkForChanges, allModules, -1, refreshSidebar);
                            checkForChanges();
                            if (refreshSidebar) refreshSidebar();
                        },
                    },
                ],
            });
        });

        const handle = item.querySelector('.drag-handle');
        handle.addEventListener('dragstart', (e) => handleDragStart(e, item, 'variable', item));
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', (e) => handleDrop(e, item, 'variable', module.variables, () => {
            renderVariableList(module, container, doc, checkForChanges, allModules);
            checkForChanges();
        }));
        item.addEventListener('dragend', (e) => handleDragEnd(e, doc));

        container.appendChild(item);

        // 复制后高亮新项
        if (index === highlightIndex) {
            item.classList.add('variable-item-highlight');
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            setTimeout(() => item.classList.remove('variable-item-highlight'), 1500);
        }
    });
}
