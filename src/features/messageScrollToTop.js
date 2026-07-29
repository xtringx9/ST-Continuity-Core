// 消息「滚动 / 跳转」按钮（手动版）
// 每条消息在右侧有一列 4 个按钮（单列竖排，从上到下）：
//   prev  : 跳到上一条消息顶部（fa-angles-up）
//   top   : 滚动到本条消息顶部（fa-arrow-up）
//   bottom: 滚动到本条消息底部（fa-arrow-down）
//   next  : 跳到下一条消息顶部（fa-angles-down）
// 按钮用 position:fixed 挂在 body 上（不受 #chat / .mes 的 flex 与定位祖先影响），
// 横向坐标取自对应 .mes 的右边沿（贴近消息容器），纵向钉在聊天视口内并夹在消息可见区间——
// 因此长消息滚动时按钮始终在、且永远不会锁死在单条消息的角落或跑到屏幕最右边。
// 纯手动、按需、由单一开关控制。

import { debugLog, infoLog } from '../utils/logger.js';
import configManager from '../singleton/configManager.js';
import { isInChatPage } from '../core/contextBottomUI.js';

const LOG_TAG = '[MessageScrollToTop]';
const BUTTON_CLASS = 'ccore-scroll-top-btn';
const STYLE_ID = 'ccore_scroll_to_top_styles';
const BUTTON_SIZE = 22; // 与 Cc 按钮同尺寸
const EDGE_GAP = 0; // 按钮与消息右边沿的间距（越小越贴边）
const BUTTON_GAP = 4; // 相邻按钮之间的竖向间距
const BOTTOM_LIFT = 40; // 离视口/消息底部抬升量，避开消息底部的 swipe 切换按钮

// 竖向排列顺序（从上到下），决定 4 个按钮在列中的相对位置
const DIRS = ['prev', 'top', 'bottom', 'next'];
// 各方向的图标与提示文案（单箭头=本条内滚动，双箭头=跨消息跳转）
const DIR_META = {
    prev:   { icon: 'fa-angles-up',   title: '跳到上一条消息顶部' },
    top:    { icon: 'fa-arrow-up',    title: '滚动到消息顶部' },
    bottom: { icon: 'fa-arrow-down',  title: '滚动到消息底部' },
    next:   { icon: 'fa-angles-down', title: '跳到下一条消息顶部' },
};

let scrollObserver = null;
let refreshDebounceTimer = null;
let repositionScheduled = false;
let chatScrollEl = null;

/**
 * 为当前所有消息添加「滚动 / 跳转」按钮（挂在 body 上，按 mesid + dir 关联）
 */
export function addScrollTopButtonsToAllMessages() {
    try {
        if (!isInChatPage()) return;
        const chatEl = document.getElementById('chat');
        if (!chatEl) return;

        const existingKeys = new Set();
        document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((b) => {
            const id = b.getAttribute('data-mes-id');
            const dir = b.getAttribute('data-dir');
            if (id !== null && dir !== null) existingKeys.add(`${id}:${dir}`);
        });

        const liveKeys = new Set();
        $('#chat .mes').each(function () {
            const mesId = parseInt($(this).attr('mesid'), 10);
            if (isNaN(mesId)) return;
            for (const dir of DIRS) {
                liveKeys.add(`${mesId}:${dir}`);
                if (existingKeys.has(`${mesId}:${dir}`)) continue;

                const meta = DIR_META[dir];
                const button = $('<div>')
                    .addClass(`${BUTTON_CLASS} interactable`)
                    .attr('title', meta.title)
                    .attr('data-mes-id', mesId)
                    .attr('data-dir', dir)
                    .attr('tabindex', '0')
                    .attr('role', 'button')
                    .html(`<i class="fa-solid ${meta.icon}"></i>`);
                document.body.appendChild(button[0]);
            }
        });

        // 清理已不存在消息的孤儿按钮
        existingKeys.forEach((key) => {
            if (!liveKeys.has(key)) {
                const [id, dir] = key.split(':');
                document.querySelector(`.${BUTTON_CLASS}[data-mes-id="${id}"][data-dir="${dir}"]`)?.remove();
            }
        });

        scheduleReposition();
    } catch (err) {
        debugLog(LOG_TAG, '为所有消息添加按钮失败:', err);
    }
}

function removeAllScrollTopButtons() {
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((b) => b.remove());
}

/**
 * 将给定消息滚到聊天视图顶部（对齐消息顶端与滚动容器顶端）
 * @param {HTMLElement} mesEl
 */
function scrollMessageToTop(mesEl) {
    const chatEl = document.getElementById('chat');
    if (!chatEl || !mesEl) return;
    try {
        const chatRect = chatEl.getBoundingClientRect();
        const mesRect = mesEl.getBoundingClientRect();
        const target = mesRect.top - chatRect.top + chatEl.scrollTop;
        chatEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    } catch (e) {
        chatEl.scrollTop = Math.max(0, mesEl.offsetTop);
    }
}

