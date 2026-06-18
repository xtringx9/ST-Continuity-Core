// src/ui/generatorDebugPanel.js
// 生成调试弹窗：基于 IframeModal + 独立 HTML，复用 module-editor 主题系统
// 支持多个弹窗同时存在（每次 new 新 IframeModal 实例）

import { IframeModal } from '../shared/IframeModal.js';

// 调试弹窗 HTML 文件路径（基于当前 JS 文件位置解析）
const PANEL_HTML_URL = new URL('generatorDebugPanel.html', import.meta.url).href;

let panelCounter = 0;

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
        },
    });
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

    // 1. 发送的内容
    if (data.sentInfo) {
        let sentText = '';
        if (data.sentInfo.type === 'raw') {
            if (Array.isArray(data.sentInfo.prompt)) {
                sentText = data.sentInfo.prompt
                    .map(m => `[${m.role}]\n${m.content}`)
                    .join('\n\n---\n\n');
            } else {
                sentText = String(data.sentInfo.prompt);
            }
        } else if (data.sentInfo.type === 'pipeline') {
            const parts = [];
            parts.push('=== quietPrompt (发送的消息) ===');
            parts.push(data.sentInfo.quietPrompt || '(空)');
            parts.push('');
            parts.push('=== injectPrompt (注入到 extension_prompts 的指令) ===');
            parts.push(data.sentInfo.injectPrompt || '(无)');
            sentText = parts.join('\n');
        }
        sections.push(_buildSection('发送内容', sentText, 'var(--accent-color)', true));
    }

    // 2. 事件捕获的最终提示词
    {
        let capturedText = '';
        if (Array.isArray(data.capturedPrompt) && data.capturedPrompt.length > 0) {
            capturedText = data.capturedPrompt
                .map(m => `[${m.role}${m.name ? ` (${m.name})` : ''}]\n${m.content}`)
                .join('\n\n---\n\n');
        } else if (typeof data.capturedPrompt === 'string' && data.capturedPrompt) {
            capturedText = data.capturedPrompt;
        }
        sections.push(_buildSection('ST 管线最终提示词（事件捕获）', capturedText || '(未捕获到)', 'var(--text-secondary)', false));
    }

    // 3. 完整响应
    sections.push(_buildSection('完整响应', data.response || '(空)', 'var(--success-color)', true));

    // 4. 提取结果
    if (data.extracted) {
        const extractedText = [
            `moduleTagModules (${data.extracted.moduleTagModules.length}):`,
            ...data.extracted.moduleTagModules.map(m => `  ${m}`),
            `contentTagModules (${data.extracted.contentTagModules.length}):`,
            ...data.extracted.contentTagModules.map(m => `  ${m}`),
            `extraModules (${data.extracted.extraModules.length}):`,
            ...data.extracted.extraModules.map(m => `  ${m}`),
        ].join('\n');
        sections.push(_buildSection('提取结果', extractedText, 'var(--accent-color)', false));
    }

    // 5. API 信息
    if (data.apiUsed && Object.keys(data.apiUsed).length > 0) {
        sections.push(_buildSection('API 信息', JSON.stringify(data.apiUsed, null, 2), 'var(--text-muted)', false));
    }

    return sections.join('');
}

/**
 * 构建单个 section 的 HTML
 */
function _buildSection(title, content, accentColor, defaultOpen = true) {
    const escapedContent = _escapeHtml(content);
    const display = defaultOpen ? 'block' : 'none';
    const toggleText = defaultOpen ? '收起' : '展开';

    return `<div class="ccore-debug-section">
    <div class="ccore-debug-section-header">
        <span class="ccore-debug-section-title" style="color:${accentColor}">${_escapeHtml(title)}</span>
        <div class="ccore-debug-btn-group">
            <button class="ccore-debug-small-btn ccore-debug-copy-btn">复制</button>
            <button class="ccore-debug-small-btn ccore-debug-toggle-btn">${toggleText}</button>
        </div>
    </div>
    <pre class="ccore-debug-pre" style="display:${display}">${escapedContent}</pre>
</div>`;
}

/**
 * 绑定 section 折叠/复制事件
 */
function _bindSectionEvents(doc) {
    // 折叠（点击 header 区域）
    doc.querySelectorAll('.ccore-debug-section-header').forEach(header => {
        const pre = header.parentElement.querySelector('.ccore-debug-pre');
        const toggleBtn = header.querySelector('.ccore-debug-toggle-btn');
        header.addEventListener('click', (e) => {
            if (e.target.classList.contains('ccore-debug-copy-btn') || e.target.classList.contains('ccore-debug-toggle-btn')) return;
            const collapsed = pre.style.display === 'none';
            pre.style.display = collapsed ? 'block' : 'none';
            if (toggleBtn) toggleBtn.textContent = collapsed ? '收起' : '展开';
        });
    });

    // 折叠按钮
    doc.querySelectorAll('.ccore-debug-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pre = btn.closest('.ccore-debug-section').querySelector('.ccore-debug-pre');
            const collapsed = pre.style.display === 'none';
            pre.style.display = collapsed ? 'block' : 'none';
            btn.textContent = collapsed ? '收起' : '展开';
        });
    });

    // 复制按钮
    doc.querySelectorAll('.ccore-debug-copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pre = btn.closest('.ccore-debug-section').querySelector('.ccore-debug-pre');
            _copyText(doc, pre.textContent, btn);
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
