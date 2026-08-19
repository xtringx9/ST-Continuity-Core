/**
 * Continuity chat context UI coordinator.
 *
 * This module currently coordinates three display targets:
 * 1. context-bottom: a summary block after the latest suitable message.
 * 2. message-bottom: per-message blocks inserted after each .mes_text.
 * 3. message-inline: direct replacements inside .mes_text.
 *
 * Keep rendering infrastructure, module filtering, and inline replacement as
 * separate responsibilities when refactoring this file.
 */

import { debugLog, errorLog } from '../utils/logger.js';
import { getContext } from '../../../../../extensions.js';
import { groupProcessResultByMessageIndex } from './moduleProcessor.js';
import configManager from '../singleton/configManager.js';
import {
    CONTEXT_BOTTOM_CONTAINER_ID,
    CONTEXT_MSG_CONTAINER_ID,
    createContextContainer,
    findSuitableMessageContainer,
    getCurrentMessageContainer,
    removeContextUIContainers,
} from './context-ui/containerManager.js';
import { injectHtmlToIframe } from './context-ui/iframeRenderer.js';
import {
    getContextBottomUIFilteredModuleConfigs,
    getMsgUIFilteredModuleConfigs,
} from './context-ui/moduleFilters.js';
import { buildStyledProcessResult } from './context-ui/processResultBuilder.js';
import { renderCurrentMessageContext } from './context-ui/inlineMessageRenderer.js';
import { IframeModal } from '../shared/IframeModal.js';

// context-bottom-ui.css 路径（与原底部汇总一致，复用同一套样式）
const contextBottomCssUrl = new URL('../../assets/css/context-bottom-ui.css', import.meta.url).href;

// 汇总弹窗单例
let summaryModal = null;

// ---- Q1+Q2 调度器：合并 burst 事件 + 精准/后缀刷新 ----
// 数据层（moduleProcessor）始终全量提取，优化只发生在样式注入：只把 iframe 重注入脏消息集合。
const REFRESH_DEBOUNCE_MS = 80;
let scheduled = false;            // 单飞 + 防抖标记
let fullRefreshRequested = false;
let refreshFromIndex = null;      // number | null：suffix 起点（含）
const dirtyMesIds = new Set();    // 单条精准刷新集合

function recordRefreshRequest(kind, mesid) {
    if (kind === 'full') {
        fullRefreshRequested = true;
    } else if (kind === 'suffix') {
        const x = Number(mesid);
        if (!Number.isNaN(x)) {
            refreshFromIndex = (refreshFromIndex === null) ? x : Math.min(refreshFromIndex, x);
        } else {
            fullRefreshRequested = true; // 无 mesid 兜底全量
        }
    } else { // single
        if (mesid != null && mesid !== 'undefined') {
            dirtyMesIds.add(String(mesid));
        } else {
            fullRefreshRequested = true;
        }
    }
}

function collectTargetMesIds() {
    const wantFull = fullRefreshRequested;
    const fromIdx = refreshFromIndex;
    const singles = [...dirtyMesIds];
    // 取出即清空，使 flush 期间的迟达事件能累计进下一轮
    fullRefreshRequested = false;
    refreshFromIndex = null;
    dirtyMesIds.clear();

    if (wantFull) return null; // null = 全量

    const ids = new Set(singles);
    if (fromIdx !== null) {
        document.querySelectorAll('#chat .mes').forEach(el => {
            const id = Number(el.getAttribute('mesid'));
            if (!Number.isNaN(id) && id >= fromIdx) ids.add(String(id));
        });
    }
    return ids.size > 0 ? [...ids] : null; // 空集合兜底全量
}

async function flushMsgBottom() {
    const targetMesIds = collectTargetMesIds();
    await updateUItoMsgBottom(targetMesIds);
    // trailing：flush 期间又有事件累计则再排一轮，否则释放单飞标记
    if (fullRefreshRequested || refreshFromIndex !== null || dirtyMesIds.size > 0) {
        setTimeout(flushMsgBottom, REFRESH_DEBOUNCE_MS);
    } else {
        scheduled = false;
    }
}

/**
 * 事件入口：合并 burst 事件，并按事件类型决定刷新范围。
 * @param {'full'|'suffix'|'single'} kind
 * @param {string|number} [mesid] 带 mesid 的事件（RENDERED/SWIPED/EDITED）传入
 */
