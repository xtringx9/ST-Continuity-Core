// src/features/nai-preset-switcher/ReadMode.js
// 阅读模式：按 角色 → 聊天 → 楼层顺序 浏览某段聊天的生成图。
// 数据还原路径：
//   chatScan.characters[角色].chats[聊天].map[{storageKey(md5), floors:[楼层]}]
//   → 拍平为 floor → [md5]，按楼层升序
//   → 每楼对应的提示词图（jiuguanStorage[md5]，取当前选中或全部）
// 展示：连续流 / 按楼层分组 两种；取图：只看当前选中 / 全部图。
//
// 依赖 ChatScan（getAllChatScans 扁平记录）、ImageManager（openSharedLightbox 共享预览）。

import { extension_settings } from '../../../../../../extensions.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { errorLog } from '../../utils/logger.js';
import { getAllChatScans } from './ChatScan.js';
import { openSharedLightbox } from './ImageManager.js';

const CHATU8 = 'st-chatu8';

let doc = null;

// 当前阅读状态
let readState = {
    characterName: '',
    chatId: '',
    mode: 'stream',      // 'stream' 连续流 | 'floor' 按楼层分组
    onlyCurrent: false,  // 只看当前选中图
    page: 1,             // 当前页（按楼层数分页）
};
const READ_FLOORS_PER_PAGE = 3;  // 每页楼层数（用户拍板：10 太多）
const READ_STATE_KEY = 'st_continuity_nai_read_mode';
// 持久化到 localStorage：mode / onlyCurrent / characterName / chatId（页码不存，会话性）
function loadReadPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(READ_STATE_KEY) || '{}');
        if (saved.mode === 'stream' || saved.mode === 'floor') readState.mode = saved.mode;
        if (typeof saved.onlyCurrent === 'boolean') readState.onlyCurrent = saved.onlyCurrent;
        if (typeof saved.characterName === 'string') readState.characterName = saved.characterName;
        if (typeof saved.chatId === 'string') readState.chatId = saved.chatId;
    } catch (e) { /* 忽略 */ }
}
function persistReadPrefs() {
    try {
        localStorage.setItem(READ_STATE_KEY, JSON.stringify({
            mode: readState.mode,
            onlyCurrent: readState.onlyCurrent,
            characterName: readState.characterName,
            chatId: readState.chatId,
        }));
    } catch (e) { /* 忽略 */ }
}
loadReadPrefs();

export function setReadDoc(d) { doc = d; }

function getChatu8() {
    try { return extension_settings[CHATU8] || null; } catch (e) { return null; }
}

// 加载一张文内图：优先服务端 path fetch → blob → objectURL；回退 IndexedDB uuid
const blobCache = new Map();
async function loadChatImageSrc(imgEntry) {
    if (!imgEntry) return null;
    if (imgEntry.path) {
        if (blobCache.has(imgEntry.path)) return blobCache.get(imgEntry.path);
        try {
            const res = await fetch(imgEntry.path, { headers: getRequestHeaders() });
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                blobCache.set(imgEntry.path, url);
                return url;
            }
        } catch (e) { errorLog('[阅读模式] 读取图片失败:', e); }
    }
    return null;
}

// 定位 md5 的「当前选中图」：entry.index 是 date 升序数组索引，复刻排序取 uuid
function currentImageOf(entry) {
    if (!entry || !Array.isArray(entry.images) || entry.images.length === 0) return null;
    if (typeof entry.index !== 'number' || entry.index < 0) return entry.images[0] || null;
    const sorted = entry.images
        .map((im, i) => ({ im, i, d: im.date || 0 }))
        .sort((a, b) => a.d - b.d);
    const cur = sorted[Math.min(entry.index, sorted.length - 1)];
    return (cur && cur.im) || entry.images[0] || null;
}

