// src/features/nai-preset-switcher/ImageFavorites.js
// 图片收藏 tab：聚合所有红心收藏的图片，独立标签筛选 + 标签管理 + 清空。
//
// 数据源：extension_settings[本插件][nai_preset_config].imageFavorites
//   { tags:[{name,createdAt}], items:[{key,cat,path,tags,createdAt,updatedAt}] }
// 与预设 tags 库完全独立（用户拍板：图片收藏标签不混用预设标签）。
//
// 渲染：收藏项自带 path（服务端文件路径），直接 fetch blob → objectURL 显示。
// 失效自愈：渲染时若某 path 404（图片已被删），自动从收藏清除（用户拍板：自动清除）。

import { extension_settings } from '../../../../../../extensions.js';
import { getRequestHeaders, saveSettings } from '../../../../../../../script.js';
import { errorLog } from '../../utils/logger.js';
import configManager from '../../singleton/configManager.js';
import { IframeDialog } from '../../shared/IframeDialog.js';
import { showToast } from '../../shared/Toast.js';

const CHATU8 = 'st-chatu8';

let doc = null;
let favItems = [];      // 当前收藏 items（读 configManager）
let favTags = [];       // 当前收藏标签库
let activeTags = [];    // 标签筛选（AND 语义，空=全部）
let blobUrlCache = new Map(); // path -> objectURL

export function initImageFavorites(iframeDocument) {
    doc = iframeDocument;
    if (!doc.getElementById('np-fav-list')) return;
    try {
        bindControls();
        reload();
    } catch (e) {
        errorLog('[图片收藏] 初始化失败:', e);
    }
}

// 每次打开抽屉时刷新数据并重渲
export function refreshImageFavorites(iframeDocument) {
    if (!iframeDocument) return;
    doc = iframeDocument;
    if (!doc.getElementById('np-fav-list')) return;
    try { reload(); } catch (e) { errorLog('[图片收藏] 刷新失败:', e); }
}

// 从 configManager 重载收藏数据
function reload() {
    const favs = configManager.getNaiImageFavorites();
    favItems = Array.isArray(favs.items) ? favs.items : [];
    favTags = Array.isArray(favs.tags) ? favs.tags : [];
    render();
}

function persist(items, tags) {
    configManager.setNaiImageFavorites({ items: items, tags: tags });
    try { saveSettings(); } catch (e) { /* 忽略 */ }
}

/* ============ 图片渲染 ============ */

async function resolveSrc(path) {
    if (!path) return null;
    if (blobUrlCache.has(path)) return blobUrlCache.get(path);
    try {
        const res = await fetch(path, { headers: getRequestHeaders() });
        if (!res.ok) return null;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        blobUrlCache.set(path, url);
        return url;
    } catch (e) {
        return null;
    }
}

// 渲染收藏网格（含失效自愈：path 读不到则移除该收藏）
function render() {
    if (!doc) return;
    const list = doc.getElementById('np-fav-list');
    const tip = doc.getElementById('np-fav-empty-tip');
    if (!list) return;

    // 标签筛选
    let shown = favItems;
    if (activeTags.length) {
        shown = shown.filter(f => activeTags.every(t => (f.tags || []).includes(t)));
    }

    list.innerHTML = '';
    if (shown.length === 0) {
        if (tip) tip.style.display = 'block';
        renderTagBar();
        return;
    }
    if (tip) tip.style.display = 'none';

    // 失效自愈：逐个渲染，path 读取失败则标记移除
    const deadKeys = [];
    shown.forEach(item => {
        const cell = doc.createElement('div');
        cell.className = 'np-fav-cell';

        const el = doc.createElement('div');
        el.className = 'np-fav-thumb';
        const loading = doc.createElement('span');
        loading.textContent = '加载中…';
        el.appendChild(loading);

        resolveSrc(item.path).then(src => {
            if (!src) {
                // 失效：图片已删，自动清除收藏
                deadKeys.push(item.key);
                loading.textContent = '已失效';
                el.title = '图片已被删除，将自动移除收藏';
                return;
            }
            loading.remove();
            const im = doc.createElement('img');
            im.className = 'np-fav-thumb-img';
            im.src = src;
            im.alt = item.key;
            el.appendChild(im);
        }).catch(() => {
            deadKeys.push(item.key);
            loading.textContent = '已失效';
        });

        // 标签显示（小 chip）
        const tagsEl = doc.createElement('div');
        tagsEl.className = 'np-fav-tags-show';
        (item.tags || []).forEach(t => {
            const chip = doc.createElement('span');
            chip.className = 'np-fav-tag-chip';
            chip.textContent = t;
            tagsEl.appendChild(chip);
        });

        // 操作：取消收藏 + 编辑标签
        const actions = doc.createElement('div');
        actions.className = 'np-fav-actions';
        const unfav = doc.createElement('button');
        unfav.className = 'np-fav-unfav';
        unfav.textContent = '♥';
        unfav.title = '取消收藏';
        unfav.addEventListener('click', () => removeFavorite(item.key));
        actions.appendChild(unfav);
        const tagBtn = doc.createElement('button');
        tagBtn.className = 'np-fav-tag-edit';
        tagBtn.textContent = '🏷';
        tagBtn.title = '编辑标签';
        tagBtn.addEventListener('click', () => openTagEditor(item));
        actions.appendChild(tagBtn);

        cell.appendChild(el);
        if (tagsEl.children.length) cell.appendChild(tagsEl);
        cell.appendChild(actions);
        list.appendChild(cell);
    });

    // 失效自愈落盘（延迟到渲染后统一处理，避免渲染中改数据）
    if (deadKeys.length) {
        setTimeout(() => {
            favItems = favItems.filter(f => !deadKeys.includes(f.key));
            persist(favItems, favTags);
            showToast(doc, `已自动移除 ${deadKeys.length} 条失效收藏`, 'info');
            renderTagBar();
            render();
        }, 50);
    }

    renderTagBar();
}