export function scheduleMsgBottom(kind, mesid) {
    if (!configManager.isLoaded) return;
    if (!configManager.isExtensionEnabled()) {
        removeUIfromContextBottom();
        return;
    }
    if (!isInChatPage()) {
        debugLog('[PAGE_CHECK] 当前不在聊天页面，不插入UI');
        return;
    }
    recordRefreshRequest(kind, mesid);
    if (scheduled) return;
    scheduled = true;
    setTimeout(flushMsgBottom, REFRESH_DEBOUNCE_MS);
}

/**
 * 将UI插入到mes_text下方。
 * @param {string[]|null} targetMesIds 需要重注入样式的 mesid 集合；null = 全部消息。
 * 数据层始终全量提取（moduleProcessor 不支持部分刷新），优化点在样式注入范围。
 */
export async function updateUItoMsgBottom(targetMesIds = null) {
    try {
        // 检查jQuery是否可用
        if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
            errorLog('jQuery未加载，无法使用选择器');
            return false;
        }

        // 提取全部聊天记录的所有模块数据（一次性获取）
        const extractParams = {
            startIndex: 0,
            endIndex: null, // null表示提取到最新楼层
            moduleFilters: getMsgUIFilteredModuleConfigs() // 只提取符合条件的模块
        };

        const processResult = buildStyledProcessResult(null, extractParams);
        if (!processResult) {
            errorLog('更新上下文底部UI失败');
            return false;
        }
        // debugLog('按messageIndex分组前的模块数据:', processResult);
        // 按messageIndex分组处理模块数据
        const groupedByMessageIndex = groupProcessResultByMessageIndex(processResult, false, false);
        debugLog('[CUSTOM STYLES]按messageIndex分组前后的模块数据:', processResult, groupedByMessageIndex);

        // 仅选取需要重注入样式的消息容器（Q1：精准/后缀刷新，避免对全部消息重建 iframe）
        let containers;
        if (targetMesIds === null) {
            containers = getCurrentMessageContainer();
        } else {
            containers = targetMesIds
                .map(id => document.querySelector(`#chat .mes[mesid="${CSS.escape(String(id))}"]`))
                .filter(Boolean);
        }

        for (let i = containers.length - 1; i >= 0; i--) {
            const message = $(containers[i]);
            // const isUser = message.attr('is_user') === 'true';
            // if (isUser) {
            //     continue;
            // }

            const messageText = message.find('.mes_text');
            // 从分组数据中获取当前消息的模块数据
            const messageIndex = message.attr('mesid');
            const modulesForThisMessage = groupedByMessageIndex[messageIndex] || [];

            let container = message.find(`#${CONTEXT_MSG_CONTAINER_ID}`)[0];
            if (!container) {
                container = await createContextContainer(CONTEXT_MSG_CONTAINER_ID, message);
                messageText.after(container);
            }
            // 不在此处清空 container — 让 iframeRenderer 复用现有 iframe,避免每次重建导致的内存泄漏

            // const contentContainer = container?.querySelector('.modules-content-container');
            // const externalContainer = container?.querySelector('#continuity-context-bottom-external-container');

            // // 为内容容器设置最大高度
            // if (contentContainer) {
            //     contentContainer.style.maxHeight = '500px';
            // }

            // // 清空容器内的所有内容
            // if (contentContainer) {
            //     contentContainer.innerHTML = '';
            //     externalContainer.innerHTML = '';
            //     debugLog('[CUSTOM STYLES] 已清空模块内容容器');
            // }

            debugLog(messageIndex, `当前消息的模块数据:`, modulesForThisMessage);

            const { externalString, internalString } = renderSingleMessageContextBottomUI(modulesForThisMessage, container);
            let finalString = '';
            // todo 因为externalStyles和containerStyles有默认值${customStyles}所以永远不会走右边的样式，后面需要思考是否要优化
            if (externalString) {
                let externalStyles = configManager.getGlobalSettings().externalStyles || '<div id="continuity-context-bottom-external-container">\n                ${customStyles}\n            </div>';
                finalString += externalStyles.replace('${customStyles}', externalString);
            }
            if (internalString) {
                let containerStyles = configManager.getGlobalSettings().containerStyles || '<!-- 上下文底部UI模板 - 竖向按钮版本 -->\n            <div id="continuity-context-bottom-container" class="context-bottom-wrapper">\n                <details class="bottom-summary">\n                    <summary class="summary-title">Modules</summary>\n                    <div class="modules-content-container" style="max-height: 500px;">${customStyles}</div>\n                </details>\n            </div>';
                finalString += containerStyles.replace('${customStyles}', internalString);
            }
            finalString = finalString.replace('${mesid}', messageIndex);
            // 嵌套子模块二次替换：父模块 customStyles 内嵌的 [file|...] 原文 → 子模块样式
            // （消息底部区块只拼接 customStyles，不做嵌套替换，这里统一补上）
            finalString = replaceNestedRawWithStyles(finalString, modulesForThisMessage);
            injectHtmlToIframe(container, finalString);
        }

        return true;
    } catch (error) {
        errorLog('插入UI到mes_text下方失败:', error);
        return false;
    }
}

