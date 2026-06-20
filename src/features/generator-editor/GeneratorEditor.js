// src/features/generator-editor/GeneratorEditor.js
// 生成内容配置编辑器（小剧场、角色心理等）
// 用 IframeModal srcdoc 模式，列表+详情+增删改 generators
// 主题同步：读 localStorage.st_continuity_theme，<link> 引入 themes.css

import configManager from '../../singleton/configManager.js';
import { infoLog, errorLog, warnLog } from '../../utils/logger.js';

let doc = null;
let currentGenerators = [];
let selectedGenId = null;

/**
 * 打开生成内容配置编辑器
 * @param {object} iframeModal - IframeModal 实例
 * @param {string} extensionPath - 插件根目录路径
 */
export function openGeneratorEditor(iframeModal, extensionPath) {
    const html = buildHtml(extensionPath);
    iframeModal.open(null, '生成内容配置', {
        variant: 'drawer-left',
        srcdoc: html,
        onLoad: (iframe) => {
            doc = iframe.contentDocument;
            initGeneratorEditor(doc);

            // 保存/取消按钮在主窗口上下文绑定，可直接关闭 modal
            const saveBtn = doc.getElementById('btn-save');
            const cancelBtn = doc.getElementById('btn-cancel');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    if (saveGenerators()) {
                        iframeModal.close();
                    }
                });
            }
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    iframeModal.close();
                });
            }

            // 内部关闭按钮
            const closeBtn = doc.getElementById('close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => iframeModal.close());
            }
        }
    });
}

/**
 * 构建 HTML 字符串（含主题 CSS + 内联样式）
 */
function buildHtml(extensionPath) {
    const theme = localStorage.getItem('st_continuity_theme') || 'light';
    return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}">
