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
    /* 微信：官方双气泡（主白泡 + 绿尾 + 眼睛，无多余装饰路径） */
    wechat: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 14a9 9 0 0 1 9 -9h14a9 9 0 0 1 9 9v9a9 9 0 0 1 -9 9h-6l-8 8 2 -8h-2a9 9 0 0 1 -9 -9v-9z" fill="#ffffff"/>
        <circle cx="20" cy="19" r="2" fill="#0f9e53"/>
        <circle cx="28" cy="19" r="2" fill="#0f9e53"/>
        <circle cx="36" cy="19" r="2" fill="#0f9e53"/>
        <path d="M30 43a8 8 0 0 1 8 -8h12a8 8 0 0 1 8 8v8a8 8 0 0 1 -8 8h-5l-7 7 2 -7h-2a8 8 0 0 1 -8 -8v-8z" fill="#ffffff" opacity="0.85"/>
        <circle cx="41" cy="47" r="1.8" fill="#0f9e53"/>
        <circle cx="49" cy="47" r="1.8" fill="#0f9e53"/>
    </svg>`,
    /* QQ：企鹅（白身 + 蓝眼 + 红围巾） */
    qq: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M32 4c-10 0 -18 9 -18 20 0 4.5 1.5 8.5 4 12l-1.5 10.5c.7 3.4 1.8 6 3 7.6 1.8 -1.1 4.6 -3.1 5.5 -5.6 1 .4 2.2 .5 3.5 .5h7c1.3 0 2.5 -.2 3.5 -.5 .9 2.5 3.7 4.5 5.5 5.6 1.2 -1.6 2.3 -4.2 3 -7.6l-1.5 -10.5c2.5 -3.5 4 -7.5 4 -12 0 -11 -8 -20 -18 -20z" fill="#fff"/>
        <path d="M18 24c3-6 8-9 14-9s11 3 14 9l-5 2.5c-.7-2-2-3.9-3.5-5.2-1.5 1.3-3.4 2.1-5.5 2.1s-4-.8-5.5-2.1c-1.5 1.3-2.8 3.2-3.5 5.2z" fill="#e8402a"/>
        <circle cx="26" cy="33" r="2.6" fill="#2b2b2b"/>
        <circle cx="38" cy="33" r="2.6" fill="#2b2b2b"/>
        <path d="M26 43c3 1.8 9 1.8 12 0" stroke="#2b2b2b" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    </svg>`,
    /* LINE：绿色圆角牌 + 白色闪电 */
    line: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M32 6c15 0 26 10 26 26s-11 26 -26 26 -26 -11 -26 -26 11 -26 26 -26z" fill="#fff" opacity="0.9"/>
        <path d="M32 8c13.5 0 24 10.5 24 24s-10.5 24 -24 24 -24 -10.5 -24 -24 10.5 -24 24 -24z" fill="none" stroke="#fff" stroke-width="3" opacity="0.45"/>
        <path d="M35 16l-13 16h9l-2 16 13 -17h-10l3 -15z" fill="#06a159"/>
    </svg>`,
    /* SMS：短信气泡 + 三个点 */
    sms: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 14a9 9 0 0 0 -9 9v18a9 9 0 0 0 9 9h4l2 9 11 -9h23a9 9 0 0 0 9 -9v-18a9 9 0 0 0 -9 -9z" fill="#fff"/>
        <circle cx="22" cy="32" r="2.6" fill="#5a98d8"/>
        <circle cx="32" cy="32" r="2.6" fill="#5a98d8"/>
        <circle cx="42" cy="32" r="2.6" fill="#5a98d8"/>
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