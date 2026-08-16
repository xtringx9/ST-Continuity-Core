// src/features/chat-reader/ChatReader.js
// 图文阅读器（父窗口驱动，操作 iframe 的 doc）。
//
// 架构：与 module-editor / nai-preset-switcher 同构——iframe 只承载静态 HTML+CSS，
// 所有 JS 在本模块（父窗口）运行，EntryButton 打开抽屉后调用 initChatReader(doc)。
// 因此可直接 import ST 的 chat / messageFormatting / getThumbnailUrl，
// 渲染产物与酒馆聊天页逐字节一致（同一套 showdown+DOMPurify+正则管线）。
//
// 交互：
//   1) 懒加载：只渲染「当前楼 ± RENDER_WINDOW」的楼层，滚动到上下边缘时扩展窗口；
//   2) 翻页：底部上一楼/下一楼 + 顶部楼层输入跳转；当前楼高亮、翻页后 scrollTo；
//   3) 图片：mes.extra.image 非内嵌图单独展示（可点击放大），内嵌图保留在正文里。
//
// 主题：与其它编辑器一致，监听 storage 'st_continuity_theme' 同步 iframe data-theme。

import { chat, characters, user_avatar, chat_metadata, messageFormatting, getThumbnailUrl } from '../../../../../../../script.js';
import { debugLog, errorLog, infoLog } from '../../utils/logger.js';

const LOG_TAG = '[ChatReader]';

// 懒加载窗口：当前楼前后各渲染的楼层数
const RENDER_WINDOW = 5;
// 距上下边缘多少 px 时扩展窗口
const EXPAND_THRESHOLD = 600;

let doc = null;
let bodyEl = null;
let chatNameEl = null;
let floorInput = null;
let floorInfo = null;
let prevBtn = null;
let nextBtn = null;
let prevNameEl = null;
let nextNameEl = null;
let currentNameEl = null;

let renderedStart = -1; // 当前已渲染楼层范围 [renderedStart, renderedEnd]
let renderedEnd = -1;
let currentFloor = 0; // 当前阅读楼
let scrollRafPending = false;
let lightboxEl = null;

/**
 * 初始化阅读器（入口，由 EntryButton 在 iframe 加载后调用，幂等）。
 * @param {Document} iframeDoc
 */
export function initChatReader(iframeDoc) {
    if (!iframeDoc || iframeDoc === doc) {
        // 同 doc 重复调用：仅刷新数据（聊天可能已切换）
        if (iframeDoc && iframeDoc === doc) {
            refreshData();
        }
        return;
    }
    doc = iframeDoc;

    bodyEl = doc.getElementById('reader-body');
    chatNameEl = doc.getElementById('reader-chat-name');
    floorInput = doc.getElementById('reader-floor-input');
    floorInfo = doc.getElementById('reader-floor-info');
    prevBtn = doc.getElementById('reader-prev');
    nextBtn = doc.getElementById('reader-next');
    prevNameEl = doc.getElementById('reader-prev-name');
    nextNameEl = doc.getElementById('reader-next-name');
    currentNameEl = doc.getElementById('reader-current-name');

    if (!bodyEl || !prevBtn || !nextBtn) {
        errorLog(LOG_TAG, '阅读器 DOM 不完整，初始化失败');
        return;
    }

    // 底部翻页
    prevBtn.addEventListener('click', () => goToFloor(currentFloor - 1));
    nextBtn.addEventListener('click', () => goToFloor(currentFloor + 1));

    // 顶部楼层跳转
    const goBtn = doc.getElementById('reader-floor-go');
    if (goBtn) {
        goBtn.addEventListener('click', onFloorJump);
        floorInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') onFloorJump();
        });
    }

    // 关闭按钮：由父窗口 EntryButton 在 onLoad 绑定（对齐其它编辑器惯例），
    // 此处不重复绑定，避免双重关闭。

    // 懒加载：滚动到边缘扩展窗口
    bodyEl.addEventListener('scroll', onScroll, { passive: true });

    // 图片放大
    bodyEl.addEventListener('click', onBodyClick);

    // 主题同步（与其它编辑器一致）
    syncChatReaderTheme(doc);

    refreshData();
    infoLog(LOG_TAG, '阅读器初始化完成');
}

/**
 * 主题同步：继承父窗口的 st_continuity_theme，并监听 storage 事件。
 * @param {Document} iframeDoc
 */
