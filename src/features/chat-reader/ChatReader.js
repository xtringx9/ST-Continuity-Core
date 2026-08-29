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
//     角色排序支持「默认 / 按最近聊天时间」；顶部「当前聊天」快捷入口。
//   2) 阅读视图：分页阅读（每页 PAGE_SIZE 条），记忆每个聊天的阅读页（localStorage）。
//
// 正则说明（2026-08-16 用户拍板方案）：messageFormatting 内部用 ST 当前 chat 数组计算
// placement / depth。阅读历史聊天时若依赖它，会与阅读数组错位，带 minDepth/maxDepth 的
// 正则被误跳过。且用户明确「不要替换 chat 数组」（有覆盖原聊天风险）。
// 方案：历史聊天**不复用 messageFormatting**，而是自己复刻核心渲染管线
// （自己算 placement/depth → getRegexedString → converter.makeHtml → DOMPurify），
// 零 ST 全局状态修改。当前聊天（chat 即目标）仍用 messageFormatting，与酒馆一致。
//
// 主题：与其它编辑器一致，监听 storage 'st_continuity_theme' 同步 iframe data-theme。

import {
    chat,
    characters,
    user_avatar,
    messageFormatting,
    converter,
    getThumbnailUrl,
    getPastCharacterChats,
    getRequestHeaders,
    getCurrentChatDetails,
} from '../../../../../../../script.js';
import {
    getScriptsByType,
    SCRIPT_TYPES,
    runRegexScript,
    regex_placement,
    isScopedScriptsAllowed,
    isPresetScriptsAllowed,
    getCurrentPresetAPI,
    getCurrentPresetName,
} from '../../../../../regex/engine.js';
import { extension_settings } from '../../../../../../extensions.js';
import { encodeStyleTags, decodeStyleTags } from '../../../../../../chats.js';
import { timestampToMoment } from '../../../../../../utils.js';
import { DOMPurify } from '../../../../../../../lib.js';
import { debugLog, errorLog, infoLog } from '../../utils/logger.js';
import { initChatManager, setChatManagerDoc } from './ChatManager.js';
import { getAvatarThumbUrl, getAvatarFullUrl } from '../../shared/characterBridge.js';

const LOG_TAG = '[ChatReader]';

// 分页大小：每页消息条数
const PAGE_SIZE = 2;
// 阅读位置记忆 key（localStorage）：{ [chatKey]: page(0-based) }
const POS_STORAGE_KEY = 'ccore_reader_pos';

let doc = null;
let bodyEl = null;
let chatNameEl = null;
let pageInfoEl = null;
let pageInput = null;
let prevPageBtn = null;
let nextPageBtn = null;
let pageIndicatorEl = null;
let backHomeBtn = null;

// 首页元素
let homeEl = null;
let charGridEl = null;
let charTitleEl = null;
let charSearchEl = null;

// 聊天选择弹窗（阅读/管理共用）
let chatModalEl = null;
let chatModalTitleEl = null;
let chatModalBodyEl = null;
let chatModalCloseBtn = null;

let currentPage = 0; // 当前页（0-based）
let lightboxEl = null;

