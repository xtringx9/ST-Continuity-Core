// src/ui/generatorDebugPanel.js
// 生成调试弹窗：基于 IframeModal + 独立 HTML，复用 module-editor 主题系统
// 支持多个弹窗同时存在（每次 new 新 IframeModal 实例）
// 当 data.onSave 存在时，显示"保存/抛弃/查看当前内容"按钮（手动重新生成流程）

import { IframeModal } from '../shared/IframeModal.js';
import { translate } from '../../../../../i18n.js';

// 调试弹窗 HTML 文件路径（基于当前 JS 文件位置解析）
const PANEL_HTML_URL = new URL('generatorDebugPanel.html', import.meta.url).href;

let panelCounter = 0;

/** 已打开的面板 iframe 注册表（taskKey → {iframe, responsePre}，流式实时更新用） */
const panelIframes = new Map();

/**
 * 更新指定任务的面板「完整响应」内容（阶段 2：流式实时输出）
 * @param {string} taskKey - taskRegistry 任务 key
 * @param {string} text - 最新累计文本
 */
export function updateDebugPanelResponse(taskKey, text) {
    const entry = panelIframes.get(taskKey);
    if (!entry) return;
    const { responsePre } = entry;
    if (!responsePre) return;
    // 记录是否用户已手动上滚（若已在底部附近则跟随自动滚到底）
    const nearBottom = responsePre.scrollHeight - responsePre.scrollTop - responsePre.clientHeight < 40;
    responsePre.textContent = text;
    if (nearBottom) {
        responsePre.scrollTop = responsePre.scrollHeight; // 锁定底部跟随最新
    }
    // 标题 badge 已显示「生成调试（生成中）」，无需在流式更新时改动
}

/**
 * 更新指定任务的面板「实际发送」内容（阶段 2：捕获到提示词后实时推送）
 * @param {string} taskKey
 * @param {string|Array} prompt - 组装后的完整提示词（chat messages 数组）
 */
export function updateDebugPanelPrompt(taskKey, prompt) {
    const entry = panelIframes.get(taskKey);
    if (!entry) return;
    const { doc } = entry;
    if (!doc) return;
    // 更新「实际发送」对应的 pre（data-ccore-content="sent" data-ccore-format 两个都要）
    const pres = doc.querySelectorAll('.ccore-debug-sent .ccore-debug-pre[data-ccore-content="sent"]');
    let readable = '';
    if (Array.isArray(prompt) && prompt.length > 0) {
        readable = prompt.map(m => `[${m.role}${m.name ? ` (${m.name})` : ''}]\n${m.content}`).join('\n\n---\n\n');
    } else if (typeof prompt === 'string') {
        readable = prompt;
    }
    pres.forEach(p => {
        if (p.dataset.ccoreFormat === 'readable') p.textContent = readable;
        if (p.dataset.ccoreFormat === 'json') p.textContent = JSON.stringify(prompt ?? null, null, 2);
    });
}

/**
 * 指定任务的面板是否已打开（生成完成时避免重复弹新面板）
 * @param {string} taskKey
 * @returns {boolean}
 */
export function isDebugPanelOpen(taskKey) {
    return panelIframes.has(taskKey);
}

/**
 * 更新指定任务的面板「API 信息」（阶段 2：捕获到 API 后实时显示）
 * @param {string} taskKey
 * @param {object} apiUsed
 */
