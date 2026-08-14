// src/features/nai-preset-switcher/NaiPresetSwitcher.js
// 智绘姬NAI预设切换 · 编辑器
// 运行在父窗口上下文，操作 iframe 的 document（与 module-editor / generator-editor 一致）。
// 预设本质 = 智绘姬 yushe 关联锚点（name）+ 自建标签；
// 提示词与预览图不在此存储，实时读智绘姬（yushe[name] / previewImageId）。

import configManager from '../../singleton/configManager.js';
import { infoLog, errorLog } from '../../utils/logger.js';
import { translate } from '../../../../../../i18n.js';
import { normalizeNaiPresetConfig } from '../../config/naiPresetConfigTemplate.js';
// ST 的 extension_settings / saveSettings / getRequestHeaders 都是 ES module 顶层导出，
// 不挂在 window 上，必须 import 直读（曾误用 window.extension_settings 导致读不到数据）。
import { extension_settings } from '../../../../../../extensions.js';
// ⚠️ script.js 位于 public/ 根（public/script.js），不在 public/scripts/，
// 从 src/features/xxx/ 需要 7 层；extensions.js / i18n.js 在 public/scripts/ 只需 6 层。
import { saveSettings, getRequestHeaders } from '../../../../../../../script.js';

let doc = null;
let presets = [];          // 当前预设列表（configManager.getNaiPresets() 的副本）
let activeTag = 'ALL';     // 当前标签筛选
let searchTerm = '';       // 当前搜索词
let editingId = null;      // 正在编辑的预设 id（null = 新建）

/**
 * 初始化智绘姬NAI预设切换编辑器
 * 由 EntryButton 在 iframe onLoad 回调中调用。
 * @param {Document} iframeDocument Iframe 的文档对象
 */
export function initNaiPresetSwitcher(iframeDocument) {
    doc = iframeDocument;
    presets = configManager.getNaiPresets().map(p => ({ ...p }));

    applyI18nToStaticElements();
    bindThemeToggle();
    bindNavTabs();
    bindStaticControls();
    bindToolbox();
    renderAll();
}

/**
 * 每次打开抽屉时重新读取主题（keepAlive 模式下 onLoad 只跑一次，
 * 重开抽屉不会重新初始化，因此需在显示时补取一次 localStorage 主题）。
 * @param {Document} iframeDocument Iframe 的文档对象
 */
export function syncNaiTheme(iframeDocument) {
    if (!iframeDocument) return;
    let savedTheme = 'light';
    try {
        savedTheme = localStorage.getItem('st_continuity_theme') || 'light';
    } catch (e) { /* iframe localStorage 不可用时退回默认 */ }
    iframeDocument.documentElement.setAttribute('data-theme', savedTheme);
}

/* ============ i18n ============ */

function applyI18nToStaticElements() {
    if (!doc) return;
    doc.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const text = translate(key);
        if (text) el.textContent = text;
    });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const text = translate(key);
        if (text) el.setAttribute('placeholder', text);
    });
}

/* ============ 主题切换（点击标题，复用 module-editor 模式） ============ */

function bindThemeToggle() {
    let savedTheme = 'light';
    try {
        savedTheme = localStorage.getItem('st_continuity_theme') || 'light';
    } catch (e) { /* iframe localStorage 不可用时退回默认 */ }

    doc.documentElement.setAttribute('data-theme', savedTheme);

    const headerTitle = doc.querySelector('.header-title') || doc.getElementById('header-title');
    if (headerTitle) {
        headerTitle.style.cursor = 'pointer';
        headerTitle.title = translate('ccore_title_toggle_theme') || '点击切换主题';
        headerTitle.addEventListener('click', () => {
            const current = doc.documentElement.getAttribute('data-theme') || 'light';
            const next = current === 'light' ? 'dark' : 'light';
            doc.documentElement.setAttribute('data-theme', next);
            try {
                localStorage.setItem('st_continuity_theme', next);
            } catch (e) { /* 忽略持久化失败，本次会话仍切换 */ }
            // 通知本 iframe 内其他组件（如 modal 内嵌视图）
            window.dispatchEvent(new CustomEvent('continuity-theme-change'));
        });
    }
}

/* ============ 左侧导航 tab 切换 ============ */

function bindNavTabs() {
    const items = doc.querySelectorAll('.main-nav .nav-item');
    const sections = doc.querySelectorAll('.content-area .view-section');
    if (!items.length) return;

    items.forEach(item => {
        item.addEventListener('click', () => {
            const target = item.getAttribute('data-target');
            items.forEach(i => i.classList.toggle('active', i === item));
            sections.forEach(s => s.classList.toggle('active', s.id === target));
        });
    });
}

