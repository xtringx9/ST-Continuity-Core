// src/features/generation-records/generationRecordsPanel.js
// 生成记录面板（2026-08-18 重构，替代 generatorDebugPanel + generatorHistoryPanel）。
// 单一面板双视图：列表（筛选后的记录卡片）+ 详情（单条记录完整内容 + 处理操作）。
// - 顶部常驻筛选栏：generator / 角色 / 聊天 / 楼层 / 状态
// - 详情页：‹ 返回列表 + ‹ › 切换（在当前筛选结果集内移动，含已处理）+ 保存(追加/覆盖)/抛弃
// - 处理（保存/抛弃）后自动跳结果集内下一条 pending，没有则回列表
// - 入口：
//   - 大 Cc「生成记录」→ 列表视图，筛选全空（显示全部）
//   - 小 Cc 生成完成 / 待处理点击 / 弹窗生成 → 详情视图，筛选自动填充当前上下文
// 数据与回调内聚在 moduleAiGenerator（getAllPendingRecords / buildRecordCallbacks），
// 本面板通过全局注册 openGenerationRecords / updateRunningRecord / closeRunningRecord
// 被 moduleAiGenerator / messageAiButton 调用（避免反向 import 循环依赖）。

import { IframeModal } from '../../shared/IframeModal.js';
import { showToast } from '../../shared/Toast.js';
import { translate } from '../../../../../../i18n.js';
import { getAllPendingRecords, getPendingCount, buildRecordCallbacks } from '../../services/moduleAiGenerator.js';
import { taskRegistry } from '../../core/taskRegistry.js';

const PANEL_HTML_URL = new URL('generationRecordsPanel.html', import.meta.url).href;

let panelModal = null;

/** 面板打开参数（每次 open 重置） */
let openOpts = { view: 'list', filters: { gen: '', char: '', chat: '', floor: '', status: 'all' }, recordId: null };

const STATUS_LABELS = {
    running: '生成中',
    pending: '待处理',
    saved: '已保存',
    discarded: '已抛弃',
    error: '失败',
};

/**
 * 打开生成记录面板（单实例）。面板已打开时直接切换视图（不重建 iframe）。
 * @param {Object} [opts]
 * @param {'list'|'detail'} [opts.view] 初始视图：list=列表（默认）；detail=详情（需 recordId 或 running）
 * @param {Object} [opts.filters] 初始筛选 { gen, char, chat, floor, status }
 * @param {string} [opts.recordId] detail 视图时定位的记录 id
 * @param {Object} [opts.running] 运行中记录 { taskKey, generatorName, mesId, debugData }（生成中详情）
 */
export function openGenerationRecords(opts = {}) {
    openOpts = {
        view: opts.view === 'detail' ? 'detail' : 'list',
        filters: {
            gen: opts.filters?.gen || '',
            char: opts.filters?.char || '',
            chat: opts.filters?.chat || '',
            floor: opts.filters?.floor || '',
            status: opts.filters?.status || 'all',
        },
        recordId: opts.recordId || null,
        running: opts.running || null,
    };
    if (opts.running?.taskKey) {
        runningMap.set(opts.running.taskKey, opts.running.debugData || {});
    }
    // 面板已打开：onLoad 不会再次触发，直接应用视图
    if (panelModal && panelModal.backdrop && panelDoc) {
        applyView();
        return;
    }
    if (!panelModal) panelModal = new IframeModal();
    panelModal.open(PANEL_HTML_URL, translate('ccore_records_title') || '生成记录', {
        variant: 'center',
        onLoad: (iframe) => {
            const doc = iframe.contentDocument;
            if (!doc) return;
            const theme = localStorage.getItem('st_continuity_theme') || 'light';
            doc.documentElement.setAttribute('data-theme', theme);
            const closeBtn = doc.getElementById('ccore-records-close');
            if (closeBtn) closeBtn.addEventListener('click', () => panelModal.close());
            bindPanel(doc);
            applyView();
        },
    });
}

/** 当前面板 doc（模块级，供流式更新/关闭引用） */
let panelDoc = null;

