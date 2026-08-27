// 消息类型渲染（各皮肤 bubble 共用）
// 依据 MESSAGE_FIELDS 的 type 语义：text/voice/img/money/loc/call/file。
// 各字段值约定（来自消息格式）：
//   money: 货币金额（如 "12.50" / "128.00"）
//   voice: 语音内容（时长）
//   call: 来电/结束电话 (时长)
//   loc: 大地点/中地点/小地点（/ 分段）
//   file: [file] 模块可在此嵌入（显示文件名占位样式）
// 本模块产出中性结构（class=*），皮肤 CSS 负责配色。

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 按 type 渲染消息内容：返回 HTML 片段（气泡内部）。
 * @param {Object} m 消息 { type, content }
 * @returns {string} 气泡内容 HTML
 */
export function renderMessageContent(m) {
    const type = String(m.type || 'text').trim().toLowerCase();
    const content = m.content || '';

    switch (type) {
        case 'text':
            return `<span class="pm-bubble-text">${escapeHtml(content)}</span>`;

        case 'voice': {
            // content: 语音内容(时长)
            const seg = splitDuration(content);
            return `<span class="pm-voice">🎤 <span class="pm-voice-text">${escapeHtml(seg.text)}</span>
                <span class="pm-voice-dur">${escapeHtml(seg.dur)}</span></span>`;
        }

        case 'img':
            return `<span class="pm-img">🖼️ ${escapeHtml(content)}</span>`;

        case 'money':
            return `<span class="pm-money">🧧 ${escapeHtml(content)}</span>`;

        case 'loc': {
            // loc: 大地点/中地点/小地点
            const parts = String(content).split('/').map(escapeHtml);
            return `<span class="pm-loc">📍 ${parts.join(' → ') || '未知位置'}</span>`;
        }

        case 'call': {
            // call: 来电/结束电话 (时长)
            const seg = splitDuration(content);
            return `<span class="pm-call">📞 ${escapeHtml(seg.text)} <span class="pm-call-dur">${escapeHtml(seg.dur)}</span></span>`;
        }

        case 'file':
            return `<span class="pm-file">📎 ${escapeHtml(content || '文件')}</span>`;

        default:
            return `<span class="pm-bubble-text">${escapeHtml(content)}</span>`;
    }
}

/**
 * 从 "内容(时长)" 中拆分内容与时长（不支持括号时内容即整体）
 * @param {string} text
 * @returns {{ text: string, dur: string }}
 */
function splitDuration(text) {
    const str = String(text == null ? '' : text);
    const m = str.match(/^(.*?)[\(（]([^\)）]*)[\)）]$/);
    if (m) return { text: m[1].trim(), dur: m[2].trim() };
    return { text: str.trim(), dur: '' };
}