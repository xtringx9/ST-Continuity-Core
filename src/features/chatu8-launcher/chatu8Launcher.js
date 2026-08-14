// src/features/chatu8-launcher/chatu8Launcher.js
// 智绘姬文生图工作台启动器（独立模块，与 EntryButton 解耦）
// 在发送栏（大Cc 左侧、紧贴 Cc，即「魔棒与 Cc 之间」）常驻独立按钮：
//   1) 点击 → 打开智绘姬设置面板（= 菜单「打开文生图设置」打开的 #ch-settings-modal 内 #st-chatu8-settings）
//   2) 轮询 #st-chatu8-fab.dataset.isLoading 实时反馈智绘姬生图请求状态（两态：运行/空闲）
//   3) 打开的智绘姬面板支持点击空白处关闭
//
// 信号源说明（已与用户确认，方案 A）：
//   智绘姬 esbuild 打包后内部 loading 函数（acquireFabLoading / isLLMRequestActive / activeRequests）
//   不挂 window，且无对外 LLM 状态事件；#st-chatu8-fab.dataset.isLoading 是唯一稳定、零侵入的官方信号位。
//   即使用户在智绘姬设置里关闭悬浮球（enable_chatu8_fab=false），智绘姬仅 fab.hide()（display:none），
//   节点 #st-chatu8-fab 仍存在于 DOM，故 dataset.isLoading 照样可读 → 本功能在 FAB 关闭时仍能收到信号。
//
// 时序说明：本插件可能早于智绘姬挂载 #st-chatu8-settings，故 init 时该节点未必存在。
//   initChatu8Launcher 内置「等待 #st-chatu8-settings 出现」重试（带上限），避免刷新后需手动开关。
//
// 按钮位置说明：智绘姬原生「扩展魔棒」#extensionsMenuButton 由 ST 先注入 #leftSendForm，
//   Cc(#continuity-new-entry-btn) 后注入。本按钮用 wandBtn.after(btn) 插到魔棒右侧紧邻，
//   从而落在「魔棒 — 本按钮 — Cc」之间，且 Cc 始终保持在最后。

import configManager from "../../singleton/configManager.js";
import { infoLog, warnLog, debugLog } from "../../utils/logger.js";

const LOG_TAG = '[Chatu8Launcher]';

const BUTTON_ID = 'continuity-chatu8-launcher';
const FAB_ID = 'st-chatu8-fab';
const CHATU8_SETTINGS_ID = 'st-chatu8-settings';
const MODAL_ID = 'ch-settings-modal';
const CC_BUTTON_ID = 'continuity-new-entry-btn'; // 大Cc 触发器
const EXTENSIONS_MENU_BUTTON_ID = 'extensionsMenuButton'; // ST 原生「扩展魔棒」
const POLL_INTERVAL = 500;
const WAIT_TIMEOUT_MS = 15000; // 等待智绘姬面板挂载的最长时长
const WAIT_STEP_MS = 300;

let heartbeatTimer = null;
let lastLoading = false;
let isInjected = false;
let docBackdropHandler = null;
let waitTimer = null;
let panelOpenedByUs = false;

/**
 * 功能是否应启用（仅看开关；DOM 存在性由等待重试处理）。
 * @returns {boolean}
 */
function isEnabled() {
    return configManager.isChatu8LauncherEnabled() === true;
}

/**
 * 点击打开智绘姬设置面板（文生图工作台）。
 * 智绘姬的 showSettingsPanel() 不挂 window，此处用等价 DOM 操作：
 *   直接显示 #ch-settings-modal（display:grid），并绑定空白关闭。
 */
function openChatu8Panel() {
    const settings = document.getElementById(CHATU8_SETTINGS_ID);
    if (!settings) {
        warnLog(LOG_TAG, '无法打开智绘姬面板：#st-chatu8-settings 不存在');
        return;
    }

    const modal = document.getElementById(MODAL_ID);
    if (modal) {
        modal.style.display = 'grid';
        const content = modal.querySelector('.st-chatu8-modal-content');
        if (content) content.focus();
        panelOpenedByUs = true;
        // 先解绑旧 handler（若有）再重新绑定：旧 handler 会在本次打开点击冒泡时
        // 误关窗口（第二次打开必现）。重新绑定带 setTimeout(0) 跳过本次点击。
        unbindModalBackdropClose();
        bindModalBackdropClose();
    } else {
        // 兜底：模拟点击 ST 原生扩展设置按钮
        const aiConfigBtn = document.getElementById('ai-config-button');
        if (aiConfigBtn) {
            aiConfigBtn.click();
        } else {
            warnLog(LOG_TAG, '无法定位 #ch-settings-modal 与 #ai-config-button，打开失败');
        }
    }
}

