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
import { initSortControl } from './SortControl.js';

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

/* ============ 角色/服装副本识别（方案 C：延迟加载 + 异步标记） ============ */
// 智绘姬角色/服装生图会双写：同一张图在 jiuguanStorage（文内）与
// configImageStorage（预设）各存一份物理文件。文内视图里这些「副本」加徽标识别。
// 判定思路：先给角色/服装引用图建索引（path/size/hash，数量少）；文内图先比 size，
// 不命中的直接跳过（不 fetch），size 疑似命中的才异步 fetch 做内容 hash 确认。
let presetRefs = null;           // [{path,size,source,name,hash}] 引用图索引
let presetRefsSignature = '';    // 引用图 path 集合签名（变化则重建）
let dupCache = new Map();        // 文内图 path -> {source,name}|null（null=已判定非副本）
let dupCheckRunning = false;     // 防并发
let refsBuildPromise = null;     // 引用图索引构建共享 promise（多次触发只建一次）
const DUP_BATCH = 20;            // 每批确认的疑似副本数

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

// 返回 [{ key, label, images:[{src, title, meta, dup}] }]
// pendingSet：收集 size 疑似命中角色/服装引用图的 path（供后台 fetch 确认）
function buildChatGroups(pendingSet) {
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
                date: img.date || 0, // 供组内按日期排序
                path: img.path || '', // 文件路径（lightbox 显示）
                dup: judgeChatImage(img, pendingSet), // 角色/服装副本标记（可为 null）
            });
        });
    }
    return Object.values(groups);
}

// 同步判断一张文内图是否疑似角色/服装副本：
//  - 已判定过 → 返回缓存结果
//  - size 不命中引用图集合 → 记为 null（非副本），无需 fetch
//  - size 疑似命中 → 把 path 记入 pendingSet，返回 null（等待后台 fetch 确认）
function judgeChatImage(img, pendingSet) {
    const path = img.path || '';
    if (!path || !presetRefs || presetRefs.length === 0) return null;
    if (dupCache.has(path)) return dupCache.get(path);
    const size = typeof img.size === 'number' ? img.size : null;
    if (size === null || !presetRefs.some(r => r.size === size)) {
        dupCache.set(path, null);
        return null;
    }
    if (pendingSet) pendingSet.add(path);
    return null;
}