// 当前阅读的聊天（非当前打开会话时，缓存已加载的消息）
let activeChatMessages = null;
// 当前阅读的角色对象（历史聊天用其头像；当前聊天时从 ST 上下文取）
let activeChar = null;
// 当前聊天标识（用于记忆阅读位置）：历史聊天=文件名，当前聊天=sessionName
let activeChatKey = '';

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
    pageInfoEl = doc.getElementById('reader-page-info');
    pageInput = doc.getElementById('reader-page-input');
    prevPageBtn = doc.getElementById('reader-prev-page');
    nextPageBtn = doc.getElementById('reader-next-page');
    pageIndicatorEl = doc.getElementById('reader-page-current');
    backHomeBtn = doc.getElementById('reader-back-home');
    homeEl = doc.getElementById('reader-home');
    charGridEl = doc.getElementById('reader-char-grid');
    charTitleEl = doc.getElementById('reader-char-title');
    charSearchEl = doc.getElementById('reader-char-search');
    chatModalEl = doc.getElementById('reader-chat-modal');
    chatModalTitleEl = doc.getElementById('reader-chat-modal-title');
    chatModalBodyEl = doc.getElementById('reader-chat-modal-body');
    chatModalCloseBtn = doc.getElementById('reader-chat-modal-close');

    if (!bodyEl || !prevPageBtn || !nextPageBtn || !homeEl) {
        errorLog(LOG_TAG, '阅读器 DOM 不完整，初始化失败');
        return;
    }

    // 翻页
    prevPageBtn.addEventListener('click', () => gotoPage(currentPage - 1));
    nextPageBtn.addEventListener('click', () => gotoPage(currentPage + 1));

    // 页码跳转
    const pageGoBtn = doc.getElementById('reader-page-go');
    if (pageGoBtn) {
        pageGoBtn.addEventListener('click', onPageJump);
        pageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') onPageJump();
        });
    }

    // 返回首页
    if (backHomeBtn) {
        backHomeBtn.addEventListener('click', showHome);
    }

    // 角色搜索（实时过滤）
    if (charSearchEl) {
        charSearchEl.addEventListener('input', () => renderCharacterGrid(charSearchEl.value));
    }

    // 关闭按钮：由父窗口 EntryButton 在 onLoad 绑定（对齐其它编辑器惯例）。

    // 聊天选择弹窗（阅读/管理共用壳，绑定关闭交互）
    bindChatModal();

    // 图片放大
    bodyEl.addEventListener('click', onBodyClick);

    // 主题同步（与其它编辑器一致）
    syncChatReaderTheme(doc);

    // 聊天管理 tab（同为父窗口驱动，复用同一 doc）
    setChatManagerDoc(doc);
    initChatManager(doc);

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
    // 防重复注册（自定义属性，TS 断言绕过）
    const themeBound = /** @type {Document & {_ccReaderThemeBound?: boolean}} */ (iframeDoc);
    if (!themeBound._ccReaderThemeBound) {
        themeBound._ccReaderThemeBound = true;
        const iframeWin = iframeDoc.defaultView;
        iframeWin?.addEventListener('storage', (e) => {
            if (e.key === 'st_continuity_theme') {
                iframeDoc.documentElement.setAttribute('data-theme', e.newValue || 'light');
            }
        });

        // 标题点击切换主题（复用 module-editor / nai 模式）
        const headerTitle = iframeDoc.querySelector('.header-title');
        if (headerTitle) {
            const headerTitleEl = /** @type {HTMLElement} */ (headerTitle);
            headerTitleEl.style.cursor = 'pointer';
            headerTitleEl.title = '点击切换主题';
            headerTitleEl.addEventListener('click', () => {
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
    if (pageInfoEl) pageInfoEl.style.display = 'none';
    if (pageInput) pageInput.style.display = 'none';
    const pageGoBtn = doc.getElementById('reader-page-go');
    if (pageGoBtn) pageGoBtn.style.display = 'none';
    if (chatNameEl) chatNameEl.textContent = '';

    // 重置阅读上下文，避免历史聊天状态残留
    activeChatMessages = null;
    activeChar = null;
    activeChatKey = '';

    renderCharacterGrid('');
}

/**
 * 渲染角色选择列表（阅读/管理共用）。
 * 抽公共渲染器，避免阅读与管理各自维护一份几乎相同的角色网格。
 * 头像为主的大卡片 + 实时搜索过滤；点卡片由调用方决定后续（弹窗选聊天 / 进阅读 / 进分析）。
 *
 * @param {object} opts
 * @param {Document} opts.doc iframe 文档
 * @param {HTMLElement} opts.gridEl 角色列表容器
 * @param {HTMLElement} [opts.titleEl] 标题元素（显示「选择角色」/「含当前聊天」）
 * @param {string} [opts.query] 搜索词（按角色名过滤，大小写不敏感）
 * @param {(idx:number)=>void} opts.onPick 点角色行的回调（传入角色索引）
 * @param {()=>void} opts.onPickCurrent 点「当前聊天」快捷入口的回调
 */
export function renderCharPicker({ doc, gridEl, titleEl, query = '', onPick, onPickCurrent }) {
    if (!doc || !gridEl) return;
    const frag = doc.createDocumentFragment();
    const q = (query || '').trim().toLowerCase();

    // 快捷入口：当前打开的聊天
    const current = getCurrentChatDetails();
    const hasCurrent = !!current?.characterName && !!current?.sessionName;
    if (hasCurrent) {
        const card = doc.createElement('div');
        card.className = 'reader-char-card reader-char-current';
        const avatar = doc.createElement('img');
        avatar.className = 'reader-char-avatar';
        avatar.alt = '';
        // 列表用缩略图小方框（省流量）；失败回退 ST 默认图
        const curChid = getCurrentChid();
        const curAvatarFile = curChid !== undefined && characters[curChid] ? characters[curChid].avatar : '';
        avatar.src = (curAvatarFile && curAvatarFile !== 'none') ? getAvatarThumbUrl(curAvatarFile) : (current.avatarImgURL || '');
        if (curAvatarFile && curAvatarFile !== 'none') {
            const onErr = () => {
                avatar.removeEventListener('error', onErr);
                avatar.src = current.avatarImgURL || '';
            };
            avatar.addEventListener('error', onErr);
        }
        const info = doc.createElement('div');
        info.className = 'reader-char-info';
        const name = doc.createElement('div');
        name.className = 'reader-char-name';
        name.textContent = `${current.characterName}`;
        const sub = doc.createElement('div');
        sub.className = 'reader-char-sub';
        sub.textContent = `当前聊天：${current.sessionName}`;
        info.append(name, sub);
        card.append(avatar, info);
        card.addEventListener('click', onPickCurrent);
        frag.appendChild(card);
    }

    // 所有角色（按名字实时过滤）
    const chars = Array.isArray(characters) ? characters : [];
    let shown = 0;
    chars.forEach((char, idx) => {
        const name = char.name || `角色 ${idx}`;
        if (q && !name.toLowerCase().includes(q)) return;
        shown++;
        const card = doc.createElement('div');
        card.className = 'reader-char-card';
        const avatar = doc.createElement('img');
        avatar.className = 'reader-char-avatar';
        avatar.alt = '';
        avatar.loading = 'lazy';
        const avFile = (char.avatar && char.avatar !== 'none') ? char.avatar : '';
        // 列表用缩略图小方框（省流量）；失败回退 ST 默认图
        avatar.src = avFile ? getAvatarThumbUrl(avFile) : '';
        if (avFile) {
            const onErr = () => {
                avatar.removeEventListener('error', onErr);
                try { avatar.src = getThumbnailUrl('avatar', avFile); } catch (e) { /* ignore */ }
            };
            avatar.addEventListener('error', onErr);
        }
        // 无头像时显示首字母占位
        if (!avFile) {
            card.classList.add('reader-char-noimg');
            const ph = doc.createElement('div');
            ph.className = 'reader-char-ph';
            ph.textContent = (name[0] || '?').toUpperCase();
            card.appendChild(ph);
        }
        // 覆盖层仅显示角色名
        const info = doc.createElement('div');
        info.className = 'reader-char-info';
        const nameEl = doc.createElement('div');
        nameEl.className = 'reader-char-name';
        nameEl.textContent = name;
        info.append(nameEl);
        card.append(avatar, info);
        card.addEventListener('click', () => onPick(idx));
        frag.appendChild(card);
    });

    gridEl.innerHTML = '';
    if (shown === 0 && !hasCurrent) {
        gridEl.innerHTML = '<div class="reader-loading">没有匹配的角色</div>';
    } else {
        gridEl.appendChild(frag);
    }

    if (titleEl) titleEl.textContent = hasCurrent ? '选择角色（含当前聊天快捷入口）' : '选择角色';
}

/**
 * 阅读视图：渲染角色选择列表（包一层默认 doc 引用）。
 * @param {string} query 搜索词
 */
function renderCharacterGrid(query) {
    renderCharPicker({
        doc,
        gridEl: charGridEl,
        titleEl: charTitleEl,
        query,
        onPick: (idx) => selectCharacter(idx),
        onPickCurrent: () => openCurrentChat(),
    });
}

/**
 * 选择角色：弹出聊天选择弹窗（阅读视图进入阅读，管理视图进入分析）。
 * @param {number} characterId
 */
function selectCharacter(characterId) {
    if (!characters[characterId]) return;
    const char = characters[characterId];
    openChatModal({
        title: `选择聊天（${char.name}）`,
        getChats: () => getPastCharacterChats(characterId),
        onPick: (chatMeta) => {
            const fileName = String(chatMeta.file_name || '').replace(/\.jsonl$/i, '');
            openChatFromFiles(fileName, char);
        },
    });
}

/**
 * 聊天选择弹窗：阅读/管理共用壳。
 * 点击角色卡片后弹出，列出该角色的聊天文件；关闭即回到角色列表（天然可返回）。
 * 弹窗顶部显示角色**原图**头像（高清，与 ST 聊天大图同源），列表用缩略图的小方框在卡片上。
 *
 * @param {object} opts
 * @param {string} opts.title 弹窗标题
 * @param {string} [opts.avatarFile] 角色 avatar 文件名；提供则在弹窗顶部拉取原图显示
 * @param {() => (Array|Promise<Array>)} opts.getChats 返回聊天元数据数组（可异步）
 * @param {(chatMeta:object)=>void} opts.onPick 点某聊天条目的回调
 */
export function openChatModal({ title, avatarFile, getChats, onPick }) {
    if (!chatModalEl || !chatModalBodyEl) return;
    if (chatModalTitleEl) chatModalTitleEl.textContent = title || '选择聊天';
    // 弹窗顶部角色原图（高清）；无图则不显示头部
    const headerEl = chatModalEl.querySelector('.reader-chat-modal-header');
    if (headerEl) {
        if (avatarFile && avatarFile !== 'none') {
            headerEl.style.display = 'flex';
            const img = headerEl.querySelector('.reader-chat-modal-avatar');
            if (img) {
                img.src = getAvatarFullUrl(avatarFile);
                img.onerror = () => { headerEl.style.display = 'none'; };
            }
        } else {
            headerEl.style.display = 'none';
        }
    }
    chatModalBodyEl.innerHTML = '<div class="reader-loading">加载聊天列表…</div>';
    chatModalEl.style.display = 'flex';

    Promise.resolve()
        .then(() => getChats())
        .then((chats) => renderChatModalList(chats, onPick))
        .catch((e) => {
            errorLog(LOG_TAG, '加载聊天列表失败:', e);
            if (chatModalBodyEl) chatModalBodyEl.innerHTML = '<div class="reader-loading reader-loading-error">加载失败，请重试</div>';
        });
}

/**
 * 渲染弹窗内的聊天列表。
 * @param {Array} chats 聊天元数据数组
 * @param {(chatMeta:object)=>void} onPick
 */
function renderChatModalList(chats, onPick) {
    if (!chatModalBodyEl) return;
    if (!Array.isArray(chats) || chats.length === 0) {
        chatModalBodyEl.innerHTML = '<div class="reader-loading">该角色暂无聊天记录</div>';
        return;
    }
    // 按最后消息时间倒序（新 → 旧）。用副本排序，避免改动调用方可能缓存/复用的数组。
    const sorted = chats.slice().sort((a, b) => chatTimeValue(b.last_mes) - chatTimeValue(a.last_mes));
    const frag = doc.createDocumentFragment();
    sorted.forEach((chatMeta) => {
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
            `楼层 ${chatMeta.chat_items ?? 0}`,
            formatChatTime(chatMeta.last_mes),
            chatMeta.file_size ? chatMeta.file_size : '',
        ].filter(Boolean).join(' · ');

        item.append(name, meta);
        item.addEventListener('click', () => {
            closeChatModal();
            onPick(chatMeta);
        });
        frag.appendChild(item);
    });
    chatModalBodyEl.innerHTML = '';
    chatModalBodyEl.appendChild(frag);
}

/**
 * 关闭聊天选择弹窗（回到角色列表）。
 */
export function closeChatModal() {
    if (chatModalEl) chatModalEl.style.display = 'none';
    if (chatModalBodyEl) chatModalBodyEl.innerHTML = '';
}

/**
 * 绑定弹窗关闭交互（关闭按钮 / 点遮罩 / ESC），init 时调用一次。
 */
function bindChatModal() {
    if (!chatModalEl) return;
    const close = () => closeChatModal();
    chatModalCloseBtn?.addEventListener('click', close);
    // 点遮罩（modal-mask 本身，而非内部 modal）关闭
    chatModalEl.addEventListener('click', (e) => {
        if (e.target === chatModalEl) close();
    });
    doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && chatModalEl.style.display !== 'none') close();
    });
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
            if (chatModalBodyEl) chatModalBodyEl.innerHTML = '<div class="reader-loading reader-loading-error">加载失败，请重试</div>';
            return;
        }
        activeChatMessages = messages;
        activeChar = char;
        activeChatKey = `file:${chatName}`;
        enterReadingView(messages, chatName);
    } catch (e) {
        errorLog(LOG_TAG, '加载聊天消息失败:', e);
        if (chatModalBodyEl) chatModalBodyEl.innerHTML = '<div class="reader-loading reader-loading-error">加载失败，请重试</div>';
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
    activeChar = null; // 当前聊天用 ST 上下文取当前角色
    const details = getCurrentChatDetails();
    activeChatKey = `current:${details?.sessionName || ''}`;
    enterReadingView(chat, details?.sessionName || '当前聊天');
}

