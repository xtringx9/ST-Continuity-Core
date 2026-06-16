// src/ui/generatorDebugPanel.js
// AI 生成调试弹窗：展示发送内容 / AI 完整响应 / 提取结果 + 复制按钮
// 支持多个弹窗同时存在，每个弹窗独立关闭

let panelCounter = 0;

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

    // 偏移多个弹窗位置
    const offset = (panelCounter - 1) % 5;
    const offsetX = offset * 30;
    const offsetY = offset * 30;

    // 创建弹窗容器
    const overlay = document.createElement('div');
    overlay.id = panelId;
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        zIndex: '99999',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn 0.2s ease',
    });

    // 弹窗主体
    const dialog = document.createElement('div');
    Object.assign(dialog.style, {
        backgroundColor: '#1a1a2e',
        color: '#e0e0e0',
        borderRadius: '8px',
        width: '90vw',
        maxWidth: '1200px',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        fontFamily: "'Segoe UI', sans-serif",
        fontSize: '13px',
        marginLeft: `${offsetX}px`,
        marginTop: `${offsetY}px`,
    });

    // 标题栏
    const header = document.createElement('div');
    Object.assign(header.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: '1px solid #333',
        flexShrink: '0',
    });

    const titleEl = document.createElement('h3');
    titleEl.textContent = data.title;
    Object.assign(titleEl.style, { margin: '0', fontSize: '14px', color: '#7eb8da' });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
        background: 'none',
        border: 'none',
        color: '#888',
        cursor: 'pointer',
        fontSize: '18px',
        padding: '0 4px',
    });
    closeBtn.onmouseover = () => closeBtn.style.color = '#fff';
    closeBtn.onmouseout = () => closeBtn.style.color = '#888';
    closeBtn.onclick = () => removePanel(overlay);

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // 内容区
    const body = document.createElement('div');
    Object.assign(body.style, {
        padding: '12px 16px',
        overflowY: 'auto',
        flex: '1',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
    });

    // 错误信息
    if (data.error) {
        body.appendChild(createSection('错误', data.error, '#ff6b6b', true));
    }

    // ========== 1. 发送给 AI 的内容（最重要） ==========
    if (data.sentInfo) {
        let sentText = '';
        if (data.sentInfo.type === 'raw') {
            // raw 模式：显示完整 prompt 数组
            if (Array.isArray(data.sentInfo.prompt)) {
                sentText = data.sentInfo.prompt
                    .map(m => `[${m.role}]\n${m.content}`)
                    .join('\n\n---\n\n');
            } else {
                sentText = String(data.sentInfo.prompt);
            }
        } else if (data.sentInfo.type === 'pipeline') {
            // pipeline 模式：显示 quietPrompt + injectPrompt
            const parts = [];
            parts.push('=== quietPrompt (发送给 AI 的消息) ===');
            parts.push(data.sentInfo.quietPrompt || '(空)');
            parts.push('');
            parts.push('=== injectPrompt (注入到 extension_prompts 的指令) ===');
            parts.push(data.sentInfo.injectPrompt || '(无)');
            sentText = parts.join('\n');
        }
        body.appendChild(createSection('发送给 AI 的内容', sentText, '#7eb8da', true));
    }

    // ========== 2. 事件捕获的最终提示词 ==========
    {
        let capturedText = '';
        if (Array.isArray(data.capturedPrompt) && data.capturedPrompt.length > 0) {
            capturedText = data.capturedPrompt
                .map(m => `[${m.role}${m.name ? ` (${m.name})` : ''}]\n${m.content}`)
                .join('\n\n---\n\n');
        } else if (typeof data.capturedPrompt === 'string' && data.capturedPrompt) {
            capturedText = data.capturedPrompt;
        }
        body.appendChild(createSection('ST 管线最终提示词（事件捕获）', capturedText || '(未捕获到)', '#c0c0c0', false));
    }

    // ========== 3. AI 完整响应（最重要，始终显示） ==========
    body.appendChild(createSection('AI 完整响应', data.response || '(空)', '#a8d8a8', true));

    // ========== 4. 提取结果 ==========
    if (data.extracted) {
        const extractedText = [
            `moduleTagModules (${data.extracted.moduleTagModules.length}):`,
            ...data.extracted.moduleTagModules.map(m => `  ${m}`),
            `contentTagModules (${data.extracted.contentTagModules.length}):`,
            ...data.extracted.contentTagModules.map(m => `  ${m}`),
            `extraModules (${data.extracted.extraModules.length}):`,
            ...data.extracted.extraModules.map(m => `  ${m}`),
        ].join('\n');
        body.appendChild(createSection('提取结果', extractedText, '#d8a8d8', false));
    }

    // ========== 5. API 信息 ==========
    if (data.apiUsed && Object.keys(data.apiUsed).length > 0) {
        body.appendChild(createSection('API 信息', JSON.stringify(data.apiUsed, null, 2), '#aaa', false));
    }

    // 组装
    dialog.appendChild(header);
    dialog.appendChild(body);
    overlay.appendChild(dialog);

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) removePanel(overlay);
    });

    document.body.appendChild(overlay);
}