/** 模块级渲染函数（bindPanel 内赋值；供已打开时切换视图/流式更新引用） */
let showList = null;
let renderList = null;
let showDetail = null;
let showRunningDetail = null;

/** 底栏结果数元素（模块级，renderList 内引用） */
let footerInfo = null;

/** 底栏时间元素（模块级，showDetail 内引用） */
let footerTimeEl = null;

/** 顶栏 title-wrap 元素缓存（模块级，updateHeader 内引用；面板关闭重建 iframe 后需重置） */
let titleWrapEl = null;

/** 底部操作栏元素（模块级，showDetail/showRunningDetail 引用） */
let opbarEl = null;

/** 筛选下拉元素缓存（模块级，collectFilterOptions 引用） */
let genFilterEl = null;
let charFilterEl = null;
let chatFilterEl = null;

/**
 * 绑定筛选元素引用（bindPanel 调用；面板重建 iframe 后需重新绑定）。
 */
function bindFilterEls(gen, char, chat) {
    genFilterEl = gen;
    charFilterEl = char;
    chatFilterEl = chat;
}

/** 收集筛选项（模块级；初始 + 数据变更后刷新） */
function collectFilterOptions() {
    const all = getAllPendingRecords();
    const gens = new Set();
    const chars = new Set();
    const chats = new Set();
    all.forEach(r => {
        if (r.generatorName) gens.add(r.generatorName);
        const parts = String(r.chatKey || '').split('::');
        if (parts[0]) chars.add(parts[0]);
        if (parts[1]) chats.add(parts[1]);
    });
    fillSelect(genFilterEl, [...gens], state.filters.gen);
    fillSelect(charFilterEl, [...chars], state.filters.char);
    fillSelect(chatFilterEl, [...chats], state.filters.chat);
}

/**
 * 顶栏动态渲染：
 * - 列表视图：显示「生成记录」标题
 * - 详情/运行中：返回按钮 + 状态徽章（返回后，pending/已处理都显示）+ 上下文（角色/聊天/楼层，允许换行）
 * @param {'list'|'detail'|'running'} view
 * @param {Object} [ctx] { text, badge } 上下文文本 + 状态徽章 { label, type }
 */
function updateHeader(view, ctx = {}) {
    if (!panelDoc) return;
    if (!titleWrapEl) titleWrapEl = panelDoc.getElementById('ccore-records-title-wrap');
    if (!titleWrapEl) return;
    if (view === 'list') {
        titleWrapEl.innerHTML = `<span class="ccore-records-title">${escapeHtml(translate('ccore_records_title') || '生成记录')}</span>`;
        return;
    }
    // 状态徽章（pending/已处理结果均可显示；返回后、label 前）
    const badge = ctx.badge
        ? `<span class="ccore-records-title-badge ccore-records-title-badge-${escapeHtml(ctx.badge.type || 'pending')}">${escapeHtml(ctx.badge.label || '')}</span>`
        : '';
    titleWrapEl.innerHTML = `
        <button class="btn-back-icon ccore-records-title-back" title="返回列表">❮</button>
        ${badge}
        <span class="ccore-records-title-ctx">${escapeHtml(ctx.text || '')}</span>
    `;
    const back = titleWrapEl.querySelector('.ccore-records-title-back');
    if (back) back.addEventListener('click', () => showList());
}

/** 面板内部状态 */
const state = {
    filters: { gen: '', char: '', chat: '', floor: '', status: 'all' },
    records: [],       // 当前筛选结果集（新→旧）
    currentId: null,   // 详情视图当前记录 id
    running: null,     // 运行中记录 { taskKey, debugData, generatorName, mesId }（生成中详情）
};

/** 运行中记录 map（taskKey → debugData），供流式更新 */
const runningMap = new Map();

