// src/shared/messageRenderer.js
// Markdown → 安全 HTML 的共用渲染管线（与 ST 正文 messageFormatting 的核心步骤一致）。
//
// 步骤（顺序不可变）：
//   converter.makeHtml（showdown，复用 ST 同一个 converter 实例，含 simpleLineBreaks/tables/emoji…）
//   → encodeStyleTags（<style> 转 <custom-style>，否则会被 DOMPurify 洗掉）
//   → DOMPurify.sanitize（MESSAGE_SANITIZE：脚本/危险标签/事件属性全清）
//   → decodeStyleTags（还原 <style>，并按 prefix 给每条选择器加作用域）
//
// ⚠️ 不复用 ST 的 messageFormatting：它有副作用——
//    messageId === 0 时会把渲染结果回写 chat[0].mes、设全局 mesForShowdownParse、
//    并按 AI_OUTPUT placement 再跑一遍用户正则。本函数零全局副作用：
//    不读 chat、不写 mes、不套正则（正则/filters 由调用方决定是否先跑）。

import { converter } from '../../../../../../script.js';
import { encodeStyleTags, decodeStyleTags } from '../../../../../chats.js';
import { DOMPurify } from '../../../../../../lib.js';

/** 与 ST messageFormatting / ChatReader 保持一致的消毒配置 */
const SANITIZE_CONFIG = {
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_TRUSTED_TYPE: false,
    MESSAGE_SANITIZE: true,
    ADD_TAGS: ['custom-style'],
};

/**
 * 把 markdown 文本渲染成可安全 innerHTML 的 HTML。
 * @param {string} text 原文（markdown）
 * @param {object} [options]
 * @param {string} [options.stylePrefix='.ccore-generator-block '] 消息内 <style> 的选择器作用域前缀。
 *        ⚠️ 传空串会让文本自带的 CSS 全局生效，污染同一个 iframe 内的模块块，务必保持非空。
 * @returns {string} 渲染后的 HTML
 * @throws 转换或消毒抛错时不吞异常，由调用方决定回退策略（转义纯文本 / 原文）
 */
export function renderMarkdownToSafeHtml(text, { stylePrefix = '.ccore-generator-block ' } = {}) {
    let out = converter.makeHtml(String(text ?? ''));
    out = encodeStyleTags(out);
    out = DOMPurify.sanitize(out, SANITIZE_CONFIG);
    return decodeStyleTags(out, { prefix: stylePrefix });
}
