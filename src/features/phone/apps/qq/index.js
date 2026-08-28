// QQ App 皮肤（QQ 风格：蓝白配色 + 圆形头像 + 蓝色系气泡）
//
// 契约（见 apps/index.js）：renderAppHtml(conversations) → { list, chats }
// 外壳层（phoneRenderer NAV_SCRIPT）负责 home ↔ App ↔ 会话 导航，皮肤只管内容。
import { skinIcon, uiIcon } from '../icons.js';
import { renderMessageContent } from '../messageTypes.js';
import { groupByDate, dateDivider, chatComposer, chatHeader, fmtTime, msgClock } from '../chatChrome.js';

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

/** 群聊判定 */
function isGroupConversation(conv) {
    return conv.messages.some((m) => m.grp);
}

/** 群聊头像：成员首字圆形堆叠（QQ 群头像风格） */
function groupAvatar(members) {
    const initials = (members || []).map(initial).filter(Boolean);
    const seen = new Set();
    const uniq = initials.filter((c) => !seen.has(c) && seen.add(c));
    const cells = uniq.slice(0, 3).map((c) => `<span class="qq-mini">${esc(c)}</span>`).join('');
    const more = uniq.length > 3 ? `<span class="qq-mini">+${uniq.length - 3}</span>` : '';
    return `<span class="qq-gavatar">${cells}${more}</span>`;
}

/** 单条消息气泡（左右布局 + 时间贴气泡底部） */
function bubble(m, groupConv) {
    const mine = m.isMine ? 'mine' : 'theirs';
    const content = renderMessageContent(m);
    const time = m.time ? `<div class="qq-time pm-time-inline">${esc(msgClock(m.time))}</div>` : '';
    const name = !m.isMine && groupConv && m.from ? `<div class="qq-name">${esc(m.from)}</div>` : '';
    const avatar = `<span class="qq-avatar">${initial(m.isMine ? '我' : m.from)}</span>`;
    return `<div class="qq-msg ${mine}">
        ${avatar}
        <div class="qq-body">
            ${name}
            <div class="qq-bubble">${content}</div>
            ${time}
        </div>
    </div>`;
}

export function buildQqSkin() {
    return {
        id: 'qq',
        label: 'QQ',
        iconKey: 'qq',
        iconBg: '#1f9af5',
        cssPath: 'src/features/phone/apps/qq/qq.css',

        renderAppHtml(conversations) {
            const items = conversations.map((conv, i) => {
                const title = esc(conv.title || '未命名会话');
                const preview = esc((conv.preview || '').slice(0, 26));
                const lastMsg = conv.messages[conv.messages.length - 1];
                const time = lastMsg && lastMsg.time ? esc(fmtTime(lastMsg.time, true)) : '';
                const group = isGroupConversation(conv);
                return `<li class="qq-conv" data-conv="${i}">
                    ${group ? groupAvatar(conv.members) : `<span class="qq-avatar">${initial(title)}</span>`}
                    <div class="qq-conv-main">
                        <div class="qq-conv-line1">
                            <span class="qq-conv-title">${title}</span>
                            <span class="qq-conv-time">${time}</span>
                        </div>
                        <div class="qq-conv-preview">${group ? '[群] ' : ''}${preview}</div>
                    </div>
                </li>`;
            }).join('');

            const chats = conversations.map((conv, i) => {
                const group = isGroupConversation(conv);
                const parts = groupByDate(conv.messages).map((p) => p.kind === 'date'
                    ? dateDivider('qq', p.date)
                    : bubble(p.msg, group)).join('');
                return `<div class="qq-chat" data-conv="${i}" hidden>
                    ${chatHeader('qq', esc(conv.title || '会话'))}
                    <div class="qq-msgs">${parts || '<div class="qq-empty">暂无消息</div>'}</div>
                    ${chatComposer('qq')}
                </div>`;
            }).join('');

            const qqTopbar = `<div class="qq-topbar">
                <span class="qq-topbar-title">QQ</span>
                <span class="qq-topbar-icons">
                    <button class="qq-topbar-icon" type="button" title="搜索">${uiIcon('search', 20)}</button>
                    <button class="qq-topbar-icon" type="button" title="新建">${uiIcon('plus', 20)}</button>
                </span>
            </div>`;

            // QQ 底部标签栏（有内容/空态共用；品牌蓝 active）
            const qqTabbar = `<div class="qq-tabbar">
                <span class="qq-tab active">${uiIcon('bubble', 22)}<span>消息</span></span>
                <span class="qq-tab">${uiIcon('contacts', 22)}<span>联系人</span></span>
                <span class="qq-tab">${uiIcon('timeline', 22)}<span>动态</span></span>
                <span class="qq-tab">${uiIcon('star', 22)}<span>空间</span></span>
            </div>`;

            const emptyList = `${qqTopbar}
                <div class="qq-emptybody">
                    <div class="qq-empty-icon" style="background:#1f9af5">${skinIcon('qq')}</div>
                    <div class="qq-empty-msg">暂无会话</div>
                </div>
                ${qqTabbar}`;

            return {
                list: items
                    ? `${qqTopbar}<ul class="qq-conv-list">${items}</ul>${qqTabbar}`
                    : `<div class="qq-frame-empty">${emptyList}</div>`,
                chats,
            };
        },
    };
}