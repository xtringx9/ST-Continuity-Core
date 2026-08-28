// 状态栏图标（信号/WiFi/电池）：精配 iPhone 状态栏风格的细线 SVG，本地内嵌，零网络依赖。
// 颜色用 currentColor，由 .ps-icons 的 CSS color 控制（浅底深色，深色状态栏可覆盖）。

export const STATUS_ICONS = {
    /* 信号：四根圆角柱，由左到右递增 */
    signal: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 12"><rect x="0" y="7" width="3" height="5" rx="0.9"/><rect x="5" y="4.5" width="3" height="7.5" rx="0.9"/><rect x="10" y="2" width="3" height="10" rx="0.9"/><rect x="15" y="0" width="3" height="12" rx="0.9"/></svg>',
    /* WiFi：两道圆弧 + 圆点 */
    wifi: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1.5 4.5a11 11 0 0 1 15 0"/><path d="M4.8 7.6a6.6 6.6 0 0 1 8.4 0"/><circle cx="9" cy="10.2" r="1.3" fill="currentColor" stroke="none"/></svg>',
    /* 电池：横向圆角壳 + 电量填充 + 正极（仿 iPhone） */
    battery: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 12"><rect x="0" y="1.5" width="21" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="1.8" y="3.3" width="13.5" height="5.4" rx="1.3" fill="currentColor"/><rect x="22.5" y="4" width="2.5" height="4" rx="1.2" fill="currentColor"/></svg>',
};