/**
 * 将给定消息滚到聊天视图底部（对齐消息底端与滚动容器底端）
 * @param {HTMLElement} mesEl
 */
function scrollMessageToBottom(mesEl) {
    const chatEl = document.getElementById('chat');
    if (!chatEl || !mesEl) return;
    try {
        const chatRect = chatEl.getBoundingClientRect();
        const mesRect = mesEl.getBoundingClientRect();
        const msgBottomContent = mesRect.bottom - chatRect.top + chatEl.scrollTop;
        const target = msgBottomContent - chatEl.clientHeight;
        chatEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    } catch (e) {
        chatEl.scrollTop = Math.max(0, mesEl.offsetTop);
    }
}

/**
 * 获取相邻消息元素（dir = -1 上一条 / +1 下一条），按 #chat 内 .mes 实际顺序取
 * @param {HTMLElement} mesEl
 * @param {number} dir
 * @returns {HTMLElement|null}
 */
function getAdjacentMessage(mesEl, dir) {
    const allMes = Array.from(document.querySelectorAll('#chat .mes'));
    const idx = allMes.indexOf(mesEl);
    if (idx === -1) return null;
    return allMes[idx + dir] || null;
}

function onButtonClick(event) {
    event.stopPropagation();
    const btn = $(event.currentTarget);
    const mesId = btn.attr('data-mes-id');
    const dir = btn.attr('data-dir');
    if (mesId === undefined) return;
    const mesEl = $(`.mes[mesid="${mesId}"]`)[0];
    if (!mesEl) return;
    if (dir === 'top') {
        scrollMessageToTop(mesEl);
    } else if (dir === 'bottom') {
        scrollMessageToBottom(mesEl);
    } else if (dir === 'prev') {
        const prevEl = getAdjacentMessage(mesEl, -1);
        if (prevEl) scrollMessageToTop(prevEl);
    } else if (dir === 'next') {
        const nextEl = getAdjacentMessage(mesEl, 1);
        if (nextEl) scrollMessageToTop(nextEl);
    }
}

/**
 * 把每条可见消息的一列按钮钉在聊天视口内、贴近该消息右边沿；不可见的隐藏。
 * 4 个按钮作为一个整体（unitHeight）夹在消息可见区间内，因此长消息滚动时始终在
 * 且不会跑出消息；最下方按钮停在抬升后的视口底部附近，整体从消息底部抬升
 * BOTTOM_LIFT 以避开 swipe 切换按钮，其余按钮依次向上排开 BUTTON_GAP。
 */
function repositionButtons() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;
    const chatRect = chatEl.getBoundingClientRect();
    const vpMin = chatRect.top + EDGE_GAP; // 聊天视口顶部（避免压到 ST 顶栏）
    const vpMax = chatRect.bottom - BUTTON_SIZE - EDGE_GAP; // 聊天视口底部（避免压到输入区）
    const n = DIRS.length;
    const unitH = BUTTON_SIZE * n + BUTTON_GAP * (n - 1);

    const posCache = new Map();
    const buttons = document.querySelectorAll(`.${BUTTON_CLASS}`);
    buttons.forEach((btn) => {
        const mesId = btn.getAttribute('data-mes-id');
        const mesEl = mesId !== null ? $(`.mes[mesid="${mesId}"]`)[0] : null;
        if (!mesEl) {
            btn.style.display = 'none';
            return;
        }
        const mesRect = mesEl.getBoundingClientRect();
        const visible = mesRect.bottom > chatRect.top + 4 && mesRect.top < chatRect.bottom - 4;
        if (!visible) {
            btn.style.display = 'none';
            return;
        }
        btn.style.display = '';

        let pos = posCache.get(mesId);
        if (!pos) {
            let colTopTop;
            let colBottomTop;
            // 以「消息在视窗内的可见高度」判定短消息，而非完整高度——
            // 一条很高的消息若大半滚出视窗，可见高度很小，应归入短消息分支以免按钮脱节
            const visTop = Math.max(mesRect.top, chatRect.top);
            const visBottom = Math.min(mesRect.bottom, chatRect.bottom);
            const visH = visBottom - visTop;
            if (visH < unitH) {
                // 短消息（或可见部分很短）：整列高度超过可见高度，以可见区间中心为锚、
                // 上下均分溢出，再整体夹在聊天视口内，保证按钮完整可见且不跑出屏幕
                const visCenter = visTop + visH / 2;
                colTopTop = visCenter - unitH / 2;
                if (colTopTop < vpMin) colTopTop = vpMin;
                const maxTopTop = vpMax + BUTTON_SIZE - unitH;
                if (colTopTop > maxTopTop) colTopTop = maxTopTop;
                colBottomTop = colTopTop + (unitH - BUTTON_SIZE);
            } else {
                // 高消息：整列夹在消息可见区间内；最下方按钮停在抬升后的视口底部附近，
                // 整体从消息底部抬升 BOTTOM_LIFT 以避开 swipe 切换按钮
                const bandTop = Math.max(vpMin, mesRect.top);
                const bottomMaxTop = Math.min(vpMax, mesRect.bottom - BUTTON_SIZE - BOTTOM_LIFT);
                colBottomTop = vpMax - BUTTON_SIZE - BOTTOM_LIFT;
                if (colBottomTop > bottomMaxTop) colBottomTop = bottomMaxTop;
                colTopTop = colBottomTop - (unitH - BUTTON_SIZE);
                if (colTopTop < bandTop) {
                    colTopTop = bandTop;
                    colBottomTop = bandTop + (unitH - BUTTON_SIZE);
                }
            }

            // 按 DIRS 顺序（从上到下）计算每个方向的 top
            const dirTops = {};
            DIRS.forEach((dir, i) => {
                dirTops[dir] = colTopTop + i * (BUTTON_SIZE + BUTTON_GAP);
            });

            // 横向：始终贴在消息右边沿内侧（距右边沿 EDGE_GAP），更贴近消息容器
            const left = mesRect.right - BUTTON_SIZE - EDGE_GAP;
            pos = { dirTops, left };
            posCache.set(mesId, pos);
        }

        const dir = btn.getAttribute('data-dir');
        btn.style.top = `${pos.dirTops[dir]}px`;
        btn.style.left = `${pos.left}px`;
    });
}