function renderSingleMessageContextBottomUI(messages, container) {
    try {
        // 检查参数有效性
        if (!messages || !container || container.length === 0) {
            debugLog('renderSingleMessageContext: 参数无效，跳过渲染');
            return { externalString: '', internalString: '' };
        }
        let externalString = '';
        let internalString = '';

        if (messages.length > 0) {
            // 提升到循环外，避免每条目都深拷贝全部模块 + 解析绑定
            const effectiveModules = configManager.getModules() || [];
            const moduleByName = new Map(effectiveModules.map(m => [m.name, m]));
            messages.forEach((entry) => {

                const config = moduleByName.get(entry.moduleName);

                // let finalContainer = config && config.isExternalDisplay ? externalContainer : container;
                let isExternal = (config && config.isExternalDisplay) ?? false;

                // 检查是否有moduleData.raw内容用于匹配
                if (!entry.moduleData || !entry.moduleData.raw || typeof entry.moduleData.raw !== 'string' || entry.moduleData.raw.trim() === '') {
                    debugLog('renderSingleMessageContext: entry.moduleData.raw为空或无效，无法匹配原文');
                }
                // 检查是否有customStyles内容用于替换
                else if (!entry.customStyles || typeof entry.customStyles !== 'string' || entry.customStyles.trim() === '') {
                    // debugLog('renderSingleMessageContext: entry.customStyles为空或无效，无法替换');
                    // finalContainer.innerHTML += `<div>${entry.moduleData.raw}</div>`;
                    if (isExternal) {
                        externalString += `<div>${entry.moduleData.raw}</div>`;
                    } else {
                        internalString += `<div>${entry.moduleData.raw}</div>`;
                    }
                }
                // 使用entry.moduleData.raw来匹配mes_text div内部的原文，包括后面的<br>标签
                else {
                    // container.append(entry.customStyles);
                    // finalContainer.innerHTML += `${entry.customStyles}`;
                    if (isExternal) {
                        externalString += `${entry.customStyles}`;
                    } else {
                        internalString += `${entry.customStyles}`;
                    }
                }
            });
        }
        return { externalString: externalString, internalString: internalString };
    } catch (error) {
        errorLog('renderSingleMessageContext: 渲染单个消息上下文失败:', error);
        return { externalString: '', internalString: '' };
    }
}

/**
 * 消息底部区块的嵌套子模块二次替换。
 * 背景：消息底部区块只把各条目的 customStyles 拼接输出（renderSingleMessageContextBottomUI），
 * 不处理嵌套——父模块（如 msg）的 customStyles 模板里内嵌的 `[file|...]` 原文不会被替换成
 * file 的样式（用户看到的还是原文）。这里在注入 iframe 前，对该层全部条目的
 * 「raw → customStyles」做字符串替换：父样式内部的子模块原文 → 子模块样式。
 *
 * ⚠️ 父模块自己的 raw 通常已不在 finalString（父样式已注入，raw 被 consume），
 * 找不到的 raw 不替换，安全。子模块 raw 在父样式内部，会被命中。
 * @param {string} html 注入前的 HTML
 * @param {Array} messages 该层的模块条目（含 raw + customStyles）
 * @returns {string}
 */
