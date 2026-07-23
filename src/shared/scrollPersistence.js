// src/shared/scrollPersistence.js
// 跨 iframe 重开的滚动位置记忆（模块栏 / 角色树共用）。
//
// 用法：
//   - 在列表容器的 scroll 事件里调用 persistScroll(el, key) 实时写盘；
//   - 在（重新）打开/切入视图时调用 restoreScroll(el, key) 还原。
//
// 真因（本扩展实测踩过，详见 MEMORY.md「ModuleEditor 运行在父窗口上下文」）：
//   ModuleEditor/CharacterBinding 运行在父窗口上下文，模块级变量跨编辑器开关不重置。
//   曾用一次性标志门控"首次渲染"还原，导致父会话内只在首开为 true，后续重开绕过硬盘读取。
//   现改用 doc 对象身份（见 ModuleEditor.js 的 lastRenderedDoc）判断"新 iframe"，而非本文件。
//
// 本文件只负责两类细节：
//   1) persistScroll：scroll 事件里把当前位置写盘（本地用，简单直接）；
//   2) restoreScroll：列表内容高度可能尚未就绪（scrollTop 被夹紧到 0），
//      故逐帧重试，直到实际 scrollTop 达到目标或达到最大重试次数。

/**
 * 在容器的 scroll 事件处理中调用，把当前位置写盘。
 * @param {HTMLElement} el 滚动容器
 * @param {string} key localStorage 键
 */
export function persistScroll(el, key) {
    try { localStorage.setItem(key, String(el.scrollTop)); } catch (e) {}
}

/**
 * 还原滚动位置。内容高度可能尚未就绪（被夹紧到 0），故逐帧重试，直到
 * 实际 scrollTop 达到目标或达到最大重试次数。
 * @param {HTMLElement} el 滚动容器
 * @param {string} key localStorage 键
 * @param {number} maxTries 最大重试帧数
 */
export function restoreScroll(el, key, maxTries = 12) {
    if (!el) return;
    const target = Number(localStorage.getItem(key) || 0);
    if (target <= 0) return; // 无需还原（顶部或从未滚动）

    let tries = 0;
    const step = () => {
        el.scrollTop = target;
        if (el.scrollTop < target && tries < maxTries) {
            tries++;
            requestAnimationFrame(step);
        }
    };
    requestAnimationFrame(step);
}
