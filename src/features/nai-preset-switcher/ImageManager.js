// src/features/nai-preset-switcher/ImageManager.js
// 图片管理：把智绘姬三类图片（文内生图 / 角色预设 / 服装预设）按来源分组展示，
// 支持点击放大预览。不做删除（后续再做）。
//
// 数据来源（均直接读 extension_settings["st-chatu8"]，本插件已 import 同一对象）：
//  1. 文内生图  → jiuguanStorage[md5(提示词)].images[]（path/uuid）
//  2. 角色预设  → characterPresets[name].photoImageIds[] → configImageStorage[id].path
//  3. 服装预设  → outfitPresets[name].photoImageIds[]    → configImageStorage[id].path
//
// 图片渲染：服务端 path 用 fetch(getRequestHeaders) 取 blob → objectURL（与智绘姬 getItemImg 一致，
// 避免 <img> 直接带 path 因缺 token 鉴权而 403）。

import { extension_settings } from '../../../../../../extensions.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { errorLog } from '../../utils/logger.js';

const CHATU8 = 'st-chatu8';

let doc = null;
let currentCat = 'chat';       // chat | character | outfit
let chatGroupMode = 'prompt';  // prompt(按提示词) | preset(按预设 yushe)
let searchTerm = '';
let sortMode = 'dateDesc';      // dateDesc(新→旧) | dateAsc(旧→新) | nameAsc(名称)
const SORT_KEY = 'st_continuity_nai_img_sort';
try {
    const saved = localStorage.getItem(SORT_KEY);
    if (saved === 'dateDesc' || saved === 'dateAsc' || saved === 'nameAsc') sortMode = saved;
} catch (e) { /* ignore */ }
const blobUrlCache = new Map(); // path -> objectURL，避免重复 fetch

/* ============ 数据读取 ============ */

function getChatu8() {
    try {
        return extension_settings[CHATU8] || null;
    } catch (e) {
        return null;
    }
}

// 取单张图片的可用 src（优先服务端 path，否则回退 IndexedDB uuid）
async function resolveImageSrc(imgEntry) {
    if (!imgEntry) return null;
    // 服务端 path
    if (imgEntry.path) {
        if (blobUrlCache.has(imgEntry.path)) return blobUrlCache.get(imgEntry.path);
        try {
            const res = await fetch(imgEntry.path, { headers: getRequestHeaders() });
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                blobUrlCache.set(imgEntry.path, url);
                return url;
            }
        } catch (e) {
            errorLog('[图片管理] 读取服务端图片失败:', e);
        }
    }
    // IndexedDB uuid（文内生图本地存储时）
    if (imgEntry.uuid) {
        try {
            const db = await openChatu8ConfigDB();
            const data = await idbGet(db, imgEntry.uuid);
            if (data && data.data) {
                const mime = imgEntry.isVideo ? 'video/mp4' : 'image/png';
                return `data:${mime};base64,` + arrayBufferToBase64(data.data);
            }
        } catch (e) {
            errorLog('[图片管理] 读取 IndexedDB 图片失败:', e);
        }
    }
    return null;
}

// 从 configImageStorage[id] 取预设类图片 src
async function resolveConfigImageSrc(imageId) {
    const chatu8 = getChatu8();
    if (!chatu8 || !imageId) return null;
    const entry = chatu8.configImageStorage && chatu8.configImageStorage[imageId];
    if (entry && entry.path) {
        if (blobUrlCache.has(entry.path)) return blobUrlCache.get(entry.path);
        try {
            const res = await fetch(entry.path, { headers: getRequestHeaders() });
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                blobUrlCache.set(entry.path, url);
                return url;
            }
        } catch (e) {
            errorLog('[图片管理] 读取预设图片失败:', e);
        }
    }
    // IndexedDB 回退（configImageStorage 无 path 时本地存储）
    try {
        const db = await openChatu8ConfigDB();
        const data = await idbGet(db, imageId);
        if (data && data.data) {
            const mime = (data.mimeType && data.mimeType.startsWith('video')) ? 'video/mp4' : 'image/png';
            const b64 = typeof data.data === 'string' && data.data.startsWith('data:')
                ? data.data
                : `data:${mime};base64,` + arrayBufferToBase64(data.data);
            return b64;
        }
    } catch (e) {
        errorLog('[图片管理] 读取预设 IndexedDB 图片失败:', e);
    }
    return null;
}

