// 提示词预设·保存时条目差异提示
// 捕获阶段（capture）拦截 #update_oai_preset 的 click：先于 ST 原生冒泡 handler 执行，
// 在 ST 写盘前取「旧值」（openai_settings[idx]，磁盘镜像）与「新值」（oai_settings，当前编辑态）做 diff，
// 仅比对条目（prompts 增删改 + prompt_order 顺序/启用），保存后以提示条显示变动条数 + 变动条目名（含变动类型），
// 让用户察觉「预设被意外覆盖保存」。不拦截、不修改 ST 保存流程，纯只读 + 提示。

import { oai_settings, openai_settings, openai_setting_names } from '../../../../../../openai.js';
import configManager from '../../singleton/configManager.js';
import { showToast } from '../../shared/Toast.js';
import { errorLog } from '../../utils/logger.js';

let captureBound = false;

/**
 * 注册捕获阶段拦截（配置门控）。仅当 stFeatureEnhance.presetSaveDiff.enabled === true 时生效。
 */
export function initPresetSaveDiff() {
    if (configManager.getStFeatureEnhanceConfig().presetSaveDiff?.enabled !== true) return;
    if (captureBound) return;
    captureBound = true;
    document.addEventListener('click', onSaveClickCapture, true);
}

export function removePresetSaveDiff() {
    if (!captureBound) return;
    captureBound = false;
    document.removeEventListener('click', onSaveClickCapture, true);
}

function onSaveClickCapture(e) {
    if (!e.target) return;
    const btn = (e.target.id === 'update_oai_preset')
        ? e.target
        : (e.target.closest ? e.target.closest('#update_oai_preset') : null);
    if (!btn) return;
    try {
        handleSave();
    } catch (err) {
        errorLog('[PRESET-SAVE-DIFF] 比对失败', err);
    }
}

function handleSave() {
    const name = oai_settings?.preset_settings_openai;
    // 「Default」(gui) 等非自定义预设无磁盘条目可比对，跳过
    if (!name || name === 'Default' || name === 'gui') return;
    const idx = openai_setting_names?.[name];
    if (idx === undefined || !openai_settings?.[idx]) return;

    // 捕获阶段同步计算 diff（此刻 openai_settings[idx] 仍是保存前的旧值）
    const oldPreset = openai_settings[idx];
    const newPreset = oai_settings;
    const r = diffPreset(oldPreset, newPreset);

    const label = `预设「${name}」已保存`;
    if (!r.changed) {
        // 延迟到 ST 保存 handler 之后，保证提示出现在「保存动作完成」语义下
        setTimeout(() => showToast(`${label}（无条目变化）`, 'info', 'auto'), 0);
        return;
    }

    const parts = [];
    if (r.added) parts.push(`+${r.added} 新增`);
    if (r.removed) parts.push(`-${r.removed} 删除`);
    if (r.modified) parts.push(`~${r.modified} 修改`);
    if (r.orderChanged) parts.push(`顺序 ${r.orderChanged} 项`);
    if (r.enabledOn) parts.push(`启用 ${r.enabledOn} 项`);
    if (r.disabledOff) parts.push(`禁用 ${r.disabledOff} 项`);
    let msg = `${label}：${parts.join(' / ')}`;

    // 变动条目名 + 其参与的变动类型（同一项可能同时「修改」+「启用」，均标注）
    const entries = [...r.changes.values()];
    if (entries.length) {
        const MAX = 12;
        const listed = entries.slice(0, MAX).map(e => `${e.name}(${[...e.types].join('、')})`);
        const more = entries.length > MAX ? `\n　等 ${entries.length} 项` : '';
        msg += `\n变动：` + listed.map(n => `\n　${n}`).join('') + more;
    }
    setTimeout(() => showToast(msg, 'info', 'auto'), 0);
}