// 内容指纹：优先 crypto.subtle SHA-256（安全上下文），否则 FNV-1a 64bit 兜底
async function hashBuffer(buf) {
    try {
        if (crypto.subtle && crypto.subtle.digest) {
            const d = await crypto.subtle.digest('SHA-256', buf);
            return Array.from(new Uint8Array(d)).slice(0, 16)
                .map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (e) { /* 回退 FNV */ }
    const view = new Uint8Array(buf);
    let h1 = 0x811c9dc5, h2 = 0x811c9dc5;
    for (let i = 0; i < view.length; i++) {
        h1 = Math.imul(h1 ^ view[i], 0x01000193) >>> 0;
        if ((i & 3) === 3) h2 = Math.imul(h2 ^ view[i], 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

async function fetchBuffer(path) {
    const res = await fetch(path, { headers: getRequestHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
}

// 构建角色/服装引用图索引（path/size/hash）。仅当引用图集合变化时重建；
// 重建会清空 dupCache（旧判定可能失效），需要重新判定。
async function buildPresetRefs() {
    const chatu8 = getChatu8();
    if (!chatu8) return;
    const storage = chatu8.configImageStorage || {};
    const refs = [];
    for (const [type, map] of [['character', chatu8.characterPresets], ['outfit', chatu8.outfitPresets]]) {
        for (const name in (map || {})) {
            const preset = map[name];
            const ids = (preset && Array.isArray(preset.photoImageIds)) ? preset.photoImageIds : [];
            for (const id of ids) {
                const entry = storage[id];
                if (entry && entry.path) refs.push({ path: entry.path, source: type, name });
            }
        }
    }
    const sig = refs.map(r => r.path).join('|');
    if (sig === presetRefsSignature) return;
    presetRefsSignature = sig;
    const indexed = [];
    for (let i = 0; i < refs.length; i += DUP_BATCH) {
        const batch = refs.slice(i, i + DUP_BATCH);
        await Promise.all(batch.map(async (r) => {
            try {
                const buf = await fetchBuffer(r.path);
                indexed.push({ ...r, size: buf.byteLength, hash: await hashBuffer(buf) });
            } catch (e) { /* 单张读取失败跳过 */ }
        }));
    }
    presetRefs = indexed;
    dupCache = new Map(); // 引用图变化 → 旧判定清空重判
}

function ensurePresetRefs() {
    if (!refsBuildPromise) {
        refsBuildPromise = buildPresetRefs().finally(() => { refsBuildPromise = null; });
    }
    return refsBuildPromise;
}

// 后台分批确认 size 疑似命中的图，完成后整体重渲一次（徽标出现）
async function runDupCheck(pendingSet) {
    if (dupCheckRunning || !pendingSet || pendingSet.size === 0) return;
    dupCheckRunning = true;
    const paths = [...pendingSet];
    try {
        for (let i = 0; i < paths.length; i += DUP_BATCH) {
            const batch = paths.slice(i, i + DUP_BATCH);
            await Promise.all(batch.map(async (path) => {
                if (dupCache.has(path)) return;
                try {
                    const buf = await fetchBuffer(path);
                    const hash = await hashBuffer(buf);
                    const hit = presetRefs.find(r => r.size === buf.byteLength && r.hash === hash);
                    dupCache.set(path, hit ? { source: hit.source, name: hit.name } : null);
                } catch (e) {
                    dupCache.set(path, null); // 读取失败按非副本处理，避免反复重试
                }
            }));
        }
    } finally {
        dupCheckRunning = false;
    }
    render(); // 判定完成，重渲（页码保留）让徽标出现
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
            const sd = (storage[id] && storage[id].date) || 0;
            if (sd && sd > date) date = sd;
            return {
                imageId: id,
                title: `${name} #${idx + 1}`,
                date: sd, // 供组内按日期排序
                path: (storage[id] && storage[id].path) || '', // 文件路径（lightbox 显示）
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

function getGroups(pendingSet) {
    let groups;
    if (currentCat === 'chat') groups = buildChatGroups(pendingSet);
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
    // 组内图片同样按排序模式排序（dateDesc/dateAsc 按各自 date；nameAsc 保持原有顺序）
    for (const g of groups) {
        if (sortMode === 'dateAsc') {
            g.images.sort((x, y) => (x.date || 0) - (y.date || 0));
        } else if (sortMode === 'dateDesc') {
            g.images.sort((x, y) => (y.date || 0) - (x.date || 0));
        }
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
                // 非安全上下文（如 http://局域网IP 访问 ST）navigator.clipboard 为 undefined，
                // 直接 writeText 会抛 TypeError → 必须走 copyText 的 execCommand 兜底
                const ok = await copyText(titleInfo.full);
                copy.textContent = ok ? '已复制' : '复制失败';
                copy.classList.toggle('copied', ok);
                setTimeout(() => { copy.textContent = '复制'; copy.classList.remove('copied'); }, 1500);
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
        el.textContent = '';
        const im = doc.createElement('img');
        im.className = 'np-img-thumb-img';
        im.src = src;
        im.alt = img.title;
        im.addEventListener('click', () => openLightbox(src, img.title, img.meta, img.path));
        el.appendChild(im);
        if (img.dup) el.appendChild(buildDupBadge(img.dup));
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

    const pendingSet = new Set();
    _allGroups = getGroups(pendingSet);

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

    // 文内视图：后台识别角色/服装副本（先显示，异步补徽标，不阻塞）。
    // 首次进入时 presetRefs 为 null（pendingSet 恒空），必须无条件触发构建，
    // 构建完成后统一 collectPendingAndCheck 重新扫描当前列表，否则徽标永远不会出现。
    if (currentCat === 'chat') {
        ensurePresetRefs().then(() => collectPendingAndCheck()).catch(() => { /* 失败不影响浏览 */ });
    }
}

// 在 presetRefs 已就绪的前提下，重新扫描当前分组的文内图：
// judgeChatImage 会写入 dupCache（size 不命中记 null）并把 size 疑似命中的收进 pending。
async function collectPendingAndCheck() {
    if (currentCat !== 'chat' || !presetRefs || presetRefs.length === 0) return;
    const pending = new Set();
    for (const g of _allGroups) {
        for (const img of g.images) {
            judgeChatImage(img.entry, pending);
        }
    }
    if (pending.size > 0) await runDupCheck(pending);
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

function openLightbox(src, title, meta, filePath) {
    if (!doc) return;
    const box = doc.getElementById('np-lightbox');
    const img = doc.getElementById('np-lightbox-img');
    const info = doc.getElementById('np-lightbox-info');
    if (!box || !img) return;
    img.src = src;
    if (info) {
        let html = `<div class="np-lb-title">${escapeHtml(title)}</div>`;
        // 文件路径（如 /user/images/chatu8/xxx.png），便于与控制台脚本核对
        if (filePath) html += `<div class="np-lb-file">${escapeHtml(filePath)}</div>`;
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

// 角色/服装副本徽标（A2：文内视图保留显示，emoji 角标识别，无背景不依赖主题）
function buildDupBadge(dup) {
    const badge = doc.createElement('span');
    badge.className = 'np-img-dup-badge';
    const isChar = dup.source === 'character';
    badge.textContent = isChar ? '👤' : '👗';
    badge.title = `${isChar ? '角色' : '服装'}预设「${dup.name}」的副本`;
    return badge;
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// 复制文本：优先 navigator.clipboard（仅安全上下文可用），不可用/失败时回退
// execCommand('copy')（临时 textarea + select）。与预设管理/解析页的复制兜底一致。
function copyText(text) {
    return new Promise(resolve => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => resolve(true))
                .catch(() => resolve(fallbackCopy(text)));
        } else {
            resolve(fallbackCopy(text));
        }
    });
}

function fallbackCopy(text) {
    try {
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = doc.execCommand('copy');
        ta.remove();
        return ok;
    } catch (e) {
        errorLog('[图片管理] 复制失败:', e);
        return false;
    }
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

    // 排序方式（与预设管理页同款图标按钮 + 下拉菜单交互）
    const IMG_SORT_OPTIONS = [
        { mode: 'dateDesc', label: '日期（新→旧）' },
        { mode: 'dateAsc', label: '日期（旧→新）' },
        { mode: 'nameAsc', label: '名称' },
    ];
    try {
        initSortControl(doc, {
            getCurrentMode: () => sortMode,
            onModeChange: (m) => {
                sortMode = m;
                try { localStorage.setItem(SORT_KEY, sortMode); } catch (e) { /* ignore */ }
                reloadFirstPage();
            },
        }, IMG_SORT_OPTIONS, 'np-img-sort');
    } catch (e) { /* 降级：排序控件不可用不影响其他 */ }

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
