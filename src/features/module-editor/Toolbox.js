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
import { getActiveSources } from '../../core/pipeline/moduleDataSources.js';
import { processAutoModules, buildModulesString } from '../../core/pipeline/output.js';
import { migrateWorldBookModulesToChatEntries } from '../../core/chatModuleEntryStore.js';
import { getOccurrenceStats, getChatCacheKey, hasOccurrence, outputOccurrenceCache } from '../../core/occurrenceCache.js';
import { rebuildFrom } from '../../core/rebuildProcessor.js';
import { outputSnapshots, getSnapshotStats, clearSnapshots } from '../../core/snapshotStore.js';

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

/**
 * 诊断 occurrence 缓存 + 提取链路（阶段 1 调试）。
 * 输出：
 *   1. 缓存统计（getOccurrenceStats）+ 当前 chatKey
 *   2. 各源手动全段提取（filters=null）的数量与首条样例（确认提取本身正常）
 *   3. runModulePipeline auto 全段结果（确认管线输出）
 */
async function diagnoseOccurrenceCache() {
    const chatKey = getChatCacheKey();
    infoLog('[Occurrence诊断] chatKey:', chatKey);
    infoLog('[Occurrence诊断] 缓存统计:', getOccurrenceStats());
    // 打印当前已缓存完的完整结构（chatKey → source → floor → 模块名/数量/样例）
    outputOccurrenceCache();

    const sources = getActiveSources();
    for (const { name, impl } of sources) {
        try {
            const part = impl.getRawModules({ start: 0, end: null, filters: null });
            const arr = Array.isArray(part) ? part : [];
            infoLog(`[Occurrence诊断] 源 ${name} 全段提取 ${arr.length} 个（filters=null）`, arr.slice(0, 2));
            // 单层提取测试（occurrence 缓存路径的关键）
            const single = impl.getRawModules({ start: 0, end: 0, filters: null });
            const singleArr = Array.isArray(single) ? single : [];
            infoLog(`[Occurrence诊断] 源 ${name} 单层[0,0]提取 ${singleArr.length} 个`, singleArr.slice(0, 2));
        } catch (err) {
            errorLog(`[Occurrence诊断] 源 ${name} 提取失败:`, err);
        }
    }

    try {
        const result = runModulePipeline({
            range: { start: 0, end: null },
            modules: null,
            processType: 'auto',
            cache: 'none',
        });
        infoLog('[Occurrence诊断] runModulePipeline(auto,全段) 结果:', {
            success: result.success,
            moduleCount: result.moduleCount,
            hasContent: result.hasContent,
            contentKeys: result.content && typeof result.content === 'object' ? Object.keys(result.content) : [],
            error: result.error,
        });
    } catch (err) {
        errorLog('[Occurrence诊断] runModulePipeline 抛错:', err);
    }
}

/**
 * 验证快照重建 == 全量管线（阶段 2）。
 * 对比 rebuildFrom(0)（全增量）最后层的结果 vs runModulePipeline(auto, 全段) 的 content。
 * 输出：两者 moduleCount / 每模块 data 数，是否一致。
 */
