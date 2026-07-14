/**
 * 模块详情渲染器
 * 负责渲染模块详情页（属性设置 + 变量列表），处理表单联动和实时数据更新
 */

import { translate } from '../../../../../../i18n.js';
import { renderVariableList } from './VariableListRenderer.js';
import { generateModuleStylesText, parseAndApplyModuleStylesText } from '../../modules/promptGenerator.js';

/**
 * 渲染模块详情页
 * @param {Object} module 模块对象
 * @param {number} index 模块在列表中的索引
 * @param {Document} doc iframe 的 document 对象
 * @param {Function} checkForChanges 检查变更的回调函数
 * @param {Function} deleteModule 删除模块的回调函数
 * @param {Function} renderModuleList 重新渲染模块列表的回调函数
 * @param {string} activeDetailTab 当前活动的详情页Tab ID
 * @param {Function} onTabChange Tab切换时的回调函数，参数为新的Tab ID
 */
export function renderModuleDetail(module, index, doc, checkForChanges, deleteModule, renderModuleList, activeDetailTab = 'module-detail-settings', onTabChange = null) {
    const container = doc.querySelector('.module-detail-panel .detail-content');

    container.innerHTML = `
        <div class="settings-container module-detail-view">
            <!-- Tab Navigation -->
            <div class="detail-tabs">
                <div class="sticky-title-group">
                    <button id="btn-back-to-list" class="mobile-only btn-back-icon" title="${translate('ccore_title_back_to_list')}">❮</button>
                    <span class="sticky-module-name" title="${module.displayName || module.name}">${module.displayName || module.name}</span>
                    <button id="btn-delete-module" class="btn-delete-small" title="${translate('ccore_title_delete_module')}">🗑️</button>
                </div>
                <div class="detail-tab-item ${activeDetailTab === 'module-detail-settings' ? 'active' : ''}" data-target="module-detail-settings" data-i18n="ccore_title_module_attributes">${translate('ccore_title_module_attributes')}</div>
                <div class="detail-tab-item ${activeDetailTab === 'module-detail-variables' ? 'active' : ''}" data-target="module-detail-variables" data-i18n="ccore_title_variables">${translate('ccore_title_variables')}</div>
            </div>

            <!-- Tab Panel: Settings -->
            <div id="module-detail-settings" class="detail-tab-panel ${activeDetailTab === 'module-detail-settings' ? 'active' : ''}">
                <div class="form-grid">
                    <!-- 基础信息 -->
                    <div class="form-section-title">${translate('ccore_title_edit_module')}</div>

                    <div class="form-group">
                        <label>${translate('ccore_label_name')}</label>
                        <input type="text" id="edit-name" value="${module.name}">
                    </div>

                    <div class="form-group">
                        <label>${translate('ccore_label_display_name')}</label>
                        <input type="text" id="edit-display-name" value="${module.displayName}">
                    </div>

                    <div class="form-group form-full-width">
                        <label>${translate('ccore_label_compatible_modules')}</label>
                        <input type="text" id="edit-compatible-modules" value="${(module.compatibleModuleNames || []).join(',')}" placeholder="${translate('ccore_placeholder_compatible_modules')}">
                    </div>

                    <!-- 模块属性 -->
                    <div class="form-section-title">${translate('ccore_title_module_attributes')}</div>
                    <div class="form-group form-full-width module-toggles" style="margin-bottom: 15px;">
                        <button id="btn-edit-external" class="btn-text-toggle ${module.isExternalDisplay ? 'active' : ''}">
                            <input type="checkbox" ${module.isExternalDisplay ? 'checked' : ''}>
                            ${translate('ccore_label_external')}
                        </button>
                        <button id="btn-edit-time-reference-standard" class="btn-text-toggle ${module.timeReferenceStandard ? 'active' : ''}">
                            <input type="checkbox" ${module.timeReferenceStandard ? 'checked' : ''}>
                            ${translate('ccore_label_time_ref')}
                        </button>
                    </div>

                    <!-- 行为设置 -->
                    <div class="form-section-title">${translate('ccore_title_behavior_settings')}</div>

                    <div class="form-group">
                        <label>${translate('ccore_label_output_pos')}</label>
                        <div style="display: flex; gap: 10px; flex: 1;">
                            <select id="edit-output-pos" style="flex: 1;">
                                <option value="after_body" ${module.outputPosition === 'after_body' ? 'selected' : ''}>${translate('ccore_option_after_body')}</option>
                                <option value="body" ${module.outputPosition === 'body' ? 'selected' : ''}>${translate('ccore_option_body')}</option>
                                <option value="body_start" ${module.outputPosition === 'body_start' ? 'selected' : ''}>${translate('ccore_option_body_start')}</option>
                                <option value="body_end" ${module.outputPosition === 'body_end' ? 'selected' : ''}>${translate('ccore_option_body_end')}</option>
                                <option value="body_surround" ${module.outputPosition === 'body_surround' ? 'selected' : ''}>${translate('ccore_option_body_surround')}</option>
                                <option value="specific_position" ${module.outputPosition === 'specific_position' ? 'selected' : ''}>${translate('ccore_option_specific_position')}</option>
                                <option value="embedded" ${module.outputPosition === 'embedded' ? 'selected' : ''}>${translate('ccore_option_embedded')}</option>
                            </select>
                            <input type="text" id="edit-prompt-position" value="${module.positionPrompt || ''}" placeholder="${translate('ccore_label_prompt_position')}" style="flex: 1; display: none;">
                        </div>
                    </div>

                    <div class="form-group">
                        <label>${translate('ccore_label_output_mode')}</label>
                        <select id="edit-output-mode">
                            <option value="full" ${module.outputMode === 'full' ? 'selected' : ''}>${translate('ccore_option_full')}</option>
                            <option value="incremental" ${module.outputMode === 'incremental' ? 'selected' : ''}>${translate('ccore_option_incremental')}</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>${translate('ccore_label_range_mode')}</label>
                        <div style="display: flex; gap: 10px;">
                            <select id="edit-range-mode" style="flex: 1; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                                <option value="unlimited" ${module.rangeMode === 'unlimited' ? 'selected' : ''}>${translate('ccore_option_unlimited')}</option>
                                <option value="specified" ${module.rangeMode === 'specified' ? 'selected' : ''}>${translate('ccore_option_specified')}</option>
                                <option value="range" ${module.rangeMode === 'range' ? 'selected' : ''}>${translate('ccore_option_range')}</option>
                            </select>
                            <input type="number" id="edit-item-min" value="${module.itemMin || 0}" placeholder="${translate('ccore_label_item_min')}" style="width: 70px; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px; display: none;">
                            <input type="number" id="edit-item-max" value="${module.itemMax || 1}" placeholder="${translate('ccore_label_item_max')}" style="width: 70px; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px; display: none;">
                        </div>
                    </div>

                    <div class="form-group">
                        <label>${translate('ccore_label_retain_layers')}</label>
                        <input type="number" id="edit-retain-layers" value="${module.retainLayers !== undefined ? module.retainLayers : -1}">
                    </div>

                    <!-- 提示词设置 -->
                    <div class="form-section-title">${translate('ccore_title_prompt_config')}</div>

                    <div class="form-group form-full-width">
                        <label>${translate('ccore_label_prompt_timing')}</label>
                        <textarea id="edit-prompt-timing" rows="2">${module.timingPrompt || ''}</textarea>
                    </div>

                    <div class="form-group form-full-width">
                        <label>${translate('ccore_label_prompt_gen')}</label>
                        <textarea id="edit-prompt" rows="2">${module.prompt || ''}</textarea>
                    </div>

                    <div class="form-group form-full-width">
                        <label>${translate('ccore_label_prompt_usage')}</label>
                        <textarea id="edit-prompt-content" rows="2">${module.contentPrompt || ''}</textarea>
                    </div>

                    <!-- 样式设置 -->
                    <div class="form-section-title" style="display:flex;align-items:center;gap:6px;">
                        <span>${translate('ccore_title_style_config')}</span>
                        <label class="styles-include-label" title="${translate('ccore_title_include_container_hint')}">
                            <input type="checkbox" id="chk-include-container">
                            <span class="styles-include-text">${translate('ccore_title_include_container')}</span>
                        </label>
                        <button id="btn-copy-module-styles" class="copy-styles-btn" title="${translate('ccore_title_copy_styles')}">⧉</button>
                        <button id="btn-import-module-styles" class="copy-styles-btn" title="${translate('ccore_title_import_styles')}">⤓</button>
                    </div>

                    <div class="form-group form-full-width">
                        <label>${translate('ccore_label_styles_custom')}</label>
                        <textarea id="edit-styles-custom" rows="2">${module.customStyles || ''}</textarea>
                    </div>
                    <div class="form-group form-full-width">
                        <label>${translate('ccore_label_styles_container')}</label>
                        <textarea id="edit-styles-container" rows="2">${module.containerStyles || ''}</textarea>
                    </div>
                    <div class="form-group form-full-width">
                        <label>${translate('ccore_label_styles_external')}</label>
                        <textarea id="edit-styles-external" rows="2">${module.externalStyles || ''}</textarea>
                    </div>
                </div>
            </div>

            <!-- Tab Panel: Variables -->
            <div id="module-detail-variables" class="detail-tab-panel ${activeDetailTab === 'module-detail-variables' ? 'active' : ''}">
                <div class="form-section-title section-header variable-sticky-header">
                    <span>${translate('ccore_title_variables')}</span>
                    <button id="btn-add-variable" class="btn-secondary">
                        + ${translate('ccore_btn_add_variable')}
                    </button>
                </div>
                <div class="form-full-width" id="variable-list-container">
                </div>
            </div>

            <div class="spacer-bottom"></div>
        </div>
    `;

    // 渲染变量列表
    renderVariableList(module, doc.getElementById('variable-list-container'), doc, checkForChanges);

    // 绑定 Tab 切换事件
    const tabs = doc.querySelectorAll('.detail-tab-item');
    const panels = doc.querySelectorAll('.detail-tab-panel');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const targetPanel = doc.getElementById(tab.getAttribute('data-target'));
            if (targetPanel) targetPanel.classList.add('active');
            if (onTabChange) onTabChange(tab.getAttribute('data-target'));
        });
    });

    // 处理 Range Mode 联动
    const rangeModeSelect = doc.getElementById('edit-range-mode');
    const itemMinInput = doc.getElementById('edit-item-min');
    const itemMaxInput = doc.getElementById('edit-item-max');

    // 处理 Output Position 联动
    const outputPosSelect = doc.getElementById('edit-output-pos');
    const positionPromptInput = doc.getElementById('edit-prompt-position');

    // 处理 Output Mode 联动
    const outputModeSelect = doc.getElementById('edit-output-mode');
    const retainLayersInput = doc.getElementById('edit-retain-layers');

    const updateRangeInputs = () => {
        const mode = rangeModeSelect.value;
        itemMinInput.style.display = mode === 'range' ? 'block' : 'none';
        itemMaxInput.style.display = (mode === 'specified' || mode === 'range') ? 'block' : 'none';
    };

    const updateOutputPosInputs = () => {
        const pos = outputPosSelect.value;
        positionPromptInput.style.display = pos === 'specific_position' ? 'block' : 'none';
    };

    const updateOutputModeInputs = () => {
        const mode = outputModeSelect.value;
        const group = retainLayersInput.closest('.form-group');
        if (group) {
            group.style.display = mode === 'full' ? '' : 'none';
        }
    };

    updateRangeInputs();
    updateOutputPosInputs();
    updateOutputModeInputs();

    rangeModeSelect.addEventListener('change', updateRangeInputs);
    outputPosSelect.addEventListener('change', updateOutputPosInputs);
    outputModeSelect.addEventListener('change', updateOutputModeInputs);

    // === 实时数据更新逻辑 ===
    const updateModuleData = () => {
        module.name = doc.getElementById('edit-name').value;
        module.displayName = doc.getElementById('edit-display-name').value;
        module.compatibleModuleNames = doc.getElementById('edit-compatible-modules').value.split(',').map(s => s.trim()).filter(s => s);

        module.outputPosition = doc.getElementById('edit-output-pos').value;
        module.outputMode = doc.getElementById('edit-output-mode').value;
        module.rangeMode = doc.getElementById('edit-range-mode').value;
        module.itemMin = parseInt(doc.getElementById('edit-item-min').value) || 0;
        module.itemMax = parseInt(doc.getElementById('edit-item-max').value) || 1;
        const retainLayers = parseInt(doc.getElementById('edit-retain-layers').value);
        module.retainLayers = Number.isNaN(retainLayers) ? -1 : retainLayers;

        module.isExternalDisplay = doc.getElementById('btn-edit-external').classList.contains('active');
        module.timeReferenceStandard = doc.getElementById('btn-edit-time-reference-standard').classList.contains('active');

        module.prompt = doc.getElementById('edit-prompt').value;
        module.timingPrompt = doc.getElementById('edit-prompt-timing').value;
        module.contentPrompt = doc.getElementById('edit-prompt-content').value;
        module.positionPrompt = doc.getElementById('edit-prompt-position').value;

        module.containerStyles = doc.getElementById('edit-styles-container').value;
        module.externalStyles = doc.getElementById('edit-styles-external').value;
        module.customStyles = doc.getElementById('edit-styles-custom').value;

        checkForChanges();

        // 刷新列表项名称
        const listItem = doc.querySelector(`.module-list-item[data-index="${index}"] .module-item-name`);
        if (listItem) listItem.textContent = module.displayName || module.name;
    };

    // 绑定模块高级开关按钮
    doc.getElementById('btn-edit-external').addEventListener('click', function () {
        this.classList.toggle('active');
        const cb = this.querySelector('input'); if (cb) cb.checked = this.classList.contains('active');
        updateModuleData();
    });
    doc.getElementById('btn-edit-time-reference-standard').addEventListener('click', function () {
        this.classList.toggle('active');
        const cb = this.querySelector('input'); if (cb) cb.checked = this.classList.contains('active');
        updateModuleData();
    });

    // 绑定返回按钮事件
    const backBtn = doc.getElementById('btn-back-to-list');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            doc.body.classList.remove('mobile-view-detail');
        });
    }

    // 绑定删除模块按钮
    const deleteBtn = doc.getElementById('btn-delete-module');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            deleteModule(index);
        });
    }

    // 绑定复制样式按钮
    const copyStylesBtn = doc.getElementById('btn-copy-module-styles');
    const chkIncludeContainer = doc.getElementById('chk-include-container');
    if (copyStylesBtn) {
        copyStylesBtn.addEventListener('click', async () => {
            const includeContainer = chkIncludeContainer ? chkIncludeContainer.checked : true;
            const stylesText = generateModuleStylesText(module, { includeContainer });
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(stylesText);
                } else {
                    const ta = doc.createElement('textarea');
                    ta.value = stylesText;
                    doc.body.appendChild(ta);
                    ta.select();
                    doc.execCommand('copy');
                    ta.remove();
                }
                copyStylesBtn.textContent = '✓';
                setTimeout(() => { copyStylesBtn.textContent = '⧉'; }, 1000);
            } catch (e) {
                copyStylesBtn.textContent = '✗';
                setTimeout(() => { copyStylesBtn.textContent = '⧉'; }, 1000);
            }
        });
    }

    // 绑定导入样式按钮
    const importStylesBtn = doc.getElementById('btn-import-module-styles');
    if (importStylesBtn) {
        importStylesBtn.addEventListener('click', () => {
            showImportStylesDialog(doc, module, checkForChanges, updateModuleData);
        });
    }

    // 绑定添加变量按钮
    doc.getElementById('btn-add-variable').addEventListener('click', () => {
        if (!module.variables) module.variables = [];
        module.variables.push({
            name: 'new_var',
            displayName: translate('ccore_msg_new_variable'),
            enabled: true,
            description: '',
            isIdentifier: false,
            isBackupIdentifier: false,
            isHideCondition: false,
            hideConditionValues: [],
            isNoNormalize: false,
            customStyles: ''
        });
        renderVariableList(module, doc.getElementById('variable-list-container'), doc, checkForChanges);
        checkForChanges();
    });

    // 绑定所有输入框的实时更新
    container.querySelectorAll('input, textarea, select').forEach(el => {
        el.addEventListener('input', updateModuleData);
        el.addEventListener('change', updateModuleData);
    });
}

