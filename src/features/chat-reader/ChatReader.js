// src/features/chat-reader/ChatReader.js
// 图文阅读器（父窗口驱动，操作 iframe 的 doc）。
//
// 架构：与 module-editor / nai-preset-switcher 同构——iframe 只承载静态 HTML+CSS，
// 所有 JS 在本模块（父窗口）运行，EntryButton 打开抽屉后调用 initChatReader(doc)。
// 因此可直接 import ST 的 chat / characters / messageFormatting / getThumbnailUrl /
// getPastCharacterChats / getRequestHeaders，渲染产物与酒馆聊天页逐字节一致。
//
// 双视图：
//   1) 首页：角色 → 聊天 两级选择（不依赖当前打开的聊天，可浏览任意历史聊天）；
//     顶部「当前聊天」快捷入口直接进入当前打开会话的阅读。
//   2) 阅读视图：消息流 + 懒加载 + 翻页/跳楼 + 图片放大 + 主题切换。
//
// 主题：与其它编辑器一致，监听 storage 'st_continuity_theme' 同步 iframe data-theme。

import {
    chat,
    characters,
    user_avatar,
    messageFormatting,
    getThumbnailUrl,
    getPastCharacterChats,
    getRequestHeaders,
    getCurrentChatDetails,
} from '../../../../../../../script.js';
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
let backHomeBtn = null;

// 首页元素
let homeEl = null;
let charGridEl = null;
let chatListEl = null;
let charTitleEl = null;
let chatTitleEl = null;
let stepCharEl = null;
let stepChatEl = null;

let renderedStart = -1; // 当前已渲染楼层范围 [renderedStart, renderedEnd]
let renderedEnd = -1;
let currentFloor = 0; // 当前阅读楼
let scrollRafPending = false;
let lightboxEl = null;

// 当前阅读的聊天（非当前打开会话时，缓存已加载的消息）
let activeChatMessages = null;
// 当前阅读的角色对象（历史聊天用其头像；当前聊天时从 ST 上下文取）
let activeChar = null;

/**
 * 初始化阅读器（入口，由 EntryButton 在 iframe 加载后调用，幂等）。
 * @param {Document} iframeDoc
 */
