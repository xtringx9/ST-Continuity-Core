// LINE App 皮肤（LINE 风格：绿色品牌顶栏 + 白色圆角会话卡 + 圆角气泡）
//
// 契约（见 apps/index.js）：renderAppHtml(conversations) → { list, chats }
// 皮肤只管内容，外壳层负责导航；会话卡展示群成员（mems），聊天窗口气泡左右两侧。
import { skinIcon } from '../icons.js';

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
    const content = esc(m.content || '');
    const time = m.time ? `<div class="ln-time">${esc(m.time)}</div>` : '';
    const name = !m.isMine && groupConv && m.from ? `<div class="ln-name">${esc(m.from)}</div>` : '';
    return `<div class="ln-msg ${mine}">
        <span class="ln-avatar">${initial(m.isMine ? '我' : m.from)}</span>
        <div class="ln-body">
            ${name}
            <div class="ln-bubble">${content}</div>
        </div>
    </div>${time}`;
}

export function buildLineSkin() {
    return {
        id: 'line',
        label: 'LINE',
        iconKey: 'line',
        iconBg: '#06c755',
        cssPath: 'src/features/phone/apps/line/line.css',

        renderAppHtml(conversations) {
            const items = conversations.map((conv, i) => {
                const title = esc(conv.title || '未命名会话');
                const preview = esc((conv.preview || '').slice(0, 26));
                const group = isGroupConversation(conv);
                // 成员首字串联（群聊体现成员多，私聊就一个头像）
                const memberChips = group && conv.members && conv.members.length > 1
                    ? conv.members.slice(0, 3).map((mm) => `<span class="ln-mini">${initial(mm)}</span>`).join('')
                    : `<span class="ln-mini">${initial(title)}</span>`;
                return `<li class="ln-conv" data-conv="${i}">
                    <span class="ln-avatar">${initial(title)}</span>
                    <div class="ln-conv-main">
                        <div class="ln-conv-title">${title}${group ? ' · 群' : ''}</div>
                        <div class="ln-conv-preview">${preview}</div>
                        <div class="ln-membox">${memberChips}</div>
                    </div>
                </li>`;
            }).join('');

            const chats = conversations.map((conv, i) => {
                const group = isGroupConversation(conv);
                const msgs = conv.messages.map((m) => bubble(m, group)).join('');
                return `<div class="ln-chat" data-conv="${i}" hidden>
                    <div class="ln-chat-header">${esc(conv.title || '会话')}</div>
                    <div class="ln-msgs">${msgs || '<div class="ln-empty">暂无消息</div>'}</div>
                </div>`;
            }).join('');

            // 会话列表为空：显示完整 LINE 界面（顶栏 + 空态 + 底部标签栏）
            const emptyList = `<div class="ln-topbar"><span class="ln-topbar-title">LINE</span></div>
                <div class="ln-emptybody">
                    <div class="ln-empty-icon" style="background:#06c755">${skinIcon('line')}</div>
                    <div class="ln-empty-msg">暂无会话</div>
                </div>
                <div class="ln-tabbar">
                    <span class="ln-tab active">好友</span><span class="ln-tab">聊天</span><span class="ln-tab">动态</span><span class="ln-tab">设置</span>
                </div>`;

            return {
                list: items
                    ? `<ul class="ln-conv-list">${items}</ul>`
                    : `<div class="ln-frame-empty">${emptyList}</div>`,
                chats,
            };
        },
    };
}