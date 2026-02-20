import { IframeDialog } from '../../_utils/IframeDialog.js';
import { i18n } from '../../_utils/i18n.js';
import { normalizeConfig } from '../../modules/moduleConfigTemplate.js';
import { infoLog, errorLog, debugLog } from '../../utils/logger.js';
import { CONTINUITY_CORE_IDENTIFIER } from '../../singleton/configManager.js';

/**
 * 处理导出逻辑
 * @param {Document} doc Iframe文档对象
 * @param {Array} currentModules 当前模块列表
 * @param {Object} currentGlobalSettings 当前全局设置
 */
export function handleExport(doc, currentModules, currentGlobalSettings) {
    const dialog = new IframeDialog(doc);

    // 生成模块选择列表 HTML
    const modulesHtml = currentModules.map(mod => `
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <input type="checkbox" id="export-mod-${mod.name}" value="${mod.name}" checked style="margin-right: 8px;">
            <label for="export-mod-${mod.name}" style="font-size: 13px; cursor: pointer;">
                ${mod.displayName || mod.name} <span style="opacity: 0.5; font-size: 0.9em;">(${mod.name})</span>
            </label>
        </div>
    `).join('');

    const content = `
        <div class="form-group">
            <div style="margin-bottom: 10px; font-weight: bold;">导出内容:</div>
            <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="export-settings" checked style="margin-right: 5px;"> 全局设置
                </label>
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="export-modules" checked style="margin-right: 5px;"> 模块配置
                </label>
            </div>
        </div>
        
        <div id="export-modules-list-container">
            <div style="margin-bottom: 5px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                <span>选择模块:</span>
                <div>
                    <button id="btn-export-all" class="btn-secondary" style="padding: 2px 6px; font-size: 12px;">全选</button>
                    <button id="btn-export-none" class="btn-secondary" style="padding: 2px 6px; font-size: 12px;">清空</button>
                </div>
            </div>
            <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-color); padding: 8px; border-radius: 4px; background: var(--bg-input);">
                ${modulesHtml || '<div style="color: var(--text-secondary); text-align: center;">无可用模块</div>'}
            </div>
        </div>

        <div class="form-group" style="margin-top: 15px;">
            <label style="display: block; margin-bottom: 5px;">配置作者 (可选):</label>
            <input type="text" id="export-author" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-input);">
        </div>
    `;

    dialog.open({
        title: '导出配置',
        content: content,
        buttons: [
            { text: '取消', onClick: (d) => d.close() },
            {
                text: '导出 JSON',
                className: 'btn-primary',
                onClick: (d) => {
                    const exportSettings = doc.getElementById('export-settings').checked;
                    const exportModules = doc.getElementById('export-modules').checked;
                    const author = doc.getElementById('export-author').value.trim();

                    const exportData = {
                        metadata: {
                            source: CONTINUITY_CORE_IDENTIFIER,
                            version: '1.0.0',
                            lastUpdated: new Date().toISOString(),
                            author: author
                        }
                    };

                    if (exportSettings) {
                        exportData.globalSettings = currentGlobalSettings;
                    }

                    if (exportModules) {
                        const selectedIds = Array.from(doc.querySelectorAll('#export-modules-list-container input:checked')).map(cb => cb.value);
                        exportData.modules = currentModules.filter(m => selectedIds.includes(m.name));
                    }

                    downloadJson(exportData);
                    d.close();
                }
            }
        ]
    });

    // 绑定交互事件
    const toggleModulesList = () => {
        const isChecked = doc.getElementById('export-modules').checked;
        const container = doc.getElementById('export-modules-list-container');
        if (container) container.style.display = isChecked ? 'block' : 'none';
    };
    doc.getElementById('export-modules').addEventListener('change', toggleModulesList);

    doc.getElementById('btn-export-all').addEventListener('click', () => {
        doc.querySelectorAll('#export-modules-list-container input[type="checkbox"]').forEach(cb => cb.checked = true);
    });
    doc.getElementById('btn-export-none').addEventListener('click', () => {
        doc.querySelectorAll('#export-modules-list-container input[type="checkbox"]').forEach(cb => cb.checked = false);
    });
}

/**
 * 处理导入逻辑
 * @param {Document} doc Iframe文档对象
 * @returns {Promise<Object|null>} 返回合并后的配置对象，如果取消则返回 null
 */