function bindStaticControls() {
    const search = doc.getElementById('np-search');
    if (search) {
        search.addEventListener('input', () => {
            searchTerm = search.value.trim().toLowerCase();
            renderList();
        });
    }

    const newBtn = doc.getElementById('np-new');
    if (newBtn) newBtn.addEventListener('click', () => openEditor(null)); // 新建入口暂移除（无新建功能），保留备用

    const cancelBtn = doc.getElementById('np-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);

    const saveBtn = doc.getElementById('np-save');
    if (saveBtn) saveBtn.addEventListener('click', onSave);

    const mask = doc.getElementById('np-modal-mask');
    if (mask) {
        mask.addEventListener('click', (e) => {
            if (e.target === mask) closeEditor();
        });
    }
}

/* ============ 工具箱 ============ */

function bindToolbox() {
    const importBtn = doc.getElementById('np-import-legacy');
    if (importBtn) importBtn.addEventListener('click', importLegacyPresets);

    const syncBtn = doc.getElementById('np-sync-images');
    if (syncBtn) syncBtn.addEventListener('click', syncLegacyImagesToChatu8);

    const printBtn = doc.getElementById('np-print-config');
    if (printBtn) printBtn.addEventListener('click', printConfig);
}

// 旧版预设数据源的 extension_settings key（中性标识，不涉及任何插件名）
const LEGACY_PRESET_SOURCE_KEY = 'nai_preset_switcher';

// 智绘姬（st-chatu8）在 extension_settings 中的配置键
const CHATU8_SETTINGS_KEY = 'st-chatu8';

// 安全读取旧版数据源：extension_settings 是 extensions.js 的模块级导出（let），
// 不挂在 window 上，必须 import 直读。
function readLegacyPresetSource() {
    return extension_settings?.[LEGACY_PRESET_SOURCE_KEY] || null;
}

// 旧插件 entry.thumb 是内嵌 base64（data URL 或纯 base64），这里解析出 data 本体与格式
function parseThumbBase64(thumb) {
    const str = String(thumb || '');
    if (!str) return null;
    const commaIdx = str.indexOf(',');
    // 带 data:image/xxx;base64, 前缀
    if (commaIdx !== -1 && /^data:image\//i.test(str.slice(0, commaIdx))) {
        const head = str.slice(0, commaIdx);
        const match = head.match(/data:image\/(\w+)/i);
        return { data: str.slice(commaIdx + 1), format: match ? match[1].toLowerCase() : 'png' };
    }
    return { data: str, format: 'png' };
}

/**
 * 读取智绘姬某预设的预览图 URL（与 st-chatu8 的 getConfigImage 语义一致）：
 * 1) configImageStorage[id].path 服务器存储路径，可直接作 img src；
 * 2) 服务器存储关闭时智绘姬把图存进 IndexedDB（chatu8_config_images / config_images），同构回退。
 */
async function getChatu8PreviewImageUrl(presetName) {
    try {
        const chatu8 = extension_settings[CHATU8_SETTINGS_KEY];
        const preset = chatu8?.yushe?.[presetName];
        const id = preset?.previewImageId;
        if (!id) return null;
        const serverEntry = chatu8?.configImageStorage?.[id];
        if (serverEntry?.path) return serverEntry.path;
        return await readChatu8IndexedDbImage(id);
    } catch (e) {
        errorLog(`[智绘姬NAI预设切换] 读取预设「${presetName}」预览图失败:`, e);
        return null;
    }
}

function readChatu8IndexedDbImage(id) {
    return new Promise(resolve => {
        try {
            const request = indexedDB.open('chatu8_config_images', 2);
            request.onupgradeneeded = () => { /* 只读场景，不创建 store */ };
            request.onsuccess = () => {
                try {
                    const db = request.result;
                    if (!db || !db.objectStoreNames.contains('config_images')) {
                        db?.close();
                        return resolve(null);
                    }
                    const getRequest = db.transaction('config_images', 'readonly')
                        .objectStore('config_images').get(id);
                    getRequest.onsuccess = () => {
                        const entry = getRequest.result;
                        db.close();
                        if (!entry || !entry.data) return resolve(null);
                        if (typeof entry.data === 'string') {
                            resolve('data:application/json;base64,' + utf8ToBase64(entry.data));
                        } else {
                            resolve('data:image/png;base64,' + arrayBufferToBase64(entry.data));
                        }
                    };
                    getRequest.onerror = () => { db.close(); resolve(null); };
                } catch (e) { resolve(null); }
            };
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        } catch (e) { resolve(null); }
    });
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 32768;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return window.btoa(binary);
}

function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const chunkSize = 32768;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return window.btoa(binary);
}