function bindPanel(doc) {
    panelDoc = doc;
    // ⚠️ 面板关闭销毁 iframe 后，模块级元素缓存必须重置（否则第二次打开写入已脱离文档的旧节点 → 顶栏空）
    titleWrapEl = null;
    opbarEl = null;
    const listEl = doc.getElementById('ccore-records-list');
    const detailEl = doc.getElementById('ccore-records-detail');
    if (!listEl || !detailEl) return;

    const genFilter = doc.getElementById('ccore-records-filter-gen');
    const charFilter = doc.getElementById('ccore-records-filter-char');
    const chatFilter = doc.getElementById('ccore-records-filter-chat');
    const floorFilter = doc.getElementById('ccore-records-filter-floor');
    const statusFilter = doc.getElementById('ccore-records-filter-status');

    // 初始筛选 = openOpts.filters
    state.filters = { ...openOpts.filters };
    state.currentId = openOpts.recordId;

    // 收集筛选项（模块级 collectFilterOptions 的绑定入口）
    bindFilterEls(genFilter, charFilter, chatFilter);
    collectFilterOptions();

    renderList = () => {
        const listEl = panelDoc?.getElementById('ccore-records-list');
        if (!listEl) return;
        listEl.innerHTML = '';
        state.records = computeRecords();
        if (footerInfo) footerInfo.textContent = `共 ${state.records.length} 条`;
        if (state.records.length === 0) {
            listEl.innerHTML = `<div class="ccore-records-empty">${translate('ccore_history_empty')}</div>`;
            return;
        }
        state.records.forEach(r => {
            const parts = String(r.chatKey || '').split('::');
            const charName = parts[0] || '?';
            const chatName = parts[1] || '?';
            const statusLabel = STATUS_LABELS[r.status] || r.status;
            const time = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
            const respLen = r.debugData?.response ? String(r.debugData.response).length : 0;
            const metaSub = respLen > 0 ? ` · ${respLen} 字符` : '';

            // 列表卡片纯展示，不提供操作按钮（保存/抛弃等操作统一在详情页底部操作栏）
            const card = document.createElement('div');
            card.className = `ccore-records-card ccore-records-${r.status}`;
            card.innerHTML = `
                <div class="ccore-records-card-head">
                    <span class="ccore-records-status">${statusLabel}</span>
                    <span class="ccore-records-meta">${charName} / ${chatName} / #${r.mesId}</span>
                    <span class="ccore-records-time">${time}</span>
                </div>
                <div class="ccore-records-card-body">
                    <span class="ccore-records-gen">${r.generatorName || 'modules'}${metaSub}</span>
                    ${r.note ? `<span class="ccore-records-note">${r.note}</span>` : ''}
                </div>
            `;
            card.addEventListener('click', () => {
                if (r.isRunning) {
                    // 运行中记录：进入运行中详情（流式更新 + 中止）
                    showRunningDetail({
                        taskKey: r.taskKey || '',
                        generatorName: r.generatorName,
                        mesId: r.mesId,
                        debugData: r.debugData || {},
                    });
                } else {
                    showDetail(r.id);
                }
            });
            listEl.appendChild(card);
        });
    };

    // 详情视图渲染（当前记录 + sections + 底部操作栏）
    showDetail = (recordId) => {
        state.currentId = recordId;
        const record = state.records.find(r => r.id === recordId) || getAllPendingRecords().find(r => r.id === recordId);
        if (!record) return;
        const parts = String(record.chatKey || '').split('::');
        const charName = parts[0] || '?';
        const chatName = parts[1] || '?';
        const statusLabel = STATUS_LABELS[record.status] || record.status;
        const time = record.createdAt ? new Date(record.createdAt).toLocaleString() : '';

        // 顶栏：返回 + 状态徽章（pending/已处理均显示）+ 角色/聊天/楼层；底栏：记录时间
        updateHeader('detail', {
            text: `${charName} / ${chatName} / #${record.mesId}`,
            badge: { label: statusLabel, type: record.status },
        });
        if (footerTimeEl) footerTimeEl.textContent = time;

        // 元数据行（仅备注；状态徽章已在顶栏）
        const metaEl = doc.getElementById('ccore-records-detail-meta');
        metaEl.innerHTML = `<span class="ccore-records-note">${record.note || ''}</span>`;

        // sections（固定全部渲染：发送内容 / 完整响应 / 提取结果 / API / 错误最底，可折叠）
        const bodyEl = doc.getElementById('ccore-records-detail-body');
        bodyEl.innerHTML = buildDetailSections(record);
        bindSectionToggles(bodyEl);

        // 底部操作栏：‹ › 切左右 + 保存方式 + 查看当前 + 保存 + 抛弃（pending）；已处理只读
        renderOpbar(record);

        // 视图切换
        listEl.style.display = 'none';
        detailEl.style.display = 'flex';
        if (opbarEl) opbarEl.style.display = 'flex';
    };

    showList = () => {
        state.currentId = null;
        state.running = null;
        updateHeader('list');
        if (footerTimeEl) footerTimeEl.textContent = '';
        if (opbarEl) opbarEl.style.display = 'none';
        hideCurrentContent();
        renderList();
        doc.getElementById('ccore-records-detail').style.display = 'none';
        doc.getElementById('ccore-records-list').style.display = 'block';
    };

    // 筛选绑定
    [genFilter, charFilter, chatFilter, floorFilter, statusFilter].forEach(el => {
        if (!el) return;
        el.addEventListener('change', () => {
            state.filters.gen = genFilter?.value || '';
            state.filters.char = charFilter?.value || '';
            state.filters.chat = chatFilter?.value || '';
            state.filters.floor = floorFilter?.value || '';
            state.filters.status = statusFilter?.value || 'all';
            showList();
        });
    });

    // 底栏信息（待处理 + 结果数 + 时间）
    const countEl = doc.getElementById('ccore-records-count');
    footerInfo = doc.getElementById('ccore-records-footer-info');
    footerTimeEl = doc.getElementById('ccore-records-footer-time');
    opbarEl = doc.getElementById('ccore-records-opbar');
    const updateCount = () => {
        if (countEl) countEl.textContent = `${translate('ccore_history_pending')}: ${getPendingCount()}`;
    };
    updateCount();

    // 记录被处理（保存/抛弃/失败）后刷新：结果集重算；若当前在详情且当前记录已处理 → 自动跳下一条 pending 或回列表
    // ⚠️ 监听器提升为模块级单例（bindPendingListener）：面板重复打开/关闭时先移除再注册，避免监听累积
    const onPendingChanged = () => {
        updateCount();
        collectFilterOptions();
        if (state.currentId) {
            const cur = getAllPendingRecords().find(r => r.id === state.currentId);
            if (cur && cur.status !== 'pending') {
                // 当前已处理 → 自动跳下一条 pending
                const remaining = getAllPendingRecords().filter(r =>
                    r.status === 'pending' && matchesFilters(r, state.filters) && r.id !== state.currentId);
                if (remaining.length > 0) {
                    showDetail(remaining[0].id);
                } else {
                    showList();
                }
                return;
            }
            // 仍 pending → 刷新当前详情
            showDetail(state.currentId);
        } else {
            renderList();
        }
    };
    bindPendingListener(onPendingChanged);

    // 运行中任务状态变化（开始/结束）→ 刷新列表（running 记录出现在列表并支持流式）
    const onTaskUpdate = () => {
        updateCount();
        collectFilterOptions();
        // 仅列表视图刷新；运行中详情由 updateRunningRecord 流式更新，不打断
        if (!state.currentId && typeof renderList === 'function') {
            renderList();
        }
    };
    bindTaskUpdateListener(onTaskUpdate);

    const closeBtn = doc.getElementById('ccore-records-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            unbindPendingListener();
            unbindTaskUpdateListener();
        });
    }

}

