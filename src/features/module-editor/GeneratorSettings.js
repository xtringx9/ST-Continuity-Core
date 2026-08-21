// GeneratorSettings.js
// 生成内容配置编辑器（合并自 generator-editor，现作为 module-editor 的导航视图「生成内容」）。
// 数据经 configManager.getGeneratorConfig() / setGeneratorConfig / saveGeneratorConfigNow 存取。
// 生成配置的保存与 module 配置**完全分离**：本视图自带「保存」按钮，独立校验/落盘，
// 不触碰 ModuleEditor 的模块保存流程（saveAll / checkForChanges / header-save-btn）。

import configManager from '../../singleton/configManager.js';
import { showToast } from '../../shared/Toast.js';
import { IframeDialog } from '../../shared/IframeDialog.js';
import { infoLog, errorLog } from '../../utils/logger.js';
import { translate } from '../../../../../../i18n.js';
import { openai_setting_names } from '../../../../../../openai.js';

let doc = null;
let currentGenerators = [];
let selectedGenId = null;
let savedGeneratorsJson = ''; // 保存后的 JSON 字符串（用于 hasChanges 检测）

/**
 * 初始化「生成内容」视图。由 ModuleEditor.initModuleEditor 调用。
 * @param {Document} iframeDocument iframe 的文档对象
 */
export function initGeneratorSettings(iframeDocument) {
    doc = iframeDocument;

    // 加载数据（深拷贝避免直接修改引用）
    const config = configManager.getGeneratorConfig();
    currentGenerators = JSON.parse(JSON.stringify(config.generators || []));
    savedGeneratorsJson = JSON.stringify(currentGenerators);
    selectedGenId = currentGenerators.length > 0 ? currentGenerators[0].id : null;

    // 渲染
    renderGeneratorList();
    renderGeneratorDetail();

    // 绑定新增按钮
    const addBtn = doc.getElementById('btn-add-generator');
    if (addBtn) {
        addBtn.addEventListener('click', addGenerator);
    }

    // 绑定顶栏独立「保存」按钮（仅生成内容 tab 显示；不触碰 module 保存）。
    // 顶栏按钮常驻 DOM，仅在 init 绑定一次即可（detail 重渲不会重建它）。
    const headerSaveBtn = doc.getElementById('header-gen-save-btn');
    if (headerSaveBtn) {
        headerSaveBtn.addEventListener('click', saveGenerators);
    }

    checkForChanges();
}

/**
 * 检测变更，更新生成内容顶栏「保存」按钮状态（独立于 module 保存按钮）。
 */
function checkForChanges() {
    const saveBtn = doc.getElementById('header-gen-save-btn');
    if (!saveBtn) return;
    const hasChanges = JSON.stringify(currentGenerators) !== savedGeneratorsJson;
    saveBtn.disabled = !hasChanges;
    if (hasChanges) {
        saveBtn.classList.remove('btn-secondary');
        saveBtn.classList.add('btn-primary');
    } else {
        saveBtn.classList.remove('btn-primary');
        saveBtn.classList.add('btn-secondary');
    }
}

/**
 * 渲染左侧列表（复用 module-list-item / module-item-content / toggle-switch class）
 */
