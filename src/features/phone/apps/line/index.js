// LINE App 皮肤（LINE 风格：绿色品牌顶栏 + 白色圆角会话卡 + 圆角气泡）
//
// 契约（见 apps/index.js）：renderAppHtml(conversations) → { list, chats }
// 皮肤只管内容，外壳层负责导航；会话卡展示群成员（mems），聊天窗口气泡左右两侧。
import { skinIcon, uiIcon } from '../icons.js';
import { renderMessageContent } from '../messageTypes.js';
import { groupByDate, dateDivider, chatComposer, chatHeader, fmtTime, msgClock, mergeChatParts } from '../chatChrome.js';

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

/** 单条消息气泡（左右布局 + 时间贴气泡底部；meta.merged 收紧间距，meta.last=false 为组内中间消息不显示时间） */
function bubble(m, groupConv, meta) {
    const mine = m.isMine ? 'mine' : 'theirs';
    const content = renderMessageContent(m);
    const time = meta && meta.last === false ? '' : (m.time ? `<div class="ln-time pm-time-inline">${esc(msgClock(m.time))}</div>` : '');
    const name = !m.isMine && groupConv && m.from ? `<div class="ln-name">${esc(m.from)}</div>` : '';
    const cls = meta && meta.merged ? ' merged' : '';
    return `<div class="ln-msg ${mine}${cls}">
        <span class="ln-avatar">${initial(m.isMine ? '我' : m.from)}</span>
        <div class="ln-body">
            ${name}
            <div class="ln-bubble">${content}</div>
            ${time}
        </div>
    </div>`;
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
                const lastMsg = conv.messages[conv.messages.length - 1];
                const time = lastMsg && lastMsg.time ? esc(fmtTime(lastMsg.time, true)) : '';
                const group = isGroupConversation(conv);
                // 成员首字串联（群聊体现成员多，私聊就一个头像）
                const memberChips = group && conv.members && conv.members.length > 1
                    ? conv.members.slice(0, 3).map((mm) => `<span class="ln-mini">${initial(mm)}</span>`).join('')
                    : `<span class="ln-mini">${initial(title)}</span>`;
                return `<li class="ln-conv" data-conv="${i}">
                    <span class="ln-avatar">${initial(title)}</span>
                    <div class="ln-conv-main">
                        <div class="ln-conv-line1">
                            <span class="ln-conv-title">${title}${group ? ' · 群' : ''}</span>
                            <span class="ln-conv-time">${time}</span>
                        </div>
                        <div class="ln-conv-preview">${preview}</div>
                        <div class="ln-membox">${memberChips}</div>
                    </div>
                </li>`;
            }).join('');

            const chats = conversations.map((conv, i) => {
                const group = isGroupConversation(conv);
                const parts = mergeChatParts(groupByDate(conv.messages)).map((p) => p.kind === 'date'
                    ? dateDivider('ln', p.date)
                    : bubble(p.msg, group, p)).join('');
                return `<div class="ln-chat" data-conv="${i}" hidden>
                    ${chatHeader('ln', esc(conv.title || '会话'))}
                    <div class="ln-msgs">${parts || '<div class="ln-empty">暂无消息</div>'}</div>
                    ${chatComposer('ln')}
                </div>`;
            }).join('');

            // LINE 风格顶部导航（列表态与空态共用）：标题 + 右侧按钮
            const lnTopbar = `<div class="ln-topbar">
                <span class="ln-topbar-title">LINE</span>
                <span class="ln-topbar-icons">
                    <button class="ln-topbar-icon" type="button" title="搜索">${uiIcon('search', 20)}</button>
                    <button class="ln-topbar-icon" type="button" title="新建">${uiIcon('plus', 20)}</button>
                </span>
            </div>`;

            // LINE 底部标签栏（有内容/空态共用；品牌绿 active，顺序贴近真 LINE：主页/好友/聊天/动态/设置 取 4 个）
            const lnTabbar = `<div class="ln-tabbar">
                <span class="ln-tab active">${uiIcon('contacts', 22)}<span>好友</span></span>
                <span class="ln-tab">${uiIcon('bubble', 22)}<span>聊天</span></span>
                <span class="ln-tab">${uiIcon('timeline', 22)}<span>动态</span></span>
                <span class="ln-tab">${uiIcon('gear', 22)}<span>设置</span></span>
            </div>`;

            const emptyList = `${lnTopbar}
                <div class="ln-emptybody">
                    <div class="ln-empty-icon" style="background:#06c755">${skinIcon('line')}</div>
                    <div class="ln-empty-msg">暂无会话</div>
                </div>
                ${lnTabbar}`;

            return {
                list: items
                    ? `${lnTopbar}<ul class="ln-conv-list">${items}</ul>${lnTabbar}`
                    : `<div class="ln-frame-empty">${emptyList}</div>`,
                chats,
            };
        },
    };
}