function renderTagBar() {
    if (!doc) return;
    const bar = doc.getElementById('np-fav-tags');
    if (!bar) return;
    const tags = favTags.map(t => t.name).sort((a, b) => a.localeCompare(b, 'zh'));
    const chips = [
        { key: 'ALL', label: '全部' },
        ...tags.map(t => ({ key: t, label: t })),
    ];
    const noFilter = activeTags.length === 0;
    bar.innerHTML = '';
    chips.forEach(({ key, label }) => {
        const chip = doc.createElement('span');
        chip.className = 'np-fav-filter-chip'
            + ((key === 'ALL' ? noFilter : activeTags.includes(key)) ? ' active' : '');
        chip.textContent = label;
        chip.addEventListener('click', () => {
            if (key === 'ALL') activeTags = [];
            else if (activeTags.includes(key)) activeTags = activeTags.filter(t => t !== key);
            else activeTags.push(key);
            render();
        });
        bar.appendChild(chip);
    });
}

/* ============ 操作 ============ */

function removeFavorite(key) {
    favItems = favItems.filter(f => f.key !== key);
    persist(favItems, favTags);
    showToast(doc, '已取消收藏', 'info');
    render();
    // 通知图片管理刷新红心（若激活）
    if (window.__refreshImageManagerFavs) window.__refreshImageManagerFavs();
}

// 编辑单张收藏的标签（弹窗：已选 + 可点选标签池 + 新建）
function openTagEditor(item) {
    if (!doc) return;
    const editing = [...(item.tags || [])];
    const poolHtml = favTags.map((t, i) =>
        `<span class="np-fav-pool-chip" data-i="${i}" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>`
    ).join('');
    const selectedHtml = editing.map(t => escapeHtml(t)).join('、') || '（无标签）';

    const dlg = new IframeDialog(doc);
    dlg.open({
        title: '编辑图片标签',
        content: `
            <p class="np-fav-edit-hint">为这张收藏图片设置标签（图片收藏专属标签，不与预设标签混用）</p>
            <div class="np-fav-edit-current" id="np-fav-edit-current">${selectedHtml}</div>
            <div class="np-fav-edit-pool" id="np-fav-edit-pool">${poolHtml || '<span class="np-fav-pool-empty">暂无标签，可新建</span>'}</div>
            <div class="np-fav-edit-new">
                <input type="text" id="np-fav-edit-input" placeholder="新标签名…" />
                <button class="btn-secondary" id="np-fav-edit-add">新建</button>
            </div>
        `,
        buttons: [
            { text: '取消', className: 'btn-primary', onClick: (d) => d.close() },
            {
                text: '保存',
                className: 'btn-secondary',
                onClick: (d) => {
                    // 收集最终标签（从 DOM 读取已选）
                    const finalTags = collectSelectedTags(d);
                    item.tags = finalTags;
                    item.updatedAt = Date.now();
                    // 新建的标签也并入标签库
                    const nowNames = new Set(favTags.map(t => t.name));
                    finalTags.forEach(t => { if (!nowNames.has(t)) favTags.push({ name: t, createdAt: Date.now() }); });
                    persist(favItems, favTags);
                    d.close();
                    showToast(doc, '标签已更新', 'success');
                    render();
                },
            },
        ],
    });

    // 池 chip 点击切换选中
    doc.getElementById('np-fav-edit-pool')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.np-fav-pool-chip');
        if (!chip) return;
        const name = chip.dataset.name;
        chip.classList.toggle('selected');
        updateCurrentLabel();
    });
    // 新建
    doc.getElementById('np-fav-edit-add')?.addEventListener('click', () => {
        const input = doc.getElementById('np-fav-edit-input');
        const name = (input?.value || '').trim();
        if (!name) return;
        const pool = doc.getElementById('np-fav-edit-pool');
        const exists = pool.querySelector(`[data-name="${CSS.escape(name)}"]`);
        if (exists) { exists.classList.add('selected'); }
        else {
            const chip = doc.createElement('span');
            chip.className = 'np-fav-pool-chip selected';
            chip.dataset.name = name;
            chip.textContent = name;
            pool.appendChild(chip);
        }
        input.value = '';
        updateCurrentLabel();
    });
    // 回车新建
    doc.getElementById('np-fav-edit-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doc.getElementById('np-fav-edit-add')?.click();
    });

    function updateCurrentLabel() {
        const selected = Array.from(doc.querySelectorAll('#np-fav-edit-pool .np-fav-pool-chip.selected'))
            .map(c => c.dataset.name);
        const cur = doc.getElementById('np-fav-edit-current');
        if (cur) cur.textContent = selected.join('、') || '（无标签）';
    }
}

