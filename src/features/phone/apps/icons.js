// App 品牌图标（SVG 内联字符串）
// 用途：手机桌面图标 + 各皮肤空态图标。避免依赖系统 emoji 字体（跨平台渲染不一致）。
// 每个图标 64x64 viewBox，纯 SVG；在外壳 .app-icon-img（圆角渐变底）内铺满显示。
// 皮肤在 index.js 里通过 iconKey 引用，phoneRenderer 用 skinIcon(iconKey) 取实际 SVG。

/** @type {Record<string, string>} 图标集合（64×64） */
export const SKIN_ICONS = {
    /* 通用聊天：单气泡 */
    generic: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 16h36a8 8 0 0 1 8 8v10a8 8 0 0 1 -8 8h-20l-12 10z" fill="#fff"/>
        <circle cx="26" cy="25" r="3" fill="#6ba7ff"/>
        <circle cx="36" cy="25" r="3" fill="#6ba7ff"/>
        <circle cx="46" cy="25" r="3" fill="#6ba7ff"/>
    </svg>`,
    /* 微信：双气泡 */
    wechat: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="46" cy="18" r="11" fill="#fff" opacity="0.55"/>
        <path d="M8 40h25a7 7 0 0 0 7 -7v-9a7 7 0 0 0 -7 -7h-25a7 7 0 0 0 -7 7v9a7 7 0 0 0 7 7z" fill="#fff"/>
        <path d="M10 42l2 8 9 -8z" fill="#fff"/>
        <circle cx="18" cy="28" r="2" fill="#3fa24f"/>
        <circle cx="28" cy="28" r="2" fill="#3fa24f"/>
    </svg>`,
    /* QQ：企鹅简化轮廓 */
    qq: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M32 6c-9 0 -16 8 -15 18 0 4 1 8 3 11l-1 12c1 4 2 7 3 9 2 -1 5 -3 6 -6 1 0 2 0 4 0s3 0 4 0c1 3 4 5 6 6 1 -2 2 -5 3 -9l-1 -12c2 -3 3 -7 3 -11 1 -10 -6 -18 -15 -18z" fill="#fff" stroke="#fff" stroke-linejoin="round"/>
        <circle cx="25" cy="30" r="4" fill="#13b6f0"/>
        <circle cx="39" cy="30" r="4" fill="#13b6f0"/>
    </svg>`,
    /* LINE：气泡 + 闪电 */
    line: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="12" width="56" height="40" rx="8" fill="#fff"/>
        <path d="M34 18l-12 14h8l-2 14 12 -15h-9l3 -13z" fill="#06a159"/>
    </svg>`,
    /* SMS：短信气泡 + 三个点 */
    sms: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 16a9 9 0 0 0 -9 9v16a9 9 0 0 0 9 9h6l3 9 12 -9h23a8 8 0 0 0 8 -8v-17a8 8 0 0 0 -8 -8z" fill="#fff"/>
        <circle cx="23" cy="30" r="3" fill="#5a98d8"/>
        <circle cx="33" cy="30" r="3" fill="#5a98d8"/>
        <circle cx="43" cy="30" r="3" fill="#5a98d8"/>
    </svg>`,
    /* 设置：齿轮简化 */
    settings: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M28 10h8l2 6 6 2 6 -2 4 7 -4 6v9l4 6 -4 7 -6 -2 -6 2 -2 6h-8l-2 -6 -6 -2 -6 2 -4 -7 4 -6v-9l-4 -6 4 -7 6 2 6 -2z" fill="#fff"/>
        <circle cx="32" cy="32" r="9" fill="#8e8e93"/>
    </svg>`,
};

/**
 * 取皮肤图标 SVG；未知 iconKey 回退 generic
 * @param {string} key 皮肤 iconKey（generic/wechat/qq/line/sms/settings）
 * @returns {string} 内联 SVG 字符串
 */
export function skinIcon(key) {
    return SKIN_ICONS[key] || SKIN_ICONS.generic;
}