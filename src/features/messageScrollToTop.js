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
const EDGE_GAP = 0; // 按钮整列与聊天视口右/顶/底边的间距（越小越贴边）
const BUTTON_INSET = 48; // 跳顶/跳底按钮相对消息自身的顶/底内缩量（都不贴边）
const BUTTON_GAP = 4; // 相邻按钮之间的竖向间距
const NAV_AVOID_GAP = 6; // 消息按钮整列避让常驻跨消息控件时的额外间隙

// 每条消息内的按钮（消息内滚动）：单列竖排
const DIRS = ['top', 'bottom'];
const DIR_META = {
    top:    { icon: 'fa-arrow-up',    title: '滚动到消息顶部' },
    bottom: { icon: 'fa-arrow-down',  title: '滚动到消息底部' },
};

// 常驻聊天视口右侧中部的跨消息导航控件：消息圆点条（每个圆点 = 一条消息，
// user/ai 用不同醒目度的继承色，点击跳到该消息顶部；hover 显示楼层号；背景含阅读进度条）
const NAV_CLASS = 'ccore-msg-nav';
const NAV_DOT_CLASS = 'ccore-msg-nav-dot';
const NAV_PROGRESS_CLASS = 'ccore-msg-nav-progress';
// 圆点颜色：继承 ST 主题、且色相差异明显的一对清晰色，避免亮度相近看不出区别。
// 非 user（AI）用高亮橙色 QuoteColor，user 用柔和的薄荷绿 UnderlineColor（不醒目）。
const NAV_DOT_NONUSER_COLOR = 'var(--SmartThemeQuoteColor, rgb(225,138,36))';
const NAV_DOT_USER_COLOR = 'var(--SmartThemeUnderlineColor, rgb(188,231,207))';
const NAV_DOT_ENDPOINT_COLOR = 'var(--SmartThemeLinkColor, rgb(120,170,255))'; // 顶/底跳转特殊圆点（链接蓝继承色）
const NAV_PROGRESS_COLOR = 'var(--smart-border-color, rgba(128,128,128,0.6))'; // 背景竖线（撑满高度）
const NAV_SCROLL_HANDLE_CLASS = 'ccore-msg-nav-scroll-handle'; // 整条竖线末端的拖拽滑块（替代滚动条 thumb）
// handle 位置模式：true=贴已读线末端（与已读线联动）；false=整页滚动比例（原生滚动条 thumb 语义）。
// 两种逻辑都保留，后续想切回整页滚动模式改这里为 false 即可。
const NAV_HANDLE_TRACK_READLINE = true;
const NAV_DOT_SIZE = 6;      // 单个圆点视觉直径（px）
const NAV_DOT_HIT = 16;      // 圆点可点热区直径（px），大于视觉尺寸便于手机点按
// 基础热区放大到 hover scale(1.4) 的尺寸，使非 hover 热区与 hover 等大，手机无需先激活即可点中。
// 视觉圆点由 padding 维持 NAV_DOT_SIZE 不变；hover/active 的 scale(1.4) 仅作视觉反馈。
const NAV_DOT_HIT_SCALE = 1.4;
const NAV_DOT_HIT_MIN = 9;   // 热区最小直径（px），圆点过多缩到此值仍放不下则保持不重叠
const NAV_DOT_MIN_GAP = 4;   // 相邻圆点热区间最小额外间距（px），避免密集消息圆点重叠
const NAV_BAR_WIDTH = 14;    // 圆点条整体宽度（圆点 + 两侧留白）
const NAV_VPAD = 12;         // 圆点群上下留白（px），仅内缩圆点、不影响竖线撑满

let scrollObserver = null;
let refreshDebounceTimer = null;
let repositionScheduled = false;
let chatScrollEl = null;
let mesVisibilityObserver = null; // 仅观察视口附近消息，避免每帧对全部按钮算几何
let visibleMesIds = new Set();    // 当前与视口（含缓冲）相交的消息 mesid 集合
let visibleMesEls = new Set();    // 与 visibleMesIds 同步的消息元素引用集合（B 用，避免每帧从全量过滤）
let visibilityReady = false;      // 首个 IO 回调后置真，之后仅重排可见消息按钮
let lastActiveDot = -1;           // 上一帧高亮的圆点索引，避免每帧遍历全部圆点

