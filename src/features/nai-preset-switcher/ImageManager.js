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
        if (!groups[gKey]) groups[gKey] = { key: gKey, label: gLabel, images: [] };
        entry.images.forEach((img, idx) => {
            groups[gKey].images.push({
                entry: img,
                title: `${label} #${idx + 1}`,
                meta: img.genParams || null,
            });
        });
    }
    return Object.values(groups).sort((a, b) => a.label.localeCompare(b.label, 'zh'));
}

// 角色/服装预设：遍历预设对象 → photoImageIds
function buildPresetGroups(presetType) {
    const chatu8 = getChatu8();
    if (!chatu8) return [];
    const map = presetType === 'character' ? chatu8.characterPresets : chatu8.outfitPresets;
    if (!map) return [];
    const groups = [];
    for (const name in map) {
        const preset = map[name];
        const ids = (preset && Array.isArray(preset.photoImageIds)) ? preset.photoImageIds : [];
        if (ids.length === 0) continue;
        const images = ids.map((id, idx) => ({
            imageId: id,
            title: `${name} #${idx + 1}`,
        }));
        groups.push({ key: 'preset:' + name, label: name, images });
    }
    return groups.sort((a, b) => a.label.localeCompare(b.label, 'zh'));
}

/* ============ 渲染（分组分页，避免一次性渲染几千张卡顿） ============ */

const GROUPS_PER_PAGE = 12;       // 每页渲染的分组数
const IMAGES_PER_GROUP = 60;      // 单组初始渲染的图片数（超出可「展开」）

function getGroups() {
    if (currentCat === 'chat') return buildChatGroups();
    if (currentCat === 'character') return buildPresetGroups('character');
    if (currentCat === 'outfit') return buildPresetGroups('outfit');
    return [];
}

// 全局缓存当前过滤后的分组列表与已渲染分组数（分页用）
let _allGroups = [];
let _renderedCount = 0;

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
        const title = doc.createElement('span');
        title.className = 'np-img-group-title';
        title.textContent = `${g.label} (${g.images.length})`;
        header.appendChild(title);
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
        im.addEventListener('click', () => openLightbox(src, img.title, img.meta));
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
    removeLoadMore();

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

    _renderedCount = Math.min(GROUPS_PER_PAGE, _allGroups.length);
    appendGroups(0, _renderedCount);
    if (_allGroups.length > _renderedCount) addLoadMore();
}

function addLoadMore() {
    if (!doc) return;
    const list = doc.getElementById('np-img-list');
    if (!list) return;
    const btn = doc.createElement('button');
    btn.id = 'np-img-loadmore';
    btn.className = 'np-img-loadmore';
    btn.textContent = `加载更多分组（已显示 ${_renderedCount}/${_allGroups.length}）`;
    btn.addEventListener('click', () => {
        const next = Math.min(_renderedCount + GROUPS_PER_PAGE, _allGroups.length);
        appendGroups(_renderedCount, next);
        _renderedCount = next;
        if (_renderedCount >= _allGroups.length) {
            btn.remove();
        } else {
            btn.textContent = `加载更多分组（已显示 ${_renderedCount}/${_allGroups.length}）`;
        }
    });
    list.appendChild(btn);
}

function removeLoadMore() {
    if (!doc) return;
    const old = doc.getElementById('np-img-loadmore');
    if (old) old.remove();
}

/* ============ lightbox ============ */

function openLightbox(src, title, meta) {
    if (!doc) return;
    const box = doc.getElementById('np-lightbox');
    const img = doc.getElementById('np-lightbox-img');
    const info = doc.getElementById('np-lightbox-info');
    if (!box || !img) return;
    img.src = src;
    if (info) {
        let html = `<div class="np-lb-title">${escapeHtml(title)}</div>`;
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

function bindControls() {
    if (!doc) return;
    // 大类切换
    const cats = doc.querySelectorAll('#np-img-cats .np-img-cat');
    cats.forEach(btn => {
        btn.addEventListener('click', () => {
            cats.forEach(b => b.classList.toggle('active', b === btn));
            currentCat = btn.getAttribute('data-cat');
            // 显示/隐藏文内生图的子分组切换
            const sub = doc.getElementById('np-img-sub');
            if (sub) {
                const chatSub = sub.querySelector('.np-img-sub-group[data-for="chat"]');
                if (chatSub) chatSub.style.display = (currentCat === 'chat') ? 'flex' : 'none';
            }
            render();
        });
    });

    // 文内生图子分组（按提示词/按预设）
    const subBtns = doc.querySelectorAll('.np-img-sub-group[data-for="chat"] .np-img-sub-btn');
    subBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            subBtns.forEach(b => b.classList.toggle('active', b === btn));
            chatGroupMode = btn.getAttribute('data-group');
            render();
        });
    });

    // 搜索
    const search = doc.getElementById('np-img-search');
    if (search) {
        search.addEventListener('input', () => {
            searchTerm = search.value.trim().toLowerCase();
            render();
        });
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