function renderGeneratorList() {
    const listEl = doc.getElementById('gen-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (currentGenerators.length === 0) {
        listEl.innerHTML = `<div style="padding: 10px; text-align: center; color: var(--text-secondary); font-size: 12px;">${escapeHtml(translate('ccore_gen_empty'))}</div>`;
        return;
    }

    currentGenerators.forEach(gen => {
        const item = doc.createElement('div');
        item.className = 'module-list-item';
        if (gen.id === selectedGenId) item.classList.add('active');
        if (gen.enabled === false) item.classList.add('disabled');
        item.dataset.genId = gen.id;

        item.innerHTML = `
            <div class="module-item-content">
                <div class="module-item-header">
                    <span class="module-item-name">${escapeHtml(gen.displayName || gen.name || translate('ccore_gen_msg_new'))}</span>
                    <small style="opacity: 0.5; font-size: 0.8em;">#${escapeHtml(gen.name || '')}</small>
                </div>
            </div>
            <div class="module-item-actions">
                <label class="toggle-switch" title="${escapeHtml(translate('ccore_title_toggle_enabled'))}">
                    <input type="checkbox" class="gen-enable-toggle" ${gen.enabled !== false ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>
        `;

        // 点击选中
        item.addEventListener('click', () => {
            collectCurrentDetail();
            selectedGenId = gen.id;
            renderGeneratorList();
            renderGeneratorDetail();
            // 移动端适配：点击后切换到详情视图
            if (window.innerWidth <= 768) {
                doc.body.classList.add('mobile-view-detail-module');
            }
        });

        // 绑定启用/禁用开关事件
        const toggle = item.querySelector('.gen-enable-toggle');
        toggle.addEventListener('click', (e) => {
            gen.enabled = e.target.checked;
            if (gen.enabled === false) item.classList.add('disabled');
            else item.classList.remove('disabled');
            checkForChanges();
        });

        // 阻止开关容器的点击冒泡，防止触发列表项选中
        const actions = item.querySelector('.module-item-actions');
        if (actions) {
            actions.addEventListener('click', (e) => e.stopPropagation());
        }

        listEl.appendChild(item);
    });
}

/**
 * 渲染右侧详情（复用 settings-container / detail-tabs / form-grid / form-group class）
 */
