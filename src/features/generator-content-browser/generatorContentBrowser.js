// src/features/generator-content-browser/generatorContentBrowser.js
// 生成内容总览面板：集中浏览本聊天的所有 generator 输出（新→旧按楼层分页）。
// 与消息底部的内联展示解耦：不套 customStyles / multiContainerStyles 模板，统一简洁卡片；
// 模块(modules)内容不在此列、完全不动。
// 数据来自 floorModuleStore（chat[floor].ccore.generators，含已从配置删除但仍有历史内容的名称），
// 正文渲染复用与消息底部同源的整页/ markdown 管线。

import { IframeModal } from '../../shared/IframeModal.js';
import { showToast } from '../../shared/Toast.js';
import configManager from '../../singleton/configManager.js';
import { chat } from '../../../../../../../script.js';
import { listGeneratorNames, readAllGeneratorContents } from '../../core/floorModuleStore.js';
import { splitHtmlDocument, buildDocumentIframe } from '../../shared/htmlDocument.js';
import { renderMarkdownToSafeHtml } from '../../shared/messageRenderer.js';
import { errorLog, debugLog } from '../../utils/logger.js';

const PANEL_HTML_URL = new URL('generatorContentBrowser.html', import.meta.url).href;
const PAGE_SIZE = 20;

let panelModal = null;
let panelDoc = null;
let allRecords = [];   // 全量记录（新→旧），open/refresh 时重建
let renderedCount = 0; // 已渲染条数

/** 转义为 HTML 文本 */
function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** 转义为 HTML 属性值 */
function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 收集全量记录：从最新楼层到最旧楼层，每个楼层每个 generator 的每个版本各一条。
 * @returns {Array<{mesId:number, genName:string, displayName:string, innerSwipeId:number, text:string}>}
 */
function collectRecords() {
    const records = [];
    const chatArr = Array.isArray(chat) ? chat : [];

    // name → displayName（含禁用；已删除的 generator 回退用 name）
    const displayNames = {};
    for (const g of configManager.getGenerators(true)) {
        displayNames[g.name] = g.displayName || g.name;
    }

    for (let mesId = chatArr.length - 1; mesId >= 0; mesId--) {
        const msg = chatArr[mesId];
        if (!msg || typeof msg !== 'object') continue;
        const outerSwipeId = msg.swipe_id ?? 0;
        const genNames = listGeneratorNames(mesId);
        for (const genName of genNames) {
            const versions = readAllGeneratorContents(mesId, genName, outerSwipeId, { includeEmpty: false });
            // 内层版本 id 升序，倒过来 = 新版本在前
            const innerIds = Object.keys(versions).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
            for (const inner of innerIds) {
                records.push({
                    mesId,
                    genName,
                    displayName: displayNames[genName] || genName,
                    innerSwipeId: inner,
                    text: versions[inner],
                });
            }
        }
    }
    return records;
}

/** 正文渲染：整页 → 沙盒 iframe；其余 → markdown（前后文字按原顺序拼接） */
function renderContent(text) {
    const split = splitHtmlDocument(text);
    if (split) {
        try {
            const parts = [];
            if (split.before) parts.push(renderMarkdownToSafeHtml(split.before, { stylePrefix: '.ccore-content-body ' }));
            parts.push(buildDocumentIframe(split.doc));
            if (split.after) parts.push(renderMarkdownToSafeHtml(split.after, { stylePrefix: '.ccore-content-body ' }));
            return parts.join('');
        } catch (e) {
            errorLog('[GenContentBrowser] 整页渲染失败，回退 markdown', e);
        }
    }
    try {
        return renderMarkdownToSafeHtml(text, { stylePrefix: '.ccore-content-body ' });
    } catch (e) {
        errorLog('[GenContentBrowser] markdown 渲染失败，回退纯文本', e);
        return escapeHtml(text);
    }
}

