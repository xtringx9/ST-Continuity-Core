// 聊天窗口共享部件：时间分组水印 + 底部输入栏（各皮肤聊天窗复用，类名前缀由皮肤传入）

/* 提取消息日期（YYYY-MM-DD），用于分组水印 */
function msgDate(t) {
    const s = String(t == null ? '' : t);
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
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
 * 生成日期水印 HTML（皮肤前缀类名 xx-date）。
 * @param {string} prefix 皮肤类名前缀（如 'wx'）
 * @param {string} date
 * @returns {string}
 */
export function dateDivider(prefix, date) {
    return `<div class="${prefix}-date">${String(date || '')}</div>`;
}

/**
 * 底部输入栏（类名 byPfx = prefix+'-chat-input'，按钮行 = prefix+'-chat-bar'）。
 * @param {string} prefix 皮肤类名前缀
 * @returns {string}
 */
export function chatComposer(prefix) {
    return `<div class="${prefix}-chat-input">
        <button class="${prefix}-ci-btn" type="button">🎙</button>
        <input class="${prefix}-ci-field" type="text" placeholder="输入消息…">
        <button class="${prefix}-ci-btn" type="button">😊</button>
        <button class="${prefix}-ci-btn" type="button">＋</button>
    </div>
    <div class="${prefix}-chat-bar"></div>`;
}