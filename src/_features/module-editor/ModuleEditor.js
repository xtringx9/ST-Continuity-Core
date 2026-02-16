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
        description: '显示当前剧情的简要总结'
    },
    {
        id: 'mod_2',
        name: 'inventory',
        displayName: '背包物品',
        enabled: true,
        tags: [],
        description: '记录角色当前持有的物品'
    },
    {
        id: 'mod_3',
        name: 'time_system',
        displayName: '时间系统',
        enabled: true,
        tags: ['time_ref'], // 时间基准
        description: '管理当前日期和时间'
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

        // 构建标签 HTML
        let tagsHtml = '';
        if (!mod.enabled) {
            tagsHtml += `<span class="status-tag tag-disabled">${i18n.t('tag_disabled', section)}</span>`;
        }
        if (mod.tags.includes('external')) {
            tagsHtml += `<span class="status-tag tag-external">${i18n.t('tag_external', section)}</span>`;
        }
        if (mod.tags.includes('time_ref')) {
            tagsHtml += `<span class="status-tag">${i18n.t('tag_time_ref', section)}</span>`;
        }

        item.innerHTML = `
            <div class="module-item-header">
                <span class="module-item-name">${mod.displayName || mod.name}</span>
                <small style="opacity: 0.5">#${mod.name}</small>
            </div>
            <div class="module-item-tags">
                ${tagsHtml}
            </div>
        `;

        // 点击事件
        item.addEventListener('click', () => {
            // 移除其他选中状态
            document.querySelectorAll('.module-list-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            console.log('Selected module:', mod.name);
        });

        listContainer.appendChild(item);
    });
}

// === 初始化 ===
document.addEventListener('DOMContentLoaded', () => {
    // 应用静态文本翻译
    i18n.apply(document, 'module_editor');
    renderModuleList();
});