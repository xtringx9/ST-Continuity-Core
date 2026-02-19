import { i18n } from '../../_utils/i18n.js';
import { debugLog, infoLog, warnLog, errorLog } from '../../utils/logger.js';
import moduleCacheManager from '../../singleton/moduleCacheManager.js';
import configManager from '../../singleton/configManager.js';
import { getContext } from '../../index.js';
import { generateFormalPrompt, generateModuleOrderPrompt, generateUsageGuide, generateModuleDataPrompt, generateSingleChatModuleData } from '../../modules/promptGenerator.js';
import { parseModuleString, validateModuleString } from '../../modules/moduleParser.js';

/**
 * 渲染工具箱界面
 * @param {Document} doc Iframe文档对象
 * @param {Array} currentModules 当前模块列表
 * @param {Function} onModulesUpdated 模块列表更新后的回调函数
 */
export function renderToolbox(doc, currentModules, onModulesUpdated) {
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

    // === 1.5 渲染快速添加模块 ===
    const btnParse = doc.getElementById('btn-tool-parse');
    if (btnParse) {
        // 移除旧监听器
        const newBtn = btnParse.cloneNode(true);
        btnParse.parentNode.replaceChild(newBtn, btnParse);

        newBtn.addEventListener('click', () => {
            const input = doc.getElementById('tool-parse-input');
            const resultMsg = doc.getElementById('tool-parse-result');
            handleParseModules(input.value, currentModules, resultMsg, onModulesUpdated);
            input.value = ''; // 清空输入
        });
    }

    // === 2. 渲染模块选择列表 ===
    const listContainer = doc.getElementById('tool-module-list');
    if (!listContainer) {
        errorLog("renderToolbox: 未找到 tool-module-list 容器");
        return;
    }
    listContainer.innerHTML = '';

    currentModules.forEach(mod => {
        const label = doc.createElement('label');
        label.className = 'toolbox-item';

        const displayLabel = mod.displayName ? `${mod.displayName} (${mod.name})` : mod.name;

        label.innerHTML = `
            <input type="checkbox" value="${mod.name}" data-enabled="${mod.enabled}" class="toolbox-checkbox">
            <span>${displayLabel}</span>
        `;

        listContainer.appendChild(label);
    });

    // 绑定选择辅助按钮
    const btnSelectAll = doc.getElementById('btn-tool-select-all');
    if (btnSelectAll) {
        const newBtn = btnSelectAll.cloneNode(true);
        btnSelectAll.parentNode.replaceChild(newBtn, btnSelectAll);
        newBtn.addEventListener('click', () => {
            const checkboxes = listContainer.querySelectorAll('.toolbox-checkbox');
            checkboxes.forEach(cb => cb.checked = true);
        });
    }

    const btnSelectNone = doc.getElementById('btn-tool-select-none');
    if (btnSelectNone) {
        const newBtn = btnSelectNone.cloneNode(true);
        btnSelectNone.parentNode.replaceChild(newBtn, btnSelectNone);
        newBtn.addEventListener('click', () => {
            const checkboxes = listContainer.querySelectorAll('.toolbox-checkbox');
            checkboxes.forEach(cb => cb.checked = false);
        });
    }

    const btnSelectEnabled = doc.getElementById('btn-tool-select-enabled');
    if (btnSelectEnabled) {
        const newBtn = btnSelectEnabled.cloneNode(true);
        btnSelectEnabled.parentNode.replaceChild(newBtn, btnSelectEnabled);
        newBtn.addEventListener('click', () => {
            const checkboxes = listContainer.querySelectorAll('.toolbox-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = (cb.dataset.enabled === 'true');
            });
        });
    }

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
        { value: 'prompt', label: i18n.t('option_preview_prompt', section) },
        { value: 'order', label: i18n.t('option_preview_order', section) },
        { value: 'usage', label: i18n.t('option_preview_usage', section) },
        { value: 'data', label: i18n.t('option_preview_data', section) }
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

    doc.getElementById('btn-preview-copy').addEventListener('click', () => {
        const content = doc.getElementById('tool-preview-content');
        content.select();
        navigator.clipboard.writeText(content.value).then(() => {
            const btn = doc.getElementById('btn-preview-copy');
            const originalText = btn.textContent;
            btn.textContent = "✔";
            setTimeout(() => btn.textContent = originalText, 1000);
        });
    });
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

/**
 * 处理模块解析逻辑
 */
function handleParseModules(inputText, currentModules, resultMsgElement, onUpdate) {
    if (!inputText || !inputText.trim()) {
        if (resultMsgElement) resultMsgElement.textContent = "请输入内容";
        return;
    }

    const moduleMatches = parseNestedModules(inputText);
    if (!moduleMatches || moduleMatches.length === 0) {
        if (resultMsgElement) {
            resultMsgElement.textContent = "未找到有效的模块格式";
            resultMsgElement.style.color = "var(--danger-color, #ff6b6b)";
        }
        return;
    }

    let createdCount = 0;
    let updatedCount = 0;

    moduleMatches.forEach(match => {
        if (validateModuleString(match)) {
            const parsedModule = parseModuleString(match);
            if (parsedModule) {
                // 查找现有模块
                const existingModule = currentModules.find(m => m.name === parsedModule.name);

                if (existingModule) {
                    // 更新现有模块：合并变量
                    let varsAdded = 0;
                    if (!existingModule.variables) existingModule.variables = [];

                    parsedModule.variables.forEach(newVar => {
                        const existingVar = existingModule.variables.find(v => v.name === newVar.name);
                        if (existingVar) {
                            // 更新描述
                            if (newVar.description) existingVar.description = newVar.description;
                        } else {
                            // 添加新变量
                            existingModule.variables.push({
                                name: newVar.name,
                                displayName: newVar.name, // 默认显示名
                                description: newVar.description || '',
                                enabled: true,
                                isIdentifier: false
                            });
                            varsAdded++;
                        }
                    });
                    updatedCount++;
                } else {
                    // 创建新模块
                    const newModule = {
                        name: parsedModule.name,
                        displayName: parsedModule.name,
                        enabled: true,
                        outputMode: 'full',
                        variables: parsedModule.variables.map(v => ({
                            name: v.name,
                            displayName: v.name,
                            description: v.description || '',
                            enabled: true,
                            isIdentifier: false
                        }))
                    };
                    currentModules.push(newModule);
                    createdCount++;
                }
            }
        }
    });

    if (resultMsgElement) {
        resultMsgElement.textContent = `成功：新建 ${createdCount} 个，更新 ${updatedCount} 个`;
        resultMsgElement.style.color = "var(--success-color, #4caf50)";
        setTimeout(() => resultMsgElement.textContent = '', 3000);
    }

    if (onUpdate) onUpdate();
}

/**
 * 解析嵌套的模块字符串 (移植自 parseModuleManager.js)
 */
function parseNestedModules(inputText) {
    const results = [];
    let stack = [];

    for (let i = 0; i < inputText.length; i++) {
        const char = inputText[i];

        if (char === '[') {
            stack.push(i);
        } else if (char === ']') {
            if (stack.length > 0) {
                const start = stack.pop();
                if (stack.length === 0) {
                    const moduleString = inputText.substring(start, i + 1);
                    results.push(moduleString);
                }
            }
        }
    }
    // 简单处理：如果没找到成对的，尝试整个字符串
    if (results.length === 0 && inputText.trim().startsWith('[') && inputText.trim().endsWith(']')) {
        results.push(inputText.trim());
    }
    return results;
}
