// src/shared/themeScheme.js
// 编辑器配色方案的单一事实源：顺序、读写、切换。
//
// 三套方案：light（白）→ warm（暖灰+棕）→ dark（黑），点标题循环切换。
// 各编辑器/浮层**不要再自己写 light ↔ dark 的二元判断**，统一走本模块，
// 以后加「更暖/更冷」等方案只需在 THEME_SCHEMES 里插一项并在 themes.css 补一个
// [data-theme="xxx"] 变量块，其余代码不用动。

/** localStorage 中的主题键（沿用旧名，避免用户已有设置失效） */
export const THEME_STORAGE_KEY = 'st_continuity_theme';

/** 切换顺序：白 → 暖灰 → 黑 */
export const THEME_SCHEMES = ['light', 'warm', 'dark'];

/**
 * 把任意值收敛成合法方案名（历史值/脏数据一律回退 light）
 * @param {string} [theme]
 * @returns {string}
 */
export function normalizeTheme(theme) {
    return THEME_SCHEMES.includes(theme) ? theme : 'light';
}

/**
 * 读取当前方案（localStorage 不可用时回退 light）
 * @returns {string}
 */
export function getTheme() {
    try {
        return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
    } catch (e) {
        return 'light';
    }
}

/**
 * 取得下一个方案（按 THEME_SCHEMES 顺序循环）
 * @param {string} [current]
 * @returns {string}
 */
export function getNextTheme(current) {
    const index = THEME_SCHEMES.indexOf(normalizeTheme(current));
    return THEME_SCHEMES[(index + 1) % THEME_SCHEMES.length];
}

/**
 * 把方案写到元素的 data-theme 上（iframe 的 documentElement 或任意容器）
 * @param {Element|Document} [el]
 * @param {string} [theme]
 * @returns {string} 实际写入的方案名
 */
export function applyTheme(el, theme) {
    const normalized = normalizeTheme(theme);
    const target = el?.documentElement || el;
    target?.setAttribute?.('data-theme', normalized);
    return normalized;
}

/**
 * 持久化方案
 * @param {string} theme
 * @returns {string} 实际写入的方案名
 */
export function saveTheme(theme) {
    const normalized = normalizeTheme(theme);
    try {
        localStorage.setItem(THEME_STORAGE_KEY, normalized);
    } catch (e) {
        /* localStorage 不可用时忽略，本次会话仍按传入值渲染 */
    }
    return normalized;
}
