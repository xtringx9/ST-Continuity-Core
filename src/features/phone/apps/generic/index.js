// 通用聊天 App 皮肤（apps/ 注册表第一个成员）
//
// 职责：提供「会话列表」与「聊天窗口」两段 HTML，视觉与手机外壳（像素皮）统一。
// 契约（详见 apps/index.js）：renderAppHtml(conversations) → { list, chats }
// 本皮肤为最小可用集：会话列表（头像+标题+预览）+ 聊天窗口（左右气泡 + 时间水印）。
// 气泡类型暂只做 text（type 细分留待后续 skin 或本皮肤扩展）。

/**
 * HTML 转义（防 XSS / 破坏结构）
 */
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
 * 单条消息气泡（text 型；其余 type 降级为文本渲染，避免崩坏布局）
 * @param {Object} m { from, content, time, type, isMine }
 * @returns {string}
 */
function bubble(m) {
    const content = escapeHtml(m.content || '');
    const time = m.time ? `<div class="g-msg-time">${escapeHtml(m.time)}</div>` : '';
    return `<div class="g-msg ${m.isMine ? 'mine' : 'theirs'}">
        <div class="g-bubble">${content}</div>
        ${time}
    </div>`;
}

/**
 * 构建通用聊天皮肤
 * @returns {Object} 皮肤对象 { id, label, icon, cssPath, renderAppHtml }
 */
export function buildGenericSkin() {
    return {
        id: 'generic',
        label: '通用聊天',
        icon: '💬',
        cssPath: 'src/features/phone/apps/generic/generic.css',

        /**
         * 渲染 App 内的会话列表 + 各会话聊天窗口
         * @param {Array} conversations [{ key, title, preview, messages: [{from,content,time,type,isMine}] }]
         * @returns {{ list: string, chats: string }}
         */
        renderAppHtml(conversations) {
            const items = conversations.map((conv, i) => {
                const title = escapeHtml(conv.title || '未命名会话');
                const preview = escapeHtml((conv.preview || '暂无消息').slice(0, 30));
                const initial = escapeHtml((conv.title || '?').slice(0, 1));
                return `<li class="g-conv" data-conv="${i}">
                    <span class="g-avatar">${initial}</span>
                    <div class="g-conv-main">
                        <div class="g-conv-title">${title}</div>
                        <div class="g-conv-preview">${preview}</div>
                    </div>
                </li>`;
            }).join('');

            const chats = conversations.map((conv, i) => {
                const header = `<div class="g-chat-header">${escapeHtml(conv.title || '会话')}</div>`;
                const msgs = conv.messages.map((m) => bubble(m)).join('');
                return `<div class="g-chat" data-conv="${i}" hidden>
                    ${header}
                    <div class="g-msgs">${msgs || '<div class="g-empty">暂无消息</div>'}</div>
                </div>`;
            }).join('');

            return {
                list: `<ul class="g-conv-list">${items || '<li class="g-empty">暂无会话，请在手机设置中把模块放进来</li>'}</ul>`,
                chats,
            };
        },
    };
}