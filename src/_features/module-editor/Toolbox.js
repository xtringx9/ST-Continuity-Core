import { i18n } from '../../_utils/i18n.js';
import { debugLog, infoLog, warnLog, errorLog } from '../../utils/logger.js';
import moduleCacheManager from '../../singleton/moduleCacheManager.js';
import configManager from '../../singleton/configManager.js';
import { getContext } from '../../index.js';
import { generateFormalPrompt, generateModuleOrderPrompt, generateUsageGuide, generateModuleDataPrompt, generateSingleChatModuleData } from '../../modules/promptGenerator.js';

/**
 * 渲染工具箱界面
 * @param {Document} doc Iframe文档对象
 * @param {Array} currentModules 当前模块列表
 */
export function renderToolbox(doc, currentModules) {
    debugLog("renderToolbox: 初始化工具箱界面");

    const section = 'module_editor';

    // === 1. 渲染提示词预览 ===
    const previewContainer = doc.getElementById('tool-prompt-preview-container');
    if (previewContainer) {
        previewContainer.innerHTML = '';

        const previewTitle = doc.createElement('div');
        previewTitle.className = 'form-section-title';
        previewTitle.textContent = i18n.t('title_prompt_preview', section);
        previewContainer.appendChild(previewTitle);

        const previewControls = doc.createElement('div');
        previewControls.className = 'form-group';
        previewControls.style.display = 'flex';
        previewControls.style.gap = '10px';
        previewControls.style.marginBottom = '10px';

        // 动态生成预览模式选项
        const previewModes = getPreviewModes(section);
        const optionsHtml = previewModes.map(mode => `<option value="${mode.value}">${mode.label}</option>`).join('');

        previewControls.innerHTML = `
            <select id="tool-preview-mode" style="flex: 1;">
                ${optionsHtml}
            </select>
            <button id="btn-preview-refresh" class="btn-secondary">${i18n.t('btn_refresh', section)}</button>
            <button id="btn-preview-copy-macro" class="btn-secondary">${i18n.t('btn_copy_macro', section)}</button>
            <button id="btn-preview-copy" class="btn-secondary">${i18n.t('btn_copy', section)}</button>
        `;
        previewContainer.appendChild(previewControls);

        const previewTextarea = doc.createElement('textarea');
        previewTextarea.id = 'tool-preview-content';
        previewTextarea.className = 'results-textarea';
        previewTextarea.rows = 8;
        previewTextarea.readOnly = true;
        previewContainer.appendChild(previewTextarea);

        bindPreviewEvents(doc);
    }

    // === 2. 渲染模块选择列表 ===
    const listContainer = doc.getElementById('tool-module-list');
    if (!listContainer) {
        errorLog("renderToolbox: 未找到 tool-module-list 容器");
        return;
    }
    listContainer.innerHTML = '';
    // 设置响应式网格布局
    listContainer.style.display = 'grid';
    listContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(120px, 1fr))';
    listContainer.style.gap = '5px';

    currentModules.forEach(mod => {
        const label = doc.createElement('label');
        label.className = 'toolbox-item';
        label.style.display = 'flex'; // 确保内部对齐
        label.style.alignItems = 'center';

        const displayLabel = mod.displayName ? `${mod.displayName} (${mod.name})` : mod.name;

        label.innerHTML = `
            <input type="checkbox" value="${mod.name}" data-enabled="${mod.enabled}" class="toolbox-checkbox">
            <span>${displayLabel}</span>
        `;

        listContainer.appendChild(label);
    });

    // === 注入/更新工具栏 ===
    // 优先查找现有的 toolbox-actions 容器 (通常位于标题行右侧)
    let btnGroup = doc.querySelector('#view-tools .toolbox-actions');

    if (btnGroup) {
        // 如果找到了 toolbox-actions，清空它以便重新渲染
        btnGroup.innerHTML = '';
        // 强制设置右对齐样式
        btnGroup.style.display = 'flex';
        btnGroup.style.justifyContent = 'flex-end';
        btnGroup.style.alignItems = 'center';
    }

    // 辅助函数：创建或获取按钮并绑定事件
    const setupButton = (id, textKey, onClick) => {
        if (!btnGroup) return null;

        let btn = doc.getElementById(id);
        if (!btn) {
            btn = doc.createElement('button');
            btn.id = id;
            btn.className = 'btn-secondary';
            btn.style.padding = '2px 6px';
            btn.style.fontSize = '12px';
            btn.style.marginLeft = '5px';
        }
        // 确保按钮在分组内
        if (btn.parentNode !== btnGroup) {
            btnGroup.appendChild(btn);
        }
        btn.textContent = i18n.t(textKey, section);
        btn.onclick = onClick; // 直接覆盖点击事件
        return btn;
    };

    // 按指定顺序创建按钮：全选 -> 仅启用 -> 清空
    setupButton('btn-tool-select-all', 'btn_select_all', () => {
        listContainer.querySelectorAll('.toolbox-checkbox').forEach(cb => cb.checked = true);
    });

    setupButton('btn-tool-select-enabled', 'btn_select_enabled', () => {
        listContainer.querySelectorAll('.toolbox-checkbox').forEach(cb => {
            cb.checked = (cb.dataset.enabled === 'true');
        });
    });

    setupButton('btn-tool-select-none', 'btn_select_none', () => {
        listContainer.querySelectorAll('.toolbox-checkbox').forEach(cb => cb.checked = false);
    });

    // 绑定提取按钮 (Mock 演示)
    const btnExtract = doc.getElementById('btn-extract');
    if (btnExtract) {
        // 移除旧的监听器以防重复绑定
        const newBtn = btnExtract.cloneNode(true);
        btnExtract.parentNode.replaceChild(newBtn, btnExtract);

        newBtn.addEventListener('click', () => {
            const start = doc.getElementById('tool-floor-start').value;
            const end = doc.getElementById('tool-floor-end').value || 'Latest';
            const selected = Array.from(listContainer.querySelectorAll('input:checked')).map(cb => cb.value);

            const resultArea = doc.getElementById('tool-results');
            resultArea.value = `[模拟提取结果]\n范围: ${start} - ${end}\n选中模块: ${selected.join(', ')}\n\n[summary|content:这是一个模拟的剧情摘要...]\n[inventory|item_name:长剑|count:1]`;
            infoLog("执行模拟提取");
        });
    }

    // === 调试按钮绑定 ===
    bindDebugButtons(doc, section);

    // 翻译工具箱标题
    const debugTitle = doc.getElementById('title-debug-tools');
    if (debugTitle) debugTitle.textContent = i18n.t('title_debug_tools', section);

    // 翻译楼层输入框 placeholder
    const floorEndInput = doc.getElementById('tool-floor-end');
    if (floorEndInput) floorEndInput.placeholder = i18n.t('placeholder_latest', section);
}