export function updateDebugPanelApi(taskKey, apiUsed) {
    const entry = panelIframes.get(taskKey);
    if (!entry || !entry.doc) return;
    const doc = entry.doc;
    // 已有 API section → 更新其 pre 内容；没有 → 追加到 body 末尾
    let section = doc.querySelector('.ccore-debug-section[data-ccore-api]');
    const lines = [];
    lines.push(`类型: ${apiUsed.custom ? '独立 API' : 'ST 主 API'}`);
    if (apiUsed.model) lines.push(`模型: ${apiUsed.model}`);
    if (apiUsed.source) lines.push(`来源: ${apiUsed.source}`);
    if (apiUsed.apiurl) lines.push(`URL: ${apiUsed.apiurl}`);
    if (apiUsed.temperature !== undefined) lines.push(`温度: ${apiUsed.temperature}`);
    if (apiUsed.max_tokens) lines.push(`Max Tokens: ${apiUsed.max_tokens}`);
    const content = lines.join('\n');

    if (section) {
        const pre = section.querySelector('.ccore-debug-pre');
        if (pre) pre.textContent = content;
    } else {
        const body = doc.querySelector('.ccore-debug-body');
        if (!body) return;
        const html = `<div class="ccore-debug-section" data-ccore-api data-ccore-collapsed="false">
    <div class="ccore-debug-section-header">
        <span class="ccore-debug-section-title" style="color:var(--text-muted)">API 信息</span>
        <div class="ccore-debug-btn-group">
            <button class="ccore-debug-small-btn ccore-debug-copy-btn">复制</button>
            <button class="ccore-debug-small-btn ccore-debug-toggle-btn">收起</button>
        </div>
    </div>
    <pre class="ccore-debug-pre" style="display:block">${_escapeHtml(content)}</pre>
</div>`;
        body.insertAdjacentHTML('beforeend', html);
        _bindSectionEvents(doc);
    }
}

/**
 * 生成完成后更新已打开的面板为「完成态」：
 * 状态标签 → 完成、隐藏中止按钮、刷新「完整响应」/「实际发送」。
 * @param {string} taskKey
 * @param {object} debugData - 完成态 debugData（含最终 response / capturedPrompt / apiUsed / statusLabel）
 */
export function finishDebugPanel(taskKey, debugData) {
    const entry = panelIframes.get(taskKey);
    if (!entry) return;
    const { doc, responsePre, statusEl } = entry;
    if (!doc) return;

    // 1. 状态标签 → 完成态（更新整个标题：badge + titleBody，避免 titleBody 重复）
    const titleEl = doc.querySelector('.ccore-debug-title');
    if (titleEl) {
        const label = debugData.statusLabel || '生成调试';
        const type = debugData.statusType || 'info';
        const titleBody = debugData.titleBody || '';
        titleEl.innerHTML = `<span class="ccore-debug-badge ccore-debug-badge-${type}">${_escapeHtml(label)}</span>${_escapeHtml(titleBody)}`;
    }

    // 2. 隐藏中止按钮
    const abortBtn = doc.querySelector('.ccore-debug-btn-abort');
    if (abortBtn) abortBtn.closest('.ccore-debug-action-bar')?.remove();

    // 3. 更新「完整响应」
    if (responsePre) responsePre.textContent = debugData.response || '(空)';

    // 4. 更新「实际发送」（capturedPrompt）
    updateDebugPanelPrompt(taskKey, debugData.capturedPrompt);

    // 5. 若成功且有保存按钮（手动流程），补充显示操作按钮区
    //   （生成中面板没有操作按钮，因为初始 debugData 无 onSave）
    if (debugData.onSave) {
        // 重新渲染操作区到 body 末尾
        const body = doc.querySelector('.ccore-debug-body');
        if (body && !body.querySelector('.ccore-debug-action-bar')) {
            const actionHtml = _buildActionSection();
            body.insertAdjacentHTML('beforeend', actionHtml);
            _bindActionButtons(doc, debugData, entry.modal || null);
        }
    }
}

/**
 * 显示 debug 弹窗
 * @param {object} data
 * @param {string} data.title - 弹窗标题
 * @param {number|number[]} [data.mesId] - 楼层 ID
 * @param {string} data.mode - 调用模式
 * @param {object} data.sentInfo - 实际发送的信息
 * @param {string|Array} [data.capturedPrompt] - 事件捕获到的最终提示词（可能为空）
 * @param {string} data.response - 完整响应
 * @param {object|null} data.extracted - 提取的模块数据
 * @param {object} data.apiUsed - 使用的 API 信息
 * @param {boolean} [data.hasModules] - 是否有模块数据
 * @param {string} [data.error] - 错误信息
 * @param {string} [data.taskKey] - taskRegistry 任务 key（流式实时更新时用于定位面板）
 */
