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

/* ---------- 连续消息粘连（已启用 2026-08-28） ----------
 * 同方向、同发送者、时间差 ≤ gapMs 的连续消息标记 merged：仅间距收紧（css .xx-msg.merged margin-top）；
 * 头像/名字/时间/气泡样式不改变（每条都渲染，单纯"粘连"）。日期水印强制断组。
 */
/** 时间字符串 → 时间戳（ms）；无法解析返回 null */
function parseTs(t) {
    const s = String(t == null ? '' : t).trim();
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/** 相邻两条是否可粘连：同方向（mine/对方）+ 同发送者（only 对方）+ 时间差 ≤ gapMs；优先管线时间戳 ms.ts */
function canMerge(prev, cur, gapMs) {
    if (prev.isMine !== cur.isMine) return false;
    if (!prev.isMine && String(prev.from || '') !== String(cur.from || '')) return false;
    const t1 = prev.ts || parseTs(prev.time);
    const t2 = cur.ts || parseTs(cur.time);
    if (t1 == null || t2 == null || !t1 || !t2) return false;
    return Math.abs(t2 - t1) <= gapMs;
}

/**
 * 连续消息粘连：给「日期水印 + 消息」列表的连续消息打 merged 标记（皮肤收紧间距），
 * 且组内只有末条（last=true）渲染时间——中间消息不显示时间，增强粘连观感。
 * @param {Array} parts groupByDate 的输出（{kind:'date'|'msg'}）
 * @param {number} [gapMs=120000] 粘连时间窗（默认 2 分钟）
 * @returns {Array} [{ kind:'date'|'msg', msg?, merged?, last? }]
 */
export function mergeChatParts(parts, gapMs = 120000) {
    const out = [];
    const canJoin = (prev, cur) => !!(prev && canMerge(prev, cur, gapMs));
    let prevMsg = null;
    for (const p of parts) {
        if (p.kind === 'date') {
            prevMsg = null;
            out.push(p);
            continue;
        }
        const m = p.msg;
        const merged = canJoin(prevMsg, m);
        out.push({ kind: 'msg', msg: m, merged, last: true });
        // 本条与上一条粘连 → 上一条不再是组末（时间由组末独占）
        if (merged) out[out.length - 2].last = false;
        prevMsg = m;
    }
    return out;
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