function replaceNestedRawWithStyles(html, messages) {
    if (!html || !Array.isArray(messages) || messages.length === 0) return html;

    // ⚠️ 只替换「文本位置」的原文，跳过 HTML 属性值（如 data-raw="..."）。
    // 否则属性值里的 [file|...] 会被替换成含双引号的样式 HTML，破坏整个结构（爆样式代码）。
    // 实现：先把所有属性值用占位 token 保护起来 → 做文本替换 → 还原属性值。
    const attrPlaceholders = [];
    const PROTECT_RE = /([\w-]+=")([^"]*)(")/g;
    const protect = (str) => str.replace(PROTECT_RE, (m, pre, val, post) => {
        const token = `\u0000CCATTR${attrPlaceholders.length}\u0000`;
        attrPlaceholders.push(val);
        return pre + token + post;
    });
    const restore = (str) => str.replace(/\u0000CCATTR(\d+)\u0000/g, (m, i) => attrPlaceholders[Number(i)] ?? '');

    // 第一遍：把 HTML 里的属性值保护起来
    let result = protect(html);

    for (const entry of messages) {
        if (!entry?.moduleData?.raw || typeof entry.moduleData.raw !== 'string' || entry.moduleData.raw.trim() === '') continue;
        if (!entry.customStyles || typeof entry.customStyles !== 'string' || entry.customStyles.trim() === '') continue;
        const raw = entry.moduleData.raw;
        if (result.includes(raw)) {
            result = result.split(raw).join(entry.customStyles);
        } else {
            // 兜底：ST 可能把 ... 渲染为 …
            const normalized = raw.replace(/\.\.\./g, '…');
            if (normalized !== raw && result.includes(normalized)) {
                result = result.split(normalized).join(entry.customStyles);
            }
        }
    }

    // 还原属性值（注意：还原在替换之后，样式 HTML 里自身的属性不会被误伤）
    return restore(result);
}

// 防止重复插入的标记
let isUpdatingContextBottomUI = false;

/**
 * 将UI插入到上下文底部
 * 修改为插入到mes_text下方，确保折叠功能正常工作
 */
export async function updateUItoContextBottom() {
    try {
        // 检查jQuery是否可用
        if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
            errorLog('jQuery未加载，无法使用选择器');
            return false;
        }

        // 检查UI是否已经存在且位置正确
        let container = document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);
        const chatContainer = $('#chat');
        const lastMessageContainer = findSuitableMessageContainer();
        if (!lastMessageContainer) {
            return false;
        }

        // 提取全部聊天记录的所有模块数据（一次性获取）
        const extractParams = {
            startIndex: 0,
            endIndex: null, // null表示提取到最新楼层
            moduleFilters: getContextBottomUIFilteredModuleConfigs() // 只提取符合条件的模块
        };

        if (!container) {
            container = await createContextContainer(CONTEXT_BOTTOM_CONTAINER_ID);
            lastMessageContainer.after(container);
        }

        if (container) {
            // 检查UI是否在正确的容器中
            if (chatContainer) {
                const currentParent = $(container).parent();
                if (currentParent.is(chatContainer)) {
                    // 进一步检查是否在lastMessageContainer后面
                    const isAfterLastMessage = $(container).prev().is(lastMessageContainer);
                    if (isAfterLastMessage) {
                        debugLog('UI已在正确的chat容器中且在last mes后面，无需移动');
                    } else {
                        debugLog('UI在chat容器中但不在last mes后面，移动到last mes后面');
                        lastMessageContainer.after(container);
                        debugLog('UI已成功移动到last mes后面');
                    }
                } else {
                    debugLog('UI在错误的容器中，移动到新的chat容器中的last mes后面');
                    lastMessageContainer.after(container);
                    debugLog('UI已成功移动到last mes后面');
                }
            }
        }

        const processResult = buildStyledProcessResult(container, extractParams);
        if (!processResult) {
            errorLog('更新上下文底部UI失败');
            return false;
        }

        if (container) {
            container.innerHTML = '';
            debugLog('[CUSTOM STYLES] 已清空模块内容容器');
        }

        const resultString = getModulesDataAndStyles(processResult);
        let finalString = configManager.getGlobalSettings().bottomStyles || '<!-- 上下文底部UI模板 - 竖向按钮版本 -->\n            <div id="continuity-context-bottom-container" class="context-bottom-wrapper">\n                <details class="bottom-summary">\n                    <summary class="summary-title">Modules</summary>\n                    <div class="modules-content-container">${customStyles}</div>\n                </details>\n            </div>';
        finalString = finalString.replace('${customStyles}', resultString);
        // container.innerHTML = finalString;
        injectHtmlToIframe(container, finalString);

        return true;

    } catch (error) {
        errorLog('更新上下文底部UI失败:', error);
        return false;
    }
}

