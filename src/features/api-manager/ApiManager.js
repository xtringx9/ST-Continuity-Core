// src/features/api-manager/ApiManager.js
//
// API 连接管理：面板直接插到 ST「自定义端点」输入框（#custom_api_url_text）的正上方。
// - 「保存」：直接从 ST 当前正在用的连接（自定义 API URL + 当前激活密钥 api_key_custom）一键存成一条配置，无需手填。
// - 「应用」：把选中的配置填入 ST（URL → 自定义 API 输入框 + 密钥切为激活）。
// 轻量一行式：标题「API配置」+ 下拉 + 操作按钮同一行，分隔线用 ST 自带 <hr>，无折叠块。
// 不套 .inline-drawer-content（其默认 display:none 且无通用显示规则）。

import configManager from '../../singleton/configManager.js';
import { warnLog, infoLog, errorLog } from '../../utils/logger.js';
import { SECRET_KEYS, secret_state, readSecretState, rotateSecret } from '../../../../../../secrets.js';
import { uuidv4 } from '../../../../../../utils.js';
import { Popup, callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../popup.js';

// 密钥池固定为「自定义(OpenAI兼容)」——用户场景与供应商无关，只认自定义端点 + 这池密钥。
const API_KEY = SECRET_KEYS.CUSTOM;

export function isApiManagerUiPresent() {
    return !!document.getElementById('ccore-api-manager');
}

export function removeApiManager() {
    document.getElementById('ccore-api-manager')?.remove();
}

/**
 * 注入 API 连接管理面板（幂等），插到 ST「自定义端点」label（#custom_form > h4）的上方。
 * 若找不到 label 则退回插到自定义 API URL 输入框上方，再无则跳过。
 */
export async function initApiManager() {
    if (document.getElementById('ccore-api-manager')) return;

    const anchor = document.querySelector('#custom_form > h4') || document.getElementById('custom_api_url_text');
    if (!anchor) {
        warnLog('[ApiManager] 未找到 ST 自定义端点 label/输入框，跳过注入');
        return;
    }

    try {
        // 密钥态不足时先拉取（含掩码值用于展示密钥 label）
        if (!secret_state[API_KEY]) {
            await readSecretState();
        }
        anchor.insertAdjacentHTML('beforebegin', buildPanelHtml());
        bindEventListeners();
        renderPanel();
        infoLog('[API连接管理] 面板已注入到自定义端点 label 上方');
    } catch (err) {
        errorLog('[ApiManager] 初始化失败:', err);
    }
}

function buildPanelHtml() {
    // 轻量一行式：标题 + 下拉 + 操作按钮同一行，分隔线用 ST 自带 <hr>（主题色渐变，非黑色）。
    return `
    <div id="ccore-api-manager" style="width:100%;box-sizing:border-box;">
        <hr />
        <div style="display:flex;gap:6px;align-items:center;width:100%;">
            <b style="white-space:nowrap;">API配置</b>
            <select id="ccore_api_profiles" class="text_pole flex1" style="flex:1;min-width:0;" title="选择一键连接，选中即直接应用到 ST"></select>
            <i id="ccore_api_save" class="menu_button fa-solid fa-save" title="保存（读取 ST 当前连接为配置）"></i>
            <i id="ccore_api_edit" class="menu_button fa-solid fa-pen" title="编辑选中配置"></i>
            <i id="ccore_api_delete" class="menu_button fa-solid fa-trash-can" title="删除选中配置"></i>
        </div>
        <hr />
    </div>`;
}

function bindEventListeners() {
    const $ = (sel) => document.querySelector(sel);

    // 选择即应用：从下拉选中一项，直接填入 ST（无需单独「应用」按钮）
    $('#ccore_api_profiles')?.addEventListener('change', (e) => { if (e.target.value) applySelected(e.target.value); });
    $('#ccore_api_save')?.addEventListener('click', saveFromST);
    $('#ccore_api_edit')?.addEventListener('click', editSelected);
    $('#ccore_api_delete')?.addEventListener('click', deleteSelected);
}

function getProfiles() {
    return configManager.getExtensionConfig()?.stFeatureEnhance?.apiManager?.profiles || [];
}

/** 渲染配置下拉（默认不选择；重新打开时也不恢复上次选中）。 */
function renderPanel() {
    const profiles = getProfiles();
    const $profiles = document.getElementById('ccore_api_profiles');
    $profiles.innerHTML = '<option value="">— 未选择 —</option>' +
        profiles.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    $profiles.value = '';
}

/**
 * 「保存」：从 ST 当前连接一键存成配置，无需手填。
 * - URL 取自 ST 自定义 API 输入框 (#custom_api_url_text)；密钥取 api_key_custom 当前激活那条。
 * - 保存时弹「新增 / 覆盖」选择：有选中配置可覆盖，否则直接新增。
 * - 新增才弹命名框（默认 <URL 主机> · <密钥标签>，留空用默认）。
 * - 覆盖保留原配置名，只更新 URL 与密钥。
 */
async function saveFromST() {
    const urlInput = document.getElementById('custom_api_url_text');
    const url = urlInput?.value?.trim() || '';
    if (!url) {
        toastr.warning('ST 当前未设置自定义 API URL，请先在 ST 填好再用「保存」记录');
        return;
    }

    if (!secret_state[API_KEY]) {
        await readSecretState();
    }
    const active = (secret_state[API_KEY] || []).find(s => s.active);
    const secretId = active?.id || '';

    let host = '';
    try {
        host = new URL(url).host;
    } catch {
        host = url.replace(/^https?:\/\//, '').split('/')[0];
    }
    const label = active?.label || active?.value || '未关联密钥';
    const defaultName = `${host || url} · ${label}`;

    const profiles = getProfiles();
    const selectedId = document.getElementById('ccore_api_profiles')?.value || '';
    const hasSelection = selectedId && profiles.some(p => p.id === selectedId);

    // 新增 / 覆盖 选择（无选中配置时只能新增，跳过选择）
    let mode = 'new';
    if (hasSelection) {
        const wrapper = document.createElement('div');
        wrapper.style.padding = '4px 0';
        wrapper.textContent = '要把当前 ST 连接保存为？';
        const choice = await callGenericPopup(wrapper, POPUP_TYPE.CONFIRM, '', {
            okButton: '覆盖当前配置',
            cancelButton: '取消',
            customButtons: [{ text: '新增一条配置', result: POPUP_RESULT.CUSTOM1, appendAtEnd: true }],
        });
        if (choice === POPUP_RESULT.CUSTOM1) {
            mode = 'new';
        } else if (choice !== POPUP_RESULT.AFFIRMATIVE) {
            return; // 取消
        } else {
            mode = 'overwrite';
        }
    }

    let name = null;
    if (mode === 'new') {
        const nameInput = await Popup.show.input('配置名称', '留空则自动命名', defaultName);
        if (nameInput === null) return; // 取消
        name = String(nameInput).trim() || defaultName;
    }

    const cfg = configManager.getExtensionConfig();
    cfg.stFeatureEnhance ||= {};
    cfg.stFeatureEnhance.apiManager ||= { enabled: false, profiles: [], selectedProfileId: '' };
    const list = cfg.stFeatureEnhance.apiManager.profiles;

    let p;
    if (mode === 'overwrite' && hasSelection) {
        // 覆盖：保留原配置名，只更新 URL 与密钥
        p = list.find(x => x.id === selectedId);
        Object.assign(p, { apiurl: url, secretId });
    } else {
        p = { id: uuidv4(), name, apiurl: url, secretId };
        list.push(p);
    }

    cfg.stFeatureEnhance.apiManager.selectedProfileId = p.id;
    configManager.setExtensionConfig(cfg);
    renderPanel();
    toastr.success(mode === 'overwrite' ? `已更新配置「${p.name}」` : `已保存配置「${p.name}」`);
}

/**
 * 「应用」：把选中配置填入 ST——URL 写进自定义 API 输入框，关联密钥切为激活。
 * 由下拉「选择即应用」触发；此处仅应用，不改写持久化选中态。
 */
async function applySelected(id) {
    const p = getProfiles().find(x => x.id === id);
    if (!p) {
        toastr.warning('请先选择要应用的配置');
        return;
    }

    const urlInput = document.getElementById('custom_api_url_text');
    if (!urlInput) {
        toastr.error('未找到 ST 自定义 API URL 输入框 (#custom_api_url_text)');
        return;
    }
    urlInput.value = p.apiurl;
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));

    if (p.secretId) {
        try {
            await rotateSecret(API_KEY, p.secretId);
            toastr.success(`已应用「${p.name}」并切换对应密钥`);
        } catch (err) {
            errorLog('[ApiManager] 切换密钥失败:', err);
            toastr.error('已填入端点，但切换密钥失败');
        }
    } else {
        toastr.success(`已应用「${p.name}」（未关联密钥，使用当前激活密钥）`);
    }
}

