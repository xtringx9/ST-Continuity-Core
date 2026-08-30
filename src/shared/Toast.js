// src/shared/Toast.js
// 通用消息通知（toast）组件：替代 window.alert 的浏览器弹窗。
// ⚠️ 2026-08-18 全局化：容器挂到「父窗口 document」（window.top 同源），
//   position: fixed 贴视口边（而非 iframe 窗口边）。即使不打开任何 iframe
//   （如父窗口的保存/抛弃操作）也可调用。
// ⚠️ 样式自带注入：父窗口（ST 主页面）不加载 editor-shell.css，Toast.js 首次
//   调用时把 toast 样式以 <style> 注入挂载 document；editor-shell.css 中的
//   toast 样式保留（兼容 iframe 内加载它的场景）。
// 使用 themes.css 变量（挂载文档需已定义；父窗口场景由调用方保证主题可用）。
//
// 用法：
//   import { showToast } from '../../shared/Toast.js';
//   showToast('保存成功', 'success');      // doc 可省略 → 挂父窗口
//   showToast(doc, '保存成功', 'success'); // 兼容旧签名（doc 被忽略，始终挂父窗口）
//
// 特性：
// - 自动消失（默认 3s），可传第 3/4 参覆盖
// - 可点击手动关闭
// - 同一容器内多条 toast 纵向堆叠，自动清理已消失节点

const TOAST_CONTAINER_CLASS = 'cc-toast-container';
const TOAST_STYLE_ID = 'cc-toast-injected-style';
const TOAST_DEFAULT_DURATION = 3000;
// —— 动态时长：仅当 showToast 显式传入 duration='auto' 时按内容长度计算；默认/显式数字时长不受影响 ——
const TOAST_MIN_DURATION = 3000;
const TOAST_MAX_DURATION = 12000;
const TOAST_DURATION_PER_UNIT = 70; // 每个视觉单位（中文/全角≈2、英文/半角≈1）的毫秒数

/** 按文本视觉长度计算 toast 显示时长（中文按 2 单位计），结果夹在 [TOAST_MIN_DURATION, TOAST_MAX_DURATION] */
function calcAutoDuration(text) {
    const s = String(text ?? '');
    let units = 0;
    for (const ch of s) units += ch.codePointAt(0) > 0xFF ? 2 : 1;
    return Math.min(TOAST_MAX_DURATION, Math.max(TOAST_MIN_DURATION, units * TOAST_DURATION_PER_UNIT));
}

const TOAST_ICONS = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
};

/** 主题存储 key（与各 iframe 编辑器共用同一份） */
const THEME_KEY = 'st_continuity_theme';

/** toast 样式（自包含，不依赖 editor-shell.css）
 *  主题变量限定作用域到 .cc-toast-container，不注入 :root，避免影响 ST 主页面与父窗口其它插件元素。 */
