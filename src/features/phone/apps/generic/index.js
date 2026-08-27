// 通用聊天 App 皮肤（apps/ 注册表第一个成员）
//
// 职责：提供「会话列表」与「聊天窗口」两段 HTML，视觉与手机外壳（像素皮）统一。
// 契约（详见 apps/index.js）：renderAppHtml(conversations) → { list, chats }
// 本皮肤为最小可用集：会话列表（头像+标题+预览）+ 聊天窗口（左右气泡 + 时间水印）。
// 气泡类型暂只做 text（type 细分留待后续 skin 或本皮肤扩展）。
import { skinIcon } from '../icons.js';
import { renderMessageContent } from '../messageTypes.js';
import { groupByDate, dateDivider, chatComposer, chatHeader } from '../chatChrome.js';

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
    const content = renderMessageContent(m);
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
                const parts = groupByDate(conv.messages).map((p) => p.kind === 'date'
                    ? dateDivider('g', p.date)
                    : bubble(p.msg)).join('');
                return `<div class="g-chat" data-conv="${i}" hidden>
                    ${chatHeader('g', escapeHtml(conv.title || '会话'))}
                    <div class="g-msgs">${parts || '<div class="g-empty">暂无消息</div>'}</div>
                    ${chatComposer('g')}
                </div>`;
            }).join('');

            // 会话列表为空：显示完整 App 界面（顶栏 + 空态 + 底部标签栏），而非技术性提示
            const emptyList = `<div class="g-topbar"><span class="g-topbar-title">聊天</span></div>
                <div class="g-emptybody">
                    <div class="g-empty-icon" style="background:#4f8cff">${skinIcon('generic')}</div>
                    <div class="g-empty-msg">暂无会话</div>
                </div>
                <div class="g-tabbar">
                    <span class="g-tab active">消息</span><span class="g-tab">联系人</span><span class="g-tab">动态</span><span class="g-tab">设置</span>
                </div>`;

            return {
                list: items
                    ? `<ul class="g-conv-list">${items}</ul>`
                    : `<div class="g-frame-empty">${emptyList}</div>`,
                chats,
            };
        },
    };
}