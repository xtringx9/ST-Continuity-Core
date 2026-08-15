// src/features/nai-preset-switcher/TagImportExport.js
// 标签导入 / 导出（独立方案，不污染智绘姬 yushe 数据）。
// 仿 module-editor/ImportExport.js 拆出独立文件，UI 交互（IframeDialog + 复选列表 + 全选/全不选）
// 与其保持一致风格。数据读写统一走 configManager 的 nai_preset_config，
// 不触碰智绘姬 extension_settings。

import configManager from '../../singleton/configManager.js';
import { IframeDialog } from '../../shared/IframeDialog.js';
import { errorLog, debugLog } from '../../utils/logger.js';

const TAG_EXPORT_TYPE = 'ccore-nai-preset-tags';
const TAG_EXPORT_VERSION = 1;

/* ============ 导出 ============ */

/**
 * 导出标签：独立 JSON 结构 { type, version, presets:[{name, tags}] }。
 * 列出所有已纳入本配置的预设（按 name 关联智绘姬），勾选后导出为文件。
 * @param {Document} doc Iframe 文档
 */
export function handleTagExport(doc) {
    const list = (configManager.getNaiPresets() || []).map(p => ({ name: p.name, tags: p.tags || [] }));
    if (list.length === 0) {
        showResult(doc, '没有可导出的预设（尚未建立任何标签）。', true);
        return;
    }

    const dialog = new IframeDialog(doc);

    const itemsHtml = list.map((p, i) => `
        <label class="np-io-item">
            <input type="checkbox" class="np-io-cb" value="${i}" checked>
            <span class="np-io-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
            <span class="np-io-tags${p.tags.length ? '' : ' np-io-tags-empty'}">${p.tags.length ? p.tags.map(escapeHtml).join('、') : '（无标签）'}</span>
        </label>
    `).join('');

    const content = `
        <div class="np-io-dialog">
            <div class="np-io-bar">
                <span class="np-io-title">选择要导出的预设标签（${list.length}）</span>
                <div class="np-io-bar-actions">
                    <button id="np-tag-exp-all" class="btn-secondary np-io-btn">全选</button>
                    <button id="np-tag-exp-none" class="btn-secondary np-io-btn">全不选</button>
                </div>
            </div>
            <div class="np-io-list">
                ${itemsHtml}
            </div>
        </div>
    `;

    dialog.open({
        title: '导出标签',
        content,
        buttons: [
            { text: '取消', className: 'btn-primary', onClick: (d) => d.close() },
            {
                text: '导出 JSON',
                className: 'btn-secondary',
                onClick: (d) => {
                    const idxs = Array.from(doc.querySelectorAll('.np-tag-export-cb:checked'))
                        .map(cb => Number(cb.value));
                    if (idxs.length === 0) {
                        showResult(doc, '未选择任何预设，已取消导出。', false);
                        d.close();
                        return;
                    }
                    const picked = idxs.map(i => ({ name: list[i].name, tags: list[i].tags }));
                    downloadJson(doc, `nai-preset-tags-${new Date().toISOString().slice(0, 10)}.json`, {
                        type: TAG_EXPORT_TYPE,
                        version: TAG_EXPORT_VERSION,
                        presets: picked,
                    });
                    showResult(doc, `已导出 ${picked.length} 个预设的标签。`, false);
                    debugLog(`[智绘姬NAI预设切换] 导出标签 ${picked.length} 条`);
                    d.close();
                },
            },
        ],
    });

    doc.getElementById('np-tag-exp-all')?.addEventListener('click', () => {
        doc.querySelectorAll('.np-tag-export-cb').forEach(cb => cb.checked = true);
    });
    doc.getElementById('np-tag-exp-none')?.addEventListener('click', () => {
        doc.querySelectorAll('.np-tag-export-cb').forEach(cb => cb.checked = false);
    });
}

/* ============ 导入 ============ */

/**
 * 导入标签：读取独立 JSON 文件，按 name 合并到本配置。
 * 支持「覆盖」与「合并」两种模式（默认合并，即追加标签并去重）。
 * @param {Document} doc Iframe 文档
 * @param {() => void} onApplied 导入成功后回调（用于刷新内存 presets 与列表）
 */
export function handleTagImport(doc, onApplied) {
    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.style.display = 'none';
    doc.body.appendChild(fileInput);
    fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.remove();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            let parsed;
            try {
                parsed = JSON.parse(String(reader.result));
            } catch (e) {
                showResult(doc, '文件解析失败：不是合法 JSON。', true);
                return;
            }
            const imported = normalizeTagImportData(parsed);
            if (!imported) {
                showResult(doc, '文件格式不正确（缺少 presets 数组）。', true);
                return;
            }
            showTagImportDialog(doc, imported, onApplied);
        };
        reader.onerror = () => showResult(doc, '读取文件失败。', true);
        reader.readAsText(file);
    });
    fileInput.click();
}

