// src/ui/generatorDebugPanel.js
// AI 生成调试弹窗：iframe 隔离实现，展示发送内容 / AI 完整响应 / 提取结果 + 复制按钮
// 支持多个弹窗同时存在，每个弹窗独立关闭

let panelCounter = 0;
let activePanels = 0; // 当前打开的弹窗数量

/**
 * 显示 debug 弹窗
 * @param {object} data
 * @param {string} data.title - 弹窗标题
 * @param {number|number[]} [data.mesId] - 楼层 ID
 * @param {string} data.mode - 调用模式
 * @param {object} data.sentInfo - 实际发送的信息
 * @param {string|Array} [data.capturedPrompt] - 事件捕获到的最终提示词（可能为空）
 * @param {string} data.response - AI 完整响应
 * @param {object|null} data.extracted - 提取的模块数据
 * @param {object} data.apiUsed - 使用的 API 信息
 * @param {boolean} [data.hasModules] - 是否有模块数据
 * @param {string} [data.error] - 错误信息
 */
export function showDebugPanel(data) {
    panelCounter++;
    const panelId = `ccore-debug-panel-${panelCounter}`;

    // 偏移基于当前已打开的弹窗数量
    const offset = activePanels % 5;
    const offsetX = offset * 30;
    const offsetY = offset * 30;
    activePanels++;

    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.id = panelId;
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100dvw',
        height: '100dvh',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: '100000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: '0',
        transition: 'opacity 0.2s ease',
    });

    // 创建 iframe 容器
    const iframeWrapper = document.createElement('div');
    Object.assign(iframeWrapper.style, {
        width: '90vw',
        maxWidth: '1200px',
        height: '85vh',
        marginLeft: `${offsetX}px`,
        marginTop: `${offsetY}px`,
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#1a1a2e',
    });

    // 创建 iframe
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, {
        width: '100%',
        height: '100%',
        border: 'none',
        display: 'block',
    });

    // 构建 iframe 内容
    const htmlContent = _buildIframeHtml(data);
    iframe.srcdoc = htmlContent;

    iframeWrapper.appendChild(iframe);
    overlay.appendChild(iframeWrapper);

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) removePanel(overlay);
    });

    document.body.appendChild(overlay);

    // 触发淡入动画
    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
    });

    // 监听 iframe 内的关闭消息
    const messageHandler = (event) => {
        if (event.data && event.data.type === 'CLOSE_DEBUG_PANEL' && event.data.panelId === panelId) {
            removePanel(overlay);
            window.removeEventListener('message', messageHandler);
        }
    };
    window.addEventListener('message', messageHandler);
}

/**
 * 构建 iframe 的完整 HTML
 */