function diffPreset(oldP, newP) {
    const r = {
        added: 0, removed: 0, modified: 0, orderChanged: 0,
        enabledOn: 0, disabledOff: 0, changed: false,
        // id -> { name, types:Set }，按条目聚合其参与的变动类型
        changes: new Map(),
    };

    const oldPrompts = toPromptMap(oldP?.prompts);
    const newPrompts = toPromptMap(newP?.prompts);
    const nameOf = (id) => (newPrompts[id]?.name || oldPrompts[id]?.name || id);
    const oldIds = new Set(Object.keys(oldPrompts));
    const newIds = new Set(Object.keys(newPrompts));

    const mark = (id, type) => {
        if (!r.changes.has(id)) r.changes.set(id, { name: nameOf(id), types: new Set() });
        r.changes.get(id).types.add(type);
    };

    // —— prompts（条目定义数组，键=identifier）——
    for (const id of newIds) {
        if (!oldIds.has(id)) { r.added++; mark(id, '新增'); }
        else if (!promptEqual(oldPrompts[id], newPrompts[id])) { r.modified++; mark(id, '修改'); }
    }
    for (const id of oldIds) {
        if (!newIds.has(id)) { r.removed++; mark(id, '删除'); }
    }

    // —— prompt_order（按角色：[{ character_id, order:[{identifier,enabled}] }]）——
    const oldOrders = toOrderMap(oldP?.prompt_order);
    const newOrders = toOrderMap(newP?.prompt_order);
    const chars = new Set([...oldOrders.keys(), ...newOrders.keys()]);
    for (const cid of chars) {
        const o = oldOrders.get(cid) || [];
        const n = newOrders.get(cid) || [];
        const oSeq = o.map(e => e.identifier).join('>');
        const nSeq = n.map(e => e.identifier).join('>');
        if (oSeq !== nSeq) {
            const res = countOrderDiff(o, n);
            r.orderChanged += res.count;
            // 顺序变化标注到具体条目（仅新旧 prompts 均存在者）
            for (const id of res.ids) {
                if (oldIds.has(id) && newIds.has(id)) mark(id, '顺序');
            }
        }
        // 启用状态变化：仅统计「旧、新 order 中均存在」的条目（排除增删条目的 order 出现造成的误算）
        const oEn = new Map(o.map(e => [e.identifier, e.enabled]));
        const nEn = new Map(n.map(e => [e.identifier, e.enabled]));
        const ids = new Set([...oEn.keys(), ...nEn.keys()]);
        for (const id of ids) {
            if (!oldIds.has(id) || !newIds.has(id)) continue; // 增删已在 prompts 体现，不重复计入
            const ov = oEn.get(id);
            const nv = nEn.get(id);
            if (ov === nv) continue;
            // 区分「被启用」(→true) 与「被禁用」(→false)：被禁用不再算进「启用」计数
            if (nv === true) { r.enabledOn++; mark(id, '启用'); }
            else { r.disabledOff++; mark(id, '禁用'); }
        }
    }

    r.changed = !!(r.added || r.removed || r.modified || r.orderChanged || r.enabledOn || r.disabledOff);
    return r;
}

function toPromptMap(arr) {
    const m = {};
    if (Array.isArray(arr)) {
        for (const p of arr) {
            const id = p?.identifier;
            if (id != null) m[id] = p;
        }
    }
    return m;
}

function promptEqual(a, b) {
    return (a?.name || '') === (b?.name || '') && (a?.content || '') === (b?.content || '');
}

function toOrderMap(arr) {
    const m = new Map();
    if (Array.isArray(arr)) {
        for (const o of arr) {
            const cid = o?.character_id;
            if (cid != null) m.set(String(cid), Array.isArray(o.order) ? o.order : []);
        }
    }
    return m;
}

// 顺序变动条目：标识符集合相同才计为顺序变化（增删已在 prompts 体现）；返回 {count, ids}
function countOrderDiff(o, n) {
    const oIds = o.map(e => e.identifier).sort();
    const nIds = n.map(e => e.identifier).sort();
    if (JSON.stringify(oIds) !== JSON.stringify(nIds)) return { count: 0, ids: [] };
    const oIndex = new Map(o.map((e, i) => [e.identifier, i]));
    const nIndex = new Map(n.map((e, i) => [e.identifier, i]));
    let c = 0;
    const ids = [];
    for (const id of oIds) {
        if (oIndex.get(id) !== nIndex.get(id)) { c++; ids.push(id); }
    }
    return { count: c, ids };
}
