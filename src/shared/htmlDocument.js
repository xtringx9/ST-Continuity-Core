// src/shared/htmlDocument.js
// 生成内容「整页 HTML」渲染：把模型输出的完整文档放进一个独立的沙盒子 iframe（srcdoc）。
//
// 为什么不复用片段管线（shared/messageRenderer）：
//   片段管线会给每条 CSS 选择器加作用域前缀 → `:root` / `html` / `body` 变成
//   `.ccore-generator-block :root` 这种永远匹配不到的选择器；而整页作品的主题恰恰写在
//   这些选择器上（CSS 变量、body 背景），加前缀后整页配色会整体塌掉。
//   独立文档 = 它自己的 :root/html/body，CSS 按原样生效，且与外层消息、同层模块天然隔离。
//
// 脚本与安全：
//   页面自带的内联 <script>（按钮/交互）会被保留、放到 body 末尾，在沙盒子 iframe 里运行；
//   内联事件处理器（onclick/onchange 等）也一并保留（经 CCORE_DOC_SANITIZE 专用 hook 放行），
//   否则纯 onclick 驱动的交互页面按钮会全部失效。
//   沙盒仅 allow-scripts / allow-popups / allow-forms，不给 same-origin、不允许顶层导航，
//   脚本/处理器能操作自己的 DOM，但碰不到父页面、cookie、localStorage。带 src 的外链脚本丢弃。
//
// 判定规则（无配置项）：
//   1. 围栏块（``` 或 ~~~）里的内容像整页 → 取该块（模型常先写一句说明再给围栏）
//   2. 没有围栏、或围栏内容不像 → 在整个文本里找 <!DOCTYPE/<html 的起点切分
//   "像整页" = 以 <!DOCTYPE html> 开头，或含 <html>，或 <head> 与 <body> 同时出现。
//   文档前后的其它文字不会被丢弃：由 splitHtmlDocument 一并返回，调用方按顺序分别渲染。

import { DOMPurify } from '../../../../../../lib.js';
import { isExternalMediaAllowed } from '../../../../../chats.js';
import { debugLog } from '../utils/logger.js';

const LOG_TAG = '[HtmlDocument]';

/** 整页文档判定（也用于围栏块内容） */
export function looksLikeHtmlDocument(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (/^<!doctype\s+html/i.test(t)) return true;
    if (/<html[\s>]/i.test(t)) return true;
    return /<head[\s>]/i.test(t) && /<body[\s>]/i.test(t);
}

/** 文档完整性：有 </html>，或 <body> 与 </body> 成对。用来识别"被 ``` 提前截断"的半个文档 */
function isCompleteDocument(text) {
    const t = String(text || '');
    return /<\/html\s*>/i.test(t) || (/<body[\s>]/i.test(t) && /<\/body\s*>/i.test(t));
}

