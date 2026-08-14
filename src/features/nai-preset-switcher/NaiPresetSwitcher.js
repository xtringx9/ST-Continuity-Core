// src/features/nai-preset-switcher/NaiPresetSwitcher.js
// 预设切换 · 编辑器
// 运行在父窗口上下文，操作 iframe 的 document（与 module-editor / generator-editor 一致）。
// 预设本质 = 提示词预设（positive / negative），标签系统为自建多标签。

import configManager from '../../singleton/configManager.js';
import { infoLog, errorLog } from '../../utils/logger.js';
import { translate } from '../../../../../../i18n.js';

let doc = null;
let presets = [];          // 当前预设列表（configManager.getNaiPresets() 的副本）
let activeTag = 'ALL';     // 当前标签筛选
let searchTerm = '';       // 当前搜索词
let editingId = null;      // 正在编辑的预设 id（null = 新建）

/**
 * 初始化预设切换编辑器
 * 由 EntryButton 在 iframe onLoad 回调中调用。
 * @param {Document} iframeDocument Iframe 的文档对象
 */
export function initNaiPresetSwitcher(iframeDocument) {
    doc = iframeDocument;
    presets = configManager.getNaiPresets().map(p => ({ ...p }));

    applyI18nToStaticElements();
    bindThemeToggle();
    bindStaticControls();
    renderAll();
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
    const savedTheme = localStorage.getItem('st_continuity_theme') || 'light';
    doc.documentElement.setAttribute('data-theme', savedTheme);

    const headerTitle = doc.querySelector('.header-title') || doc.getElementById('header-title');
    if (headerTitle) {
        headerTitle.style.cursor = 'pointer';
        headerTitle.title = translate('ccore_title_toggle_theme') || '点击切换主题';
        headerTitle.addEventListener('click', () => {
            const current = doc.documentElement.getAttribute('data-theme') || 'light';
            const next = current === 'light' ? 'dark' : 'light';
            doc.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('st_continuity_theme', next);
            window.dispatchEvent(new CustomEvent('continuity-theme-change'));
        });
    }
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
    if (newBtn) {
        newBtn.addEventListener('click', () => openEditor(null));
    }

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
        // 搜索（名称 + 标签 + 提示词）
        if (searchTerm) {
            const hay = [
                p.name || '',
                (p.tags || []).join(' '),
                p.positive || '',
                p.negative || '',
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
            ? '预设列表为空，点击「+ 新建预设」添加预设'
            : '没有匹配的预设';
        list.appendChild(empty);
        return;
    }

    items.forEach(p => list.appendChild(buildCard(p)));
}

function buildCard(p) {
    const card = doc.createElement('div');
    card.className = 'np-card';

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

    const pos = doc.createElement('div');
    pos.className = 'np-card-pos';
    pos.textContent = p.positive || '';
    card.appendChild(pos);

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
    const fPos = doc.getElementById('np-f-positive');
    const fNeg = doc.getElementById('np-f-negative');

    const p = id ? presets.find(x => x.id === id) : null;
    title.textContent = p ? '编辑预设' : '新建预设';
    fName.value = p?.name || '';
    fTags.value = p?.tags ? p.tags.join(', ') : '';
    fPos.value = p?.positive || '';
    fNeg.value = p?.negative || '';
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
    const fPos = doc.getElementById('np-f-positive');
    const fNeg = doc.getElementById('np-f-negative');

    const name = fName.value.trim();
    if (!name) {
        fName.focus();
        return;
    }
    const tags = fTags.value.split(',').map(s => s.trim()).filter(Boolean);
    const positive = fPos.value;
    const negative = fNeg.value;

    if (editingId) {
        const p = presets.find(x => x.id === editingId);
        if (p) {
            p.name = name;
            p.tags = tags;
            p.positive = positive;
            p.negative = negative;
            p.updatedAt = Date.now();
        }
    } else {
        presets.push({
            id: genId(),
            name,
            tags,
            positive,
            negative,
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

function applyPreset(p) {
    const text = [p.positive || '', p.negative ? `Negative prompt: ${p.negative}` : '']
        .filter(Boolean).join('\n\n');
    copyToClipboard(text);
    infoLog(`[预设切换] 已复制预设「${p.name}」到剪贴板`);
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
