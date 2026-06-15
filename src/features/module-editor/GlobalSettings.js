import { translate } from '../../../../../../i18n.js';

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
                
                <div class="form-group form-full-width">
                    <label>${translate('ccore_label_global_prompt')}</label>
                    <textarea id="global-prompt" rows="3" placeholder="${translate('ccore_placeholder_global_prompt')}">${settings.prompt || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>${translate('ccore_label_global_order_prompt')}</label>
                    <textarea id="global-order-prompt" rows="3" placeholder="${translate('ccore_placeholder_global_order_prompt')}">${settings.orderPrompt || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>${translate('ccore_label_global_usage_prompt')}</label>
                    <textarea id="global-usage-prompt" rows="3" placeholder="${translate('ccore_placeholder_global_usage_prompt')}">${settings.usagePrompt || ''}</textarea>
                </div>

                <div class="form-group form-full-width">
                    <label>${translate('ccore_label_global_module_data_prompt')}</label>
                    <textarea id="global-module-data-prompt" rows="3" placeholder="${translate('ccore_placeholder_global_module_data_prompt')}">${settings.moduleDataPrompt || ''}</textarea>
                </div>

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

        settings.prompt = doc.getElementById('global-prompt').value;
        settings.orderPrompt = doc.getElementById('global-order-prompt').value;
        settings.usagePrompt = doc.getElementById('global-usage-prompt').value;
        settings.moduleDataPrompt = doc.getElementById('global-module-data-prompt').value;
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
}
