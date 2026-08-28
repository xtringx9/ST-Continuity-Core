// 微信 App 皮肤（微信风格：深色渐变顶栏 + 圆形头像 + 左右气泡）
//
// 契约（见 apps/index.js）：renderAppHtml(conversations) → { list, chats }
//   list: 会话列表（圆形头像 + 名称 + 预览），每个可点击项带 data-conv=索引
//   chats: 各会话聊天窗口（顶栏 + 消息流），默认 hidden，带 data-conv=索引
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

/** 头像首字 */
function initial(name) {
    const s = String(name || '?');
    const m = s.trim();
    return esc(m.slice(0, 1) || '?');
}

/** 群聊判定：无 dm 字段（grp 有值）的消息归为群聊；这里用消息中是否出现过 grp 简化处理 */
function isGroupConversation(conv) {
    return conv.messages.some((m) => m.grp);
}

/** 群聊头像：成员首字 2×2 小方块堆叠（微信风格九宫格简化版） */
function groupAvatar(members) {
    const initials = (members || []).map(initial).filter(Boolean);
    const seen = new Set();
    const uniq = initials.filter((c) => !seen.has(c) && seen.add(c));
    const cells = uniq.slice(0, 3).map((c) => `<span class="wx-mini">${esc(c)}</span>`).join('');
    const more = uniq.length > 3 ? `<span class="wx-mini">+${uniq.length - 3}</span>` : '';
    return `<span class="wx-gavatar">${cells}${more}</span>`;
}

/** 单条消息气泡（左右布局 + 时间贴气泡底部） */
function bubble(m, groupConv) {
    const mine = m.isMine ? 'mine' : 'theirs';
    const content = renderMessageContent(m);
    const time = m.time ? `<div class="wx-time pm-time-inline">${esc(msgClock(m.time))}</div>` : '';
    // 群聊对方消息显示发送者名（自己/私聊不显示）
    const name = !m.isMine && groupConv && m.from ? `<div class="wx-name">${esc(m.from)}</div>` : '';
    const avatar = `<span class="wx-avatar">${initial(m.isMine ? '我' : m.from)}</span>`;
    // 头像固定放最前，视觉位置由 CSS order 决定（theirs=左，mine=右）
    return `<div class="wx-msg ${mine}">
        ${avatar}
        <div class="wx-body">
            ${name}
            <div class="wx-bubble">${content}</div>
            ${time}
        </div>
    </div>`;
}

export function buildWechatSkin() {
    return {
        id: 'wechat',
        label: '微信',
        iconKey: 'wechat',
        iconBg: '#07c160',
        cssPath: 'src/features/phone/apps/wechat/wechat.css',

        renderAppHtml(conversations) {
            const items = conversations.map((conv, i) => {
                const title = esc(conv.title || '未命名会话');
                const preview = esc((conv.preview || '').slice(0, 26));
                const lastMsg = conv.messages[conv.messages.length - 1];
                const time = lastMsg && lastMsg.time ? esc(fmtTime(lastMsg.time, true)) : '';
                const group = isGroupConversation(conv);
                return `<li class="wx-conv" data-conv="${i}">
                    ${group ? groupAvatar(conv.members) : `<span class="wx-avatar">${initial(title)}</span>`}
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
                const parts = groupByDate(conv.messages).map((p) => p.kind === 'date'
                    ? dateDivider('wx', p.date)
                    : bubble(p.msg, group)).join('');
                return `<div class="wx-chat" data-conv="${i}" hidden>
                    ${chatHeader('wx', esc(conv.title || '会话'))}
                    <div class="wx-msgs">${parts || '<div class="wx-empty">暂无消息</div>'}</div>
                    ${chatComposer('wx')}
                </div>`;
            }).join('');

            // 微信风格顶部导航（列表态与空态共用）：标题 + 搜索/加号
            const wxTopbar = `<div class="wx-topbar">
                <span class="wx-topbar-title">微信</span>
                <span class="wx-topbar-icons">
                    <button class="wx-topbar-icon" type="button" title="搜索">${uiIcon('search', 20)}</button>
                    <button class="wx-topbar-icon" type="button" title="新建">${uiIcon('plus', 20)}</button>
                </span>
            </div>`;

            const emptyList = `${wxTopbar}
                <div class="wx-emptybody">
                    <div class="wx-empty-icon" style="background:#07c160">${skinIcon('wechat')}</div>
                    <div class="wx-empty-msg">暂无会话</div>
                </div>
                <div class="wx-tabbar">
                    <span class="wx-tab active">微信</span><span class="wx-tab">通讯录</span><span class="wx-tab">发现</span><span class="wx-tab">我</span>
                </div>`;

            return {
                list: items
                    ? `${wxTopbar}<ul class="wx-conv-list">${items}</ul>`
                    : `<div class="wx-frame-empty">${emptyList}</div>`,
                chats,
            };
        },
    };
}