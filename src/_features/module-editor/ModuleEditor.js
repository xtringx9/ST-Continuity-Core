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
        rangeMode: 'unlimited'
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
        rangeMode: 'specified'
    },
    {
        id: 'mod_3',
        name: 'time_system',
        displayName: '时间系统',
        enabled: true,
        tags: [], // 时间基准
        description: '管理当前日期和时间',
        outputPos: 'body_start',
        outputMode: 'full'
    },
    {
        id: 'mod_4',
        name: 'quest_log',
        displayName: '任务日志',
        enabled: false, // 已禁用
        tags: ['disabled'],
        description: '追踪当前任务进度'
    }
];

let selectedModuleId = null; // 记录当前选中的模块 ID

// === 渲染逻辑 ===

/**
 * 渲染模块列表
 */
function renderModuleList() {
    const listContainer = document.getElementById('module-list');
    listContainer.innerHTML = ''; // 清空

    // 指定使用 'module_editor' 功能区的翻译
    const section = 'module_editor';

    mockModules.forEach(mod => {
        const item = document.createElement('div');
        item.className = 'module-list-item';
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
            </div>

            <div style="text-align: right; margin-top: 30px;">
                <button id="btn-save-module" style="padding: 8px 20px; background: var(--accent-color); color: var(--bg-app); border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px; transition: opacity 0.2s;">
                    ${i18n.t('btn_save', section)}
                </button>
            </div>
            
            <div style="height: 50px;"></div> <!-- 底部留白 -->
        </div>
    `;

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

// === 初始化 ===
document.addEventListener('DOMContentLoaded', () => {
    // 应用静态文本翻译
    i18n.apply(document, 'module_editor');
    renderModuleList();
});