function deleteSelected() {
    const id = document.getElementById('ccore_api_profiles')?.value || '';
    const profiles = getProfiles();
    const idx = profiles.findIndex(x => x.id === id);
    if (idx === -1) {
        toastr.warning('没有选中的配置');
        return;
    }
    const name = profiles[idx].name;
    profiles.splice(idx, 1);
    const cfg = configManager.getExtensionConfig();
    if (cfg.stFeatureEnhance?.apiManager?.selectedProfileId === id) {
        cfg.stFeatureEnhance.apiManager.selectedProfileId = '';
    }
    configManager.setExtensionConfig(cfg);
    document.getElementById('ccore_api_profiles').value = '';
    renderPanel();
    toastr.success(`已删除配置「${name}」`);
}

/** 生成密钥下拉的 option HTML（含当前选中项）。 */
function secretSelectHtml(selectedId) {
    const secrets = Array.isArray(secret_state[API_KEY]) ? secret_state[API_KEY] : [];
    return '<option value="">— 不关联密钥 —</option>' + secrets.map(s => {
        const star = s.active ? ' ★' : '';
        return `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${escapeHtml(s.label || s.value)} (${escapeHtml(s.value)})${star}</option>`;
    }).join('');
}

/** 编辑选中配置：名称 / 端点 URL / 关联密钥（ST 原生弹窗，label 与控件同一行）。 */
async function editSelected() {
    const id = document.getElementById('ccore_api_profiles')?.value || '';
    const p = getProfiles().find(x => x.id === id);
    if (!p) {
        toastr.warning('请先选择要编辑的配置');
        return;
    }

    const row = (html) => `<div style="display:flex;align-items:center;gap:6px;width:100%;">${html}</div>`;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    wrapper.innerHTML =
        row(`<label style="min-width:70px;">名称</label>` +
            `<input id="ccore_edit_name" class="text_pole" style="flex:1;min-width:0;" value="${escapeHtml(p.name)}" />`) +
        row(`<label style="min-width:70px;">端点 URL</label>` +
            `<input id="ccore_edit_url" class="text_pole" style="flex:1;min-width:0;" value="${escapeHtml(p.apiurl)}" />`) +
        row(`<label style="min-width:70px;">关联密钥</label>` +
            `<select id="ccore_edit_secret" class="text_pole" style="flex:1;min-width:0;">${secretSelectHtml(p.secretId || '')}</select>`);

    const result = await callGenericPopup(wrapper, POPUP_TYPE.TEXT, '', { okButton: '保存' });
    if (!result) return; // 取消

    const newName = String(wrapper.querySelector('#ccore_edit_name')?.value || '').trim() || p.name;
    const newUrl = String(wrapper.querySelector('#ccore_edit_url')?.value || '').trim();
    if (!newUrl) {
        toastr.warning('端点 URL 不能为空');
        return;
    }
    const newSecretId = String(wrapper.querySelector('#ccore_edit_secret')?.value || '');

    Object.assign(p, { name: newName, apiurl: newUrl, secretId: newSecretId });
    const cfg = configManager.getExtensionConfig();
    configManager.setExtensionConfig(cfg);
    renderPanel();
    toastr.success(`已更新配置「${newName}」`);
}

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}