/**
 * 创建一个可折叠的段落
 * @param {string} title - 标题
 * @param {string} content - 内容文本
 * @param {string} accentColor - 标题颜色
 * @param {boolean} defaultOpen - 默认是否展开
 */
function createSection(title, content, accentColor, defaultOpen = true) {
    const section = document.createElement('div');
    Object.assign(section.style, {
        border: '1px solid #333',
        borderRadius: '6px',
        overflow: 'hidden',
    });

    // 标题行
    const headerRow = document.createElement('div');
    Object.assign(headerRow.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        backgroundColor: '#222',
        cursor: 'pointer',
        userSelect: 'none',
    });

    const titleSpan = document.createElement('span');
    titleSpan.textContent = title;
    Object.assign(titleSpan.style, { color: accentColor, fontWeight: 'bold', fontSize: '12px' });

    const btnGroup = document.createElement('div');
    Object.assign(btnGroup.style, { display: 'flex', gap: '6px' });

    // 复制按钮
    const copyBtn = createSmallButton('复制', () => {
        navigator.clipboard.writeText(content).then(() => {
            copyBtn.textContent = '已复制!';
            setTimeout(() => copyBtn.textContent = '复制', 1500);
        });
    });

    // 折叠按钮
    const toggleBtn = createSmallButton(defaultOpen ? '收起' : '展开', null);
    let collapsed = !defaultOpen;
    toggleBtn.onclick = () => {
        collapsed = !collapsed;
        contentPre.style.display = collapsed ? 'none' : 'block';
        toggleBtn.textContent = collapsed ? '展开' : '收起';
    };

    btnGroup.appendChild(copyBtn);
    btnGroup.appendChild(toggleBtn);

    headerRow.appendChild(titleSpan);
    headerRow.appendChild(btnGroup);

    // 点击标题行也可折叠
    headerRow.onclick = (e) => {
        if (e.target === copyBtn) return;
        collapsed = !collapsed;
        contentPre.style.display = collapsed ? 'none' : 'block';
        toggleBtn.textContent = collapsed ? '展开' : '收起';
    };

    // 内容
    const contentPre = document.createElement('pre');
    contentPre.textContent = content;
    Object.assign(contentPre.style, {
        margin: '0',
        padding: '8px 10px',
        backgroundColor: '#111',
        color: '#ddd',
        fontSize: '12px',
        lineHeight: '1.5',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: '300px',
        overflowY: 'auto',
        display: collapsed ? 'none' : 'block',
    });

    section.appendChild(headerRow);
    section.appendChild(contentPre);

    return section;
}

/**
 * 创建小按钮
 */
function createSmallButton(text, onClick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    Object.assign(btn.style, {
        background: '#333',
        border: '1px solid #555',
        color: '#ccc',
        borderRadius: '3px',
        padding: '2px 8px',
        fontSize: '11px',
        cursor: 'pointer',
    });
    btn.onmouseover = () => { btn.style.backgroundColor = '#444'; };
    btn.onmouseout = () => { btn.style.backgroundColor = '#333'; };
    if (onClick) btn.onclick = (e) => { e.stopPropagation(); onClick(); };
    return btn;
}

/**
 * 移除弹窗
 */
function removePanel(overlay) {
    if (overlay && overlay.parentNode) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.2s';
        setTimeout(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 200);
    }
}

export default { showDebugPanel };