/** 模块级：当前挂载的 pending 变更监听器引用（防重复添加） */
let pendingListener = null;

function bindPendingListener(listener) {
    if (pendingListener) window.removeEventListener('ccore-pending-cleared', pendingListener);
    pendingListener = listener;
    window.addEventListener('ccore-pending-cleared', pendingListener);
}

function unbindPendingListener() {
    if (pendingListener) {
        window.removeEventListener('ccore-pending-cleared', pendingListener);
        pendingListener = null;
    }
}

/** 模块级：当前挂载的 task 更新监听器引用（防重复添加） */
let taskUpdateListener = null;

function bindTaskUpdateListener(listener) {
    if (taskUpdateListener) window.removeEventListener(taskRegistry.TASK_UPDATE_EVENT, taskUpdateListener);
    taskUpdateListener = listener;
    window.addEventListener(taskRegistry.TASK_UPDATE_EVENT, taskUpdateListener);
}

function unbindTaskUpdateListener() {
    if (taskUpdateListener) {
        window.removeEventListener(taskRegistry.TASK_UPDATE_EVENT, taskUpdateListener);
        taskUpdateListener = null;
    }
}

/** 根据 openOpts 应用视图（面板首次加载与已打开切换共用） */
function applyView() {
    if (!panelDoc) return;
    // 面板已打开时也要同步筛选（bindPanel 只在首次执行）
    state.filters = { ...openOpts.filters };
    if (openOpts.view === 'detail') {
        if (openOpts.running?.taskKey) {
            // 运行中记录详情（生成中，流式更新）
            state.records = computeRecords();
            showRunningDetail(openOpts.running);
        } else if (openOpts.recordId) {
            state.records = computeRecords();
            if (!state.records.find(r => r.id === openOpts.recordId)) {
                // 定位的记录不在当前筛选结果集 → 临时放宽（回退到该记录全局）
                state.records = getAllPendingRecords();
            }
            showDetail(openOpts.recordId);
        } else {
            showList();
        }
    } else {
        showList();
    }
}

