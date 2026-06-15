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

let isUpdatingMsgUI = false;

/**
 * 将UI插入到mes_text下方，确保折叠功能正常工作
 */
export async function updateUItoMsgBottom() {
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

        const containers = getCurrentMessageContainer();

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
            if (container) {
                container.innerHTML = '';
                debugLog('[CUSTOM STYLES] 已清空模块内容容器');
            }

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
            messages.forEach((entry) => {

                const config = configManager.getModuleByName(entry.moduleName);

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
 */
export function isInChatPage() {
    try {
        // 检查是否存在聊天容器
        const chatContainer = $('#chat');
        if (!chatContainer.length) {
            return false;
        }

        // 检查聊天容器是否可见
        if (chatContainer.css('display') === 'none') {
            return false;
        }

        // 检查是否有消息容器
        const messageContainers = $('.mes');
        if (messageContainers.length === 0) {
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


export function checkUItoMsgBottom() {
    if (!configManager.isLoaded) return false;
    debugLog('[UI EVENTS]UpdateUI: 开始更新消息底部UI');
    if (configManager.isExtensionEnabled()) {
        if (!isInChatPage()) {
            debugLog('[PAGE_CHECK] 当前不在聊天页面，不插入UI');
            return false;
        }

        if (!isUpdatingMsgUI) {
            isUpdatingMsgUI = true;
            (async () => {
                try {
                    await updateUItoMsgBottom();
                } finally {
                    isUpdatingMsgUI = false;
                }
            })();
        }
        else {
            debugLog('消息底部UI插入操作正在进行中，跳过重复调用');
        }
    } else {
        debugLog("[UI EVENTS][CHAT_CHANGED]插件已禁用，移除UI");
        removeUIfromContextBottom();
    }
}

export function checkRenderCurrentMessageContext() {
    if (!configManager.isLoaded) return false;
    debugLog('[UI EVENTS]RenderUI: 开始渲染当前消息上下文');
    if (configManager.isExtensionEnabled()) {
        if (!isInChatPage()) {
            debugLog('[PAGE_CHECK] 当前不在聊天页面，不渲染UI');
            return false;
        }

        if (!isUpdatingRenderUI) {
            isUpdatingRenderUI = true;
            (async () => {
                try {
                    await renderCurrentMessageContext();
                } finally {
                    isUpdatingRenderUI = false;
                }
            })();
        }
        else {
            debugLog('渲染当前消息上下文操作正在进行中，跳过重复调用');
        }
    } else {
        // debugLog("[UI EVENTS][CHAT_CHANGED]插件已禁用，移除UI");
        // removeUIfromContextBottom();
    }
}
