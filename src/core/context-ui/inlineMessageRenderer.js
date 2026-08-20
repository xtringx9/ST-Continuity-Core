import { debugLog, errorLog, infoLog } from '../../utils/logger.js';
import { groupProcessResultByMessageIndex } from '../moduleProcessor.js';
import { getCurrentMessageContainer } from './containerManager.js';
import { getRenderUIFilteredModuleConfigs } from './moduleFilters.js';
import { buildStyledProcessResult } from './processResultBuilder.js';
import { buildNestedAnchorIndex, replaceNestedAnchorInDom } from './nestedModuleAnchors.js';
import { chat, messageFormatting } from '../../../../../../../script.js';

/**
 * 渲染消息正文内的模块样式。
 * @param {number[]|null} [mesIds] 指定只渲染这些 mesid；null = 渲染全部消息。
 * @param {boolean} [force=false] 强制重渲染：即使该层已渲染过（renderSwipe 命中），
 * 也先重建 `.mes_text` 原文再替换。用于「模块内容变化后」的增量刷新——已渲染层
 * 的原文已被样式替换，普通路径找不到原文会跳过。
 * 数据层始终全量提取（快照未实现前，runModulePipeline 无按层增量），
 * 优化点在 DOM 渲染范围：只对指定层做文本节点定位与替换。
 */
export function renderCurrentMessageContext(mesIds = null, force = false) {
    try {
        if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
            errorLog('jQuery未加载，无法使用选择器');
            return false;
        }

        let containers;
        if (mesIds === null) {
            containers = getCurrentMessageContainer();
        } else {
            const ids = (Array.isArray(mesIds) ? mesIds : [mesIds])
                .map(id => String(id).trim())
                .filter(Boolean);
            if (ids.length === 0) return false;
            containers = jQuery(
                ids
                    .map(id => document.querySelector(`#chat .mes[mesid="${CSS.escape(id)}"]`))
                    .filter(Boolean),
            );
        }
        if (!containers.length) return false;

        const extractParams = {
            startIndex: 0,
            endIndex: null,
            moduleFilters: getRenderUIFilteredModuleConfigs(),
        };

        const processResult = buildStyledProcessResult(null, extractParams);
        if (!processResult) {
            errorLog('更新上下文底部UI失败');
            return false;
        }

        const groupedByMessageIndex = groupProcessResultByMessageIndex(processResult, true, true);
        // 内容锚点索引：按「模块名+主键值」索引全部条目（含增量 timeline 版本），供正文内嵌套兜底
        const anchorIndex = buildNestedAnchorIndex(processResult);
        debugLog('[CUSTOM STYLES]按messageIndex分组前后的模块数据:', processResult, groupedByMessageIndex);

        for (let i = containers.length - 1; i >= 0; i--) {
            const message = $(containers[i]);
            const messageText = message.find('.mes_text');
            const messageIndex = message.attr('mesid');
            const modulesForThisMessage = groupedByMessageIndex[messageIndex] || [];

            // force 重渲染：已渲染层原文已被样式替换，普通路径找不到原文会跳过。
            // 仅当该层已渲染过（renderSwipe === swipeId）才重建——用 messageFormatting
            // 重建 `.mes_text` 原文（与 ST 渲染一致），并清掉 renderSwipe 重新走替换。
            if (force) {
                const renderSwipe = message.attr('renderSwipe');
                const swipeId = message.attr('swipeid');
                if (renderSwipe === swipeId) {
                    const idx = Number(messageIndex);
                    if (!Number.isNaN(idx) && chat[idx]) {
                        try {
                            const m = chat[idx];
                            const text = m.extra?.display_text || m.mes || '';
                            messageText.html(messageFormatting(
                                text, m.name, !!m.is_system, !!m.is_user, idx, {}, false,
                            ));
                            message.removeAttr('renderSwipe');
                        } catch (err) {
                            errorLog(`[RENDER] force 重建楼层 ${messageIndex} 失败:`, err);
                        }
                    }
                }
            }

            renderSingleMessageContext(modulesForThisMessage, messageText, message, anchorIndex);
        }

        return true;
    } catch (error) {
        errorLog('更新上下文底部UI失败:', error);
        return false;
    }
}