/** 计算当前筛选结果集（模块级） */
function computeRecords() {
    const all = getAllPendingRecords();
    return all.filter(r => matchesFilters(r, state.filters));
}

/** 筛选匹配辅助 */
function matchesFilters(r, f) {
    const parts = String(r.chatKey || '').split('::');
    const c = parts[0] || '';
    const ch = parts[1] || '';
    if (f.gen && r.generatorName !== f.gen) return false;
    if (f.char && c !== f.char) return false;
    if (f.chat && ch !== f.chat) return false;
    if (f.floor !== '' && Number(r.mesId) !== Number(f.floor)) return false;
    if (f.status !== 'all' && r.status !== f.status) return false;
    return true;
}

function fillSelect(select, options, current) {
    if (!select) return;
    select.innerHTML = `<option value="">${escapeHtml(translate('ccore_history_all'))}</option>` +
        options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
    if (current && options.includes(current)) select.value = current;
    else select.value = '';
}

/**
 * 渲染底部操作栏（详情视图专用）：
 * - 左右切换 ‹ › 始终显示（列表顶/底置灰），在当前筛选结果集内移动
 * - pending：查看当前 + 保存 + 抛弃（保存方式下拉已移到顶栏 badge 旁）
 * - 已处理（saved/discarded/error）：无操作按钮（保留左右切换）
 * @param {object} record 当前记录
 */