// —— 性能优化缓存（A+D）——
let cachedAllMes = [];            // D) 由 MutationObserver 维护的全部 .mes 元素数组，避免每帧 querySelectorAll
let cachedCenters = null;         // A) 圆点中心 y 数组（相对 nav 条顶），布局不变时复用
let cachedCenterSig = '';         // A) 布局签名；变化（消息数/高度/视口高变）时重算 centers

/**
 * 为当前所有消息添加「滚动 / 跳转」按钮（挂在 body 上，按 mesid + dir 关联）
 */
export function addScrollTopButtonsToAllMessages() {
    try {
        if (!configManager.getExtensionConfig().scrollToTop.showPerMessageButtons) return; // 顶/底按钮开关
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

export function removeAllScrollTopButtons() {
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
        if (mesRect.height < chatRect.height) {
            // 短消息：垂直居中于视口，整条可见且在阅读舒适区
            const target = mesRect.top - chatRect.top + chatEl.scrollTop
                + mesRect.height / 2 - chatRect.height / 2;
            scrollChatTo(chatEl, Math.max(0, target));
        } else {
            // 长消息：顶部贴视口顶部（与现有方案一致）
            const target = mesRect.top - chatRect.top + chatEl.scrollTop;
            scrollChatTo(chatEl, Math.max(0, target));
        }
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
        scrollChatTo(chatEl, Math.max(0, target));
    } catch (e) {
        chatEl.scrollTop = Math.max(0, mesEl.offsetTop);
    }
}

/**
 * 统一滚动辅助：根据 SMOOTH_SCROLL 开关选择平滑滑动或直接跳转。
 * @param {HTMLElement} el 滚动容器（#chat）
 * @param {number} top 目标 scrollTop
 */
function scrollChatTo(el, top) {
    const smooth = configManager.getExtensionConfig().scrollToTop.smoothScroll !== false;
    el.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' });
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
    const endpoint = dot.attr('data-endpoint');
    if (endpoint === 'top') {
        const chatEl = document.getElementById('chat');
        if (chatEl) scrollChatTo(chatEl, 0);
        return;
    }
    if (endpoint === 'bottom') {
        const chatEl = document.getElementById('chat');
        if (chatEl) scrollChatTo(chatEl, chatEl.scrollHeight);
        return;
    }
    const idx = parseInt(dot.attr('data-index'), 10);
    if (isNaN(idx)) return;
    const allMes = document.querySelectorAll('#chat .mes');
    const target = allMes[idx];
    if (target) scrollMessageToTop(target);
}

/**
 * 点击竖线（已读段或背景段）任意位置：把点击 y 映射到对应消息并跳转，
 * 从而替代原生滚动条。映射依据各圆点中心在导航条上的坐标。
 * @param {Event} event
 */
function onNavLineClick(event) {
    event.stopPropagation();
    const navEl = document.querySelector(`.${NAV_CLASS}`);
    if (!navEl) return;
    const list = navEl.querySelector(`.${NAV_DOT_CLASS}-list`);
    const chatEl = document.getElementById('chat');
    if (!list || !chatEl) return;
    const navRect = navEl.getBoundingClientRect();
    const clickY = event.clientY - navRect.top; // 相对导航条顶

    // 收集所有圆点中心（相对导航条顶），含端点
    const centers = [];
    for (const dot of list.children) {
        const h = parseFloat(dot.style.height) || NAV_DOT_HIT * NAV_DOT_HIT_SCALE;
        const top = parseFloat(dot.style.top) || 0;
        centers.push({ y: top + h / 2, dot });
    }
    if (centers.length === 0) return;

    // 定位点击 y 落在哪两个相邻圆点之间
    if (clickY <= centers[0].y) {
        const ep = centers[0].dot.getAttribute('data-endpoint');
        if (ep === 'top') scrollChatTo(chatEl, 0);
        return;
    }
    if (clickY >= centers[centers.length - 1].y) {
        const ep = centers[centers.length - 1].dot.getAttribute('data-endpoint');
        if (ep === 'bottom') scrollChatTo(chatEl, chatEl.scrollHeight);
        return;
    }
    let lo = 0, hi = centers.length - 1;
    for (let i = 0; i < centers.length - 1; i++) {
        if (clickY >= centers[i].y && clickY <= centers[i + 1].y) { lo = i; hi = i + 1; break; }
    }
    const a = centers[lo], b = centers[hi];
    const span = (b.y - a.y) || 1;
    const frac = (clickY - a.y) / span; // 区间内相对比例 [0,1]

    // 目标消息 = 区间上方的圆点对应的消息（消息圆点从 children[1] 开始）
    const targetDot = a.dot;
    const endpoint = targetDot.getAttribute('data-endpoint');
    const allMes = Array.from(chatEl.querySelectorAll('#chat .mes'));
    if (endpoint === 'top') { scrollChatTo(chatEl, 0); return; }
    if (endpoint === 'bottom') { scrollChatTo(chatEl, chatEl.scrollHeight); return; }
    const idx = parseInt(targetDot.getAttribute('data-index'), 10);
    if (isNaN(idx)) return;
    const target = allMes[idx];
    if (!target) return;

    // 点竖线跳转：与已读线同源——以「视口底参考线（chatRect.bottom-2）」为基准，
    // 让该参考线落在目标消息内 frac 比例处（frac 即已读线用的区间比例），
    // 从而跳完后已读线底端正好对齐点击位置。短 / 长消息统一此几何，
    // 短消息因高度不足视口无法精确定位时夹在 [0, maxScroll] 内（趋势仍居中）。
    const chatRect = chatEl.getBoundingClientRect();
    const mesRect = target.getBoundingClientRect();
    const mesTopRel = mesRect.top - chatRect.top + chatEl.scrollTop;
    const viewBottomRel = chatRect.height - 2; // chatRect.bottom-2 相对 chat 顶
    let targetScroll = mesTopRel + frac * mesRect.height - viewBottomRel;
    const maxScroll = Math.max(0, chatEl.scrollHeight - chatRect.height);
    targetScroll = Math.min(Math.max(0, targetScroll), maxScroll);
    scrollChatTo(chatEl, targetScroll);
}

/**
 * 整条竖线末端滑块的拖拽：按住拖动 = 替代原生滚动条滚动聊天。
 * 位移按「nav 条高度 ↔ 聊天可滚动高度」比例换算；拖拽时阻止冒泡，
 * 避免松手时误触竖线点击跳转逻辑。
 * @param {PointerEvent} event
 */
function onScrollHandleDown(event) {
    event.stopPropagation();
    event.preventDefault();
    const handle = event.currentTarget;
    const navEl = handle.closest(`.${NAV_CLASS}`);
    const chatEl = document.getElementById('chat');
    if (!navEl || !chatEl) return;

    const navRect = navEl.getBoundingClientRect();
    const startY = event.clientY;
    const startScroll = chatEl.scrollTop;
    const scrollable = Math.max(1, chatEl.scrollHeight - chatEl.clientHeight);
    const ratio = scrollable / navRect.height; // 每 px 拖动对应聊天滚动量
    let dragging = false;

    const onMove = (e) => {
        const dy = e.clientY - startY;
        if (!dragging && Math.abs(dy) > 2) { dragging = true; handle.classList.add('dragging'); }
        const next = startScroll + dy * ratio;
        chatEl.scrollTop = Math.min(Math.max(0, next), scrollable);
    };
    const onUp = (e) => {
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        handle.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // 拖拽结束后吞掉随后的 click，避免误触竖线跳转
        if (dragging) {
            const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
            setTimeout(() => {
                document.addEventListener('click', swallow, { capture: true, once: true });
            }, 0);
        }
    };
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
}

/**
 * 取「当前正在关注」的锚点消息（决定高亮哪个圆点）：以视口【垂直中心】为基准，
 * 取包含中心参考线的消息——短消息居中时中心正好落在消息内，高亮即居中的那条，
 * 长消息贴顶时中心落在其内部，高亮即该长消息本身。已读线进度复用此 anchor、
 * 仍按视口底相对位置算比例，使高亮与进度对应同一消息、无错位。
 * @returns {HTMLElement|null}
 */
/** B) 取视口附近消息元素（由 IntersectionObserver 维护的 visibleMesEls）。
 *  未就绪或为空时回退全量，避免极快滚动过渡帧 IO 滞后导致 anchor / 已读线短暂丢失。 */
function getVisibleMes() {
    if (!visibilityReady || visibleMesEls.size === 0) return cachedAllMes;
    return Array.from(visibleMesEls);
}

function getAnchorMesEl() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) return null;
    const chatRect = chatEl.getBoundingClientRect();
    const refY = chatRect.top + chatRect.height / 2;
    if (cachedAllMes.length === 0) { refreshAllMesCache(); }
    if (cachedAllMes.length === 0) return null;
    const full = cachedAllMes;
    // B) 优先在视口附近消息里找 anchor（穿过视口的消息必被 IO 标记，正常必命中）；
    //    极快滚动过渡帧 IO 滞后导致可见集漏掉时，回退全量保证高亮不丢。
    const candidates = getVisibleMes();
    if (candidates !== full) {
        const anchor = candidates.find((el) => {
            const r = el.getBoundingClientRect();
            return r.top <= refY && r.bottom > refY;
        });
        if (anchor) return anchor;
    }
    // 全量 fallback（保留原逻辑）
    let best = null;
    let bestDist = Infinity;
    for (const el of full) {
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

/**
 * 取包含给定 y 坐标（相对视口）的消息；若 y 恰落在两消息缝隙，取中心最接近 y 的消息。
 * 用于已读段进度的独立锚点（视口底基准），与高亮锚点（视口中心）解耦。
 * @param {number} y 相对聊天视口顶的 y 坐标
 * @param {HTMLElement[]} allMes 当前全部消息元素
 * @returns {HTMLElement|null}
 */
function getMesAtY(y, allMes) {
    if (!allMes || allMes.length === 0) return null;
    // B) 优先在视口附近消息里找（视口底消息必穿过视口，正常必命中）；IO 滞后时回退全量
    const candidates = getVisibleMes();
    if (candidates !== allMes && candidates.length > 0) {
        const hit = candidates.find((el) => {
            const r = el.getBoundingClientRect();
            return r.top <= y && r.bottom > y;
        });
        if (hit) return hit;
    }
    const arr = Array.from(allMes);
    const hit = arr.find((el) => {
        const r = el.getBoundingClientRect();
        return r.top <= y && r.bottom > y;
    });
    if (hit) return hit;
    let best = null;
    let bestDist = Infinity;
    for (const el of arr) {
        const r = el.getBoundingClientRect();
        const c = r.top + r.height / 2;
        const d = Math.abs(c - y);
        if (d < bestDist) {
            bestDist = d;
            best = el;
        }
    }
    return best;
}

/** D) 刷新全部 .mes 缓存（由 MutationObserver / 初始化触发，避免每帧 querySelectorAll） */
function refreshAllMesCache() {
    cachedAllMes = Array.from(document.querySelectorAll('#chat .mes'));
}

/**
 * A) 按消息真实高度计算圆点中心 y（相对 nav 条顶）并应用到每个圆点 style。
 * 布局（消息数 / 高度 / 视口高）不变时复用缓存，避免每帧 O(N) offsetTop 读 + dot style 写。
 * @param {HTMLElement[]} allMes 当前全部消息元素
 * @param {number} total 消息数
 * @param {number} barH 圆点条高度（= 聊天视口高度）
 * @param {HTMLElement} list 圆点挂载层
 * @returns {number[]} 圆点中心 y 数组（长度 = total+2，含顶/底端点）
 */
function recomputeCenters(allMes, total, barH, list) {
    const centers = new Array(total + 2);
    centers[0] = NAV_VPAD;                 // 顶部端点钉在 zone 上边
    centers[total + 1] = barH - NAV_VPAD;  // 底部端点钉在 zone 下边
    const zoneTop = NAV_VPAD;
    const zoneBottom = barH - NAV_VPAD;
    const endpointReserve = NAV_DOT_HIT + 2; // 端点占位（直径 + 间隙），使消息圆点不与端点重叠
    const mesZoneTop = zoneTop + endpointReserve;
    const mesZoneBottom = zoneBottom - endpointReserve;
    if (total > 0) {
        const y0 = allMes[0].offsetTop;
        const lastMes = allMes[total - 1];
        const y1 = lastMes.offsetTop + lastMes.offsetHeight;
        const ySpan = Math.max(1, y1 - y0);
        for (let i = 0; i < total; i++) {
            const mes = allMes[i];
            const mesMid = (mes.offsetTop - y0) / ySpan; // 0..1：消息在整段中的相对中点
            centers[i + 1] = mesZoneTop + mesMid * (mesZoneBottom - mesZoneTop);
        }
    }
    // 自适应尺寸：圆点过多放不下时缩小热区/间距直到刚好铺满
    const need = total + 2;
    const availSpan = Math.max(1, barH - NAV_VPAD * 2);
    const desiredStep = NAV_DOT_HIT + NAV_DOT_MIN_GAP;
    const effStep = Math.min(desiredStep, availSpan / need);
    const effHit = Math.max(NAV_DOT_HIT_MIN, effStep - NAV_DOT_MIN_GAP) * NAV_DOT_HIT_SCALE;
    const effGap = effStep - effHit;
    // 最小可点击间距：相邻圆点中心若过近则向下推挤，保证热区不重叠
    const minStep = effHit + effGap;
    for (let k = 1; k < centers.length; k++) {
        if (centers[k] - centers[k - 1] < minStep) {
            centers[k] = Math.min(centers[k - 1] + minStep, barH - effHit / 2);
        }
    }
    // 若底部被推挤越界，则从下往上回推（保持端点钉底）
    for (let k = centers.length - 2; k >= 0; k--) {
        if (centers[k + 1] - centers[k] < minStep) {
            centers[k] = Math.max(centers[k + 1] - minStep, effHit / 2);
        }
    }
    // 应用：动态设置热区尺寸 + top（热区盒左上，减去半径）
    for (let k = 0; k < centers.length; k++) {
        const dot = list.children[k];
        const pad = Math.max(0, (effHit - NAV_DOT_SIZE) / 2);
        dot.style.width = `${effHit}px`;
        dot.style.height = `${effHit}px`;
        dot.style.marginLeft = `${-effHit / 2}px`;
        dot.style.padding = `${pad}px`;
        dot.style.top = `${centers[k] - effHit / 2}px`;
    }
    // 仅在布局变化（低频）时同步消息圆点颜色与楼层号，覆盖「is_user 判定初次渲染后才稳定」的边界，
    // 避免每帧 O(N) 样式写（原 rebuildNavDots 的 else 分支是滚轮卡顿残留主因）。
    if (total > 0) {
        for (let i = 0; i < total; i++) {
            const mes = allMes[i];
            const dot = list.children[i + 1]; // +1 跳过顶部端点圆点
            if (!dot) continue;
            const isUser = mes.getAttribute('is_user') === 'true';
            dot.style.setProperty('--dot-color', isUser ? NAV_DOT_USER_COLOR : NAV_DOT_NONUSER_COLOR);
            const mesId = mes.getAttribute('mesid');
            if (mesId) dot.title = `楼层 ${mesId}`;
        }
    }
    return centers;
}

/** 计算圆点布局签名：消息数 / 视口高 / 首尾消息 offsetTop·offsetHeight 任一变化即需重算 centers */
function computeCenterSig(allMes, total, barH) {
    const f = allMes[0];
    const l = allMes[total - 1];
    return `${total}|${Math.round(barH)}`
        + `|${f ? f.offsetTop : 0}|${f ? f.offsetHeight : 0}`
        + `|${l ? l.offsetTop : 0}|${l ? l.offsetHeight : 0}`;
}

/** 创建常驻的消息圆点条容器（含背景进度条 + 圆点挂载层），已存在则跳过 */
function createNavControl() {
    if (document.querySelector(`.${NAV_CLASS}`)) return;
    const nav = $('<div>').addClass(NAV_CLASS).css('display', 'none');
    $('<div>').addClass(`${NAV_PROGRESS_CLASS}`).appendTo(nav); // 背景竖线（整条，未读/底部分）
    $('<div>').addClass(`${NAV_SCROLL_HANDLE_CLASS}`).appendTo(nav); // 末端拖拽滑块（nav 直属子，层级高于已读线，可盖线且可点中）
    $('<div>').addClass(`${NAV_PROGRESS_CLASS}-read`).appendTo(nav); // 已读竖线（active 圆点以下段，染 active 色）
    $('<div>').addClass(`${NAV_DOT_CLASS}-list`).appendTo(nav); // 圆点挂载层
    document.body.appendChild(nav[0]);
}

/**
 * 按当前消息集合重建圆点（数量 = 消息数；user/ai 不同色；hover 显示楼层号）。
 * 动态加载旧消息时由 repositionButtons / MutationObserver 触发重算。
 */
function rebuildNavDots() {
    const nav = document.querySelector(`.${NAV_CLASS}`);
    if (!nav) return;
    const list = nav.querySelector(`.${NAV_DOT_CLASS}-list`);
    if (!list) return;
    const allMes = cachedAllMes;
    const total = allMes.length;
    // 圆点总数 = 消息数 + 顶/底两个特殊端点圆点（跳转聊天最顶 / 最底）
    const need = total > 0 ? total + 2 : 0;
    if (list.childElementCount !== need) {
        list.innerHTML = '';
        // 顶部端点圆点
        if (total > 0) {
            const topDot = document.createElement('div');
            topDot.className = `${NAV_DOT_CLASS} interactable ${NAV_DOT_CLASS}-endpoint`;
            topDot.setAttribute('data-endpoint', 'top');
            topDot.style.setProperty('--dot-color', NAV_DOT_ENDPOINT_COLOR);
            topDot.title = '跳到聊天最顶部';
            list.appendChild(topDot);
        }
        for (let i = 0; i < total; i++) {
            const mes = allMes[i];
            const isUser = mes.getAttribute('is_user') === 'true';
            const dot = document.createElement('div');
            dot.className = `${NAV_DOT_CLASS} interactable`;
            dot.setAttribute('data-index', String(i));
            dot.style.setProperty('--dot-color', isUser ? NAV_DOT_USER_COLOR : NAV_DOT_NONUSER_COLOR);
            const mesId = mes.getAttribute('mesid');
            if (mesId) dot.title = `楼层 ${mesId}`;
            list.appendChild(dot);
        }
        // 底部端点圆点
        if (total > 0) {
            const botDot = document.createElement('div');
            botDot.className = `${NAV_DOT_CLASS} interactable ${NAV_DOT_CLASS}-endpoint`;
            botDot.setAttribute('data-endpoint', 'bottom');
            botDot.style.setProperty('--dot-color', NAV_DOT_ENDPOINT_COLOR);
            botDot.title = '跳到聊天最底部';
            list.appendChild(botDot);
        }
    } else {
        // 数量未变时【不】每帧重设颜色/title：否则长聊天每帧对全部圆点做 O(N) 样式写，
        // 触发强制布局导致滚轮卡顿。角色色与楼层号在上方「数量变化」分支已设置，
        // 纯滚动时 mes 结构不变、is_user/楼层号稳定，无需重复写。
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
    if (cachedAllMes.length === 0) refreshAllMesCache();
    const mesMap = new Map();
    cachedAllMes.forEach((el) => {
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
                // 消息可见高度足够：底按钮内缩于消息顶，顶按钮内缩于消息底，顶底留白统一为 BUTTON_INSET
                bottomBtnTop = visTop + BUTTON_INSET;
                topBtnTop = visBottom - BUTTON_SIZE - BUTTON_INSET;
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

    // 圆点条：常驻聊天视口右侧，竖向铺满聊天高度；圆点按消息真实高度分布，
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

            const allMes = cachedAllMes;
            const total = allMes.length;
            rebuildNavDots();

            // 圆点铺满整条竖线高度（仅上下留 NAV_VPAD 缓冲、端点占位内缩）
            const list = navEl.querySelector(`.${NAV_DOT_CLASS}-list`);
            if (list && list.childElementCount === total + 2) {
                // A) 圆点中心仅在「布局签名」变化时才重算（消息数 / 视口高 / 首尾高度变），
                //    否则复用缓存，避免每帧 O(N) offsetTop 读 + dot style 写造成的强制同步布局。
                const sig = computeCenterSig(allMes, total, barH);
                if (sig !== cachedCenterSig || !cachedCenters) {
                    cachedCenters = recomputeCenters(allMes, total, barH, list);
                    cachedCenterSig = sig;
                }
            }

            // 高亮圆点（用户关注的消息）与已读段进度（读到的位置）解耦、各自用最合适的基准：
            //  - 高亮：视口【中心】基准（getAnchorMesEl），短消息居中时高亮居中的那条；
            //  - 已读段：视口【底】基准独立算进度，反映「读到哪」，与高亮互不干扰、各自正确。
            const anchor = getAnchorMesEl();           // 高亮用：视口中心
            const readLine = navEl.querySelector(`.${NAV_PROGRESS_CLASS}-read`);
            let readLineBottom = null; // 已读线末端 y（相对 nav 条顶），供拖拽滑块对齐

            // —— 高亮圆点（视口中心基准）——
            if (anchor && list) {
                const idx = Array.prototype.indexOf.call(allMes, anchor);
                if (idx !== -1) {
                    const activeChildIdx = idx + 1; // 消息圆点从 children[1] 开始
                    if (lastActiveDot !== activeChildIdx) {
                        if (lastActiveDot >= 0 && list.children[lastActiveDot]) {
                            list.children[lastActiveDot].classList.remove('active');
                        }
                        if (list.children[activeChildIdx]) list.children[activeChildIdx].classList.add('active');
                        lastActiveDot = activeChildIdx;
                    }
                }
            } else if (readLine) {
                readLine.style.display = 'none';
            }

            // —— 已读竖线（视口底基准，独立锚点）——
            // 进度 anchor：视口底参考线包含的消息；进度 = 该消息顶→底被视口底扫过的比例。
            const pAnchor = getMesAtY(chatRect.bottom - 2, allMes);
            if (pAnchor && list) {
                const pIdx = Array.prototype.indexOf.call(allMes, pAnchor);
                if (pIdx !== -1) {
                    const pDotIdx = pIdx + 1;
                    const pDot = list.children[pDotIdx];
                    const nextDot = list.children[pDotIdx + 1];
                    if (pDot && nextDot && readLine) {
                        const dotH = parseFloat(pDot.style.height) || NAV_DOT_HIT * NAV_DOT_HIT_SCALE;
                        const aCenter = parseFloat(pDot.style.top) + dotH / 2;
                        const nH = parseFloat(nextDot.style.height) || NAV_DOT_HIT * NAV_DOT_HIT_SCALE;
                        const nCenter = parseFloat(nextDot.style.top) + nH / 2;
                        const aRect = pAnchor.getBoundingClientRect();
                        const span = aRect.height || 1;
                        let p = (chatRect.bottom - 2 - aRect.top) / span;
                        if (p < 0) p = 0; else if (p > 1) p = 1;
                        readLineBottom = aCenter + p * (nCenter - aCenter);
                        const color = pDot.style.getPropertyValue('--dot-color') || NAV_PROGRESS_COLOR;
                        readLine.style.top = `${aCenter}px`;
                        readLine.style.height = `${Math.max(0, readLineBottom - aCenter)}px`;
                        readLine.style.setProperty('--read-color', color);
                        readLine.style.display = '';
                    }
                }
            } else if (readLine) {
                readLine.style.display = 'none';
            }

            // —— 拖拽滑块定位 ——
            // 模式一（NAV_HANDLE_TRACK_READLINE=true）：贴在已读线末端（readLineBottom），
            //   拖它=滚聊天，已读线随滚动实时变化、滑块始终戴在末端。
            // 模式二（false）：整页滚动比例（原生滚动条 thumb 语义），活动范围限制在
            //   顶/底端点圆点内侧边缘之间，不超出、也不盖住端点圆点。
            const handle = navEl.querySelector(`.${NAV_SCROLL_HANDLE_CLASS}`);
            if (handle) {
                const hh = handle.offsetHeight || 12;
                if (NAV_HANDLE_TRACK_READLINE) {
                    if (readLineBottom !== null) {
                        handle.style.top = `${readLineBottom - hh / 2}px`;
                        handle.style.display = '';
                    } else {
                        handle.style.display = 'none';
                    }
                } else {
                    const scrollable = Math.max(1, chatEl.scrollHeight - chatEl.clientHeight);
                    const ratio = Math.min(1, chatEl.scrollTop / scrollable);
                    const edge = NAV_VPAD + (NAV_DOT_HIT * NAV_DOT_HIT_SCALE) / 2 + 2; // 端点圆点外缘 + 间隙
                    const topMin = edge;                          // 滑块中心最低点（不盖顶圆点）
                    const topMax = Math.max(topMin, barH - edge); // 滑块中心最高点（不盖底圆点）
                    const span = Math.max(1, topMax - topMin);
                    handle.style.top = `${topMin + ratio * span - hh / 2}px`;
                    handle.style.display = '';
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
    if (!configManager.getExtensionConfig().scrollToTop.enabled) {
        removeMessageScrollToTop();
        return;
    }
    injectStyles();
    setupChatObserver();
    $(document).off('click.ccore-scroll-to-top').on('click.ccore-scroll-to-top', `.${BUTTON_CLASS}`, onButtonClick);
    $(document).off('click.ccore-msg-nav').on('click.ccore-msg-nav', `.${NAV_CLASS}`, onNavClick);
    $(document).off('click.ccore-msg-nav-line').on('click.ccore-msg-nav-line', `.${NAV_PROGRESS_CLASS}, .${NAV_PROGRESS_CLASS}-read`, onNavLineClick);
    // 整条竖线末端拖拽滑块：拖动 = 替代原生滚动条滚动聊天
    $(document).off('pointerdown.ccore-msg-nav-handle').on('pointerdown.ccore-msg-nav-handle', `.${NAV_SCROLL_HANDLE_CLASS}`, onScrollHandleDown);
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
    visibleMesEls = new Set();
    visibilityReady = false;
    lastActiveDot = -1;
    cachedAllMes = [];
    cachedCenters = null;
    cachedCenterSig = '';
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
    $(document).off('click.ccore-msg-nav-line');
    removeAllScrollTopButtons();
    removeNavControl();
    document.getElementById(STYLE_ID)?.remove();
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
            if (entry.isIntersecting) { visibleMesIds.add(id); visibleMesEls.add(entry.target); }
            else { visibleMesIds.delete(id); visibleMesEls.delete(entry.target); }
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
            refreshAllMesCache();
            addScrollTopButtonsToAllMessages();
            refreshDebounceTimer = null;
        }, 200);
    });
    scrollObserver.observe(chatEl, { childList: true });
    setupMesVisibilityObserver(chatEl);
    refreshAllMesCache();

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
    pointer-events: auto;
}
/* 半透明只作用于线和圆点（hover 导航条时变清晰）；拖拽滑块 handle 保持不透明 */
/* 背景竖线：粗热区(透明)用于点击跳转，可见细线由 ::before 绘制(2px) */
.ccore-msg-nav-progress {
    position: absolute;
    left: 50%;
    top: 0;
    width: 10px;
    height: 100%;
    transform: translateX(-50%);
    background: transparent;
    pointer-events: auto;
    cursor: pointer;
    z-index: 0;
}
.ccore-msg-nav-progress::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    width: 2px;
    height: 100%;
    transform: translateX(-50%);
    background: ${NAV_PROGRESS_COLOR};
    border-radius: 1px;
    opacity: 0.5;
    transition: opacity 0.2s;
}
/* 已读竖线：粗热区(透明)可点击，可见细线由 ::before 绘制(2px)，颜色取 --read-color */
.ccore-msg-nav-progress-read {
    position: absolute;
    left: 50%;
    top: 0;
    width: 10px;
    height: 0;
    transform: translateX(-50%);
    background: transparent;
    pointer-events: auto;
    cursor: pointer;
    transition: background-color 0.15s;
    z-index: 1;
}
.ccore-msg-nav-progress-read::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    width: 2px;
    height: 100%;
    transform: translateX(-50%);
    background: var(--read-color, ${NAV_PROGRESS_COLOR});
    border-radius: 1px;
    opacity: 0.7;
    transition: opacity 0.2s;
}
/* 整条竖线末端拖拽滑块（替代原生滚动条 thumb）：默认隐藏，hover 导航条或拖拽时显示 */
.ccore-msg-nav-scroll-handle {
    position: absolute;
    left: 50%;
    top: 0;
    width: 14px;
    height: 14px;
    transform: translateX(-50%);
    background: var(--SmartThemeLinkColor, rgb(120,170,255));
    /* 对称菱形裁剪（等宽等高），避免与圆点混淆 */
    clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
    box-sizing: border-box;
    cursor: ns-resize;
    pointer-events: auto;
    opacity: 1;
    touch-action: none;
    transition: transform 0.15s;
    z-index: 4;
}
.ccore-msg-nav-scroll-handle:hover,
.ccore-msg-nav-scroll-handle.dragging {
    transform: translateX(-50%) scale(1.3);
}
/* 用本功能竖线/滑块替代原生滚动条：隐藏 #chat 原生滚动条（功能关闭时随样式一并移除） */
#chat::-webkit-scrollbar {
    display: none !important;
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
    width: ${NAV_DOT_HIT}px;
    height: ${NAV_DOT_HIT}px;
    margin-left: -${NAV_DOT_HIT / 2}px;
    padding: ${(NAV_DOT_HIT - NAV_DOT_SIZE) / 2}px;
    border-radius: 50%;
    background: var(--dot-color, ${NAV_PROGRESS_COLOR});
    background-clip: content-box;
    -webkit-background-clip: content-box;
    border: none;
    cursor: pointer;
    pointer-events: auto;
    box-sizing: border-box;
    transition: transform 0.15s, box-shadow 0.15s;
    z-index: 2;
    opacity: 0.6;
}
.ccore-msg-nav:hover .ccore-msg-nav-progress::before,
.ccore-msg-nav:hover .ccore-msg-nav-progress-read::before,
.ccore-msg-nav:hover .ccore-msg-nav-dot {
    opacity: 1;
}
.ccore-msg-nav-dot:hover {
    transform: scale(1.4);
}
.ccore-msg-nav-dot.active {
    transform: scale(1.4);
}
`;
    document.head.appendChild(style);
}