// 构建图流数据：返回 [{floor, prompts: [{prompt, images:[imgEntry]}]}]
// 按楼层升序；同楼内按提示词分组（非「只看当前」时每提示词多张图，避免混在一起）
function buildReadItems(scanRecord) {
    const chatu8 = getChatu8();
    const storage = (chatu8 && chatu8.jiuguanStorage) || {};
    const map = scanRecord && Array.isArray(scanRecord.map) ? scanRecord.map : [];
    // floor -> [{md5, storageKey, prompt}]（保留 map 顺序）
    const floorMap = new Map();
    map.forEach(m => {
        if (!m || !m.storageKey) return;
        const entry = storage[m.storageKey];
        if (!entry || !Array.isArray(entry.images) || entry.images.length === 0) return;
        const prompt = entry.change || '(未命名提示词)';
        (Array.isArray(m.floors) ? m.floors : []).forEach(f => {
            const floor = Number(f);
            if (isNaN(floor)) return;
            if (!floorMap.has(floor)) floorMap.set(floor, []);
            floorMap.get(floor).push({ md5: m.storageKey, storageKey: m.storageKey, prompt });
        });
    });
    // 按楼层升序
    const floors = [...floorMap.keys()].sort((a, b) => a - b);
    const items = [];
    floors.forEach(floor => {
        const list = floorMap.get(floor);
        // 同楼按提示词分组（map 顺序）；每 prompt 一组图
        const prompts = [];
        const seen = new Map(); // prompt -> prompts 索引
        list.forEach(p => {
            const entry = storage[p.storageKey];
            if (!entry) return;
            let group;
            if (seen.has(p.prompt)) {
                group = prompts[seen.get(p.prompt)];
            } else {
                group = { prompt: p.prompt, images: [] };
                seen.set(p.prompt, prompts.length);
                prompts.push(group);
            }
            if (readState.onlyCurrent) {
                const cur = currentImageOf(entry);
                if (cur) group.images.push({ ...cur, _md5: p.storageKey, _prompt: p.prompt, _isCurrent: true });
            } else {
                const cur = currentImageOf(entry);
                const curUuid = cur && cur.uuid;
                entry.images.forEach(im => group.images.push({
                    ...im, _md5: p.storageKey, _prompt: p.prompt,
                    _isCurrent: !!(curUuid && im.uuid && im.uuid === curUuid),
                }));
            }
        });
        const filtered = prompts.filter(g => g.images.length > 0);
        if (filtered.length > 0) items.push({ floor, prompts: filtered });
    });
    return items;
}

// 渲染图流（按楼层数分页；非「只看当前」时楼层内按提示词分组）
function renderRead() {
    if (!doc) return;
    const body = doc.getElementById('np-read-body');
    const emptyTip = doc.getElementById('np-read-empty-tip');
    if (!body) return;

    const records = getAllChatScans();
    const scanRecord = records.find(r => r.characterName === readState.characterName && r.chatId === readState.chatId) || null;

    if (!scanRecord) {
        body.innerHTML = '';
        if (emptyTip) {
            emptyTip.style.display = readState.characterName ? 'block' : 'none';
            emptyTip.textContent = readState.characterName && !readState.chatId
                ? '请选择聊天'
                : '请先选择角色和聊天';
        }
        return;
    }
    if (emptyTip) emptyTip.style.display = 'none';

    const items = buildReadItems(scanRecord);
    body.innerHTML = '';

    if (items.length === 0) {
        const tip = doc.createElement('div');
        tip.className = 'np-read-empty-inline';
        tip.textContent = '该聊天暂无扫描到的图片';
        body.appendChild(tip);
        return;
    }

    // 按楼层数分页
    const totalPages = Math.max(1, Math.ceil(items.length / READ_FLOORS_PER_PAGE));
    if (readState.page > totalPages) readState.page = totalPages;
    if (readState.page < 1) readState.page = 1;
    const start = (readState.page - 1) * READ_FLOORS_PER_PAGE;
    const pageItems = items.slice(start, start + READ_FLOORS_PER_PAGE);

    if (readState.mode === 'floor') {
        // 按楼层分组。每层标题 + 层内：
        //   「只看当前」→ 每提示词仅一张图，密集网格铺开（提示词作 tooltip，不逐组分行）
        //   否则 → 按提示词分组，每提示词小标题 + 图网格
        pageItems.forEach(item => {
            const group = doc.createElement('div');
            group.className = 'np-read-floor';
            const header = doc.createElement('div');
            header.className = 'np-read-floor-header';
            header.textContent = `楼层 ${item.floor}`;
            group.appendChild(header);
            if (readState.onlyCurrent) {
                // 密集显示：所有提示词的当前选中图铺进一个网格
                const flat = [];
                const flatPrompts = [];
                item.prompts.forEach(pg => {
                    pg.images.forEach(im => { flat.push(im); flatPrompts.push(pg.prompt); });
                });
                const grid = doc.createElement('div');
                grid.className = 'np-read-grid np-read-grid-dense';
                flat.forEach((im, idx) => {
                    const cell = buildReadCell(im, flat, idx, true);
                    // 提示词作为图片 tooltip（密集模式无逐组标题）
                    const thumbImg = cell.querySelector('.np-read-img');
                    if (thumbImg) thumbImg.title = flatPrompts[idx] || '';
                    grid.appendChild(cell);
                });
                group.appendChild(grid);
            } else {
                item.prompts.forEach(pg => {
                    const pWrap = doc.createElement('div');
                    pWrap.className = 'np-read-prompt-group';
                    if (item.prompts.length > 1) {
                        const pTitle = doc.createElement('div');
                        pTitle.className = 'np-read-prompt-title';
                        pTitle.textContent = pg.prompt;
                        pTitle.title = pg.prompt;
                        pWrap.appendChild(pTitle);
                    }
                    const grid = doc.createElement('div');
                    grid.className = 'np-read-grid';
                    pg.images.forEach((im, idx) => {
                        grid.appendChild(buildReadCell(im, pg.images, idx));
                    });
                    pWrap.appendChild(grid);
                    group.appendChild(pWrap);
                });
            }
            body.appendChild(group);
        });
    } else {
        // 连续流：图按楼层顺序从上到下平铺；每层内按提示词分组
        const list = doc.createElement('div');
        list.className = 'np-read-stream';
        pageItems.forEach(item => {
            item.prompts.forEach(pg => {
                const pWrap = doc.createElement('div');
                pWrap.className = 'np-read-stream-prompt';
                // 楼层 + 提示词头
                const head = doc.createElement('div');
                head.className = 'np-read-stream-head';
                const floorTag = doc.createElement('span');
                floorTag.className = 'np-read-floor-tag';
                floorTag.textContent = `#${item.floor}`;
                head.appendChild(floorTag);
                const pText = doc.createElement('span');
                pText.className = 'np-read-prompt';
                pText.textContent = pg.prompt;
                pText.title = pg.prompt;
                head.appendChild(pText);
                pWrap.appendChild(head);
                pg.images.forEach((im, idx) => {
                    pWrap.appendChild(buildReadCell(im, pg.images, idx));
                });
                list.appendChild(pWrap);
            });
        });
        body.appendChild(list);
    }

    // 页脚分页
    renderReadPager(totalPages);
}