function _buildIframeHtml(data) {
    const sections = [];

    // 错误信息
    if (data.error) {
        sections.push(_buildSection('错误', data.error, '#ff6b6b', true));
    }

    // 1. 发送给 AI 的内容
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
            parts.push('=== quietPrompt (发送给 AI 的消息) ===');
            parts.push(data.sentInfo.quietPrompt || '(空)');
            parts.push('');
            parts.push('=== injectPrompt (注入到 extension_prompts 的指令) ===');
            parts.push(data.sentInfo.injectPrompt || '(无)');
            sentText = parts.join('\n');
        }
        sections.push(_buildSection('发送给 AI 的内容', sentText, '#7eb8da', true));
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
        sections.push(_buildSection('ST 管线最终提示词（事件捕获）', capturedText || '(未捕获到)', '#c0c0c0', false));
    }

    // 3. AI 完整响应
    sections.push(_buildSection('AI 完整响应', data.response || '(空)', '#a8d8a8', true));

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
        sections.push(_buildSection('提取结果', extractedText, '#d8a8d8', false));
    }

    // 5. API 信息
    if (data.apiUsed && Object.keys(data.apiUsed).length > 0) {
        sections.push(_buildSection('API 信息', JSON.stringify(data.apiUsed, null, 2), '#aaa', false));
    }

    const title = data.title || 'AI 生成调试';
    const panelId = `ccore-debug-panel-${panelCounter}`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    background-color: #1a1a2e;
    color: #e0e0e0;
    font-family: 'Segoe UI', sans-serif;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
}
.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
}
.header h3 { font-size: 14px; color: #7eb8da; }
.close-btn {
    background: none; border: none; color: #888; cursor: pointer;
    font-size: 18px; padding: 0 4px;
}
.close-btn:hover { color: #fff; }
.body {
    padding: 12px 16px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.section {
    border: 1px solid #333;
    border-radius: 6px;
    overflow: hidden;
}
.section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background-color: #222;
    cursor: pointer;
    user-select: none;
}
.section-title { font-weight: bold; font-size: 12px; }
.btn-group { display: flex; gap: 6px; }
.small-btn {
    background: #333; border: 1px solid #555; color: #ccc;
    border-radius: 3px; padding: 2px 8px; font-size: 11px; cursor: pointer;
}
.small-btn:hover { background: #444; }
.content-pre {
    margin: 0; padding: 8px 10px;
    background-color: #111; color: #ddd;
    font-size: 12px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
    max-height: 300px; overflow-y: auto;
}
</style>
</head>
<body>
<div class="header">
    <h3>${title}</h3>
    <button class="close-btn" onclick="window.parent.postMessage({type:'CLOSE_DEBUG_PANEL',panelId:'${panelId}'},'*')">&#x2715;</button>
</div>
<div class="body">
    ${sections.join('')}
</div>
<script>
// 折叠/复制功能
document.querySelectorAll('.section-header').forEach(function(header) {
    var pre = header.parentElement.querySelector('.content-pre');
    var toggleBtn = header.querySelector('.toggle-btn');
    var collapsed = pre.style.display === 'none';

    header.addEventListener('click', function(e) {
        if (e.target.classList.contains('copy-btn') || e.target.classList.contains('toggle-btn')) return;
        collapsed = !collapsed;
        pre.style.display = collapsed ? 'none' : 'block';
        toggleBtn.textContent = collapsed ? '展开' : '收起';
    });
});
document.querySelectorAll('.copy-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var pre = btn.closest('.section').querySelector('.content-pre');
        var text = pre.textContent;
        var showOk = function() {
            btn.textContent = '已复制!';
            setTimeout(function() { btn.textContent = '复制'; }, 1500);
        };
        // 优先用 Clipboard API（需安全上下文），否则 fallback 到 execCommand
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(showOk).catch(function() {
                if (_execCopy(text)) showOk();
            });
        } else {
            if (_execCopy(text)) showOk();
        }
    });
});
function _execCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
}
document.querySelectorAll('.toggle-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var pre = btn.closest('.section').querySelector('.content-pre');
        var collapsed = pre.style.display === 'none';
        collapsed = !collapsed;
        pre.style.display = collapsed ? 'none' : 'block';
        btn.textContent = collapsed ? '展开' : '收起';
    });
});
</script>
</body>
</html>`;
}

/**
 * 构建单个 section 的 HTML
 */
function _buildSection(title, content, accentColor, defaultOpen = true) {
    const escapedContent = _escapeHtml(content);
    const display = defaultOpen ? 'block' : 'none';
    const toggleText = defaultOpen ? '收起' : '展开';

    return `<div class="section">
    <div class="section-header">
        <span class="section-title" style="color:${accentColor}">${_escapeHtml(title)}</span>
        <div class="btn-group">
            <button class="small-btn copy-btn">复制</button>
            <button class="small-btn toggle-btn">${toggleText}</button>
        </div>
    </div>
    <pre class="content-pre" style="display:${display}">${escapedContent}</pre>
</div>`;
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

/**
 * 移除弹窗
 */
function removePanel(overlay) {
    if (!overlay || !overlay.parentNode || overlay._closing) return;
    overlay._closing = true; // 防止重复调用导致多次递减
    if (activePanels > 0) activePanels--; // 立即递减，避免关闭动画期间打开新弹窗时偏移量计算错误
    overlay.style.opacity = '0';
    setTimeout(() => {
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
    }, 200);
}

export default { showDebugPanel };