export function showDebugPanel(data) {
    panelCounter++;
    const title = data.title || '生成调试';

    const modal = new IframeModal({
        modalId: `ccore-debug-modal-${panelCounter}`,
        iframeId: `ccore-debug-iframe-${panelCounter}`,
    });

    modal.open(PANEL_HTML_URL, title, {
        variant: 'center',
        onLoad: (iframe) => {
            const doc = iframe.contentDocument;
            if (!doc) return;

            // 1. 同步主题（与 module-editor 共享 localStorage）
            const theme = localStorage.getItem('st_continuity_theme') || 'light';
            doc.documentElement.setAttribute('data-theme', theme);

            // 2. 设置标题（带状态标签）
            const titleEl = doc.querySelector('.ccore-debug-title');
            if (titleEl) {
                const statusLabel = data.statusLabel || '生成调试';
                const statusType = data.statusType || 'info';
                const titleBody = data.titleBody || '';
                titleEl.innerHTML = `<span class="ccore-debug-badge ccore-debug-badge-${statusType}">${_escapeHtml(statusLabel)}</span>${_escapeHtml(titleBody)}`;
            }

            // 3. 注入 sections
            const body = doc.querySelector('.ccore-debug-body');
            if (body) body.innerHTML = _buildSectionsHtml(data);

            // 4. 绑定关闭按钮
            const closeBtn = doc.querySelector('.ccore-debug-close');
            if (closeBtn) closeBtn.addEventListener('click', () => modal.close());

            // 5. 绑定折叠/复制按钮
            _bindSectionEvents(doc);

            // 6. 绑定操作按钮（保存/抛弃/查看当前内容，仅手动重新生成流程）
            if (data.onSave) {
                _bindActionButtons(doc, data, modal);
            }

            // 7. 绑定中止按钮（仅生成中）
            if (data.onAbort) {
                const abortBtn = doc.querySelector('.ccore-debug-btn-abort');
                if (abortBtn) {
                    abortBtn.addEventListener('click', () => {
                        try { data.onAbort(); } catch (e) {}
                        // 中止后不自动关闭面板：保留现场（失败原因/已流式内容），用户点「×」手动关
                        abortBtn.disabled = true;
                        abortBtn.textContent = '已中止';
                    });
                }
            }

            // 8. 注册面板 iframe（阶段 2：流式实时更新「完整响应」/「实际发送」）
            if (data.taskKey) {
                panelIframes.set(data.taskKey, {
                    iframe,
                    doc,
                    modal,
                    responsePre: doc.querySelector('[data-ccore-response-pre]'),
                    statusEl: doc.querySelector('.ccore-debug-badge'),
                });
            }
        },
    });
}

// 暴露到父窗口全局，供 module-editor 工具箱等 iframe 内调用（调试面板测试入口）
if (typeof window !== 'undefined') {
    window.showDebugPanel = showDebugPanel;
}

/**
 * 构建所有 section 的 HTML
 */