const TOAST_CSS = `
.${TOAST_CONTAINER_CLASS} {
    /* 亮色（对应 themes.css :root 中的 toast 用到的变量） */
    --bg-app: #ffffff;
    --bg-card: #ffffff;
    --text-primary: #111827;
    --border-color: #e5e7eb;
    --accent-color: #2563eb;
    --danger-color: #ef4444;
    --success-color: #22c55e;
    color-scheme: light;
}
.${TOAST_CONTAINER_CLASS}[data-theme="dark"] {
    /* 深色（对应 themes.css [data-theme="dark"]；danger/success 沿用亮色值） */
    --bg-app: #18181b;
    --bg-card: #27272a;
    --text-primary: #f4f4f5;
    --border-color: #3f3f46;
    --accent-color: #3b82f6;
    --danger-color: #ef4444;
    --success-color: #22c55e;
    color-scheme: dark;
}
.${TOAST_CONTAINER_CLASS} {
    position: fixed;
    top: var(--cc-toast-top, 32px);
    left: 12px;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(420px, calc(100vw - 24px));
    pointer-events: none;
}
.${TOAST_CONTAINER_CLASS} .cc-toast {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 14px;
    background: var(--bg-card, #fff);
    color: var(--text-primary, #111827);
    border: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
    border-left: 3px solid var(--accent-color, #2563eb);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    font-size: 13px;
    line-height: 1.45;
    cursor: pointer;
    user-select: none;
    opacity: 0;
    transform: translateX(-24px);
    transition: opacity 0.25s ease, transform 0.25s ease;
    pointer-events: auto;
}
.${TOAST_CONTAINER_CLASS} .cc-toast.cc-toast-show {
    opacity: 1;
    transform: translateX(0);
}
.${TOAST_CONTAINER_CLASS} .cc-toast-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    color: var(--bg-app, #fff);
}
.${TOAST_CONTAINER_CLASS} .cc-toast-success { border-left-color: var(--success-color, #22c55e); }
.${TOAST_CONTAINER_CLASS} .cc-toast-success .cc-toast-icon { background: var(--success-color, #22c55e); }
.${TOAST_CONTAINER_CLASS} .cc-toast-error { border-left-color: var(--danger-color, #ef4444); }
.${TOAST_CONTAINER_CLASS} .cc-toast-error .cc-toast-icon { background: var(--danger-color, #ef4444); }
.${TOAST_CONTAINER_CLASS} .cc-toast-warning { border-left-color: #f59e0b; }
.${TOAST_CONTAINER_CLASS} .cc-toast-warning .cc-toast-icon { background: #f59e0b; }
.${TOAST_CONTAINER_CLASS} .cc-toast-info { border-left-color: var(--accent-color, #2563eb); }
.${TOAST_CONTAINER_CLASS} .cc-toast-info .cc-toast-icon { background: var(--accent-color, #2563eb); }
.${TOAST_CONTAINER_CLASS} .cc-toast-msg {
    min-width: 0;
    word-break: break-word;
    white-space: pre-line;
}
`;

/**
 * 解析挂载 document（优先父窗口，保证贴视口边 + 全局可见）：
 * - iframe 内：window.top 同源 → 挂父窗口
 * - 父窗口场景：当前 window.document
 * @param {Document} [doc] 兼容参数（仅父窗口场景兜底）
 * @returns {Document|null}
 */
function _resolveMountDoc(doc) {
    try {
        if (window.top && window.top.document && window.top.document !== window.document) {
            return window.top.document;
        }
    } catch (e) {
        // 跨域限制时忽略
    }
    return doc || window.document;
}

