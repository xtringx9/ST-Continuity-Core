// src/utils/tagTailCheck.js
// 正文「完整收尾」判定（消息接收完毕自动生成的校验门禁用）。
//
// 背景：角色回复的典型完整结构为
//   <content>正文…</content>
//   <module_update>[…]</module_update>
//   <modules>…</modules>
// 即：正文标签闭合之后，才允许跟「正文后模块块」。
//
// 判定思路（从尾部向内剥，而不是全文搜索）：
//   1. 剥掉尾部的已知包裹块（模块标签 / details / 思维链标签），允许嵌套多层；
//   2. 剩下的文本尾部必须是某个 contentTag 的闭合标签；
//   3. 否则视为「未完整收尾」（被截断 / 中止 / 尾部还有别的标签）。
//
// ⚠️ 为什么不能直接 `text.includes('</content>')`：
//   思维链（cotTags）里可能引用/示范 `</content>`，全文搜索会把它误判为已收尾。
//   本实现只认「剥完尾部包裹块后最后剩下的闭合标签」，CoT 里提前出现的闭合标签
//   后面还有真实正文 → 尾部匹配不到 content 标签 → 正确判为未收尾。

/** 除标签名外额外允许剥掉的包裹标签（正文后模块块之外的结构性包裹） */
const EXTRA_STRIP_TAGS = ['details'];

/** 向外剥离的最大层数（防止异常文本导致长循环） */
const MAX_STRIP_DEPTH = 10;

/** 尾部闭合标签匹配：</tag> + 允许尾随空白 */
const TAIL_CLOSE_RE = /<\/([A-Za-z0-9_:.\-]+)>\s*$/;

/** 正则转义（标签名可能含 . : - 等字符） */
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 找到 closeAt 处闭合标签所配对的开始标签位置。
 * 用「开/闭标签按序配对」扫描，而非 lastIndexOf —— 否则同名标签嵌套时
 * （如 <details><details>…</details></details>）会拿到内层开始标签。
 * @returns {{openAt:number, openEnd:number}} 找不到时 openAt=-1
 */
function findMatchingOpen(s, tag, closeAt) {
    const esc = escapeRegExp(tag);
    const openRe = new RegExp(`<${esc}(?=[\\s/>])`, 'g');
    const closeRe = new RegExp(`</${esc}\\s*>`, 'g');
    const stack = [];
    let i = 0;
    while (i < closeAt) {
        openRe.lastIndex = i;
        closeRe.lastIndex = i;
        const o = openRe.exec(s);
        const c = closeRe.exec(s);
        const oi = o ? o.index : Infinity;
        const ci = c ? c.index : Infinity;
        if (oi >= closeAt && ci >= closeAt) break;
        if (oi < ci) {
            stack.push(oi);
            i = oi + o[0].length;
        } else {
            stack.pop();
            i = ci + c[0].length;
        }
    }
    if (stack.length === 0) return { openAt: -1, openEnd: -1 };
    const openAt = stack[stack.length - 1];
    const gt = s.indexOf('>', openAt);
    return { openAt, openEnd: gt < 0 ? -1 : gt + 1 };
}

/**
 * 判断消息正文是否「完整收尾」（以正文标签闭合结束，尾部只允许完整包裹块）。
 *
 * @param {string} text 消息原文（chat[mesId].mes，未经过 ST 正则处理，含模块标签）
 * @param {Object} [options]
 * @param {string[]} [options.contentTags] 正文标签（globalSettings.contentTag，任一命中即通过）
 * @param {string[]} [options.moduleTags] 模块标签（moduleTag / moduleUpdateTag / compatibleModuleTags）
 * @param {string[]} [options.cotTags] 思维链标签（globalSettings.cotTags，尾部包裹时一并剥离）
 * @returns {{ok: boolean, skipped?: boolean, reason?: string}}
 *   ok=true  → 可自动生成（skipped=true 表示未配置正文标签，校验不生效直接放行）
 *   ok=false → 未完整收尾，reason 为判定原因（仅用于 debugLog）
 */
export function isBodyProperlyClosed(text, options = {}) {
    const contentTags = (options.contentTags || []).filter(Boolean).map(String);
    const moduleTags = (options.moduleTags || []).filter(Boolean).map(String);
    const cotTags = (options.cotTags || []).filter(Boolean).map(String);

    // 未配置正文标签 → 无从判定，放行（否则一勾选就永久不生成）
    if (contentTags.length === 0) {
        return { ok: true, skipped: true, reason: 'no-content-tag' };
    }

    let s = String(text ?? '').trimEnd();
    if (!s) return { ok: false, reason: 'empty' };

    const stripSet = new Set([...moduleTags, ...cotTags, ...EXTRA_STRIP_TAGS]);
    const contentSet = new Set(contentTags);

    // 1) 从尾部向内逐层处理包裹块
    for (let i = 0; i < MAX_STRIP_DEPTH; i++) {
        const m = TAIL_CLOSE_RE.exec(s);
        if (!m) return { ok: false, reason: 'no-tail-tag' };
        const tag = m[1];
        // 尾部就是正文标签 → 完整收尾
        if (contentSet.has(tag)) return { ok: true };
        // 尾部是别的标签（非已知包裹块）→ 未收尾
        if (!stripSet.has(tag)) return { ok: false, reason: `tail-not-content-tag:${tag}` };
        const closeAt = m.index;
        // 找配对的开始标签（同名嵌套时按开/闭配对扫描，不能用 lastIndexOf）
        const { openAt, openEnd } = findMatchingOpen(s, tag, closeAt);
        if (openAt < 0 || openEnd < 0) {
            // 只有闭合标签没有开始标签 → 结构异常/被截断
            return { ok: false, reason: `unclosed-block:${tag}` };
        }
        // 包裹块内部自成收尾结构（如 <details><content>正文</content></details>）→ 进入内部判断，
        // 否则视为「正文之后的模块块」整块丢弃，继续看前缀。
        const inner = s.slice(openEnd, closeAt).trimEnd();
        const innerTail = TAIL_CLOSE_RE.exec(inner);
        if (innerTail && (contentSet.has(innerTail[1]) || stripSet.has(innerTail[1]))) {
            s = inner;
            continue;
        }
        s = s.slice(0, openAt).trimEnd();
        if (!s) return { ok: false, reason: 'empty-after-strip' };
    }
    return { ok: false, reason: 'too-deep' };
}