function _buildSectionsHtml(data) {
    const sections = [];

    // 错误信息
    if (data.error) {
        sections.push(_buildSection('错误', data.error, 'var(--danger-color)', true));
    }

    // 1. 发送内容（调用输入 / 实际发送 切换 + JSON / 可读切换,默认可读+调用输入）
    if (data.sentInfo) {
        // 1a. 调用输入(我们传给 aiCaller 的参数)
        let inputReadable = '';
        let inputData;
        if (data.sentInfo.type === 'raw') {
            if (Array.isArray(data.sentInfo.prompt)) {
                inputReadable = data.sentInfo.prompt
                    .map(m => `[${m.role}]\n${m.content}`)
                    .join('\n\n---\n\n');
            } else {
                inputReadable = String(data.sentInfo.prompt);
            }
            inputData = data.sentInfo.prompt;
        } else if (data.sentInfo.type === 'pipeline') {
            const parts = [];
            parts.push('--- quietPrompt (发送的消息) ---');
            parts.push(data.sentInfo.quietPrompt || '(空)');
            parts.push('');
            parts.push('--- injectPrompt (注入到 extension_prompts 的指令) ---');
            parts.push(data.sentInfo.injectPrompt || '(无)');
            inputReadable = parts.join('\n');
            inputData = {
                quietPrompt: data.sentInfo.quietPrompt || '',
                injectPrompt: data.sentInfo.injectPrompt || '',
            };
        }
        const inputJson = JSON.stringify(inputData, null, 2);

        // 1b. 实际发送(ST 组装后发给 AI 的提示词)
        let sentReadable = '';
        let sentData = data.capturedPrompt ?? null;
        if (Array.isArray(data.capturedPrompt) && data.capturedPrompt.length > 0) {
            sentReadable = data.capturedPrompt
                .map(m => `[${m.role}${m.name ? ` (${m.name})` : ''}]\n${m.content}`)
                .join('\n\n---\n\n');
        } else if (typeof data.capturedPrompt === 'string' && data.capturedPrompt) {
            sentReadable = data.capturedPrompt;
        } else {
            sentReadable = '(未捕获到)';
        }
        const sentJson = JSON.stringify(sentData, null, 2);

        sections.push(_buildSentContentSection('发送内容', inputJson, inputReadable, sentJson, sentReadable, 'var(--accent-color)', false));
    }

    // 2. 完整响应（加 data-ccore-response-pre 标记，供流式实时更新定位）
    sections.push(`<div class="ccore-debug-section" data-ccore-collapsed="false">
    <div class="ccore-debug-section-header">
        <span class="ccore-debug-section-title" style="color:var(--success-color)">完整响应</span>
        <div class="ccore-debug-btn-group">
            <button class="ccore-debug-small-btn ccore-debug-copy-btn">复制</button>
            <button class="ccore-debug-small-btn ccore-debug-toggle-btn">收起</button>
        </div>
    </div>
    <pre class="ccore-debug-pre" data-ccore-response-pre style="display:block">${_escapeHtml(data.response || '(空)')}</pre>
</div>`);

    // 3. 提取结果(新格式:{ modules: string })
    if (data.extracted) {
        const modulesText = data.extracted.modules || '(空)';
        sections.push(_buildSection('提取结果', modulesText, 'var(--accent-color)', false));
    }

    // 4. API 信息（可读格式：独立/主 API + 模型）
    if (data.apiUsed && Object.keys(data.apiUsed).length > 0) {
        const api = data.apiUsed;
        const lines = [];
        lines.push(`类型: ${api.custom ? '独立 API' : 'ST 主 API'}`);
        if (api.model) lines.push(`模型: ${api.model}`);
        if (api.source) lines.push(`来源: ${api.source}`);
        if (api.apiurl) lines.push(`URL: ${api.apiurl}`);
        if (api.temperature !== undefined) lines.push(`温度: ${api.temperature}`);
        if (api.max_tokens) lines.push(`Max Tokens: ${api.max_tokens}`);
        sections.push(_buildSection('API 信息', lines.join('\n'), 'var(--text-muted)', false));
    }

    // 5. 操作按钮（保存/抛弃/查看当前内容，仅手动重新生成流程）
    if (data.onSave) {
        sections.push(_buildActionSection());
    }

    // 6. 中止按钮（仅生成中显示）
    if (data.onAbort) {
        sections.push(_buildAbortSection());
    }

    return sections.join('');
}

/**
 * 构建中止按钮区域 HTML（仅生成中）
 */
function _buildAbortSection() {
    return `<div class="ccore-debug-action-bar">
        <button class="ccore-debug-btn ccore-debug-btn-abort">中止生成</button>
    </div>`;
}

/**
 * 构建操作按钮区域 HTML
 * 保存方式：append（追加新版本并激活，默认）/ overwrite（覆盖当前激活版本）
 */
function _buildActionSection() {
    return `<div class="ccore-debug-action-bar">
        <div class="ccore-debug-save-mode" style="margin-bottom:6px;display:flex;gap:12px;align-items:center;">
            <span style="color:var(--text-muted);font-size:12px;">保存方式</span>
            <label style="font-size:12px;"><input type="radio" name="ccore-debug-save-mode" value="append" checked> 追加为新版本</label>
            <label style="font-size:12px;"><input type="radio" name="ccore-debug-save-mode" value="overwrite"> 覆盖当前版本</label>
        </div>
        <button class="ccore-debug-btn ccore-debug-btn-save">${_escapeHtml(translate('ccore_debug_save'))}</button>
        <button class="ccore-debug-btn ccore-debug-btn-discard">${_escapeHtml(translate('ccore_debug_discard'))}</button>
        <button class="ccore-debug-btn ccore-debug-btn-current">${_escapeHtml(translate('ccore_debug_view_current'))}</button>
    </div>
    <div class="ccore-debug-current-content" style="display:none;">
        <div class="ccore-debug-current-header">${_escapeHtml(translate('ccore_debug_current_content'))}</div>
        <pre class="ccore-debug-pre ccore-debug-current-pre"></pre>
    </div>`;
}