/* =====================================================
 * 阅读视图（分页）
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
    if (pageInfoEl) pageInfoEl.style.display = '';
    if (pageInput) pageInput.style.display = '';
    const pageGoBtn = doc.getElementById('reader-page-go');
    if (pageGoBtn) pageGoBtn.style.display = '';
    if (chatNameEl) chatNameEl.textContent = title ? `· ${title}` : '';

    // 恢复阅读位置（记忆页；无记录则第一页）
    currentPage = getSavedPage(activeChatKey, messages.length);
    renderPage();
}

/**
 * 读取当前应渲染的消息源（当前聊天或已加载的历史聊天）。
 */
function getMessages() {
    return activeChatMessages && activeChatMessages.length > 0 ? activeChatMessages : chat;
}

/**
 * 渲染当前页（PAGE_SIZE 条消息）。
 */
function renderPage() {
    if (!doc) return;
    const messages = getMessages();
    if (!messages || messages.length === 0) {
        bodyEl.innerHTML = '<div class="reader-empty"><div class="reader-empty-icon">📖</div><div>当前聊天没有消息</div></div>';
        updatePageControls();
        return;
    }

    const total = messages.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    // 夹取页码
    if (currentPage < 0) currentPage = 0;
    if (currentPage > totalPages - 1) currentPage = totalPages - 1;

    const start = currentPage * PAGE_SIZE;
    const end = Math.min(total, start + PAGE_SIZE);

    const frag = doc.createDocumentFragment();
    for (let i = start; i < end; i++) {
        frag.appendChild(renderMessage(i));
    }
    bodyEl.innerHTML = '';
    bodyEl.appendChild(frag);

    updatePageControls();
    debugLog(LOG_TAG, `渲染第 ${currentPage + 1} 页（楼层 ${start}-${end - 1}）`);
}