/* ============ IndexedDB 读取（config_images，与智绘姬同源） ============ */

let _dbPromise = null;
function openChatu8ConfigDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('chatu8_config_images', 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _dbPromise;
}

function idbGet(db, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('config_images', 'readonly');
        const store = tx.objectStore('config_images');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
}

/* ============ 分组数据构建 ============ */

// 返回 [{ key, label, images:[{src, title, meta}] }]
function buildChatGroups() {
    const chatu8 = getChatu8();
    const storage = (chatu8 && chatu8.jiuguanStorage) || {};
    const groups = {};
    for (const md5 in storage) {
        const entry = storage[md5];
        if (!entry || !Array.isArray(entry.images) || entry.images.length === 0) continue;
        const change = entry.change || '';
        const label = change || '(未命名提示词)';
        // 子分组 key：prompt=提示词原文；preset=genParams.yushe
        let gKey, gLabel;
        if (chatGroupMode === 'preset') {
            const yushe = (entry.images[0] && entry.images[0].genParams && entry.images[0].genParams.yushe) || '未关联预设';
            gKey = 'preset:' + yushe;
            gLabel = yushe;
        } else {
            gKey = 'prompt:' + md5;
            gLabel = label;
        }
        if (!groups[gKey]) groups[gKey] = { key: gKey, label: gLabel, images: [], date: 0 };
        entry.images.forEach((img, idx) => {
            if (img.date && img.date > groups[gKey].date) groups[gKey].date = img.date;
            groups[gKey].images.push({
                entry: img,
                title: `${label} #${idx + 1}`,
                meta: img.genParams || null,
            });
        });
    }
    return Object.values(groups);
}

// 角色/服装预设：遍历预设对象 → photoImageIds
function buildPresetGroups(presetType) {
    const chatu8 = getChatu8();
    if (!chatu8) return [];
    const map = presetType === 'character' ? chatu8.characterPresets : chatu8.outfitPresets;
    const storage = chatu8.configImageStorage || {};
    if (!map) return [];
    const groups = [];
    for (const name in map) {
        const preset = map[name];
        const ids = (preset && Array.isArray(preset.photoImageIds)) ? preset.photoImageIds : [];
        if (ids.length === 0) continue;
        let date = 0;
        const images = ids.map((id, idx) => {
            const sd = storage[id] && storage[id].date;
            if (sd && sd > date) date = sd;
            return {
                imageId: id,
                title: `${name} #${idx + 1}`,
            };
        });
        groups.push({ key: 'preset:' + name, label: name, images, date });
    }
    return groups;
}

/* ============ 渲染（分组分页：顶部页码导航） ============ */

const GROUPS_PER_PAGE = 12;       // 每页渲染的分组数（每页分组数 × 单组初始图数 可控）
const IMAGES_PER_GROUP = 12;      // 单组初始渲染的图片数（超出默认折叠，点「展开剩余」显示）
const PROMPT_LABEL_MAX = 40;      // 提示词分组名截断长度（超出显示「…」+ 点击展开）

function getGroups() {
    let groups;
    if (currentCat === 'chat') groups = buildChatGroups();
    else if (currentCat === 'character') groups = buildPresetGroups('character');
    else if (currentCat === 'outfit') groups = buildPresetGroups('outfit');
    else groups = [];
    // 排序：日期降序/升序/名称
    if (sortMode === 'nameAsc') {
        groups.sort((a, b) => a.label.localeCompare(b.label, 'zh'));
    } else if (sortMode === 'dateAsc') {
        groups.sort((a, b) => (a.date || 0) - (b.date || 0));
    } else {
        groups.sort((a, b) => (b.date || 0) - (a.date || 0));
    }
    return groups;
}

// 全局缓存当前过滤后的分组列表与当前页码（分页用）
let _allGroups = [];
let _currentPage = 1;
let _totalPages = 1;

// 截断提示词分组名（仅文内生图按提示词分组时 label 可能很长）
function makeGroupTitle(g) {
    const full = g.label;
    if (currentCat === 'chat' && chatGroupMode === 'prompt' && full.length > PROMPT_LABEL_MAX) {
        const short = full.slice(0, PROMPT_LABEL_MAX) + '…';
        return { short, full, truncated: true };
    }
    return { short: full, full, truncated: false };
}

