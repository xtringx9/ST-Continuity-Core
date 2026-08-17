import { translate } from '../../../../../../i18n.js';

/** 三态模式标签（全局设置 UI 用） */
const PROMPT_MODE_LABELS = [
    { key: 'sync', labelKey: 'ccore_option_async_sync' },
    { key: 'async-body', labelKey: 'ccore_option_async_body' },
    { key: 'async-alone', labelKey: 'ccore_option_async_alone' },
];

/**
 * 渲染「三态 × 前置/后置」提示词编辑区（分组卡片）。
 * 结构：可点击的组标题（label，点击展开/折叠三态填写区）+ 三态各一组前置/后置 textarea。
 * 默认折叠；组之间分隔线。
 * @param {string} idPrefix 元素 id 前缀（唯一）
 * @param {string} title 提示词标题（已翻译，如「{{CONTINUITY_PROMPT}}提示词」）
 * @param {Object} value 三态×前后置对象 { sync:{pre,post}, 'async-body':{pre,post}, 'async-alone':{pre,post} }
 * @returns {string} HTML
 */
function renderTristatePromptEditor(idPrefix, title, value) {
    const groups = PROMPT_MODE_LABELS.map(mode => {
        const part = (value && value[mode.key]) || { pre: '', post: '' };
        const preVal = (typeof part === 'string' ? part : part.pre || '');
        const postVal = (typeof part === 'string' ? '' : part.post || '');
        return `
            <div class="form-group tristate-mode-group">
                <label class="tristate-mode-label">${translate(mode.labelKey)}</label>
                <label class="tristate-pre-label">${translate('ccore_label_prompt_pre')}</label>
                <textarea id="${idPrefix}-${mode.key}-pre" rows="2" placeholder="${translate('ccore_placeholder_global_prompt_pre')}">${preVal}</textarea>
                <label class="tristate-post-label">${translate('ccore_label_prompt_post')}</label>
                <textarea id="${idPrefix}-${mode.key}-post" rows="2" placeholder="${translate('ccore_placeholder_global_prompt_post')}">${postVal}</textarea>
            </div>
        `;
    }).join('');

    return `
        <div class="form-group form-full-width tristate-prompt-card">
            <div class="tristate-prompt-header" data-tristate-toggle="${idPrefix}" title="${translate('ccore_title_tristate_prompt')}">
                <span class="tristate-prompt-title">${title}</span>
                <span class="tristate-prompt-caret">▸</span>
            </div>
            <div class="tristate-prompt-body" data-tristate-body="${idPrefix}" style="display:none;">
                ${groups}
            </div>
        </div>
    `;
}

/**
 * 渲染全局设置界面
 * @param {Document} doc Iframe文档对象
 * @param {Object} settings 当前全局设置对象 (引用)
 * @param {Function} onChange 设置变更时的回调函数
 */