/**
 * DOM 文本节点定位器。
 *
 * 背景：旧实现用 `processedRaw` 构造正则去匹配 `container.html()`（innerHTML 字符串），
 * 但 ST 渲染后的 innerHTML 包含 `<br>`、HTML 转义（&lt; &amp; 等）、markdown 包装，
 * 导致正则匹配不稳定、替换失败。这里改为：
 *   1. 用 TreeWalker 遍历文本节点 + `<br>`（按 \n 计），拼接成「纯文本 + 偏移映射」；
 *   2. 在拼接文本里 indexOf 匹配模块 raw（解码后，天然免疫转义）；
 *   3. 用 Range.deleteContents() + insertNode() 精确替换为样式节点。
 *
 * 幂等性说明：不排除任何子树——嵌套子模块（如 msg 里的 [file|...]）的原文文本
 * 可能位于父模块注入的样式节点内部（如 ${cont.value} 渲染出的文本）。若排除已
 * 注入子树，子模块将被父模块的标记挡住无法替换。这里依赖「原文被消费即幂等」：
 * 某模块原文一旦被替换为样式节点，DOM 中便不再存在该原文，下次 indexOf 自然
 * 找不到，不会重复注入。
 */
/** 收集根元素下的文本段（文本节点 + br 视为 \n），返回 { segments, fullText } */
function collectTextSegments(root) {
    const segments = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, {
        acceptNode(node) {
            if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
            if (node.nodeName === 'BR') return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_SKIP;
        },
    });
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent) segments.push({ node, text: node.textContent, isBr: false, start: 0, end: 0 });
        } else if (node.nodeName === 'BR') {
            segments.push({ node, text: '\n', isBr: true, start: 0, end: 0 });
        }
    }
    let fullText = '';
    for (const seg of segments) {
        seg.start = fullText.length;
        fullText += seg.text;
        seg.end = fullText.length;
    }
    return { segments, fullText };
}

/** 将文本偏移映射到文本段，构建精确 Range（跨文本节点 / <br>）。 */
function buildRangeForOffset(segments, start, end) {
    let startSeg = null, startOff = 0;
    let endSeg = null, endOff = 0;
    for (const seg of segments) {
        if (startSeg === null && start < seg.end) { startSeg = seg; startOff = start - seg.start; }
        if (end <= seg.end) { endSeg = seg; endOff = end - seg.start; break; }
    }
    if (!startSeg || !endSeg) return null;

    const range = document.createRange();
    if (startSeg.isBr) range.setStartBefore(startSeg.node);
    else range.setStart(startSeg.node, Math.min(startOff, startSeg.node.textContent.length));
    if (endSeg.isBr) range.setEndAfter(endSeg.node);
    else range.setEnd(endSeg.node, Math.min(endOff, endSeg.node.textContent.length));
    return range;
}

/**
 * 在 DOM 中把 raw 原文替换为样式 HTML。同一原文多处出现时全部替换。
 * ⚠️ 用「一次收集纯文本 + 从后往前替换」：收集发生在任何样式插入之前，
 * 因此 fullText 是纯正文（不含样式内部文本），不会因样式内容含 raw 子串而误匹配。
 * 返回替换的次数。
 */
