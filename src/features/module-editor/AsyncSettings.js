// src/features/module-editor/AsyncSettings.js
// 异步生成配置页（view-async）。
// 2026-08-17 迁移：承接原 settings-panel「异步存储」tab 的配置 UI。
// 2026-08-18 重构：
//   - 去掉「追加指令」与「默认生成提示词」字段，只留提示词组；默认生成提示词 = 设为默认的提示词组
//   - 开关即自解释，不附带说明文案
//   - 「生成完成弹出面板手动确认」替代原「生成后显示调试面板」
//   - 暂隐藏：生成指令作为最后 user 消息 / 生成前询问提示词（保留配置）；去掉补末尾消息角色（提示词组 role 承担）
// 数据来源：
//   - asyncConfig：module_config.asyncConfig（与 globalSettings/modules 平级），本页主体
//   - asyncModule：extension_config.module.asyncModule，仅 enabled / customApi（其余已迁出）
// 渲染模式与 GlobalSettings 一致：直接操作传入引用，change 时回调 onChange 标脏。

import { translate } from '../../../../../../i18n.js';
import { openai_setting_names } from '../../../../../../openai.js';
import { errorLog } from '../../utils/logger.js';
import { showToast } from '../../shared/Toast.js';
import configManager from '../../singleton/configManager.js';
import { SECRET_KEYS, secret_state, readSecretState, rotateSecret } from '../../../../../../secrets.js';
import { getRequestHeaders } from '../../../../../../../script.js';

// 方案 B（2026-08-26）：secretId 拉取模型走 ST 服务端 status（readSecret(CUSTOM) 读激活密钥），
// 临时激活目标密钥、用毕还原，避免浏览器接触密钥原文与长期改变全局激活。
async function _transientlyActivateSecret(secretId) {
    if (!secretId) return null;
    try {
        if (!secret_state[SECRET_KEYS.CUSTOM]) {
            await readSecretState();
        }
        const prior = (secret_state[SECRET_KEYS.CUSTOM] || []).find(s => s && s.active);
        const priorId = prior?.id || null;
        await rotateSecret(SECRET_KEYS.CUSTOM, secretId);
        return priorId;
    } catch (e) {
        errorLog('[AsyncSettings] 临时激活 secretId 失败:', e);
        return null;
    }
}

const ROLE_OPTIONS = ['user', 'assistant', 'system'];

// 实时同步：主设置面板切换「API连接管理」开关时，本模块据此重渲染异步 tab。
// ⚠️ 注意：module-editor 是 iframe(src 模式，内无 <script>)，本模块 JS 在主窗口上下文执行，
//    故监听主窗口的 CustomEvent 而非 iframe 的 postMessage message 事件。
let _renderCtx = { doc: null, asyncConfig: null, asyncModule: null, onChange: null };
let _apiManagerMsgBound = false;

function _bindApiManagerMessageListener() {
    if (_apiManagerMsgBound) return;
    _apiManagerMsgBound = true;
    window.addEventListener('ccore:api-manager-changed', () => {
        const ctx = _renderCtx;
        if (!ctx || !ctx.doc || !ctx.doc.getElementById('view-async')) return;
        try {
            renderAsyncSettings(ctx.doc, ctx.asyncConfig, ctx.asyncModule, ctx.onChange);
        } catch (err) {
            errorLog('[AsyncSettings] 根据 API连接管理开关重渲染失败:', err);
        }
    });
}

/**
 * 渲染异步配置页
 * @param {Document} doc iframe 文档对象
 * @param {Object} asyncConfig module_config.asyncConfig 引用（直接读写，含 customApi）
 * @param {{enabled:boolean}} asyncModule extension_config.module.asyncModule 引用（仅 enabled）
 * @param {Function} onChange 变更回调（标脏）
 */
