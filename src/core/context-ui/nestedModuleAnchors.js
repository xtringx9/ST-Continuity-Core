// nestedModuleAnchors.js
// 内容锚点匹配：解决「嵌套子模块」的增量/变化匹配难点。
//
// 背景：正文内/正文后/汇总三处嵌套注入，旧实现都是「内嵌原文全文精确匹配某个条目的 raw」。
// 增量模块（incremental）按主键合并、timeline 有多版本，父样式内嵌的 `[file|键:值|...]`
// 可能是 AI 写作时刻的任意形态（字段子集/顺序/中间态），与任何一个「版本完整 raw」都不相等 →
// 全文匹配失败 → 显示原文不发样式。
//
// 本模块改为「内容锚点」：不要求全文相等，而是解析内嵌 `[模块名|...]` 的【模块名 + 各键值段】，
// 在该模块的所有条目/版本（含增量 timeline 版本）里找「共享键且值相同的段数最多」的版本，
// 用【内嵌片段原文】替换成该版本的 customStyles。只要片段里至少一个字段与该模块某个版本一致即可命中。
// （兼容：不强制要求片段含「配置主键名」——AI 内嵌用的是该模块 schema 里的变量字段即可。）
//
// 能力：
//   buildNestedAnchorIndex(processResult)  → Map<moduleName, Array<{raw, variables, customStyles}>>
//   replaceNestedByAnchors(html, index)    → 字符串版（正文后/上下文底部/汇总弹窗）
//   replaceNestedAnchorInDom(loc, index)   → DOM 版（正文内，配合文本节点替换）
//
// 无 ST DOM 依赖，可被 iframe/父窗口复用。

import { debugLog } from '../../utils/logger.js';

/** 内嵌模块片段正则：`[模块名|...]`（含 |，不含嵌套 [ ]） */
const FRAG_RE = /\[([^\[\]]*\|[^\[\]]*)\]/g;

/**
 * 从 processResult 构建锚点索引：Map<moduleName, Array<{raw, variables, customStyles}>>
 * 覆盖每条目的 timeline 历史版本。
 * @param {Object} processResult buildStyledProcessResult 的返回（content 各模块有 data）
 * @returns {Map<string, Array<{raw:string, variables:Object, customStyles:string}>>}
 */
export function buildNestedAnchorIndex(processResult) {
    const index = new Map();
    Object.keys(processResult?.content || {}).forEach(moduleName => {
        const md = processResult.content[moduleName];
        const versions = [];
        (md?.data || []).forEach(entry => {
            if (!entry) return;
            const evs = (entry.moduleData?.timeline && entry.moduleData.timeline.length)
                ? entry.moduleData.timeline
                : [entry.moduleData || entry];
            evs.forEach(ver => {
                if (!ver) return;
                const cs = ver.customStyles || entry.customStyles;
                if (!cs) return;
                versions.push({ raw: ver.raw, variables: ver.variables || {}, customStyles: cs });
            });
        });
        if (versions.length) index.set(moduleName, versions);
    });
    return index;
}

/** 解析片段 body（不含模块名）的全部键值段：`[k, v]` 列表，值取该段首个冒号后全部。 */
function parseKvSegments(body) {
    const kv = [];
    const parts = body.split('|').slice(1); // 去掉模块名
    for (const p of parts) {
        const i = p.indexOf(':');
        if (i <= 0) continue;
        const k = p.slice(0, i).trim();
        const v = p.slice(i + 1).trim();
        if (k && v) kv.push([k, v]);
    }
    return kv;
}

/** 在该模块版本里挑「共享键且值相同的段数最多」的版本样式；同分取后者（最新）。无 → null。 */
function pickStyle(versions, kvSegments) {
    if (!versions || versions.length === 0 || !kvSegments || kvSegments.length === 0) return null;
    let best = null;
    let bestScore = 0;
    for (const ver of versions) {
        let score = 0;
        for (const [k, v] of kvSegments) {
            const varVal = ver.variables[k];
            if (varVal != null && String(varVal) === v) score++;
        }
        if (score > 0 && score >= bestScore) {
            bestScore = score;
            best = ver.customStyles;
        }
    }
    return best;
}

