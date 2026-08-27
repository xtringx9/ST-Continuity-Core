// 微信 App 皮肤（微信风格：深色渐变顶栏 + 圆形头像 + 左右气泡）
//
// 契约（见 apps/index.js）：renderAppHtml(conversations) → { list, chats }
//   list: 会话列表（圆形头像 + 名称 + 预览），每个可点击项带 data-conv=索引
//   chats: 各会话聊天窗口（顶栏 + 消息流），默认 hidden，带 data-conv=索引
// 外壳层（phoneRenderer NAV_SCRIPT）负责 home ↔ App ↔ 会话 导航，皮肤只管内容。

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 头像首字 */
function initial(name) {
    const s = String(name || '?');
    return esc(s.trim().slice(0, 1) || '?');
}

/** 群聊判定：无 dm 字段（grp 有值）的消息归为群聊；这里用消息中是否出现过 grp 简化处理 */
function isGroupConversation(conv) {
    return conv.messages.some((m) => m.grp);
}

/** 单条消息气泡（左右布局 + 时间水印） */
function bubble(m, groupConv) {
    const mine = m.isMine ? 'mine' : 'theirs';
    const content = esc(m.content || '');
    const time = m.time ? `<div class="wx-time">${esc(m.time)}</div>` : '';
    // 群聊对方消息显示发送者名（自己/私聊不显示）
    const name = !m.isMine && groupConv && m.from ? `<div class="wx-name">${esc(m.from)}</div>` : '';
    const avatar = `<span class="wx-avatar">${initial(m.isMine ? '我' : m.from)}</span>`;
    return `<div class="wx-msg ${mine}">
        ${m.isMine ? '' : avatar}
        <div class="wx-body">
            ${name}
            <div class="wx-bubble">${content}</div>
        </div>
        ${m.isMine ? avatar : ''}
    </div>${time}`;
}

export function buildWechatSkin() {
    return {
        id: 'wechat',
        label: '微信',
        icon: '💚',
        cssPath: 'src/features/phone/apps/wechat/wechat.css',

        renderAppHtml(conversations) {
            const items = conversations.map((conv, i) => {
                const title = esc(conv.title || '未命名会话');
                const preview = esc((conv.preview || '').slice(0, 26));
                const time = conv.messages.length
                    ? esc(conv.messages[conv.messages.length - 1].time || '')
                    : '';
                const group = isGroupConversation(conv);
                return `<li class="wx-conv" data-conv="${i}">
                    <span class="wx-avatar">${initial(title)}</span>
                    <div class="wx-conv-main">
                        <div class="wx-conv-line1">
                            <span class="wx-conv-title">${title}</span>
                            <span class="wx-conv-time">${time}</span>
                        </div>
                        <div class="wx-conv-preview">${group ? '[群] ' : ''}${preview}</div>
                    </div>
                </li>`;
            }).join('');

            const chats = conversations.map((conv, i) => {
                const group = isGroupConversation(conv);
                const msgs = conv.messages.map((m) => bubble(m, group)).join('');
                return `<div class="wx-chat" data-conv="${i}" hidden>
                    <div class="wx-chat-header">${esc(conv.title || '会话')}</div>
                    <div class="wx-msgs">${msgs || '<div class="wx-empty">暂无消息</div>'}</div>
                </div>`;
            }).join('');

            // 会话列表为空：显示完整微信界面（顶栏 + 空态 + 底部标签栏）
            const emptyList = `<div class="wx-topbar"><span class="wx-topbar-title">微信</span></div>
                <div class="wx-emptybody">
                    <div class="wx-empty-icon">💬</div>
                    <div class="wx-empty-msg">暂无会话</div>
                </div>
                <div class="wx-tabbar">
                    <span class="wx-tab active">微信</span><span class="wx-tab">通讯录</span><span class="wx-tab">发现</span><span class="wx-tab">我</span>
                </div>`;

            return {
                list: items
                    ? `<ul class="wx-conv-list">${items}</ul>`
                    : `<div class="wx-frame-empty">${emptyList}</div>`,
                chats,
            };
        },
    };
}