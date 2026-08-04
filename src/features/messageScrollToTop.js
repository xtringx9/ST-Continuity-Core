// 消息「滚动 / 跳转」按钮（手动版）
// 两类控件：
//   1) 每条消息右侧一列 2 个按钮（单列竖排）：top 滚到本条顶部、bottom 滚到本条底部；
//   2) 常驻聊天视口右侧中部的消息圆点条：每个圆点 = 一条消息（user/ai 不同色），
//      点击跳到该消息顶部；背景进度条 + 高亮圆点标出当前阅读位置。
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
const NAV_AVOID_GAP = 6; // 消息按钮整列避让常驻跨消息控件时的额外间隙

// 每条消息内的按钮（消息内滚动）：单列竖排
const DIRS = ['top', 'bottom'];
const DIR_META = {
    top:    { icon: 'fa-arrow-up',    title: '滚动到消息顶部' },
    bottom: { icon: 'fa-arrow-down',  title: '滚动到消息底部' },
};

// 常驻聊天视口右侧中部的跨消息导航控件：消息圆点条（每个圆点 = 一条消息，
// user/ai 不同色，点击跳到该消息顶部；背景含阅读进度条标当前位置）
const NAV_CLASS = 'ccore-msg-nav';
const NAV_DOT_CLASS = 'ccore-msg-nav-dot';
const NAV_PROGRESS_CLASS = 'ccore-msg-nav-progress';
// 圆点颜色：继承 ST 主题清晰区分色。user 主色降低透明度更柔和，ai 用边框色形成对比，
// 深/浅主题均有良好可见度。如需其它继承色可替换下面的变量（见回复说明）。
const NAV_DOT_USER_COLOR = 'color-mix(in srgb, var(--SmartThemeBodyColor, rgb(220,220,210)) 65%, transparent)';
const NAV_DOT_AI_COLOR = 'var(--SmartThemeBorderColor, rgba(128,128,128,0.85))';
const NAV_PROGRESS_COLOR = 'var(--smart-border-color, rgba(128,128,128,0.6))'; // 背景竖线（撑满高度）
const NAV_DOT_SIZE = 6;      // 单个圆点直径（px）
const NAV_BAR_WIDTH = 14;    // 圆点条整体宽度（圆点 + 两侧留白）
const NAV_VPAD = 12;         // 圆点群上下留白（px），仅内缩圆点、不影响竖线撑满
const NAV_DOT_ZONE_RATIO = 0.72; // 圆点群占圆点条高度比例（<1 保持紧凑密集，竖线贯穿全长）

let scrollObserver = null;
let refreshDebounceTimer = null;
let repositionScheduled = false;
let chatScrollEl = null;
let mesVisibilityObserver = null; // 仅观察视口附近消息，避免每帧对全部按钮算几何
let visibleMesIds = new Set();    // 当前与视口（含缓冲）相交的消息 mesid 集合
let visibilityReady = false;      // 首个 IO 回调后置真，之后仅重排可见消息按钮
let lastActiveDot = -1;           // 上一帧高亮的圆点索引，避免每帧遍历全部圆点

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

        observeAllMes();
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
 * 圆点条点击：每个圆点 data-index 对应一条消息，点击滚到该消息顶部。
 * 用事件委托（监听器挂在容器上），避免给海量圆点各绑一个监听器。
 * @param {Event} event
 */
