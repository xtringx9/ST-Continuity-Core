// src/shared/iframeThemeSync.js
// 将 SillyTavern 主文档的主题样式继承到 iframe 内
//
// iframe 是独立 document，无法自动继承父文档的 CSS 变量。
// 本模块在 iframe 加载时读取 ST 主文档的主题变量，注入到 iframe :root。
// 目前仅用于消息内 iframe（iframeRenderer）继承 ST 字体颜色。

/**
 * 要从 SillyTavern 主文档继承到 iframe 的 CSS 变量列表
 *
 * 【如需继承更多 ST 变量，在此处取消注释或添加变量名即可】
 * 变量值在 iframe 加载时从父文档 getComputedStyle(document.documentElement) 读取。
 *
 * ST 主要主题变量（定义于 style.css :root）：
 *   --SmartThemeBodyColor      文字色（ST body color = SmartThemeBodyColor）
 *   --SmartThemeBlurTintColor   body 背景色
 *   --SmartThemeEmColor         强调色（斜体/em）
 *   --SmartThemeQuoteColor      引用色
 *   --SmartThemeBorderColor     边框色
 *   --SmartThemeShadowColor     阴影色（text-shadow 用）
 *   --mainFontFamily            主字体
 *   --mainFontSize              主字号
 *   --shadowWidth               阴影宽度
 *   --monoFontFamily            等宽字体
 */
const INHERITED_ST_VARS = [
    '--SmartThemeBodyColor',        // 文字色（目前仅需此项）
    // '--SmartThemeBlurTintColor', // body 背景色
    // '--SmartThemeEmColor',       // 强调色
    '--SmartThemeQuoteColor',        // 引用色（var-change 新值高亮色）
    // '--SmartThemeBorderColor',   // 边框色
    // '--SmartThemeShadowColor',   // 阴影色
    // '--mainFontFamily',          // 主字体
    // '--mainFontSize',            // 主字号
    // '--shadowWidth',             // 阴影宽度
    // '--monoFontFamily',          // 等宽字体
];

/**
 * 项目 themes.css 变量 → ST 变量的映射
 *
 * 【如需让 iframe 内项目变量跟随 ST，在此处取消注释或添加映射】
 * 默认全部注释：消息内 iframe（iframeRenderer）直接用 ST 变量，不走项目 themes.css。
 * IframeModal 不调用本模块。
 */
const ST_TO_PROJECT_MAP = {
    // '--text-primary': 'var(--SmartThemeBodyColor)',
    // '--bg-app': 'var(--SmartThemeBlurTintColor)',
    // '--border-color': 'var(--SmartThemeBorderColor)',
    // '--font-main': 'var(--mainFontFamily)',
};

/**
 * 将 ST 主题样式同步到 iframe
 *
 * 在 iframe.onload 时调用。读取父文档的 ST 主题变量注入 iframe :root。
 *
 * @param {HTMLIFrameElement} iframe
 * @param {Object} [opts]
 * @param {boolean} [opts.inheritBackground=false] - 是否设 iframe body 背景跟随 ST
 *        （消息内透明 iframe 保持 false）
 */
export function syncStThemeToIframe(iframe, opts = {}) {
    const { inheritBackground = false } = opts;
    const doc = iframe.contentDocument;
    if (!doc || !doc.head) return;

    const rootStyle = window.getComputedStyle(document.documentElement);

    // 1. 收集 ST 变量值（从父文档读取）
    const stDecls = [];
    for (const v of INHERITED_ST_VARS) {
        const val = rootStyle.getPropertyValue(v).trim();
        if (val) stDecls.push(`    ${v}: ${val};`);
    }

    // 2. 项目变量 → ST 变量映射
    const mapDecls = [];
    for (const [projVar, stRef] of Object.entries(ST_TO_PROJECT_MAP)) {
        mapDecls.push(`    ${projVar}: ${stRef};`);
    }

    // 3. body 基础样式兜底（目前仅文字色）
    const bodyDecls = [
        '    color: var(--SmartThemeBodyColor);',
        // '    font-family: var(--mainFontFamily);',
        // '    font-size: var(--mainFontSize);',
        // '    text-shadow: 0px 0px calc(var(--shadowWidth) * 1px) var(--SmartThemeShadowColor);',
    ];
    if (inheritBackground) {
        bodyDecls.push('    background-color: var(--SmartThemeBlurTintColor);');
    }

    const style = doc.createElement('style');
    style.id = 'ccore-st-theme-inherited';
    style.textContent = `:root {
${stDecls.join('\n')}
${mapDecls.join('\n')}
}
body {
${bodyDecls.join('\n')}
}`;

    // 移除旧注入（避免 iframe 复用时重复堆积）
    doc.getElementById('ccore-st-theme-inherited')?.remove();
    doc.head.appendChild(style);
}