function renderGeneratorDetail() {
    const detailEl = doc.getElementById('gen-detail');
    if (!detailEl) return;

    const gen = currentGenerators.find(g => g.id === selectedGenId);
    if (!gen) {
        detailEl.innerHTML = `<div style="text-align: center; margin-top: 50px; color: var(--text-muted);"><p>${escapeHtml(translate('ccore_gen_select_prompt'))}</p><p>${escapeHtml(translate('ccore_gen_or_create'))}</p></div>`;
        return;
    }

    const displayName = gen.displayName || gen.name || translate('ccore_gen_msg_new');
    detailEl.innerHTML = `
        <div class="settings-container module-detail-view">
            <div class="detail-tabs">
                <div class="sticky-title-group">
                    <button id="btn-back-to-list" class="mobile-only btn-back-icon" title="${escapeHtml(translate('ccore_title_back_to_list'))}">❮</button>
                    <span class="sticky-module-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
                    <button id="btn-delete-gen" class="btn-delete-small" title="${escapeHtml(translate('ccore_gen_title_delete'))}">🗑️</button>
                </div>
            </div>
            <div class="form-section-title">${escapeHtml(translate('ccore_gen_title_basic'))}</div>
            <div class="form-grid">
                <div class="form-group form-full-width">
                    <label>${escapeHtml(translate('ccore_gen_label_name'))}</label>
                    <input type="text" id="gen-name" value="${escapeHtml(gen.name || '')}" placeholder="side_scene">
                </div>
                <div class="form-group form-full-width">
                    <label>${escapeHtml(translate('ccore_label_display_name'))}</label>
                    <input type="text" id="gen-display-name" value="${escapeHtml(gen.displayName || '')}" placeholder="${escapeHtml(translate('ccore_gen_msg_new'))}">
                </div>
                <div class="form-group form-full-width">
                    <label>${escapeHtml(translate('ccore_gen_label_prompt_mode'))}</label>
                    <select id="gen-prompt-mode">
                        <option value="random" ${gen.promptMode === 'random' ? 'selected' : ''}>${escapeHtml(translate('ccore_gen_option_random'))}</option>
                        <option value="select" ${gen.promptMode === 'select' ? 'selected' : ''}>${escapeHtml(translate('ccore_gen_option_select'))}</option>
                    </select>
                </div>
                <div class="form-group form-full-width">
                    <label>${escapeHtml(translate('ccore_settings_generation_preset'))}</label>
                    <select id="gen-preset-name">
                        <option value="">${escapeHtml(translate('ccore_settings_ai_preset_default'))}</option>
                        ${Object.keys(openai_setting_names || {}).map(name => `<option value="${escapeHtml(name)}" ${gen.presetName === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="prompts-section">
                <h3>
                    <span>${escapeHtml(translate('ccore_gen_title_prompts'))} (${(gen.prompts || []).length})</span>
                </h3>
                <div id="prompts-container"></div>
                <div class="btn-add-prompt" id="btn-add-prompt">${escapeHtml(translate('ccore_gen_btn_add_prompt'))}</div>
            </div>
        </div>
    `;

    renderPrompts(gen);

    // 绑定详情区输入事件 → checkForChanges
    detailEl.querySelectorAll('input, select, textarea').forEach(el => {
        el.addEventListener('input', checkForChanges);
        el.addEventListener('change', checkForChanges);
    });

    const addPromptBtn = doc.getElementById('btn-add-prompt');
    if (addPromptBtn) {
        addPromptBtn.addEventListener('click', addPrompt);
    }

    const deleteGenBtn = doc.getElementById('btn-delete-gen');
    if (deleteGenBtn) {
        deleteGenBtn.addEventListener('click', () => deleteGenerator(gen.id));
    }

    // 移动端返回按钮
    const backBtn = doc.getElementById('btn-back-to-list');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            doc.body.classList.remove('mobile-view-detail-module');
        });
    }
}

/**
 * 渲染 prompts 列表
 */
function renderPrompts(gen) {
    const container = doc.getElementById('prompts-container');
    if (!container) return;
    container.innerHTML = '';

    if (!gen.prompts || gen.prompts.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:5px;">${escapeHtml(translate('ccore_gen_no_prompts'))}</div>`;
        return;
    }

    gen.prompts.forEach((prompt, index) => {
        const item = doc.createElement('div');
        item.className = 'prompt-item';
        item.innerHTML = `
            <div class="prompt-header">
                <input type="text" class="prompt-label-input" value="${escapeHtml(prompt.label || '')}" placeholder="${escapeHtml(translate('ccore_gen_prompt_label_placeholder'))}" data-prompt-index="${index}" data-field="label">
                <div class="btn-delete-prompt" data-prompt-index="${index}">${escapeHtml(translate('ccore_gen_title_delete'))}</div>
            </div>
            <textarea data-prompt-index="${index}" data-field="content" placeholder="${escapeHtml(translate('ccore_gen_prompt_content_placeholder'))}">${escapeHtml(prompt.content || '')}</textarea>
        `;
        container.appendChild(item);
    });

    // 绑定 prompts 输入事件 → checkForChanges
    container.querySelectorAll('input, textarea').forEach(el => {
        el.addEventListener('input', checkForChanges);
    });

    container.querySelectorAll('.btn-delete-prompt').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.promptIndex, 10);
            deletePrompt(idx);
        });
    });
}

/**
 * 从当前详情表单收集数据到 currentGenerators。
 * 注意：启用状态由左侧列表 toggle-switch 管理，不在详情区收集。
 */
function collectCurrentDetail() {
    const gen = currentGenerators.find(g => g.id === selectedGenId);
    if (!gen) return;

    const nameEl = doc.getElementById('gen-name');
    const displayNameEl = doc.getElementById('gen-display-name');
    const promptModeEl = doc.getElementById('gen-prompt-mode');
    const presetNameEl = doc.getElementById('gen-preset-name');

    if (nameEl) gen.name = nameEl.value.trim();
    if (displayNameEl) gen.displayName = displayNameEl.value.trim();
    if (promptModeEl) gen.promptMode = promptModeEl.value;
    if (presetNameEl) gen.presetName = presetNameEl.value;

    const labelInputs = doc.querySelectorAll('.prompt-label-input');
    const contentTextareas = doc.querySelectorAll('textarea[data-field="content"]');
    gen.prompts = [];
    for (let i = 0; i < labelInputs.length; i++) {
        gen.prompts.push({
            label: labelInputs[i].value,
            content: contentTextareas[i] ? contentTextareas[i].value : '',
        });
    }
}