export function initChatReader(iframeDoc) {
    if (!iframeDoc || iframeDoc === doc) {
        // 同 doc 重复调用：回到首页（keepAlive 重开抽屉时刷新）
        if (iframeDoc && iframeDoc === doc) {
            showHome();
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
    backHomeBtn = doc.getElementById('reader-back-home');
    homeEl = doc.getElementById('reader-home');
    charGridEl = doc.getElementById('reader-char-grid');
    chatListEl = doc.getElementById('reader-chat-list');
    charTitleEl = doc.getElementById('reader-char-title');
    chatTitleEl = doc.getElementById('reader-chat-title');
    stepCharEl = doc.getElementById('reader-step-char');
    stepChatEl = doc.getElementById('reader-step-chat');

    if (!bodyEl || !prevBtn || !nextBtn || !homeEl) {
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

    // 返回首页
    if (backHomeBtn) {
        backHomeBtn.addEventListener('click', showHome);
    }

    // 关闭按钮：由父窗口 EntryButton 在 onLoad 绑定（对齐其它编辑器惯例），
    // 此处不重复绑定，避免双重关闭。

    // 懒加载：滚动到边缘扩展窗口
    bodyEl.addEventListener('scroll', onScroll, { passive: true });

    // 图片放大
    bodyEl.addEventListener('click', onBodyClick);

    // 主题同步（与其它编辑器一致）
    syncChatReaderTheme(doc);

    showHome();
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

/* =====================================================
 * 首页：角色 → 聊天 选择
 * ===================================================== */

/**
 * 显示首页（角色网格）。keepAlive 重开 / 返回首页时调用。
 */
function showHome() {
    if (!doc) return;

    // 切换视图状态：首页显示，阅读视图隐藏
    homeEl.style.display = '';
    bodyEl.style.display = 'none';
    const footer = doc.getElementById('reader-footer');
    if (footer) footer.style.display = 'none';
    if (backHomeBtn) backHomeBtn.style.display = 'none';
    if (floorInput) floorInput.style.display = 'none';
    if (floorInfo) floorInfo.style.display = 'none';
    const goBtn = doc.getElementById('reader-floor-go');
    if (goBtn) goBtn.style.display = 'none';
    if (chatNameEl) chatNameEl.textContent = '';

    // 重置阅读上下文，避免历史聊天状态残留
    activeChatMessages = null;
    activeChar = null;

    // 重置聊天选择步骤
    stepChatEl.style.display = 'none';
    stepCharEl.style.display = '';

    renderCharacterGrid();
}

/**
 * 渲染角色网格（含「当前聊天」快捷入口）。
 */
function renderCharacterGrid() {
    if (!charGridEl) return;
    const frag = doc.createDocumentFragment();

    // 快捷入口：当前打开的聊天
    const current = getCurrentChatDetails();
    const hasCurrent = !!current?.characterName && !!current?.sessionName;
    if (hasCurrent) {
        const card = doc.createElement('div');
        card.className = 'reader-char-card reader-char-current';
        const avatar = doc.createElement('img');
        avatar.className = 'reader-char-avatar';
        avatar.alt = '';
        avatar.src = current.avatarImgURL || '';
        const name = doc.createElement('div');
        name.className = 'reader-char-name';
        name.textContent = `${current.characterName}`;
        const sub = doc.createElement('div');
        sub.className = 'reader-char-sub';
        sub.textContent = `当前聊天：${current.sessionName}`;
        card.append(avatar, name, sub);
        card.addEventListener('click', () => openCurrentChat());
        frag.appendChild(card);
    }

    // 所有角色
    const chars = Array.isArray(characters) ? characters : [];
    chars.forEach((char, idx) => {
        const card = doc.createElement('div');
        card.className = 'reader-char-card';
        const avatar = doc.createElement('img');
        avatar.className = 'reader-char-avatar';
        avatar.alt = '';
        avatar.loading = 'lazy';
        let avUrl = '';
        try { avUrl = char.avatar && char.avatar !== 'none' ? getThumbnailUrl('avatar', char.avatar) : ''; } catch (e) { avUrl = ''; }
        avatar.src = avUrl;
        const name = doc.createElement('div');
        name.className = 'reader-char-name';
        name.textContent = char.name || `角色 ${idx}`;
        const sub = doc.createElement('div');
        sub.className = 'reader-char-sub';
        sub.textContent = char.description ? (char.description.replace(/[#*>\n]/g, '').slice(0, 20) || '') : '';
        card.append(avatar, name, sub);
        card.addEventListener('click', () => selectCharacter(idx));
        frag.appendChild(card);
    });

    charGridEl.innerHTML = '';
    charGridEl.appendChild(frag);

    if (charTitleEl) charTitleEl.textContent = hasCurrent ? '选择角色（含当前聊天快捷入口）' : '选择角色';
}

/**
 * 选择角色：加载其聊天列表。
 * @param {number} characterId
 */
async function selectCharacter(characterId) {
    if (!characters[characterId]) return;
    const char = characters[characterId];

    if (chatTitleEl) chatTitleEl.textContent = `选择聊天（${char.name}）`;
    if (chatListEl) chatListEl.innerHTML = '<div class="reader-loading">加载聊天列表…</div>';

    stepCharEl.style.display = 'none';
    stepChatEl.style.display = '';

    try {
        const chats = await getPastCharacterChats(characterId);
        renderChatList(chats, characterId);
    } catch (e) {
        errorLog(LOG_TAG, '加载角色聊天列表失败:', e);
        if (chatListEl) chatListEl.innerHTML = '<div class="reader-loading reader-loading-error">加载失败，请重试</div>';
    }
}

/**
 * 渲染聊天列表。
 * @param {Array} chats getPastCharacterChats 返回的聊天元数据数组
 * @param {number} characterId
 */
function renderChatList(chats, characterId) {
    if (!chatListEl) return;
    const char = characters[characterId];
    const frag = doc.createDocumentFragment();

    if (!Array.isArray(chats) || chats.length === 0) {
        chatListEl.innerHTML = '<div class="reader-loading">该角色暂无聊天记录</div>';
        return;
    }

    chats.forEach((chatMeta) => {
        const item = doc.createElement('div');
        item.className = 'reader-chat-item interactable';
        item.title = `file: ${chatMeta.file_name}`;

        const name = doc.createElement('div');
        name.className = 'reader-chat-name';
        const fileName = String(chatMeta.file_name || '').replace(/\.jsonl$/i, '');
        name.textContent = fileName;

        const meta = doc.createElement('div');
        meta.className = 'reader-chat-meta';
        meta.textContent = [
            chatMeta.last_mes ? `最后消息 ${formatChatTime(chatMeta.last_mes)}` : '',
            chatMeta.file_size ? chatMeta.file_size : '',
        ].filter(Boolean).join(' · ');

        item.append(name, meta);
        item.addEventListener('click', () => openChatFromFiles(fileName, char));
        frag.appendChild(item);
    });

    chatListEl.innerHTML = '';
    chatListEl.appendChild(frag);
}

/**
 * 打开非当前聊天（从文件加载消息）。
 * ⚠️ 不能用 ST 的 getChatsFromFiles（它内部写死用当前打开角色 characters[context.characterId]
 *    请求，加载别的角色聊天会取错数据）；这里直接 fetch /api/chats/get，用目标角色参数。
 * @param {string} chatName 聊天文件名（不含扩展名）
 * @param {object} char 角色对象
 */
async function openChatFromFiles(chatName, char) {
    if (!chatName) return;
    try {
        const messages = await fetchChatByCharacter(chatName, char);
        if (!Array.isArray(messages)) {
            if (chatListEl) chatListEl.innerHTML = '<div class="reader-loading reader-loading-error">加载失败，请重试</div>';
            return;
        }
        activeChatMessages = messages;
        activeChar = char;
        enterReadingView(messages, chatName);
    } catch (e) {
        errorLog(LOG_TAG, '加载聊天消息失败:', e);
        if (chatListEl) chatListEl.innerHTML = '<div class="reader-loading reader-loading-error">加载失败，请重试</div>';
    }
}

/**
 * 按目标角色加载指定聊天消息（等价 ST 的 getChatsFromFiles，但指定角色而非当前打开角色）。
 * @param {string} chatName 聊天文件名（不含扩展名）
 * @param {object} char 角色对象
 * @returns {Promise<Array|null>} 消息数组（首条元数据已移除）；失败返回 null
 */
async function fetchChatByCharacter(chatName, char) {
    if (!char) return null;
    const response = await fetch('/api/chats/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ch_name: char.name,
            file_name: chatName,
            avatar_url: char.avatar,
        }),
        cache: 'no-cache',
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data)) return null;
    // 移除首条元数据（与 ST getChatsFromFiles 一致）
    return data.slice(1);
}

/**
 * 打开当前打开的聊天（直接用 ST 的 chat live binding）。
 */
function openCurrentChat() {
    if (!Array.isArray(chat) || chat.length === 0) {
        if (charGridEl) charGridEl.innerHTML = '<div class="reader-loading">当前聊天为空</div>';
        return;
    }
    activeChatMessages = chat;
    const details = getCurrentChatDetails();
    activeChar = null; // 当前聊天用 ST 上下文取当前角色
    enterReadingView(chat, details?.sessionName || '当前聊天');
}

/* =====================================================
 * 阅读视图
 * ===================================================== */

/**
 * 进入阅读视图。
 * @param {Array} messages 聊天消息数组
 * @param {string} title 标题（聊天名）
 */
function enterReadingView(messages, title) {
    if (!doc) return;
    // 切换视图状态：首页隐藏，阅读视图显示
    homeEl.style.display = 'none';
    bodyEl.style.display = '';
    const footer = doc.getElementById('reader-footer');
    if (footer) footer.style.display = '';
    if (backHomeBtn) backHomeBtn.style.display = '';
    if (floorInput) floorInput.style.display = '';
    if (floorInfo) floorInfo.style.display = '';
    const goBtn = doc.getElementById('reader-floor-go');
    if (goBtn) goBtn.style.display = '';
    if (chatNameEl) chatNameEl.textContent = title ? `· ${title}` : '';

    currentFloor = messages.length - 1;
    renderedStart = -1;
    renderedEnd = -1;
    activeChatMessages = messages;
    renderWindow();
}

/**
 * 读取当前应渲染的消息源（当前聊天或已加载的历史聊天）。
 */
function getMessages() {
    return activeChatMessages && activeChatMessages.length > 0 ? activeChatMessages : chat;
}

/**
 * 计算应渲染的窗口范围（围绕 currentFloor，上下各 RENDER_WINDOW 楼）。
 * @returns {{start:number, end:number}}
 */
function computeWindow() {
    const total = getMessages().length;
    const start = Math.max(0, currentFloor - RENDER_WINDOW);
    const end = Math.min(total - 1, currentFloor + RENDER_WINDOW);
    return { start, end };
}

/**
 * 渲染窗口：把 [renderedStart, renderedEnd] 对齐到目标范围。
 * 懒加载核心：用文本占位符标记尚未渲染的楼层。
 */
function renderWindow() {
    if (!doc) return;
    const messages = getMessages();
    if (!messages || messages.length === 0) return;
    const { start, end } = computeWindow();

    if (start === renderedStart && end === renderedEnd) return;

    const total = messages.length;
    const frag = doc.createDocumentFragment();

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
    const messages = getMessages();
    const mes = messages[index];
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
 * @param {object} mes
 * @returns {string}
 */
function getAvatarUrl(mes) {
    try {
        if (mes.force_avatar) return mes.force_avatar;
        if (mes.is_user) {
            return user_avatar ? getThumbnailUrl('persona', user_avatar) : '';
        }
        // 历史聊天：用当前阅读角色 activeChar 的头像；当前聊天：用 ST 当前角色
        if (activeChar) {
            if (activeChar.avatar && activeChar.avatar !== 'none') return getThumbnailUrl('avatar', activeChar.avatar);
            return '';
        }
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
 * 取当前角色索引。
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
 * 跳转到指定楼层（夹在 [0, total-1]）。
 * @param {number} floor
 */
function goToFloor(floor) {
    const messages = getMessages();
    const total = messages?.length || 0;
    if (total === 0) return;
    const clamped = Math.max(0, Math.min(total - 1, floor));
    if (clamped === currentFloor) return;
    currentFloor = clamped;
    renderWindow();
    scrollToFloor(clamped);
    updateCurrentHighlight();
}

/**
 * 滚动到指定楼层元素。
 * @param {number} floor
 */
function scrollToFloor(floor) {
    if (!bodyEl) return;
    const el = bodyEl.querySelector(`.reader-message[data-floor="${floor}"]`);
    if (el) {
        bodyEl.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    } else {
        currentFloor = floor;
        renderWindow();
        requestAnimationFrame(() => {
            const el2 = bodyEl.querySelector(`.reader-message[data-floor="${floor}"]`);
            if (el2) bodyEl.scrollTo({ top: el2.offsetTop - 8 });
        });
    }
}

/**
 * 更新当前楼高亮。
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
 * 更新楼层信息 + 上/下一楼名称。
 */
function updateFloorInfo() {
    const messages = getMessages();
    const total = messages?.length || 0;
    if (floorInfo) floorInfo.textContent = total > 0 ? `${currentFloor + 1} / ${total}` : '';
    if (floorInput) floorInput.value = String(currentFloor);

    if (prevNameEl) prevNameEl.textContent = currentFloor > 0 ? `#${currentFloor - 1} ${getName(messages[currentFloor - 1])}` : '';
    if (nextNameEl) nextNameEl.textContent = currentFloor < total - 1 ? `#${currentFloor + 1} ${getName(messages[currentFloor + 1])}` : '';
    if (currentNameEl) currentNameEl.textContent = currentFloor >= 0 ? `#${currentFloor} ${getName(messages[currentFloor])}` : '';
}

function getName(mes) {
    return mes?.name || (mes?.is_user ? 'User' : 'Assistant');
}

function updatePrevNextButtons() {
    const messages = getMessages();
    const total = messages?.length || 0;
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
    if (!bodyEl) return;
    const messages = getMessages();
    if (!messages || messages.length === 0) return;
    const total = messages.length;

    // 顶部附近：窗口上移（保持阅读位置不变）
    if (renderedStart > 0 && bodyEl.scrollTop < EXPAND_THRESHOLD) {
        const newStart = Math.max(0, renderedStart - RENDER_WINDOW);
        if (newStart !== renderedStart) {
            const anchor = bodyEl.querySelector(`.reader-message[data-floor="${renderedStart}"]`);
            const anchorTop = anchor ? anchor.offsetTop : bodyEl.scrollTop;
            renderWindow();
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

/**
 * 格式化聊天最后消息时间（ST timestamp 格式）。
 * @param {string} ts
 * @returns {string}
 */
function formatChatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
