/**
 * 模块编辑器主逻辑
 * 注意：此脚本现在运行在主窗口上下文中，直接操作 Iframe 的 DOM
 */

import { i18n } from '../../_utils/i18n.js';
import configManager from '../../singleton/configManager.js';
import { debugLog, infoLog, warnLog, errorLog } from '../../utils/logger.js';
import moduleCacheManager from '../../singleton/moduleCacheManager.js';
import { getContext } from '../../index.js';

// === 状态管理 ===
let currentModules = []; // 当前编辑的模块列表副本
let selectedModuleId = null; // 记录当前选中的模块 ID

// === 渲染逻辑 ===
// 拖拽状态变量
let dragSrcEl = null;
let dragType = null; // 'module' or 'variable'
let dropPosition = null; // 'before' or 'after'

// 全局文档引用 (指向 Iframe 的 document)
let doc = null;

/**
 * 初始化模块编辑器
 * @param {Document} iframeDocument Iframe 的文档对象
 */
export function initModuleEditor(iframeDocument) {
    doc = iframeDocument;
    debugLog("ModuleEditor initialized with document context");

    // 应用静态文本翻译
    i18n.apply(doc, 'module_editor');

    // 加载真实数据 (深拷贝以避免直接修改引用，直到保存)
    const modules = configManager.getModules(true); // true 表示获取所有模块(包括禁用的)
    currentModules = JSON.parse(JSON.stringify(modules));

    // 初始化视图
    renderModuleList();
    renderToolbox();

    // 绑定顶部栏事件 (主题切换等)
    bindHeaderEvents();

    // 绑定导航事件
    bindNavigationEvents();
}

function bindHeaderEvents() {
    const themeSelect = doc.getElementById('theme-select');
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            doc.documentElement.setAttribute('data-theme', e.target.value);
        });
    }
}

function bindNavigationEvents() {
    const navItems = doc.querySelectorAll('.nav-item');
    const sections = doc.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // 1. 移除所有 active 状态
            navItems.forEach(n => n.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));

            // 2. 激活当前项
            item.classList.add('active');
            const targetId = item.getAttribute('data-target');
            const targetSection = doc.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');
            }
        });
    });
}

/**
 * 渲染模块列表
 */
function renderModuleList() {
    const listContainer = doc.getElementById('module-list');
    listContainer.innerHTML = ''; // 清空

    // 指定使用 'module_editor' 功能区的翻译
    const section = 'module_editor';

    currentModules.forEach((mod, index) => {
        const item = doc.createElement('div');
        item.className = 'module-list-item';
        item.setAttribute('draggable', 'true'); // 启用拖拽
        item.dataset.index = index; // 存储索引
        if (!mod.enabled) item.classList.add('disabled');
        // 如果是当前选中的模块，添加 active 类
        if (mod.name === selectedModuleId) { // 使用 name 作为 ID
            item.classList.add('active');
        }

        // 列表项简化：只显示名字和ID
        item.innerHTML = `
            <div class="module-item-header">
                <span class="module-item-name">${mod.displayName || mod.name}</span>
                <small style="opacity: 0.5; font-size: 0.8em;">#${mod.name}</small>
            </div>
        `;

        // 点击事件
        item.addEventListener('click', () => {
            // 移除其他选中状态
            doc.querySelectorAll('.module-list-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            selectedModuleId = mod.name;
            renderModuleDetail(mod, index);

            // 移动端适配：点击后切换到详情视图
            if (window.innerWidth <= 768) {
                doc.body.classList.add('mobile-view-detail');
            }
        });

        // 绑定拖拽事件
        item.addEventListener('dragstart', (e) => handleDragStart(e, item, 'module'));
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', (e) => handleDrop(e, item, 'module', currentModules, () => {
            renderModuleList();
            saveChanges(); // 拖拽排序后自动保存
        }));
        item.addEventListener('dragend', handleDragEnd);

        listContainer.appendChild(item);
    });

    // 绑定添加模块按钮 (列表底部的 + 号)
    // 注意：原来的 HTML 中可能没有 ID，我们需要在 HTML 中给那个按钮加个 ID 或者在这里查找
    const addBtn = listContainer.parentElement.querySelector('.list-toolbar button');
    if (addBtn) {
        // 移除旧监听器 (简单粗暴的方法是克隆节点，或者确保只绑定一次)
        const newAddBtn = addBtn.cloneNode(true);
        addBtn.parentNode.replaceChild(newAddBtn, addBtn);

        newAddBtn.addEventListener('click', () => {
            createNewModule();
        });
    }
}