/**
 * 更新页码控件。
 */
function updatePageControls() {
    const messages = getMessages();
    const total = messages?.length || 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    if (pageInfoEl) pageInfoEl.textContent = `第 ${currentPage + 1} / ${totalPages} 页`;
    if (pageIndicatorEl) pageIndicatorEl.textContent = `第 ${currentPage + 1} / ${totalPages} 页`;
    if (pageInput) pageInput.value = String(currentPage + 1);

    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 0;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages - 1;
}

/**
 * 跳转到指定页（0-based，自动夹取）。
 * @param {number} page
 */
function gotoPage(page) {
    const messages = getMessages();
    const total = messages?.length || 0;
    if (total === 0) return;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const clamped = Math.max(0, Math.min(totalPages - 1, page));
    if (clamped === currentPage) return;
    currentPage = clamped;
    renderPage();
    // 记忆阅读位置
    saveCurrentPage();
    // 回到顶部
    if (bodyEl) bodyEl.scrollTop = 0;
}

/**
 * 页码跳转（顶部输入）。
 */
function onPageJump() {
    if (!pageInput) return;
    const val = parseInt(pageInput.value, 10);
    if (isNaN(val)) return;
    gotoPage(val - 1);
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

    // 历史聊天：activeChatMessages 存在且不是 ST 当前 chat（当前聊天直接渲染，不 splice）
    const isHistorical = activeChatMessages !== null && activeChatMessages !== chat;

    const card = doc.createElement('div');
    card.className = 'reader-message';

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

    // ---- 正文 ----
    // 当前聊天：复用 messageFormatting（chat 即目标，与酒馆逐字节一致）。
    // 历史聊天：自己复刻核心渲染（正确 depth 正则 + markdown + 消毒），不碰 ST 全局 chat。
    const text = doc.createElement('div');
    text.className = 'reader-msg-text';
    const isSystem = !!mes.is_system;
    let rawText = mes.extra?.display_text || mes.mes || '';
    try {
        if (isHistorical) {
            text.innerHTML = renderHistoricalText(rawText, mes, index);
        } else {
            text.innerHTML = messageFormatting(
                rawText,
                mes.name,
                isSystem,
                !!mes.is_user,
                index,
                {},
                false,
            );
        }
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
 * 复刻 messageFormatting 的核心渲染管线（历史聊天专用，避免依赖 ST 全局 chat 的 depth）。
 * 步骤：自己算 placement/depth → 自己组装并应用正则（全局 + 阅读角色 SCOPED + 当前预设）
 * → converter.makeHtml（markdown）→ encodeStyleTags/DOMPurify/decodeStyleTags（消毒）。
 * ⚠️ 零 ST 全局状态修改（不替换 chat）；正则集含「正在阅读的角色」的角色正则，
 *    而非当前打开角色（getRegexedString 的 getRegexScripts 用 this_chid 会拿错角色）。
 * @param {string} rawText 原始正文
 * @param {object} mes 消息对象
 * @param {number} index 楼层索引
 * @returns {string} 渲染后的 HTML
 */
function renderHistoricalText(rawText, mes, index) {
    // 1. placement：is_user → USER_INPUT；narrator → SLASH_COMMAND；否则 AI_OUTPUT
    let placement = regex_placement.AI_OUTPUT;
    if (mes.is_user) {
        placement = regex_placement.USER_INPUT;
    } else if (mes.extra?.type === 'narrator') {
        placement = regex_placement.SLASH_COMMAND;
    }

    // 2. depth：基于正在阅读的数组计算（当前页视为最新一层，向上翻页 depth 递增）
    const messages = activeChatMessages;
    const usable = Array.isArray(messages)
        ? messages.map((x, i) => ({ message: x, index: i })).filter(x => !x.message?.is_system)
        : [];
    const indexOf = usable.findIndex(x => x.index === index);
    const depth = indexOf !== -1 ? (usable.length - indexOf - 1) : undefined;

    // 3. 正则（自己组装 + 自己应用，复刻 getRegexedString 的过滤逻辑）
    let out = applyRegexToText(rawText, mes, placement, depth);

    // 4. markdown（showdown）
    try {
        out = converter.makeHtml(out);
    } catch (e) {
        debugLog(LOG_TAG, `楼层 ${index} markdown 转换失败，退回原文:`, e);
        return rawText;
    }

    // 5. 消毒（与 messageFormatting 一致）
    const sanitizeConfig = {
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false,
        RETURN_TRUSTED_TYPE: false,
        MESSAGE_SANITIZE: true,
        ADD_TAGS: ['custom-style'],
    };
    try {
        out = encodeStyleTags(out);
        out = DOMPurify.sanitize(out, sanitizeConfig);
        out = decodeStyleTags(out, { prefix: '.mes_text ' });
    } catch (e) {
        debugLog(LOG_TAG, `楼层 ${index} 消毒失败，返回原文:`, e);
        return rawText;
    }

    return out;
}

/**
 * 对历史聊天文本应用正则（复刻 getRegexedString 的过滤逻辑）。
 * 正则集 = 全局(extension_settings.regex) + 正在阅读角色的 SCOPED + 当前预设 PRESET。
 * 不用 getRegexedString 的原因：它内部 getRegexScripts 用 this_chid（当前打开角色）
 * 且带 allowedOnly 白名单过滤，历史角色/预设会被漏掉。
 * @param {string} rawText 原始文本
 * @param {object} mes 消息对象
 * @param {number} placement regex_placement 值
 * @param {number|undefined} depth
 * @returns {string} 应用正则后的文本
 */
function applyRegexToText(rawText, mes, placement, depth) {
    // 组装正则集
    const scripts = [];
    // 全局正则（无条件，直读 extension_settings.regex）
    if (Array.isArray(extension_settings.regex)) scripts.push(...extension_settings.regex);
    // 正在阅读角色的 SCOPED 正则（阅读角色，而非当前打开角色）
    // ⚠️ 判断用户是否允许该角色正则（character_allowed_regex 白名单）：
    //    用户关掉则与 ST 原生行为一致不应用。
    const char = activeChar || characters[getCurrentChid()];
    if (char) {
        const scoped = char.data?.extensions?.regex_scripts;
        if (Array.isArray(scoped) && isScopedScriptsAllowed(char)) {
            scripts.push(...scoped);
        }
    }
    // 当前预设的 PRESET 正则（同样判断用户是否允许该预设正则）
    const apiId = getCurrentPresetAPI();
    const presetName = getCurrentPresetName();
    if (isPresetScriptsAllowed(apiId, presetName)) {
        scripts.push(...getScriptsByType(SCRIPT_TYPES.PRESET));
    }

    let out = rawText;
    const isMarkdown = true;
    const isPrompt = false;

    for (const script of scripts) {
        if (!script || script.disabled || !script.findRegex || !out) continue;

        // 类型条件（复刻 getRegexedString）：
        //   markdownOnly 仅 isMarkdown 应用；promptOnly 仅 isPrompt 应用；
        //   普通正则需「非 markdown 且非 prompt」才应用（markdown 场景跳过）。
        const isMarkdownOnly = script.markdownOnly === true;
        const isPromptOnly = script.promptOnly === true;
        if (isMarkdownOnly) {
            if (!isMarkdown) continue;
        } else if (isPromptOnly) {
            if (!isPrompt) continue;
        } else {
            continue; // 普通正则：isMarkdown=true 场景跳过（与 getRegexedString 一致）
        }

        // depth 检查
        if (typeof depth === 'number') {
            if (!isNaN(script.minDepth) && script.minDepth !== null && script.minDepth >= -1 && depth < script.minDepth) continue;
            if (!isNaN(script.maxDepth) && script.maxDepth !== null && script.maxDepth >= 0 && depth > script.maxDepth) continue;
        }

        // placement 检查
        if (Array.isArray(script.placement) && script.placement.includes(placement)) {
            out = runRegexScript(script, out, { characterOverride: mes.name });
        }
    }

    return out;
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
        const st = /** @type {any} */ (globalThis).SillyTavern;
        if (st && typeof st.getContext === 'function') {
            const ctx = st.getContext();
            if (ctx && typeof ctx.chid === 'string') return ctx.chid;
        }
    } catch (e) { /* ignore */ }
    return undefined;
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
 * 格式化聊天时间 → 统一「YYYY-MM-DD HH:mm」（24 小时制，纯数字，无英文月份）。
 *
 * 数据源：本扩展走 getPastCharacterChats → /api/characters/chats → getChatInfo，
 * 其 last_mes = jsonData['send_date'] || stats.mtimeMs（src/endpoints/chats.js:415），
 * 即可能是 Unix 时间戳，也可能是历史遗留的 send_date 字符串（ISO 8601 /
 * meridiem 如 "June 19, 2023 2:20pm" / ST humanized 如 "2024-7-12@01h31m37s"），
 * 直接 new Date() 解析不稳定。
 * 故复用 ST 自身的 timestampToMoment（public/scripts/utils.js），其 parseTimestamp
 * 专门消化上述所有格式（与 ST 原生「聊天记录」面板同源），再格式化为 24h 纯数字。
 * @param {string|number} ts
 * @returns {string} 解析失败返回空串
 */
function formatChatTime(ts) {
    if (ts === undefined || ts === null || ts === '') return '';
    try {
        const m = timestampToMoment(ts);
        return m && m.isValid() ? m.format('YYYY-MM-DD HH:mm') : '';
    } catch (e) {
        return '';
    }
}

/**
 * 取聊天时间的可比较数值（毫秒），用于排序。与 formatChatTime 同源解析，
 * 兼容 last_mes 的各种历史格式；解析失败返回 0（排序时落到最后）。
 * @param {string|number} ts
 * @returns {number}
 */
function chatTimeValue(ts) {
    if (ts === undefined || ts === null || ts === '') return 0;
    try {
        const m = timestampToMoment(ts);
        return m && m.isValid() ? m.valueOf() : 0;
    } catch (e) {
        return 0;
    }
}

/* =====================================================
 * 阅读位置记忆（localStorage）
 * ===================================================== */

/**
 * 读取某聊天的记忆页（0-based；无记录返回 0，越界夹取）。
 * @param {string} chatKey 聊天标识
 * @param {number} totalMessages 消息总数（用于夹取页码）
 * @returns {number}
 */
function getSavedPage(chatKey, totalMessages) {
    if (!chatKey) return 0;
    try {
        const raw = localStorage.getItem(POS_STORAGE_KEY);
        const posMap = raw ? JSON.parse(raw) : {};
        const page = Number(posMap[chatKey]);
        if (!isNaN(page) && page >= 0) {
            const totalPages = Math.max(1, Math.ceil(totalMessages / PAGE_SIZE));
            return Math.min(page, totalPages - 1);
        }
    } catch (e) { /* ignore */ }
    return 0;
}

/**
 * 记忆当前页（0-based）。
 */
function saveCurrentPage() {
    if (!activeChatKey) return;
    try {
        const raw = localStorage.getItem(POS_STORAGE_KEY);
        const posMap = raw ? JSON.parse(raw) : {};
        posMap[activeChatKey] = currentPage;
        localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(posMap));
    } catch (e) { /* ignore */ }
}
