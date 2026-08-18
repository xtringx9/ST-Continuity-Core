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
import { translate } from '../../../../../../i18n.js';
import { getAllPendingRecords, getPendingCount, discardPendingRecord, buildRecordCallbacks } from '../../services/moduleAiGenerator.js';

const PANEL_HTML_URL = new URL('generationRecordsPanel.html', import.meta.url).href;

let panelModal = null;

/** 面板打开参数（每次 open 重置） */
let openOpts = { view: 'list', filters: { gen: '', char: '', chat: '', floor: '', status: 'all' }, recordId: null };

const STATUS_LABELS = {
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

    // 收集筛选项
    const collectFilterOptions = () => {
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
        fillSelect(genFilter, [...gens], state.filters.gen);
        fillSelect(charFilter, [...chars], state.filters.char);
        fillSelect(chatFilter, [...chats], state.filters.chat);
    };

    renderList = () => {
        const listEl = panelDoc?.getElementById('ccore-records-list');
        if (!listEl) return;
        listEl.innerHTML = '';
        state.records = computeRecords();
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
                    <span class="ccore-records-actions">
                        ${r.status === 'pending' ? `<button class="ccore-records-act ccore-records-discard" title="抛弃（不保存，随时可执行）">抛弃</button>` : ''}
                    </span>
                </div>
            `;
            card.addEventListener('click', () => showDetail(r.id));
            const discardBtn = card.querySelector('.ccore-records-discard');
            if (discardBtn) {
                discardBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    discardPendingRecord(r.generatorName, r.mesId, r.id);
                    toastr.info(`已抛弃 #${r.mesId} ${r.generatorName} 的生成结果`);
                });
            }
            listEl.appendChild(card);
        });
    };

    // 详情视图渲染（当前记录 + sections）
    showDetail = (recordId) => {
        state.currentId = recordId;
        const record = state.records.find(r => r.id === recordId) || getAllPendingRecords().find(r => r.id === recordId);
        if (!record) return;
        const parts = String(record.chatKey || '').split('::');
        const charName = parts[0] || '?';
        const chatName = parts[1] || '?';
        const statusLabel = STATUS_LABELS[record.status] || record.status;
        const time = record.createdAt ? new Date(record.createdAt).toLocaleString() : '';

        // 详情头部
        const headEl = doc.getElementById('ccore-records-detail-head');
        headEl.innerHTML = `
            <button class="ccore-records-back" title="返回列表">‹ 返回</button>
            <button class="ccore-records-nav-prev" title="上一条">‹</button>
            <span class="ccore-records-nav-counter">${record.generatorName || 'modules'} · ${charName} / ${chatName} / #${record.mesId}</span>
            <button class="ccore-records-nav-next" title="下一条">›</button>
            <span class="ccore-records-status">${statusLabel}</span>
        `;
        // 元数据行
        const metaEl = doc.getElementById('ccore-records-detail-meta');
        metaEl.innerHTML = `<span>${time}</span><span class="ccore-records-note">${record.note || ''}</span>`;

        // 操作区（pending：保存[追加/覆盖下拉] + 抛弃；已处理：无）
        const actionsEl = doc.getElementById('ccore-records-actions');
        const callbacks = buildRecordCallbacks(record);
        if (callbacks) {
            actionsEl.innerHTML = `
                <select class="ccore-records-save-mode">
                    <option value="append">追加为新版本</option>
                    <option value="overwrite">覆盖当前版本</option>
                </select>
                <button class="ccore-records-btn ccore-records-save">保存</button>
                <button class="ccore-records-btn ccore-records-discard">抛弃</button>
            `;
            actionsEl.querySelector('.ccore-records-save').addEventListener('click', async () => {
                const saveMode = actionsEl.querySelector('.ccore-records-save-mode').value;
                try { await callbacks.onSave(saveMode); } catch (e) { console.error('[Records] 保存失败', e); }
            });
            actionsEl.querySelector('.ccore-records-discard').addEventListener('click', () => {
                try { callbacks.onDiscard(); } catch (e) { console.error('[Records] 抛弃失败', e); }
            });
        } else {
            actionsEl.innerHTML = `<span class="ccore-records-readonly">${statusLabel}（只读）</span>`;
        }

        // sections（发送内容 / 完整响应 / 提取结果 / API / 错误）
        const bodyEl = doc.getElementById('ccore-records-detail-body');
        bodyEl.innerHTML = buildDetailSections(record);

        // 绑定导航
        const prevBtn = headEl.querySelector('.ccore-records-nav-prev');
        const nextBtn = headEl.querySelector('.ccore-records-nav-next');
        const backBtn = headEl.querySelector('.ccore-records-back');
        prevBtn.addEventListener('click', () => {
            const idx = state.records.findIndex(r => r.id === record.id);
            const next = state.records[(idx - 1 + state.records.length) % state.records.length];
            if (next) showDetail(next.id);
        });
        nextBtn.addEventListener('click', () => {
            const idx = state.records.findIndex(r => r.id === record.id);
            const next = state.records[(idx + 1) % state.records.length];
            if (next) showDetail(next.id);
        });
        backBtn.addEventListener('click', () => showList());

        // 视图切换
        listEl.style.display = 'none';
        detailEl.style.display = 'flex';
    };

    showList = () => {
        state.currentId = null;
        state.running = null;
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

    // 计数
    const countEl = doc.getElementById('ccore-records-count');
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
    const closeBtn = doc.getElementById('ccore-records-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            unbindPendingListener();
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
    select.innerHTML = `<option value="">${translate('ccore_history_all')}</option>` +
        options.map(o => `<option value="${o}">${o}</option>`).join('');
    if (current && options.includes(current)) select.value = current;
    else select.value = '';
}

/** 详情视图渲染运行中记录（生成中：流式刷新 + 中止按钮） */
showRunningDetail = (running) => {
    state.running = running;
    state.currentId = null;
    const { taskKey, generatorName, mesId, debugData } = running;
    if (!panelDoc) return;

    const headEl = panelDoc.getElementById('ccore-records-detail-head');
    headEl.innerHTML = `
        <button class="ccore-records-back" title="返回列表">‹ 返回</button>
        <span class="ccore-records-nav-counter">${generatorName || 'modules'} · #${mesId} · 生成中</span>
        <span class="ccore-records-status">生成中</span>
    `;
    headEl.querySelector('.ccore-records-back').addEventListener('click', () => showList());

    const metaEl = panelDoc.getElementById('ccore-records-detail-meta');
    metaEl.innerHTML = '<span>生成中…</span>';

    const actionsEl = panelDoc.getElementById('ccore-records-actions');
    actionsEl.innerHTML = `<button class="ccore-records-btn ccore-records-abort">中止生成</button>`;
    const abortBtn = actionsEl.querySelector('.ccore-records-abort');
    if (debugData?.onAbort) {
        abortBtn.addEventListener('click', () => {
            try { debugData.onAbort(); } catch (e) {}
            abortBtn.disabled = true;
            abortBtn.textContent = '已中止';
        });
    } else {
        abortBtn.disabled = true;
    }

    const bodyEl = panelDoc.getElementById('ccore-records-detail-body');
    bodyEl.innerHTML = buildDetailSections({ debugData: runningMap.get(taskKey) || debugData });

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
        if (bodyEl) bodyEl.innerHTML = buildDetailSections({ debugData: runningMap.get(taskKey) });
    }
}