/**
 * 获取预览模式选项列表
 */
function getPreviewModes(section) {
    const modes = [
        { value: 'prompt', label: `${i18n.t('option_preview_prompt', section)} 宏` },
        { value: 'order', label: `${i18n.t('option_preview_order', section)} 宏` },
        { value: 'usage', label: `${i18n.t('option_preview_usage', section)} 宏` },
        { value: 'data', label: `${i18n.t('option_preview_data', section)} 宏` }
    ];

    // 获取聊天消息层数配置，动态生成聊天模块宏选项
    const entryCount = configManager.getGlobalSettings().contentRemainLayers || 9;
    for (let i = 0; i < entryCount; i++) {
        if (i % 2 === 1) {
            modes.push({
                value: `chat_module_${i}`,
                label: `{{CONTINUITY_MSG_MODULE_${i}}} 宏`
            });
        }
    }

    return modes;
}

function bindPreviewEvents(doc) {
    const updatePreview = () => {
        const mode = doc.getElementById('tool-preview-mode').value;
        let content = '';
        try {
            if (mode.startsWith('chat_module_')) {
                const index = parseInt(mode.split('_').pop());
                if (!isNaN(index)) {
                    content = generateSingleChatModuleData(index);
                }
            } else {
                switch (mode) {
                    case 'prompt': content = generateFormalPrompt(); break;
                    case 'order': content = generateModuleOrderPrompt(); break;
                    case 'usage': content = generateUsageGuide(); break;
                    case 'data': content = generateModuleDataPrompt(); break;
                }
            }
        } catch (e) {
            content = 'Error generating prompt: ' + e.message;
            errorLog(e);
        }
        doc.getElementById('tool-preview-content').value = content;
    };

    doc.getElementById('btn-preview-refresh').addEventListener('click', updatePreview);
    doc.getElementById('tool-preview-mode').addEventListener('change', updatePreview);

    const copyToClipboard = (text, btn) => {
        // 保存原始文本，防止在显示"✔"时再次点击导致原始文本丢失
        if (!btn.dataset.originalText) {
            btn.dataset.originalText = btn.textContent;
        }

        // 清除之前的定时器，防止快速点击时状态闪烁
        if (btn.dataset.timer) {
            clearTimeout(parseInt(btn.dataset.timer));
        }

        const successCallback = () => {
            btn.textContent = "✔";
            btn.dataset.timer = setTimeout(() => {
                btn.textContent = btn.dataset.originalText;
                delete btn.dataset.timer;
            }, 1000);
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(successCallback)
                .catch(err => {
                    console.warn("Clipboard API failed, trying fallback...", err);
                    fallbackCopy(text);
                });
        } else {
            fallbackCopy(text);
        }

        function fallbackCopy(text) {
            try {
                const textarea = doc.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                doc.body.appendChild(textarea);
                textarea.select();
                const successful = doc.execCommand('copy');
                doc.body.removeChild(textarea);
                if (successful) successCallback();
            } catch (err) {
                console.error("Fallback copy error:", err);
            }
        }
    };

    doc.getElementById('btn-preview-copy').addEventListener('click', () => {
        const content = doc.getElementById('tool-preview-content');
        content.select();
        copyToClipboard(content.value, doc.getElementById('btn-preview-copy'));
    });

    doc.getElementById('btn-preview-copy-macro').addEventListener('click', () => {
        const mode = doc.getElementById('tool-preview-mode').value;
        let macroText = '';
        if (mode.startsWith('chat_module_')) {
            const index = parseInt(mode.split('_').pop());
            macroText = `{{CONTINUITY_MSG_MODULE_${index}}}`;
        } else {
            switch (mode) {
                case 'prompt': macroText = '{{CONTINUITY_PROMPT}}'; break;
                case 'order': macroText = '{{CONTINUITY_ORDER}}'; break;
                case 'usage': macroText = '{{CONTINUITY_USAGE_GUIDE}}'; break;
                case 'data': macroText = '{{CONTINUITY_MODULE_DATA}}'; break;
            }
        }

        copyToClipboard(macroText, doc.getElementById('btn-preview-copy-macro'));
    });

    // 首次加载时触发一次预览
    updatePreview();
}