function getModulesDataAndStyles(data) {
    let resultString = '';
    Object.keys(data.content).forEach(moduleName => {
        const moduleData = data.content[moduleName];
        const moduleConfig = moduleData.moduleConfig;
        if (!moduleConfig) {
            debugLog(`[CUSTOM STYLES] 模块 ${moduleName} 没有配置`);
            return;
        }
        if (moduleData.containerStyles) {
            resultString += `${moduleData.containerStyles}`;
            debugLog(`模块 ${moduleName} 的样式已插入到模块内容容器`);
        }
        else {
            let moduleStrings = moduleData?.data?.map(item => item.moduleString || JSON.stringify(item)).join('\n') || '';
            resultString += `<div class="module-data-container"><details class="module-data"><summary>${moduleConfig.displayName || moduleConfig.name} (${moduleData.moduleCount})</summary><div class="module-data-content" style="white-space: pre-wrap;max-height: 200px;">${moduleStrings}</div></details></div>`;
            // // 创建模块数据元素
            // const moduleDataElement = document.createElement('div');
            // moduleDataElement.className = 'module-data-container';
            // // 添加处理后的模块数据
            // const moduleContent = `<details class="module-data"><summary>${moduleConfig.displayName || moduleConfig.name} (${moduleData.moduleCount})</summary><div class="module-data-content" style="white-space: pre-wrap;max-height: 200px;">${moduleStrings}</div></details>`;
            // moduleDataElement.innerHTML = moduleContent;
            // contentContainer.appendChild(moduleDataElement);
            // debugLog(`模块 ${moduleName} 的数据已插入到模块内容容器`);
        }
    });
    return resultString;
}

/**
 * 从上下文底部移除UI
 */
export function removeUIfromContextBottom() {
    try {
        removeContextUIContainers();
    } catch (error) {
        errorLog('从上下文底部移除UI失败:', error);
    }
}

/**
 * 检查是否在聊天页面
 *
 * 优先用上下文数据判断（比 DOM 检查更可靠）：
 * - characterId = this_chid，非聊天页时 undefined
 * - groupId = selected_group，群组聊天时有值
 * 两者均为 undefined 即非聊天页。再用 #chat 容器存在/可见做兜底。
 */
export function isInChatPage() {
    try {
        const ctx = getContext();
        if (ctx.characterId === undefined && ctx.groupId === null) {
            return false;
        }
        // if ($('.mes.fade').length > 0) return false; 这个是可能有用但不确定可靠性的条件检查
        // 兜底：检查聊天容器是否存在且可见
        const chatContainer = $('#chat');
        if (!chatContainer.length || chatContainer.css('display') === 'none') {
            return false;
        }

        return true;
    } catch (error) {
        errorLog('检查聊天页面状态失败:', error);
        return false;
    }
}

/**
 * 检查是否有有效的消息容器
 */
export function hasValidMessageContainer(needMesText = false) {
    try {
        // 查找合适的消息容器
        const lastMessageContainer = $('.mes');
        if (lastMessageContainer.length === 0) {
            return false;
        }

        if (needMesText) {
            // 检查消息容器是否有内容
            const messageText = lastMessageContainer.find('.mes_text');
            if (messageText.length === 0 || messageText.text().trim() === '') {
                return false;
            }
        }

        return true;
    } catch (error) {
        errorLog('检查消息容器状态失败:', error);
        return false;
    }
}

/**
 * 检查是否有有效的消息容器
 */
export function hasValidLastMessageContainer(needMesText = false) {
    try {
        // 查找合适的消息容器
        const lastMessageContainer = $('.last_mes');
        if (lastMessageContainer.length === 0) {
            return false;
        }

        if (needMesText) {
            // 检查消息容器是否有内容
            const messageText = lastMessageContainer.find('.mes_text');
            if (messageText.length === 0 || messageText.text().trim() === '') {
                return false;
            }
        }

        return true;
    } catch (error) {
        errorLog('检查消息容器状态失败:', error);
        return false;
    }
}

