// 聊天窗口共享部件：时间格式化 + 日期分组水印 + 聊天顶栏 + 底部输入栏
// （各皮肤聊天窗复用，类名前缀由皮肤传入；SVG 图标见 icons.js）
import { uiIcon } from './icons.js';

/**
 * 提取消息日期（YYYY-MM-DD），用于分组水印
 * @param {string} t
 * @returns {string}
 */
function msgDate(t) {
    const s = String(t == null ? '' : t);
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
}

/** 本地今天（Y-M-D） */
function todayParts() {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

/**
 * 把时间字段格式化为「相对化」显示：
 *   YYYY-MM-DD HH:MM:SS → 今天只显示 HH:MM；昨天 → 「昨天」；今年 → 「M月D日」；跨年 → 「YYYY年M月D日」
 * @param {string} t 原始时间（YYYY-MM-DD[ HH:MM[:SS]]）
 * @param {boolean} [withTime=false] 需要带时刻（气泡内时间）时 true；否则只给日期
 * @returns {string}
 */
export function fmtTime(t, withTime = false) {
    const s = String(t == null ? '' : t).trim();
    const dm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?/);
    if (!dm) return s || '';
    const [, yRaw, mRaw, dRaw, hh, mm] = dm;
    const y = parseInt(yRaw, 10), m = parseInt(mRaw, 10), d = parseInt(dRaw, 10);
    const today = todayParts();
    const hm = hh != null ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : '';
    if (withTime && y === today.y && m === today.m && d === today.d) return hm || `${m}月${d}日`;
    if (y === today.y && m === today.m && d === today.d) return '今天';
    // 昨天：构造昨天日期再比对（避免时区/夏令时误差）
    const yest = new Date(today.y, today.m - 1, today.d - 1);
    if (y === yest.getFullYear() && m === yest.getMonth() + 1 && d === yest.getDate()) return '昨天';
    const dateStr = y === today.y ? `${m}月${d}日` : `${y}年${m}月${d}日`;
    return withTime ? (hm ? `${dateStr} ${hm}` : dateStr) : dateStr;
}

/**
 * 提取时刻 HH:MM（气泡内时间用；年月日已由日期水印胶囊承担）
 * @param {string} t 原始时间（YYYY-MM-DD HH:MM[:SS]）
 * @returns {string} 空表示无时刻
 */
export function msgClock(t) {
    const s = String(t == null ? '' : t).trim();
    const m = s.match(/(\d{1,2}):(\d{1,2})(?::\d{1,2})?/);
    if (!m) return '';
    return `${String(m[1]).padStart(2, '0')}:${String(m[2]).padStart(2, '0')}`;
}

/**
 * 把消息列表按日期插入分组水印。
 * 返回新数组：元素为 { kind:'date', date } 或 { kind:'msg', msg }。
 * @param {Array} messages
 * @returns {Array}
 */
export function groupByDate(messages) {
    const out = [];
    let last = '';
    for (const m of messages) {
        const d = msgDate(m.time);
        if (d && d !== last) {
            out.push({ kind: 'date', date: d });
            last = d;
        }
        out.push({ kind: 'msg', msg: m });
    }
    return out;
}

/**
 * 生成日期水印 HTML（共享结构 .pm-date-divider，皮肤 css 可覆盖配色）。
 * @param {string} _prefix 皮肤类名前缀（保留签名，结构统一用 .pm-date-divider）
 * @param {string} date
 * @returns {string}
 */
export function dateDivider(_prefix, date) {
    return `<div class="pm-date-divider"><span>${String(fmtTime(date) || '')}</span></div>`;
}

/**
 * 聊天窗口顶栏：返回按钮 + 居中标题（拟真 App：聊天页自带返回，不依赖外壳通用返回）
 * @param {string} prefix 皮肤类名前缀
 * @param {string} title 会话标题
 * @returns {string}
 */
export function chatHeader(prefix, title) {
    return `<div class="${prefix}-chat-header">
        <button class="js-chat-back ${prefix}-chat-back" type="button" title="返回">${uiIcon('back', 24)}</button>
        <span class="${prefix}-chat-title">${String(title != null ? title : '会话')}</span>
        <span class="${prefix}-chat-header-spacer"></span>
    </div>`;
}

/**
 * 底部输入栏（类名 byPfx = prefix+'-chat-input'，按钮行 = prefix+'-chat-bar'）。
 * 按钮 emoji 已替换为线性 SVG 图标（mic/smile/plus）。
 * @param {string} prefix 皮肤类名前缀
 * @returns {string}
 */
export function chatComposer(prefix) {
    return `<div class="${prefix}-chat-input">
        <button class="${prefix}-ci-btn" type="button" title="语音">${uiIcon('mic', 20)}</button>
        <input class="${prefix}-ci-field" type="text" placeholder="输入消息…">
        <button class="${prefix}-ci-btn" type="button" title="表情">${uiIcon('smile', 20)}</button>
        <button class="${prefix}-ci-btn" type="button" title="更多">${uiIcon('plus', 20)}</button>
    </div>
    <div class="${prefix}-chat-bar"></div>`;
}