export function renderGlobalSettings(doc, settings, onChange) {
    const container = doc.getElementById('view-settings');
    if (!container) return;

    container.innerHTML = `
        <div class="detail-content">
            <div class="settings-container">
                <div class="form-section-title">${translate('ccore_title_tag_settings')}</div>
                
                <div class="form-grid">
                    <div class="form-group">
                        <label>${translate('ccore_label_global_module_tag')}</label>
                        <input type="text" id="global-module-tag" value="${settings.moduleTag || 'module'}" placeholder="${translate('ccore_placeholder_default_module')}">
                    </div>
                    <div class="form-group">
                        <label>${translate('ccore_label_global_module_update_tag')}</label>
                        <input type="text" id="global-module-update-tag" value="${settings.moduleUpdateTag || 'module_update'}" placeholder="${translate('ccore_placeholder_default_module_update')}">
                    </div>
                    <div class="form-group">
                        <label>${translate('ccore_label_global_compatible_module_tags')}</label>
                        <input type="text" id="global-compatible-module-tags" value="${(settings.compatibleModuleTags || []).join(',')}" placeholder="${translate('ccore_placeholder_compatible_module_tags')}">
                    </div>
                    <div class="form-group">
                        <label>${translate('ccore_label_global_cot_tags')}</label>
                        <input type="text" id="global-cot-tags" value="${(settings.cotTags || []).join(',')}" placeholder="${translate('ccore_placeholder_tags')}">
                    </div>
                    <div class="form-group">
                        <label>${translate('ccore_label_global_content_tag')}</label>
                        <input type="text" id="global-content-tag" value="${(settings.contentTag || []).join(',')}" placeholder="${translate('ccore_placeholder_tags')}">
                    </div>
                    <div class="form-group">
                        <label>${translate('ccore_label_global_content_remain_layers')}</label>
                        <input type="number" id="global-content-remain-layers" value="${settings.contentRemainLayers !== undefined ? settings.contentRemainLayers : 6}" placeholder="${translate('ccore_placeholder_content_remain_layers')}">
                    </div>
                </div>

                <div class="form-section-title">${translate('ccore_title_global_prompt_config')}</div>

                ${renderTristatePromptEditor('global-prompt', translate('ccore_label_global_prompt'), settings.prompt)}

                ${renderTristatePromptEditor('global-order-prompt', translate('ccore_label_global_order_prompt'), settings.orderPrompt)}

                ${renderTristatePromptEditor('global-usage-prompt', translate('ccore_label_global_usage_prompt'), settings.usagePrompt)}

                ${renderTristatePromptEditor('global-module-data-prompt', translate('ccore_label_global_module_data_prompt'), settings.moduleDataPrompt)}

                <div class="form-section-title">${translate('ccore_title_global_style_config')}</div>

                <div class="form-group form-full-width">
                    <label>${translate('ccore_label_global_container_styles')}</label>
                    <textarea id="global-container-styles" rows="2" placeholder="${translate('ccore_placeholder_inject_styles')}">${settings.containerStyles || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>${translate('ccore_label_global_external_styles')}</label>
                    <textarea id="global-external-styles" rows="2" placeholder="${translate('ccore_placeholder_inject_styles')}">${settings.externalStyles || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>${translate('ccore_label_global_bottom_styles')}</label>
                    <textarea id="global-bottom-styles" rows="2" placeholder="${translate('ccore_placeholder_inject_styles')}">${settings.bottomStyles || ''}</textarea>
                </div>

                <div class="form-section-title">${translate('ccore_title_other_settings')}</div>

                <div class="form-group">
                    <label>${translate('ccore_label_global_time_format')}</label>
                    <input type="text" id="global-time-format" value="${settings.timeFormat || ''}">
                </div>

                <div class="spacer-bottom"></div>
            </div>
        </div>
    `;

    // === 实时数据更新逻辑 ===
    const updateGlobalSettings = () => {
        // 收集数据，直接修改传入的 settings 对象引用
        settings.moduleTag = doc.getElementById('global-module-tag').value;
        settings.moduleUpdateTag = doc.getElementById('global-module-update-tag').value;
        settings.compatibleModuleTags = doc.getElementById('global-compatible-module-tags').value.split(',').map(s => s.trim()).filter(s => s);
        settings.cotTags = doc.getElementById('global-cot-tags').value.split(',').map(s => s.trim()).filter(s => s);
        settings.contentTag = doc.getElementById('global-content-tag').value.split(',').map(s => s.trim()).filter(s => s);
        settings.contentRemainLayers = parseInt(doc.getElementById('global-content-remain-layers').value) || 0;

        const collectTristate = (idPrefix) => {
            const out = {};
            for (const mode of PROMPT_MODE_LABELS) {
                out[mode.key] = {
                    pre: doc.getElementById(`${idPrefix}-${mode.key}-pre`).value,
                    post: doc.getElementById(`${idPrefix}-${mode.key}-post`).value,
                };
            }
            return out;
        };

        settings.prompt = collectTristate('global-prompt');
        settings.orderPrompt = collectTristate('global-order-prompt');
        settings.usagePrompt = collectTristate('global-usage-prompt');
        settings.moduleDataPrompt = collectTristate('global-module-data-prompt');
        settings.containerStyles = doc.getElementById('global-container-styles').value;
        settings.externalStyles = doc.getElementById('global-external-styles').value;
        settings.bottomStyles = doc.getElementById('global-bottom-styles').value;
        settings.timeFormat = doc.getElementById('global-time-format').value;

        if (onChange) onChange();
    };

    // 绑定所有输入框的实时更新
    container.querySelectorAll('input, textarea').forEach(el => {
        el.addEventListener('input', updateGlobalSettings);
        el.addEventListener('change', updateGlobalSettings);
    });

    // 三态提示词分组折叠/展开（点击标题切换）
    container.querySelectorAll('[data-tristate-toggle]').forEach(header => {
        header.addEventListener('click', () => {
            const idPrefix = header.dataset.tristateToggle;
            const body = container.querySelector(`[data-tristate-body="${idPrefix}"]`);
            const caret = header.querySelector('.tristate-prompt-caret');
            if (!body) return;
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            if (caret) caret.textContent = isOpen ? '▸' : '▾';
        });
    });
}