async function verifySnapshotRebuild() {
    // ⚠️ 清空旧 checkpoint：getModules(true)→getModules() 修复前攒下的旧快照含膨胀的 sum，
    // 复用会掩盖修复效果。验证必须从空 checkpoint 全量重建。
    clearSnapshots();
    // 全量参考
    const full = runModulePipeline({
        range: { start: 0, end: null },
        modules: null,
        processType: 'auto',
        cache: 'none',
    });
    // 全增量重建
    const { results, snapshot } = rebuildFrom(0);
    const last = results.length > 0 ? results[results.length - 1].content : {};

    // ⚠️ 诊断：对比全量 normalizeModules 与 rebuild 的去重结果（sum 组）
    try {
        const configManagerMod = (await import('../../singleton/configManager.js')).default;
        const normalizeMod = (await import('../../core/pipeline/normalize.js'));
        // 用 occurrence 全量 raw（与 rebuild 同源）
        const occRaw = [];
        const { getActiveSources: getSrc } = await import('../../core/pipeline/moduleDataSources.js');
        for (const { name, impl } of getSrc()) {
            const part = impl.getRawModules({ start: 0, end: null, filters: null });
            if (Array.isArray(part)) occRaw.push(...part);
        }
        // ⚠️ 诊断：occRaw 里 sum 的原始条数（按 messageIndex 分组）——分辨「原始就 184」vs「rebuild 多读」
        const rawSum = occRaw.filter(r => {
            const pipe = r.raw?.indexOf('|');
            const name = pipe > 0 ? r.raw.slice(1, pipe).trim() : '';
            return name === 'sum';
        });
        const rawSumByFloor = {};
        for (const r of rawSum) {
            rawSumByFloor[r.messageIndex] = (rawSumByFloor[r.messageIndex] || 0) + 1;
        }
        infoLog('[快照验证-诊断] occRaw sum 原始条数:', rawSum.length, '| 分布(前10层):', Object.entries(rawSumByFloor).slice(0, 10).map(([f, c]) => `#${f}:${c}`).join(' '));
        // ⚠️ 诊断：occurrence 缓存里 sum 的总量（rebuild 实际读的）
        const { getChatCacheKey: getKey, getOccurrence: getOcc } = await import('../../core/occurrenceCache.js');
        const { getActiveSources: getSrc2 } = await import('../../core/pipeline/moduleDataSources.js');
        const k = getKey();
        let cacheSum = 0;
        let cacheSumBySrc = {};
        const chatLen = getContext()?.chat?.length || 0;
        for (const { name } of getSrc2()) {
            let c = 0;
            for (let f = 0; f < chatLen; f++) {
                const raws = getOcc(k, name, f);
                if (!Array.isArray(raws)) continue;
                for (const r of raws) {
                    const pipe = r.raw?.indexOf('|');
                    if (pipe > 0 && r.raw.slice(1, pipe).trim() === 'sum') c++;
                }
            }
            cacheSumBySrc[name] = c;
            cacheSum += c;
        }
        infoLog('[快照验证-诊断] occurrence 缓存 sum 总量:', cacheSum, '| 各源:', cacheSumBySrc);
        const normGroups = normalizeMod.normalizeModules(occRaw, undefined);
        const normSum = normGroups['sum'] || [];
        const rebSum = (snapshot.groupModules?.get('sum')) || [];
        infoLog('[快照验证-诊断] normalizeModules sum 组:', normSum.length, '| rebuild groupModules sum:', rebSum.length, '| rebuild dedup sum:', Array.from(snapshot.dedup?.moduleMap?.values() || []).filter(m => m.moduleName === 'sum').length);
        infoLog('[快照验证-诊断] normalize sum 组前2:', normSum.slice(0, 2).map(m => ({ mi: m.messageIndex, id: m.variables.id, level: m.variables.level })));
        infoLog('[快照验证-诊断] rebuild sum 组前2:', rebSum.slice(0, 2).map(m => ({ mi: m.messageIndex, id: m.variables.id, level: m.variables.level })));
    } catch (err) {
        errorLog('[快照验证-诊断] 对比失败:', err);
    }

    infoLog('[快照验证] 全量 content keys:', Object.keys(full.content || {}));
    infoLog('[快照验证] rebuild content keys:', Object.keys(last));
    infoLog('[快照验证] 全量 moduleCount:', full.moduleCount, '| rebuild 各模块 count:', Object.fromEntries(Object.entries(last).map(([k, v]) => [k, v.moduleCount])));

    // 对比每个模块的可见模块数（moduleCount），而非 data.length——
    // data 可能是 processFullModules 按变量/key 展开后的数组，长度不代表模块数（env 245 却 occurrence 仅 222）。
    const mismatch = [];
    for (const key of Object.keys(full.content || {})) {
        const fullData = full.content[key]?.data;
        const rbData = last[key]?.data;
        const fullMC = full.content[key]?.moduleCount ?? (Array.isArray(fullData) ? fullData.length : 0);
        const rbMC = last[key]?.moduleCount ?? (Array.isArray(rbData) ? rbData.length : 0);
        if (fullMC !== rbMC) mismatch.push({ module: key, full: fullMC, rebuild: rbMC });
    }
    if (mismatch.length === 0) {
        infoLog('[快照验证] ✅ 各模块 data 数量一致');
    } else {
        errorLog('[快照验证] ❌ 不一致:', mismatch);
    }
    // ⚠️ 3.1 等价接入验证：runModulePipeline(useSnapshot:true) 应产出与正常全段一致的 content
    try {
        const snapRun = runModulePipeline({
            range: { start: 0, end: null },
            modules: null,
            processType: 'auto',
            cache: 'none',
            useSnapshot: true,
        });
        const diff = [];
        for (const key of Object.keys(full.content || {})) {
            const a = full.content[key]?.moduleCount;
            const b = snapRun.content?.[key]?.moduleCount;
            if (a !== b) diff.push({ module: key, full: a, snap: b });
        }
        if (diff.length === 0) {
            infoLog('[快照验证-3.1] ✅ useSnapshot 与全量 moduleCount 一致');
        } else {
            errorLog('[快照验证-3.1] ❌ useSnapshot 不一致:', diff);
        }
    } catch (e) {
        errorLog('[快照验证-3.1] 失败:', e);
    }
    // ⚠️ 3.2 性能对比（临时验证，非产品代码）：全量 vs 快照冷启动 vs 多档失效层增量
    try {
        const snapMod = await import('../../core/snapshotStore.js');
        const t0 = performance.now();
        runModulePipeline({ range: { start: 0, end: null }, modules: null, processType: 'auto', cache: 'none' });
        const tFull = performance.now() - t0;

        const t1 = performance.now();
        const coldRun = runModulePipeline({ range: { start: 0, end: null }, modules: null, processType: 'auto', cache: 'none', useSnapshot: true });
        const tSnap = performance.now() - t1;

        // 不同失效层：失效点越靠后（只改末尾），增量续算应越省；失效点=0 则近似全段重算。
        const len = getContext()?.chat?.length || 1;
        const floors = [0, Math.max(1, Math.floor(len / 3)), Math.max(1, Math.floor((2 * len) / 3)), len - 1];
        const rows = [{
            '失效层': `冷启动`,
            '层数': coldRun?.perf?.layers ?? '-',
            '总耗时_ms': +tSnap.toFixed(1),
            'rebuild_ms': coldRun?.perf ? +coldRun.perf.rebuild.toFixed(1) : null,
            'dedup_ms': coldRun?.perf ? +coldRun.perf.dedup.toFixed(1) : null,
            'time_ms': coldRun?.perf ? +coldRun.perf.time.toFixed(1) : null,
            'group_ms': coldRun?.perf ? +coldRun.perf.group.toFixed(1) : null,
        }];
        for (const f of floors) {
            snapMod.markSnapshotDirty(f);
            const t = performance.now();
            const r = runModulePipeline({ range: { start: 0, end: null }, modules: null, processType: 'auto', cache: 'none', useSnapshot: true });
            rows.push({
                '失效层': f,
                '层数': r?.perf?.layers ?? '-',
                '总耗时_ms': +(performance.now() - t).toFixed(1),
                'rebuild_ms': r?.perf ? +r.perf.rebuild.toFixed(1) : null,
                'dedup_ms': r?.perf ? +r.perf.dedup.toFixed(1) : null,
                'time_ms': r?.perf ? +r.perf.time.toFixed(1) : null,
                'group_ms': r?.perf ? +r.perf.group.toFixed(1) : null,
            });
        }
        snapMod.resetSnapshotDirty();
        infoLog(`[快照性能] 全量=${tFull.toFixed(1)}ms 冷启动=${tSnap.toFixed(1)}ms`);
        console.table(rows);
        infoLog('[快照性能-表格] 各失效层耗时分布见上方 console.table；rebuild=快照续算主体，dedup/time/group 为其中分段。');
    } catch (e) {
        errorLog('[快照性能] 失败:', e);
    }
    outputSnapshots();
    infoLog('[快照验证] checkpoint 统计:', getSnapshotStats());
}

