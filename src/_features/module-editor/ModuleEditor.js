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
let currentGlobalSettings = {}; // 当前编辑的全局设置副本
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

    // 加载全局设置
    currentGlobalSettings = JSON.parse(JSON.stringify(configManager.getGlobalSettings()));

    // 初始化视图
    renderModuleList();
    renderToolbox();
    renderGlobalSettings();

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
            <div class="module-item-content">
                <div class="module-item-header">
                    <span class="module-item-name">${mod.displayName || mod.name}</span>
                    <small style="opacity: 0.5; font-size: 0.8em;">#${mod.name}</small>
                </div>
            </div>
            <div class="module-item-actions">
                <label class="toggle-switch" title="启用/禁用">
                    <input type="checkbox" class="module-enable-toggle" ${mod.enabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
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

        // 绑定启用/禁用开关事件
        const toggle = item.querySelector('.module-enable-toggle');
        toggle.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止冒泡，防止触发选中
            mod.enabled = e.target.checked;
            if (!mod.enabled) item.classList.add('disabled');
            else item.classList.remove('disabled');

            saveChanges(); // 自动保存
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
        <div class="settings-container">
            <!-- 移动端返回按钮 -->
            <button id="btn-back-to-list" class="mobile-only btn-back">
                <span>←</span> 返回列表
            </button>

            <div class="module-header">
                <h2 class="module-title">${module.displayName || module.name}</h2>
                <button id="btn-delete-module" class="btn-icon btn-delete" title="删除模块">
                    🗑️
                </button>
            </div>
            
            <!-- Tab Navigation -->
            <div class="detail-tabs">
                <div class="detail-tab-item active" data-target="module-detail-settings">模块设置</div>
                <div class="detail-tab-item" data-target="module-detail-variables">变量管理</div>
            </div>

            <!-- Tab Panel: Settings -->
            <div id="module-detail-settings" class="detail-tab-panel active">
                <div class="form-grid">
                    <!-- 基础信息 -->
                    <div class="form-section-title">${i18n.t('title_edit_module', section)}</div>
                    
                    <div class="form-group">
                        <label>${i18n.t('label_name', section)}</label>
                        <input type="text" id="edit-name" value="${module.name}">
                    </div>

                    <div class="form-group">
                        <label>${i18n.t('label_display_name', section)}</label>
                        <input type="text" id="edit-display-name" value="${module.displayName}">
                    </div>

                    <!-- 行为设置 -->
                    <div class="form-section-title">行为设置</div>

                    <div class="form-group">
                        <label>${i18n.t('label_output_pos', section)}</label>
                        <select id="edit-output-pos">
                            <option value="after_body" ${module.outputPosition === 'after_body' ? 'selected' : ''}>正文后输出</option>
                            <option value="body" ${module.outputPosition === 'body' ? 'selected' : ''}>正文内输出</option>
                            <option value="body_start" ${module.outputPosition === 'body_start' ? 'selected' : ''}>正文内开头</option>
                            <option value="body_end" ${module.outputPosition === 'body_end' ? 'selected' : ''}>正文内结尾</option>
                            <option value="body_surround" ${module.outputPosition === 'body_surround' ? 'selected' : ''}>正文内首末</option>
                            <option value="specific_position" ${module.outputPosition === 'specific_position' ? 'selected' : ''}>正文内特定位置</option>
                            <option value="embedded" ${module.outputPosition === 'embedded' ? 'selected' : ''}>可嵌入</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>${i18n.t('label_output_mode', section)}</label>
                        <select id="edit-output-mode">
                            <option value="full" ${module.outputMode === 'full' ? 'selected' : ''}>全量输出</option>
                            <option value="incremental" ${module.outputMode === 'incremental' ? 'selected' : ''}>增量更新</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>${i18n.t('label_range_mode', section)}</label>
                        <div style="display: flex; gap: 10px;">
                            <select id="edit-range-mode" style="flex: 1; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px;">
                                <option value="unlimited" ${module.rangeMode === 'unlimited' ? 'selected' : ''}>无限制</option>
                                <option value="specified" ${module.rangeMode === 'specified' ? 'selected' : ''}>指定数量</option>
                                <option value="range" ${module.rangeMode === 'range' ? 'selected' : ''}>指定范围</option>
                            </select>
                            <input type="number" id="edit-item-min" value="${module.itemMin || 0}" placeholder="${i18n.t('label_item_min', section)}" style="width: 70px; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px; display: none;">
                            <input type="number" id="edit-item-max" value="${module.itemMax || 1}" placeholder="${i18n.t('label_item_max', section)}" style="width: 70px; padding: 8px; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-input); border-radius: 4px; display: none;">
                        </div>
                    </div>

                    <div class="form-group">
                        <label>${i18n.t('label_retain_layers', section)}</label>
                        <input type="number" id="edit-retain-layers" value="${module.retainLayers || -1}">
                    </div>

                    <div class="form-group form-full-width">
                        <label>${i18n.t('label_compatible_modules', section)}</label>
                        <input type="text" id="edit-compatible-modules" value="${(module.compatibleModuleNames || []).join(',')}" placeholder="兼容模块名A,兼容模块名B...">
                    </div>

                    <!-- 高级开关 -->
                    <div class="form-group form-full-width" style="display: flex; gap: 20px; margin-top: 5px;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="edit-external" ${module.isExternalDisplay ? 'checked' : ''}>
                            <span style="font-size: 0.9em;">${i18n.t('label_external', section)}</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" id="edit-time-reference-standard" ${module.timeReferenceStandard ? 'checked' : ''}>
                            <span style="font-size: 0.9em;">${i18n.t('label_time_ref', section)}</span>
                        </label>
                    </div>

                    <!-- 提示词设置 -->
                    <div class="form-section-title">提示词配置</div>

                    <div class="form-group form-full-width">
                        <label>${i18n.t('label_prompt_timing', section)}</label>
                        <textarea id="edit-prompt-timing" rows="2">${module.timingPrompt || ''}</textarea>
                    </div>

                    <div class="form-group form-full-width">
                        <label>${i18n.t('label_prompt_gen', section)}</label>
                        <textarea id="edit-prompt" rows="3">${module.prompt || ''}</textarea>
                    </div>

                    <div class="form-group form-full-width">
                        <label>${i18n.t('label_prompt_usage', section)}</label>
                        <textarea id="edit-prompt-content" rows="2">${module.contentPrompt || ''}</textarea>
                    </div>

                    <div class="form-group form-full-width">
                        <label>${i18n.t('label_prompt_position', section)}</label>
                        <textarea id="edit-prompt-position" rows="2">${module.positionPrompt || ''}</textarea>
                    </div>

                    <!-- 样式设置 -->
                    <div class="form-section-title">样式配置</div>

                    <div class="form-group form-full-width">
                        <label>${i18n.t('label_styles_container', section)}</label>
                        <textarea id="edit-styles-container" rows="2">${module.stylesContainer || ''}</textarea>
                    </div>
                    <div class="form-group form-full-width">
                        <label>${i18n.t('label_styles_external', section)}</label>
                        <textarea id="edit-styles-external" rows="2">${module.externalStyles || ''}</textarea>
                    </div>
                    <div class="form-group form-full-width">
                        <label>${i18n.t('label_styles_custom', section)}</label>
                        <textarea id="edit-styles-custom" rows="2">${module.customStyles || ''}</textarea>
                    </div>
                </div>
            </div>

            <!-- Tab Panel: Variables -->
            <div id="module-detail-variables" class="detail-tab-panel">
                <div class="form-section-title section-header">
                    <span>${i18n.t('title_variables', section)}</span>
                    <button id="btn-add-variable" class="btn-secondary">
                        + ${i18n.t('btn_add_variable', section)}
                    </button>
                </div>
                <div class="form-full-width" id="variable-list-container">
                    <!-- 变量列表将在这里渲染 -->
                </div>
            </div>

            <div class="form-actions">
                <button id="btn-save-module" class="btn-primary">
                    ${i18n.t('btn_save', section)}
                </button>
            </div>
            
            <div class="spacer-bottom"></div>
        </div>
    `;

    // 渲染变量列表
    renderVariableList(module, doc.getElementById('variable-list-container'));

    // 绑定 Tab 切换事件
    const tabs = doc.querySelectorAll('.detail-tab-item');
    const panels = doc.querySelectorAll('.detail-tab-panel');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 移除所有 active
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));

            // 激活当前
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-target');
            const targetPanel = doc.getElementById(targetId);
            if (targetPanel) targetPanel.classList.add('active');
        });
    });

    // 处理 Range Mode 联动
    const rangeModeSelect = doc.getElementById('edit-range-mode');
    const itemMinInput = doc.getElementById('edit-item-min');
    const itemMaxInput = doc.getElementById('edit-item-max');

    const updateRangeInputs = () => {
        const mode = rangeModeSelect.value;
        itemMinInput.style.display = mode === 'range' ? 'block' : 'none';
        itemMaxInput.style.display = (mode === 'specified' || mode === 'range') ? 'block' : 'none';
    };

    // 初始化状态
    updateRangeInputs();

    // 绑定变更事件
    rangeModeSelect.addEventListener('change', updateRangeInputs);

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

        module.outputPosition = doc.getElementById('edit-output-pos').value;
        module.outputMode = doc.getElementById('edit-output-mode').value;
        module.rangeMode = doc.getElementById('edit-range-mode').value;
        module.itemMin = parseInt(doc.getElementById('edit-item-min').value) || 0;
        module.itemMax = parseInt(doc.getElementById('edit-item-max').value) || 1;

        module.retainLayers = parseInt(doc.getElementById('edit-retain-layers').value) || -1;

        module.isExternalDisplay = doc.getElementById('edit-external').checked;
        module.timeReferenceStandard = doc.getElementById('edit-time-reference-standard').checked;

        module.compatibleModuleNames = doc.getElementById('edit-compatible-modules').value.split(',').map(s => s.trim()).filter(s => s);

        module.prompt = doc.getElementById('edit-prompt').value;
        module.timingPrompt = doc.getElementById('edit-prompt-timing').value;
        module.contentPrompt = doc.getElementById('edit-prompt-content').value;
        module.positionPrompt = doc.getElementById('edit-prompt-position').value;
        module.stylesContainer = doc.getElementById('edit-styles-container').value;
        module.externalStyles = doc.getElementById('edit-styles-external').value;
        module.customStyles = doc.getElementById('edit-styles-custom').value;

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
            <div class="variable-header">
                <div class="variable-drag-handle-wrapper">
                    <span class="drag-handle" title="拖拽排序">⋮⋮</span>
                    <div class="variable-index">#${index + 1}</div>
                </div>
                <button class="btn-delete-variable btn-variable-delete">✕</button>
            </div>
            <div class="form-grid variable-form-grid">
                <div class="form-group">
                    <label>${i18n.t('label_var_name', section)}</label>
                    <input type="text" class="var-name" value="${variable.name || ''}">
                </div>
                <div class="form-group">
                    <label>${i18n.t('label_var_display_name', section)}</label>
                    <input type="text" class="var-display-name" value="${variable.displayName || ''}">
                </div>
                <div class="form-group form-full-width">
                    <label>${i18n.t('label_var_description', section)}</label>
                    <input type="text" class="var-description" value="${variable.description || ''}">
                </div>
                
                <div class="form-group form-full-width checkbox-group">
                    <label class="checkbox-label">
                        <input type="checkbox" class="var-enabled" ${variable.enabled !== false ? 'checked' : ''}> ${i18n.t('label_var_enabled', section)}
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" class="var-identifier" ${variable.isIdentifier ? 'checked' : ''}> ${i18n.t('label_var_identifier', section)}
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" class="var-backup-identifier" ${variable.isBackupIdentifier ? 'checked' : ''}> ${i18n.t('label_var_backup_identifier', section)}
                    </label>
                    <label class="checkbox-label">
                        <input type="checkbox" class="var-no-normalize" ${variable.isNoNormalize ? 'checked' : ''}> ${i18n.t('label_var_no_normalize', section)}
                    </label>
                </div>

                <div class="form-group form-full-width hide-condition-wrapper">
                    <label class="hide-condition-label">
                        <input type="checkbox" class="var-hide-condition" ${variable.isHideCondition ? 'checked' : ''}> ${i18n.t('label_var_hide_condition', section)}
                    </label>
                    <input type="text" class="var-hide-values hide-condition-input" value="${Array.isArray(variable.hideConditionValues) ? variable.hideConditionValues.join(',') : variable.hideConditionValues || ''}" placeholder="${i18n.t('label_var_hide_values', section)}" style="display: ${variable.isHideCondition ? 'block' : 'none'};">
                </div>

                <div class="form-group form-full-width">
                    <label>${i18n.t('label_var_custom_styles', section)}</label>
                    <textarea class="var-custom-styles" rows="2">${variable.customStyles || ''}</textarea>
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
        label.className = 'toolbox-item';

        label.innerHTML = `
            <input type="checkbox" value="${mod.name}" checked class="toolbox-checkbox">
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
 * 渲染全局设置界面
 */
function renderGlobalSettings() {
    const container = doc.getElementById('view-settings');
    if (!container) return;

    const settings = currentGlobalSettings;
    const section = 'module_editor'; // 复用翻译

    container.innerHTML = `
        <div class="detail-content settings-container">
            <div>
                <div class="form-section-title">标签设置</div>
                
                <div class="form-grid">
                    <div class="form-group">
                        <label>${i18n.t('label_module_tag', section)}</label>
                        <input type="text" id="global-module-tag" value="${settings.moduleTag || 'module'}" placeholder="默认为 module">
                    </div>
                    <div class="form-group">
                        <label>${i18n.t('label_module_update_tag', section)}</label>
                        <input type="text" id="global-module-update-tag" value="${settings.moduleUpdateTag || 'module_update'}" placeholder="默认为 module_update">
                    </div>
                    <div class="form-group">
                        <label>${i18n.t('label_compatible_module_tags', section)}</label>
                        <input type="text" id="global-compatible-module-tags" value="${(settings.compatibleModuleTags || []).join(',')}" placeholder="兼容更新标签A,兼容更新标签B,...">
                    </div>
                    <div class="form-group">
                        <label>${i18n.t('label_cot_tags', section)}</label>
                        <input type="text" id="global-cot-tags" value="${(settings.cotTags || []).join(',')}" placeholder="标签A,标签B,...">
                    </div>
                    <div class="form-group">
                        <label>${i18n.t('label_content_tag', section)}</label>
                        <input type="text" id="global-content-tag" value="${(settings.contentTag || []).join(',')}" placeholder="标签A,标签B,...">
                    </div>
                    <div class="form-group">
                        <label>${i18n.t('label_content_remain_layers', section)}</label>
                        <input type="number" id="global-content-remain-layers" value="${settings.contentRemainLayers !== undefined ? settings.contentRemainLayers : 6}" placeholder="保留正文层数 min=0">
                    </div>
                </div>

                <div class="form-section-title">全局提示词配置</div>
                
                <div class="form-group form-full-width">
                    <label>{{CONTINUITY_PROMPT}}顶部提示词</label>
                    <textarea id="global-prompt" rows="3" placeholder="该提示词将会放在{{CONTINUITY_PROMPT}}顶部">${settings.prompt || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>{{CONTINUITY_ORDER}}顶部提示词</label>
                    <textarea id="global-order-prompt" rows="3" placeholder="该提示词将会放在{{CONTINUITY_ORDER}}顶部">${settings.orderPrompt || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>{{CONTINUITY_USAGE_GUIDE}}顶部提示词</label>
                    <textarea id="global-usage-prompt" rows="3" placeholder="该提示词将会放在{{CONTINUITY_USAGE_GUIDE}}顶部">${settings.usagePrompt || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>{{CONTINUITY_MODULE_DATA}}顶部提示词</label>
                    <textarea id="global-module-data-prompt" rows="3" placeholder="该提示词将会放在{{CONTINUITY_MODULE_DATA}}顶部">${settings.moduleDataPrompt || ''}</textarea>
                </div>

                <div class="form-section-title">全局样式配置</div>

                <div class="form-group form-full-width">
                    <label>容器样式</label>
                    <textarea id="global-container-styles" rows="2" placeholder="使用\${customStyles}注入模块样式">${settings.containerStyles || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>外部样式</label>
                    <textarea id="global-external-styles" rows="2" placeholder="使用\${customStyles}注入模块样式">${settings.externalStyles || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>底部样式</label>
                    <textarea id="global-bottom-styles" rows="2" placeholder="使用\${customStyles}注入模块样式">${settings.bottomStyles || ''}</textarea>
                </div>

                <div class="form-section-title">其他设置</div>

                <div class="form-group">
                    <label>时间格式</label>
                    <input type="text" id="global-time-format" value="${settings.timeFormat || ''}">
                </div>

                <div class="form-actions">
                    <button id="btn-save-global" class="btn-primary">
                        保存全局设置
                    </button>
                </div>
                
                <div class="spacer-bottom"></div>
            </div>
        </div>
    `;

    // 绑定保存按钮
    const btnSave = doc.getElementById('btn-save-global');
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            // 收集数据
            currentGlobalSettings.moduleTag = doc.getElementById('global-module-tag').value;
            currentGlobalSettings.moduleUpdateTag = doc.getElementById('global-module-update-tag').value;
            currentGlobalSettings.compatibleModuleTags = doc.getElementById('global-compatible-module-tags').value.split(',').map(s => s.trim()).filter(s => s);
            currentGlobalSettings.cotTags = doc.getElementById('global-cot-tags').value.split(',').map(s => s.trim()).filter(s => s);
            currentGlobalSettings.contentTag = doc.getElementById('global-content-tag').value.split(',').map(s => s.trim()).filter(s => s);
            currentGlobalSettings.contentRemainLayers = parseInt(doc.getElementById('global-content-remain-layers').value) || 0;

            currentGlobalSettings.prompt = doc.getElementById('global-prompt').value;
            currentGlobalSettings.orderPrompt = doc.getElementById('global-order-prompt').value;
            currentGlobalSettings.usagePrompt = doc.getElementById('global-usage-prompt').value;
            currentGlobalSettings.moduleDataPrompt = doc.getElementById('global-module-data-prompt').value;
            currentGlobalSettings.containerStyles = doc.getElementById('global-container-styles').value;
            currentGlobalSettings.externalStyles = doc.getElementById('global-external-styles').value;
            currentGlobalSettings.bottomStyles = doc.getElementById('global-bottom-styles').value;
            currentGlobalSettings.timeFormat = doc.getElementById('global-time-format').value;

            // 保存
            saveGlobalSettings();

            // 反馈动画
            const originalText = btnSave.textContent;
            btnSave.textContent = "✔ 已保存";
            setTimeout(() => btnSave.textContent = originalText, 1000);
        });
    }
}

/**
 * 保存更改到 ConfigManager
 */
function saveChanges() {
    configManager.setModules(currentModules);
    infoLog("[ModuleEditor] 模块配置已保存");
}

/**
 * 保存全局设置到 ConfigManager
 */
function saveGlobalSettings() {
    configManager.setGlobalSettings(currentGlobalSettings);
    infoLog("[ModuleEditor] 全局设置已保存");
}