function onNavClick(event) {
    event.stopPropagation();
    const dot = $(event.target).closest(`.${NAV_DOT_CLASS}`);
    if (dot.length === 0) return;
    const idx = parseInt(dot.attr('data-index'), 10);
    if (isNaN(idx)) return;
    const allMes = document.querySelectorAll('#chat .mes');
    const target = allMes[idx];
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

/** 创建常驻的消息圆点条容器（含背景进度条 + 圆点挂载层），已存在则跳过 */
function createNavControl() {
    if (document.querySelector(`.${NAV_CLASS}`)) return;
    const nav = $('<div>').addClass(NAV_CLASS).css('display', 'none');
    $('<div>').addClass(`${NAV_PROGRESS_CLASS}`).appendTo(nav); // 背景阅读进度条
    $('<div>').addClass(`${NAV_DOT_CLASS}-list`).appendTo(nav); // 圆点挂载层
    document.body.appendChild(nav[0]);
}

/**
 * 按当前消息集合重建圆点（数量 = 消息数；user/ai 不同色）。
 * 动态加载旧消息时由 repositionButtons / MutationObserver 触发重算。
 */
function rebuildNavDots() {
    const nav = document.querySelector(`.${NAV_CLASS}`);
    if (!nav) return;
    const list = nav.querySelector(`.${NAV_DOT_CLASS}-list`);
    if (!list) return;
    const allMes = document.querySelectorAll('#chat .mes');
    const total = allMes.length;
    if (list.childElementCount !== total) {
        list.innerHTML = '';
        for (let i = 0; i < total; i++) {
            const mes = allMes[i];
            const isUser = mes.getAttribute('is_user') === 'true';
            const dot = document.createElement('div');
            dot.className = `${NAV_DOT_CLASS} interactable`;
            dot.setAttribute('data-index', String(i));
            dot.style.setProperty('--dot-color', isUser ? NAV_DOT_USER_COLOR : NAV_DOT_AI_COLOR);
            list.appendChild(dot);
        }
    } else {
        // 数量未变时同步角色色（极少数情况角色判定在初次渲染后才稳定）
        for (let i = 0; i < total; i++) {
            const mes = allMes[i];
            const isUser = mes.getAttribute('is_user') === 'true';
            list.children[i].style.setProperty('--dot-color', isUser ? NAV_DOT_USER_COLOR : NAV_DOT_AI_COLOR);
        }
    }
}

/** 移除跨消息导航控件 */
function removeNavControl() {
    document.querySelector(`.${NAV_CLASS}`)?.remove();
}

/**
 * 把每条可见消息的两个按钮钉在聊天视口内、贴近该消息右边沿；不可见的隐藏。
 * 跳转底部的按钮贴消息顶部，跳转顶部的按钮贴消息底部，因此长消息滚动时始终在
 * 消息两端、不会跑出消息；短消息放不下时退化为中心竖排；整体夹在聊天视口内
 * 避开 ST 顶栏与输入区。
 */
function repositionButtons() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return;
    const chatRect = chatEl.getBoundingClientRect();
    const vpMin = chatRect.top + EDGE_GAP; // 聊天视口顶部（避免压到 ST 顶栏）
    const vpMax = chatRect.bottom - BUTTON_SIZE - EDGE_GAP; // 聊天视口底部（避免压到输入区）

    // 一次性收集消息元素映射，避免每个按钮都做一次属性选择器查询（原 O(N) 次扫描）
    const mesMap = new Map();
    document.querySelectorAll('#chat .mes').forEach((el) => {
        const id = el.getAttribute('mesid');
        if (id !== null) mesMap.set(id, el);
    });
    const hasMes = mesMap.size > 0;

    // 圆点条矩形（位于聊天视口右侧中部，竖向铺满聊天高度，与消息按钮同贴右缘）
    let navRect = null;
    if (hasMes) {
        const navLeft = chatRect.right - NAV_BAR_WIDTH - EDGE_GAP;
        const navW = NAV_BAR_WIDTH;
        const navTop = chatRect.top + NAV_VPAD;
        const navH = chatRect.height - NAV_VPAD * 2;
        navRect = { left: navLeft, top: navTop, right: navLeft + navW, bottom: navTop + navH };
    }

    const posCache = new Map();
    const buttons = document.querySelectorAll(`.${BUTTON_CLASS}`);
    buttons.forEach((btn) => {
        const mesId = btn.getAttribute('data-mes-id');
        const mesEl = mesId !== null ? mesMap.get(mesId) : null;
        if (!mesEl) {
            if (btn.style.display !== 'none') btn.style.display = 'none';
            return;
        }
        // 仅重排视口附近的消息按钮（由 IntersectionObserver 维护 visibleMesIds）；
        // 未就绪时回退为全部重排，保证首帧正确
        if (visibilityReady && !visibleMesIds.has(mesId)) {
            if (btn.style.display !== 'none') btn.style.display = 'none';
            return;
        }
        const mesRect = mesEl.getBoundingClientRect();
        const visible = mesRect.bottom > chatRect.top + 4 && mesRect.top < chatRect.bottom - 4;
        if (!visible) {
            if (btn.style.display !== 'none') btn.style.display = 'none';
            return;
        }
        if (btn.style.display === 'none') btn.style.display = '';

        let pos = posCache.get(mesId);
        if (!pos) {
            // 两个按钮分离定位：跳转「底部」的按钮（dir=bottom）贴在消息【顶部】，
            // 跳转「顶部」的按钮（dir=top）贴在消息【底部】；短消息放不下时退化为中心竖排。
            let colTopTop;     // 列整体上边界（用于避让判定，取两按钮中更靠上的）
            let colBottomTop;  // 列整体下边界（用于避让判定，取两按钮中更靠下的）
            let bottomBtnTop; // dir=bottom（跳转底部）按钮的 top：贴近消息可见顶部
            let topBtnTop;    // dir=top（跳转顶部）按钮的 top：贴近消息可见底部
            const needH = BUTTON_SIZE * 2 + BUTTON_GAP;

            const visTop = Math.max(mesRect.top, chatRect.top);
            const visBottom = Math.min(mesRect.bottom, chatRect.bottom);
            const visH = visBottom - visTop;

            if (visH >= needH) {
                // 消息可见高度足够：底按钮贴消息顶，顶按钮贴消息底（整体抬升 BOTTOM_LIFT 避开 swipe）
                bottomBtnTop = visTop + EDGE_GAP;
                topBtnTop = visBottom - BUTTON_SIZE - BOTTOM_LIFT;
                // 夹在聊天视口内，避免压到 ST 顶栏 / 输入区
                if (bottomBtnTop < vpMin) bottomBtnTop = vpMin;
                if (bottomBtnTop > vpMax) bottomBtnTop = vpMax;
                if (topBtnTop < vpMin) topBtnTop = vpMin;
                if (topBtnTop > vpMax) topBtnTop = vpMax;
            } else {
                // 短消息（或可见部分很短）：两按钮竖排居中于可见区间，整体夹在视口内
                const visCenter = visTop + visH / 2;
                let colTop = visCenter - needH / 2;
                if (colTop < vpMin) colTop = vpMin;
                const maxTop = vpMax + BUTTON_SIZE - needH;
                if (colTop > maxTop) colTop = maxTop;
                bottomBtnTop = colTop;
                topBtnTop = colTop + (BUTTON_SIZE + BUTTON_GAP);
            }
            colTopTop = Math.min(bottomBtnTop, topBtnTop);
            colBottomTop = Math.max(bottomBtnTop, topBtnTop) + BUTTON_SIZE;

            // 垂直避让：per-message 按钮位于圆点条左侧，通常不重叠；
            // 仅在极端情况下（如消息超宽等）仍做兜底避让
            if (navRect) {
                const colLeft = chatRect.right - NAV_BAR_WIDTH - BUTTON_SIZE - EDGE_GAP;
                const horizOverlap = Math.max(colLeft, navRect.left) < Math.min(colLeft + BUTTON_SIZE, navRect.right);
                if (horizOverlap) {
                    const colCenter = mesRect.top + mesRect.height / 2;
                    const navCenter = navRect.top + navRect.height / 2;
                    const intersects = colBottomTop > navRect.top && colTopTop < navRect.bottom;
                    if (intersects) {
                        if (colCenter <= navCenter) {
                            colBottomTop = navRect.top - NAV_AVOID_GAP - BUTTON_SIZE;
                        } else {
                            colTopTop = navRect.bottom + NAV_AVOID_GAP;
                        }
                        if (colTopTop < vpMin) colTopTop = vpMin;
                        const maxTopTop = vpMax + BUTTON_SIZE - needH;
                        if (colTopTop > maxTopTop) colTopTop = maxTopTop;
                        colBottomTop = colTopTop + needH;
                    }
                }
            }

            // 按方向给出各自 top：bottom(跳转底部)→消息顶；top(跳转顶部)→消息底
            const dirTops = { bottom: bottomBtnTop, top: topBtnTop };

            // 横向：per-message 按钮紧贴圆点条左侧，与圆点条间隔 BUTTON_GAP 不重叠
            const left = chatRect.right - NAV_BAR_WIDTH - BUTTON_GAP - BUTTON_SIZE - EDGE_GAP;
            pos = { dirTops, left };
            posCache.set(mesId, pos);
        }

        const dir = btn.getAttribute('data-dir');
        btn.style.top = `${pos.dirTops[dir]}px`;
        btn.style.left = `${pos.left}px`;
    });

    // 圆点条：常驻聊天视口右侧，竖向铺满聊天高度；圆点按消息索引等距比例分布，
    // 背景进度条与当前圆点高亮标出正在阅读的位置（每帧只动进度条高度 + 相邻两圆点）
    const navEl = document.querySelector(`.${NAV_CLASS}`);
    if (navEl) {
        navEl.style.display = hasMes ? '' : 'none';
        if (hasMes) {
            // 竖线撑满：圆点条高度 = 整个聊天视口高度（上下不留白），背景竖线由 CSS height:100% 贯穿到底
            const barH = chatRect.height;
            const barTop = chatRect.top;
            navEl.style.left = `${chatRect.right - NAV_BAR_WIDTH - EDGE_GAP}px`;
            navEl.style.top = `${barTop}px`;
            navEl.style.width = `${NAV_BAR_WIDTH}px`;
            navEl.style.height = `${barH}px`;

            const allMes = document.querySelectorAll('#chat .mes');
            const total = allMes.length;
            rebuildNavDots();

            // 圆点群：仅占圆点条高度的 NAV_DOT_ZONE_RATIO（紧凑密集），居中于整条内，
            // 竖线仍贯穿全长——圆点密集 + 竖线撑满两者兼顾
            const list = navEl.querySelector(`.${NAV_DOT_CLASS}-list`);
            if (list && list.childElementCount === total) {
                const zoneH = Math.min(barH * NAV_DOT_ZONE_RATIO, barH);
                const zoneTop = (barH - zoneH) / 2;
                const usableH = zoneH - NAV_DOT_SIZE;
                for (let i = 0; i < total; i++) {
                    const t = total > 1 ? i / (total - 1) : 0.5;
                    list.children[i].style.top = `${zoneTop + NAV_VPAD + t * (usableH - NAV_VPAD * 2)}px`;
                }
            }

            // 当前阅读位置：取视口顶部参考线那条消息，高亮对应圆点标出位置
            // （背景竖线已由 CSS height:100% 撑满整条，无需再动高度）
            const anchor = getAnchorMesEl();
            if (anchor) {
                const idx = Array.prototype.indexOf.call(allMes, anchor);
                if (idx !== -1 && list && lastActiveDot !== idx) {
                    if (lastActiveDot >= 0 && list.children[lastActiveDot]) {
                        list.children[lastActiveDot].classList.remove('active');
                    }
                    if (list.children[idx]) list.children[idx].classList.add('active');
                    lastActiveDot = idx;
                }
            }
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
    $(document).off('click.ccore-msg-nav').on('click.ccore-msg-nav', `.${NAV_CLASS}`, onNavClick);
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
    if (mesVisibilityObserver) {
        mesVisibilityObserver.disconnect();
        mesVisibilityObserver = null;
    }
    visibleMesIds = new Set();
    visibilityReady = false;
    lastActiveDot = -1;
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

/** 建立只观察视口附近消息的 IntersectionObserver，维护 visibleMesIds 供重排时过滤 */
function setupMesVisibilityObserver(chatEl) {
    if (mesVisibilityObserver) mesVisibilityObserver.disconnect();
    visibleMesIds = new Set();
    visibilityReady = false;
    mesVisibilityObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            const id = entry.target.getAttribute('mesid');
            if (id === null) continue;
            if (entry.isIntersecting) visibleMesIds.add(id);
            else visibleMesIds.delete(id);
        }
        visibilityReady = true;
        scheduleReposition();
    }, { root: chatEl, rootMargin: '300px 0px 300px 0px', threshold: 0 });
    chatEl.querySelectorAll('.mes').forEach((el) => mesVisibilityObserver.observe(el));
}