function renderOpbar(record) {
    if (!opbarEl || !panelDoc) return;
    hideCurrentContent();
    const callbacks = buildRecordCallbacks(record);
    const idx = state.records.findIndex(r => r.id === record.id);
    const total = state.records.length;
    const atStart = idx <= 0;
    const atEnd = idx >= total - 1;

    // 左右切换（顶/底置灰）
    const navHtml = `
        <button class="ccore-records-nav-prev" title="上一条" ${atStart ? 'disabled' : ''}>‹</button>
        <span class="ccore-records-nav-count">${total > 0 ? idx + 1 : 0}/${total}</span>
        <button class="ccore-records-nav-next" title="下一条" ${atEnd ? 'disabled' : ''}>›</button>
    `;

    if (!callbacks) {
        // 已处理：无操作按钮，仅左右切换
        opbarEl.innerHTML = `${navHtml}<span class="ccore-records-nav-sep"></span><span class="ccore-records-readonly">${STATUS_LABELS[record.status] || record.status}（只读）</span>`;
        opbarEl.style.display = 'flex';
        bindOpbarNav(record, atStart, atEnd);
        return;
    }

    opbarEl.innerHTML = `
        ${navHtml}
        <span class="ccore-records-nav-sep"></span>
        <select class="ccore-records-save-mode" title="保存方式">
            <option value="append">${escapeHtml(translate('ccore_records_save_append'))}</option>
            <option value="overwrite">${escapeHtml(translate('ccore_records_save_overwrite'))}</option>
        </select>
        <button class="ccore-records-current-btn" title="查看当前存储内容，与本次生成结果对比">查看当前</button>
        <button class="ccore-records-save">保存</button>
        <button class="ccore-records-discard">抛弃</button>
    `;
    bindOpbarNav(record, atStart, atEnd);

    // 保存（读取 opbar 内保存方式下拉：append/overwrite）
    opbarEl.querySelector('.ccore-records-save').addEventListener('click', async () => {
        const saveModeSelect = opbarEl.querySelector('.ccore-records-save-mode');
        const saveMode = saveModeSelect?.value || 'append';
        try { await callbacks.onSave(saveMode); } catch (e) { console.error('[Records] 保存失败', e); }
    });

    // 抛弃（全局有效：buildRecordCallbacks 已带记录所属 chatKey）+ iframe 通用 toast 反馈
    opbarEl.querySelector('.ccore-records-discard').addEventListener('click', () => {
        try { callbacks.onDiscard(); } catch (e) { console.error('[Records] 抛弃失败', e); }
        showToast(`已抛弃 #${record.mesId} ${record.generatorName || 'modules'} 的生成结果`, 'success');
    });

    // 查看当前内容（对比用）
    const currentBtn = opbarEl.querySelector('.ccore-records-current-btn');
    const currentEl = panelDoc.getElementById('ccore-records-current');
    const currentPre = panelDoc.getElementById('ccore-records-current-pre');
    currentBtn.addEventListener('click', async () => {
        if (currentEl && currentEl.style.display !== 'none') {
            currentEl.style.display = 'none';
            return;
        }
        if (!currentEl || !currentPre) return;
        currentPre.textContent = '加载中…';
        currentEl.style.display = 'block';
        try {
            const content = await callbacks.onLoadCurrentContent();
            currentPre.textContent = content || '(无内容)';
        } catch (e) {
            currentPre.textContent = `加载失败: ${e.message}`;
        }
    });

    opbarEl.style.display = 'flex';
}

/** 绑定操作栏左右切换（禁用态不绑定） */
function bindOpbarNav(record, atStart, atEnd) {
    const prevBtn = opbarEl?.querySelector('.ccore-records-nav-prev');
    const nextBtn = opbarEl?.querySelector('.ccore-records-nav-next');
    if (prevBtn && !atStart) {
        prevBtn.addEventListener('click', () => {
            const idx = state.records.findIndex(r => r.id === record.id);
            const next = state.records[idx - 1];
            if (next) showDetail(next.id);
        });
    }
    if (nextBtn && !atEnd) {
        nextBtn.addEventListener('click', () => {
            const idx = state.records.findIndex(r => r.id === record.id);
            const next = state.records[idx + 1];
            if (next) showDetail(next.id);
        });
    }
}

/** 收起「查看当前内容」区域 */
function hideCurrentContent() {
    const el = panelDoc?.getElementById('ccore-records-current');
    if (el) el.style.display = 'none';
}

