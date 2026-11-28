// src/shared/htmlDocument.js
// 生成内容「整页 HTML」渲染：把模型输出的完整文档放进一个独立 srcdoc 子 iframe。
//
// 为什么不复用片段管线（shared/messageRenderer）：
//   片段管线会给每条 CSS 选择器加作用域前缀 → `:root` / `html` / `body` 变成
//   `.ccore-generator-block :root` 这种永远匹配不到的选择器；而整页作品的主题恰恰写在
//   这些选择器上（CSS 变量、body 背景），加前缀后整页配色会整体塌掉。
//   独立文档 = 它自己的 :root/html/body，CSS 按原样生效，且与外层消息、同层模块天然隔离。
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
    const raw = String(text || '');
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

/** 片段消毒配置：MESSAGE_SANITIZE:false 关闭 ST 的 class → custom-* 改名（整页 CSS 用原类名） */
const DOC_SANITIZE_CONFIG = {
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_TRUSTED_TYPE: false,
    MESSAGE_SANITIZE: false,
};

/** 明确的危险标签先物理摘掉（DOMPurify 是主防线，这里是保险） */
function stripDangerousTags(html) {
    return html
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
        .replace(/<(link|base|meta|object|embed)\b[^>]*>/gi, '');
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

/** 子 iframe 高度自适应：srcdoc 文档内部自己量高并回写 frameElement 高度 */
const RESIZE_SCRIPT = `
(function () {
    if (window.__ccDocResize) return;
    window.__ccDocResize = true;
    function notify() {
        try {
            var doc = document.documentElement;
            var body = document.body;
            var h = Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0);
            var frame = window.frameElement;
            if (frame && h > 0 && Math.abs(parseFloat(frame.style.height || '0') - h) > 1) {
                // 覆盖 CSS 里的兜底最小高度，保证按内容精确贴合
                frame.style.minHeight = '0px';
                frame.style.height = h + 'px';
            }
        } catch (e) { /* 跨域等异常一律忽略，保持初始高度 */ }
    }
    if (window.ResizeObserver) new ResizeObserver(notify).observe(document.documentElement);
    window.addEventListener('load', notify);
    window.addEventListener('resize', notify);
    notify();
})();
`;

/**
 * 把整页 HTML 组装成可内联渲染的子 iframe 标记。
 * @param {string} rawHtml 整页 HTML（extractHtmlDocument 的返回值）
 * @returns {string} `<iframe class="ccore-gen-doc" srcdoc="...">`
 */
export function buildDocumentFrame(rawHtml) {
    let html = String(rawHtml || '');

    // 1) 把 <style> 全部提出来（可能在 head 里，混在正文里也一并提取）
    const cssList = [];
    html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, css) => {
        if (String(css).trim()) cssList.push(sanitizeCss(css));
        return '';
    });

    // 2) 去掉文档外壳（我们重建 head/body），并摘掉明确的危险标签
    html = html
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .replace(/<\/?html\b[^>]*>/gi, '')
        .replace(/<head\b[^>]*>/gi, '')
        .replace(/<\/head\s*>/gi, '')
        .replace(/<\/?body\b[^>]*>/gi, '')
        .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '');
    html = stripDangerousTags(html);

    // 3) 片段消毒（关闭 class 改名；脚本/事件属性由 DOMPurify 清）
    let bodyHtml = '';
    try {
        bodyHtml = DOMPurify.sanitize(html, DOC_SANITIZE_CONFIG);
    } catch (e) {
        debugLog(LOG_TAG, '整页正文消毒失败，退回空正文', e);
        bodyHtml = '';
    }

    // 4) 重组文档：保留原文档的 head 样式，正文来自消毒后的片段
    const styleBlock = cssList.length ? `<style>${cssList.join('\n')}</style>` : '';
    const documentHtml = '<!DOCTYPE html><html><head><meta charset="utf-8">'
        + '<style>html,body{margin:0;padding:0;}</style>'
        + styleBlock
        + `</head><body>${bodyHtml}<script>${RESIZE_SCRIPT}</script></body></html>`;

    // 5) srcdoc 属性转义（& 先转，再转引号；属性用双引号包裹）
    //    不设 scrolling="no"：万一高度脚本没跑起来，宁可出现内部滚动条，也不要裁掉内容
    const srcdoc = documentHtml.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<iframe class="ccore-gen-doc" frameborder="0" srcdoc="${srcdoc}"></iframe>`;
}