/**
 * 绑定「点击空白处关闭」：监听 document click，
 * 仅当面板由本功能打开、且点击落在 .st-chatu8-modal-content 之外时关闭。
 * 用 closest 判定（不依赖 e.target 精确等于 modal），更稳健。
 */
function unbindModalBackdropClose() {
    if (docBackdropHandler) {
        document.removeEventListener('click', docBackdropHandler);
        docBackdropHandler = null;
    }
}

function bindModalBackdropClose() {
    // 先确保无残留 handler（openChatu8Panel 已在调用前 unbind，此处双保险）
    unbindModalBackdropClose();
    // 延后注册，避免本次打开点击立即触发
    setTimeout(() => {
        docBackdropHandler = (e) => {
            if (!panelOpenedByUs) return;
            const modal = document.getElementById(MODAL_ID);
            if (!modal || modal.style.display === 'none') return;
            // 点击落在内容区内部（或其子元素）不关；点击内容区之外（backdrop/header 空白）才关
            if (e.target.closest && e.target.closest('.st-chatu8-modal-content')) return;
            closeChatu8Panel();
        };
        document.addEventListener('click', docBackdropHandler);
    }, 0);
}

/**
 * 关闭智绘姬面板（仅当由本功能打开时）。
 */
function closeChatu8Panel() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) {
        modal.style.display = 'none';
    }
    panelOpenedByUs = false;
}

/**
 * 读取智绘姬 FAB 的 loading 状态。
 * @returns {boolean}
 */
function isChatu8Loading() {
    const fab = document.getElementById(FAB_ID);
    if (!fab) return false; // FAB 节点不存在 → 永不显示 loading
    return fab.dataset.isLoading === 'true';
}

/**
 * 应用 loading 视觉反馈（复用 messageAiButton 小Cc 图标替换式，仅两态）。
 * @param {HTMLElement} btn
 * @param {boolean} loading
 */
function applyLoadingState(btn, loading) {
    if (loading === lastLoading) return;
    lastLoading = loading;
    const icon = btn.querySelector('i');
    if (!icon) return;
    if (loading) {
        icon.className = 'fa-solid fa-spinner fa-spin';
        btn.style.backgroundColor = 'rgba(128, 128, 128, 0.3)';
        btn.title = '智绘姬生图请求运行中…';
    } else {
        icon.className = 'fa-solid fa-paintbrush';
        btn.style.backgroundColor = '';
        btn.title = '打开智绘姬文生图工作台';
    }
    // 注意：边框统一由 createButton 的 border 简写设定（与 Cc 同款），
    // 此处绝不改写/清空 borderColor，否则简写 border 退化成默认 1px 导致外框差异。
}

/**
 * 心跳：轮询 FAB loading 状态并刷新按钮。
 */
function onTick() {
    if (!isInjected) return;
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) {
        // 按钮被外部移除（如聊天页切换），停止心跳避免泄漏
        removeChatu8Launcher();
        return;
    }
    applyLoadingState(btn, isChatu8Loading());
}

function createButton() {
    const btn = document.createElement('div');
    btn.id = BUTTON_ID;
    btn.className = 'mes_text_paste';
    btn.title = '打开智绘姬文生图工作台';
    btn.innerHTML = '<i class="fa-solid fa-paintbrush" style="flex: 0 0 auto; line-height: 1;"></i>';
    Object.assign(btn.style, {
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        fontWeight: 'bold',
        marginLeft: '5px',
        marginRight: '0',
        color: 'var(--SmartThemeBodyColor, #ccc)',
        // 关键：#leftSendForm 是 flex 容器，Cc 按钮设了 order:9999 永远置底。
        // 本按钮用 order:5000 落在魔棒(order:0) 之后、Cc(order:9999) 之前，
        // 从而无视 DOM 插入先后，稳定呈现「魔棒 — 本按钮 — Cc」。
        order: '5000',
        border: '2px solid var(--smart-border-color, rgba(128,128,128,0.5))',
        borderRadius: '6px',
        width: '30px',
        height: '30px',
        boxSizing: 'border-box',
        transition: 'background-color 0.2s, border-color 0.2s',
    });
    btn.addEventListener('click', () => {
        openChatu8Panel();
        applyLoadingState(btn, isChatu8Loading());
    });
    return btn;
}

