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

const ROLE_OPTIONS = ['user', 'assistant', 'system'];

/**
 * 渲染异步配置页
 * @param {Document} doc iframe 文档对象
 * @param {Object} asyncConfig module_config.asyncConfig 引用（直接读写，含 customApi）
 * @param {{enabled:boolean}} asyncModule extension_config.module.asyncModule 引用（仅 enabled）
 * @param {Function} onChange 变更回调（标脏）
 */
export function renderAsyncSettings(doc, asyncConfig, asyncModule, onChange) {
    const container = doc.getElementById('view-async');
    if (!container) return;

    const customApi = asyncConfig.customApi || {};
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
                    <label>API URL:</label>
                    <input type="text" id="async-custom-api-url" value="${escapeHtml(customApi.apiurl || '')}" placeholder="https://api.openai.com/v1">
                    <label style="margin-top:8px;">API Key:</label>
                    <input type="password" id="async-custom-api-key" value="${escapeHtml(customApi.key || '')}" placeholder="sk-...">
                    <label style="margin-top:8px;">${translate('ccore_settings_fetch_models')}:</label>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <input type="text" id="async-custom-api-model" value="${escapeHtml(customApi.model || '')}" placeholder="gpt-4o-mini" style="flex:1;">
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
                        <label for="async-preset-name">${translate('ccore_settings_ai_preset')}</label>
                        <select id="async-preset-name">
                            <option value="">${translate('ccore_settings_ai_preset_default')}</option>
                            ${Object.keys(openai_setting_names || {}).map(name => `<option value="${escapeHtml(name)}" ${asyncConfig.presetName === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
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
        ca.model = container.querySelector('#async-custom-api-model').value;
        ca.source = container.querySelector('#async-custom-api-source').value;
        ca.temperature = parseFloat(container.querySelector('#async-custom-api-temperature').value) || 0.3;
        ca.max_tokens = parseInt(container.querySelector('#async-custom-api-max-tokens').value, 10) || 0;

        asyncModule.enabled = container.querySelector('#async-enabled').checked;

        onChange?.();
    };

    // 只绑定基础字段（提示词组由各组自身监听处理，避免重复标脏）
    container.querySelectorAll('#async-enabled, #async-auto-generate, #async-generation-mode, #async-preset-name, #async-raw-system-prompt, #async-raw-user-prompt, #async-use-independent-api, #async-show-debug, #async-custom-api-url, #async-custom-api-key, #async-custom-api-model, #async-custom-api-source, #async-custom-api-temperature, #async-custom-api-max-tokens').forEach(el => {
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
        const key = String(container.querySelector('#async-custom-api-key').value?.trim() || '');
        const source = String(container.querySelector('#async-custom-api-source').value || 'openai');
        if (!apiurl) {
            toastr.warning('请先填写 API URL');
            return;
        }
        const btn = container.querySelector('#async-custom-api-fetch');
        const originalText = btn.textContent;
        btn.textContent = '...';
        try {
            const base = apiurl.replace(/\/+$/, '');
            const headers = { 'Content-Type': 'application/json' };
            if (key) headers['Authorization'] = `Bearer ${key}`;
            if (source === 'claude') {
                headers['x-api-key'] = key;
                headers['anthropic-version'] = '2023-06-01';
            }
            const response = await fetch(`${base}/models`, { headers });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            let models = [];
            if (Array.isArray(data.data)) models = data.data.map(m => m.id).filter(Boolean);
            else if (Array.isArray(data.models)) models = data.models.map(m => m.id || m.name).filter(Boolean);
            if (models.length === 0) throw new Error('响应中未找到模型列表');
            const modelEl = container.querySelector('#async-custom-api-model');
            const current = modelEl.value;
            modelEl.outerHTML = `<input type="text" id="async-custom-api-model" list="async-model-list" value="${escapeHtml(current)}" style="flex:1;">` +
                `<datalist id="async-model-list">${models.map(m => `<option value="${escapeHtml(m)}">`).join('')}</datalist>`;
            toastr.success(`拉取到 ${models.length} 个模型`);
        } catch (err) {
            errorLog('[AsyncSettings] 拉取模型失败:', err);
            toastr.error(`拉取模型失败: ${err.message}`);
        } finally {
            btn.textContent = originalText;
        }
    });
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
