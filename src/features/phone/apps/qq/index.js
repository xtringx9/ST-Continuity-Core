// QQ App 皮肤（QQ 风格：蓝色顶栏 + 白底会话列表 + 圆角气泡，对方消息带昵称）
//
// 契约（见 apps/index.js）：renderAppHtml(conversations) → { list, chats }
// 皮肤只管内容，外壳层负责导航；群聊消息带发送者昵称，私聊不带。
import { skinIcon } from '../icons.js';
import { renderMessageContent } from '../messageTypes.js';

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function initial(name) {
    const s = String(name || '?');
    return esc(s.trim().slice(0, 1) || '?');
}

function isGroupConversation(conv) {
    return conv.messages.some((m) => m.grp);
}

function bubble(m, groupConv) {
    const mine = m.isMine ? 'mine' : 'theirs';
    const content = renderMessageContent(m);
    const time = m.time ? `<div class="qq-time">${esc(m.time)}</div>` : '';
    const name = !m.isMine && groupConv && m.from ? `<div class="qq-name">${esc(m.from)}</div>` : '';
    return `<div class="qq-msg ${mine}">
        <span class="qq-avatar">${initial(m.isMine ? '我' : m.from)}</span>
        <div class="qq-body">
            ${name}
            <div class="qq-bubble">${content}</div>
        </div>
    </div>${time}`;
}

export function buildQqSkin() {
    return {
        id: 'qq',
        label: 'QQ',
        iconKey: 'qq',
        iconBg: '#12b7f5',
        cssPath: 'src/features/phone/apps/qq/qq.css',

        renderAppHtml(conversations) {
            const items = conversations.map((conv, i) => {
                const title = esc(conv.title || '未命名会话');
                const preview = esc((conv.preview || '').slice(0, 26));
                const time = conv.messages.length
                    ? esc(conv.messages[conv.messages.length - 1].time || '')
                    : '';
                const group = isGroupConversation(conv);
                return `<li class="qq-conv" data-conv="${i}">
                    <span class="qq-avatar">${initial(title)}</span>
                    <div class="qq-conv-main">
                        <div class="qq-conv-title">${title}${group ? ' · 群' : ''}</div>
                        <div class="qq-conv-preview">${preview}</div>
                    </div>
                    <span class="qq-conv-time">${time}</span>
                </li>`;
            }).join('');

            const chats = conversations.map((conv, i) => {
                const group = isGroupConversation(conv);
                const msgs = conv.messages.map((m) => bubble(m, group)).join('');
                return `<div class="qq-chat" data-conv="${i}" hidden>
                    <div class="qq-chat-header">${esc(conv.title || '会话')}</div>
                    <div class="qq-msgs">${msgs || '<div class="qq-empty">暂无消息</div>'}</div>
                </div>`;
            }).join('');

            // 会话列表为空：显示完整 QQ 界面（顶栏 + 空态 + 底部标签栏）
            const emptyList = `<div class="qq-topbar"><span class="qq-topbar-title">QQ</span></div>
                <div class="qq-emptybody">
                    <div class="qq-empty-icon" style="background:#12b7f5">${skinIcon('qq')}</div>
                    <div class="qq-empty-msg">暂无会话</div>
                </div>
                <div class="qq-tabbar">
                    <span class="qq-tab active">消息</span><span class="qq-tab">联系人</span><span class="qq-tab">动态</span><span class="qq-tab">我的</span>
                </div>`;

            return {
                list: items
                    ? `<ul class="qq-conv-list">${items}</ul>`
                    : `<div class="qq-frame-empty">${emptyList}</div>`,
                chats,
            };
        },
    };
}