/** 保护 HTML 属性值（防止把 data-raw 等属性里的 [..] 当作内嵌片段替换破坏结构） */
function protectAttrs(html) {
    const placeholders = [];
    const PROTECT_RE = /([\w-]+=")([^"]*)(")/g;
    const protected_ = html.replace(PROTECT_RE, (m, pre, val, post) => {
        const token = `\u0000CCATTR${placeholders.length}\u0000`;
        placeholders.push(val);
        return pre + token + post;
    });
    return { protected_, restore: (s) => s.replace(/\u0000CCATTR(\d+)\u0000/g, (m, i) => placeholders[Number(i)] ?? '') };
}

/**
 * 字符串版锚点替换（正文后 / 上下文底部 / 汇总弹窗）：
 * 扫描 HTML 文本里所有 `[模块名|...]` 片段，按「共享键值段」匹配该模块最合适的版本样式，
 * 用【片段原文】替换成该版本 customStyles。
 * @param {string} html 注入前 HTML
 * @param {Map} index buildNestedAnchorIndex 的返回
 * @returns {string}
 */
export function replaceNestedByAnchors(html, index) {
    if (!html || !(index instanceof Map) || index.size === 0) return html;

    const { protected_, restore } = protectAttrs(html);
    let result = protected_;

    const replacements = [];
    FRAG_RE.lastIndex = 0;
    let m;
    while ((m = FRAG_RE.exec(result)) !== null) {
        const frag = m[0];
        const body = m[1];
        const sep = body.indexOf('|');
        const moduleName = body.slice(0, sep).trim();
        const versions = index.get(moduleName);
        if (!versions || versions.length === 0) continue;

        const kvSegments = parseKvSegments(body);
        const cs = pickStyle(versions, kvSegments);
        if (!cs) continue;

        replacements.push({ start: m.index, end: m.index + frag.length, frag, cs });
    }

    for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        result = result.slice(0, r.start) + r.cs + result.slice(r.end);
    }
    return restore(result);
}

/**
 * DOM 版锚点替换（正文内）：在根节点的文本内容里扫描 `[模块名|...]` 片段，
 * 按「共享键值段」匹配该模块最合适的版本样式，把整个片段替换成 customStyles。
 * ⚠️ 依赖调用方提供的文本收集/偏移构建能力（inlineMessageRenderer 的 collectTextSegments/
 * buildRangeForOffset），故这里通过参数注入。
 * @param {Object} loc { segments, fullText, buildRangeForOffset }
 * @param {Map} index buildNestedAnchorIndex 的返回
 * @returns {number} 替换次数
 */
export function replaceNestedAnchorInDom(loc, index) {
    if (!loc || !loc.fullText || !(index instanceof Map) || index.size === 0) return 0;
    const { segments, fullText, buildRangeForOffset } = loc;

    const matches = [];
    FRAG_RE.lastIndex = 0;
    let m;
    while ((m = FRAG_RE.exec(fullText)) !== null) {
        const frag = m[0];
        const body = m[1];
        const sep = body.indexOf('|');
        const moduleName = body.slice(0, sep).trim();
        const versions = index.get(moduleName);
        if (!versions || versions.length === 0) continue;

        const kvSegments = parseKvSegments(body);
        const cs = pickStyle(versions, kvSegments);
        if (!cs) continue;

        // 防重：同一偏移不重复入
        if (matches.some(x => x.start === m.index)) continue;
        matches.push({ start: m.index, end: m.index + frag.length, frag, cs });
    }
    if (matches.length === 0) return 0;

    // 从后往前：后部替换不改变前部偏移
    let count = 0;
    for (let i = matches.length - 1; i >= 0; i--) {
        const r = matches[i];
        const range = buildRangeForOffset(segments, r.start, r.end);
        if (!range) continue;
        try {
            const fragment = range.createContextualFragment(r.cs);
            range.deleteContents();
            range.insertNode(fragment);
            count++;
        } catch (e) {
            debugLog('[anchor-dom] 片段替换失败:', r.frag, e);
        }
    }
    return count;
}