/**
 * 绑定操作按钮事件
 */
function _bindActionButtons(doc, data, modal) {
    const saveBtn = doc.querySelector('.ccore-debug-btn-save');
    const discardBtn = doc.querySelector('.ccore-debug-btn-discard');
    const currentBtn = doc.querySelector('.ccore-debug-btn-current');
    const currentArea = doc.querySelector('.ccore-debug-current-content');
    const currentPre = doc.querySelector('.ccore-debug-current-pre');

    // 保存（读取保存方式 radio：append / overwrite）
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled = true;
            saveBtn.textContent = translate('ccore_debug_saving');
            try {
                const checked = doc.querySelector('input[name="ccore-debug-save-mode"]:checked');
                const saveMode = checked?.value || 'append';
                await data.onSave(saveMode);
                saveBtn.textContent = translate('ccore_debug_saved');
                setTimeout(() => modal.close(), 800);
            } catch (err) {
                saveBtn.disabled = false;
                saveBtn.textContent = translate('ccore_debug_save');
                // 用父窗口 ST 原生 toastr 提示（不用 alert）
                try {
                    window.parent.toastr?.error(translate('ccore_debug_save_failed') + ': ' + err.message);
                } catch {
                    alert(translate('ccore_debug_save_failed') + ': ' + err.message);
                }
            }
        });
    }

    // 抛弃
    if (discardBtn) {
        discardBtn.addEventListener('click', () => {
            if (data.onDiscard) data.onDiscard();
            modal.close();
        });
    }

    // 查看当前内容
    if (currentBtn && currentArea && currentPre) {
        currentBtn.addEventListener('click', async () => {
            if (currentArea.style.display !== 'none') {
                // 已展开 → 收起
                currentArea.style.display = 'none';
                return;
            }
            currentPre.textContent = translate('ccore_debug_loading');
            currentArea.style.display = 'block';
            try {
                const content = await data.onLoadCurrentContent();
                currentPre.textContent = content || translate('ccore_debug_no_current');
            } catch (err) {
                currentPre.textContent = translate('ccore_debug_load_failed') + ': ' + err.message;
            }
        });
    }
}

/**
 * 构建单个 section 的 HTML
 */
function _buildSection(title, content, accentColor, defaultOpen = true) {
    const escapedContent = _escapeHtml(content);
    const toggleText = defaultOpen ? '收起' : '展开';

    return `<div class="ccore-debug-section" data-ccore-collapsed="${!defaultOpen}">
    <div class="ccore-debug-section-header">
        <span class="ccore-debug-section-title" style="color:${accentColor}">${_escapeHtml(title)}</span>
        <div class="ccore-debug-btn-group">
            <button class="ccore-debug-small-btn ccore-debug-copy-btn">复制</button>
            <button class="ccore-debug-small-btn ccore-debug-toggle-btn">${toggleText}</button>
        </div>
    </div>
    <pre class="ccore-debug-pre" style="display:${defaultOpen ? 'block' : 'none'}">${escapedContent}</pre>
</div>`;
}

/**
 * 构建双格式 section（JSON / 可读切换）
 * @param {string} defaultFormat - 默认显示格式:'json' | 'readable'(默认 'readable')
 */