export function renderAsyncSettings(doc, asyncConfig, asyncModule, onChange) {
    // 记录渲染上下文 + 绑定一次性消息监听（供 api-manager 开关实时重渲染）
    _renderCtx = { doc, asyncConfig, asyncModule, onChange };
    _bindApiManagerMessageListener();

    const container = doc.getElementById('view-async');
    if (!container) return;

    const customApi = asyncConfig.customApi || {};
    // ⚠️ 2026-08-26 「从 API 配置应用」：仅在 api-manager 功能启用且存在配置时显示该控件
    const apiManagerEnabled = configManager.isApiManagerEnabled();
    const apiProfiles = (configManager.getExtensionConfig()?.stFeatureEnhance?.apiManager?.profiles || []).filter(p => p && p.id);
    const apiProfileOptions = apiManagerEnabled
        ? `<select id="async-api-profile" class="text_pole" style="width:100%;">
                <option value="">${translate('ccore_async_api_profile_ph')}</option>
                ${apiProfiles.map(p => `<option value="${p.id}">${escapeHtml(p.name || p.id)}</option>`).join('')}
           </select>`
        : '';
    container.innerHTML = `
        <div class="detail-content">
            <div class="settings-container async-settings">

                <!-- 异步模块存储：整体功能主开关（显眼滑块样式） -->
                <div class="async-master-row">
                    <div class="async-master-text">
                        <span class="async-master-title">${translate('ccore_settings_async_enabled')}</span>
                    </div>
                    <label class="toggle-switch async-master-switch">
                        <input type="checkbox" id="async-enabled" ${asyncModule.enabled ? 'checked' : ''}>
                        <span class="slider round"></span>
                    </label>
                </div>

                <div class="form-section-title">${translate('ccore_async_prompt_groups_title')}</div>
                <div class="form-group form-full-width">
                    <div class="async-group-hint">${translate('ccore_async_prompt_group_default_hint')}</div>
                    <div id="async-prompt-groups"></div>
                    <button type="button" id="async-prompt-group-add" class="btn-secondary">${translate('ccore_async_prompt_group_add')}</button>
                </div>

                <div class="form-section-title">${translate('ccore_settings_custom_api_summary')}</div>
                <div class="form-group form-full-width">
                    <label class="async-toggle">
                        <input type="checkbox" id="async-use-independent-api" ${asyncConfig.useIndependentApi ? 'checked' : ''}>
                        <span>${translate('ccore_settings_use_independent_api')}</span>
                    </label>
                </div>
                <div class="form-group form-full-width" id="async-custom-api-block" style="display:none;">
                    ${apiManagerEnabled && apiProfiles.length > 0 ? `
                    <div id="async-api-profile-apply" class="form-group form-full-width">
                        <label>${translate('ccore_async_api_profile_label')}</label>
                        ${apiProfileOptions}
                    </div>
                    <label style="margin-top:8px;">API URL:</label>` : `
                    <label>API URL:</label>`}
                    <input type="text" id="async-custom-api-url" value="${escapeHtml(customApi.apiurl || '')}" placeholder="https://api.openai.com/v1">
                    <label style="margin-top:8px;">API Key:</label>
                    <input type="password" id="async-custom-api-key" value="${escapeHtml(customApi.key || '')}" placeholder="sk-...">
                    <label style="margin-top:8px;">${translate('ccore_settings_fetch_models')}:</label>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <select id="async-custom-api-model" style="flex:1;"></select>
                        <input type="text" id="async-custom-api-model-custom" value="${escapeHtml(customApi.model || '')}" placeholder="${translate('ccore_settings_custom_api_model_manual')}" style="flex:1; display:none;">
                        <button type="button" id="async-custom-api-fetch" class="btn-secondary">${translate('ccore_settings_fetch_models')}</button>
                    </div>
                    <label style="margin-top:8px;">${translate('ccore_settings_custom_api_source')}:</label>
                    <select id="async-custom-api-source">
                        <option value="openai" ${customApi.source === 'claude' || customApi.source === 'custom' ? '' : 'selected'}>OpenAI</option>
                        <option value="claude" ${customApi.source === 'claude' ? 'selected' : ''}>Claude</option>
                        <option value="custom" ${customApi.source === 'custom' ? 'selected' : ''}>Custom</option>
                    </select>
                    <div class="form-grid" style="margin-top:8px;">
                        <div class="form-group">
                            <label>Temperature:</label>
                            <input type="number" id="async-custom-api-temperature" min="0" max="2" step="0.1" value="${customApi.temperature ?? 0.3}">
                        </div>
                        <div class="form-group">
                            <label>Max Tokens:</label>
                            <input type="number" id="async-custom-api-max-tokens" min="1" max="32000" value="${customApi.max_tokens ?? 500}">
                        </div>
                    </div>
                </div>

                <div class="form-section-title">${translate('ccore_async_behavior_title')}</div>
                <div class="form-grid async-behavior-grid">
                    <div class="async-inline-field">
                        <label for="async-generation-mode">${translate('ccore_settings_generation_mode')}</label>
                        <select id="async-generation-mode">
                            <option value="pipeline" ${asyncConfig.generationMode !== 'raw' ? 'selected' : ''}>${translate('ccore_option_pipeline')}</option>
                            <option value="raw" ${asyncConfig.generationMode === 'raw' ? 'selected' : ''}>${translate('ccore_option_raw')}</option>
                        </select>
                    </div>
                    <div class="async-inline-field">
                        <label for="async-preset-name">${translate('ccore_settings_generation_preset')}</label>
                        <select id="async-preset-name">
                            <option value="">${translate('ccore_settings_ai_preset_default')}</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="async-toggle">
                            <input type="checkbox" id="async-auto-generate" ${asyncConfig.autoGenerateOnMessageEnd !== false ? 'checked' : ''}>
                            <span>${translate('ccore_settings_auto_generate_on_message_end')}</span>
                        </label>
                    </div>
                    <div class="form-group">
                        <label class="async-toggle">
                            <input type="checkbox" id="async-show-debug" ${asyncConfig.showDebug !== false ? 'checked' : ''}>
                            <span>${translate('ccore_settings_show_debug')}</span>
                        </label>
                    </div>
                </div>
                <div class="form-group form-full-width" id="async-raw-block" style="display:none;">
                    <label>${translate('ccore_settings_raw_system_prompt')}</label>
                    <textarea id="async-raw-system-prompt" rows="3">${escapeHtml(asyncConfig.rawSystemPrompt || '')}</textarea>
                    <label style="margin-top:8px;">${translate('ccore_settings_raw_user_prompt')}</label>
                    <textarea id="async-raw-user-prompt" rows="2">${escapeHtml(asyncConfig.rawUserPromptTemplate || '')}</textarea>
                </div>

                <div class="spacer-bottom"></div>
            </div>
        </div>
    `;

    // === 提示词组渲染 ===
    // 每组：第一行 [默认✓] [简名] [消息角色] [✕删除]，第二行 提示词输入框
    // 只有一组时自动设为默认（与 normalizeAsyncConfig 一致）
    const groupsEl = container.querySelector('#async-prompt-groups');
    const renderGroups = () => {
        const groupArr = Array.isArray(asyncConfig.promptGroups) ? asyncConfig.promptGroups : [];
        if (groupArr.length === 1) groupArr[0].isDefault = true;
        groupsEl.innerHTML = '';
        groupArr.forEach((g, i) => {
            const card = doc.createElement('div');
            card.className = 'async-group-card';
            card.innerHTML = `
                <div class="async-group-head">
                    <label class="async-group-default">
                        <input type="checkbox" class="pg-default" ${g.isDefault ? 'checked' : ''} ${groupArr.length === 1 ? 'disabled' : ''}>
                        <span>${translate('ccore_async_prompt_group_default')}</span>
                    </label>
                    <input type="text" class="pg-name" value="${escapeHtml(g.name)}" placeholder="${translate('ccore_async_prompt_group_name_ph')}">
                    <select class="pg-role">
                        ${ROLE_OPTIONS.map(r => `<option value="${r}" ${(g.role || 'user') === r ? 'selected' : ''}>${r}</option>`).join('')}
                    </select>
                    <button type="button" class="pg-del" title="${translate('ccore_async_prompt_group_del')}">✕</button>
                </div>
                <textarea class="pg-prompt" rows="2" placeholder="${translate('ccore_async_prompt_group_prompt_ph')}">${escapeHtml(g.prompt)}</textarea>
            `;
            // 设为默认：同组内互斥（只保留一个默认）
            card.querySelector('.pg-default').addEventListener('change', (e) => {
                const checked = e.target.checked;
                if (checked) {
                    asyncConfig.promptGroups.forEach(x => { x.isDefault = false; });
                    g.isDefault = true;
                } else {
                    g.isDefault = false;
                }
                renderGroups();
                onChange?.();
            });
            card.querySelector('.pg-name').addEventListener('input', (e) => { g.name = e.target.value; onChange?.(); });
            card.querySelector('.pg-role').addEventListener('change', (e) => { g.role = e.target.value; onChange?.(); });
            card.querySelector('.pg-prompt').addEventListener('input', (e) => { g.prompt = e.target.value; onChange?.(); });
            card.querySelector('.pg-del').addEventListener('click', () => {
                asyncConfig.promptGroups.splice(i, 1);
                renderGroups();
                onChange?.();
            });
            groupsEl.appendChild(card);
        });
    };
    renderGroups();

    container.querySelector('#async-prompt-group-add').addEventListener('click', () => {
        if (!Array.isArray(asyncConfig.promptGroups)) asyncConfig.promptGroups = [];
        asyncConfig.promptGroups.push({ id: `pg_${Date.now()}`, name: '', role: 'user', prompt: '', isDefault: false });
        renderGroups();
        onChange?.();
    });

    // === 生成预设下拉：点击/聚焦时实时读取 ST 当前预设列表（openai_setting_names 为实时同步的引用） ===
    const presetSel = container.querySelector('#async-preset-name');
    const renderPresetOptions = () => {
        const prev = presetSel.value;
        const names = Object.keys(openai_setting_names || {});
        presetSel.innerHTML = '<option value="">' + translate('ccore_settings_ai_preset_default') + '</option>'
            + names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        // 原选中项若仍在列表中则保留，否则回落到默认
        presetSel.value = prev && names.includes(prev) ? prev : '';
    };
    presetSel.addEventListener('focus', renderPresetOptions);
    // 先按当前配置回填一次，保证初始展示正确
    renderPresetOptions();
    if (asyncConfig.presetName && Object.keys(openai_setting_names || {}).includes(asyncConfig.presetName)) {
        presetSel.value = asyncConfig.presetName;
    }

    // === 模型下拉：select + 「手动输入」 兜底 ===
    const modelSel = container.querySelector('#async-custom-api-model');
    const modelCustom = container.querySelector('#async-custom-api-model-custom');
    const MANUAL = '__manual__';
    let fetchedModels = []; // 本次拉取到的模型清单（渲染期内缓存，避免重复劫持）
    const syncModelCustomVisibility = () => {
        modelCustom.style.display = modelSel.value === MANUAL ? '' : 'none';
    };
    const currentModel = String(customApi.model || '').trim();
    // 初始渲染：选项 = [手动输入, 已存模型…]；已存模型在列表中则选中，否则保持「手动输入」
    const renderModelOptions = () => {
        const values = new Set(fetchedModels);
        // 未拉取时把已存模型也列入选项（通常就是那个用户手填的模型），方便直接看到/选中
        if (!fetchedModels.length && currentModel && !values.has(currentModel)) values.add(currentModel);
        const html = [`<option value="${MANUAL}">${translate('ccore_settings_custom_api_model_manual')}</option>`]
            + [...values].map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
        modelSel.innerHTML = html;
        // 已存模型存在且不是手动输入 → 选中它；否则落到手动输入并回填自定义框
        if (currentModel && !fetchedModels.length) {
            modelSel.value = currentModel; // 但 currentModel 已被加入 values，可选中
        } else if (currentModel && fetchedModels.includes(currentModel)) {
            modelSel.value = currentModel;
        } else {
            modelSel.value = MANUAL;
            syncModelCustomVisibility();
        }
        syncModelCustomVisibility();
    };
    renderModelOptions();

    // === 从 API 配置应用（api-manager 打通；仅开启且存在配置时页面才有此元素） ===
    const profileSel = container.querySelector('#async-api-profile');
    const renderProfileState = () => {
        if (!profileSel) return;
        const secretId = String(customApi.secretId || '');
        if (secretId) {
            const match = apiProfiles.find(x => x.secretId && x.secretId === secretId);
            profileSel.value = match ? match.id : '';
        } else {
            profileSel.value = '';
        }
    };
    if (profileSel) {
        const applyProfile = (id) => {
            const p = apiProfiles.find(x => x.id === id);
            if (!p) { renderProfileState(); return; }
            customApi.apiurl = p.apiurl || '';
            customApi.secretId = p.secretId || ''; // 密钥双轨互斥：写入 secretId 即清空明文 key
            customApi.key = '';
            customApi.source = 'custom'; // secretId 通道强制走 ST 服务端 CUSTOM（source=custom）
            const urlInput = container.querySelector('#async-custom-api-url');
            const keyInput = container.querySelector('#async-custom-api-key');
            const sourceSel = container.querySelector('#async-custom-api-source');
            if (urlInput) urlInput.value = customApi.apiurl;
            if (keyInput) keyInput.value = '';
            if (sourceSel) sourceSel.value = 'custom';
            renderProfileState();
            showToast(`已应用独立 API 配置：「${p.name || p.id}」`, 'success');
            onChange?.();
        };
        profileSel.addEventListener('change', (e) => applyProfile(e.target.value));
    }
    renderProfileState();

    // === 联动显隐：raw 显示 raw 配置块；独立 API 开关显示 customApi 配置块；preset 仅 pipeline 有效 ===
    const updateModeVisibility = () => {
        const mode = container.querySelector('#async-generation-mode').value;
        container.querySelector('#async-raw-block').style.display = mode === 'raw' ? '' : 'none';
        // ST OpenAI 预设只在 pipeline 组装时有效（raw 模式不组装），raw 时隐藏
        const presetField = container.querySelector('#async-preset-name')?.closest('.async-inline-field');
        if (presetField) presetField.style.display = mode === 'raw' ? 'none' : '';
        const useApi = container.querySelector('#async-use-independent-api').checked;
        container.querySelector('#async-custom-api-block').style.display = useApi ? '' : 'none';
    };

    // === 变更收集 ===
    const collect = () => {
        asyncConfig.generationMode = container.querySelector('#async-generation-mode').value;
        asyncConfig.presetName = container.querySelector('#async-preset-name').value;
        asyncConfig.autoGenerateOnMessageEnd = container.querySelector('#async-auto-generate').checked;
        asyncConfig.rawSystemPrompt = container.querySelector('#async-raw-system-prompt').value;
        asyncConfig.rawUserPromptTemplate = container.querySelector('#async-raw-user-prompt').value;
        asyncConfig.useIndependentApi = container.querySelector('#async-use-independent-api').checked;
        asyncConfig.showDebug = container.querySelector('#async-show-debug').checked;

        const ca = asyncConfig.customApi = asyncConfig.customApi || {};
        ca.apiurl = container.querySelector('#async-custom-api-url').value;
        ca.key = container.querySelector('#async-custom-api-key').value;
        // 密钥双轨互斥：手动填入明文 key 即撤销 secretId 引用（与「从 API 配置应用」相反方向）
        if (ca.key) ca.secretId = '';
        // 模型：select 选中「手动输入」时读自定义输入框，否则读下拉值
        const modelSel = container.querySelector('#async-custom-api-model');
        const modelCustom = container.querySelector('#async-custom-api-model-custom');
        ca.model = modelSel.value === '__manual__' ? modelCustom.value.trim() : modelSel.value;
        ca.source = container.querySelector('#async-custom-api-source').value;
        ca.temperature = parseFloat(container.querySelector('#async-custom-api-temperature').value) || 0.3;
        ca.max_tokens = parseInt(container.querySelector('#async-custom-api-max-tokens').value, 10) || 0;

        asyncModule.enabled = container.querySelector('#async-enabled').checked;

        onChange?.();
    };

    // 只绑定基础字段（提示词组由各组自身监听处理，避免重复标脏）
    container.querySelectorAll('#async-enabled, #async-auto-generate, #async-generation-mode, #async-preset-name, #async-raw-system-prompt, #async-raw-user-prompt, #async-use-independent-api, #async-show-debug, #async-custom-api-url, #async-custom-api-key, #async-custom-api-source, #async-custom-api-temperature, #async-custom-api-max-tokens').forEach(el => {
        el.addEventListener('input', collect);
        el.addEventListener('change', () => {
            collect();
            updateModeVisibility();
        });
    });
    updateModeVisibility();

    // === 拉取模型（OpenAI 兼容 /models）===
    container.querySelector('#async-custom-api-fetch').addEventListener('click', async () => {
        const apiurl = String(container.querySelector('#async-custom-api-url').value?.trim() || '');
        const source = String(container.querySelector('#async-custom-api-source').value || 'openai');
        if (!apiurl) {
            showToast('请先填写 API URL', 'warning');
            return;
        }
        const btn = container.querySelector('#async-custom-api-fetch');
        const originalText = btn.textContent;
        btn.textContent = '...';
        try {
            let models = [];
            const plainKey = String(container.querySelector('#async-custom-api-key').value?.trim() || '');
            if (plainKey) {
                // 明文 key：直接客户端请求（保持原行为）
                const base = apiurl.replace(/\/+$/, '');
                const headers = { 'Content-Type': 'application/json' };
                headers['Authorization'] = `Bearer ${plainKey}`;
                if (source === 'claude') {
                    headers['x-api-key'] = plainKey;
                    headers['anthropic-version'] = '2023-06-01';
                }
                const response = await fetch(`${base}/models`, { headers });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (Array.isArray(data.data)) models = data.data.map(m => m.id).filter(Boolean);
                else if (Array.isArray(data.models)) models = data.models.map(m => m.id || m.name).filter(Boolean);
            } else if (customApi.secretId) {
                // secretId：临时激活 → ST 服务端 /status（source=custom，服务端 readSecret(CUSTOM)）→ 还原
                const prev = await _transientlyActivateSecret(customApi.secretId);
                try {
                    const statusResp = await fetch('/api/backends/chat-completions/status', {
                        method: 'POST',
                        headers: getRequestHeaders(),
                        body: JSON.stringify({ chat_completion_source: 'custom', custom_url: apiurl }),
                    });
                    if (!statusResp.ok) throw new Error(`HTTP ${statusResp.status}`);
                    const data = await statusResp.json();
                    if (Array.isArray(data?.data)) models = data.data.map(m => m.id).filter(Boolean);
                    else if (Array.isArray(data?.models)) models = data.models.map(m => m.id || m.name).filter(Boolean);
                } finally {
                    if (prev) { try { await rotateSecret(SECRET_KEYS.CUSTOM, prev); } catch (e) { /* 忽略还原失败 */ } }
                }
            } else {
                showToast('未配置密钥（明文 key 为空且无 secretId）', 'warning');
                return;
            }
            if (models.length === 0) throw new Error('响应中未找到模型列表');
            // 按下拉显示名排序（不区分大小写字母序）
            models.sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));
            fetchedModels = models;
            const prev = modelSel.value === MANUAL ? modelCustom.value.trim() : modelSel.value;
            renderModelOptions();
            if (fetchedModels.includes(prev)) {
                modelSel.value = prev;
            } else if (prev) {
                modelSel.value = MANUAL;
                modelCustom.value = prev;
            }
            syncModelCustomVisibility();
            showToast(`拉取到 ${models.length} 个模型`, 'success');
        } catch (err) {
            errorLog('[AsyncSettings] 拉取模型失败:', err);
            showToast(`拉取模型失败: ${err.message}`, 'error');
        } finally {
            btn.textContent = originalText;
        }
    });

    // select 切换「手动输入」时同步自定义框显隐；option 变化走底部通用绑定触发 collect
    modelSel.addEventListener('change', () => {
        syncModelCustomVisibility();
        collect();
        updateModeVisibility();
    });
    modelCustom.addEventListener('input', collect);
}

/** 简单 HTML 转义（防注入） */
function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
