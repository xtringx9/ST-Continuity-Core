// src/features/generator-editor/GeneratorEditor.js
// 生成内容配置编辑器（小剧场、角色心理等）
// 用 iframe.src 加载 index.html，复用 module-editor 的 themes.css + layout.css
// 主题同步：读 localStorage.st_continuity_theme，由 index.html 的 <link> 引入 themes.css

import configManager from '../../singleton/configManager.js';
import { infoLog, errorLog } from '../../utils/logger.js';
import { translate } from '../../../../../../i18n.js';

let doc = null;
let currentGenerators = [];
let selectedGenId = null;
let savedGeneratorsJson = ''; // 保存后的 JSON 字符串（用于 hasChanges 检测）

/**
 * iframe 内静态文本 i18n（与 module-editor 一致）
 * ST 的 MutationObserver 在 iframe 内不运行，需手动遍历翻译
 */
function applyI18nToStaticElements(doc) {
    doc.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translated = translate(key);
        if (translated && translated !== key) {
            el.textContent = translated;
        }
    });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const translated = translate(key);
        if (translated && translated !== key) {
            el.placeholder = translated;
        }
    });
}

/**
 * 初始化生成内容配置编辑器
 * 由 EntryButton 在 iframe onLoad 回调中调用（与 initModuleEditor 一致）
 * @param {Document} iframeDocument Iframe 的文档对象
 */
export function initGeneratorEditor(iframeDocument) {
    doc = iframeDocument;

    // === 主题同步（与 module-editor 一致）===
    const savedTheme = localStorage.getItem('st_continuity_theme') || 'light';
    doc.documentElement.setAttribute('data-theme', savedTheme);

    const headerTitle = doc.querySelector('.header-title');
    if (headerTitle) {
        headerTitle.style.cursor = 'pointer';
        headerTitle.title = translate('ccore_title_toggle_theme');
        headerTitle.addEventListener('click', () => {
            const current = doc.documentElement.getAttribute('data-theme') || 'light';
            const next = current === 'light' ? 'dark' : 'light';
            doc.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('st_continuity_theme', next);
            window.dispatchEvent(new CustomEvent('continuity-theme-change'));
        });
    }

    // === i18n 静态文本 ===
    applyI18nToStaticElements(doc);

    // === 加载数据（深拷贝避免直接修改引用）===
    const config = configManager.getGeneratorConfig();
    currentGenerators = JSON.parse(JSON.stringify(config.generators || []));
    savedGeneratorsJson = JSON.stringify(currentGenerators);

    // 选中第一个（如果有）
    if (currentGenerators.length > 0) {
        selectedGenId = currentGenerators[0].id;
    }

    // === 渲染 ===
    renderGeneratorList();
    renderGeneratorDetail();
    checkForChanges();

    // === 绑定新增按钮 ===
    const addBtn = doc.getElementById('btn-add-generator');
    if (addBtn) {
        addBtn.addEventListener('click', addGenerator);
    }

    // === 绑定保存按钮（顶部 header 内，与 module-editor 一致）===
    const saveBtn = doc.getElementById('header-save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            if (saveGenerators()) {
                // saved 绿色状态反馈（与 module-editor 一致）
                saveBtn.dataset.saving = 'true';
                saveBtn.textContent = translate('ccore_msg_saved');
                saveBtn.classList.add('saved');
                setTimeout(() => {
                    saveBtn.textContent = translate('ccore_btn_save');
                    saveBtn.dataset.saving = 'false';
                    saveBtn.classList.remove('saved');
                    checkForChanges();
                }, 1000);
            }
        });
    }

    infoLog('[GeneratorEditor] 初始化完成，共', currentGenerators.length, '个生成内容');
}

/**
 * 检测变更，更新保存按钮状态（与 module-editor 一致）
 */