function replaceRawWithStyles(root, raw, customStylesHtml) {
    const { segments, fullText } = collectTextSegments(root);

    // 收集全部匹配偏移（优先 raw 原文；兜底 ... → … 归一）
    const matches = [];
    const normalized = raw.replace(/\.\.\./g, '…');
    let searchFrom = 0;
    for (let guard = 0; guard < 50; guard++) {
        let i = fullText.indexOf(raw, searchFrom);
        if (i === -1 && normalized !== raw) i = fullText.indexOf(normalized, searchFrom);
        if (i === -1) break;
        matches.push(i);
        searchFrom = i + raw.length;
    }
    if (matches.length === 0) return 0;

    // 从后往前替换：后部替换不改变前部偏移/节点，DOM 引用保持有效
    for (let k = matches.length - 1; k >= 0; k--) {
        const pos = matches[k];
        const range = buildRangeForOffset(segments, pos, pos + raw.length);
        if (!range) continue;
        const fragment = range.createContextualFragment(customStylesHtml);
        range.deleteContents();
        range.insertNode(fragment);
    }
    return matches.length;
}

export function renderSingleMessageContext(messages, container, mes, anchorIndex) {
    try {
        if (!messages || !container || container.length === 0) {
            debugLog('renderSingleMessageContext: 参数无效，跳过渲染');
            return;
        }

        const domNode = container.jquery ? container[0] : container;
        const swipeId = mes.attr('swipeid');
        const renderSwipe = mes.attr('renderSwipe');

        // 过滤出可渲染的条目（有 raw 且有样式）
        const renderable = messages.filter(entry =>
            entry && entry.moduleData
            && typeof entry.moduleData.raw === 'string' && entry.moduleData.raw.trim() !== ''
            && typeof entry.customStyles === 'string' && entry.customStyles.trim() !== ''
        );
        if (renderable.length === 0) {
            return;
        }

        // 已渲染检测：DOM（排除已渲染子树）中已找不到任何模块原文 → 已渲染过，跳过。
        // （取代旧 renderSwipe === swipeId 时对 processedRaw 的 innerHTML 正则检测）
        if (renderSwipe === swipeId) {
            const { fullText } = collectTextSegments(domNode);
            const anyFound = renderable.some(entry => {
                if (fullText.indexOf(entry.moduleData.raw) !== -1) return true;
                const normalized = entry.moduleData.raw.replace(/\.\.\./g, '…');
                return normalized !== entry.moduleData.raw && fullText.indexOf(normalized) !== -1;
            });
            if (!anyFound) {
                debugLog(`renderSingleMessageContext: 楼层 ${mes.attr('mesid')} 模块原文已不在 DOM 中（可能已渲染），跳过`);
                return;
            }
        }

        // 优先替换 raw 更长的条目（父模块），避免子模块先被替换导致父模块匹配失败
        const sorted = [...renderable].sort((a, b) => (b.moduleData.raw.length - a.moduleData.raw.length));

        let replacedCount = 0;
        sorted.forEach(entry => {
            const n = replaceRawWithStyles(domNode, entry.moduleData.raw, entry.customStyles);
            if (n > 0) {
                replacedCount += n;
            } else {
                infoLog(`messageIndex: ${mes.attr('mesid')} renderSingleMessageContext: 未找到匹配的原文内容，跳过替换`, {
                    entry,
                    raw: entry.moduleData.raw,
                });
            }
        });

        if (replacedCount > 0) {
            mes.attr('renderSwipe', swipeId);
        }
        // 内容锚点兜底：raw 全文未命中的嵌套子模块片段（增量变化的 file 等），
        // 按「模块名+主键」定位到原始片段并替换成对应样式。
        if (anchorIndex && anchorIndex.size) {
            const { segments, fullText } = collectTextSegments(domNode);
            if (fullText) {
                replacedCount += replaceNestedAnchorInDom({ segments, fullText, buildRangeForOffset }, anchorIndex);
            }
        }
        if (replacedCount > 0) {
            mes.attr('renderSwipe', swipeId);
        }
    } catch (error) {
        errorLog('renderSingleMessageContext: 渲染单个消息上下文失败:', error);
        mes.attr('renderSwipe', '');
    }
}