/**
 * 运行中记录结束（生成完成/失败），清理 runningMap 并刷新面板。
 * @param {string} taskKey
 */
export function closeRunningRecord(taskKey) {
    runningMap.delete(taskKey);
    if (panelDoc && state.running?.taskKey === taskKey) {
        // 回到列表（或由调用方随后打开对应记录详情）
        state.running = null;
        if (typeof showList === 'function') showList();
    }
}

/** 详情 sections 渲染（与旧调试面板一致：发送内容/响应/提取/API/错误） */
function buildDetailSections(record) {
    const d = record.debugData || {};
    const sections = [];

    // 错误
    if (d.error) {
        sections.push(`<div class="ccore-records-section ccore-records-error"><div class="ccore-records-sec-title">错误</div><pre>${escapeHtml(d.error)}</pre></div>`);
    }
    // 发送内容
    if (d.sentInfo) {
        let sentReadable = '';
        const cap = d.capturedPrompt;
        if (Array.isArray(cap) && cap.length > 0) {
            sentReadable = cap.map(m => `[${m.role}${m.name ? ` (${m.name})` : ''}]\n${m.content}`).join('\n\n---\n\n');
        } else if (typeof cap === 'string' && cap) {
            sentReadable = cap;
        } else {
            sentReadable = '(未捕获到)';
        }
        sections.push(section('发送内容', sentReadable));
    }
    // 完整响应
    sections.push(section('完整响应', d.response || '(空)'));
    // 提取结果
    if (d.extracted) {
        sections.push(section('提取结果', d.extracted.modules || '(空)'));
    }
    // API 信息
    if (d.apiUsed && Object.keys(d.apiUsed).length > 0) {
        const api = d.apiUsed;
        const lines = [];
        lines.push(`类型: ${api.custom ? '独立 API' : 'ST 主 API'}`);
        if (api.model) lines.push(`模型: ${api.model}`);
        if (api.source) lines.push(`来源: ${api.source}`);
        if (api.apiurl) lines.push(`URL: ${api.apiurl}`);
        if (api.temperature !== undefined) lines.push(`温度: ${api.temperature}`);
        if (api.max_tokens) lines.push(`Max Tokens: ${api.max_tokens}`);
        sections.push(section('API 信息', lines.join('\n')));
    }
    return sections.join('');
}

function section(title, content) {
    return `<div class="ccore-records-section">
        <div class="ccore-records-sec-title">${escapeHtml(title)}</div>
        <pre>${escapeHtml(content)}</pre>
    </div>`;
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
}

export default { openGenerationRecords, updateRunningRecord, closeRunningRecord };