/**
 * 显示导入样式对话框
 */
function showImportStylesDialog(doc, module, checkForChanges, updateModuleData) {
    // 移除已有对话框
    const existing = doc.getElementById('import-styles-dialog');
    if (existing) existing.remove();

    const overlay = doc.createElement('div');
    overlay.id = 'import-styles-dialog';
    overlay.innerHTML = `
        <div class="import-styles-overlay"></div>
        <div class="import-styles-dialog">
            <div class="import-styles-title">${translate('ccore_title_import_styles')}</div>
            <textarea class="import-styles-textarea" placeholder="${translate('ccore_placeholder_import_styles')}" rows="12"></textarea>
            <div class="import-styles-actions">
                <button class="import-styles-confirm">${translate('ccore_btn_import_confirm')}</button>
                <button class="import-styles-cancel">${translate('ccore_btn_import_cancel')}</button>
            </div>
            <div class="import-styles-result" style="display:none;"></div>
        </div>
    `;
    doc.body.appendChild(overlay);

    const textarea = overlay.querySelector('.import-styles-textarea');
    const resultDiv = overlay.querySelector('.import-styles-result');

    overlay.querySelector('.import-styles-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.import-styles-overlay').addEventListener('click', () => overlay.remove());

    overlay.querySelector('.import-styles-confirm').addEventListener('click', () => {
        const text = textarea.value.trim();
        if (!text) return;

        const { applied, skipped } = parseAndApplyModuleStylesText(text, module);

        // 同步到 textarea 控件
        const customTa = doc.getElementById('edit-styles-custom');
        const containerTa = doc.getElementById('edit-styles-container');
        const externalTa = doc.getElementById('edit-styles-external');
        if (customTa) customTa.value = module.customStyles || '';
        if (containerTa) containerTa.value = module.containerStyles || '';
        if (externalTa) externalTa.value = module.externalStyles || '';

        // 同步变量 customStyles（重新渲染变量列表）
        const varListContainer = doc.getElementById('variable-list-container');
        if (varListContainer) renderVariableList(module, varListContainer, doc, checkForChanges);

        updateModuleData();
        checkForChanges();

        // 显示结果
        let resultText = '';
        if (applied.length > 0) resultText += `✓ ${applied.join(', ')}`;
        if (skipped.length > 0) resultText += `\n✗ ${skipped.join(', ')}`;
        resultDiv.textContent = resultText;
        resultDiv.style.display = 'block';

        setTimeout(() => overlay.remove(), 2000);
    });

    textarea.focus();
}