function scheduleReposition() {
    if (repositionScheduled) return;
    repositionScheduled = true;
    requestAnimationFrame(() => {
        repositionScheduled = false;
        repositionButtons();
    });
}

/**
 * 初始化：根据开关决定是否注入按钮与监听
 */
export function initMessageScrollToTop() {
    if (!configManager.getExtensionConfig().enableScrollToTop) {
        removeMessageScrollToTop();
        return;
    }
    injectStyles();
    setupChatObserver();
    $(document).off('click.ccore-scroll-to-top').on('click.ccore-scroll-to-top', `.${BUTTON_CLASS}`, onButtonClick);
    addScrollTopButtonsToAllMessages();
    infoLog(LOG_TAG, '消息滚动/跳转按钮已启用');
}

/**
 * 彻底移除：断开监听、解绑事件、删除所有按钮
 */
export function removeMessageScrollToTop() {
    if (scrollObserver) {
        scrollObserver.disconnect();
        scrollObserver = null;
    }
    if (refreshDebounceTimer) {
        clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = null;
    }
    if (chatScrollEl) {
        chatScrollEl.removeEventListener('scroll', scheduleReposition);
        window.removeEventListener('resize', scheduleReposition);
        chatScrollEl = null;
    }
    $(document).off('click.ccore-scroll-to-top');
    removeAllScrollTopButtons();
}

function setupChatObserver() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) {
        setTimeout(setupChatObserver, 500);
        return;
    }
    if (scrollObserver) scrollObserver.disconnect();
    scrollObserver = new MutationObserver(() => {
        if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = setTimeout(() => {
            addScrollTopButtonsToAllMessages();
            refreshDebounceTimer = null;
        }, 200);
    });
    scrollObserver.observe(chatEl, { childList: true });

    if (chatScrollEl !== chatEl) {
        if (chatScrollEl) {
            chatScrollEl.removeEventListener('scroll', scheduleReposition);
            window.removeEventListener('resize', scheduleReposition);
        }
        chatScrollEl = chatEl;
        chatEl.addEventListener('scroll', scheduleReposition);
        window.addEventListener('resize', scheduleReposition);
    }
}

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    // 风格对齐 Cc 按钮：22px、2px 边框、6px 圆角、半透明、hover 变实
    style.textContent = `
.ccore-scroll-top-btn {
    position: fixed;
    width: ${BUTTON_SIZE}px;
    height: ${BUTTON_SIZE}px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--smart-border-color, rgba(128,128,128,0.5));
    background: transparent;
    color: var(--smart-body-text-color, #ddd);
    cursor: pointer;
    opacity: 0.5;
    box-sizing: border-box;
    transition: opacity 0.2s, background-color 0.3s, border-color 0.3s, color 0.3s;
    font-size: 12px;
    pointer-events: auto;
    z-index: 100;
}
.ccore-scroll-top-btn:hover {
    background: rgba(128,128,128,0.3);
    border-color: rgba(128,128,128,0.9);
    opacity: 1;
}
`;
    document.head.appendChild(style);
}