/**
 * 新增 generator
 */
function addGenerator() {
    collectCurrentDetail();

    const maxId = currentGenerators.reduce((max, g) => Math.max(max, g.id || 0), 0);
    const newGen = {
        id: maxId + 1,
        name: '',
        displayName: '',
        enabled: true,
        prompts: [],
        promptMode: 'random',
        presetName: '',
    };
    currentGenerators.push(newGen);
    selectedGenId = newGen.id;

    renderGeneratorList();
    renderGeneratorDetail();
    checkForChanges();
}

/**
 * 删除 generator（IframeDialog 确认）
 */
function deleteGenerator(genId) {
    const dlg = new IframeDialog(doc);
    const d = dlg;
    dlg.open({
        title: translate('ccore_binding_delete'),
        content: `<div>${translate('ccore_gen_confirm_delete')}</div>`,
        buttons: [
            {
                text: translate('ccore_btn_confirm'),
                className: 'btn-secondary',
                style: 'background-color: var(--red, #ff4444); color: white;',
                onClick: () => {
                    currentGenerators = currentGenerators.filter(g => g.id !== genId);
                    selectedGenId = currentGenerators.length > 0 ? currentGenerators[0].id : null;
                    renderGeneratorList();
                    renderGeneratorDetail();
                    checkForChanges();
                    // 移动端：删除后返回列表视图
                    doc.body.classList.remove('mobile-view-detail-module');
                    d.close();
                },
            },
            { text: translate('ccore_btn_cancel'), className: 'btn-primary', onClick: (dialog) => dialog.close() },
        ],
    });
}

/**
 * 新增 prompt
 */
function addPrompt() {
    collectCurrentDetail();

    const gen = currentGenerators.find(g => g.id === selectedGenId);
    if (!gen) return;

    gen.prompts = gen.prompts || [];
    gen.prompts.push({ label: '', content: '' });

    renderPrompts(gen);
    checkForChanges();
}

/**
 * 删除 prompt
 */
function deletePrompt(index) {
    collectCurrentDetail();

    const gen = currentGenerators.find(g => g.id === selectedGenId);
    if (!gen || !gen.prompts) return;

    gen.prompts.splice(index, 1);
    renderPrompts(gen);
    checkForChanges();
}

/**
 * 保存生成内容配置到 configManager（独立保存，不触碰 module 配置）。
 * @returns {boolean} 是否保存成功
 */
function saveGenerators() {
    collectCurrentDetail();

    // 校验
    const errors = [];
    const names = new Set();
    currentGenerators.forEach((gen, index) => {
        const prefix = translate('ccore_gen_error_prefix').replace('{n}', index + 1);
        if (!gen.name) {
            errors.push(`${prefix}: ${translate('ccore_gen_error_name_empty')}`);
        } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(gen.name)) {
            errors.push(`${prefix}: "${gen.name}" ${translate('ccore_gen_error_name_format')}`);
        } else if (names.has(gen.name)) {
            errors.push(`${prefix}: "${gen.name}" ${translate('ccore_gen_error_name_duplicate')}`);
        } else {
            names.add(gen.name);
        }
        if (!gen.displayName) {
            errors.push(`${prefix}: ${translate('ccore_gen_error_display_name_empty')}`);
        }
    });

    if (errors.length > 0) {
        showToast(doc, translate('ccore_gen_error_save_failed') + '\n' + errors.join('\n'), 'error');
        return false;
    }

    try {
        const config = configManager.getGeneratorConfig();
        config.generators = currentGenerators;
        configManager.setGeneratorConfig(config);
        configManager.saveGeneratorConfigNow();
        savedGeneratorsJson = JSON.stringify(currentGenerators);
        checkForChanges();
        infoLog('[GeneratorSettings] 生成内容保存成功，共', currentGenerators.length, '个');
        return true;
    } catch (err) {
        errorLog('[GeneratorSettings] 保存失败:', err);
        showToast(doc, translate('ccore_gen_error_save_failed') + ': ' + err.message, 'error');
        return false;
    }
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = doc.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}