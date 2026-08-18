import { translate } from '../../../../../../i18n.js';
import { debugLog, infoLog, warnLog, errorLog } from '../../utils/logger.js';
import moduleCacheManager from '../../singleton/moduleCacheManager.js';
import configManager from '../../singleton/configManager.js';
import { getContext } from '../../../../../../extensions.js';
import {
    getContinuityCoreUserHandle,
    saveContinuityCoreFile,
    readContinuityCoreFile,
    listContinuityCoreFiles,
    deleteContinuityCoreFile,
    listContinuityCoreChats,
} from '../../services/continuityCoreServerApi.js';
import perMessageStorage from '../../services/perMessageStorage.js';
import { generateFormalPrompt, generateModuleOrderPrompt, generateUsageGuide, generateModuleDataPrompt, generateSingleChatModuleData } from '../../modules/promptGenerator.js';
import { runModulePipeline } from '../../core/pipeline/runModulePipeline.js';

/**
 * 渲染工具箱界面
 * @param {Document} doc Iframe文档对象
 * @param {Array} currentModules 当前模块列表
 */
export function renderToolbox(doc, currentModules) {
    debugLog("renderToolbox: 初始化工具箱界面");

    // === 1. 渲染提示词预览 ===
    const previewContainer = doc.getElementById('tool-prompt-preview-container');
    if (previewContainer) {
        previewContainer.innerHTML = '';

        const previewTitle = doc.createElement('div');
        previewTitle.className = 'form-section-title';
        previewTitle.textContent = translate('ccore_title_prompt_preview');
        previewContainer.appendChild(previewTitle);

        const previewControls = doc.createElement('div');
        previewControls.className = 'form-group';
        previewControls.style.display = 'flex';
        previewControls.style.gap = '10px';
        previewControls.style.marginBottom = '10px';

        // 动态生成预览模式选项
        const previewModes = getPreviewModes();
        const optionsHtml = previewModes.map(mode => `<option value="${mode.value}">${mode.label}</option>`).join('');

        previewControls.innerHTML = `
            <select id="tool-preview-mode" style="flex: 1;">
                ${optionsHtml}
            </select>
            <select id="tool-preview-async-mode" title="${translate('ccore_title_preview_async_mode')}">
                <option value="sync">${translate('ccore_option_async_sync')}</option>
                <option value="async-body">${translate('ccore_option_async_body')}</option>
                <option value="async-alone">${translate('ccore_option_async_alone')}</option>
            </select>
            <button id="btn-preview-refresh" class="btn-secondary">${translate('ccore_btn_refresh')}</button>
            <button id="btn-preview-copy-macro" class="btn-secondary">${translate('ccore_btn_copy_macro')}</button>
            <button id="btn-preview-copy" class="btn-secondary">${translate('ccore_btn_copy')}</button>
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
        btn.textContent = translate(`ccore_${textKey}`);
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

    // 绑定提取按钮组
    const btnExtract = doc.getElementById('btn-extract');
    if (btnExtract) {
        const container = doc.createElement('div');
        container.style.display = 'flex';
        container.style.gap = '8px';
        container.style.justifyContent = 'flex-end';
        container.style.marginTop = '20px';

        const createBtn = (textKey, type, defaultText) => {
            const btn = doc.createElement('button');
            btn.className = 'btn-primary';
            btn.textContent = translate(`ccore_${textKey}`) || defaultText;
            btn.style.fontSize = '12px';
            btn.style.padding = '6px 12px';
            btn.addEventListener('click', () => handleExtract(doc, type));
            return btn;
        };

        container.appendChild(createBtn('btn_extract_native', 'extract', '提取原生'));
        container.appendChild(createBtn('btn_extract_processed', 'processed', '提取并整理'));
        container.appendChild(createBtn('btn_extract_auto', 'auto', '自动处理'));

        if (btnExtract.parentNode) {
            btnExtract.parentNode.replaceChild(container, btnExtract);
        }
    }

    // === 调试按钮绑定 ===
    bindDebugButtons(doc);

    // 翻译工具箱标题
    const debugTitle = doc.getElementById('title-debug-tools');
    if (debugTitle) debugTitle.textContent = translate('ccore_title_debug_tools');

    // 翻译楼层输入框 placeholder
    const floorEndInput = doc.getElementById('tool-floor-end');
    if (floorEndInput) floorEndInput.placeholder = translate('ccore_placeholder_latest');

    // 为结果区域添加复制按钮
    const resultsTitle = doc.querySelector('.results-title');
    if (resultsTitle && !resultsTitle.querySelector('button')) {
        const copyBtn = doc.createElement('button');
        copyBtn.className = 'btn-secondary';
        copyBtn.style.marginLeft = '10px';
        copyBtn.style.padding = '2px 8px';
        copyBtn.style.fontSize = '12px';
        copyBtn.textContent = translate('ccore_btn_copy');
        copyBtn.addEventListener('click', () => {
            const resultArea = doc.getElementById('tool-results');
            if (resultArea) copyToClipboard(doc, resultArea.value, copyBtn);
        });
        resultsTitle.appendChild(copyBtn);
    }
}

/**
 * 获取预览模式选项列表
 */
function getPreviewModes() {
    const modes = [
        { value: 'prompt', label: `${translate('ccore_option_preview_prompt')} ${translate('ccore_label_macro')}` },
        { value: 'order', label: `${translate('ccore_option_preview_order')} ${translate('ccore_label_macro')}` },
        { value: 'usage', label: `${translate('ccore_option_preview_usage')} ${translate('ccore_label_macro')}` },
        { value: 'data', label: `${translate('ccore_option_preview_data')} ${translate('ccore_label_macro')}` }
    ];

    // 获取聊天消息层数配置，动态生成聊天模块宏选项
    const entryCount = configManager.getGlobalSettings().contentRemainLayers || 9;
    for (let i = 0; i < entryCount; i++) {
        if (i % 2 === 1) {
            modes.push({
                value: `chat_module_${i}`,
                label: `{{CONTINUITY_MSG_MODULE_${i}}} ${translate('ccore_label_macro')}`
            });
        }
    }

    return modes;
}

// 通用复制函数
function copyToClipboard(doc, text, btn) {
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
}

function bindPreviewEvents(doc) {
    const updatePreview = () => {
        const mode = doc.getElementById('tool-preview-mode').value;
        // 三态模式选择（显式指定，不依赖当前 async 开关状态）
        const asyncModeEl = doc.getElementById('tool-preview-async-mode');
        const asyncMode = asyncModeEl ? asyncModeEl.value : 'sync';
        let content = '';
        try {
            if (mode.startsWith('chat_module_')) {
                const index = parseInt(mode.split('_').pop());
                if (!isNaN(index)) {
                    content = generateSingleChatModuleData(index, asyncMode);
                }
            } else {
                switch (mode) {
                    case 'prompt': content = generateFormalPrompt(asyncMode); break;
                    case 'order': content = generateModuleOrderPrompt(asyncMode); break;
                    case 'usage': content = generateUsageGuide(asyncMode); break;
                    case 'data': content = generateModuleDataPrompt(asyncMode); break;
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
    const asyncModeEl = doc.getElementById('tool-preview-async-mode');
    if (asyncModeEl) asyncModeEl.addEventListener('change', updatePreview);

    doc.getElementById('btn-preview-copy').addEventListener('click', () => {
        const content = doc.getElementById('tool-preview-content');
        content.select();
        copyToClipboard(doc, content.value, doc.getElementById('btn-preview-copy'));
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

        copyToClipboard(doc, macroText, doc.getElementById('btn-preview-copy-macro'));
    });

    // 首次加载时触发一次预览
    updatePreview();
}

function bindDebugButtons(doc) {
    const serverDebugDir = '_debug';
    const serverDebugFile = `${serverDebugDir}/server-api-test.json`;

    const bindServerDebugButton = (id, textKey, handler) => {
        const btn = doc.getElementById(id);
        if (!btn) return;

        const newBtn = btn.cloneNode(true);
        newBtn.textContent = translate(`ccore_${textKey}`);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', async () => {
            newBtn.disabled = true;
            try {
                await handler();
                if (typeof toastr !== 'undefined') {
                    toastr.success(translate(`ccore_${textKey}`));
                }
            } catch (err) {
                errorLog(`[Debug] ${translate(`ccore_${textKey}`)} 失败:`, err);
                if (typeof toastr !== 'undefined') {
                    toastr.error(err.message);
                }
            } finally {
                newBtn.disabled = false;
            }
        });
    };

    // 1. 打印缓存数据
    const btnDebugCache = doc.getElementById('btn-debug-cache');
    if (btnDebugCache) {
        const newBtn = btnDebugCache.cloneNode(true);
        newBtn.textContent = translate('ccore_btn_debug_cache');
        btnDebugCache.parentNode.replaceChild(newBtn, btnDebugCache);

        newBtn.addEventListener('click', () => {
            infoLog("[Debug] 打印缓存数据");
            if (moduleCacheManager) moduleCacheManager.outputCache();
            else warnLog('moduleCacheManager not found');
        });
    }

    // 1.5 生成记录面板：已废弃调试面板（测试），无独立测试入口（生成记录面板由生成流程直接打开）

    // 2. 打印配置数据
    const btnDebugConfig = doc.getElementById('btn-debug-config');
    if (btnDebugConfig) {
        const newBtn = btnDebugConfig.cloneNode(true);
        newBtn.textContent = translate('ccore_btn_debug_config');
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
        newBtn.textContent = translate('ccore_btn_debug_context');
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

    // 3.1 清理废弃配置键（顶层仅保留 5 个已知 key）
    bindServerDebugButton('btn-debug-clean-config', 'btn_debug_clean_config', async () => {
        const removed = configManager.cleanDeprecatedConfigKeys();
        if (removed.length > 0) {
            infoLog('[Debug] 已清理废弃配置键:', removed);
        } else {
            infoLog('[Debug] 无废弃配置键需要清理。');
        }
    });

    // 4. 打印当前用户 Handle
    const btnDebugUserHandle = doc.getElementById('btn-debug-user-handle');
    if (btnDebugUserHandle) {
        const newBtn = btnDebugUserHandle.cloneNode(true);
        newBtn.textContent = translate('ccore_btn_debug_user_handle');
        btnDebugUserHandle.parentNode.replaceChild(newBtn, btnDebugUserHandle);

        newBtn.addEventListener('click', () => {
            const userHandle = getContinuityCoreUserHandle();
            infoLog("[Debug] 当前用户 Handle:", userHandle);
        });
    }

    // 5. 服务器接口调试
    bindServerDebugButton('btn-debug-server-list', 'btn_debug_server_list', async () => {
        const result = await listContinuityCoreFiles(serverDebugDir);
        infoLog(`[Debug] 服务器目录列表 (${serverDebugDir}):`, result);
    });

    bindServerDebugButton('btn-debug-server-save', 'btn_debug_server_save', async () => {
        const userHandle = getContinuityCoreUserHandle();
        const content = {
            source: 'module-editor-debug',
            userHandle,
            savedAt: new Date().toISOString(),
        };
        const result = await saveContinuityCoreFile(serverDebugFile, content);
        infoLog(`[Debug] 服务器写入测试 (${serverDebugFile}):`, result, content);
    });

    bindServerDebugButton('btn-debug-server-read', 'btn_debug_server_read', async () => {
        const result = await readContinuityCoreFile(serverDebugFile);
        infoLog(`[Debug] 服务器读取测试 (${serverDebugFile}):`, result);
    });

    bindServerDebugButton('btn-debug-server-delete', 'btn_debug_server_delete', async () => {
        const result = await deleteContinuityCoreFile(serverDebugFile);
        infoLog(`[Debug] 服务器删除测试 (${serverDebugFile}):`, result);
    });

    // === 存储层调试按钮 ===
    const bindStorageDebugButton = (id, label, handler) => {
        const btn = doc.getElementById(id);
        if (!btn) return;

        const newBtn = btn.cloneNode(true);
        newBtn.textContent = label;
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', async () => {
            newBtn.disabled = true;
            try {
                await handler();
            } catch (err) {
                errorLog(`[Debug-Storage] ${label} 失败:`, err);
                if (typeof toastr !== 'undefined') {
                    toastr.error(err.message);
                }
            } finally {
                newBtn.disabled = false;
            }
        });
    };

    bindStorageDebugButton('btn-debug-storage-init', translate('ccore_btn_debug_storage_init'), async () => {
        const context = getContext();
        const characterName = context?.name2 || 'TestChar';
        const chatId = context?.chatIdHash || 'test-hash';
        // 构造聊天文件名
        const chatFileName = context?.chatId || 'TestChat-2026-05-30.jsonl';
        await perMessageStorage.initChat(characterName, chatFileName, chatId);
        infoLog('[Debug-Storage] 初始化完成:', { characterName, chatFileName, chatId });
    });

    bindStorageDebugButton('btn-debug-storage-append', translate('ccore_btn_debug_storage_append'), async () => {
        const testMesId = parseInt(prompt(translate('ccore_prompt_input_mesid'), '0'));
        if (isNaN(testMesId)) return;

        // 新格式:swipe 数据是 key→value map,modules 是特殊 key
        const swipeData = {
            '0': {
                modules: '[Location|name:Tavern|time:afternoon]\n[Character|name:Hero|mood:happy]',
            }
        };

        await perMessageStorage.writeMessage(testMesId, 0, swipeData);
        infoLog(`[Debug-Storage] 追加楼层 ${testMesId}:`, swipeData);
    });

    bindStorageDebugButton('btn-debug-storage-read', translate('ccore_btn_debug_storage_read'), async () => {
        const testMesId = parseInt(prompt(translate('ccore_prompt_input_mesid'), '0'));
        if (isNaN(testMesId)) return;

        const data = await perMessageStorage.getMessage(testMesId, 0);
        infoLog(`[Debug-Storage] 读取楼层 ${testMesId} swipe 0:`, data);
    });

    bindStorageDebugButton('btn-debug-storage-update', translate('ccore_btn_debug_storage_update'), async () => {
        const testMesId = parseInt(prompt(translate('ccore_prompt_input_mesid'), '0'));
        if (isNaN(testMesId)) return;

        // 新格式:只更新 modules key(单 swipe 数据,updateMessage 会自动包装)
        const newData = {
            modules: '[Location|name:Forest|time:night|weather:rain]',
        };

        await perMessageStorage.updateMessage(testMesId, 0, newData);
        infoLog(`[Debug-Storage] 更新楼层 ${testMesId} swipe 0:`, newData);
    });

    bindStorageDebugButton('btn-debug-storage-snapshot', translate('ccore_btn_debug_storage_snapshot'), async () => {
        const testMesId = parseInt(prompt(translate('ccore_prompt_input_snapshot_mesid'), '0'));
        if (isNaN(testMesId)) return;

        const moduleStates = {
            Location: { lastAppearanceMesId: testMesId, identifier: 'Tavern', variables: { name: 'Tavern', time: 'afternoon' }, source: 'inContent' }
        };

        await perMessageStorage.writeSnapshot(testMesId, moduleStates);
        infoLog(`[Debug-Storage] 写入快照 ${testMesId}:`, moduleStates);
    });

    bindStorageDebugButton('btn-debug-storage-read-snapshot', translate('ccore_btn_debug_storage_read_snapshot'), async () => {
        const testMesId = parseInt(prompt(translate('ccore_prompt_input_snapshot_find_mesid'), '5'));
        if (isNaN(testMesId)) return;

        const data = await perMessageStorage.getSnapshot(testMesId);
        infoLog(`[Debug-Storage] 读取快照 (≤${testMesId}):`, data);
    });

    bindStorageDebugButton('btn-debug-storage-accumulated', translate('ccore_btn_debug_storage_accumulated'), async () => {
        const testMesId = parseInt(prompt(translate('ccore_prompt_input_mesid'), '5'));
        if (isNaN(testMesId)) return;

        const state = await perMessageStorage.getAccumulatedState(testMesId);
        infoLog(`[Debug-Storage] 累积状态 (楼层 ${testMesId}):`, state);
    });

    bindStorageDebugButton('btn-debug-storage-meta', translate('ccore_btn_debug_storage_meta'), async () => {
        infoLog('[Debug-Storage] Meta:', perMessageStorage.metaCache);
    });

    bindStorageDebugButton('btn-debug-storage-list', translate('ccore_btn_debug_storage_list'), async () => {
        const context = getContext();
        const characterName = context?.name2 || 'TestChar';
        const result = await listContinuityCoreChats(characterName);
        infoLog(`[Debug-Storage] 角色 ${characterName} 的聊天列表:`, result);
    });
}

async function handleExtract(doc, type) {
    const startInput = doc.getElementById('tool-floor-start');
    const endInput = doc.getElementById('tool-floor-end');
    const resultArea = doc.getElementById('tool-results');
    const listContainer = doc.getElementById('tool-module-list');

    const startFloor = parseInt(startInput.value) || 1;
    const endFloor = parseInt(endInput.value);

    const startIndex = startFloor - 1;
    let endIndex = null;
    if (!isNaN(endFloor) && endFloor >= 1) {
        endIndex = endFloor - 1;
    }

    // 获取选中的模块
    const selectedModuleNames = Array.from(listContainer.querySelectorAll('.toolbox-checkbox:checked')).map(cb => cb.value);

    // 构建过滤器 (参考 ExtractModuleController 逻辑)
    const modulesData = configManager.getModules() || [];
    let moduleFilters = null;

    if (selectedModuleNames.length > 0) {
        moduleFilters = [];
        selectedModuleNames.forEach(name => {
            const m = modulesData.find(mod => mod.name === name);
            if (m) {
                moduleFilters.push({
                    name: m.name,
                    compatibleModuleNames: m.compatibleModuleNames
                });
            }
        });
    }

    resultArea.value = translate('ccore_msg_extracting');

    try {
        const result = runModulePipeline({
            range: { start: startIndex, end: endIndex },
            modules: moduleFilters,
            processType: type,
            selectedModuleNames,
            force: true,
            cache: 'none',
            showModuleNames: true,
            showProcessInfo: true,
        });

        if (result.success) {
            resultArea.value = result.hasContent ? result.contentString : translate('ccore_msg_no_content');
        } else {
            resultArea.value = translate('ccore_msg_extract_failed') + result.error;
        }
    } catch (err) {
        errorLog("Extraction error:", err);
        resultArea.value = translate('ccore_msg_error') + err.message;
    }
}