/**
 * 把旧配置里预设的图片（thumb base64）上传到 ST 服务器，
 * 并赋值给智绘姬对应预设的预览图（yushe[name].previewImageId）。
 * 完全复用智绘姬原生 ConfigDB 服务器存储结构：
 *   extension_settings["st-chatu8"].configImageStorage[id] = { path, date }
 *   yushe[name].previewImageId = id
 * 智绘姬 getConfigImage(id) 优先查 configImageStorage.path → 直接可读，
 * 与用户是否开启「服务器存储」无关。
 * 已带预览图的预设跳过（不覆盖）；智绘姬侧不存在的预设跳过并计数。
 */
async function syncLegacyImagesToChatu8() {
    const resultEl = doc.getElementById('np-tools-result');
    const src = readLegacyPresetSource();
    if (!src) {
        showToolsResult(resultEl, '未找到旧版预设数据源，无法同步图片。', true);
        return;
    }
    const entries = src.entries || {};
    const list = Object.values(entries).filter(e => e && e.name && e.thumb);
    if (list.length === 0) {
        showToolsResult(resultEl, '旧版数据源中没有带图片的预设。', true);
        return;
    }

    const chatu8 = extension_settings[CHATU8_SETTINGS_KEY];
    if (!chatu8 || typeof chatu8 !== 'object') {
        showToolsResult(resultEl, '未找到智绘姬（st-chatu8）配置。请先启用智绘姬并保存过其设置。', true);
        return;
    }
    if (!chatu8.yushe || typeof chatu8.yushe !== 'object') {
        showToolsResult(resultEl, '智绘姬预设列表（yushe）为空。', true);
        return;
    }
    if (!chatu8.configImageStorage || typeof chatu8.configImageStorage !== 'object') {
        chatu8.configImageStorage = {};
    }
    const storage = chatu8.configImageStorage;

    let ok = 0;
    let skippedHasImage = 0;
    let skippedNoPreset = 0;
    let failed = 0;
    const failedNames = [];
    for (const entry of list) {
        const preset = chatu8.yushe[entry.name];
        if (!preset) { skippedNoPreset++; continue; }
        if (preset.previewImageId) { skippedHasImage++; continue; }
        const thumb = parseThumbBase64(entry.thumb);
        if (!thumb) { failed++; failedNames.push(entry.name); continue; }
        try {
            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers: getRequestHeaders(window.token),
                body: JSON.stringify({
                    image: thumb.data,
                    format: thumb.format,
                    ch_name: 'chatu8_config',
                    filename: `preset_${entry.name}_preview`,
                }),
            });
            if (!response.ok) throw new Error(`上传失败: ${response.statusText}`);
            const result = await response.json();
            const id = `cfgimg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            storage[id] = { path: result.path, date: Date.now() };
            preset.previewImageId = id;
            ok++;
        } catch (e) {
            errorLog(`[智绘姬NAI预设切换] 同步预设「${entry.name}」图片失败:`, e);
            failed++;
            failedNames.push(entry.name);
        }
    }

    if (ok > 0) saveSettings();

    let msg = `同步完成：成功 ${ok}`;
    if (skippedHasImage > 0) msg += `，跳过（已有预览图 ${skippedHasImage}）`;
    if (skippedNoPreset > 0) msg += `，跳过（智绘姬无此预设 ${skippedNoPreset}）`;
    if (failed > 0) msg += `，失败 ${failed}（${failedNames.join('、')}）`;
    msg += '。';
    showToolsResult(resultEl, msg, failed > 0 && ok === 0);
    infoLog(`[智绘姬NAI预设切换] ${msg}`);
    // 同步完成后刷新卡片，让新预览图立刻显示
    renderAll();
}

// 把旧版 entry 映射为 Continuity 预设结构
// 关键对照：旧插件与智绘姬的关联锚点就是 entry.name（applyPresetEntry 里 Y(name,...)
// 直接写进 st.yushe[name]），故 name 即我们的关联 key；旧 category 数组 = 我们的 tags。
// 丢弃项（我们不存储）：positive/negative（实时读智绘姬 yushe[name]）、
// thumb（改用智绘姬原生 previewImageId）、naiParams/vibe*/source。
function mapLegacyEntryToPreset(entry) {
    if (!entry) return null;
    const name = entry.name || '';
    if (!name) return null;
    return {
        id: entry.id || `np_legacy_${name}`,
        name,
        tags: Array.isArray(entry.category) ? entry.category.map(t => String(t).trim()).filter(Boolean) : [],
        createdAt: entry.createdAt || Date.now(),
        updatedAt: entry.updatedAt || Date.now(),
        sortOrder: typeof entry.sortOrder === 'number' ? entry.sortOrder : 0,
    };
}

function importLegacyPresets() {
    const resultEl = doc.getElementById('np-tools-result');
    const src = readLegacyPresetSource();
    if (!src) {
        showToolsResult(resultEl, '未找到旧版预设数据源，无法导入。', true);
        return;
    }

    // 旧版预设存于 .entries（id → entry 映射）
    const entries = src.entries || {};
    const legacyList = Object.values(entries).map(mapLegacyEntryToPreset).filter(Boolean);

    if (legacyList.length === 0) {
        showToolsResult(resultEl, '旧版数据源中没有可导入的预设。', true);
        return;
    }

    // 经模板归一化（补全字段/去重/类型校正）
    const normalized = normalizeNaiPresetConfig({ presets: legacyList }).presets;

    // 按 name 合并：已存在的跳过，避免重复
    const existingNames = new Set(presets.map(p => p.name));
    const toAdd = normalized.filter(p => !existingNames.has(p.name));
    const skipped = normalized.length - toAdd.length;

    presets = presets.concat(toAdd);
    persist();
    renderAll();

    const msg = `成功导入 ${toAdd.length} 条预设` + (skipped > 0 ? `（跳过 ${skipped} 条重名）` : '') + '。';
    showToolsResult(resultEl, msg, false);
    infoLog(`[智绘姬NAI预设切换] ${msg}`);
}

function printConfig() {
    const resultEl = doc.getElementById('np-tools-result');
    // 打印的是我们自己的新配置结构（见 naiPresetConfigTemplate.js）：
    // 提示词（positive/negative）与预览图不在此存储，故不打印。
    const snapshot = {
        metadata: { source: 'ST-Continuity-Core', exportedAt: new Date().toISOString() },
        presets: presets.map(p => ({
            id: p.id,
            name: p.name,
            tags: p.tags || [],
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            sortOrder: p.sortOrder,
        })),
    };
    const text = JSON.stringify(snapshot, null, 2);
    copyToClipboard(text);
    showToolsResult(resultEl, `已复制当前 ${presets.length} 条预设配置到剪贴板。`, false);
    infoLog(`[智绘姬NAI预设切换] 打印配置：${presets.length} 条`);
}

function showToolsResult(el, message, isError) {
    if (!el) return;
    el.textContent = message;
    el.className = 'np-tools-result' + (isError ? ' error' : '');
}

/* ============ 渲染 ============ */

function renderAll() {
    renderTagBar();
    renderList();
}

function collectTags() {
    const set = new Set();
    presets.forEach(p => (p.tags || []).forEach(t => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'));
}

function renderTagBar() {
    const bar = doc.getElementById('np-tag-bar');
    if (!bar) return;
    const tags = collectTags();
    const chips = ['ALL', ...tags];
    bar.innerHTML = '';
    chips.forEach(tag => {
        const chip = doc.createElement('span');
        chip.className = 'np-tag-chip' + (tag === activeTag ? ' active' : '');
        chip.textContent = tag === 'ALL' ? '全部' : tag;
        chip.addEventListener('click', () => {
            activeTag = tag;
            renderTagBar();
            renderList();
        });
        bar.appendChild(chip);
    });
}

function filteredPresets() {
    return presets.filter(p => {
        // 标签筛选
        if (activeTag !== 'ALL') {
            const tags = p.tags || [];
            if (!tags.includes(activeTag)) return false;
        }
        // 搜索（名称 + 标签）
        if (searchTerm) {
            const hay = [
                p.name || '',
                (p.tags || []).join(' '),
            ].join(' ').toLowerCase();
            if (!hay.includes(searchTerm)) return false;
        }
        return true;
    });
}

function renderList() {
    const list = doc.getElementById('np-list');
    if (!list) return;
    const items = filteredPresets();
    list.innerHTML = '';

    if (items.length === 0) {
        const empty = doc.createElement('div');
        empty.className = 'np-empty';
        empty.textContent = presets.length === 0
            ? '预设列表为空，可在工具箱中导入旧配置'
            : '没有匹配的预设';
        list.appendChild(empty);
        return;
    }

    items.forEach(p => list.appendChild(buildCard(p)));
}

function buildCard(p) {
    const card = doc.createElement('div');
    card.className = 'np-card';

    // 预览图：实时读智绘姬 yushe[name].previewImageId（异步加载）
    const imgWrap = doc.createElement('div');
    imgWrap.className = 'np-card-image';
    const img = doc.createElement('img');
    img.className = 'np-card-img';
    img.alt = p.name || '';
    imgWrap.appendChild(img);
    card.appendChild(imgWrap);
    getChatu8PreviewImageUrl(p.name).then(url => {
        if (url) img.src = url;
        else imgWrap.classList.add('np-card-image-empty');
    });

    const name = doc.createElement('div');
    name.className = 'np-card-name';
    name.textContent = p.name || '(未命名)';
    card.appendChild(name);

    if (p.tags && p.tags.length) {
        const tagWrap = doc.createElement('div');
        tagWrap.className = 'np-card-tags';
        p.tags.forEach(t => {
            const tEl = doc.createElement('span');
            tEl.className = 'np-card-tag';
            tEl.textContent = t;
            tagWrap.appendChild(tEl);
        });
        card.appendChild(tagWrap);
    }

    const actions = doc.createElement('div');
    actions.className = 'np-card-actions';

    const applyBtn = doc.createElement('button');
    applyBtn.className = 'np-btn np-btn-primary';
    applyBtn.textContent = '应用';
    applyBtn.addEventListener('click', () => applyPreset(p));
    actions.appendChild(applyBtn);

    const editBtn = doc.createElement('button');
    editBtn.className = 'np-btn';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => openEditor(p.id));
    actions.appendChild(editBtn);

    const delBtn = doc.createElement('button');
    delBtn.className = 'np-btn';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => deletePreset(p.id));
    actions.appendChild(delBtn);

    card.appendChild(actions);
    return card;
}

/* ============ 编辑弹层 ============ */

function openEditor(id) {
    editingId = id;
    const mask = doc.getElementById('np-modal-mask');
    const title = doc.getElementById('np-modal-title');
    const fName = doc.getElementById('np-f-name');
    const fTags = doc.getElementById('np-f-tags');

    const p = id ? presets.find(x => x.id === id) : null;
    title.textContent = p ? '编辑预设' : '新建预设';
    fName.value = p?.name || '';
    fTags.value = p?.tags ? p.tags.join(', ') : '';
    mask.style.display = 'flex';
    fName.focus();
}

function closeEditor() {
    const mask = doc.getElementById('np-modal-mask');
    mask.style.display = 'none';
    editingId = null;
}

function onSave() {
    const fName = doc.getElementById('np-f-name');
    const fTags = doc.getElementById('np-f-tags');

    const name = fName.value.trim();
    if (!name) {
        fName.focus();
        return;
    }
    const tags = fTags.value.split(',').map(s => s.trim()).filter(Boolean);

    if (editingId) {
        const p = presets.find(x => x.id === editingId);
        if (p) {
            p.name = name;
            p.tags = tags;
            p.updatedAt = Date.now();
        }
    } else {
        presets.push({
            id: genId(),
            name,
            tags,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sortOrder: presets.length,
        });
    }

    persist();
    closeEditor();
    renderAll();
}

function deletePreset(id) {
    const p = presets.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`确定删除预设「${p.name}」？`)) return;
    presets = presets.filter(x => x.id !== id);
    persist();
    renderAll();
}

/* ============ 应用（第一步：复制到剪贴板，预留回写接口） ============ */

async function applyPreset(p) {
    // 提示词不在此存储：实时读智绘姬 yushe[name]
    const chatu8Preset = extension_settings[CHATU8_SETTINGS_KEY]?.yushe?.[p.name];
    const positive = chatu8Preset?.fixedPrompt || '';
    const negative = chatu8Preset?.negativePrompt || '';
    const text = [positive, negative ? `Negative prompt: ${negative}` : '']
        .filter(Boolean).join('\n\n');
    if (!text) {
        infoLog(`[智绘姬NAI预设切换] 预设「${p.name}」在智绘姬中无提示词内容，未复制。`);
        return;
    }
    copyToClipboard(text);
    infoLog(`[智绘姬NAI预设切换] 已复制预设「${p.name}」提示词到剪贴板`);
    // TODO(C 阶段): 回写到文生图参数控件（prompt/negative/sampler 等）
}

function copyToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }
    } catch (e) {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    try { doc.execCommand('copy'); } catch (e) { errorLog('复制失败', e); }
    ta.remove();
}

/* ============ 持久化 ============ */

function persist() {
    configManager.setNaiPresets(presets);
}

function genId() {
    return 'np_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
