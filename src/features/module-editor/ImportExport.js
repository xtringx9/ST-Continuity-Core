import { IframeDialog } from '../../shared/IframeDialog.js';
import { translate } from '../../../../../../i18n.js';
import { normalizeConfig, validateConfig } from '../../modules/moduleConfigTemplate.js';
import { infoLog, errorLog, debugLog } from '../../utils/logger.js';
import configManager from '../../singleton/configManager.js';

/**
 * 处理导出逻辑
 * @param {Document} doc Iframe文档对象
 */
export function handleExport(doc) {
    const currentModules = configManager.getModules(true);
    const dialog = new IframeDialog(doc);

    // 检查是否有未保存的更改 (通过保存按钮状态判断)
    const saveBtn = doc.getElementById('header-save-btn');
    const hasUnsavedChanges = saveBtn && !saveBtn.disabled;

    // 获取上次保存的作者和版本信息
    const extConfig = configManager.getExtensionConfig();
    const defaultAuthor = extConfig.moduleConfigAuthor || '';
    const defaultVersion = extConfig.moduleConfigVersion || '';

    // 生成模块选择列表 HTML
    const modulesHtml = currentModules.map(mod => `
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <input type="checkbox" id="export-mod-${mod.name}" value="${mod.name}" data-enabled="${mod.enabled}" class="module-checkbox" checked style="margin-right: 8px;">
            <label for="export-mod-${mod.name}" style="font-size: 13px; cursor: pointer;">
                ${mod.displayName || mod.name} <span style="opacity: 0.5; font-size: 0.9em;">(${mod.name})</span>
            </label>
        </div>
    `).join('');

    const content = `
        <div class="form-group" style="display: block; margin-bottom: 8px;">
            <div style="margin-bottom: 5px; font-weight: bold;">导出内容:</div>
            <div style="display: flex; justify-content: flex-start; gap: 15px; margin-bottom: 8px;">
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
                    <button id="btn-export-enabled" class="btn-secondary" style="padding: 2px 6px; font-size: 12px;">仅启用</button>
                    <button id="btn-export-none" class="btn-secondary" style="padding: 2px 6px; font-size: 12px;">清空</button>
                </div>
            </div>
            <div style="max-height: 23vh; overflow-y: auto; border: 1px solid var(--border-color); padding: 8px; border-radius: 4px; background: var(--bg-input); display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px;">
                ${modulesHtml || '<div style="color: var(--text-secondary); text-align: center;">无可用模块</div>'}
            </div>
        </div>

        <div class="form-grid" style="margin-top: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="form-group">
                <label style="display: block; margin-bottom: 2px; font-size: 12px;">配置作者 (可选):</label>
                <input type="text" id="export-author" value="${defaultAuthor}" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-input);">
            </div>
            <div class="form-group">
                <label style="display: block; margin-bottom: 2px; font-size: 12px;">配置版本 (可选):</label>
                <input type="text" id="export-version" value="${defaultVersion}" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-input); color: var(--text-input);">
            </div>
        </div>

        ${hasUnsavedChanges ? `
        <div style="margin-top: 12px; padding: 8px; background: rgba(255, 170, 0, 0.1); border: 1px solid rgba(255, 170, 0, 0.3); border-radius: 4px;">
            <p style="color: var(--text-warning, #ffaa00); margin: 0; font-size: 12px; line-height: 1.4;">
                ⚠️ <strong>注意：</strong>检测到未保存的更改。导出文件仅包含<b>已保存</b>的配置。若要导出当前编辑内容，请先保存。
            </p>
        </div>
        ` : ''}
    `;

    dialog.open({
        title: '导出配置',
        content: content,
        buttons: [
            { text: '取消', className: 'btn-primary', onClick: (d) => d.close() },
            {
                text: '导出 JSON',
                className: 'btn-secondary',
                onClick: (d) => {
                    const exportSettings = doc.getElementById('export-settings').checked;
                    const exportModules = doc.getElementById('export-modules').checked;
                    const author = doc.getElementById('export-author').value.trim();
                    const version = doc.getElementById('export-version').value.trim();

                    // 保存作者和版本到扩展配置，方便下次使用
                    const newExtConfig = { ...configManager.getExtensionConfig() };
                    if (author) newExtConfig.moduleConfigAuthor = author;
                    if (version) newExtConfig.moduleConfigVersion = version;
                    configManager.setExtensionConfig(newExtConfig);

                    // 1. 构造导出选项
                    const selectedIds = exportModules
                        ? Array.from(doc.querySelectorAll('#export-modules-list-container .module-checkbox:checked')).map(cb => cb.value)
                        : [];

                    const exportOptions = {
                        exportSettings: exportSettings,
                        exportModuleConfig: exportModules,
                        selectedModules: selectedIds
                    };

                    // 2. 调用统一的导出逻辑 (依赖 configManager 中的已保存数据)
                    configManager.backupModuleConfig(exportOptions);
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
        doc.querySelectorAll('#export-modules-list-container .module-checkbox').forEach(cb => cb.checked = true);
    });
    doc.getElementById('btn-export-enabled').addEventListener('click', () => {
        doc.querySelectorAll('#export-modules-list-container .module-checkbox').forEach(cb => cb.checked = (cb.dataset.enabled === 'true'));
    });
    doc.getElementById('btn-export-none').addEventListener('click', () => {
        doc.querySelectorAll('#export-modules-list-container .module-checkbox').forEach(cb => cb.checked = false);
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

                    // 简单验证
                    const validation = validateConfig(json);
                    if (!validation.isValid) {
                        alert("配置格式验证失败:\n" + validation.errors.join('\n'));
                    }

                    // 规范化配置
                    const importedConfig = normalizeConfig(json);

                    // 恢复原始元数据用于显示 (因为 normalizeConfig 会重置作者信息)
                    if (json.metadata) {
                        importedConfig.metadata = { ...importedConfig.metadata, ...json.metadata };
                    }

                    // 检查源文件是否包含全局设置
                    const hasSettings = !!(json.globalSettings && Object.keys(json.globalSettings).length > 0);

                    // 打开选择弹窗
                    showImportDialog(doc, importedConfig, resolve, hasSettings);
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

function showImportDialog(doc, importedConfig, resolve, hasSettings) {
    const dialog = new IframeDialog(doc);
    const modules = importedConfig.modules || [];
    const metadata = importedConfig.metadata || {};

    // 生成模块选择列表 HTML
    const modulesHtml = modules.map(mod => `
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <input type="checkbox" id="import-mod-${mod.name}" value="${mod.name}" data-enabled="${mod.enabled}" class="module-checkbox" checked style="margin-right: 8px;">
            <label for="import-mod-${mod.name}" style="font-size: 13px; cursor: pointer;">
                ${mod.displayName || mod.name} <span style="opacity: 0.5; font-size: 0.9em;">(${mod.name})</span>
            </label>
        </div>
    `).join('');

    // 构建元数据信息面板
    const metaHtml = (metadata.author || metadata.authorConfigVersion || metadata.version) ? `
        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px 12px; margin-bottom: 8px; font-size: 12px;">
            ${metadata.author ? `<div style="margin-bottom: 4px;"><span style="opacity: 0.7;">配置作者：</span><span style="font-weight: 500;">${metadata.author}</span></div>` : ''}
            <div style="display: flex; justify-content: space-between;">
                ${metadata.authorConfigVersion ? `<div><span style="opacity: 0.7;">配置版本：</span><span style="font-weight: 500;">${metadata.authorConfigVersion}</span></div>` : '<div></div>'}
                ${metadata.version ? `<div><span style="opacity: 0.5;">插件版本：</span><span style="opacity: 0.5;">${metadata.version}</span></div>` : ''}
            </div>
        </div>
    ` : '';

    const content = `
        ${metaHtml}

        <div class="form-group" style="display: block; margin-bottom: 8px;">
            <div style="margin-bottom: 5px; font-weight: bold;">发现导入内容:</div>
            <div style="display: flex; justify-content: flex-start; gap: 15px; margin-bottom: 8px;">
                <label style="display: flex; align-items: center; cursor: ${hasSettings ? 'pointer' : 'not-allowed'}; ${hasSettings ? '' : 'opacity: 0.6;'}">
                    <input type="checkbox" id="import-settings" ${hasSettings ? 'checked' : 'disabled'} style="margin-right: 5px;"> 全局设置
                </label>
                
                <label style="display: flex; align-items: center; cursor: ${modules.length > 0 ? 'pointer' : 'not-allowed'}; ${modules.length > 0 ? '' : 'opacity: 0.6;'}">
                    <input type="checkbox" id="import-modules" ${modules.length > 0 ? 'checked' : 'disabled'} style="margin-right: 5px;"> 模块配置 (${modules.length}个)
                </label>
            </div>
        </div>

        ${modules.length > 0 ? `
        <div id="import-modules-list-container">
            <div style="margin-bottom: 5px; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                <span>选择要导入的模块:</span>
                <div>
                    <button id="btn-import-all" class="btn-secondary" style="padding: 2px 6px; font-size: 12px;">全选</button>
                    <button id="btn-import-enabled" class="btn-secondary" style="padding: 2px 6px; font-size: 12px;">仅启用</button>
                    <button id="btn-import-none" class="btn-secondary" style="padding: 2px 6px; font-size: 12px;">清空</button>
                </div>
            </div>
            <div style="max-height: 23vh; overflow-y: auto; border: 1px solid var(--border-color); padding: 8px; border-radius: 4px; background: var(--bg-input); display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px;">
                ${modulesHtml}
            </div>
            <div style="margin-top: 8px;">
                <label style="display: flex; align-items: center; cursor: pointer; font-size: 13px;">
                    <input type="checkbox" id="import-override" checked style="margin-right: 5px;"> 
                    覆盖同名模块的启用状态
                </label>
            </div>
            <div style="margin-top: 5px; font-size: 12px; color: var(--text-secondary);">
                注意：导入操作将合并到当前编辑状态，同名模块将被覆盖。
            </div>
        </div>` : ''}
        
        <div style="margin-top: 8px;">
            <p style="color: var(--text-error, #ff4444); font-weight: bold; margin: 0; font-size: 12px;">⚠️ 安全提示：请务必确保配置来源可信，确认导入吗？</p>
        </div>
    `;

    dialog.open({
        title: '导入配置',
        content: content,
        buttons: [
            { text: '取消', className: 'btn-primary', onClick: (d) => { d.close(); resolve(null); } },
            {
                text: '确认导入',
                className: 'btn-secondary',
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
                        const selectedIds = Array.from(doc.querySelectorAll('#import-modules-list-container .module-checkbox:checked')).map(cb => cb.value);
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
            doc.querySelectorAll('#import-modules-list-container .module-checkbox').forEach(cb => cb.checked = true);
        });
        doc.getElementById('btn-import-enabled').addEventListener('click', () => {
            doc.querySelectorAll('#import-modules-list-container .module-checkbox').forEach(cb => cb.checked = (cb.dataset.enabled === 'true'));
        });
        doc.getElementById('btn-import-none').addEventListener('click', () => {
            doc.querySelectorAll('#import-modules-list-container .module-checkbox').forEach(cb => cb.checked = false);
        });
    }
}