/** 只丢掉"孤零零一行围栏标记"（围栏没配对时残留在前后文里的 ```），不碰真正的代码块 */
function dropLoneFence(text) {
    const t = String(text || '').trim();
    return /^(?:```|~~~)[^\n]*$/.test(t) ? '' : t;
}

/**
 * 把生成内容切成「前置文字 / 整页文档 / 后置文字」三段。
 * 前后文字（模型的说明、"以下是小剧场"之类）不会被吞掉，调用方按原顺序分别渲染。
 * @param {string} text 已过 filters 的原文
 * @returns {{before:string, doc:string, after:string}|null} 没有整页文档时返回 null
 */
export function splitHtmlDocument(text) {
    // 统一换行：模型输出常有 CRLF(\r\n)，围栏/行首匹配都按 \n 来，先归一
    const raw = String(text || '').replace(/\r\n?/g, '\n');
    if (!raw.trim()) return null;

    // 1) 围栏块优先：枚举「开围栏 × 闭合围栏」候选，挑最像"文档本体"的那个区间。
    //    不能只取第一个闭合围栏：页面正文里若自带 ``` 代码块，会被误当成外层闭合而截断半个文档；
    //    也不能只取第一个开围栏：前面若还有别的代码块，会把它的内容一起卷进来。
    //    取舍规则：文档起点在区间内的偏移最小（最好就是 0），同等偏移取区间最短的那个。
    const candidates = [];
    const openRe = /(?:^|\n)(?:```|~~~)[^\n]*\n/g;
    let open;
    while ((open = openRe.exec(raw)) !== null) {
        const bodyStart = open.index + open[0].length;
        const closeRe = /(?:^|\n)(?:```|~~~)[ \t]*(?=\n|$)/g;
        closeRe.lastIndex = bodyStart;
        let close;
        while ((close = closeRe.exec(raw)) !== null) {
            const body = raw.slice(bodyStart, close.index);
            if (!looksLikeHtmlDocument(body) || !isCompleteDocument(body)) continue;
            const lead = body.search(/<!doctype\s+html|<html[\s>]/i);
            candidates.push({
                openIndex: open.index,
                openLength: open[0].length,
                closeIndex: close.index,
                closeLength: close[0].length,
                body,
                lead: lead < 0 ? 0 : lead,
            });
        }
    }
    if (candidates.length > 0) {
        candidates.sort((a, b) => (a.lead - b.lead) || (a.body.length - b.body.length));
        const best = candidates[0];
        let body = raw.slice(best.openIndex + best.openLength, best.closeIndex);
        let before = raw.slice(0, best.openIndex);
        let after = raw.slice(best.closeIndex + best.closeLength);

        // 候选区间里可能混着前置的代码块/说明：把文档起点之前的内容挪回 before，
        // 把 </html> 之后的内容挪到 after，否则它们会当作文本跑进页面正文里。
        const docStartInBody = body.search(/<!doctype\s+html|<html[\s>]/i);
        if (docStartInBody > 0) {
            before += (before ? '\n' : '') + body.slice(0, docStartInBody);
            body = body.slice(docStartInBody);
        }
        const htmlEnd = /<\/html\s*>/i.exec(body);
        if (htmlEnd) {
            const end = htmlEnd.index + htmlEnd[0].length;
            if (end < body.length) {
                after = body.slice(end) + (after ? '\n' : '') + after;
                body = body.slice(0, end);
            }
        }

        return {
            before: dropLoneFence(before),
            doc: body.trim(),
            after: dropLoneFence(after),
        };
    }

    // 2) 裸文档：从 <!DOCTYPE / <html 的起点切开，最后出现的 </html> 收尾
    const startMatch = /<!doctype\s+html[^>]*>|<html[\s>]/i.exec(raw);
    if (!startMatch) return null;
    const docStart = startMatch.index;
    let docEnd = raw.length;
    const endRe = /<\/html\s*>/gi;
    let endMatch;
    while ((endMatch = endRe.exec(raw)) !== null) docEnd = endMatch.index + endMatch[0].length;

    const doc = raw.slice(docStart, docEnd).trim();
    if (!looksLikeHtmlDocument(doc)) return null;
    // 没有 doctype 时要求有闭合证据，避免正文里只是"提到了 <html> 标签"就被当成整页
    if (!/^<!doctype/i.test(doc) && !/<\/html\s*>/i.test(doc)) {
        debugLog(LOG_TAG, '疑似提到 <html> 但缺少 </html> 闭合，按普通文本处理');
        return null;
    }
    return {
        before: dropLoneFence(raw.slice(0, docStart)),
        doc,
        after: dropLoneFence(raw.slice(docEnd)),
    };
}

/** 片段消毒配置：
 *  - MESSAGE_SANITIZE:false 关闭 ST 的 class → custom-* 改名（整页 CSS 用原类名）
 *  - CCORE_DOC_SANITIZE:true 是自定义标记，配合下方 hook 放行内联事件处理器（onclick 等） */