// /**
//  * 检测页面状态并插入UI
//  * 确保只有在合适的页面状态下才插入UI
//  */
// export function checkPageStateAndUpdateUI() {
//     try {
//         // 检查是否在聊天页面
//         if (!isInChatPage()) {
//             debugLog('[PAGE_CHECK] 当前不在聊天页面，不插入UI');
//             return false;
//         }

//         if (!isUpdatingContextBottomUI) {
//             isUpdatingContextBottomUI = true;
//             // 处理底部UI（统合的模块内容）
//             (async () => {
//                 await updateUItoContextBottom();
//             })();
//         }
//         else {
//             debugLog('上下文底部UI插入操作正在进行中，跳过重复调用');
//         }

//         if (!isUpdatingMsgUI) {
//             isUpdatingMsgUI = true;
//             (async () => {
//                 // 处理消息中UI（每层的模块内容）
//                 await updateUItoMsgBottom();
//             })();
//         }


//         if (!isUpdatingRenderUI) {
//             isUpdatingRenderUI = true;
//             // 渲染消息内UI（每层的模块内容）- 延迟执行
//             setTimeout(() => {
//                 (async () => {
//                     await renderCurrentMessageContext();
//                 })();
//             }, 100); // 延迟100毫秒执行
//         }
//         else {
//             debugLog('渲染消息内部UI操作正在进行中，跳过重复调用');
//         }

//     } catch (error) {
//         errorLog('[PAGE_CHECK] 检测页面状态并插入UI失败:', error);
//     }
// }

let isUpdatingRenderUI = false;

// export function UpdateUI() {
//     infoLog('UpdateUI: 开始更新上下文底部UI');
//     if (configManager.isExtensionEnabled()) {
//         debugLog("[UI EVENTS][CHAT_CHANGED]检测到聊天变更，检查页面状态并插入UI");
//         checkPageStateAndUpdateUI();
//     } else {
//         debugLog("[UI EVENTS][CHAT_CHANGED]插件已禁用，移除UI");
//         removeUIfromContextBottom();
//     }
// }

export function checkUItoContextBottom() {
    if (!configManager.isLoaded) return false;
    debugLog('[UI EVENTS]UpdateUI: 开始更新上下文底部UI');
    if (configManager.isExtensionEnabled()) {
        if (!isInChatPage()) {
            debugLog('[PAGE_CHECK] 当前不在聊天页面，不插入UI');
            return false;
        }

        if (!isUpdatingContextBottomUI) {
            isUpdatingContextBottomUI = true;
            (async () => {
                try {
                    await updateUItoContextBottom();
                } finally {
                    isUpdatingContextBottomUI = false;
                }
            })();
        }
        else {
            debugLog('上下文底部UI插入操作正在进行中，跳过重复调用');
        }
    } else {
        debugLog("[UI EVENTS][CHAT_CHANGED]插件已禁用，移除UI");
        removeUIfromContextBottom();
    }
}


/**
 * 兼容旧调用 / 手动全量刷新入口（设置保存、强制刷新等场景）。
 * 事件驱动的刷新统一走 scheduleMsgBottom。
 */
export function checkUItoMsgBottom() {
    scheduleMsgBottom('full');
}

/** 增量渲染延迟定时器（等待缓存 debounce 刷新完成，见 checkRenderCurrentMessageContext） */
let _renderDebounceTimer = null;

