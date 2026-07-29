// 消息「滚动 / 跳转」按钮（手动版）
// 两类控件：
//   1) 每条消息右侧一列 2 个按钮（单列竖排）：top 滚到本条顶部、bottom 滚到本条底部；
//   2) 常驻聊天视口右侧中部的固定控件：prev 跳到上一条消息顶部、next 跳到下一条消息顶部。
// 跨消息控件位置固定不变，便于连续跳与手机操作；消息内按钮贴近各自消息容器。
// 均为 position:fixed 挂在 body 上（不受 #chat / .mes 的 flex 与定位祖先影响），纯手动、单一开关控制。

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

// 每条消息内的按钮（消息内滚动）：单列竖排
const DIRS = ['top', 'bottom'];
const DIR_META = {
    top:    { icon: 'fa-arrow-up',    title: '滚动到消息顶部' },
    bottom: { icon: 'fa-arrow-down',  title: '滚动到消息底部' },
};

// 常驻聊天视口右侧中部的跨消息导航控件（prev/next，固定位置、兼容手机连续跳）
const NAV_CLASS = 'ccore-msg-nav';
const NAV_BTN_CLASS = 'ccore-msg-nav-btn';
const NAV_DIRS = ['prev', 'next'];
const NAV_META = {
    prev: { icon: 'fa-angles-up',   title: '跳到上一条消息顶部' },
    next: { icon: 'fa-angles-down', title: '跳到下一条消息顶部' },
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
 * 消息内按钮点击：仅处理 top / bottom（消息内滚动）
 */
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
    }
}

/**
 * 跨消息导航控件点击：以「视口顶部正在阅读的消息」为锚，跳到上/下一条消息顶部。
 * 锚点随滚动自校正（手动滚动后下一次点击从新位置起算），连续点击即可逐条遍历。
 * @param {Event} event
 */
function onNavClick(event) {
    event.stopPropagation();
    const btn = $(event.currentTarget);
    const dir = btn.attr('data-dir');
    if (dir !== 'prev' && dir !== 'next') return;
    const anchor = getAnchorMesEl();
    if (!anchor) return;
    const allMes = Array.from(document.querySelectorAll('#chat .mes'));
    const idx = allMes.indexOf(anchor);
    if (idx === -1) return;
    const target = allMes[idx + (dir === 'prev' ? -1 : 1)];
    if (target) scrollMessageToTop(target);
}

/**
 * 取「当前正在阅读」的锚点消息：优先取包含聊天视口顶部参考线的消息；
 * 没有（如视口顶部恰落在两消息缝隙）则取中心最接近参考线的消息。
 * @returns {HTMLElement|null}
 */
function getAnchorMesEl() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return null;
    const chatRect = chatEl.getBoundingClientRect();
    const refY = chatRect.top + 2;
    const allMes = Array.from(chatEl.querySelectorAll('.mes'));
    if (allMes.length === 0) return null;
    const anchor = allMes.find((el) => {
        const r = el.getBoundingClientRect();
        return r.top <= refY && r.bottom > refY;
    });
    if (anchor) return anchor;
    let best = null;
    let bestDist = Infinity;
    for (const el of allMes) {
        const r = el.getBoundingClientRect();
        const c = r.top + r.height / 2;
        const d = Math.abs(c - refY);
        if (d < bestDist) {
            bestDist = d;
            best = el;
        }
    }
    return best;
}

/** 创建常驻的跨消息导航控件（含 prev/next 两个按钮），已存在则跳过 */
function createNavControl() {
    if (document.querySelector(`.${NAV_CLASS}`)) return;
    const nav = $('<div>').addClass(NAV_CLASS).css('display', 'none');
    for (const dir of NAV_DIRS) {
        const meta = NAV_META[dir];
        $('<div>')
            .addClass(`${NAV_BTN_CLASS} interactable`)
            .attr('title', meta.title)
            .attr('data-dir', dir)
            .attr('tabindex', '0')
            .attr('role', 'button')
            .html(`<i class="fa-solid ${meta.icon}"></i>`)
            .appendTo(nav);
    }
    document.body.appendChild(nav[0]);
}

/** 移除跨消息导航控件 */
function removeNavControl() {
    document.querySelector(`.${NAV_CLASS}`)?.remove();
}

/**
 * 把每条可见消息的一列按钮钉在聊天视口内、贴近该消息右边沿；不可见的隐藏。
 * 2 个按钮作为一个整体（unitHeight）夹在消息可见区间内，因此长消息滚动时始终在
 * 且不会跑出消息；底部按钮停在抬升后的视口底部附近，整体从消息底部抬升
 * BOTTOM_LIFT 以避开 swipe 切换按钮。
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

    // 跨消息导航控件：常驻聊天视口右侧中部，位置固定不变，便于连续跳与手机操作
    const navEl = document.querySelector(`.${NAV_CLASS}`);
    if (navEl) {
        const hasMes = document.querySelectorAll('#chat .mes').length > 0;
        navEl.style.display = hasMes ? '' : 'none';
        if (hasMes) {
            const ctrlH = BUTTON_SIZE * NAV_DIRS.length + BUTTON_GAP * (NAV_DIRS.length - 1);
            navEl.style.left = `${chatRect.right - BUTTON_SIZE - EDGE_GAP}px`;
            navEl.style.top = `${chatRect.top + (chatRect.height - ctrlH) / 2}px`;
        }
    }
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
    $(document).off('click.ccore-msg-nav').on('click.ccore-msg-nav', `.${NAV_BTN_CLASS}`, onNavClick);
    createNavControl();
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
    $(document).off('click.ccore-msg-nav');
    removeAllScrollTopButtons();
    removeNavControl();
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
.ccore-msg-nav {
    position: fixed;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: ${BUTTON_GAP}px;
    opacity: 0.5;
    transition: opacity 0.2s;
}
.ccore-msg-nav:hover,
.ccore-msg-nav:focus-within {
    opacity: 1;
}
.ccore-msg-nav-btn {
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
    box-sizing: border-box;
    font-size: 12px;
    pointer-events: auto;
    transition: background-color 0.3s, border-color 0.3s, color 0.3s;
}
.ccore-msg-nav-btn:hover {
    background: rgba(128,128,128,0.3);
    border-color: rgba(128,128,128,0.9);
}
`;
    document.head.appendChild(style);
}