export function syncChatReaderTheme(iframeDoc) {
    if (!iframeDoc) return;
    let theme = 'light';
    try { theme = localStorage.getItem('st_continuity_theme') || 'light'; } catch (e) { /* ignore */ }
    iframeDoc.documentElement.setAttribute('data-theme', theme);
    // 防重复注册
    if (!iframeDoc._ccReaderThemeBound) {
        iframeDoc._ccReaderThemeBound = true;
        const iframeWin = iframeDoc.defaultView;
        iframeWin?.addEventListener('storage', (e) => {
            if (e.key === 'st_continuity_theme') {
                iframeDoc.documentElement.setAttribute('data-theme', e.newValue || 'light');
            }
        });

        // 标题点击切换主题（复用 module-editor / nai 模式）
        const headerTitle = iframeDoc.querySelector('.header-title');
        if (headerTitle) {
            headerTitle.style.cursor = 'pointer';
            headerTitle.title = '点击切换主题';
            headerTitle.addEventListener('click', () => {
                const current = iframeDoc.documentElement.getAttribute('data-theme') || 'light';
                const next = current === 'light' ? 'dark' : 'light';
                iframeDoc.documentElement.setAttribute('data-theme', next);
                try { localStorage.setItem('st_continuity_theme', next); } catch (e) { /* ignore */ }
                iframeWin?.dispatchEvent(new CustomEvent('continuity-theme-change'));
            });
        }
    }
}

/**
 * 刷新数据：读取 ST 当前 chat，重建视图。
 */
function refreshData() {
    if (!doc) return;
    // 标题：聊天自定义标题优先，否则用 chatId（文件名）
    if (chatNameEl) {
        const name = chat_metadata?.title || getCurrentChatId() || '';
        chatNameEl.textContent = name ? `· ${name}` : '';
    }
    const total = Array.isArray(chat) ? chat.length : 0;
    if (total === 0) {
        bodyEl.innerHTML = '<div class="reader-empty"><div class="reader-empty-icon">📖</div><div>当前没有可阅读的消息</div></div>';
        currentFloor = 0;
        renderedStart = -1;
        renderedEnd = -1;
        updateFloorInfo();
        updatePrevNextButtons();
        return;
    }
    // 定位当前楼：默认最后一条（最新），保持阅读从最新开始
    currentFloor = total - 1;
    renderedStart = -1;
    renderedEnd = -1;
    // 清空占位符（若有）
    bodyEl.querySelectorAll('.reader-placeholder').forEach(el => el.remove());
    renderWindow();
}

/**
 * 计算应渲染的窗口范围（围绕 currentFloor，上下各 RENDER_WINDOW 楼）。
 * @returns {{start:number, end:number}}
 */
function computeWindow() {
    const total = chat.length;
    const start = Math.max(0, currentFloor - RENDER_WINDOW);
    const end = Math.min(total - 1, currentFloor + RENDER_WINDOW);
    return { start, end };
}

/**
 * 渲染窗口：把 [renderedStart, renderedEnd] 对齐到目标范围，
 * 多出的移除、缺少的补齐（补齐用「重建整段」保证顺序与结构一致）。
 * 懒加载核心：用文本占位符标记尚未渲染的楼层。
 */
function renderWindow() {
    if (!doc || !chat || chat.length === 0) return;
    const { start, end } = computeWindow();

    // 简单策略：重建整个 reader-body（因为窗口只有 ~11 楼，重建成本可接受，
    // 且避免增量拼接的 DOM 顺序/事件复杂度）。
    // 优化：仅当窗口范围变化时才重建。
    if (start === renderedStart && end === renderedEnd) return;

    const total = chat.length;
    const frag = doc.createDocumentFragment();

    // 占位符 + 已渲染楼混合
    for (let i = 0; i < total; i++) {
        if (i < start || i > end) {
            const ph = doc.createElement('div');
            ph.className = 'reader-placeholder';
            ph.dataset.floor = String(i);
            ph.textContent = `楼层 ${i}（点击跳转）`;
            ph.addEventListener('click', () => goToFloor(i));
            frag.appendChild(ph);
        } else {
            frag.appendChild(renderMessage(i));
        }
    }

    bodyEl.innerHTML = '';
    bodyEl.appendChild(frag);

    renderedStart = start;
    renderedEnd = end;

    updateCurrentHighlight();
    updateFloorInfo();
    updatePrevNextButtons();
    debugLog(LOG_TAG, `渲染窗口 [${start}, ${end}] / ${total}`);
}

/**
 * 渲染单条消息。
 * @param {number} index
 * @returns {HTMLElement}
 */