// 顶部页码导航（一直存在，复用图片管理的 np-img-pager 样式：‹ 页码 ›）
function renderReadPager(totalPages) {
    if (!doc) return;
    const pager = doc.getElementById('np-read-pager-top');
    if (!pager) return;
    pager.innerHTML = '';
    if (totalPages <= 1) return;

    const pages = doc.createElement('div');
    pages.className = 'np-img-pager-pages';

    const mk = (label, page, disabled, active) => {
        const b = doc.createElement('button');
        b.className = 'np-img-page' + (active ? ' active' : '') + (disabled ? ' disabled' : '');
        b.textContent = label;
        b.dataset.page = String(page);
        b.disabled = disabled;
        return b;
    };

    pages.appendChild(mk('«', 1, readState.page <= 1));
    pages.appendChild(mk('‹', readState.page - 1, readState.page <= 1));
    for (let p = 1; p <= totalPages; p++) {
        pages.appendChild(mk(String(p), p, false, p === readState.page));
    }
    pages.appendChild(mk('›', readState.page + 1, readState.page >= totalPages));
    pages.appendChild(mk('»', totalPages, readState.page >= totalPages));

    // 容器级事件委托：点击页码翻页
    pages.addEventListener('click', (e) => {
        const btn = e.target.closest('.np-img-page');
        if (!btn || btn.classList.contains('disabled') || btn.classList.contains('active')) return;
        const p = Number(btn.dataset.page);
        if (!isNaN(p)) { readState.page = p; renderRead(); }
    });

    pager.appendChild(pages);

    const info = doc.createElement('span');
    info.className = 'np-img-page-info';
    info.textContent = `第 ${readState.page}/${totalPages} 页`;
    pager.appendChild(info);
}