/** 向挂载文档注入 toast 样式（幂等） */
function ensureStyle(doc) {
    if (doc.getElementById(TOAST_STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = TOAST_STYLE_ID;
    style.textContent = TOAST_CSS;
    doc.head.appendChild(style);
}

/**
 * 显示一条消息通知（挂父窗口 document，贴视口边，全局可见）。
 * 支持两种签名：
 *   showToast(message, type, duration)
 *   showToast(doc, message, type, duration)   // 兼容旧签名（doc 忽略）
 * @param {Document|string} docOrMessage
 * @param {string} [message]
 * @param {'success'|'error'|'warning'|'info'} [type='info']
 * @param {number} [duration=3000]
 * @returns {() => void} 返回手动关闭函数
 */
export function showToast(docOrMessage, message, type = 'info', duration = TOAST_DEFAULT_DURATION) {
    let text = '';
    /** @type {'success'|'error'|'warning'|'info'} */
    let t = type;
    let dur = duration;
    if (docOrMessage && typeof docOrMessage !== 'string' && docOrMessage.nodeType === 9) {
        // 旧签名：第 1 参是 Document
        text = String(message ?? '');
        t = type;
        dur = duration;
    } else {
        // 新签名：第 1 参是消息文本
        text = String(docOrMessage ?? '');
        const typeFromMsg = message || 'info';
        t = (typeFromMsg === 'success' || typeFromMsg === 'error' || typeFromMsg === 'warning' || typeFromMsg === 'info')
            ? typeFromMsg : 'info';
        dur = typeof type === 'number' ? type : duration;
    }
    // ⚠️ 'auto' 动态时长：必须在 text 确定之后计算（此前提前计算会拿到空串 → 退化为最短时长，
    //    且新签名分支会再把 dur 覆盖回去，导致 'auto' 从未生效——presetSaveDiff 的旧调用即如此）。
    if (dur === 'auto') dur = calcAutoDuration(text);

    const mountDoc = _resolveMountDoc(typeof docOrMessage === 'string' ? null : docOrMessage);
    if (!mountDoc) return () => {};
    ensureStyle(mountDoc);
    const container = getOrCreateContainer(mountDoc);
    const toast = mountDoc.createElement('div');
    toast.className = `cc-toast cc-toast-${TOAST_ICONS[t] ? t : 'info'}`;
    toast.innerHTML = `<span class="cc-toast-icon"></span><span class="cc-toast-msg"></span>`;
    toast.querySelector('.cc-toast-icon').textContent = TOAST_ICONS[t] || TOAST_ICONS.info;
    toast.querySelector('.cc-toast-msg').textContent = text;

    container.appendChild(toast);

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        toast.classList.remove('cc-toast-show');
        // 动画结束后移除节点，避免残留 DOM
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 250);
    };

    // 手动点击关闭
    toast.addEventListener('click', close);
    // 自动消失
    setTimeout(close, dur);

    // 下一帧再加 show class，确保进入动画生效
    requestAnimationFrame(() => toast.classList.add('cc-toast-show'));
    return close;
}

/**
 * 简化入口：错误通知（挂父窗口，全局可见）。
 * @param {Document|string} docOrMessage
 * @param {string} [message]
 */
export function showErrorToast(docOrMessage, message) {
    showToast(docOrMessage, message, 'error');
}

/**
 * 简化入口：成功通知（挂父窗口，全局可见）。
 * @param {Document|string} docOrMessage
 * @param {string} [message]
 */
export function showSuccessToast(docOrMessage, message) {
    showToast(docOrMessage, message, 'success');
}

// ⚠️ 便捷方法（2026-08-23）：给 showToast 挂上 .error/.warning/.success/.info，
// 便于把 ST 的 toastr.error(...) 等批量替换为 showToast.error(...)，保持调用形态一致。
//   showToast.error('出错了')
//   showToast.warning('注意')
//   showToast.success('完成')
//   showToast.info('提示')
showToast.error = (msg, duration) => showToast(msg, 'error', duration);
showToast.warning = (msg, duration) => showToast(msg, 'warning', duration);
showToast.success = (msg, duration) => showToast(msg, 'success', duration);
showToast.info = (msg, duration) => showToast(msg, 'info', duration);

function getOrCreateContainer(doc) {
    let container = doc.querySelector('.' + TOAST_CONTAINER_CLASS);
    if (!container) {
        container = doc.createElement('div');
        container.className = TOAST_CONTAINER_CLASS;
        doc.body.appendChild(container);
    }
    syncContainerTheme(container, doc);
    return container;
}

/**
 * 让 toast 容器跟随 iframe 主题（light/dark）。
 * 读取/监听各编辑器共用的 localStorage['st_continuity_theme']，把 data-theme
 * 设置到容器自身（作用域限定，不影响 ST 主页面 / 父窗口其它插件元素）。
 * 幂等：storage 监听只绑定一次。
 */
function syncContainerTheme(container, doc) {
    try {
        container.dataset.theme = localStorage.getItem(THEME_KEY) || 'light';
    } catch (e) {
        container.dataset.theme = 'light';
    }
    if (container._ccThemeBound) return;
    container._ccThemeBound = true;
    const win = doc.defaultView || (doc === window.document ? window : null);
    if (!win) return;
    try {
        win.addEventListener('storage', (e) => {
            if (e.key === THEME_KEY) {
                container.dataset.theme = e.newValue || 'light';
            }
        });
    } catch (e) { /* ignore */ }
}