/**
 * 渲染模块详情表单 (右侧)
 * @param {Object} module 模块数据对象
 * @param {number} index 模块在数组中的索引
 */
function renderModuleDetail(module, index) {
    const container = doc.querySelector('.module-detail-panel .detail-content');
    const section = 'module_editor';

    // 生成表单 HTML
    container.innerHTML = `
        <div style="max-width: 600px; margin: 0 auto;">
            <!-- 移动端返回按钮 -->
            <button id="btn-back-to-list" class="mobile-only" style="background: none; border: none; color: var(--text-primary); font-size: 16px; cursor: pointer; margin-bottom: 15px; display: flex; align-items: center; gap: 5px;">
                <span>←</span> 返回列表
            </button>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
                <h2 style="margin: 0;">${module.displayName || module.name}</h2>
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; background: var(--bg-input); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                    <input type="checkbox" id="edit-enabled" ${module.enabled ? 'checked' : ''}>
                    <span style="font-size: 12px; font-weight: 600;">${i18n.t('label_enabled', section)}</span>
                </label>
                <button id="btn-delete-module" style="margin-left: 10px; background: none; border: none; color: var(--danger-color); cursor: pointer;" title="删除模块">
                    🗑️
                </button>
            </div>
            
            <div class="form-grid">
                <!-- 基础信息 -->
                <div class="form-section-title">${i18n.t('title_edit_module', section)}</div>
                
                <div class="form-group">
                    <label style="display:block; margin-bottom: 5px; color: var(--text-secondary); font-size: 0.9em;">${i18n.t('label_name', section)}</label>
                    <input type="text" id="edit-name" value="${module.name}" style="width: 100%; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                </div>

                <div class="form-group">
                    <label style="display:block; margin-bottom: 5px; color: var(--text-secondary); font-size: 0.9em;">${i18n.t('label_display_name', section)}</label>
                    <input type="text" id="edit-display-name" value="${module.displayName}" style="width: 100%; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                </div>

                <div class="form-group form-full-width">
                    <label style="display:block; margin-bottom: 5px; color: var(--text-secondary); font-size: 0.9em;">${i18n.t('label_description', section)}</label>
                    <textarea id="edit-description" rows="2" style="width: 100%; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">${module.description || ''}</textarea>
                </div>

                <!-- 行为设置 -->
                <div class="form-section-title">行为设置</div>

                <div class="form-group">
                    <label style="display:block; margin-bottom: 5px; color: var(--text-secondary); font-size: 0.9em;">${i18n.t('label_output_pos', section)}</label>
                    <select id="edit-output-pos" style="width: 100%; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                        <option value="after_body" ${module.outputPos === 'after_body' ? 'selected' : ''}>正文后输出</option>
                        <option value="body" ${module.outputPos === 'body' ? 'selected' : ''}>正文内输出</option>
                        <option value="body_start" ${module.outputPos === 'body_start' ? 'selected' : ''}>正文内开头</option>
                        <option value="embedded" ${module.outputPos === 'embedded' ? 'selected' : ''}>可嵌入</option>
                    </select>
                </div>

                <div class="form-group">
                    <label style="display:block; margin-bottom: 5px; color: var(--text-secondary); font-size: 0.9em;">${i18n.t('label_output_mode', section)}</label>
                    <select id="edit-output-mode" style="width: 100%; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                        <option value="full" ${module.outputMode === 'full' ? 'selected' : ''}>全量输出</option>
                        <option value="incremental" ${module.outputMode === 'incremental' ? 'selected' : ''}>增量更新</option>
                    </select>
                </div>

                <div class="form-group">
                    <label style="display:block; margin-bottom: 5px; color: var(--text-secondary); font-size: 0.9em;">${i18n.t('label_range_mode', section)}</label>
                    <select id="edit-range-mode" style="width: 100%; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                        <option value="unlimited" ${module.rangeMode === 'unlimited' ? 'selected' : ''}>无限制</option>
                        <option value="specified" ${module.rangeMode === 'specified' ? 'selected' : ''}>指定数量</option>
                    </select>
                </div>

                <div class="form-group">
                    <label style="display:block; margin-bottom: 5px; color: var(--text-secondary); font-size: 0.9em;">${i18n.t('label_retain_layers', section)}</label>
                    <input type="number" id="edit-retain-layers" value="${module.retainLayers || -1}" style="width: 100%; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                </div>

                <!-- 高级开关 -->
                <div class="form-group form-full-width" style="display: flex; gap: 20px; margin-top: 5px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="edit-external" ${module.isExternalDisplay ? 'checked' : ''}>
                        <span style="font-size: 0.9em;">${i18n.t('label_external', section)} (isExternalDisplay)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="edit-time-ref" ${module.tags && module.tags.includes('time_ref') ? 'checked' : ''}>
                        <span style="font-size: 0.9em;">${i18n.t('label_time_ref', section)}</span>
                    </label>
                </div>

                <!-- 提示词设置 -->
                <div class="form-section-title">提示词配置</div>

                <div class="form-group form-full-width">
                    <label style="display:block; margin-bottom: 5px; color: var(--text-secondary); font-size: 0.9em;">${i18n.t('label_prompt_gen', section)}</label>
                    <textarea id="edit-prompt-gen" rows="3" style="width: 100%; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px; font-family: monospace;">${module.promptGen || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label style="display:block; margin-bottom: 5px; color: var(--text-secondary); font-size: 0.9em;">${i18n.t('label_styles_container', section)}</label>
                    <textarea id="edit-styles-container" rows="2" style="width: 100%; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px; font-family: monospace;">${module.stylesContainer || ''}</textarea>
                </div>

                <!-- 变量管理 -->
                <div class="form-section-title" style="display:flex; justify-content:space-between; align-items:center;">
                    <span>${i18n.t('title_variables', section)}</span>
                    <button id="btn-add-variable" style="padding: 4px 8px; font-size: 12px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px; cursor: pointer;">
                        + ${i18n.t('btn_add_variable', section)}
                    </button>
                </div>
                <div class="form-full-width" id="variable-list-container">
                    <!-- 变量列表将在这里渲染 -->
                </div>
            </div>

            <div style="text-align: right; margin-top: 30px;">
                <button id="btn-save-module" style="padding: 8px 20px; background: var(--accent-color); color: var(--bg-app); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px; transition: opacity 0.2s;">
                    ${i18n.t('btn_save', section)}
                </button>
            </div>
            
            <div style="height: 50px;"></div> <!-- 底部留白 -->
        </div>
    `;

    // 渲染变量列表
    renderVariableList(module, doc.getElementById('variable-list-container'));

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

    // 绑定添加变量按钮
    doc.getElementById('btn-add-variable').addEventListener('click', () => {
        if (!module.variables) module.variables = [];
        module.variables.push({
            name: 'new_var',
            displayName: '新变量',
            enabled: true,
            description: '',
            isIdentifier: false,
            isBackupIdentifier: false,
            isHideCondition: false,
            hideConditionValues: [],
            isNoNormalize: false,
            customStyles: ''
        });
        renderVariableList(module, doc.getElementById('variable-list-container'));
    });

    // 绑定保存按钮事件
    doc.getElementById('btn-save-module').addEventListener('click', () => {
        // 1. 收集表单数据更新到当前模块对象
        module.name = doc.getElementById('edit-name').value;
        module.displayName = doc.getElementById('edit-display-name').value;
        module.enabled = doc.getElementById('edit-enabled').checked;
        module.description = doc.getElementById('edit-description').value;

        module.outputPos = doc.getElementById('edit-output-pos').value;
        module.outputMode = doc.getElementById('edit-output-mode').value;
        module.rangeMode = doc.getElementById('edit-range-mode').value;
        module.retainLayers = parseInt(doc.getElementById('edit-retain-layers').value) || -1;

        module.isExternalDisplay = doc.getElementById('edit-external').checked;

        // 处理 tags (time_ref)
        if (!module.tags) module.tags = [];
        const isTimeRef = doc.getElementById('edit-time-ref').checked;
        if (isTimeRef && !module.tags.includes('time_ref')) {
            module.tags.push('time_ref');
        } else if (!isTimeRef && module.tags.includes('time_ref')) {
            module.tags = module.tags.filter(t => t !== 'time_ref');
        }

        module.promptGen = doc.getElementById('edit-prompt-gen').value;
        module.stylesContainer = doc.getElementById('edit-styles-container').value;

        // 2. 刷新左侧列表
        renderModuleList();

        // 3. 保存到 configManager
        saveChanges();

        // 4. 反馈动画
        const btn = doc.getElementById('btn-save-module');
        const originalText = btn.textContent;
        btn.textContent = "✔ OK";
        setTimeout(() => btn.textContent = originalText, 1000);
    });
}