/** 把当前所有 .mes 交给可见性观察器（新增消息时调用，observe 重复调用安全） */
function observeAllMes() {
    if (!mesVisibilityObserver) return;
    document.querySelectorAll('#chat .mes').forEach((el) => mesVisibilityObserver.observe(el));
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
    setupMesVisibilityObserver(chatEl);

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
    opacity: 0.45;
    transition: opacity 0.2s;
    pointer-events: auto;
}
.ccore-msg-nav:hover,
.ccore-msg-nav:focus-within {
    opacity: 1;
}
/* 背景竖线：撑满整个圆点条高度，作为贯穿的阅读位置参考 */
.ccore-msg-nav-progress {
    position: absolute;
    left: 50%;
    top: 0;
    width: 2px;
    height: 100%;
    transform: translateX(-50%);
    background: ${NAV_PROGRESS_COLOR};
    border-radius: 1px;
    pointer-events: none;
}
/* 圆点挂载层 */
.ccore-msg-nav-dot-list {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}
.ccore-msg-nav-dot {
    position: absolute;
    left: 50%;
    width: ${NAV_DOT_SIZE}px;
    height: ${NAV_DOT_SIZE}px;
    margin-left: -${NAV_DOT_SIZE / 2}px;
    border-radius: 50%;
    background: var(--dot-color, ${NAV_PROGRESS_COLOR});
    border: 1px solid var(--SmartThemeBorderColor, rgba(128,128,128,0.9));
    cursor: pointer;
    pointer-events: auto;
    box-sizing: border-box;
    transition: transform 0.15s, box-shadow 0.15s;
}
.ccore-msg-nav-dot:hover {
    transform: scale(1.8);
}
.ccore-msg-nav-dot.active {
    transform: scale(1.8);
    box-shadow: 0 0 0 2px var(--smart-border-color, rgba(128,128,128,0.8));
}
`;
    document.head.appendChild(style);
}