function renderMessage(index) {
    const mes = chat[index];
    if (!mes) return doc.createElement('div');

    const card = doc.createElement('div');
    card.className = 'reader-message';
    card.dataset.floor = String(index);
    if (index === currentFloor) card.classList.add('reader-current');

    // ---- 头部：头像 + 名字 + 时间 ----
    const header = doc.createElement('div');
    header.className = 'reader-message-header';

    const avatar = doc.createElement('img');
    avatar.className = 'reader-avatar';
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.src = getAvatarUrl(mes);

    const name = doc.createElement('span');
    name.className = 'reader-msg-name';
    name.textContent = mes.name || (mes.is_user ? 'User' : 'Assistant');

    const meta = doc.createElement('span');
    meta.className = 'reader-msg-meta';
    meta.textContent = `#${index}`;

    header.append(avatar, name, meta);
    card.appendChild(header);

    // ---- 正文（复用 messageFormatting）----
    const text = doc.createElement('div');
    text.className = 'reader-msg-text';
    const isSystem = !!mes.is_system;
    let rawText = mes.extra?.display_text || mes.mes || '';
    try {
        text.innerHTML = messageFormatting(
            rawText,
            mes.name,
            isSystem,
            !!mes.is_user,
            index,
            {},
            false,
        );
    } catch (e) {
        errorLog(LOG_TAG, `楼层 ${index} 渲染失败:`, e);
        text.textContent = rawText;
    }
    card.appendChild(text);

    // ---- 图片（非内嵌图时单独展示）----
    const imgUrl = mes.extra?.image;
    if (imgUrl && !mes.extra?.inline_image) {
        const imgWrap = doc.createElement('div');
        imgWrap.className = 'reader-msg-image';
        const img = doc.createElement('img');
        img.src = imgUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('click', (e) => {
            e.stopPropagation();
            openLightbox(imgUrl);
        });
        imgWrap.appendChild(img);
        card.appendChild(imgWrap);
    }

    return card;
}

/**
 * 取消息头像 URL。
 * 消息本身带 force_avatar 优先；否则按角色/用户从 ST live binding 取。
 * @param {object} mes
 * @returns {string}
 */
function getAvatarUrl(mes) {
    try {
        if (mes.force_avatar) return mes.force_avatar;
        if (mes.is_user) {
            return user_avatar ? getThumbnailUrl('persona', user_avatar) : '';
        }
        // 角色头像：取当前角色（this_chid 语义 → characters[chid]）
        const chid = getCurrentChid();
        if (chid !== undefined && characters[chid]) {
            const av = characters[chid].avatar;
            if (av && av !== 'none') return getThumbnailUrl('avatar', av);
        }
        return '';
    } catch (e) {
        return '';
    }
}

/**
 * 取当前角色索引（等价 this_chid，ST 的 getContext 与 export 均可）。
 * @returns {string|undefined}
 */
function getCurrentChid() {
    try {
        const st = globalThis.SillyTavern;
        if (st && typeof st.getContext === 'function') {
            const ctx = st.getContext();
            if (ctx && typeof ctx.chid === 'string') return ctx.chid;
        }
    } catch (e) { /* ignore */ }
    return undefined;
}

/**
 * 取当前聊天 ID（用于标题显示）。
 * @returns {string}
 */
function getCurrentChatId() {
    try {
        const st = globalThis.SillyTavern;
        if (st && typeof st.getContext === 'function') {
            const ctx = st.getContext();
            if (typeof ctx.chatId === 'string' && ctx.chatId) return ctx.chatId;
            if (typeof ctx.getCurrentChatId === 'function') return ctx.getCurrentChatId() || '';
        }
    } catch (e) { /* ignore */ }
    return '';
}

/**
 * 跳转到指定楼层（夹在 [0, chat.length-1]）。
 * @param {number} floor
 */
function goToFloor(floor) {
    const total = chat?.length || 0;
    if (total === 0) return;
    const clamped = Math.max(0, Math.min(total - 1, floor));
    if (clamped === currentFloor) return;
    currentFloor = clamped;
    renderWindow();
    // 滚动到该楼
    scrollToFloor(clamped);
    updateCurrentHighlight();
}

/**
 * 滚动到指定楼层元素（对齐阅读区顶部）。
 * @param {number} floor
 */
function scrollToFloor(floor) {
    if (!bodyEl) return;
    const el = bodyEl.querySelector(`.reader-message[data-floor="${floor}"]`);
    if (el) {
        bodyEl.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    } else {
        // 尚未渲染：先渲染再滚
        currentFloor = floor;
        renderWindow();
        requestAnimationFrame(() => {
            const el2 = bodyEl.querySelector(`.reader-message[data-floor="${floor}"]`);
            if (el2) bodyEl.scrollTo({ top: el2.offsetTop - 8 });
        });
    }
}

