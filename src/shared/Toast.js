// src/shared/Toast.js
// 通用消息通知（toast）组件：替代 window.alert 的浏览器弹窗。
// 供所有 iframe editor（module-editor / generator-editor / nai-preset-switcher 等）共用。
// 样式定义在 src/shared/styles/editor-shell.css 的「通用 Toast 通知」区块，
// 使用 themes.css 变量，浅色/深色主题自动生效。
//
// 用法：
//   import { showToast } from '../../shared/Toast.js';
//   showToast(doc, '保存成功', 'success');   // success | error | info | warning
//
// 特性：
// - 自动消失（默认 3s），可传第 4 参覆盖
// - 可点击手动关闭
// - 同一容器内多条 toast 纵向堆叠，自动清理已消失节点

const TOAST_CONTAINER_CLASS = 'cc-toast-container';
const TOAST_DEFAULT_DURATION = 3000;

const TOAST_ICONS = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
};

/**
 * 显示一条消息通知。
 * @param {Document} doc 目标 iframe 的 document
 * @param {string} message 消息文本（textContent 注入，防 XSS）
 * @param {'success'|'error'|'warning'|'info'} [type='info']
 * @param {number} [duration=3000] 展示毫秒数
 * @returns {() => void} 返回手动关闭函数
 */
export function showToast(doc, message, type = 'info', duration = TOAST_DEFAULT_DURATION) {
    const container = getOrCreateContainer(doc);
    const toast = doc.createElement('div');
    toast.className = `cc-toast cc-toast-${TOAST_ICONS[type] ? type : 'info'}`;
    toast.innerHTML = `<span class="cc-toast-icon"></span><span class="cc-toast-msg"></span>`;
    toast.querySelector('.cc-toast-icon').textContent = TOAST_ICONS[type] || TOAST_ICONS.info;
    toast.querySelector('.cc-toast-msg').textContent = String(message);

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
    setTimeout(close, duration);

    // 下一帧再加 show class，确保进入动画生效
    requestAnimationFrame(() => toast.classList.add('cc-toast-show'));
    return close;
}

/**
 * 简化入口：错误通知。
 * @param {Document} doc
 * @param {string} message
 */
export function showErrorToast(doc, message) {
    showToast(doc, message, 'error');
}

/**
 * 简化入口：成功通知。
 * @param {Document} doc
 * @param {string} message
 */
export function showSuccessToast(doc, message) {
    showToast(doc, message, 'success');
}

function getOrCreateContainer(doc) {
    let container = doc.querySelector('.' + TOAST_CONTAINER_CLASS);
    if (!container) {
        container = doc.createElement('div');
        container.className = TOAST_CONTAINER_CLASS;
        doc.body.appendChild(container);
    }
    return container;
}