function appendGroups(start, end) {
    if (!doc) return;
    const list = doc.getElementById('np-img-list');
    if (!list) return;

    for (let i = start; i < end && i < _allGroups.length; i++) {
        const g = _allGroups[i];
        const groupEl = doc.createElement('div');
        groupEl.className = 'np-img-group';

        const header = doc.createElement('div');
        header.className = 'np-img-group-header';
        const titleInfo = makeGroupTitle(g);

        const title = doc.createElement('span');
        title.className = 'np-img-group-title';
        let dateLabel = '';
        if (g.date) {
            try {
                const d = new Date(g.date);
                const pad = (n) => String(n).padStart(2, '0');
                dateLabel = ` · ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            } catch (e) { /* ignore */ }
        }
        title.textContent = `${titleInfo.short} (${g.images.length}${dateLabel})`;
        header.appendChild(title);

        // 提示词过长：提供「展开」+「复制」按钮；展开后可「收回」
        if (titleInfo.truncated) {
            const expand = doc.createElement('button');
            expand.className = 'np-img-group-expand';
            expand.textContent = '展开';
            let expanded = false;
            expand.addEventListener('click', () => {
                expanded = !expanded;
                title.textContent = `${expanded ? titleInfo.full : titleInfo.short} (${g.images.length})`;
                expand.textContent = expanded ? '收回' : '展开';
            });
            header.appendChild(expand);

            const copy = doc.createElement('button');
            copy.className = 'np-img-group-copy';
            copy.textContent = '复制';
            copy.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(titleInfo.full);
                    copy.textContent = '已复制';
                    copy.classList.add('copied');
                    setTimeout(() => { copy.textContent = '复制'; copy.classList.remove('copied'); }, 1500);
                } catch (e) {
                    copy.textContent = '复制失败';
                    setTimeout(() => { copy.textContent = '复制'; }, 1500);
                }
            });
            header.appendChild(copy);
        }
        groupEl.appendChild(header);

        const grid = doc.createElement('div');
        grid.className = 'np-img-grid';

        const visible = g.images.slice(0, IMAGES_PER_GROUP);
        visible.forEach(img => grid.appendChild(buildImageCell(img)));

        // 单组图片超过阈值：提供「展开全部」
        if (g.images.length > IMAGES_PER_GROUP) {
            const more = doc.createElement('button');
            more.className = 'np-img-group-more';
            more.textContent = `展开剩余 ${g.images.length - IMAGES_PER_GROUP} 张`;
            more.addEventListener('click', () => {
                g.images.slice(IMAGES_PER_GROUP).forEach(img => grid.appendChild(buildImageCell(img)));
                more.remove();
            });
            grid.appendChild(more);
        }

        groupEl.appendChild(grid);
        list.appendChild(groupEl);
    }
}

function buildImageCell(img) {
    const cell = doc.createElement('div');
    cell.className = 'np-img-cell';
    const el = doc.createElement('div');
    el.className = 'np-img-thumb';
    el.textContent = '加载中…';

    const srcPromise = currentCat === 'chat'
        ? resolveImageSrc(img.entry)
        : resolveConfigImageSrc(img.imageId);
    srcPromise.then(src => {
        if (!src) { el.textContent = '读取失败'; return; }
        el.innerHTML = '';
        const im = doc.createElement('img');
        im.className = 'np-img-thumb-img';
        im.src = src;
        im.alt = img.title;
        im.addEventListener('click', () => openLightbox(src, img.title, img.meta, currentCat));
        el.appendChild(im);
    }).catch(() => { el.textContent = '读取失败'; });

    cell.appendChild(el);
    const cap = doc.createElement('div');
    cap.className = 'np-img-cap';
    cap.textContent = img.title;
    cell.appendChild(cap);
    return cell;
}

function render() {
    if (!doc) return;
    const list = doc.getElementById('np-img-list');
    const empty = doc.getElementById('np-img-empty');
    if (!list) return;
    list.innerHTML = '';
    removePager();

    _allGroups = getGroups();

    // 搜索过滤（分组名 / 提示词原文）
    if (searchTerm) {
        _allGroups = _allGroups.filter(g => g.label.toLowerCase().includes(searchTerm));
    }

    if (_allGroups.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    // 总页数：按分组数分页（每页 GROUPS_PER_PAGE 个分组）
    _totalPages = Math.max(1, Math.ceil(_allGroups.length / GROUPS_PER_PAGE));
    if (_currentPage > _totalPages) _currentPage = _totalPages;
    if (_currentPage < 1) _currentPage = 1;

    const start = (_currentPage - 1) * GROUPS_PER_PAGE;
    const end = Math.min(start + GROUPS_PER_PAGE, _allGroups.length);
    appendGroups(start, end);
    renderPager();
}

// 顶部页码导航（第一页/上一页/页码/下一页/最后一页）
function renderPager() {
    if (!doc) return;
    const pager = doc.getElementById('np-img-pager-top');
    if (!pager) return;
    pager.innerHTML = '';
    if (_totalPages <= 1) return;

    const mk = (label, page, opts = {}) => {
        const b = doc.createElement('button');
        b.className = 'np-img-page' + (opts.active ? ' active' : '') + (opts.disabled ? ' disabled' : '');
        b.textContent = label;
        if (!opts.disabled && !opts.active) {
            b.addEventListener('click', () => { _currentPage = page; render(); });
        }
        return b;
    };

    const pages = doc.createElement('div');
    pages.className = 'np-img-pager-pages';

    pages.appendChild(mk('«', 1, { disabled: _currentPage === 1 }));
    pages.appendChild(mk('‹', _currentPage - 1, { disabled: _currentPage === 1 }));

    // 页码窗口：按容器实际宽度动态估算可显示的页码数（撑满整行）
    const pageW = 44;  // 单页码按钮约 38px + gap 6px
    const arrowsW = pageW * 4; // « ‹ › » 四个箭头
    const boxW = pager.getBoundingClientRect ? pager.getBoundingClientRect().width : 0;
    const usableW = boxW > arrowsW + pageW ? boxW - arrowsW : 320;
    let win = Math.max(1, Math.floor(usableW / pageW)); // 当前页两侧各显示 win 个
    win = Math.min(win, Math.ceil(_totalPages / 2));
    const from = Math.max(1, _currentPage - win);
    const to = Math.min(_totalPages, _currentPage + win);
    if (from > 1) {
        pages.appendChild(mk('1', 1));
        if (from > 2) {
            const dot = doc.createElement('span');
            dot.className = 'np-img-page-dot';
            dot.textContent = '…';
            pages.appendChild(dot);
        }
    }
    for (let p = from; p <= to; p++) {
        pages.appendChild(mk(String(p), p, { active: p === _currentPage }));
    }
    if (to < _totalPages) {
        if (to < _totalPages - 1) {
            const dot = doc.createElement('span');
            dot.className = 'np-img-page-dot';
            dot.textContent = '…';
            pages.appendChild(dot);
        }
        pages.appendChild(mk(String(_totalPages), _totalPages));
    }

    pages.appendChild(mk('›', _currentPage + 1, { disabled: _currentPage === _totalPages }));
    pages.appendChild(mk('»', _totalPages, { disabled: _currentPage === _totalPages }));

    pager.appendChild(pages);

    const info = doc.createElement('span');
    info.className = 'np-img-page-info';
    info.textContent = `第 ${_currentPage}/${_totalPages} 页 · 共 ${_allGroups.length} 组`;
    pager.appendChild(info);
}

function removePager() {
    if (!doc) return;
    const pager = doc.getElementById('np-img-pager-top');
    if (pager) pager.innerHTML = '';
}

/* ============ lightbox ============ */

function openLightbox(src, title, meta, cat) {
    if (!doc) return;
    const box = doc.getElementById('np-lightbox');
    const img = doc.getElementById('np-lightbox-img');
    const info = doc.getElementById('np-lightbox-info');
    if (!box || !img) return;
    img.src = src;
    if (info) {
        let sourceLabel = '';
        if (cat === 'chat') sourceLabel = '来源：文内生图（jiuguanStorage）';
        else if (cat === 'character') sourceLabel = '来源：角色预设（configImageStorage）';
        else if (cat === 'outfit') sourceLabel = '来源：服装预设（configImageStorage）';
        let html = `<div class="np-lb-title">${escapeHtml(title)}</div>`;
        if (sourceLabel) html += `<div class="np-lb-source">${escapeHtml(sourceLabel)}</div>`;
        if (meta) {
            const rows = [];
            if (meta.yushe) rows.push(`预设：${escapeHtml(meta.yushe)}`);
            if (meta.resolvedPrompt) rows.push(`提示词：${escapeHtml(meta.resolvedPrompt)}`);
            if (meta.backend) rows.push(`后端：${escapeHtml(meta.backend)}`);
            if (meta.model) rows.push(`模型：${escapeHtml(meta.model)}`);
            if (meta.seed) rows.push(`种子：${escapeHtml(String(meta.seed))}`);
            if (rows.length) html += `<div class="np-lb-meta">${rows.join('<br>')}</div>`;
        }
        info.innerHTML = html;
    }
    box.style.display = 'flex';
}

function closeLightbox() {
    if (!doc) return;
    const box = doc.getElementById('np-lightbox');
    const img = doc.getElementById('np-lightbox-img');
    if (box) box.style.display = 'none';
    if (img) img.src = '';
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ============ 事件绑定 ============ */

// 切换分类/子分组/搜索时回到第一页（页码点击的 render 不重置）
function reloadFirstPage() {
    _currentPage = 1;
    render();
}

function bindControls() {
    if (!doc) return;
    // 大类切换
    const cats = doc.querySelectorAll('#np-img-cats .np-img-cat');
    cats.forEach(btn => {
        btn.addEventListener('click', () => {
            cats.forEach(b => b.classList.toggle('active', b === btn));
            currentCat = btn.getAttribute('data-cat');
            // 显示/隐藏文内生图的子分组切换（角色/服装预设无二级分组，连分隔线一起隐藏）
            const sub = doc.getElementById('np-img-sub');
            if (sub) {
                sub.style.display = (currentCat === 'chat') ? 'flex' : 'none';
            }
            reloadFirstPage();
        });
    });

    // 文内生图子分组（按提示词/按预设）
    const subBtns = doc.querySelectorAll('.np-img-sub-group[data-for="chat"] .np-img-sub-btn');
    subBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            subBtns.forEach(b => b.classList.toggle('active', b === btn));
            chatGroupMode = btn.getAttribute('data-group');
            reloadFirstPage();
        });
    });

    // 搜索
    const search = doc.getElementById('np-img-search');
    if (search) {
        search.addEventListener('input', () => {
            searchTerm = search.value.trim().toLowerCase();
            reloadFirstPage();
        });
    }

    // 排序方式
    const sortSel = doc.getElementById('np-img-sort');
    if (sortSel) {
        sortSel.value = sortMode;
        sortSel.addEventListener('change', () => {
            sortMode = sortSel.value;
            try { localStorage.setItem(SORT_KEY, sortMode); } catch (e) { /* ignore */ }
            reloadFirstPage();
        });
    }

    // 页码容器宽度变化 → 仅重渲页码（不重渲列表），让页码数跟随撑满宽度
    const pagerBox = doc.getElementById('np-img-pager-top');
    if (pagerBox && typeof ResizeObserver !== 'undefined' && !pagerBox._npResizeObs) {
        const ro = new ResizeObserver(() => {
            if (_allGroups.length > 0 && _totalPages > 1) renderPager();
        });
        ro.observe(pagerBox);
        pagerBox._npResizeObs = ro;
    }

    // lightbox 关闭
    const closeBtn = doc.getElementById('np-lightbox-close');
    if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
    const box = doc.getElementById('np-lightbox');
    if (box) {
        box.addEventListener('click', (e) => {
            if (e.target === box) closeLightbox();
        });
    }
}

/* ============ 初始化 ============ */

// 轻量初始化：仅绑定事件，不主动渲染。
// 渲染推迟到用户实际切到「图片管理」tab 时（renderImageManagerOnDemand），
// 避免打开抽屉/渲染预设时与图片读取抢资源、影响其他功能。
export function initImageManager(iframeDocument) {
    doc = iframeDocument;
    if (!doc.getElementById('np-img-list')) return;
    try {
        bindControls();
    } catch (e) {
        errorLog('[图片管理] 初始化失败（不影响预设管理）:', e);
    }
}

// 按需渲染：由 nav 切换到图片管理 tab 时调用。
// keepAlive 模式下打开抽屉若默认停在图片 tab，本函数也会在切换/显示时被触发。
export function renderImageManagerOnDemand(iframeDocument) {
    if (!iframeDocument) return;
    doc = iframeDocument;
    if (!doc.getElementById('np-img-list')) return;
    try {
        render();
    } catch (e) {
        errorLog('[图片管理] 渲染失败（不影响预设管理）:', e);
    }
}

// 保留旧导出名作为别名，避免调用方遗漏（实际不再主动调用）
export function syncImageManager(iframeDocument) {
    renderImageManagerOnDemand(iframeDocument);
}