/**
 * 创建新模块
 */
function createNewModule() {
    const newModule = {
        name: `new_module_${Date.now()}`,
        displayName: '新模块',
        enabled: true,
        description: '',
        variables: []
    };
    currentModules.push(newModule);
    renderModuleList();
    // 自动选中新模块
    const lastIndex = currentModules.length - 1;
    selectedModuleId = newModule.name;
    // 触发点击以显示详情
    const items = doc.querySelectorAll('.module-list-item');
    if (items[lastIndex]) items[lastIndex].click();

    // 自动保存
    saveChanges();
}

/**
 * 渲染变量列表
 * @param {Object} module 模块对象
 * @param {HTMLElement} container 容器元素
 */
function renderVariableList(module, container) {
    if (!container) {
        errorLog("renderVariableList: 容器不存在");
        return;
    }
    container.innerHTML = '';
    const section = 'module_editor';

    if (!module.variables || module.variables.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.9em; border: 1px dashed var(--border-color); border-radius: 4px;">暂无变量</div>`;
        return;
    }

    module.variables.forEach((variable, index) => {
        const item = doc.createElement('div');
        item.className = 'variable-edit-item';
        item.setAttribute('draggable', 'true'); // 启用拖拽
        item.dataset.index = index;

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="drag-handle" title="拖拽排序">⋮⋮</span>
                    <div style="font-weight: bold;">#${index + 1}</div>
                </div>
                <button class="btn-delete-variable" style="color: var(--danger-color); background: none; border: none; cursor: pointer; font-size: 1.2em;">✕</button>
            </div>
            <div class="form-grid" style="gap: 10px; margin-bottom: 0;">
                <div class="form-group">
                    <label style="font-size: 0.8em; color: var(--text-secondary);">${i18n.t('label_var_name', section)}</label>
                    <input type="text" class="var-name" value="${variable.name || ''}" style="width: 100%; padding: 6px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                </div>
                <div class="form-group">
                    <label style="font-size: 0.8em; color: var(--text-secondary);">${i18n.t('label_var_display_name', section)}</label>
                    <input type="text" class="var-display-name" value="${variable.displayName || ''}" style="width: 100%; padding: 6px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                </div>
                <div class="form-group form-full-width">
                    <label style="font-size: 0.8em; color: var(--text-secondary);">${i18n.t('label_var_description', section)}</label>
                    <input type="text" class="var-description" value="${variable.description || ''}" style="width: 100%; padding: 6px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                </div>
                
                <div class="form-group form-full-width" style="display: flex; flex-wrap: wrap; gap: 15px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.9em;">
                        <input type="checkbox" class="var-enabled" ${variable.enabled !== false ? 'checked' : ''}> ${i18n.t('label_var_enabled', section)}
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.9em;">
                        <input type="checkbox" class="var-identifier" ${variable.isIdentifier ? 'checked' : ''}> ${i18n.t('label_var_identifier', section)}
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.9em;">
                        <input type="checkbox" class="var-backup-identifier" ${variable.isBackupIdentifier ? 'checked' : ''}> ${i18n.t('label_var_backup_identifier', section)}
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.9em;">
                        <input type="checkbox" class="var-no-normalize" ${variable.isNoNormalize ? 'checked' : ''}> ${i18n.t('label_var_no_normalize', section)}
                    </label>
                </div>

                <div class="form-group form-full-width" style="border-top: 1px solid var(--border-light); padding-top: 10px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; margin-bottom: 5px; font-size: 0.9em;">
                        <input type="checkbox" class="var-hide-condition" ${variable.isHideCondition ? 'checked' : ''}> ${i18n.t('label_var_hide_condition', section)}
                    </label>
                    <input type="text" class="var-hide-values" value="${Array.isArray(variable.hideConditionValues) ? variable.hideConditionValues.join(',') : variable.hideConditionValues || ''}" placeholder="${i18n.t('label_var_hide_values', section)}" style="width: 100%; padding: 6px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px; display: ${variable.isHideCondition ? 'block' : 'none'};">
                </div>

                <div class="form-group form-full-width">
                    <label style="font-size: 0.8em; color: var(--text-secondary);">${i18n.t('label_var_custom_styles', section)}</label>
                    <textarea class="var-custom-styles" rows="2" style="width: 100%; padding: 6px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px; font-family: monospace;">${variable.customStyles || ''}</textarea>
                </div>
            </div>
        `;

        // 绑定输入事件，实时更新数据
        const updateVariable = () => {
            variable.name = item.querySelector('.var-name').value;
            variable.displayName = item.querySelector('.var-display-name').value;
            variable.description = item.querySelector('.var-description').value;
            variable.enabled = item.querySelector('.var-enabled').checked;
            variable.isIdentifier = item.querySelector('.var-identifier').checked;
            variable.isBackupIdentifier = item.querySelector('.var-backup-identifier').checked;
            variable.isNoNormalize = item.querySelector('.var-no-normalize').checked;
            variable.isHideCondition = item.querySelector('.var-hide-condition').checked;
            variable.hideConditionValues = item.querySelector('.var-hide-values').value.split(',').map(s => s.trim()).filter(s => s);
            variable.customStyles = item.querySelector('.var-custom-styles').value;
        };

        item.querySelectorAll('input, textarea').forEach(input => {
            input.addEventListener('input', updateVariable);
            input.addEventListener('change', updateVariable);
        });

        // 隐藏条件输入框显隐逻辑
        const hideCheck = item.querySelector('.var-hide-condition');
        const hideInput = item.querySelector('.var-hide-values');
        hideCheck.addEventListener('change', (e) => {
            hideInput.style.display = e.target.checked ? 'block' : 'none';
        });

        // 删除按钮事件
        item.querySelector('.btn-delete-variable').addEventListener('click', () => {
            if (confirm('确定要删除这个变量吗？')) {
                module.variables.splice(index, 1);
                renderVariableList(module, container);
            }
        });

        // 绑定拖拽事件
        item.addEventListener('dragstart', (e) => handleDragStart(e, item, 'variable'));
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', (e) => handleDrop(e, item, 'variable', module.variables, () => renderVariableList(module, container)));
        item.addEventListener('dragend', handleDragEnd);

        container.appendChild(item);
    });
}

// === 通用拖拽处理函数 ===

function handleDragStart(e, item, type) {
    dragSrcEl = item;
    dragType = type;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', item.innerHTML);

    // 使用 setTimeout 确保拖拽图像生成后再隐藏原元素
    setTimeout(() => {
        item.classList.add('dragging');
    }, 0);
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault(); // 允许放置
    }

    const target = e.currentTarget;
    // 简单的类型检查，防止跨类型拖拽干扰
    if (dragType === 'module' && !target.classList.contains('module-list-item')) return false;
    if (dragType === 'variable' && !target.classList.contains('variable-edit-item')) return false;
    if (target === dragSrcEl) return false; // 不对自己产生反应

    const rect = target.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;

    // 判断鼠标在元素的上半部分还是下半部分
    if (offsetY < rect.height / 2) {
        dropPosition = 'before';
        target.classList.add('over-top');
        target.classList.remove('over-bottom');
    } else {
        dropPosition = 'after';
        target.classList.add('over-bottom');
        target.classList.remove('over-top');
    }

    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    // 逻辑已移至 handleDragOver 以支持动态位置判断
}

function handleDragLeave(e) {
    // 修复下划线闪烁问题：如果进入的是当前元素的子元素，不移除样式
    if (this.contains(e.relatedTarget)) return;
    this.classList.remove('over-top');
    this.classList.remove('over-bottom');
}

function handleDrop(e, item, type, dataArray, renderCallback) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    // 确保拖拽的是同类型的项目
    if (dragSrcEl !== item && dragType === type) {
        const srcIndex = parseInt(dragSrcEl.dataset.index);
        let targetIndex = parseInt(item.dataset.index);

        // 根据放置位置调整目标索引
        if (dropPosition === 'after') {
            targetIndex++;
        }

        // 移动数组元素
        if (!isNaN(srcIndex) && !isNaN(targetIndex)) {
            const movedItem = dataArray[srcIndex];

            // 先移除源元素
            dataArray.splice(srcIndex, 1); // 移除源

            // 如果移除的元素在目标之前，目标索引需要减1
            if (srcIndex < targetIndex) {
                targetIndex--;
            }

            // 插入到新位置
            dataArray.splice(targetIndex, 0, movedItem); // 插入目标位置

            // 重新渲染列表
            renderCallback();
        }
    }

    return false;
}

function handleDragEnd(e) {
    this.classList.remove('dragging');

    // 清除所有项的 over 样式
    const selector = dragType === 'module' ? '.module-list-item' : '.variable-edit-item';
    doc.querySelectorAll(selector).forEach(el => {
        el.classList.remove('over-top');
        el.classList.remove('over-bottom');
    });
}

/**
 * 删除模块
 * @param {number} index 索引
 */
function deleteModule(index) {
    if (confirm('确定要删除这个模块吗？此操作不可恢复。')) {
        currentModules.splice(index, 1);
        selectedModuleId = null;
        // 清空详情页或显示占位符
        doc.querySelector('.module-detail-panel .detail-content').innerHTML = `
            <div style="text-align: center; margin-top: 50px; color: var(--text-muted);">
                <p>模块已删除</p>
            </div>
        `;
        renderModuleList();
        saveChanges();
        // 如果在移动端，返回列表
        doc.body.classList.remove('mobile-view-detail');
    }
}

// === 初始化 ===
// 移除 DOMContentLoaded 监听，改为由 initModuleEditor 显式调用

// === 工具箱逻辑 ===

/**
 * 渲染工具箱界面 (模块选择器)
 */
function renderToolbox() {
    debugLog("renderToolbox: 初始化工具箱界面");
    const container = doc.getElementById('tool-module-list');
    if (!container) {
        errorLog("renderToolbox: 未找到 tool-module-list 容器");
        return;
    }

    container.innerHTML = '';

    currentModules.forEach(mod => {
        const label = doc.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '8px';
        label.style.cursor = 'pointer';

        label.innerHTML = `
            <input type="checkbox" value="${mod.name}" checked style="transform: scale(1.1);">
            <span>${mod.displayName || mod.name}</span>
        `;

        container.appendChild(label);
    });

    // 绑定提取按钮 (Mock 演示)
    const btnExtract = doc.getElementById('btn-extract');
    if (btnExtract) {
        // 移除旧的监听器以防重复绑定
        const newBtn = btnExtract.cloneNode(true);
        btnExtract.parentNode.replaceChild(newBtn, btnExtract);

        newBtn.addEventListener('click', () => {
            const start = doc.getElementById('tool-floor-start').value;
            const end = doc.getElementById('tool-floor-end').value || 'Latest';
            const selected = Array.from(container.querySelectorAll('input:checked')).map(cb => cb.value);

            const resultArea = doc.getElementById('tool-results');
            resultArea.value = `[模拟提取结果]\n范围: ${start} - ${end}\n选中模块: ${selected.join(', ')}\n\n[summary|content:这是一个模拟的剧情摘要...]\n[inventory|item_name:长剑|count:1]`;
            infoLog("执行模拟提取");
        });
    }

    // === 调试按钮绑定 ===
    // 1. 打印缓存数据
    const btnDebugCache = doc.getElementById('btn-debug-cache');
    if (btnDebugCache) {
        const newBtn = btnDebugCache.cloneNode(true);
        btnDebugCache.parentNode.replaceChild(newBtn, btnDebugCache);

        newBtn.addEventListener('click', () => {
            infoLog("[Debug] 打印缓存数据");
            if (moduleCacheManager) moduleCacheManager.outputCache();
            else warnLog('moduleCacheManager not found');
        });
    } else {
        errorLog("renderToolbox: 未找到 btn-debug-cache");
    }

    // 2. 打印配置数据
    const btnDebugConfig = doc.getElementById('btn-debug-config');
    if (btnDebugConfig) {
        const newBtn = btnDebugConfig.cloneNode(true);
        btnDebugConfig.parentNode.replaceChild(newBtn, btnDebugConfig);

        newBtn.addEventListener('click', () => {
            infoLog("[Debug] 打印配置数据");
            if (configManager) configManager.outputCache();
            else warnLog('configManager not found');
        });
    } else {
        errorLog("renderToolbox: 未找到 btn-debug-config");
    }

    // 3. 打印上下文数据
    const btnDebugContext = doc.getElementById('btn-debug-context');
    if (btnDebugContext) {
        const newBtn = btnDebugContext.cloneNode(true);
        btnDebugContext.parentNode.replaceChild(newBtn, btnDebugContext);

        newBtn.addEventListener('click', () => {
            infoLog("[Debug] 打印上下文数据");
            if (getContext) {
                const context = getContext();
                infoLog('[Module Cache]打印当前上下文数据:', context);
            } else {
                warnLog('getContext not found');
            }
        });
    } else {
        errorLog("renderToolbox: 未找到 btn-debug-context");
    }
}

/**
 * 保存更改到 ConfigManager
 */
function saveChanges() {
    configManager.setModules(currentModules);
    infoLog("[ModuleEditor] 模块配置已保存");
}