export function checkRenderCurrentMessageContext(mesid) {
    if (!configManager.isLoaded) return false;
    debugLog('[UI EVENTS]RenderUI: 开始渲染当前消息上下文', mesid);
    if (configManager.isExtensionEnabled()) {
        if (!isInChatPage()) {
            debugLog('[PAGE_CHECK] 当前不在聊天页面，不渲染UI');
            return false;
        }

        // mesid 支持三种形态：
        //   - 数组 [a,b] → 渲染这些层（条目后缀刷新等）
        //   - 单个数字 '5' → 只渲染该层（MESSAGE_SWIPED/RENDERED/UPDATED 等）
        //   - undefined/null/'' → 全量渲染（CHAT_CHANGED / MORE_MESSAGES_LOADED 等）
        let mesIds;
        if (Array.isArray(mesid)) {
            mesIds = mesid.map(Number).filter(n => Number.isFinite(n));
            if (mesIds.length === 0) mesIds = null;
        } else {
            const target = (mesid !== undefined && mesid !== null && mesid !== '') ? Number(mesid) : null;
            mesIds = Number.isNaN(target) || target === null ? null : [target];
        }

        const doRender = async () => {
            if (isUpdatingRenderUI) {
                debugLog('渲染当前消息上下文操作正在进行中，跳过重复调用');
                return;
            }
            isUpdatingRenderUI = true;
            try {
                await renderCurrentMessageContext(mesIds);
            } finally {
                isUpdatingRenderUI = false;
            }
        };

        if (mesIds === null) {
            // 全量渲染（CHAT_CHANGED 等）：立即执行
            doRender();
        } else {
            // ⚠️ 增量渲染（swipe 等）：moduleCacheManager 缓存 key 不含 swipe_id，
            // 切 swipe 后旧缓存仍命中 → 立即渲染会读到旧 swipe 内容，DOM 已是新内容
            // → 匹配失败不渲染。MESSAGE_SWIPED 事件已排队 80ms debounce 缓存刷新
            // （其 handler 在 initializeModuleCache 先注册，timer 先排队），
            // 这里把渲染延迟到 120ms（>80ms）之后执行，缓存已刷新 → 渲染读新内容。
            // 不主动跑全量，零额外开销；连续事件（swipe+render 等）被 clearTimeout 合并。
            clearTimeout(_renderDebounceTimer);
            _renderDebounceTimer = setTimeout(doRender, 120);
        }
    } else {
        // debugLog("[UI EVENTS][CHAT_CHANGED]插件已禁用，移除UI");
        // removeUIfromContextBottom();
    }
}



/**
 * 以弹窗形式打开模块汇总（替代原底部固定容器）
 * 每次打开实时渲染最新数据，主题与 module-editor 同步
 */
export function openContextBottomAsModal() {
    if (!configManager.isLoaded) return;
    if (!configManager.isExtensionEnabled()) return;

    // 实时渲染：提取全部聊天记录模块数据
    const extractParams = {
        startIndex: 0,
        endIndex: null,
        moduleFilters: getContextBottomUIFilteredModuleConfigs(),
    };
    const processResult = buildStyledProcessResult(null, extractParams);
    if (!processResult) {
        errorLog('汇总弹窗渲染失败：无数据');
        return;
    }

    const resultString = getModulesDataAndStyles(processResult);
    let bodyContent = configManager.getGlobalSettings().bottomStyles ||
        '<div id="continuity-context-bottom-container" class="context-bottom-wrapper"><details class="bottom-summary"><summary class="summary-title">Modules</summary><div class="modules-content-container">${customStyles}</div></details></div>';
    bodyContent = bodyContent.replace('${customStyles}', resultString);

    // interactionScript：toggle 变量显示功能（与 injectHtmlToIframe 一致）
    const interactionScript = `
    <script>
        window.toggleVariableDisplay = function(id) {
            const container = document.getElementById(id);
            if (!container) return;
            const currentSpan = container.querySelector('.cc-variable-change-current');
            const lastSpan = container.querySelector('.cc-variable-change-last');
            if (!currentSpan || !lastSpan) return;
            if (currentSpan.style.display !== 'none') {
                currentSpan.style.display = 'none';
                lastSpan.style.display = 'inline';
                container.title = '点击显示旧值：' + lastSpan.textContent;
            } else {
                currentSpan.style.display = 'inline';
                lastSpan.style.display = 'none';
                container.title = '点击显示新值：' + currentSpan.textContent;
            }
        };
    </script>`;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="${contextBottomCssUrl}">
<style>
body { margin: 0; padding: 8px; background: transparent; }
</style>
</head>
<body>
${bodyContent}
${interactionScript}
</body>
</html>`;

    // 单实例：同时只开一个
    if (!summaryModal) summaryModal = new IframeModal();
    summaryModal.open(null, '模块汇总', { srcdoc: html, variant: 'center' });

    // 汇总内容自带样式（context-bottom-ui.css），container 设透明避免深色背景透出
    const container = summaryModal.backdrop?.querySelector('.st-continuity-iframe-container');
    if (container) container.style.backgroundColor = 'transparent';
}
