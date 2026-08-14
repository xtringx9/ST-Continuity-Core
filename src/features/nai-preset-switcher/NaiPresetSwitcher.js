// src/features/nai-preset-switcher/NaiPresetSwitcher.js
// 智绘姬NAI预设切换 · 编辑器
// 运行在父窗口上下文，操作 iframe 的 document（与 module-editor / generator-editor 一致）。
// 预设本质 = 智绘姬 yushe 关联锚点（name）+ 自建标签；
// 提示词与预览图不在此存储，实时读智绘姬（yushe[name] / previewImageId）。

import configManager from '../../singleton/configManager.js';
import { infoLog, errorLog, debugLog } from '../../utils/logger.js';
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
let editingTags = [];       // 编辑弹层内当前标签（芯片编辑器工作副本）

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

    const tagMask = doc.getElementById('np-tag-mask');
    if (tagMask) {
        tagMask.addEventListener('click', (e) => {
            if (e.target === tagMask) closeTagManager();
        });
    }
    const manageTagsBtn = doc.getElementById('np-manage-tags');
    if (manageTagsBtn) manageTagsBtn.addEventListener('click', openTagManager);
    const tagClose = doc.getElementById('np-tag-close');
    if (tagClose) tagClose.addEventListener('click', closeTagManager);
    const tagNewAdd = doc.getElementById('np-tag-new-add');
    if (tagNewAdd) tagNewAdd.addEventListener('click', onTagCreate);

    // 回到顶部浮动按钮：手机端滚动容器是 #view-preset（标签+卡片一起滚），
    // 桌面端是 #np-list，按实际可滚动元素判断。
    const scrollTopBtn = doc.getElementById('np-scroll-top');
    if (scrollTopBtn) {
        const getScrollEl = () => {
            const vp = doc.getElementById('view-preset');
            if (vp && vp.scrollHeight > vp.clientHeight + 2) return vp;
            return doc.getElementById('np-list');
        };
        const toggleScrollTop = () => {
            const el = getScrollEl();
            scrollTopBtn.style.display = el && el.scrollTop > 120 ? 'block' : 'none';
        };
        doc.getElementById('np-list')?.addEventListener('scroll', toggleScrollTop);
        doc.getElementById('view-preset')?.addEventListener('scroll', toggleScrollTop);
        scrollTopBtn.addEventListener('click', () => {
            const el = getScrollEl();
            el?.scrollTo({ top: 0, behavior: 'smooth' });
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
    debugLog(`[智绘姬NAI预设切换] ${msg}`);
    // 同步完成后刷新卡片，让新预览图立刻显示
    renderAll();
}

// 把旧版 entry 映射为 Continuity 预设结构
// 关联锚点就是 entry.name（与智绘姬 yushe[name] 对应，直接写进 st.yushe[name]），
// 故 name 即我们的关联 key；旧 category 数组 = 我们的 tags。
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
    debugLog(`[智绘姬NAI预设切换] ${msg}`);
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
    debugLog(`[智绘姬NAI预设切换] 打印配置：${presets.length} 条`);
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

/**
 * 应用预设后局部刷新当前预设视图，避免全量重建（预设多时重建成本高、图片会重新加载）。
 * 仅做两件事：
 *  1) 在列表中找到旧当前卡、新当前卡，切换它们的 .np-card-active 高亮与「应用」按钮禁用态；
 *  2) 把列表最前的「当前预设」特殊副本卡替换为新当前预设的视图。
 * 若旧当前卡被标签/搜索过滤而不可见，则只处理可见部分（高亮本就不在视图里，无影响）。
 */
function refreshCurrentPresetUi(newName) {
    const list = doc.getElementById('np-list');
    if (!list) return;

    // 1) 切换新旧当前卡的高亮 + 应用按钮禁用态
    list.querySelectorAll('.np-card[data-name]').forEach(card => {
        const isNow = card.dataset.name === newName;
        const applyBtn = card.querySelector('.np-card-actions .btn-primary');
        if (isNow) {
            card.classList.add('np-card-active');
            if (applyBtn) applyBtn.disabled = true;
        } else if (card.classList.contains('np-card-active')) {
            card.classList.remove('np-card-active');
            if (applyBtn) applyBtn.disabled = false;
        }
    });

    // 2) 替换最前的特殊副本卡（第一个子节点固定为当前预设视图）
    const oldSpecial = list.querySelector(':scope > .np-card-current-special');
    if (oldSpecial && newName) {
        const fresh = buildCurrentSpecialCard(newName);
        list.replaceChild(fresh, oldSpecial);
    }
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

    // 列表最前永远插入「当前预设」特殊副本卡片（实时反映智绘姬选中项，不参与筛选）
    const currentName = getChatu8CurrentPresetName();
    if (currentName) {
        list.appendChild(buildCurrentSpecialCard(currentName));
    }

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

// 解析智绘姬当前选中的预设名：settings.mode → yusheid_<mode>（默认 comfyui）
// 如 mode=comfyui 时键为 yusheid_comfyui，值为 yushe 的 key。
function getChatu8CurrentPresetName() {
    try {
        const chatu8 = extension_settings[CHATU8_SETTINGS_KEY];
        if (!chatu8) return null;
        const mode = chatu8.mode || 'comfyui';
        return chatu8['yusheid_' + mode] || null;
    } catch (e) {
        return null;
    }
}

function buildCard(p) {
    const card = doc.createElement('div');
    card.className = 'np-card';
    if (p.name) card.dataset.name = p.name;

    // 高亮智绘姬当前选中的预设
    if (p.name && p.name === getChatu8CurrentPresetName()) {
        card.classList.add('np-card-active');
    }

    // 预览图：实时读智绘姬 yushe[name].previewImageId（异步加载）
    const imgWrap = doc.createElement('div');
    imgWrap.className = 'np-card-image';
    card.appendChild(imgWrap);
    if (p.name) {
        getChatu8PreviewImageUrl(p.name).then(url => {
            if (url) {
                const img = doc.createElement('img');
                img.className = 'np-card-img';
                img.alt = p.name;
                img.src = url;
                imgWrap.appendChild(img);
            } else {
                imgWrap.classList.add('np-card-image-empty');
            }
        });
    } else {
        imgWrap.classList.add('np-card-image-empty');
    }

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

    const isCurrent = p.name && p.name === getChatu8CurrentPresetName();

    const applyBtn = doc.createElement('button');
    applyBtn.className = 'btn-primary np-card-btn';
    applyBtn.textContent = '应用';
    applyBtn.disabled = isCurrent;
    // 始终绑定 click：当前预设靠 disabled 阻止点击，这样局部刷新切换 disabled 后
    // 旧当前卡即可立即响应，无需重新绑监听。
    applyBtn.addEventListener('click', () => applyPreset(p));
    actions.appendChild(applyBtn);

    const editBtn = doc.createElement('button');
    editBtn.className = 'btn-secondary np-card-btn';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => openEditor(p.id));
    actions.appendChild(editBtn);

    const delBtn = doc.createElement('button');
    delBtn.className = 'btn-secondary np-card-btn';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', () => deletePreset(p.id));
    actions.appendChild(delBtn);

    card.appendChild(actions);
    return card;
}

// 列表最前的「当前预设」特殊副本卡片：实时反映智绘姬选中项。
// 它独立于其余卡片——原当前预设卡片仍在列表中并保持高亮，本卡只是其副本视图。
// 若当前预设不在我们的预设库中，则仅显示名称+预览，无编辑/删除（编辑/删除走原卡片）。
function buildCurrentSpecialCard(currentName) {
    const card = doc.createElement('div');
    card.className = 'np-card np-card-current-special';

    const badge = doc.createElement('div');
    badge.className = 'np-card-current-badge';
    badge.textContent = '当前预设（实时）';
    card.appendChild(badge);

    // 预览图（与 buildCard 同逻辑）
    const imgWrap = doc.createElement('div');
    imgWrap.className = 'np-card-image';
    card.appendChild(imgWrap);
    getChatu8PreviewImageUrl(currentName).then(url => {
        if (url) {
            const img = doc.createElement('img');
            img.className = 'np-card-img';
            img.alt = currentName;
            img.src = url;
            imgWrap.appendChild(img);
        } else {
            imgWrap.classList.add('np-card-image-empty');
        }
    });

    const name = doc.createElement('div');
    name.className = 'np-card-name';
    name.textContent = currentName;
    card.appendChild(name);

    // 若当前预设也在我们的库中，显示其标签
    const own = presets.find(p => p.name === currentName);
    if (own && own.tags && own.tags.length) {
        const tagWrap = doc.createElement('div');
        tagWrap.className = 'np-card-tags';
        own.tags.forEach(t => {
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
    applyBtn.className = 'btn-primary np-card-btn';
    applyBtn.textContent = '应用';
    applyBtn.disabled = true; // 当前预设无需应用
    actions.appendChild(applyBtn);

    if (own) {
        const editBtn = doc.createElement('button');
        editBtn.className = 'btn-secondary np-card-btn';
        editBtn.textContent = '编辑';
        editBtn.addEventListener('click', () => openEditor(own.id));
        actions.appendChild(editBtn);

        const delBtn = doc.createElement('button');
        delBtn.className = 'btn-secondary np-card-btn';
        delBtn.textContent = '删除';
        delBtn.addEventListener('click', () => deletePreset(own.id));
        actions.appendChild(delBtn);
    }

    card.appendChild(actions);
    return card;
}

/* ============ 编辑弹层 ============ */

function openEditor(id) {
    editingId = id;
    const mask = doc.getElementById('np-modal-mask');
    const title = doc.getElementById('np-modal-title');
    const fName = doc.getElementById('np-f-name');

    const p = id ? presets.find(x => x.id === id) : null;
    title.textContent = p ? '编辑预设' : '新建预设';
    fName.value = p?.name || '';
    editingTags = p?.tags ? [...p.tags] : [];
    renderTagEditor();
    mask.style.display = 'flex';
    fName.focus();
}

function closeEditor() {
    const mask = doc.getElementById('np-modal-mask');
    mask.style.display = 'none';
    editingId = null;
    editingTags = [];
}

// 编辑弹层内的标签芯片编辑器
function renderTagEditor() {
    const box = doc.getElementById('np-f-tags');
    const input = doc.getElementById('np-f-tag-input');
    if (!box) return;
    box.innerHTML = '';
    editingTags.forEach((tag, idx) => {
        const chip = doc.createElement('span');
        chip.className = 'np-tag-chip';
        chip.textContent = tag;
        const x = doc.createElement('span');
        x.className = 'np-tag-chip-x';
        x.textContent = ' ×';
        x.addEventListener('click', () => {
            editingTags.splice(idx, 1);
            renderTagEditor();
        });
        chip.appendChild(x);
        box.appendChild(chip);
    });
    if (input) {
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addEditingTag(); }
        };
    }
    const addBtn = doc.getElementById('np-f-tag-add');
    if (addBtn) addBtn.onclick = addEditingTag;
}

function addEditingTag() {
    const input = doc.getElementById('np-f-tag-input');
    if (!input) return;
    const tag = input.value.trim();
    if (!tag) return;
    if (!editingTags.includes(tag)) editingTags.push(tag);
    input.value = '';
    renderTagEditor();
    input.focus();
}

function onSave() {
    const fName = doc.getElementById('np-f-name');

    const name = fName.value.trim();
    if (!name) {
        fName.focus();
        return;
    }
    const tags = [...editingTags];

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

/* ============ 标签管理 ============ */

function tagUsageCount(tag) {
    return presets.filter(p => (p.tags || []).includes(tag)).length;
}

function openTagManager() {
    const mask = doc.getElementById('np-tag-mask');
    if (!mask) return;
    renderTagManager();
    mask.style.display = 'flex';
}

function closeTagManager() {
    const mask = doc.getElementById('np-tag-mask');
    if (mask) mask.style.display = 'none';
}

function renderTagManager() {
    const list = doc.getElementById('np-tag-list');
    const targetSel = doc.getElementById('np-tag-new-target');
    if (!list || !targetSel) return;

    const tags = collectTags();
    list.innerHTML = '';
    if (tags.length === 0) {
        const empty = doc.createElement('div');
        empty.className = 'np-empty';
        empty.textContent = '暂无标签';
        list.appendChild(empty);
    } else {
        tags.forEach(tag => {
            const row = doc.createElement('div');
            row.className = 'np-tag-manage-row';

            const name = doc.createElement('span');
            name.className = 'np-tag-manage-name';
            name.textContent = `${tag}（${tagUsageCount(tag)}）`;
            row.appendChild(name);

            const renameBtn = doc.createElement('button');
            renameBtn.className = 'btn-secondary np-tag-manage-btn';
            renameBtn.textContent = '改名';
            renameBtn.addEventListener('click', () => onTagRename(tag));
            row.appendChild(renameBtn);

            const delBtn = doc.createElement('button');
            delBtn.className = 'btn-secondary np-tag-manage-btn';
            delBtn.textContent = '删除';
            delBtn.addEventListener('click', () => onTagDelete(tag));
            row.appendChild(delBtn);

            list.appendChild(row);
        });
    }

    // 新建标签的目标预设下拉
    targetSel.innerHTML = '';
    presets.forEach(p => {
        const opt = doc.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name || '(未命名)';
        targetSel.appendChild(opt);
    });
}

// 改名：在所有预设中将 old 重映射为 new；若 new 已存在则合并（去重）
function onTagRename(oldTag) {
    const next = prompt(`将标签「${oldTag}」改名为：`, oldTag);
    if (next === null) return;
    const newTag = next.trim();
    if (!newTag || newTag === oldTag) return;
    for (const p of presets) {
        if (!p.tags) continue;
        if (p.tags.includes(oldTag)) {
            p.tags = p.tags
                .filter(t => t !== oldTag)
                .concat(p.tags.includes(newTag) ? [] : [newTag]);
        }
    }
    persist();
    renderTagManager();
    renderAll();
}

// 删除：从所有预设移除该标签
function onTagDelete(tag) {
    if (!confirm(`删除标签「${tag}」？它将从所有 ${tagUsageCount(tag)} 个预设中移除。`)) return;
    for (const p of presets) {
        if (p.tags) p.tags = p.tags.filter(t => t !== tag);
    }
    persist();
    renderTagManager();
    renderAll();
}

// 新建：创建标签并附加到所选预设（空标签无意义，必须落到某个预设）
function onTagCreate() {
    const input = doc.getElementById('np-tag-new-name');
    const targetSel = doc.getElementById('np-tag-new-target');
    if (!input || !targetSel) return;
    const tag = input.value.trim();
    if (!tag) { input.focus(); return; }
    const targetId = targetSel.value;
    const p = presets.find(x => x.id === targetId);
    if (p) {
        p.tags = p.tags || [];
        if (!p.tags.includes(tag)) {
            p.tags.push(tag);
            p.updatedAt = Date.now();
        }
    }
    input.value = '';
    persist();
    renderTagManager();
    renderAll();
}

/* ============ 应用（真正落地：切换智绘姬当前预设） ============ */

async function applyPreset(p) {
    if (!p || !p.name) return;
    const name = p.name;

    // 我们不存储提示词/图片，这些一直都在智绘姬 yushe[name] 里。
    // 应用 = 仅把「当前预设」指针切到该 name，不改动 yushe[name] 本身。
    const chatu8 = extension_settings[CHATU8_SETTINGS_KEY];
    if (!chatu8 || typeof chatu8 !== 'object' || !chatu8.yushe || !chatu8.yushe[name]) {
        errorLog(`[智绘姬NAI预设切换] 智绘姬中不存在预设「${name}」，无法应用。`);
        return;
    }

    const mode = chatu8.mode || 'comfyui';
    chatu8['yusheid_' + mode] = name;

    // 触发智绘姬预设下拉的 change：这是它内部切换当前预设的唯一入口
    // （智绘姬自己的可视化选择器也是 select.value=name + trigger('change')）。
    // 只触发下拉、不填三个文本框——文本框面板本就不可见，生图只读数据层。
    const selectId = 'yusheid' + (mode === 'sd' ? '' : '_' + mode);
    const presetSelect = document.getElementById(selectId);
    if (presetSelect) {
        presetSelect.value = name;
        presetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 4) 持久化（避免刷新后丢失当前预设）
    try { saveSettings(); } catch (e) { errorLog('[智绘姬NAI预设切换] saveSettings 失败', e); }

    debugLog(`[智绘姬NAI预设切换] 已应用预设「${name}」到智绘姬`);
    refreshCurrentPresetUi(name); // 局部刷新：仅切换新旧当前卡高亮 + 替换最前特殊卡
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
