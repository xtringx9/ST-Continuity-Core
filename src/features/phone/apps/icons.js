// App 品牌图标（SVG 内联字符串）
// 用途：手机桌面图标 + 各皮肤空态图标。避免依赖系统 emoji 字体（跨平台渲染不一致）。
// 微信/QQ/LINE 使用 Simple Icons 官方品牌剪影（见 brand-icons.js，本地内嵌无远程引用）；
// 其余自绘 64x64。皮肤在 index.js 里通过 iconKey 引用，phoneRenderer 用 skinIcon(iconKey) 取实际 SVG。
import { BRAND_ICONS } from './brand-icons.js';

/**
 * 把 Simple Icons 的 24 viewBox 剪影包进 64 viewBox 并缩小居中。
 * 统一视觉尺寸：自绘图标是 64 内约 44-48 主体，品牌剪影同理处理，避免显得过大。
 * @param {string} svg24 不带外层 <svg> 的 24 坐标系内容（取 path/圆形等）
 */
function fitBrandIcon(svg24) {
    const inner = svg24
        .replace(/^<svg[^>]*>/, '')
        .replace(/<\/svg>\s*$/, '');
    // scale 1.833 ≈ 24*1.833 = 44，四周留 (64-44)/2 = 10px 边距
    // fill 放 g 上：保住白色（原 svg 的 fill 属性随标签被剥离）
    return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><g fill="#ffffff" transform="translate(10 10) scale(1.833)">${inner}</g></svg>`;
}

/** @type {Record<string, string>} 图标集合（64×64） */
export const SKIN_ICONS = {
    /* 通用聊天：单气泡 */
    generic: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 16h36a8 8 0 0 1 8 8v10a8 8 0 0 1 -8 8h-20l-12 10z" fill="#fff"/>
        <circle cx="26" cy="25" r="3" fill="#6ba7ff"/>
        <circle cx="36" cy="25" r="3" fill="#6ba7ff"/>
        <circle cx="46" cy="25" r="3" fill="#6ba7ff"/>
    </svg>`,
    /* 微信/QQ/LINE：Simple Icons 官方剪影（白色），缩小居中适配 64 视口 */
    wechat: fitBrandIcon(BRAND_ICONS.wechat),
    qq: fitBrandIcon(BRAND_ICONS.qq),
    line: fitBrandIcon(BRAND_ICONS.line),
    /* SMS：短信气泡 + 三个点（气泡占比收敛，四周留白更精致） */
    sms: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 18a8 8 0 0 0 -8 8v14a8 8 0 0 0 8 8h3l2 7 9 -7h22a8 8 0 0 0 8 -8v-14a8 8 0 0 0 -8 -8z" fill="#fff"/>
        <circle cx="24" cy="33" r="2.2" fill="#5a98d8"/>
        <circle cx="32" cy="33" r="2.2" fill="#5a98d8"/>
        <circle cx="40" cy="33" r="2.2" fill="#5a98d8"/>
    </svg>`,
    /* 设置：Material 官方齿轮（mdi:cog，下载真实 path） */
    settings: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><g fill="#ffffff" transform="translate(10 10) scale(1.833)">
        <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5A3.5 3.5 0 0 1 15.5 12A3.5 3.5 0 0 1 12 15.5m7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64z"/>
    </g></svg>`,
};

/**
 * 取皮肤图标 SVG；未知 iconKey 回退 generic
 * @param {string} key 皮肤 iconKey（generic/wechat/qq/line/sms/settings）
 * @returns {string} 内联 SVG 字符串
 */
export function skinIcon(key) {
    return SKIN_ICONS[key] || SKIN_ICONS.generic;
}