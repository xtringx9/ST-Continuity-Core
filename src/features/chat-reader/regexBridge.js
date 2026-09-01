// src/features/chat-reader/regexBridge.js
// 对聊天文本做正则的唯一来源：编译 / 匹配 / 模板填充。
// 模板占位符对齐 ST 正则替换语义：
//   $0      整段匹配
//   $1..$n  第 n 个捕获组
//   ${name} 命名捕获组 (?<name>...)
//   $$      字面 $（避免与上面冲突）
// 说明：matchAll 需要 g 修饰符，compileRegex 会强制补 g，因此「每层所有匹配」无需调用方操心。

/**
 * 编译正则（始终带 g，便于 matchAll 取全匹配）。
 * @param {string} pattern
 * @param {string} [flags]
 * @returns {{ok:boolean, regex:RegExp|null, error:string|null}}
 */
export function compileRegex(pattern, flags) {
    try {
        const f = flags && flags.includes('g') ? flags : `${flags || ''}g`;
        return { ok: true, regex: new RegExp(pattern, f), error: null };
    } catch (e) {
        return { ok: false, regex: null, error: e?.message || String(e) };
    }
}

/**
 * 取文本中所有匹配（返回 RegExp 匹配数组，含 .groups / .index）。
 * @param {string} text
 * @param {RegExp} regex 必须带 g
 * @returns {RegExpMatchArray[]}
 */
export function matchAll(text, regex) {
    if (!text || typeof text !== 'string') return [];
    const out = [];
    // matchAll 在 regex 不带 g 时会抛错；compileRegex 已保证 g
    for (const m of text.matchAll(regex)) out.push(m);
    return out;
}

const TMPL_RE = /(\$\{(\w+)\})|(\$(\d+))|(\$\$)/g;

/**
 * 用一次匹配的捕获组填充模板。
 * @param {string} tpl 模板（含 $0..$n / ${name} / $$）
 * @param {RegExpMatchArray} m 单个匹配（来自 matchAll）
 * @returns {string}
 */
export function fillTemplate(tpl, m) {
    if (!tpl) return '';
    const groups = m.slice(1); // groups[0] 对应 $1
    const named = m.groups || {};
    return tpl.replace(TMPL_RE, (full, _b, name, _c, num) => {
        if (name) return named[name] != null ? String(named[name]) : '';
        if (num) {
            if (num === '0') return m[0] != null ? m[0] : '';
            const i = parseInt(num, 10);
            return groups[i - 1] != null ? String(groups[i - 1]) : '';
        }
        return '$';
    });
}

/**
 * 二次替换：把某个「命名组」捕获到的内容先做一次字符串替换，再交给模板填充。
 * 必须在 fillTemplate 之前调用 —— 填充完成后已定位不到某个组。
 * target 为空或 '*' 时不处理（'*' = 作用于整条输出，由调用方在填充后自行替换）。
 * @param {RegExpMatchArray} m 单个匹配
 * @param {string} target 目标组名
 * @param {string} from 查找
 * @param {string} [to] 替换为
 * @returns 新的匹配对象（数组 + groups）；原匹配不被修改
 */
export function applyGroupReplace(m, target, from, to) {
    if (!target || target === '*' || !from) return m;
    const groups = { ...(m.groups || {}) };
    if (groups[target] == null) return m;
    groups[target] = String(groups[target]).split(from).join(to ?? '');
    // fillTemplate 只用到 m[0]、m.slice(1)、m.groups → 复制数组后挂上 groups 即可
    const out = Array.from(m);
    out.groups = groups;
    return out;
}

/**
 * 整文替换（逐匹配用 fillTemplate 填充 replacement）。
 * @param {string} text
 * @param {string} pattern
 * @param {string} [flags]
 * @param {string} replacement 模板
 * @returns {{ok:boolean, result?:string, error?:string}}
 */
export function applyReplacement(text, pattern, flags, replacement) {
    if (typeof text !== 'string') return { ok: false, error: 'text 不是字符串' };
    const { ok, regex, error } = compileRegex(pattern, flags);
    if (!ok) return { ok: false, error };
    let result = '';
    let last = 0;
    for (const m of text.matchAll(regex)) {
        result += text.slice(last, m.index) + fillTemplate(replacement, m);
        last = m.index + m[0].length;
    }
    result += text.slice(last);
    return { ok: true, result };
}