/**
 * 将按钮插入 #leftSendForm。
 * 位置策略（保证「魔棒 — 本按钮 — Cc」且 Cc 最后）：
 *   - 优先插到 ST 原生扩展魔棒 #extensionsMenuButton 之后（紧邻魔棒右侧）；
 *   - 若魔棒不存在，退而插到 Cc 之前。
 * 用 after/insertBefore 显式定位，不依赖 order 数值博弈。
 * @param {HTMLElement} btn
 */
function insertButton(btn) {
    const targetContainer = document.querySelector('#form_sheld #send_form #nonQRFormItems #leftSendForm');
    if (!targetContainer) {
        warnLog(LOG_TAG, '无法找到启动器注入容器 (#leftSendForm)');
        return false;
    }
    if (document.getElementById(BUTTON_ID)) {
        document.getElementById(BUTTON_ID).remove();
    }
    const wandBtn = document.getElementById(EXTENSIONS_MENU_BUTTON_ID);
    const ccBtn = document.getElementById(CC_BUTTON_ID);
    if (wandBtn && wandBtn.parentElement === targetContainer) {
        // 插到魔棒之后 → 魔棒—本按钮—(其余) ；Cc 在更右则自然落在中间
        wandBtn.after(btn);
    } else if (ccBtn && ccBtn.parentElement === targetContainer) {
        // 无魔棒时退而插到 Cc 之前
        targetContainer.insertBefore(btn, ccBtn);
    } else {
        targetContainer.appendChild(btn);
    }
    return true;
}

/**
 * 真正执行注入（此时 #st-chatu8-settings 与 #leftSendForm 均存在）。
 * @returns {boolean} 是否注入成功
 */
function doInject() {
    if (isInjected) removeChatu8Launcher();

    const btn = createButton();
    const ok = insertButton(btn);
    if (!ok) return false;

    isInjected = true;
    lastLoading = null; // 强制首次刷新

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(onTick, POLL_INTERVAL);

    infoLog(LOG_TAG, '文生图工作台启动器已注入');
    return true;
}

/**
 * 注入按钮（幂等）。门控在源头：
 *   - 功能开关开启才注入；
 *   - 智绘姬面板(#st-chatu8-settings) 与 发送栏(#leftSendForm) 可能晚于本插件挂载（含聊天页尚未就绪），
 *     故内置等待重试（带上限），两者均存在才注入，解决刷新后需手动开关的问题。
 */
export function initChatu8Launcher() {
    if (!isEnabled()) {
        removeChatu8Launcher();
        return;
    }
    // 两个依赖节点都存在才注入
    if (document.getElementById(CHATU8_SETTINGS_ID) && document.querySelector('#form_sheld #send_form #nonQRFormItems #leftSendForm')) {
        if (doInject()) return;
        // doInject 失败（极少见，如容器中途消失）落到下方重试
    }
    // 依赖节点尚未就绪：启动等待重试
    if (waitTimer) clearTimeout(waitTimer);
    const startedAt = Date.now();
    const waitForDeps = () => {
        const settingsReady = document.getElementById(CHATU8_SETTINGS_ID);
        const sendFormReady = document.querySelector('#form_sheld #send_form #nonQRFormItems #leftSendForm');
        if (settingsReady && sendFormReady) {
            waitTimer = null;
            doInject();
            return;
        }
        if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
            waitTimer = null;
            debugLog(LOG_TAG, `等待依赖节点超时（${WAIT_TIMEOUT_MS}ms），放弃注入`);
            return;
        }
        waitTimer = setTimeout(waitForDeps, WAIT_STEP_MS);
    };
    debugLog(LOG_TAG, '依赖节点（智绘姬面板/发送栏）尚未就绪，启动等待重试');
    waitForDeps();
}

/**
 * 移除按钮 + 停止心跳（幂等）。
 */
export function removeChatu8Launcher() {
    if (waitTimer) {
        clearTimeout(waitTimer);
        waitTimer = null;
    }
    const btn = document.getElementById(BUTTON_ID);
    if (btn) btn.remove();
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    // 解绑面板空白关闭监听
    unbindModalBackdropClose();
    panelOpenedByUs = false;
    isInjected = false;
    lastLoading = false;
}