/** 详情视图渲染运行中记录（生成中：流式刷新 + 中止按钮） */
showRunningDetail = (running) => {
    state.running = running;
    state.currentId = null;
    const { taskKey, generatorName, mesId, debugData } = running;
    if (!panelDoc) return;

    updateHeader('running', {
        text: `${generatorName || 'modules'} / #${mesId} · 生成中`,
        badge: { label: '生成中', type: 'running' },
    });
    if (footerTimeEl) footerTimeEl.textContent = '';

    const metaEl = panelDoc.getElementById('ccore-records-detail-meta');
    metaEl.innerHTML = '<span class="ccore-records-note">生成中…</span>';

    // 操作栏：中止生成
    if (opbarEl) {
        hideCurrentContent();
        opbarEl.innerHTML = `<button class="ccore-records-abort">中止生成</button>`;
        opbarEl.style.display = 'flex';
        const abortBtn = opbarEl.querySelector('.ccore-records-abort');
        if (debugData?.onAbort) {
            abortBtn.addEventListener('click', () => {
                try { debugData.onAbort(); } catch (e) {}
                abortBtn.disabled = true;
                abortBtn.textContent = '已中止';
            });
        } else {
            abortBtn.disabled = true;
        }
    }

    const bodyEl = panelDoc.getElementById('ccore-records-detail-body');
    bodyEl.innerHTML = buildDetailSections({ debugData: runningMap.get(taskKey) || debugData });
    bindSectionToggles(bodyEl);

    panelDoc.getElementById('ccore-records-list').style.display = 'none';
    panelDoc.getElementById('ccore-records-detail').style.display = 'flex';
};

/**
 * 流式更新运行中记录（生成中面板实时刷新，供 moduleAiGenerator 调用）。
 * @param {string} taskKey
 * @param {object} debugData 最新 debugData
 */
export function updateRunningRecord(taskKey, debugData) {
    if (!taskKey) return;
    runningMap.set(taskKey, debugData || {});
    if (panelDoc && state.running?.taskKey === taskKey) {
        const bodyEl = panelDoc.getElementById('ccore-records-detail-body');
        if (bodyEl) {
            bodyEl.innerHTML = buildDetailSections({ debugData: runningMap.get(taskKey) });
            bindSectionToggles(bodyEl);
        }
    }
}

/**
 * 运行中记录结束（生成完成/失败），仅清理 runningMap 与运行态。
 * ⚠️ 不再切视图（修复：生成结束会跳回列表的 bug）——视图切换由 notifyGenerationCompleted 决定。
 * @param {string} taskKey
 */
export function closeRunningRecord(taskKey) {
    runningMap.delete(taskKey);
    if (panelDoc && state.running?.taskKey === taskKey) {
        state.running = null;
    }
}

/**
 * 新生成记录完成通知（供 moduleAiGenerator 调用）。
 * - 面板未打开：照常打开详情（调用方随后调 openGenerationRecords）
 * - 面板已打开：toast 提示 + 静默刷新数据/列表，不打断当前视图（用户可稍后点开）
 * @param {object} info { recordId, generatorName, mesId, chatKey, status }
 * @returns {boolean} true=面板已打开并处理（调用方不要再强制开详情）；false=面板未打开
 */
export function notifyGenerationCompleted(info = {}) {
    // 面板未打开 → 返回 false，调用方走原逻辑（openGenerationRecords 打开详情）
    if (!panelDoc || !panelModal?.backdrop) return false;
    // 面板已打开：toast 通知 + 静默刷新（不打断当前视图）
    const label = info.status === 'error' ? '生成失败' : '生成完成';
    const time = new Date().toLocaleString();
    showToast(`${label} #${info.mesId} ${info.generatorName || 'modules'}（${time}）`, info.status === 'error' ? 'error' : 'success');
    // 刷新筛选项 + 若当前在列表视图则重渲染（静默）
    if (panelDoc) {
        try { collectFilterOptions?.(); } catch (e) {}
    }
    if (!state.currentId && typeof renderList === 'function') {
        renderList();
    }
    return true;
}

/**
 * 详情 sections 渲染（顺序：发送内容 / 完整响应 / 错误[按需] / API[贴底部]；提取结果暂隐藏）。
 * 默认折叠状态：发送内容=折叠、完整响应=展开、API=展开（贴底部的信息类默认展开）；
 * ⚠️ 有错误时：错误 + 发送内容都强制展开（便于排查）。
 * 每个 section 可点击标题折叠/展开。
 */