function collectSelectedTags(dlg) {
    const selected = Array.from(dlg.dialogElement.querySelectorAll('.np-fav-pool-chip.selected'))
        .map(c => c.dataset.name);
    return [...new Set(selected)];
}

// 清空全部收藏（带确认）
function clearAllFavorites() {
    if (!doc) return;
    const dlg = new IframeDialog(doc);
    dlg.open({
        title: '清空收藏',
        content: `<p>确定清空全部 <b>${favItems.length}</b> 条图片收藏吗？</p><p style="opacity:0.7">此操作不可恢复。</p>`,
        buttons: [
            { text: '取消', className: 'btn-primary', onClick: (d) => d.close() },
            {
                text: '清空',
                className: 'btn-secondary',
                onClick: (d) => {
                    d.close();
                    favItems = [];
                    persist(favItems, favTags);
                    showToast(doc, '已清空全部收藏', 'success');
                    render();
                    if (window.__refreshImageManagerFavs) window.__refreshImageManagerFavs();
                },
            },
        ],
    });
}

/* ============ 标签库管理（弹窗：列出全部收藏标签，可改名/删除） ============ */

function openTagManager() {
    if (!doc) return;
    const rows = favTags.map((t, i) => `
        <div class="np-fav-tag-row" data-i="${i}">
            <span class="np-fav-tag-row-name">${escapeHtml(t.name)}</span>
            <button class="btn-secondary np-fav-tag-row-rename">改名</button>
            <button class="btn-secondary np-fav-tag-row-del">删除</button>
        </div>
    `).join('');
    const dlg = new IframeDialog(doc);
    dlg.open({
        title: '管理图片标签',
        content: `
            <p class="np-fav-edit-hint">图片收藏专属标签库（不与预设标签混用）；删除标签会从所有收藏项移除。</p>
            <div class="np-fav-tag-manage-list">${rows || '<p style="opacity:0.6">暂无标签</p>'}</div>
        `,
        buttons: [
            { text: '关闭', className: 'btn-primary', onClick: (d) => d.close() },
        ],
    });

    dlg.dialogElement.querySelectorAll('.np-fav-tag-row-rename').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = Number(btn.closest('.np-fav-tag-row').dataset.i);
            const old = favTags[i]?.name;
            const next = prompt(`将标签「${old}」改名为：`, old);
            if (next === null) return;
            const name = next.trim();
            if (!name || name === old) return;
            if (favTags.some(t => t.name === name)) { showToast(doc, '标签已存在', 'error'); return; }
            favTags[i].name = name;
            favItems.forEach(f => {
                if (f.tags.includes(old)) {
                    f.tags = f.tags.map(t => t === old ? name : t);
                    f.updatedAt = Date.now();
                }
            });
            persist(favItems, favTags);
            showToast(doc, '标签已改名', 'success');
            dlg.close();
            render();
        });
    });
    dlg.dialogElement.querySelectorAll('.np-fav-tag-row-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = Number(btn.closest('.np-fav-tag-row').dataset.i);
            const tag = favTags[i]?.name;
            if (!tag) return;
            if (!confirm(`删除标签「${tag}」？将从所有收藏项移除。`)) return;
            favTags.splice(i, 1);
            favItems.forEach(f => {
                if (f.tags.includes(tag)) {
                    f.tags = f.tags.filter(t => t !== tag);
                    f.updatedAt = Date.now();
                }
            });
            persist(favItems, favTags);
            showToast(doc, '标签已删除', 'success');
            dlg.close();
            render();
        });
    });
}

function bindControls() {
    if (!doc) return;
    const manageBtn = doc.getElementById('np-fav-manage-tags');
    if (manageBtn) manageBtn.addEventListener('click', openTagManager);
    const emptyBtn = doc.getElementById('np-fav-empty');
    if (emptyBtn) emptyBtn.addEventListener('click', clearAllFavorites);
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