function _buildDualFormatSection(title, jsonContent, readableContent, accentColor, defaultOpen = true, defaultFormat = 'readable') {
    const escapedJson = _escapeHtml(jsonContent);
    const escapedReadable = _escapeHtml(readableContent);
    const toggleText = defaultOpen ? '收起' : '展开';
    const jsonDisplay = defaultFormat === 'json' && defaultOpen ? 'block' : 'none';
    const readableDisplay = defaultFormat === 'readable' && defaultOpen ? 'block' : 'none';
    const formatLabel = defaultFormat === 'json' ? '可读' : 'JSON';

    return `<div class="ccore-debug-section ccore-debug-dual" data-ccore-format="${defaultFormat}" data-ccore-collapsed="${!defaultOpen}">
    <div class="ccore-debug-section-header">
        <span class="ccore-debug-section-title" style="color:${accentColor}">${_escapeHtml(title)}</span>
        <div class="ccore-debug-btn-group">
            <button class="ccore-debug-small-btn ccore-debug-format-btn">${formatLabel}</button>
            <button class="ccore-debug-small-btn ccore-debug-copy-btn">复制</button>
            <button class="ccore-debug-small-btn ccore-debug-toggle-btn">${toggleText}</button>
        </div>
    </div>
    <pre class="ccore-debug-pre" data-ccore-format="json" style="display:${jsonDisplay}">${escapedJson}</pre>
    <pre class="ccore-debug-pre" data-ccore-format="readable" style="display:${readableDisplay}">${escapedReadable}</pre>
</div>`;
}

/**
 * 构建发送内容 section（调用输入 / 实际发送 切换 + JSON / 可读切换 = 4 个 pre）
 * 默认:可读 + 实际发送
 */
function _buildSentContentSection(title, inputJson, inputReadable, sentJson, sentReadable, accentColor, defaultOpen = true) {
    const defaultFormat = 'readable';
    const defaultContent = 'sent';
    const toggleText = defaultOpen ? '收起' : '展开';
    const formatLabel = 'JSON';        // 默认可读 → 按钮显示"JSON"(点击切到 JSON)
    const contentLabel = '调用输入';    // 默认实际发送 → 按钮显示"调用输入"(点击切到调用输入)

    const show = (fmt, cnt) => (fmt === defaultFormat && cnt === defaultContent && defaultOpen) ? 'block' : 'none';

    return `<div class="ccore-debug-section ccore-debug-sent" data-ccore-format="${defaultFormat}" data-ccore-content="${defaultContent}" data-ccore-collapsed="${!defaultOpen}">
    <div class="ccore-debug-section-header">
        <span class="ccore-debug-section-title" style="color:${accentColor}">${_escapeHtml(title)}</span>
        <div class="ccore-debug-btn-group">
            <button class="ccore-debug-small-btn ccore-debug-content-btn">${contentLabel}</button>
            <button class="ccore-debug-small-btn ccore-debug-format-btn">${formatLabel}</button>
            <button class="ccore-debug-small-btn ccore-debug-copy-btn">复制</button>
            <button class="ccore-debug-small-btn ccore-debug-toggle-btn">${toggleText}</button>
        </div>
    </div>
    <pre class="ccore-debug-pre" data-ccore-format="json" data-ccore-content="input" style="display:${show('json', 'input')}">${_escapeHtml(inputJson)}</pre>
    <pre class="ccore-debug-pre" data-ccore-format="readable" data-ccore-content="input" style="display:${show('readable', 'input')}">${_escapeHtml(inputReadable)}</pre>
    <pre class="ccore-debug-pre" data-ccore-format="json" data-ccore-content="sent" style="display:${show('json', 'sent')}">${_escapeHtml(sentJson)}</pre>
    <pre class="ccore-debug-pre" data-ccore-format="readable" data-ccore-content="sent" style="display:${show('readable', 'sent')}">${_escapeHtml(sentReadable)}</pre>
</div>`;
}

/**
 * 更新 section 内所有 pre 的可见性(基于 data-ccore-format / data-ccore-content / data-ccore-collapsed)
 */
function _updatePreVisibility(section) {
    const format = section.dataset.ccoreFormat || 'readable';
    const content = section.dataset.ccoreContent;
    const collapsed = section.dataset.ccoreCollapsed === 'true';
    section.querySelectorAll('.ccore-debug-pre').forEach(p => {
        // 无 data-ccore-format 的 pre（普通 section）总是匹配；有 format 的按当前格式匹配
        const matchFormat = !p.dataset.ccoreFormat || p.dataset.ccoreFormat === format;
        const pContent = p.dataset.ccoreContent;
        // 无 content 属性的 pre(普通/dual section)总是匹配;有 content 属性的需匹配
        const matchContent = !content || !pContent || pContent === content;
        p.style.display = (matchFormat && matchContent && !collapsed) ? 'block' : 'none';
    });
}

