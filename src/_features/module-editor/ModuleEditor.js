/**
 * 模块编辑器主逻辑
 */

import { i18n } from '../../_utils/i18n.js';

// === Mock 数据 (模拟模块) ===
const mockModules = [
    {
        id: 'mod_1',
        name: 'summary',
        displayName: '剧情摘要',
        enabled: true,
        tags: ['external'], // 外部显示
        description: '显示当前剧情的简要总结',
        outputPos: 'after_body',
        outputMode: 'full',
        rangeMode: 'unlimited',
        variables: [
            { name: 'content', displayName: '内容', description: '摘要的具体内容', enabled: true },
            { name: 'importance', displayName: '重要性', description: '摘要的重要性等级', enabled: true, isIdentifier: true }
        ]
    },
    {
        id: 'mod_2',
        name: 'inventory',
        displayName: '背包物品',
        enabled: true,
        tags: ['time_ref'],
        description: '记录角色当前持有的物品',
        outputPos: 'body',
        outputMode: 'incremental',
        rangeMode: 'specified',
        variables: [
            { name: 'item_name', displayName: '物品名', enabled: true, isIdentifier: true },
            { name: 'count', displayName: '数量', enabled: true }
        ]
    },
    {
        id: 'mod_3',
        name: 'time_system',
        displayName: '时间系统',
        enabled: true,
        tags: [], // 时间基准
        description: '管理当前日期和时间',
        outputPos: 'body_start',
        outputMode: 'full',
        variables: []
    },
    {
        id: 'mod_4',
        name: 'quest_log',
        displayName: '任务日志',
        enabled: false, // 已禁用
        tags: ['disabled'],
        description: '追踪当前任务进度',
        variables: []
    }
];

let selectedModuleId = null; // 记录当前选中的模块 ID

// === 渲染逻辑 ===
// 拖拽状态变量
let dragSrcEl = null;
let dragType = null; // 'module' or 'variable'
let dropPosition = null; // 'before' or 'after'

/**
 * 渲染模块列表
 */
function renderModuleList() {
    const listContainer = document.getElementById('module-list');
    listContainer.innerHTML = ''; // 清空

    // 指定使用 'module_editor' 功能区的翻译
    const section = 'module_editor';

    mockModules.forEach((mod, index) => {
        const item = document.createElement('div');
        item.className = 'module-list-item';
        item.setAttribute('draggable', 'true'); // 启用拖拽
        item.dataset.index = index; // 存储索引
        if (!mod.enabled) item.classList.add('disabled');
        // 如果是当前选中的模块，添加 active 类
        if (mod.id === selectedModuleId) {
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
            document.querySelectorAll('.module-list-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            selectedModuleId = mod.id;
            renderModuleDetail(mod);
        });

        // 绑定拖拽事件
        item.addEventListener('dragstart', (e) => handleDragStart(e, item, 'module'));
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', (e) => handleDrop(e, item, 'module', mockModules, renderModuleList));
        item.addEventListener('dragend', handleDragEnd);

        listContainer.appendChild(item);
    });
}

/**
 * 渲染模块详情表单 (右侧)
 * @param {Object} module 模块数据对象
 */
function renderModuleDetail(module) {
    const container = document.querySelector('.module-detail-panel .detail-content');
    const section = 'module_editor';

    // 生成表单 HTML
    container.innerHTML = `
        <div style="max-width: 600px; margin: 0 auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
                <h2 style="margin: 0;">${module.displayName || module.name}</h2>
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; background: var(--bg-input); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color);">
                    <input type="checkbox" id="edit-enabled" ${module.enabled ? 'checked' : ''}>
                    <span style="font-size: 12px; font-weight: 600;">${i18n.t('label_enabled', section)}</span>
                </label>
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
                        <input type="checkbox" id="edit-external" ${module.tags && module.tags.includes('external') ? 'checked' : ''}>
                        <span style="font-size: 0.9em;">${i18n.t('label_external', section)}</span>
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
    renderVariableList(module, document.getElementById('variable-list-container'));

    // 绑定添加变量按钮
    document.getElementById('btn-add-variable').addEventListener('click', () => {
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
        renderVariableList(module, document.getElementById('variable-list-container'));
    });

    // 绑定保存按钮事件
    document.getElementById('btn-save-module').addEventListener('click', () => {
        // 1. 更新数据 (Mock数据)
        module.name = document.getElementById('edit-name').value;
        module.displayName = document.getElementById('edit-display-name').value;
        module.enabled = document.getElementById('edit-enabled').checked;
        module.description = document.getElementById('edit-description').value;

        // 更新标签
        module.tags = [];
        if (document.getElementById('edit-external').checked) module.tags.push('external');
        if (document.getElementById('edit-time-ref').checked) module.tags.push('time_ref');

        // 2. 刷新左侧列表以反映更改 (如名称、启用状态)
        renderModuleList();

        // 3. 简单的反馈动画
        const btn = document.getElementById('btn-save-module');
        const originalText = btn.textContent;
        btn.textContent = "✔ OK";
        setTimeout(() => btn.textContent = originalText, 1000);
    });
}

/**
 * 渲染变量列表
 * @param {Object} module 模块对象
 * @param {HTMLElement} container 容器元素
 */
function renderVariableList(module, container) {
    container.innerHTML = '';
    const section = 'module_editor';

    if (!module.variables || module.variables.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.9em; border: 1px dashed var(--border-color); border-radius: 4px;">暂无变量</div>`;
        return;
    }

    module.variables.forEach((variable, index) => {
        const item = document.createElement('div');
        item.className = 'variable-edit-item';
        item.setAttribute('draggable', 'true'); // 启用拖拽
        item.dataset.index = index;
        item.style.marginBottom = '15px';
        item.style.padding = '15px';
        item.style.border = '1px solid var(--border-color)';
        item.style.borderRadius = '4px';
        item.style.backgroundColor = 'var(--bg-card)';

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
    document.querySelectorAll(selector).forEach(el => {
        el.classList.remove('over-top');
        el.classList.remove('over-bottom');
    });
}

// === 初始化 ===
document.addEventListener('DOMContentLoaded', () => {
    // 应用静态文本翻译
    i18n.apply(document, 'module_editor');

    // 初始化各个视图
    renderModuleList();
    renderToolbox(); // 初始化工具箱
});

// === 工具箱逻辑 ===

/**
 * 渲染工具箱界面 (模块选择器)
 */
function renderToolbox() {
    const container = document.getElementById('tool-module-list');
    if (!container) return;

    container.innerHTML = '';

    mockModules.forEach(mod => {
        const label = document.createElement('label');
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
    const btnExtract = document.getElementById('btn-extract');
    if (btnExtract) {
        btnExtract.addEventListener('click', () => {
            const start = document.getElementById('tool-floor-start').value;
            const end = document.getElementById('tool-floor-end').value || 'Latest';
            const selected = Array.from(container.querySelectorAll('input:checked')).map(cb => cb.value);

            const resultArea = document.getElementById('tool-results');
            resultArea.value = `[模拟提取结果]\n范围: ${start} - ${end}\n选中模块: ${selected.join(', ')}\n\n[summary|content:这是一个模拟的剧情摘要...]\n[inventory|item_name:长剑|count:1]`;
        });
    }
}