// 发送键劫持：点击发送键 / 回车不直接发送，改为执行指定的 Quick Reply。
//
// 关键约束（详见 MEMORY.md「ST 发送链路与 QuickReply API」）：
// 1) 发送有两条独立入口——#send_but click 与 #send_textarea Enter keydown——只拦其一会漏。
// 2) 拦截必须在 capture 阶段 + stopImmediatePropagation()，才能压住 ST 直绑在元素上的 jQuery bubble handler。
// 3) quickReplyApi 在 APP_READY 后才 ready，未就绪时回退原生发送。
// 4) 输入框内容交给目标 QR 自行用 {{input}} 处理，本模块不读不写 textarea。

import configManager from '../../singleton/configManager.js';
import { debugLog } from '../../utils/logger.js';

const SEND_BUT_ID = 'send_but';
const SEND_TEXTAREA_ID = 'send_textarea';
const ORIGINAL_SEND_GLOBAL = 'sendTextareaMessage';

let clickHandler = null;       // 绑定在 #send_but 的 capture 监听
let keyHandler = null;         // 绑定在 document 的 capture 监听
let isForwarding = false;      // 重入标志：防止 QR 内 /click #send_but 之类造成死循环

/**
 * 执行目标 QR；失败则回退原生发送并提示
 * @param {string} text 当前输入框文本（透传给 QR 的 input 参数，便于 {{arg::input}} 使用）
 */
async function runTargetQr(text) {
    const api = globalThis.quickReplyApi;
    const target = configManager.getSendHijackTarget();
    if (!target) return fallbackNativeSend(text);
    if (!api) {
        warnFallback(text, 'Quick Reply 扩展不可用，已回退原生发送。');
        return;
    }

    isForwarding = true;
    try {
        // 复用原生 #send_but 的 is_send_press 守卫思路，避免连点并发
        if (typeof is_send_press !== 'undefined' && is_send_press) return;
        await api.executeQuickReply(target.set, target.label, { input: text });
    } catch (err) {
        console.error('[SendHijack] 执行快捷回复失败：', err);
        warnFallback(text, `执行快捷回复「${target.set}.${target.label}」失败：${err.message || err}`);
    } finally {
        isForwarding = false;
    }
}

/**
 * 回退到原生发送逻辑
 * @param {string} text 输入框文本
 */
function fallbackNativeSend(text) {
    if (typeof window[ORIGINAL_SEND_GLOBAL] === 'function') {
        window[ORIGINAL_SEND_GLOBAL]();
    }
}

/**
 * 提示用户回退原因（toastr 不存在时静默）
 * @param {string} text
 * @param {string} msg
 */
function warnFallback(text, msg) {
    if (typeof toastr !== 'undefined') toastr.warning(msg, '发送劫持', { timeOut: 4000 });
    fallbackNativeSend(text);
}

/**
 * 读取当前输入框文本
 * @returns {string}
 */
function getInputText() {
    const ta = document.getElementById(SEND_TEXTAREA_ID);
    return ta ? (ta.value || '') : '';
}

/**
 * 初始化发送键劫持：绑定两条入口的 capture 监听
 */
export function initSendHijack() {
    if (clickHandler || keyHandler) return; // 已绑定，避免重复

    // 入口 1：#send_but 点击（capture 阶段，早于 ST 的 jQuery click handler）
    const sendBut = document.getElementById(SEND_BUT_ID);
    if (sendBut) {
        clickHandler = (e) => {
            // 仅拦截用户「真实」点击（isTrusted=true）。
            // 其它 Quick Reply 执行完命令后会 document.querySelector('#send_but').click()（程序触发，
            // isTrusted=false）来真正发送；若不区分，会把我们的目标 QR 再次叠加执行（双 QR 嵌套）。
            if (!e.isTrusted) return;
            if (isForwarding) return; // 重入保护
            if (!configManager.getSendHijackTarget()) return; // 未配置 → 放行原生
            e.preventDefault();
            e.stopImmediatePropagation();
            runTargetQr(getInputText());
        };
        sendBut.addEventListener('click', clickHandler, true);
    }

    // 入口 2：#send_textarea 回车（capture 阶段，早于 RossAscends keydown handler）
    keyHandler = (e) => {
        if (isForwarding) return;
        if (document.activeElement?.id !== SEND_TEXTAREA_ID) return;
        if (e.key !== 'Enter') return;
        // 中文输入法合成中 / Shift+Enter 换行 / 修饰键 → 放行原生
        if (e.isComposing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
        if (!configManager.getSendHijackTarget()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        runTargetQr(getInputText());
    };
    document.addEventListener('keydown', keyHandler, true);

    debugLog('[SendHijack] 已初始化发送键劫持');
}

/**
 * 解除发送键劫持：解绑监听并复位状态
 */
export function removeSendHijack() {
    const sendBut = document.getElementById(SEND_BUT_ID);
    if (clickHandler && sendBut) {
        sendBut.removeEventListener('click', clickHandler, true);
        clickHandler = null;
    }
    if (keyHandler) {
        document.removeEventListener('keydown', keyHandler, true);
        keyHandler = null;
    }
    isForwarding = false;
    debugLog('[SendHijack] 已解除发送键劫持');
}
