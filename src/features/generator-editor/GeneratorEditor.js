// src/features/generator-editor/GeneratorEditor.js
// 生成内容配置编辑器（小剧场、角色心理等）
// 用 iframe.src 加载 index.html，复用 module-editor 的 themes.css + layout.css
// 主题同步：读 localStorage.st_continuity_theme，由 index.html 的 <link> 引入 themes.css

import configManager from '../../singleton/configManager.js';
import { infoLog, errorLog } from '../../utils/logger.js';

let doc = null;
let currentGenerators = [];
let selectedGenId = null;
let savedGeneratorsJson = ''; // 保存后的 JSON 字符串（用于 hasChanges 检测）

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
        headerTitle.title = '切换主题';
        headerTitle.addEventListener('click', () => {
            const current = doc.documentElement.getAttribute('data-theme') || 'light';
            const next = current === 'light' ? 'dark' : 'light';
            doc.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('st_continuity_theme', next);
            window.dispatchEvent(new CustomEvent('continuity-theme-change'));
        });
    }

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
                saveBtn.textContent = '已保存';
                saveBtn.classList.add('saved');
                setTimeout(() => {
                    saveBtn.textContent = '保存';
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
        listEl.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-secondary); font-size: 12px;">暂无生成内容</div>';
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
                    <span class="module-item-name">${escapeHtml(gen.displayName || gen.name || '(未命名)')}</span>
                    <small style="opacity: 0.5; font-size: 0.8em;">#${escapeHtml(gen.name || '')}</small>
                </div>
            </div>
            <div class="module-item-actions">
                <label class="toggle-switch" title="启用/禁用">
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
        });

        // 启用/禁用开关（与 module-editor 一致）
        const toggle = item.querySelector('.gen-enable-toggle');
        toggle.addEventListener('click', (e) => {
            e.stopPropagation(); // 防止触发选中
            gen.enabled = e.target.checked;
            if (gen.enabled === false) item.classList.add('disabled');
            else item.classList.remove('disabled');
            checkForChanges();
        });

        listEl.appendChild(item);
    });
}

/**
 * 渲染右侧详情（复用 settings-container / form-grid / form-group class）
 * 加 module-detail-view class 使 form-group 保持行布局（与 module-editor 详情页一致）
 */
function renderGeneratorDetail() {
    const detailEl = doc.getElementById('gen-detail');
    if (!detailEl) return;

    const gen = currentGenerators.find(g => g.id === selectedGenId);
    if (!gen) {
        detailEl.innerHTML = '<div style="text-align: center; margin-top: 50px; color: var(--text-muted);"><p>请从左侧选择一个生成内容进行编辑</p><p>或者点击 + 号创建新内容</p></div>';
        return;
    }

    detailEl.innerHTML = `
        <div class="settings-container module-detail-view">
            <div class="form-section-title">基本信息</div>
            <div class="form-grid">
                <div class="form-group">
                    <label>标识 (name, 英文)</label>
                    <input type="text" id="gen-name" value="${escapeHtml(gen.name || '')}" placeholder="如 side_scene">
                </div>
                <div class="form-group">
                    <label>显示名称</label>
                    <input type="text" id="gen-display-name" value="${escapeHtml(gen.displayName || '')}" placeholder="如 默认小剧场">
                </div>
            </div>
            <div class="form-grid">
                <div class="form-group">
                    <label>启用</label>
                    <select id="gen-enabled">
                        <option value="true" ${gen.enabled !== false ? 'selected' : ''}>启用</option>
                        <option value="false" ${gen.enabled === false ? 'selected' : ''}>禁用</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>提示词模式</label>
                    <select id="gen-prompt-mode">
                        <option value="random" ${gen.promptMode === 'random' ? 'selected' : ''}>random (随机选一个)</option>
                        <option value="select" ${gen.promptMode === 'select' ? 'selected' : ''}>select (面板多选合并)</option>
                    </select>
                </div>
            </div>
            <div class="prompts-section">
                <h3>
                    <span>提示词列表 (${(gen.prompts || []).length})</span>
                </h3>
                <div id="prompts-container"></div>
                <div class="btn-add-prompt" id="btn-add-prompt">+ 新增提示词</div>
            </div>
            <button class="btn-delete-gen" id="btn-delete-gen">删除此生成内容</button>
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
}

/**
 * 渲染 prompts 列表
 */
function renderPrompts(gen) {
    const container = doc.getElementById('prompts-container');
    if (!container) return;
    container.innerHTML = '';

    if (!gen.prompts || gen.prompts.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:5px;">暂无提示词，点击下方"新增提示词"添加。</div>';
        return;
    }

    gen.prompts.forEach((prompt, index) => {
        const item = doc.createElement('div');
        item.className = 'prompt-item';
        item.innerHTML = `
            <div class="prompt-header">
                <input type="text" class="prompt-label-input" value="${escapeHtml(prompt.label || '')}" placeholder="标签（如 日常场景）" data-prompt-index="${index}" data-field="label">
                <div class="btn-delete-prompt" data-prompt-index="${index}">删除</div>
            </div>
            <textarea data-prompt-index="${index}" data-field="content" placeholder="提示词内容...">${escapeHtml(prompt.content || '')}</textarea>
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
 */
function collectCurrentDetail() {
    const gen = currentGenerators.find(g => g.id === selectedGenId);
    if (!gen) return;

    const nameEl = doc.getElementById('gen-name');
    const displayNameEl = doc.getElementById('gen-display-name');
    const enabledEl = doc.getElementById('gen-enabled');
    const promptModeEl = doc.getElementById('gen-prompt-mode');

    if (nameEl) gen.name = nameEl.value.trim();
    if (displayNameEl) gen.displayName = displayNameEl.value.trim();
    if (enabledEl) gen.enabled = enabledEl.value === 'true';
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
    if (!confirm('确认删除此生成内容？')) return;

    currentGenerators = currentGenerators.filter(g => g.id !== genId);
    selectedGenId = currentGenerators.length > 0 ? currentGenerators[0].id : null;

    renderGeneratorList();
    renderGeneratorDetail();
    checkForChanges();

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
        const prefix = `第${index + 1}个`;
        if (!gen.name) {
            errors.push(`${prefix}: name 不能为空`);
        } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(gen.name)) {
            errors.push(`${prefix}: name "${gen.name}" 只能含英文/数字/下划线，且不以数字开头`);
        } else if (names.has(gen.name)) {
            errors.push(`${prefix}: name "${gen.name}" 重复`);
        } else {
            names.add(gen.name);
        }
        if (!gen.displayName) {
            errors.push(`${prefix}: 显示名称不能为空`);
        }
    });

    if (errors.length > 0) {
        alert('保存失败：\n' + errors.join('\n'));
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
        alert('保存失败：' + err.message);
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