const DOC_SANITIZE_CONFIG = {
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_TRUSTED_TYPE: false,
    MESSAGE_SANITIZE: false,
    CCORE_DOC_SANITIZE: true,
};

// 放行整页文档里的内联事件处理器（onclick/onchange…）。
// 安全依据：文档运行在无 same-origin 的沙盒子 iframe 里，这些处理器只能作用于文档自己的 DOM，
// 碰不到父页面/聊天数据；若不保留，纯 onclick 驱动的交互页面按钮会全部失效。
let docAttrHookInstalled = false;
function ensureDocAttrHook() {
    if (docAttrHookInstalled) return;
    docAttrHookInstalled = true;
    DOMPurify.addHook('uponSanitizeAttribute', (node, data, config) => {
        if (!config || !config.CCORE_DOC_SANITIZE) return;
        if (data.attrName && /^on/i.test(data.attrName)) {
            data.forceKeepAttr = true;
        }
    });
}

/** 明确的危险标签先物理摘掉（DOMPurify 是主防线，这里是保险）。
 *  ⚠️ <script> 不在这里删：内联脚本会先在 extractInlineScripts 里取出、消毒后再放回 body 末尾，
 *     让页面自带的按钮/交互脚本能在沙盒子 iframe 里运行；带 src 的外链脚本一律丢弃。 */
function stripDangerousTags(html) {
    return html
        .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
        .replace(/<(link|base|meta|object|embed)\b[^>]*>/gi, '');
}

/**
 * 提取内联 <script>（供沙盒内运行）：
 * - 带 src 的外链脚本直接丢弃（不加载远程代码）
 * - 正文里又出现 </script> 的视为畸形，丢弃
 * 返回去掉脚本的 HTML + 脚本正文数组（消毒后再拼回 body 末尾）。
 */
function extractInlineScripts(html) {
    const scripts = [];
    const out = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (match, attrs, content) => {
        if (/\bsrc\s*=/i.test(attrs)) return '';
        if (/<\/script/i.test(content)) return '';
        scripts.push(content);
        return '';
    });
    return { html: out, scripts };
}

