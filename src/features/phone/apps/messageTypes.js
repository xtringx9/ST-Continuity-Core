// 消息类型渲染（各皮肤 bubble 共用）
// 依据 MESSAGE_FIELDS 的 type 语义：text/voice/img/money/loc/call/file。
// 各字段值约定（来自消息格式）：
//   money: 货币金额（如 "12.50" / "128.00"）
//   voice: 语音内容（时长）
//   call: 来电/结束电话 (时长)
//   loc: 大地点/中地点/小地点（/ 分段）
//   file: [file] 模块可在此嵌入（显示文件名占位样式）
// 本模块产出拟真卡片结构（class=pm-*），结构样式见 message-types.css（品牌色由皮肤 css 覆盖）。
import { uiIcon } from './icons.js';

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 时长格式化：'5'→'5″'；'01:23'→'1′23″'；其余原样 */
function durFmt(t) {
    const s = String(t == null ? '' : t).trim();
    if (!s) return '';
    if (/^\d+(\.\d+)?$/.test(s)) return `${Math.round(parseFloat(s))}″`;
    const m = s.match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/);
    if (!m) return s;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const sec = m[3] != null ? parseInt(m[3], 10) : null;
    if (sec != null) return h ? `${h}:${String(min).padStart(2, '0')}′${String(sec).padStart(2, '0')}″` : `${min}′${String(sec).padStart(2, '0')}″`;
    return h ? `${h}′${String(min).padStart(2, '0')}″` : `${min}′`;
}

/**
 * 语音波形：5 根高度错落的竖条（纯 CSS 圆角条）
 * @param {string[]} [hs] 各条高度（%）
 * @returns {string}
 */
function waveBars(hs = ['35%', '75%', '50%', '95%', '60%']) {
    return `<span class="pm-voice-wave">${hs.map((h) => `<i style="height:${h}"></i>`).join('')}</span>`;
}

/**
 * 按 type 渲染消息内容：返回 HTML 片段（气泡内部）。
 * @param {Object} m 消息 { type, content, isMine }
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
            return `<span class="pm-voice">
                    <span class="pm-voice-btn">${uiIcon('speaker', 16)}</span>
                    ${waveBars()}
                    <span class="pm-voice-meta">
                        <span class="pm-voice-text">${escapeHtml(seg.text)}</span>
                        <span class="pm-voice-dur">${escapeHtml(durFmt(seg.dur))}</span>
                    </span>
                </span>`;
        }

        case 'img':
            // content: 描述/文件名 → 图片缩略卡
            return `<span class="pm-img">
                    <span class="pm-img-thumb">${uiIcon('image', 24)}</span>
                    <span class="pm-img-name">${escapeHtml(content)}</span>
                </span>`;

        case 'money': {
            // content: 货币金额 → 红包卡（¥ 前缀自动）
            const amount = /[¥￥]/.test(content) ? content : `¥${content}`;
            return `<span class="pm-money">
                    <span class="pm-money-ico">${uiIcon('redpack', 26)}</span>
                    <span class="pm-money-main">
                        <span class="pm-money-lbl">红包</span>
                        <span class="pm-money-amt">${escapeHtml(amount)}</span>
                    </span>
                </span>`;
        }

        case 'loc': {
            // loc: 大地点/中地点/小地点
            const parts = String(content).split('/').map((p) => p.trim()).filter(Boolean);
            const main = escapeHtml(parts[0] || content || '未知位置');
            const sub = escapeHtml(parts.slice(1).join(' · '));
            return `<span class="pm-loc">
                    <span class="pm-loc-pin">${uiIcon('pin', 18)}</span>
                    <span class="pm-loc-text">
                        <span class="pm-loc-main">${main}</span>
                        ${sub ? `<span class="pm-loc-sub">${sub}</span>` : ''}
                    </span>
                </span>`;
        }

        case 'call': {
            // call: 来电/结束电话 (时长)；方向：我方呼出(out)，对方呼入(in)
            const seg = splitDuration(content);
            const dir = m.isMine ? 'out' : 'in';
            const dur = seg.dur ? `<span class="pm-call-dur">${escapeHtml(durFmt(seg.dur))}</span>` : '';
            return `<span class="pm-call ${dir}">
                    <span class="pm-call-ico">${uiIcon('phone', 16)}</span>
                    <span class="pm-call-main">${escapeHtml(seg.text || '语音通话')}</span>
                    ${dur}
                </span>`;
        }

        case 'file':
            // content: 文件名 → 文件卡
            return `<span class="pm-file">
                    <span class="pm-file-ico">${uiIcon('file', 18)}</span>
                    <span class="pm-file-name">${escapeHtml(content || '文件')}</span>
                </span>`;

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