// 单张图卡片；dense=true 时紧凑（供「按楼层+只看当前」密集网格）
function buildReadCell(img, groupImages, idx, dense) {
    const cell = doc.createElement('div');
    cell.className = 'np-read-cell' + (dense ? ' np-read-cell-dense' : '');

    const thumb = doc.createElement('div');
    thumb.className = 'np-read-thumb' + (img._isCurrent ? ' np-img-current' : '');

    const loading = doc.createElement('span');
    loading.className = 'np-read-loading';
    loading.textContent = '加载中…';
    thumb.appendChild(loading);

    loadChatImageSrc(img).then(src => {
        if (!src) { loading.textContent = '读取失败'; return; }
        loading.remove();
        const im = doc.createElement('img');
        im.className = 'np-read-img';
        im.src = src;
        im.alt = img._prompt || '';
        im.addEventListener('click', () => {
            openSharedLightbox(groupImages.map(g => ({
                title: g._prompt || '图片',
                path: g.path || '',
                entry: g,
                chatMeta: { md5: g._md5 || '', change: g._prompt || '' },
            })), idx, { noDelete: true });
        });
        thumb.appendChild(im);
    }).catch(() => { loading.textContent = '读取失败'; });

    cell.appendChild(thumb);

    // 提示词已在流头部/分组标题显示，缩略图底部不再重复（dense/normal 统一）

    return cell;
}

// 角色下拉：聚合 getAllChatScans 的角色名
function renderCharDropdown() {
    if (!doc) return;
    const btn = doc.getElementById('np-read-char');
    const label = doc.getElementById('np-read-char-label');
    if (!btn) return;
    const records = getAllChatScans();
    const charNames = [...new Set(records.map(r => r.characterName).filter(Boolean))];

    const menu = doc.createElement('div');
    menu.className = 'np-read-menu';
    menu.style.position = 'absolute';
    menu.style.zIndex = '60';
    menu.style.minWidth = '140px';
    menu.style.background = 'var(--bg-card, #fff)';
    menu.style.border = '1px solid var(--border-color, rgba(128,128,128,0.25))';
    menu.style.borderRadius = '6px';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
    menu.style.padding = '4px';
    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;

    if (charNames.length === 0) {
        const empty = doc.createElement('div');
        empty.style.padding = '7px 12px';
        empty.style.fontSize = '13px';
        empty.style.color = 'var(--text-muted, #888)';
        empty.textContent = '暂无已扫描聊天';
        menu.appendChild(empty);
    } else {
        charNames.forEach(name => {
            const item = doc.createElement('div');
            item.className = 'np-read-menu-item' + (name === readState.characterName ? ' active' : '');
            item.textContent = name;
            item.style.padding = '7px 12px';
            item.style.cursor = 'pointer';
            item.style.borderRadius = '4px';
            item.style.fontSize = '13px';
            item.style.color = 'var(--text-primary, #222)';
            if (name === readState.characterName) {
                item.style.background = 'var(--accent-color, #2563eb)';
                item.style.color = '#fff';
            }
            item.addEventListener('mouseenter', () => {
                if (name !== readState.characterName) item.style.background = 'var(--bg-hover, #f3f4f6)';
            });
            item.addEventListener('mouseleave', () => {
                if (name !== readState.characterName) item.style.background = 'transparent';
            });
            item.addEventListener('click', () => {
                readState.characterName = name;
                readState.chatId = ''; // 切角色后重置聊天
                readState.page = 1;
                persistReadPrefs();
                if (label) label.textContent = name;
                const chatLabel = doc.getElementById('np-read-chat-label');
                if (chatLabel) chatLabel.textContent = '选择聊天';
                closeMenus();
                renderRead();
            });
            menu.appendChild(item);
        });
    }
    doc.body.appendChild(menu);
}

// 聊天下拉：选角色后列出该角色的 chats
function renderChatDropdown() {
    if (!doc) return;
    const btn = doc.getElementById('np-read-chat');
    const label = doc.getElementById('np-read-chat-label');
    if (!btn) return;
    const records = getAllChatScans();
    const chats = records.filter(r => r.characterName === readState.characterName);

    const menu = doc.createElement('div');
    menu.className = 'np-read-menu';
    menu.style.position = 'absolute';
    menu.style.zIndex = '60';
    menu.style.minWidth = '180px';
    menu.style.background = 'var(--bg-card, #fff)';
    menu.style.border = '1px solid var(--border-color, rgba(128,128,128,0.25))';
    menu.style.borderRadius = '6px';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
    menu.style.padding = '4px';
    menu.style.maxHeight = '300px';
    menu.style.overflowY = 'auto';
    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;

    if (chats.length === 0) {
        const empty = doc.createElement('div');
        empty.style.padding = '7px 12px';
        empty.style.fontSize = '13px';
        empty.style.color = 'var(--text-muted, #888)';
        empty.textContent = readState.characterName ? '该角色暂无已扫描聊天' : '请先选择角色';
        menu.appendChild(empty);
    } else {
        chats.forEach(c => {
            const item = doc.createElement('div');
            item.className = 'np-read-menu-item' + (c.chatId === readState.chatId ? ' active' : '');
            item.textContent = c.name || c.chatId;
            item.title = c.chatId;
            item.style.padding = '7px 12px';
            item.style.cursor = 'pointer';
            item.style.borderRadius = '4px';
            item.style.fontSize = '13px';
            item.style.color = 'var(--text-primary, #222)';
            if (c.chatId === readState.chatId) {
                item.style.background = 'var(--accent-color, #2563eb)';
                item.style.color = '#fff';
            }
            item.addEventListener('mouseenter', () => {
                if (c.chatId !== readState.chatId) item.style.background = 'var(--bg-hover, #f3f4f6)';
            });
            item.addEventListener('mouseleave', () => {
                if (c.chatId !== readState.chatId) item.style.background = 'transparent';
            });
            item.addEventListener('click', () => {
                readState.chatId = c.chatId;
                readState.page = 1;
                persistReadPrefs();
                if (label) label.textContent = c.name || c.chatId;
                closeMenus();
                renderRead();
            });
            menu.appendChild(item);
        });
    }
    doc.body.appendChild(menu);
}