/**
 * 获取 section 当前激活的 pre（按 data-ccore-format + data-ccore-content 匹配,用于复制)
 */
function _getActivePre(section) {
    const pres = section.querySelectorAll('.ccore-debug-pre');
    if (pres.length <= 1) return pres[0];
    const format = section.dataset.ccoreFormat || 'readable';
    const content = section.dataset.ccoreContent;
    // 优先匹配 format + content
    if (content) {
        const found = section.querySelector(`.ccore-debug-pre[data-ccore-format="${format}"][data-ccore-content="${content}"]`);
        if (found) return found;
    }
    // 其次匹配 format(无 content 属性的 pre)
    const found = section.querySelector(`.ccore-debug-pre[data-ccore-format="${format}"]:not([data-ccore-content])`);
    if (found) return found;
    // 兜底:任意匹配 format 的 pre
    return section.querySelector(`.ccore-debug-pre[data-ccore-format="${format}"]`) || pres[0];
}

/**
 * 绑定 section 折叠/复制/格式切换/内容切换事件
 */
function _bindSectionEvents(doc) {
    // 折叠（点击 header 区域,排除按钮）
    doc.querySelectorAll('.ccore-debug-section-header').forEach(header => {
        const section = header.parentElement;
        const toggleBtn = header.querySelector('.ccore-debug-toggle-btn');
        header.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            const collapsed = section.dataset.ccoreCollapsed === 'true';
            section.dataset.ccoreCollapsed = !collapsed;
            _updatePreVisibility(section);
            if (toggleBtn) toggleBtn.textContent = collapsed ? '收起' : '展开';
        });
    });

    // 折叠按钮
    doc.querySelectorAll('.ccore-debug-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const section = btn.closest('.ccore-debug-section');
            const collapsed = section.dataset.ccoreCollapsed === 'true';
            section.dataset.ccoreCollapsed = !collapsed;
            _updatePreVisibility(section);
            btn.textContent = collapsed ? '收起' : '展开';
        });
    });

    // 复制按钮（复制当前激活 pre 的内容）
    doc.querySelectorAll('.ccore-debug-copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const section = btn.closest('.ccore-debug-section');
            const pre = _getActivePre(section);
            if (!pre) return;
            _copyText(doc, pre.textContent, btn);
        });
    });

    // 格式切换（JSON ↔ 可读,dual/sent section）
    doc.querySelectorAll('.ccore-debug-format-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const section = btn.closest('.ccore-debug-section');
            const currentFormat = section.dataset.ccoreFormat || 'readable';
            const newFormat = currentFormat === 'json' ? 'readable' : 'json';
            section.dataset.ccoreFormat = newFormat;
            _updatePreVisibility(section);
            btn.textContent = newFormat === 'json' ? '可读' : 'JSON';
        });
    });

    // 内容切换（调用输入 ↔ 实际发送,仅 sent section）
    doc.querySelectorAll('.ccore-debug-content-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const section = btn.closest('.ccore-debug-section');
            const currentContent = section.dataset.ccoreContent;
            if (!currentContent) return;
            const newContent = currentContent === 'input' ? 'sent' : 'input';
            section.dataset.ccoreContent = newContent;
            _updatePreVisibility(section);
            btn.textContent = newContent === 'input' ? '实际发送' : '调用输入';
        });
    });
}

/**
 * 复制文本（优先 Clipboard API，非安全上下文 fallback 到 execCommand）
 */
function _copyText(doc, text, btn) {
    const showOk = () => {
        btn.textContent = '已复制!';
        setTimeout(() => { btn.textContent = '复制'; }, 1500);
    };
    const nav = doc.defaultView.navigator;
    if (nav.clipboard && nav.clipboard.writeText) {
        nav.clipboard.writeText(text).then(showOk).catch(() => {
            if (_execCopy(doc, text)) showOk();
        });
    } else {
        if (_execCopy(doc, text)) showOk();
    }
}

function _execCopy(doc, text) {
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    doc.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = doc.execCommand('copy'); } catch (e) {}
    doc.body.removeChild(ta);
    return ok;
}

/**
 * HTML 转义
 */
function _escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export default { showDebugPanel };