function bindDebugButtons(doc, section) {
    // 1. 打印缓存数据
    const btnDebugCache = doc.getElementById('btn-debug-cache');
    if (btnDebugCache) {
        const newBtn = btnDebugCache.cloneNode(true);
        newBtn.textContent = i18n.t('btn_debug_cache', section);
        btnDebugCache.parentNode.replaceChild(newBtn, btnDebugCache);

        newBtn.addEventListener('click', () => {
            infoLog("[Debug] 打印缓存数据");
            if (moduleCacheManager) moduleCacheManager.outputCache();
            else warnLog('moduleCacheManager not found');
        });
    }

    // 2. 打印配置数据
    const btnDebugConfig = doc.getElementById('btn-debug-config');
    if (btnDebugConfig) {
        const newBtn = btnDebugConfig.cloneNode(true);
        newBtn.textContent = i18n.t('btn_debug_config', section);
        btnDebugConfig.parentNode.replaceChild(newBtn, btnDebugConfig);

        newBtn.addEventListener('click', () => {
            infoLog("[Debug] 打印配置数据");
            if (configManager) configManager.outputCache();
            else warnLog('configManager not found');
        });
    }

    // 3. 打印上下文数据
    const btnDebugContext = doc.getElementById('btn-debug-context');
    if (btnDebugContext) {
        const newBtn = btnDebugContext.cloneNode(true);
        newBtn.textContent = i18n.t('btn_debug_context', section);
        btnDebugContext.parentNode.replaceChild(newBtn, btnDebugContext);

        newBtn.addEventListener('click', () => {
            infoLog("[Debug] 打印上下文数据");
            if (getContext) {
                const context = getContext();
                infoLog('[Module Cache]打印当前上下文数据:', context);
            } else {
                warnLog('getContext not found');
            }
        });
    }
}