let currentMenu = null;
function closeMenus() {
    if (currentMenu && currentMenu.parentNode) currentMenu.parentNode.removeChild(currentMenu);
    currentMenu = null;
    if (doc) doc.removeEventListener('click', onDocClick, true);
}
function onDocClick(e) {
    const charBtn = doc.getElementById('np-read-char');
    const chatBtn = doc.getElementById('np-read-chat');
    if (currentMenu && !currentMenu.contains(e.target)
        && e.target !== charBtn && !(charBtn && charBtn.contains(e.target))
        && e.target !== chatBtn && !(chatBtn && chatBtn.contains(e.target))) {
        closeMenus();
    }
}

export function initReadMode(iframeDocument) {
    doc = iframeDocument;
    if (!doc) return;

    const charBtn = doc.getElementById('np-read-char');
    if (charBtn) {
        charBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeMenus();
            renderCharDropdown();
            currentMenu = doc.querySelector('.np-read-menu');
            setTimeout(() => doc.addEventListener('click', onDocClick, true), 0);
        });
    }
    const chatBtn = doc.getElementById('np-read-chat');
    if (chatBtn) {
        chatBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeMenus();
            renderChatDropdown();
            currentMenu = doc.querySelector('.np-read-menu');
            setTimeout(() => doc.addEventListener('click', onDocClick, true), 0);
        });
    }

    // 展示形式切换：连续流 / 按楼层
    const modeBtns = doc.querySelectorAll('.np-read-mode[data-mode]');
    modeBtns.forEach(b => {
        b.addEventListener('click', () => {
            readState.mode = b.getAttribute('data-mode');
            readState.page = 1;
            persistReadPrefs();
            modeBtns.forEach(x => x.classList.toggle('active', x === b));
            renderRead();
        });
    });

    // 只看当前选中
    const onlyBtn = doc.getElementById('np-read-only-current');
    if (onlyBtn) {
        onlyBtn.addEventListener('click', () => {
            readState.onlyCurrent = !readState.onlyCurrent;
            readState.page = 1;
            persistReadPrefs();
            onlyBtn.classList.toggle('active', readState.onlyCurrent);
            renderRead();
        });
    }

    // 初始按持久化偏好同步按钮激活态
    const streamBtn = doc.getElementById('np-read-mode-stream');
    const floorBtn = doc.getElementById('np-read-mode-floor');
    if (readState.mode === 'floor' && floorBtn) floorBtn.classList.add('active');
    else if (streamBtn) streamBtn.classList.add('active');
    if (onlyBtn) onlyBtn.classList.toggle('active', readState.onlyCurrent);
}

// 每次进入阅读 tab 时刷新（数据可能已更新；恢复持久化的角色/聊天标签）
export function refreshReadMode() {
    if (!doc) return;
    const charLabel = doc.getElementById('np-read-char-label');
    const chatLabel = doc.getElementById('np-read-chat-label');
    if (charLabel) charLabel.textContent = readState.characterName || '选择角色';
    if (chatLabel) chatLabel.textContent = readState.chatId || '选择聊天';
    // 若持久化的聊天名与 chatId 不一致，尝试还原聊天名（record.name）
    if (readState.chatId) {
        const rec = getAllChatScans().find(r => r.characterName === readState.characterName && r.chatId === readState.chatId);
        if (rec && chatLabel) chatLabel.textContent = rec.name || readState.chatId;
    }
    renderRead();
}