function checkForChanges() {
    collectCurrentDetail();
    const currentJson = JSON.stringify(currentGenerators);
    const hasChanges = currentJson !== savedGeneratorsJson;

    const saveBtn = doc.getElementById('header-save-btn');
    if (saveBtn) {
        saveBtn.disabled = !hasChanges;
        if (hasChanges) {
            saveBtn.classList.remove('btn-secondary');
            saveBtn.classList.add('btn-primary');
        } else {
            saveBtn.classList.remove('btn-primary');
            saveBtn.classList.add('btn-secondary');
        }
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

        // 列表项结构（与 module-editor 一致：content + actions）
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
            // 移动端适配：点击后切换到详情视图（与 module-editor 一致）
            if (window.innerWidth <= 768) {
                doc.body.classList.add('mobile-view-detail');
            }
        });

        // 绑定启用/禁用开关事件（与 module-editor 一致）
        const toggle = item.querySelector('.gen-enable-toggle');
        toggle.addEventListener('click', (e) => {
            gen.enabled = e.target.checked;
            if (gen.enabled === false) item.classList.add('disabled');
            else item.classList.remove('disabled');
            checkForChanges();
        });

        // 阻止开关容器的点击冒泡，防止触发列表项选中（与 module-editor 一致）
        const actions = item.querySelector('.module-item-actions');
        if (actions) {
            actions.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        listEl.appendChild(item);
    });
}

/**
 * 渲染右侧详情（复用 settings-container / form-grid / form-group class）
 * 加 module-detail-view class 使 form-group 保持行布局（与 module-editor 详情页一致）
 * 顶部 sticky-title-group 含 displayName + 🗑️ 删除按钮（与 module-editor 一致）
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

    // 移动端返回按钮（与 module-editor 一致）
    const backBtn = doc.getElementById('btn-back-to-list');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            doc.body.classList.remove('mobile-view-detail');
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
 * 从当前详情表单收集数据到 currentGenerators
 * 切换选中或保存前调用
 * 注意：启用状态由左侧列表 toggle-switch 管理，不在详情区收集
 */
function collectCurrentDetail() {
    const gen = currentGenerators.find(g => g.id === selectedGenId);
    if (!gen) return;

    const nameEl = doc.getElementById('gen-name');
    const displayNameEl = doc.getElementById('gen-display-name');
    const promptModeEl = doc.getElementById('gen-prompt-mode');

    if (nameEl) gen.name = nameEl.value.trim();
    if (displayNameEl) gen.displayName = displayNameEl.value.trim();
    if (promptModeEl) gen.promptMode = promptModeEl.value;

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
    };
    currentGenerators.push(newGen);
    selectedGenId = newGen.id;

    renderGeneratorList();
    renderGeneratorDetail();
    checkForChanges();

    infoLog('[GeneratorEditor] 新增生成内容, id:', newGen.id);
}

/**
 * 删除 generator
 */
function deleteGenerator(genId) {
    if (!confirm(translate('ccore_gen_confirm_delete'))) return;

    currentGenerators = currentGenerators.filter(g => g.id !== genId);
    selectedGenId = currentGenerators.length > 0 ? currentGenerators[0].id : null;

    renderGeneratorList();
    renderGeneratorDetail();
    checkForChanges();

    // 移动端：删除后返回列表视图（与 module-editor 一致）
    doc.body.classList.remove('mobile-view-detail');

    infoLog('[GeneratorEditor] 删除生成内容, id:', genId);
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
 * 保存到 configManager
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
        alert(translate('ccore_gen_error_save_failed') + '\n' + errors.join('\n'));
        return false;
    }

    try {
        const config = configManager.getGeneratorConfig();
        config.generators = currentGenerators;
        configManager.setGeneratorConfig(config);
        configManager.saveGeneratorConfigNow();
        savedGeneratorsJson = JSON.stringify(currentGenerators);
        infoLog('[GeneratorEditor] 保存成功，共', currentGenerators.length, '个生成内容');
        return true;
    } catch (err) {
        errorLog('[GeneratorEditor] 保存失败:', err);
        alert(translate('ccore_gen_error_save_failed') + ': ' + err.message);
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