function buildDetailSections(record) {
    const d = record.debugData || {};
    const sections = [];
    const hasError = !!d.error;

    // 发送内容（默认折叠；有错误时强制展开；未捕获到提示词时占位）
    let sentReadable = '(未捕获到)';
    const cap = d.capturedPrompt;
    if (Array.isArray(cap) && cap.length > 0) {
        sentReadable = cap.map(m => `[${m.role}${m.name ? ` (${m.name})` : ''}]\n${m.content}`).join('\n\n---\n\n');
    } else if (typeof cap === 'string' && cap) {
        sentReadable = cap;
    }
    sections.push(section('发送内容', sentReadable, { collapsed: !hasError }));

    // 完整响应（默认展开）
    sections.push(section('完整响应', d.response || '(空)', { collapsed: false }));

    // 提取结果：暂隐藏（用户拍板，暂时无用）

    // 错误：按需出现（仅在存在错误时渲染，放在 API 之前、强制展开）
    if (hasError) {
        sections.push(section('错误', d.error, { collapsed: false, error: true }));
    }

    // API 信息（贴底部——与发送内容/完整响应分开，信息类靠底部；默认展开）
    const api = d.apiUsed || {};
    const apiLines = [];
    if (api.custom !== undefined || Object.keys(api).length > 0) {
        apiLines.push(`类型: ${api.custom ? '独立 API' : 'ST 主 API'}`);
    }
    if (api.model) apiLines.push(`模型: ${api.model}`);
    if (api.source) apiLines.push(`来源: ${api.source}`);
    if (api.apiurl) apiLines.push(`URL: ${api.apiurl}`);
    if (api.temperature !== undefined) apiLines.push(`温度: ${api.temperature}`);
    if (api.max_tokens) apiLines.push(`Max Tokens: ${api.max_tokens}`);
    if (apiLines.length === 0) apiLines.push('(无)');
    sections.push(section('API 信息', apiLines.join('\n'), { collapsed: false }));

    return sections.join('');
}

/**
 * 渲染一个可折叠 section。
 * @param {string} title
 * @param {string} content
 * @param {Object} [opts]
 * @param {boolean} [opts.collapsed] 默认是否折叠
 * @param {boolean} [opts.error] 是否错误 section（红色）
 */
function section(title, content, opts = {}) {
    const collapsed = opts.collapsed !== false;
    const errCls = opts.error ? ' ccore-records-error' : '';
    return `<div class="ccore-records-section${errCls}" data-collapsed="${collapsed ? '1' : '0'}">
        <div class="ccore-records-sec-title ccore-records-sec-toggle" title="点击折叠/展开">
            <span class="ccore-records-sec-caret">${collapsed ? '▶' : '▼'}</span>
            ${escapeHtml(title)}
        </div>
        <pre style="display:${collapsed ? 'none' : 'block'}">${escapeHtml(content)}</pre>
    </div>`;
}

/** 绑定详情 sections 的折叠/展开（在 bodyEl.innerHTML 赋值后调用） */
function bindSectionToggles(bodyEl) {
    bodyEl?.querySelectorAll('.ccore-records-sec-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const sec = toggle.parentElement;
            const pre = sec.querySelector('pre');
            const caret = toggle.querySelector('.ccore-records-sec-caret');
            const collapsed = sec.dataset.collapsed !== '0';
            sec.dataset.collapsed = collapsed ? '0' : '1';
            if (pre) pre.style.display = collapsed ? 'block' : 'none';
            if (caret) caret.textContent = collapsed ? '▼' : '▶';
        });
    });
}

function escapeHtml(text) {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// 暴露到父窗口全局，供 moduleAiGenerator / messageAiButton 调用（避免反向 import 循环）
if (typeof window !== 'undefined') {
    window.openGenerationRecords = openGenerationRecords;
    window.updateRunningRecord = updateRunningRecord;
    window.closeRunningRecord = closeRunningRecord;
    window.notifyGenerationCompleted = notifyGenerationCompleted;
}

export default { openGenerationRecords, updateRunningRecord, closeRunningRecord, notifyGenerationCompleted };