/**
 * 更新当前楼高亮（body 内 .reader-current 唯一）。
 */
function updateCurrentHighlight() {
    if (!doc) return;
    doc.querySelectorAll('.reader-message.reader-current').forEach(el => {
        if (Number(el.dataset.floor) !== currentFloor) el.classList.remove('reader-current');
    });
    const cur = doc.querySelector(`.reader-message[data-floor="${currentFloor}"]`);
    if (cur) cur.classList.add('reader-current');
}

/**
 * 更新楼层信息 + 上一/下一楼名称。
 */
function updateFloorInfo() {
    const total = chat?.length || 0;
    if (floorInfo) floorInfo.textContent = total > 0 ? `${currentFloor + 1} / ${total}` : '';
    if (floorInput) floorInput.value = String(currentFloor);

    if (prevNameEl) prevNameEl.textContent = currentFloor > 0 ? `#${currentFloor - 1} ${getName(chat[currentFloor - 1])}` : '';
    if (nextNameEl) nextNameEl.textContent = currentFloor < total - 1 ? `#${currentFloor + 1} ${getName(chat[currentFloor + 1])}` : '';
    if (currentNameEl) currentNameEl.textContent = currentFloor >= 0 ? `#${currentFloor} ${getName(chat[currentFloor])}` : '';
}

function getName(mes) {
    return mes?.name || (mes?.is_user ? 'User' : 'Assistant');
}

function updatePrevNextButtons() {
    const total = chat?.length || 0;
    if (prevBtn) prevBtn.disabled = currentFloor <= 0;
    if (nextBtn) nextBtn.disabled = currentFloor >= total - 1;
}

/**
 * 顶部楼层跳转。
 */
function onFloorJump() {
    if (!floorInput) return;
    const val = parseInt(floorInput.value, 10);
    if (isNaN(val)) return;
    goToFloor(val);
}

/**
 * 滚动监听：接近上下边缘时扩展渲染窗口。
 */
function onScroll() {
    if (scrollRafPending) return;
    scrollRafPending = true;
    requestAnimationFrame(() => {
        scrollRafPending = false;
        handleScrollExpand();
    });
}

function handleScrollExpand() {
    if (!bodyEl || !chat || chat.length === 0) return;
    const total = chat.length;

    // 顶部附近：窗口上移（保持阅读位置不变）
    if (renderedStart > 0 && bodyEl.scrollTop < EXPAND_THRESHOLD) {
        const newStart = Math.max(0, renderedStart - RENDER_WINDOW);
        if (newStart !== renderedStart) {
            // 锚点：原首楼元素在渲染前的 offsetTop（相对 body 内容顶）
            const anchor = bodyEl.querySelector(`.reader-message[data-floor="${renderedStart}"]`);
            const anchorTop = anchor ? anchor.offsetTop : bodyEl.scrollTop;
            renderWindow();
            // 渲染后该元素上移了 N 个占位符高度，滚动补偿差值
            requestAnimationFrame(() => {
                const anchor2 = bodyEl.querySelector(`.reader-message[data-floor="${renderedStart}"]`);
                if (anchor2) {
                    const diff = anchor2.offsetTop - anchorTop;
                    bodyEl.scrollBy({ top: diff });
                }
            });
            return;
        }
    }
    // 底部附近：窗口下移
    if (renderedEnd < total - 1) {
        const maxScroll = bodyEl.scrollHeight - bodyEl.clientHeight;
        if (bodyEl.scrollTop > maxScroll - EXPAND_THRESHOLD) {
            const newEnd = Math.min(total - 1, renderedEnd + RENDER_WINDOW);
            if (newEnd !== renderedEnd) {
                renderWindow();
            }
        }
    }
}

/**
 * 点击 body：图片放大 / 放大后点击关闭。
 */
function onBodyClick(e) {
    const img = e.target.closest && e.target.closest('.reader-msg-image img');
    if (img) {
        openLightbox(img.src);
        return;
    }
    if (lightboxEl && lightboxEl.classList.contains('open')) {
        closeLightbox();
    }
}

function openLightbox(src) {
    if (!doc) return;
    if (!lightboxEl) {
        lightboxEl = doc.createElement('div');
        lightboxEl.className = 'reader-lightbox';
        lightboxEl.innerHTML = '<img alt="" />';
        lightboxEl.addEventListener('click', closeLightbox);
        doc.body.appendChild(lightboxEl);
    }
    lightboxEl.querySelector('img').src = src;
    lightboxEl.classList.add('open');
}

function closeLightbox() {
    if (lightboxEl) lightboxEl.classList.remove('open');
}
