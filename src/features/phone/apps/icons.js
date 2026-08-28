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

/* ---------- 线性 UI 图标集（24 视口，stroke=currentColor，随文字色变化） ---------- */
const UI_PATH = {
    /* 返回箭头（纯 chevron，无横线） */
    back: '<path d="M15 18l-6-6 6-6"/>',
    /* 搜索 */
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
    /* 加号（新建） */
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    /* 表情 */
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14.5s1.2 2 4 2 4-2 4-2"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>',
    /* 语音（麦克风） */
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
    /* 编辑（铅笔） */
    edit: '<path d="M5 19l-.8-3.2L16.5 3.5a2.1 2.1 0 0 1 3 3L7.2 18.9 5 19z"/><path d="M14.5 5.5l3 3"/>',
    /* 图片（缩略卡） */
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.6"/><path d="M4 17l5-4 3 3 3-3 5 4"/>',
    /* 语音消息条（喇叭） */
    speaker: '<path d="M4 10v4h4l5 4V6l-5 4H4z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
    /* 位置 pin */
    pin: '<path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/>',
    /* 电话 */
    phone: '<path d="M4 5.5C4 14 10 20 18.5 20l1.5-1.5-4-3-2 1.5a12 12 0 0 1-5-5L10.5 10 7.5 6 6 4 4 5.5z"/>',
    /* 文件 */
    file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h7"/><path d="M9 17h5"/>',
    /* 红包（fill 版：红底圆角 + 金色褶皱，脱离 stroke 体系） */
    redpack: '<rect x="3" y="5" width="18" height="14" rx="3" fill="#e04b2e"/><path d="M3 9h18" stroke="#b83117" stroke-width="1.5" fill="none"/><path d="M12 5l-2.6 4a3 3 0 0 0 5.2 0L12 5z" fill="#f2b63c"/>',
    /* 聊天气泡（会话 tab） */
    bubble: '<path d="M4 5.5h16a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-9.5L6 20v-3H4a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2z"/>',
    /* 通讯录/联系人（人形） */
    contacts: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6"/>',
    /* 发现/罗盘 */
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2.2 5-5 2.2 2.2-5z"/>',
    /* 动态/时间线（时钟） */
    timeline: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    /* 设置（线性小齿轮，与桌面 64 版齿轮呼应） */
    gear: '<circle cx="12" cy="12" r="3.4"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.4 5.4l1.8 1.8M16.8 16.8l1.8 1.8M18.6 5.4l-1.8 1.8M7.2 16.8l-1.8 1.8"/>',
    /* 空间/K 歌等点缀（五角星） */
    star: '<path d="M12 2.6l2.7 6.1 6.6.6-5 4.3 1.5 6.4L12 16.6l-5.8 3.4 1.5-6.4-5-4.3 6.6-.6z"/>',
};

/**
 * 生成线性 UI 图标（stroke=currentColor，随父级文字色自动换色）
 * @param {string} name 图标名（UI_PATH 中的 key）
 * @param {number} [size=20] 宽高
 * @returns {string} 内联 SVG
 */
export function uiIcon(name, size = 20) {
    const body = UI_PATH[name] || UI_PATH.plus;
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}