/**
 * 管线性能采样（F 二期快照前置实测）
 * 对当前聊天从 0 到多个 endIndex 全量跑管线各阶段，输出各阶段耗时占比，
 * 用于判断性能大头在 extract 还是 process（决定快照系统投入方向）。
 * 结果输出到 console（infoLog + console.table）。
 */
async function profilePipelineStages() {
    const chat = getContext()?.chat;
    if (!chat || !Array.isArray(chat) || chat.length === 0) {
        warnLog('[Perf] 当前无聊天数据，无法采样');
        return;
    }
    const chatLen = chat.length;
    // 采样档位：50/100/200/500/1000/2000/5000…（不超过聊天长度）+ 全量
    const ends = [];
    const SIZES = [50, 100, 200, 500, 1000, 2000, 5000];
    for (const s of SIZES) {
        const end = Math.min(s - 1, chatLen - 1);
        if (end >= 0 && !ends.includes(end)) ends.push(end);
    }
    if (!ends.includes(chatLen - 1)) ends.push(chatLen - 1);

    const rows = [];
    for (const end of ends) {
        const t0 = performance.now();
        // 1. extract（多源合并，与 runModulePipeline 一致）
        let rawCount = 0;
        const rawModules = [];
        for (const { impl } of getActiveSources()) {
            const part = impl.getRawModules({ start: 0, end, filters: null });
            if (Array.isArray(part)) {
                rawModules.push(...part);
                rawCount += part.length;
            }
        }
        const t1 = performance.now();
        // 2. process（normalize+dedup+time+sort+level+merge）
        const structured = processAutoModules(rawModules);
        const t2 = performance.now();
        // 3. build（模块字符串构建）
        buildModulesString(structured, false, false, false, false);
        const t3 = performance.now();

        rows.push({
            '楼层数': end + 1,
            'raw数': rawCount,
            'extract_ms': +(t1 - t0).toFixed(2),
            'process_ms': +(t2 - t1).toFixed(2),
            'build_ms': +(t3 - t2).toFixed(2),
            'total_ms': +(t3 - t0).toFixed(2),
        });
    }
    infoLog('[Perf] 管线阶段耗时采样（每档 = 从楼层 0 到 end 全量跑）：', rows);
    console.table(rows);
    return rows;
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

    // 1.7 管线性能采样（F 二期快照前置实测：判断 extract/process 耗时占比）
    const btnProfile = doc.getElementById('btn-debug-pipeline-profile');
    if (btnProfile) {
        const newBtn = btnProfile.cloneNode(true);
        newBtn.textContent = translate('ccore_btn_debug_pipeline_profile');
        btnProfile.parentNode.replaceChild(newBtn, btnProfile);
        newBtn.addEventListener('click', async () => {
            newBtn.disabled = true;
            try {
                await profilePipelineStages();
                if (typeof toastr !== 'undefined') {
                    toastr.success(translate('ccore_btn_debug_pipeline_profile') + ' 完成，结果见控制台');
                }
            } catch (err) {
                errorLog('[Perf] 性能采样失败:', err);
                if (typeof toastr !== 'undefined') {
                    toastr.error(err.message);
                }
            } finally {
                newBtn.disabled = false;
            }
        });
    }

    // 1.8 诊断 occurrence 缓存 + 提取链路（阶段 1 调试）
    const btnDiag = doc.getElementById('btn-debug-occurrence-diag');
    if (btnDiag) {
        const newBtn = btnDiag.cloneNode(true);
        newBtn.textContent = translate('ccore_btn_debug_occurrence_diag');
        btnDiag.parentNode.replaceChild(newBtn, btnDiag);
        newBtn.addEventListener('click', async () => {
            newBtn.disabled = true;
            try {
                await diagnoseOccurrenceCache();
                if (typeof toastr !== 'undefined') {
                    toastr.success(translate('ccore_btn_debug_occurrence_diag') + ' 完成，结果见控制台');
                }
            } catch (err) {
                errorLog('[Occurrence诊断] 失败:', err);
                if (typeof toastr !== 'undefined') {
                    toastr.error(err.message);
                }
            } finally {
                newBtn.disabled = false;
            }
        });
    }

    // 1.9 快照重建验证（阶段 2：rebuildFrom vs 全量管线）
    const btnVerify = doc.getElementById('btn-verify-snapshot-rebuild');
    if (btnVerify) {
        const newBtn = btnVerify.cloneNode(true);
        newBtn.textContent = translate('ccore_btn_verify_snapshot_rebuild');
        btnVerify.parentNode.replaceChild(newBtn, btnVerify);
        newBtn.addEventListener('click', async () => {
            newBtn.disabled = true;
            try {
                await verifySnapshotRebuild();
                if (typeof toastr !== 'undefined') {
                    toastr.success(translate('ccore_btn_verify_snapshot_rebuild') + ' 完成，结果见控制台');
                }
            } catch (err) {
                errorLog('[快照验证] 失败:', err);
                if (typeof toastr !== 'undefined') {
                    toastr.error(err.message);
                }
            } finally {
                newBtn.disabled = false;
            }
        });
    }

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
