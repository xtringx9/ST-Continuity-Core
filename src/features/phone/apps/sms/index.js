// 短信 App 皮肤（SMS/手机短信：绿色气泡，贴近系统短信/iMessage 风）
//
// 契约（见 apps/index.js）：renderAppHtml(conversations) → { list, chats }
// 桌面图标走 iconKey 注册；会话列表 + 聊天窗口结构与通用皮肤一致，配色品牌化。
import { skinIcon } from '../icons.js';
import { renderMessageContent } from '../messageTypes.js';
import { groupByDate, dateDivider, chatComposer, chatHeader } from '../chatChrome.js';

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
    const time = m.time ? `<div class="sms-time">${esc(m.time)}</div>` : '';
    const name = !m.isMine && groupConv && m.from ? `<div class="sms-name">${esc(m.from)}</div>` : '';
    const avatar = `<span class="sms-avatar">${initial(m.isMine ? '我' : m.from)}</span>`;
    // 头像固定放最前，视觉位置由 CSS order 决定（theirs=左，mine=右）
    return `<div class="sms-msg ${mine}">
        ${avatar}
        <div class="sms-body">
            ${name}
            <div class="sms-bubble">${content}</div>
        </div>
    </div>${time}`;
}

export function buildSmsSkin() {
    return {
        id: 'sms',
        label: '短信',
        iconKey: 'sms',
        iconBg: '#5a98d8',
        cssPath: 'src/features/phone/apps/sms/sms.css',

        renderAppHtml(conversations) {
            const items = conversations.map((conv, i) => {
                const title = esc(conv.title || '未命名会话');
                const preview = esc((conv.preview || '').slice(0, 26));
                const group = isGroupConversation(conv);
                return `<li class="sms-conv" data-conv="${i}">
                    <span class="sms-avatar">${initial(title)}</span>
                    <div class="sms-conv-main">
                        <div class="sms-conv-title">${title}${group ? ' · 群发' : ''}</div>
                        <div class="sms-conv-preview">${preview}</div>
                    </div>
                </li>`;
            }).join('');

            const chats = conversations.map((conv, i) => {
                const group = isGroupConversation(conv);
                const parts = groupByDate(conv.messages).map((p) => p.kind === 'date'
                    ? dateDivider('sms', p.date)
                    : bubble(p.msg, group)).join('');
                return `<div class="sms-chat" data-conv="${i}" hidden>
                    ${chatHeader('sms', esc(conv.title || '会话'))}
                    <div class="sms-msgs">${parts || '<div class="sms-empty">暂无消息</div>'}</div>
                    ${chatComposer('sms')}
                </div>`;
            }).join('');

            // SMS 风格顶部导航（列表态与空态共用）：标题 + 搜索/编辑
            const smsTopbar = `<div class="sms-topbar">
                <span class="sms-topbar-title">信息</span>
                <span class="sms-topbar-icons">
                    <button class="sms-topbar-icon" type="button">🔍</button>
                    <button class="sms-topbar-icon" type="button">✎</button>
                </span>
            </div>`;

            // 空态：与各 App 一致，短信品牌顶栏 + 空态 + 底部标签栏
            const emptyList = `${smsTopbar}
                <div class="sms-emptybody">
                    <div class="sms-empty-icon" style="background:#5a98d8">${skinIcon('sms')}</div>
                    <div class="sms-empty-msg">暂无会话</div>
                </div>
                <div class="sms-tabbar">
                    <span class="sms-tab active">信息</span><span class="sms-tab">通话</span><span class="sms-tab">通讯录</span>
                </div>`;

            return {
                list: items
                    ? `${smsTopbar}<ul class="sms-conv-list">${items}</ul>`
                    : `<div class="sms-frame-empty">${emptyList}</div>`,
                chats,
            };
        },
    };
}