/** 单条记录 → 卡片 HTML（<details> 折叠，正文惰性由浏览器收起） */
function renderCard(r) {
    const body = renderContent(r.text);
    return `
<details class="ccore-content-card" data-mesid="${r.mesId}" data-gen="${escapeAttr(r.genName)}">
    <summary>
        <span class="ccore-content-floor">#${r.mesId}</span>
        <span class="ccore-content-gen">${escapeHtml(r.displayName)}</span>
        <span class="ccore-content-swipe">版本 ${r.innerSwipeId + 1}</span>
        <button class="ccore-content-jump" type="button" title="跳到该楼层">跳转</button>
        <span class="ccore-content-caret">▶</span>
    </summary>
    <div class="ccore-content-body">${body}</div>
</details>`;
}

/** 渲染下一页（PAGE_SIZE 条），更新「加载更早楼层」按钮状态 */
function renderNextPage() {
    if (!panelDoc) return;
    const list = panelDoc.getElementById('ccore-content-list');
    const moreBtn = panelDoc.getElementById('ccore-content-more');
    if (!list) return;

    const batch = allRecords.slice(renderedCount, renderedCount + PAGE_SIZE);
    renderedCount += batch.length;
    list.insertAdjacentHTML('beforeend', batch.map(renderCard).join(''));

    if (moreBtn) {
        moreBtn.style.display = renderedCount >= allRecords.length ? 'none' : '';
    }
    if (allRecords.length === 0) {
        list.innerHTML = '<div class="ccore-content-empty">本聊天还没有生成内容。</div>';
    }
}

/** 重读数据并重渲染（面板已打开时复用） */
function refresh() {
    if (!panelDoc) return;
    allRecords = collectRecords();
    renderedCount = 0;
    const list = panelDoc.getElementById('ccore-content-list');
    const subtitle = panelDoc.getElementById('ccore-content-subtitle');
    if (list) list.innerHTML = '';
    if (subtitle) subtitle.textContent = `${allRecords.length} 条`;
    renderNextPage();
}

/** 关闭面板并滚动到对应楼层 */
function jumpToFloor(mesId) {
    if (panelModal) panelModal.close();
    setTimeout(() => {
        try {
            const el = document.querySelector(`#chat .mes[mesid="${CSS.escape(String(mesId))}"]`);
            if (!el) {
                showToast(`未找到楼层 #${mesId}`, 'error');
                return;
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const prev = el.style.boxShadow;
            el.style.boxShadow = '0 0 0 3px var(--SmartThemeQuoteColor, #C9762E)';
            setTimeout(() => { el.style.boxShadow = prev; }, 2000);
        } catch (e) {
            errorLog('[GenContentBrowser] 跳转楼层失败', e);
        }
    }, 300); // 等面板关闭动画
}

/**
 * 打开生成内容总览面板（单实例）。已打开时重读数据并刷新。
 */
export function openGeneratorContentBrowser() {
    if (panelModal && panelModal.backdrop && panelDoc) {
        panelModal.backdrop.style.display = '';
        requestAnimationFrame(() => panelModal.backdrop.classList.add('open'));
        refresh();
        return;
    }

    if (!panelModal) panelModal = new IframeModal();
    panelModal.open(PANEL_HTML_URL, '生成内容总览', {
        variant: 'center',
        onLoad: (iframe) => {
            const doc = iframe.contentDocument;
            if (!doc) return;
            panelDoc = doc;
            const theme = localStorage.getItem('st_continuity_theme') || 'light';
            doc.documentElement.setAttribute('data-theme', theme);

            const closeBtn = doc.getElementById('ccore-content-close');
            if (closeBtn) closeBtn.addEventListener('click', () => panelModal.close());

            const moreBtn = doc.getElementById('ccore-content-more');
            if (moreBtn) moreBtn.addEventListener('click', () => renderNextPage());

            // 「跳转」按钮：委托监听，阻止 summary 折叠，跳到对应楼层
            const list = doc.getElementById('ccore-content-list');
            if (list) {
                list.addEventListener('click', (e) => {
                    const jump = e.target.closest('.ccore-content-jump');
                    if (!jump) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const card = jump.closest('.ccore-content-card');
                    const mesId = card?.dataset?.mesid;
                    if (mesId !== undefined && mesId !== '') jumpToFloor(Number(mesId));
                });
            }

            refresh();
        },
    });
}

// 供 EntryButton 等通过 window 调用（与 openGenerationRecords 同构）
if (typeof window !== 'undefined') {
    window.openGeneratorContentBrowser = openGeneratorContentBrowser;
}
