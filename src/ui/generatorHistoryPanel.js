// src/ui/generatorHistoryPanel.js
// 生成历史面板（2026-08-18 新增，大 Cc「生成历史」入口）。
// 通用查看所有生成记录：跨角色/聊天/楼层/状态，新→旧平铺，可筛选。
// 待处理(pending)记录可保存/抛弃；已处理记录只读可查看详情。
// 数据与详情展示内聚在 moduleAiGenerator（getAllPendingRecords / showRecordDebugPanel）。

import { IframeModal } from '../shared/IframeModal.js';
import { translate } from '../../../../../i18n.js';
import { getAllPendingRecords, getPendingCount, showRecordDebugPanel } from '../services/moduleAiGenerator.js';

const HISTORY_HTML_URL = new URL('generatorHistoryPanel.html', import.meta.url).href;

let historyModal = null;

const STATUS_LABELS = {
    pending: '待处理',
    saved: '已保存',
    discarded: '已抛弃',
    error: '失败',
};

/**
 * 打开生成历史面板（单实例）。每次打开实时渲染最新记录。
 */
export function openGeneratorHistory() {
    if (!historyModal) historyModal = new IframeModal();
    historyModal.open(HISTORY_HTML_URL, translate('ccore_history_title') || '生成历史', {
        variant: 'center',
        onLoad: (iframe) => {
            const doc = iframe.contentDocument;
            if (!doc) return;
            const theme = localStorage.getItem('st_continuity_theme') || 'light';
            doc.documentElement.setAttribute('data-theme', theme);
            const closeBtn = doc.getElementById('ccore-history-close');
            if (closeBtn) closeBtn.addEventListener('click', () => historyModal.close());
            bindHistory(doc);
        },
    });
}

function bindHistory(doc) {
    const listEl = doc.getElementById('ccore-history-list');
    if (!listEl) return;

    const genFilter = doc.getElementById('ccore-history-filter-generator');
    const charFilter = doc.getElementById('ccore-history-filter-char');
    const chatFilter = doc.getElementById('ccore-history-filter-chat');
    const floorFilter = doc.getElementById('ccore-history-filter-floor');
    const statusFilter = doc.getElementById('ccore-history-filter-status');

    const state = { gen: '', char: '', chat: '', floor: '', status: 'all' };

    const render = () => {
        const all = getAllPendingRecords();
        // 收集筛选项（generator/角色/聊天去重）
        const gens = new Set();
        const chars = new Set();
        const chats = new Set();
        all.forEach(r => {
            if (r.generatorName) gens.add(r.generatorName);
            const parts = String(r.chatKey || '').split('::');
            if (parts[0]) chars.add(parts[0]);
            if (parts[1]) chats.add(parts[1]);
        });
        fillSelect(genFilter, [...gens], state.gen);
        fillSelect(charFilter, [...chars], state.char);
        fillSelect(chatFilter, [...chats], state.chat);

        // 过滤
        const filtered = all.filter(r => {
            const parts = String(r.chatKey || '').split('::');
            const c = parts[0] || '';
            const ch = parts[1] || '';
            if (state.gen && r.generatorName !== state.gen) return false;
            if (state.char && c !== state.char) return false;
            if (state.chat && ch !== state.chat) return false;
            if (state.floor !== '' && Number(r.mesId) !== Number(state.floor)) return false;
            if (state.status !== 'all' && r.status !== state.status) return false;
            return true;
        });

        renderList(listEl, filtered);
    };

    [genFilter, charFilter, chatFilter, floorFilter, statusFilter].forEach(el => {
        if (!el) return;
        el.addEventListener('change', () => {
            state.gen = genFilter?.value || '';
            state.char = charFilter?.value || '';
            state.chat = chatFilter?.value || '';
            state.floor = floorFilter?.value || '';
            state.status = statusFilter?.value || 'all';
            render();
        });
    });

    const countEl = doc.getElementById('ccore-history-count');
    const updateCount = () => {
        if (countEl) countEl.textContent = `${translate('ccore_history_pending')}: ${getPendingCount()}`;
    };
    updateCount();

    // 记录被处理（保存/抛弃/失败）后刷新列表与计数（否则面板停留在旧状态，看起来「处理没用」）
    const onPendingChanged = () => {
        updateCount();
        render();
    };
    window.addEventListener('ccore-pending-cleared', onPendingChanged);
    // 面板关闭时移除监听（避免 iframe 重开重复累积；listener 挂在父 window）
    const closeBtn = doc.getElementById('ccore-history-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.removeEventListener('ccore-pending-cleared', onPendingChanged);
        });
    }

    render();
}

function fillSelect(select, options, current) {
    if (!select) return;
    const cur = select.value;
    select.innerHTML = `<option value="">${translate('ccore_history_all')}</option>` +
        options.map(o => `<option value="${o}">${o}</option>`).join('');
    if (current && options.includes(current)) select.value = current;
    else select.value = '';
}

function renderList(listEl, records) {
    listEl.innerHTML = '';
    if (records.length === 0) {
        listEl.innerHTML = `<div class="ccore-history-empty">${translate('ccore_history_empty')}</div>`;
        return;
    }
    records.forEach(r => {
        const parts = String(r.chatKey || '').split('::');
        const charName = parts[0] || '?';
        const chatName = parts[1] || '?';
        const statusLabel = STATUS_LABELS[r.status] || r.status;
        const time = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';

        const card = document.createElement('div');
        card.className = `ccore-history-card ccore-history-${r.status}`;
        card.innerHTML = `
            <div class="ccore-history-card-head">
                <span class="ccore-history-status">${statusLabel}</span>
                <span class="ccore-history-meta">${charName} / ${chatName} / #${r.mesId}</span>
                <span class="ccore-history-time">${time}</span>
            </div>
            <div class="ccore-history-card-body">
                <span class="ccore-history-gen">${r.generatorName || 'modules'}</span>
                ${r.note ? `<span class="ccore-history-note">${r.note}</span>` : ''}
            </div>
        `;
        card.addEventListener('click', () => showRecordDebugPanel(r));
        listEl.appendChild(card);
    });
}

export default { openGeneratorHistory };