/** CSS 清洗：去 @import；不允许外链媒体时把外链 url() 去掉（与 ST 消息渲染同策略） */
function sanitizeCss(css) {
    let out = String(css || '').replace(/@import[^;]*;?/gi, '');
    let externalAllowed = true;
    try {
        externalAllowed = isExternalMediaAllowed();
    } catch (e) {
        externalAllowed = false;
    }
    if (!externalAllowed) {
        out = out.replace(/url\(\s*(['"]?)https?:\/\/[^)]*\)/gi, 'none');
    }
    return out;
}

/** 子 iframe 高度自适应：沙盒（无 allow-same-origin）下拿不到 frameElement，改用 postMessage 回传高度 */
function makeResizeScript(docId) {
    const idLiteral = JSON.stringify(docId);
    return `
(function () {
    if (window.__ccDocResize) return;
    window.__ccDocResize = true;
    function notify() {
        try {
            var doc = document.documentElement;
            var body = document.body;
            var h = Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0);
            if (h > 0 && window.parent && window.parent.postMessage) {
                window.parent.postMessage({ __ccore: 'ccDocHeight', id: ${idLiteral}, h: h }, '*');
            }
        } catch (e) { /* 跨域等异常一律忽略，保持初始高度 */ }
    }
    if (window.ResizeObserver) new ResizeObserver(notify).observe(document.documentElement);
    window.addEventListener('load', notify);
    window.addEventListener('resize', notify);
    notify();
})();
`;
}

// 占位 id 计数器（唯一标识，供 postMessage 高度回传时匹配到对应 iframe）
let docSeq = 0;
function nextDocId() {
    docSeq += 1;
    return 'ccdoc-' + docSeq + '-' + Date.now().toString(36);
}

/**
 * 整页 HTML → 完整文档串的核心管线（提取样式/脚本、剥壳、消毒、重组）。
 * @param {string} rawHtml 整页 HTML
 * @returns {{ srcdoc: string, docId: string }} 已转义的 srcdoc 与唯一 docId
 */
function assembleDocument(rawHtml) {
    let html = String(rawHtml || '').replace(/\r\n?/g, '\n');

    // 1) 把 <style> 全部提出来（可能在 head 里，混在正文里也一并提取）
    const cssList = [];
    html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, css) => {
        if (String(css).trim()) cssList.push(sanitizeCss(css));
        return '';
    });

    // 2) 去掉文档外壳（我们重建 head/body）
    html = html
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<\/?html\b[^>]*>/gi, '')
        .replace(/<head\b[^>]*>/gi, '')
        .replace(/<\/head\s*>/gi, '')
        .replace(/<\/?body\b[^>]*>/gi, '')
        .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '');

    // 3) 先取出内联脚本（消毒后再放回 body 末尾），其余危险标签摘掉
    const extracted = extractInlineScripts(html);
    html = stripDangerousTags(extracted.html);

    // 4) 片段消毒（关闭 class 改名；放行内联 onclick，脚本/事件属性其余规则由 DOMPurify 兜底）
    ensureDocAttrHook();
    let bodyHtml = '';
    try {
        bodyHtml = DOMPurify.sanitize(html, DOC_SANITIZE_CONFIG);
    } catch (e) {
        debugLog(LOG_TAG, '整页正文消毒失败，退回空正文', e);
        bodyHtml = '';
    }

    // 5) 重组文档：head 放样式；正文 = 消毒后的片段 + 页面自带脚本（沙盒内运行）+ 高度脚本
    const styleBlock = cssList.length ? `<style>${cssList.join('\n')}</style>` : '';
    const userScripts = extracted.scripts.length
        ? extracted.scripts.map(s => `<script>${s}</script>`).join('\n')
        : '';
    const docId = nextDocId();
    const documentHtml = '<!DOCTYPE html><html><head><meta charset="utf-8">'
        + '<style>html,body{margin:0;padding:0;}</style>'
        + styleBlock
        + `</head><body>${bodyHtml}${userScripts}<script>${makeResizeScript(docId)}</script></body></html>`;

    // 6) srcdoc 属性转义（& 先转，再转引号；属性用双引号包裹）
    const srcdoc = documentHtml.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return { srcdoc, docId };
}

/** 沙盒令牌：脚本/交互能跑，但无 same-origin、不能导航顶层 */
const DOC_SANDBOX_TOKEN = 'allow-scripts allow-popups allow-forms';

/**
 * 整页 HTML → 惰性占位（消息底部用）：折叠时零解析、可见才由 iframeRenderer 挂载、不可见即销毁。
 * @param {string} rawHtml 整页 HTML（splitHtmlDocument 返回的 doc）
 * @returns {string} `<div class="ccore-gen-lazy" data-doc-id="..." data-ccore-doc="..."></div>`
 */
export function buildDocumentFrame(rawHtml) {
    const { srcdoc, docId } = assembleDocument(rawHtml);
    // 文档串先存在属性里，是纯字符串、不触发解析，展开那一刻才会建文档。
    return `<div class="ccore-gen-lazy" data-doc-id="${docId}" data-ccore-doc="${srcdoc}"></div>`;
}

/**
 * 整页 HTML → 直接产出带沙盒的子 iframe（总览面板用：不需要惰性，随分页一次性渲染）。
 * @param {string} rawHtml 整页 HTML（splitHtmlDocument 返回的 doc）
 * @returns {string} `<iframe class="ccore-gen-doc" sandbox="..." data-doc-id="..." srcdoc="...">`
 */
export function buildDocumentIframe(rawHtml) {
    const { srcdoc, docId } = assembleDocument(rawHtml);
    return `<iframe class="ccore-gen-doc" sandbox="${DOC_SANDBOX_TOKEN}" frameborder="0" data-doc-id="${docId}" srcdoc="${srcdoc}"></iframe>`;
}
