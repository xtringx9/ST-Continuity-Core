import { i18n } from '../../_utils/i18n.js';

/**
 * 渲染全局设置界面
 * @param {Document} doc Iframe文档对象
 * @param {Object} settings 当前全局设置对象 (引用)
 */
export function renderGlobalSettings(doc, settings) {
    const container = doc.getElementById('view-settings');
    if (!container) return;

    const section = 'module_editor'; // 复用翻译

    container.innerHTML = `
        <div class="detail-content">
            <div class="settings-container">
                <div class="form-section-title">${i18n.t('title_tag_settings', section)}</div>
                
                <div class="form-grid">
                    <div class="form-group">
                        <label>${i18n.t('label_module_tag', section)}</label>
                        <input type="text" id="global-module-tag" value="${settings.moduleTag || 'module'}" placeholder="${i18n.t('placeholder_default_module', section)}">
                    </div>
                    <div class="form-group">
                        <label>${i18n.t('label_module_update_tag', section)}</label>
                        <input type="text" id="global-module-update-tag" value="${settings.moduleUpdateTag || 'module_update'}" placeholder="${i18n.t('placeholder_default_module_update', section)}">
                    </div>
                    <div class="form-group">
                        <label>${i18n.t('label_compatible_module_tags', section)}</label>
                        <input type="text" id="global-compatible-module-tags" value="${(settings.compatibleModuleTags || []).join(',')}" placeholder="${i18n.t('placeholder_compatible_module_tags', section)}">
                    </div>
                    <div class="form-group">
                        <label>${i18n.t('label_cot_tags', section)}</label>
                        <input type="text" id="global-cot-tags" value="${(settings.cotTags || []).join(',')}" placeholder="${i18n.t('placeholder_tags', section)}">
                    </div>
                    <div class="form-group">
                        <label>${i18n.t('label_content_tag', section)}</label>
                        <input type="text" id="global-content-tag" value="${(settings.contentTag || []).join(',')}" placeholder="${i18n.t('placeholder_tags', section)}">
                    </div>
                    <div class="form-group">
                        <label>${i18n.t('label_content_remain_layers', section)}</label>
                        <input type="number" id="global-content-remain-layers" value="${settings.contentRemainLayers !== undefined ? settings.contentRemainLayers : 6}" placeholder="${i18n.t('placeholder_content_remain_layers', section)}">
                    </div>
                </div>

                <div class="form-section-title">${i18n.t('title_global_prompt_config', section)}</div>
                
                <div class="form-group form-full-width">
                    <label>${i18n.t('label_global_prompt', section)}</label>
                    <textarea id="global-prompt" rows="3" placeholder="${i18n.t('placeholder_global_prompt', section)}">${settings.prompt || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>${i18n.t('label_global_order_prompt', section)}</label>
                    <textarea id="global-order-prompt" rows="3" placeholder="${i18n.t('placeholder_global_order_prompt', section)}">${settings.orderPrompt || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>${i18n.t('label_global_usage_prompt', section)}</label>
                    <textarea id="global-usage-prompt" rows="3" placeholder="${i18n.t('placeholder_global_usage_prompt', section)}">${settings.usagePrompt || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>${i18n.t('label_global_module_data_prompt', section)}</label>
                    <textarea id="global-module-data-prompt" rows="3" placeholder="${i18n.t('placeholder_global_module_data_prompt', section)}">${settings.moduleDataPrompt || ''}</textarea>
                </div>

                <div class="form-section-title">${i18n.t('title_global_style_config', section)}</div>

                <div class="form-group form-full-width">
                    <label>${i18n.t('label_global_container_styles', section)}</label>
                    <textarea id="global-container-styles" rows="2" placeholder="${i18n.t('placeholder_inject_styles', section)}">${settings.containerStyles || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>${i18n.t('label_global_external_styles', section)}</label>
                    <textarea id="global-external-styles" rows="2" placeholder="${i18n.t('placeholder_inject_styles', section)}">${settings.externalStyles || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>${i18n.t('label_global_bottom_styles', section)}</label>
                    <textarea id="global-bottom-styles" rows="2" placeholder="${i18n.t('placeholder_inject_styles', section)}">${settings.bottomStyles || ''}</textarea>
                </div>

                <div class="form-section-title">${i18n.t('title_other_settings', section)}</div>

                <div class="form-group">
                    <label>${i18n.t('label_theme', section)}</label>
                    <select id="global-theme-select">
                        <option value="light">${i18n.t('option_theme_light', section)}</option>
                        <option value="dark">${i18n.t('option_theme_dark', section)}</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>${i18n.t('label_time_format', section)}</label>
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

        settings.prompt = doc.getElementById('global-prompt').value;
        settings.orderPrompt = doc.getElementById('global-order-prompt').value;
        settings.usagePrompt = doc.getElementById('global-usage-prompt').value;
        settings.moduleDataPrompt = doc.getElementById('global-module-data-prompt').value;
        settings.containerStyles = doc.getElementById('global-container-styles').value;
        settings.externalStyles = doc.getElementById('global-external-styles').value;
        settings.bottomStyles = doc.getElementById('global-bottom-styles').value;
        settings.timeFormat = doc.getElementById('global-time-format').value;
    };

    // 绑定所有输入框的实时更新
    container.querySelectorAll('input, textarea').forEach(el => {
        el.addEventListener('input', updateGlobalSettings);
        el.addEventListener('change', updateGlobalSettings);
    });

    // 绑定主题切换
    const themeSelect = doc.getElementById('global-theme-select');
    if (themeSelect) {
        themeSelect.value = doc.documentElement.getAttribute('data-theme') || 'light';
        themeSelect.addEventListener('change', (e) => {
            doc.documentElement.setAttribute('data-theme', e.target.value);
        });
    }
}