<head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="${extensionPath}/src/features/module-editor/styles/themes.css">
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 10px;
            font-family: var(--ccore-font-family, sans-serif);
            background: var(--ccore-bg, #fff);
            color: var(--ccore-text, #333);
            height: 100vh;
            overflow: hidden;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--ccore-border, #ccc);
            margin-bottom: 10px;
        }
        .header h2 { margin: 0; font-size: 16px; }
        .close-btn {
            cursor: pointer;
            font-size: 20px;
            padding: 2px 8px;
            border-radius: 4px;
        }
        .close-btn:hover { background: var(--ccore-border, #eee); }
        .container {
            display: flex;
            gap: 10px;
            height: calc(100vh - 110px);
        }
        .sidebar {
            width: 220px;
            border-right: 1px solid var(--ccore-border, #ccc);
            padding-right: 8px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }
        .gen-list { flex: 1; overflow-y: auto; }
        .gen-item {
            padding: 8px 10px;
            cursor: pointer;
            border-radius: 4px;
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 2px;
            font-size: 13px;
        }
        .gen-item:hover { background: var(--ccore-hover, rgba(128,128,128,0.1)); }
        .gen-item.active {
            background: var(--ccore-accent, #4a90d9);
            color: #fff;
        }
        .gen-item .gen-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gen-item .gen-toggle {
            width: 14px; height: 14px;
            border: 1px solid currentColor;
            border-radius: 3px;
            display: flex; align-items: center; justify-content: center;
            font-size: 10px;
            flex-shrink: 0;
        }
        .btn-add {
            margin-top: 8px;
            padding: 6px;
            text-align: center;
            cursor: pointer;
            border: 1px dashed var(--ccore-border, #ccc);
            border-radius: 4px;
            font-size: 13px;
        }
        .btn-add:hover { background: var(--ccore-hover, rgba(128,128,128,0.1)); }
        .main {
            flex: 1;
            overflow-y: auto;
            padding: 0 5px;
        }
        .empty-hint {
            color: var(--ccore-muted, #999);
            text-align: center;
            padding: 40px 10px;
            font-size: 13px;
        }
        .form-group { margin-bottom: 12px; }
        .form-group label {
            display: block;
            margin-bottom: 4px;
            font-weight: bold;
            font-size: 13px;
        }
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 5px 8px;
            border: 1px solid var(--ccore-border, #ccc);
            border-radius: 4px;
            background: var(--ccore-input-bg, #fff);
            color: var(--ccore-text, #333);
            font-size: 13px;
            font-family: inherit;
        }
        .form-group textarea { resize: vertical; min-height: 60px; }
        .form-row {
            display: flex;
            gap: 10px;
        }
        .form-row .form-group { flex: 1; }
        .prompts-section {
            border: 1px solid var(--ccore-border, #ccc);
            border-radius: 4px;
            padding: 8px;
            margin-top: 10px;
        }
        .prompts-section h3 {
            margin: 0 0 8px 0;
            font-size: 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .prompt-item {
            border: 1px solid var(--ccore-border, #eee);
            padding: 8px;
            margin-bottom: 8px;
            border-radius: 4px;
            background: var(--ccore-card-bg, rgba(128,128,128,0.05));
        }
        .prompt-item .prompt-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
        }
        .prompt-item .prompt-label-input {
            flex: 1;
            margin-right: 5px;
            padding: 3px 6px;
            border: 1px solid var(--ccore-border, #ccc);
            border-radius: 3px;
            background: var(--ccore-input-bg, #fff);
            color: var(--ccore-text, #333);
            font-size: 12px;
        }
        .prompt-item textarea {
            width: 100%;
            min-height: 80px;
            padding: 5px;
            border: 1px solid var(--ccore-border, #ccc);
            border-radius: 3px;
            background: var(--ccore-input-bg, #fff);
            color: var(--ccore-text, #333);
            font-size: 12px;
            font-family: monospace;
            resize: vertical;
        }
        .btn-delete-prompt {
            cursor: pointer;
            padding: 3px 8px;
            border: 1px solid var(--ccore-border, #ccc);
            border-radius: 3px;
            font-size: 12px;
            background: var(--ccore-input-bg, #fff);
            color: var(--ccore-text, #333);
        }
        .btn-delete-prompt:hover { background: rgba(244,67,54,0.1); }
        .btn-add-prompt {
            cursor: pointer;
            padding: 5px;
            text-align: center;
            border: 1px dashed var(--ccore-border, #ccc);
            border-radius: 4px;
            font-size: 12px;
            margin-top: 5px;
        }
        .btn-add-prompt:hover { background: var(--ccore-hover, rgba(128,128,128,0.1)); }
        .btn-delete-gen {
            margin-top: 15px;
            padding: 5px 15px;
            cursor: pointer;
            border: 1px solid rgba(244,67,54,0.5);
            border-radius: 4px;
            background: transparent;
            color: rgba(244,67,54,0.8);
            font-size: 13px;
        }
        .btn-delete-gen:hover { background: rgba(244,67,54,0.1); }
        .actions {
            position: fixed;
            bottom: 10px;
            right: 20px;
            display: flex;
            gap: 10px;
            z-index: 10;
        }
        .btn {
            padding: 6px 20px;
            border-radius: 4px;
            cursor: pointer;
            border: 1px solid var(--ccore-border, #ccc);
            background: var(--ccore-input-bg, #fff);
            color: var(--ccore-text, #333);
            font-size: 13px;
        }
        .btn:hover { background: var(--ccore-hover, rgba(128,128,128,0.1)); }
        .btn-primary {
            background: var(--ccore-accent, #4a90d9);
            color: #fff;
            border-color: var(--ccore-accent, #4a90d9);
        }
        .btn-primary:hover { filter: brightness(0.9); }
    </style>
</head>
<body>
    <div class="header">
        <h2>生成内容配置</h2>
        <div id="close-btn" class="close-btn" title="关闭">&times;</div>
    </div>
    <div class="container">
        <div class="sidebar">
            <div class="gen-list" id="gen-list"></div>
            <div class="btn-add" id="btn-add-generator">+ 新增生成内容</div>
        </div>
        <div class="main" id="gen-detail">
            <div class="empty-hint">选择左侧的生成内容进行编辑，或点击"新增"创建。</div>
        </div>
    </div>
    <div class="actions">
        <div class="btn" id="btn-cancel">取消</div>
        <div class="btn btn-primary" id="btn-save">保存</div>
    </div>
</body>
</html>`;
}

/**
 * 初始化编辑器
 */
function initGeneratorEditor(iframeDoc) {
    doc = iframeDoc;

    // 加载数据（深拷贝避免直接修改引用）
    const config = configManager.getGeneratorConfig();
    currentGenerators = JSON.parse(JSON.stringify(config.generators || []));

    // 选中第一个（如果有）
    if (currentGenerators.length > 0) {
        selectedGenId = currentGenerators[0].id;
    }

    // 渲染
    renderGeneratorList();
    renderGeneratorDetail();

    // 绑定新增按钮
    const addBtn = doc.getElementById('btn-add-generator');
    if (addBtn) {
        addBtn.addEventListener('click', addGenerator);
    }

    infoLog('[GeneratorEditor] 初始化完成，共', currentGenerators.length, '个生成内容');
}

/**
 * 渲染左侧列表
 */
function renderGeneratorList() {
    const listEl = doc.getElementById('gen-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (currentGenerators.length === 0) {
        listEl.innerHTML = '<div style="color:var(--ccore-muted,#999);text-align:center;padding:15px;font-size:12px;">暂无生成内容</div>';
        return;
    }

    currentGenerators.forEach(gen => {
        const item = doc.createElement('div');
        item.className = 'gen-item' + (gen.id === selectedGenId ? ' active' : '');
        item.dataset.genId = gen.id;

        // 启用状态指示
        const toggle = doc.createElement('div');
        toggle.className = 'gen-toggle';
        toggle.textContent = gen.enabled !== false ? '✓' : '';

        const name = doc.createElement('div');
        name.className = 'gen-name';
        name.textContent = gen.displayName || gen.name || '(未命名)';

        item.appendChild(toggle);
        item.appendChild(name);

        item.addEventListener('click', () => {
            // 切换前收集当前编辑
            collectCurrentDetail();
            selectedGenId = gen.id;
            renderGeneratorList();
            renderGeneratorDetail();
        });

        listEl.appendChild(item);
    });
}

/**
 * 渲染右侧详情
 */
function renderGeneratorDetail() {
    const detailEl = doc.getElementById('gen-detail');
    if (!detailEl) return;

    const gen = currentGenerators.find(g => g.id === selectedGenId);
    if (!gen) {
        detailEl.innerHTML = '<div class="empty-hint">选择左侧的生成内容进行编辑，或点击"新增"创建。</div>';
        return;
    }

    detailEl.innerHTML = `
        <div class="form-row">
            <div class="form-group">
                <label>标识 (name, 英文)</label>
                <input type="text" id="gen-name" value="${escapeHtml(gen.name || '')}" placeholder="如 side_scene">
            </div>
            <div class="form-group">
                <label>显示名称</label>
                <input type="text" id="gen-display-name" value="${escapeHtml(gen.displayName || '')}" placeholder="如 默认小剧场">
            </div>
        </div>
        <div class="form-row">
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
    `;

    // 渲染 prompts
    renderPrompts(gen);

    // 绑定新增 prompt
    const addPromptBtn = doc.getElementById('btn-add-prompt');
    if (addPromptBtn) {
        addPromptBtn.addEventListener('click', addPrompt);
    }

    // 绑定删除 generator
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
        container.innerHTML = '<div style="color:var(--ccore-muted,#999);font-size:12px;padding:5px;">暂无提示词，点击下方"新增提示词"添加。</div>';
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

    // 绑定删除 prompt
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

    // 收集 prompts
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
    // 收集当前编辑
    collectCurrentDetail();

    // 生成新 id
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

    infoLog('[GeneratorEditor] 新增生成内容, id:', newGen.id);
}

/**
 * 删除 generator
 */
function deleteGenerator(genId) {
    if (!confirm('确认删除此生成内容？')) return;

    currentGenerators = currentGenerators.filter(g => g.id !== genId);

    // 选中第一个（如果有）
    selectedGenId = currentGenerators.length > 0 ? currentGenerators[0].id : null;

    renderGeneratorList();
    renderGeneratorDetail();

    infoLog('[GeneratorEditor] 删除生成内容, id:', genId);
}

/**
 * 新增 prompt
 */
function addPrompt() {
    // 收集当前编辑
    collectCurrentDetail();

    const gen = currentGenerators.find(g => g.id === selectedGenId);
    if (!gen) return;

    gen.prompts = gen.prompts || [];
    gen.prompts.push({ label: '', content: '' });

    renderPrompts(gen);
}

/**
 * 删除 prompt
 */
function deletePrompt(index) {
    // 收集当前编辑
    collectCurrentDetail();

    const gen = currentGenerators.find(g => g.id === selectedGenId);
    if (!gen || !gen.prompts) return;

    gen.prompts.splice(index, 1);
    renderPrompts(gen);
}

/**
 * 保存到 configManager
 * @returns {boolean} 是否保存成功
 */
function saveGenerators() {
    // 收集当前编辑
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