export function handleImport(doc) {
    return new Promise((resolve) => {
        // 创建隐藏的文件输入框
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.style.display = 'none';
        doc.body.appendChild(input);

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) {
                resolve(null);
                return;
            }

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const json = JSON.parse(event.target.result);
                    // 规范化配置
                    const importedConfig = normalizeConfig(json);

                    // 打开选择弹窗
                    showImportDialog(doc, importedConfig, resolve);
                } catch (err) {
                    errorLog("Import failed", err);
                    alert("解析 JSON 文件失败: " + err.message);
                    resolve(null);
                } finally {
                    doc.body.removeChild(input);
                }
            };
            reader.readAsText(file);
        };

        input.click();
    });
}

function showImportDialog(doc, importedConfig, resolve) {
    const dialog = new IframeDialog(doc);
    const modules = importedConfig.modules || [];
    const hasSettings = !!importedConfig.globalSettings;

    // 生成模块选择列表 HTML
    const modulesHtml = modules.map(mod => `
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <input type="checkbox" id="import-mod-${mod.name}" value="${mod.name}" checked style="margin-right: 8px;">
            <label for="import-mod-${mod.name}" style="font-size: 13px; cursor: pointer;">
                ${mod.displayName || mod.name} <span style="opacity: 0.5; font-size: 0.9em;">(${mod.name})</span>
            </label>
        </div>
    `).join('');

    const content = `
        <div class="form-group">
            <div style="margin-bottom: 10px; font-weight: bold;">发现导入内容:</div>
            <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                ${hasSettings ? `
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="import-settings" checked style="margin-right: 5px;"> 全局设置
                </label>` : '<span style="color: var(--text-secondary);">无全局设置</span>'}
                
                ${modules.length > 0 ? `
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" id="import-modules" checked style="margin-right: 5px;"> 模块配置 (${modules.length}个)
                </label>` : '<span style="color: var(--text-secondary);">无模块配置</span>'}
            </div>
        </div>

        ${modules.length > 0 ? `
        <div id="import-modules-list-container">
            <div style="margin-bottom: 5px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                <span>选择要导入的模块:</span>
                <div>
                    <button id="btn-import-all" class="btn-secondary" style="padding: 2px 6px; font-size: 12px;">全选</button>
                    <button id="btn-import-none" class="btn-secondary" style="padding: 2px 6px; font-size: 12px;">清空</button>
                </div>
            </div>
            <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-color); padding: 8px; border-radius: 4px; background: var(--bg-input);">
                ${modulesHtml}
            </div>
            <div style="margin-top: 10px;">
                <label style="display: flex; align-items: center; cursor: pointer; font-size: 13px;">
                    <input type="checkbox" id="import-override" checked style="margin-right: 5px;"> 
                    覆盖同名模块的启用状态
                </label>
            </div>
        </div>` : ''}
        
        <div style="margin-top: 15px; font-size: 12px; color: var(--text-secondary);">
            注意：导入操作将合并到当前编辑状态，同名模块将被覆盖。
        </div>
    `;

    dialog.open({
        title: '导入配置',
        content: content,
        buttons: [
            { text: '取消', onClick: (d) => { d.close(); resolve(null); } },
            {
                text: '确认导入',
                className: 'btn-primary',
                onClick: (d) => {
                    const result = {
                        globalSettings: null,
                        modules: null,
                        overrideEnabled: true
                    };

                    if (hasSettings && doc.getElementById('import-settings').checked) {
                        result.globalSettings = importedConfig.globalSettings;
                    }

                    if (modules.length > 0 && doc.getElementById('import-modules').checked) {
                        const selectedIds = Array.from(doc.querySelectorAll('#import-modules-list-container input:checked')).map(cb => cb.value);
                        result.modules = modules.filter(m => selectedIds.includes(m.name));
                        result.overrideEnabled = doc.getElementById('import-override').checked;
                    }

                    d.close();
                    resolve(result);
                }
            }
        ]
    });

    // 绑定交互事件
    if (modules.length > 0) {
        const toggleModulesList = () => {
            const isChecked = doc.getElementById('import-modules').checked;
            const container = doc.getElementById('import-modules-list-container');
            if (container) container.style.display = isChecked ? 'block' : 'none';
        };
        doc.getElementById('import-modules').addEventListener('change', toggleModulesList);

        doc.getElementById('btn-import-all').addEventListener('click', () => {
            doc.querySelectorAll('#import-modules-list-container input[type="checkbox"]').forEach(cb => cb.checked = true);
        });
        doc.getElementById('btn-import-none').addEventListener('click', () => {
            doc.querySelectorAll('#import-modules-list-container input[type="checkbox"]').forEach(cb => cb.checked = false);
        });
    }
}

function downloadJson(data) {
    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `continuity_config_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