function normalizeTagImportData(parsed) {
    if (!parsed || !Array.isArray(parsed.presets)) return null;
    const out = [];
    for (const item of parsed.presets) {
        if (!item || typeof item.name !== 'string' || !item.name.trim()) continue;
        const tags = Array.isArray(item.tags)
            ? item.tags.map(t => String(t).trim()).filter(Boolean)
            : [];
        out.push({ name: item.name.trim(), tags });
    }
    return out.length ? out : null;
}

function showTagImportDialog(doc, imported, onApplied) {
    const dialog = new IframeDialog(doc);

    const itemsHtml = imported.map((p, i) => `
        <label class="np-io-item">
            <input type="checkbox" class="np-io-cb" value="${i}" checked>
            <span class="np-io-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
            <span class="np-io-tags${p.tags.length ? '' : ' np-io-tags-empty'}">${p.tags.length ? p.tags.map(escapeHtml).join('、') : '（无标签）'}</span>
        </label>
    `).join('');

    const content = `
        <div class="np-io-dialog">
            <div class="np-io-bar">
                <span class="np-io-title">选择要导入的预设标签（${imported.length}）</span>
                <div class="np-io-bar-actions">
                    <button id="np-tag-imp-all" class="btn-secondary np-io-btn">全选</button>
                    <button id="np-tag-imp-none" class="btn-secondary np-io-btn">全不选</button>
                </div>
            </div>
            <div class="np-io-list">
                ${itemsHtml}
            </div>
            <label class="np-io-option">
                <input type="checkbox" id="np-tag-imp-override">
                <span>覆盖模式：选中预设的标签完全替换（否则合并追加）</span>
            </label>
        </div>
    `;

    dialog.open({
        title: '导入标签',
        content,
        buttons: [
            { text: '取消', className: 'btn-primary', onClick: (d) => d.close() },
            {
                text: '确认导入',
                className: 'btn-secondary',
                onClick: (d) => {
                    const idxs = Array.from(doc.querySelectorAll('.np-tag-imp-cb:checked'))
                        .map(cb => Number(cb.value));
                    const override = !!doc.getElementById('np-tag-imp-override')?.checked;
                    if (idxs.length === 0) {
                        showResult(doc, '未选择任何预设，已取消导入。', false);
                        d.close();
                        return;
                    }
                    const picked = idxs.map(i => imported[i]);
                    applyTagImport(doc, picked, override, onApplied);
                    d.close();
                },
            },
        ],
    });

    doc.getElementById('np-tag-imp-all')?.addEventListener('click', () => {
        doc.querySelectorAll('.np-tag-imp-cb').forEach(cb => cb.checked = true);
    });
    doc.getElementById('np-tag-imp-none')?.addEventListener('click', () => {
        doc.querySelectorAll('.np-tag-imp-cb').forEach(cb => cb.checked = false);
    });
}

function applyTagImport(doc, picked, override, onApplied) {
    const presets = configManager.getNaiPresets() || [];
    const byName = new Map(presets.map(p => [p.name, p]));
    let added = 0;
    let updated = 0;

    for (const item of picked) {
        const existing = byName.get(item.name);
        if (existing) {
            if (override) {
                existing.tags = [...item.tags];
            } else {
                const merged = new Set(existing.tags || []);
                item.tags.forEach(t => merged.add(t));
                existing.tags = Array.from(merged);
            }
            existing.updatedAt = Date.now();
            updated++;
        } else {
            const np = {
                id: genId(),
                name: item.name,
                tags: [...item.tags],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                sortOrder: presets.length,
            };
            presets.push(np);
            byName.set(np.name, np);
            added++;
        }
    }

    configManager.setNaiPresets(presets);
    if (typeof onApplied === 'function') onApplied();
    const msg = `导入完成：新增 ${added}，更新 ${updated}。`;
    showResult(doc, msg, false);
    debugLog(`[智绘姬NAI预设切换] ${msg}`);
}

/* ============ 工具 ============ */

function downloadJson(doc, filename, dataObj) {
    const text = JSON.stringify(dataObj, null, 2);
    try {
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = url;
        a.download = filename;
        doc.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
        errorLog('[智绘姬NAI预设切换] 下载 JSON 失败，回退剪贴板', e);
        fallbackCopyToClipboard(doc, text);
    }
}

function fallbackCopyToClipboard(doc, text) {
    try {
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.select();
        doc.execCommand('copy');
        ta.remove();
    } catch (e) {
        errorLog('复制失败', e);
    }
}

// 结果反馈：按钮在 header（预设页），#np-tools-result 只在工具箱 tab 内不可见，
// 故统一用 alert（与 module-editor 导入出错报 alert 一致）。
function showResult(doc, message, isError) {
    try { window.alert(message); } catch (e) { /* 忽略 */ }
}

function genId() {
    return 'np_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
