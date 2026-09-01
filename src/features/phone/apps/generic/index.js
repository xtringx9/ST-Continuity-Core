// 通用聊天 App 皮肤（apps/ 注册表第一个成员）
//
// 职责：提供「会话列表」与「聊天窗口」两段 HTML，视觉与手机外壳统一。
// 契约（详见 apps/index.js）：renderAppHtml(conversations) → { list, chats }
// 本皮肤为最小可用集：会话列表（头像+标题+时间+预览）+ 聊天窗口（左右气泡 + 时间水印）。
// 气泡类型（text/voice/img/money/loc/call/file）由 messageTypes.js 卡片化渲染。
import { skinIcon, uiIcon } from '../icons.js';
import { renderMessageContent } from '../messageTypes.js';
import { groupByDate, dateDivider, chatComposer, chatHeader, fmtTime, msgClock, mergeChatParts } from '../chatChrome.js';

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
 * 单条消息气泡（text 型；其余 type 由 renderMessageContent 卡片化渲染）
 * meta.merged 收紧间距；meta.last=false 为组内中间消息不显示时间
 * @param {Object} m { from, content, time, type, isMine }
 * @param {Object} [meta]
 * @returns {string}
 */
function bubble(m, meta) {
    const content = renderMessageContent(m);
    const time = meta && meta.last === false ? '' : (m.time ? `<div class="g-msg-time pm-time-inline">${escapeHtml(msgClock(m.time))}</div>` : '');
    const cls = meta && meta.merged ? ' merged' : '';
    return `<div class="g-msg ${m.isMine ? 'mine' : 'theirs'}${cls}">
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
        iconKey: 'generic',
        iconBg: '#4f8cff',
        cssPath: 'src/features/phone/apps/generic/generic.css',

        /**
         * 渲染 App 内的会话列表 + 各会话聊天窗口
         * @param {Array} conversations [{ key, title, preview, messages: [{from,content,time,type,isMine}] }]
         * @returns {{ list: string, chats: string }}
         */
        renderAppHtml(conversations) {
            const items = conversations.map((conv, i) => {
                const title = escapeHtml(conv.title || '未命名会话');
                const preview = escapeHtml((conv.preview || '').slice(0, 30));
                const lastMsg = conv.messages[conv.messages.length - 1];
                const time = lastMsg && lastMsg.time ? escapeHtml(fmtTime(lastMsg.time, true)) : '';
                const initial = escapeHtml((conv.title || '?').slice(0, 1));
                return `<li class="g-conv" data-conv="${i}">
                    <span class="g-avatar">${initial}</span>
                    <div class="g-conv-main">
                        <div class="g-conv-line1">
                            <span class="g-conv-title">${title}</span>
                            <span class="g-conv-time">${time}</span>
                        </div>
                        <div class="g-conv-preview">${preview}</div>
                    </div>
                </li>`;
            }).join('');

            const chats = conversations.map((conv, i) => {
                const parts = mergeChatParts(groupByDate(conv.messages)).map((p) => p.kind === 'date'
                    ? dateDivider('g', p.date)
                    : bubble(p.msg, p)).join('');
                return `<div class="g-chat" data-conv="${i}" hidden>
                    ${chatHeader('g', escapeHtml(conv.title || '会话'))}
                    <div class="g-msgs">${parts || '<div class="g-empty">暂无消息</div>'}</div>
                    ${chatComposer('g')}
                </div>`;
            }).join('');

            // 会话列表为空：显示完整 App 界面（顶栏 + 空态 + 底部标签栏），而非技术性提示
            const gTopbar = `<div class="g-topbar">
                <span class="g-topbar-title">聊天</span>
                <span class="g-topbar-icons">
                    <button class="g-topbar-icon" type="button" title="搜索">${uiIcon('search', 20)}</button>
                    <button class="g-topbar-icon" type="button" title="新建">${uiIcon('plus', 20)}</button>
                </span>
            </div>`;
            // 通用聊天底部标签栏（有内容/空态共用；品牌蓝 active）
            const gTabbar = `<div class="g-tabbar">
                <span class="g-tab active">${uiIcon('bubble', 22)}<span>消息</span></span>
                <span class="g-tab">${uiIcon('contacts', 22)}<span>联系人</span></span>
                <span class="g-tab">${uiIcon('timeline', 22)}<span>动态</span></span>
                <span class="g-tab">${uiIcon('gear', 22)}<span>设置</span></span>
            </div>`;
            const emptyList = `${gTopbar}
                <div class="g-emptybody">
                    <div class="g-empty-icon" style="background:#4f8cff">${skinIcon('generic')}</div>
                    <div class="g-empty-msg">暂无会话</div>
                </div>
                ${gTabbar}`;

            return {
                list: items
                    ? `${gTopbar}<ul class="g-conv-list">${items}</ul>${gTabbar}`
                    : `<div class="g-frame-empty">${emptyList}</div>`,
                chats,
            };
        },
    };
}