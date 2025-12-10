/**
 * 上下文底部UI管理模块
 * 实现将UI插入到mes_text下方的功能
 * 细长折叠栏样式版本
 */

import { debugLog, errorLog, infoLog } from '../utils/logger.js';
// import styleCombiner from '../modules/styleCombiner.js';
import { insertCombinedStylesToDetails } from '../modules/styleCombiner.js';
import { processModuleData } from './moduleProcessor.js';
import { groupProcessResultByMessageIndex, chat_metadata, getContext, configManager } from '../index.js';
// import { processQuotes } from '../utils/textConverter.js';

// 上下文底部UI容器ID
const CONTEXT_BOTTOM_CONTAINER_ID = 'CONTEXT_BOTTOM_CONTAINER_ID';
// 消息底部容器ID
const CONTEXT_MSG_CONTAINER_ID = 'CONTEXT_MSG_CONTAINER_ID';

/**
 * 加载外部CSS样式文件
 */
function loadContextUICSS() {
    // 检查样式是否已加载
    if (document.getElementById('continuity-context-bottom-css')) {
        return;
    }

    // 创建link元素加载CSS
    const link = document.createElement('link');
    link.id = 'continuity-context-bottom-css';
    link.rel = 'stylesheet';
    link.href = './scripts/extensions/third-party/ST-Continuity-Core/assets/css/context-bottom-ui.css';

    // 添加到head
    document.head.appendChild(link);
    debugLog('上下文底部UI样式已加载');
}

/**
 * 加载HTML模板内容
 * 使用fetch从外部文件加载HTML模板
 * @returns {Promise<string>} HTML模板字符串
 */
async function loadContextBottomUITemplate(containerId = CONTEXT_BOTTOM_CONTAINER_ID) {
    try {
        const response = await fetch('./scripts/extensions/third-party/ST-Continuity-Core/assets/html/context-bottom-ui.html');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const html = await response.text();
        debugLog('上下文底部UI模板已加载');
        return html;
    } catch (error) {
        console.error('加载UI模板失败:', error);
        // 如果外部文件加载失败，返回空字符串
        return ``;
    }
}

/**
 * 创建上下文底部UI容器
 * 使用外部HTML模板和CSS样式
 * @returns {Promise<HTMLElement>} 创建的容器元素
 */
async function createContextContainer(containerId = CONTEXT_BOTTOM_CONTAINER_ID, parentContainer = null) {
    // 检查容器是否已存在
    // 优先在parentContainer中查找，如果parentContainer不存在则在document中查找
    let existingContainer = null;
    if (parentContainer) {
        // 处理jQuery对象和DOM元素
        if (typeof parentContainer.find === 'function') {
            // parentContainer是jQuery对象
            existingContainer = parentContainer.find(`#${containerId}`)[0];
        } else if (typeof parentContainer.querySelector === 'function') {
            // parentContainer是DOM元素
            existingContainer = parentContainer.querySelector(`#${containerId}`);
        }
    } else {
        // 在document中查找容器
        existingContainer = document.getElementById(containerId);
    }

    if (existingContainer) {
        debugLog('上下文底部UI容器已存在');
        return existingContainer;
    }

    debugLog(`创建上下文底部UI容器 ${containerId}`);

    // 加载CSS样式
    loadContextUICSS();

    // 加载HTML模板
    const template = await loadContextBottomUITemplate();

    // 创建容器元素
    const container = document.createElement('div');
    container.id = containerId;
    container.innerHTML = template;

    // 为UI容器添加一个特殊的类名，用于样式应用
    container.classList.add('continuity-context-bottom-ui');

    return container;
}

/**
 * 查找合适的消息容器用于插入UI
 * 优先使用last_mes，如果是用户消息则向上查找AI消息
 */
function findSuitableMessageContainer(excludeUserMes = false) {
    // 使用选择器定位最后一个消息容器
    const lastMessageContainer = $('.last_mes');

    if (lastMessageContainer.length === 0) {
        debugLog('当前没有last_mes容器');
        return null;
    }

    if (!excludeUserMes) {
        return lastMessageContainer;
    }

    // 检查last_mes是否为用户消息
    const isUserMessage = lastMessageContainer.attr('is_user') === 'true';

    if (!isUserMessage) {
        // 如果不是用户消息，直接返回
        return lastMessageContainer;
    }

    debugLog('last_mes是用户消息，向上查找AI消息');

    // 如果是用户消息，向上查找最近的AI消息
    const allMessages = $('.mes');
    let suitableContainer = null;

    // 从后向前遍历所有消息
    for (let i = allMessages.length - 1; i >= 0; i--) {
        const message = $(allMessages[i]);
        const isCurrentUserMessage = message.attr('is_user') === 'true';

        if (!isCurrentUserMessage) {
            // 找到AI消息
            suitableContainer = message;
            debugLog('找到AI消息容器');
            break;
        }
    }

    return suitableContainer;
}

let isUpdatingMsgUI = false;

/**
 * 将UI插入到mes_text下方，确保折叠功能正常工作
 */
export async function updateUItoMsgBottom() {
    try {
        // 设置插入标记
        isUpdatingMsgUI = true;

        // 检查jQuery是否可用
        if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
            errorLog('jQuery未加载，无法使用选择器');
            isUpdatingMsgUI = false;
            return false;
        }

        // 提取全部聊天记录的所有模块数据（一次性获取）
        const extractParams = {
            startIndex: 0,
            endIndex: null, // null表示提取到最新楼层
            moduleFilters: getMsgUIFilteredModuleConfigs() // 只提取符合条件的模块
        };

        const processResult = updateModulesDataAndStyles(null, extractParams, false);
        if (!processResult) {
            errorLog('更新上下文底部UI失败');
            isUpdatingRenderUI = false;
            return false;
        }
        // debugLog('按messageIndex分组前的模块数据:', processResult);
        // 按messageIndex分组处理模块数据
        const groupedByMessageIndex = groupProcessResultByMessageIndex(processResult);
        // infoLog('[CUSTOM STYLES]按messageIndex分组前后的模块数据:', processResult, groupedByMessageIndex);

        const containers = getCurrentMessageContainer();

        for (let i = containers.length - 1; i >= 0; i--) {
            const message = $(containers[i]);
            const isUser = message.attr('is_user') === 'true';
            if (isUser) {
                continue;
            }

            const messageText = message.find('.mes_text');
            // 从分组数据中获取当前消息的模块数据
            const messageIndex = message.attr('mesid');
            const modulesForThisMessage = groupedByMessageIndex[messageIndex] || [];

            let container = message.find(`#${CONTEXT_MSG_CONTAINER_ID}`)[0];
            if (!container) {
                container = await createContextContainer(CONTEXT_MSG_CONTAINER_ID, message);
                messageText.after(container);
            }

            const contentContainer = container?.querySelector('.modules-content-container');

            // 为内容容器设置最大高度
            if (contentContainer) {
                contentContainer.style.maxHeight = '500px';
            }

            // 清空容器内的所有内容
            if (contentContainer) {
                contentContainer.innerHTML = '';
                debugLog('[CUSTOM STYLES] 已清空模块内容容器');
            }

            debugLog(messageIndex, `当前消息的模块数据:`, modulesForThisMessage);

            renderSingleMessageContextBottomUI(modulesForThisMessage, contentContainer, message)
        }

        isUpdatingMsgUI = false;
        return true;
    } catch (error) {
        errorLog('插入UI到mes_text下方失败:', error);
        isUpdatingMsgUI = false;
        return false;
    }
}

function renderSingleMessageContextBottomUI(messages, container, mes) {
    try {
        // 检查参数有效性
        if (!messages || !container || container.length === 0) {
            debugLog('renderSingleMessageContext: 参数无效，跳过渲染');
            return;
        }

        // const swipeId = mes.attr('swipeid');
        // const renderSwipe = mes.attr('renderSwipe');
        // // 检查是否已渲染过
        // if (renderSwipe === swipeId) {
        //     debugLog('renderSingleMessageContext: 消息已渲染过，跳过重复渲染');
        //     return;
        // }


        if (messages.length > 0) {
            messages.forEach((entry) => {
                // 检查是否有moduleData.raw内容用于匹配
                if (!entry.moduleData || !entry.moduleData.raw || typeof entry.moduleData.raw !== 'string' || entry.moduleData.raw.trim() === '') {
                    debugLog('renderSingleMessageContext: entry.moduleData.raw为空或无效，无法匹配原文');
                }
                // 检查是否有customStyles内容用于替换
                else if (!entry.customStyles || typeof entry.customStyles !== 'string' || entry.customStyles.trim() === '') {
                    // debugLog('renderSingleMessageContext: entry.customStyles为空或无效，无法替换');
                    container.innerHTML += `<div>${entry.moduleData.raw}</div>`;
                }
                // 使用entry.moduleData.raw来匹配mes_text div内部的原文，包括后面的<br>标签
                else {
                    // container.append(entry.customStyles);
                    container.innerHTML += `${entry.customStyles}`;
                }
            });
            // container.html(newHtml);
            // 渲染成功后设置renderSwipe属性
            // mes.attr('renderSwipe', swipeId);
        }
    } catch (error) {
        errorLog('renderSingleMessageContext: 渲染单个消息上下文失败:', error);
        // mes.attr('renderSwipe', '');
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
        // 防止重复插入
        // if (isUpdatingContextBottomUI) {
        //     debugLog('上下文底部UI插入操作正在进行中，跳过重复调用');
        //     return false;
        // }
        // 设置插入标记
        isUpdatingContextBottomUI = true;

        // 检查jQuery是否可用
        if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
            errorLog('jQuery未加载，无法使用选择器');
            isUpdatingContextBottomUI = false;
            return false;
        }

        // 检查UI是否已经存在且位置正确
        let container = document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);
        const chatContainer = $('#chat');
        const lastMessageContainer = findSuitableMessageContainer();


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

        updateModulesDataAndStyles(container, extractParams);
        isUpdatingContextBottomUI = false;
        return true;

    } catch (error) {
        errorLog('更新上下文底部UI失败:', error);
        isUpdatingContextBottomUI = false;
        return false;
    }
}

/**
 * 获取上下文底部UI需要显示的模块配置
 * @returns {Array} 符合条件的模块配置数组
 */
function getContextBottomUIFilteredModuleConfigs() {
    // 获取所有模块配置
    const allModuleConfigs = configManager.getModules();
    // 过滤出符合条件的模块：outputPosition为after_body且outputMode为full的模块，和所有outputMode为incremental的模块
    const filteredModuleConfigs = allModuleConfigs.filter(config => {
        const result = (config.outputPosition === 'after_body' && config.outputMode === 'full' && config.retainLayers != 0) ||
            config.outputMode === 'incremental';
        // debugLog(`模块 ${config.name} 过滤结果: ${result}, outputPosition: ${config.outputPosition}, outputMode: ${config.outputMode}`);
        return result;
    });
    debugLog(`[CUSTOM STYLES] 总模块数: ${allModuleConfigs.length}, 过滤后模块数: ${filteredModuleConfigs.length}`);
    debugLog(`[CUSTOM STYLES] 过滤后的模块列表: ${filteredModuleConfigs.map(config => config.name).join(', ')}`);
    // 构建模块过滤条件数组
    const moduleFilters = filteredModuleConfigs.map(config => ({
        name: config.name,
        compatibleModuleNames: config.compatibleModuleNames || []
    }));
    return moduleFilters;
}

/**
 * 获取消息底部UI需要显示的模块配置
 * @returns {Array} 符合条件的模块配置数组
 */
function getMsgUIFilteredModuleConfigs() {
    // 获取所有模块配置
    const allModuleConfigs = configManager.getModules();
    // 过滤出符合条件的模块：outputPosition为after_body且outputMode为full的模块，和所有outputMode为incremental的模块
    const filteredModuleConfigs = allModuleConfigs.filter(config => {
        const result = (config.outputPosition === 'after_body') ||
            config.outputMode === 'incremental';
        // debugLog(`模块 ${config.name} 过滤结果: ${result}, outputPosition: ${config.outputPosition}, outputMode: ${config.outputMode}`);
        return result;
    });
    debugLog(`[CUSTOM STYLES] 总模块数: ${allModuleConfigs.length}, 过滤后模块数: ${filteredModuleConfigs.length}`);
    debugLog(`[CUSTOM STYLES] 过滤后的模块列表: ${filteredModuleConfigs.map(config => config.name).join(', ')}`);
    // 构建模块过滤条件数组
    const moduleFilters = filteredModuleConfigs.map(config => ({
        name: config.name,
        compatibleModuleNames: config.compatibleModuleNames || []
    }));
    return moduleFilters;
}

/**
 * 获取消息内部渲染UI需要显示的模块配置
 * @returns {Array} 符合条件的模块配置数组
 */
function getRenderUIFilteredModuleConfigs() {
    // 获取所有模块配置
    const allModuleConfigs = configManager.getModules();
    // 过滤出符合条件的模块：outputPosition为after_body且outputMode为full的模块，和所有outputMode为incremental的模块
    const filteredModuleConfigs = allModuleConfigs.filter(config => {
        const result = config.outputPosition !== 'after_body';
        // debugLog(`模块 ${config.name} 过滤结果: ${result}, outputPosition: ${config.outputPosition}, outputMode: ${config.outputMode}`);
        return result;
    });
    debugLog(`[CUSTOM STYLES] 渲染 总模块数: ${allModuleConfigs.length}, 过滤后模块数: ${filteredModuleConfigs.length}`);
    debugLog(`[CUSTOM STYLES] 渲染 过滤后的模块列表: ${filteredModuleConfigs.map(config => config.name).join(', ')}`);
    // 构建模块过滤条件数组
    const moduleFilters = filteredModuleConfigs.map(config => ({
        name: config.name,
        compatibleModuleNames: config.compatibleModuleNames || []
    }));
    return moduleFilters;
}

/**
 * 插入模块数据和样式到模块内容容器
 * @param {HTMLElement} container 上下文底部UI元素
 */
export function updateModulesDataAndStyles(container, extractParams, isUseContainer = true) {
    try {
        debugLog('[CUSTOM STYLES] 开始更新模块数据和样式', container);

        const selectedModuleNames = extractParams.moduleFilters.map(config => config.name);

        // 一次性获取所有模块数据
        const processResult = processModuleData(
            extractParams,
            'auto', // 自动处理类型
            selectedModuleNames
        );
        debugLog('[CUSTOM STYLES] 提取结果:', processResult);

        const contentContainer = container?.querySelector('.modules-content-container');

        // 清空容器内的所有内容
        if (contentContainer) {
            contentContainer.innerHTML = '';
            debugLog('[CUSTOM STYLES] 已清空模块内容容器');
        }

        Object.keys(processResult.content).forEach(moduleName => {
            const moduleData = processResult.content[moduleName];
            const moduleConfig = moduleData.moduleConfig;
            if (!moduleConfig) {
                debugLog(`[CUSTOM STYLES] 模块 ${moduleName} 没有配置`);
                return;
            }
            debugLog(`[CUSTOM STYLES] 处理模块 ${moduleName}`, moduleData);

            // 获取处理后的样式字符串
            insertCombinedStylesToDetails(moduleData);

            if (isUseContainer) {
                // 插入模块数据和样式到模块内容容器
                if (contentContainer) {
                    if (moduleData.containerStyles) {
                        contentContainer.innerHTML += `${moduleData.containerStyles}`;
                        debugLog(`模块 ${moduleName} 的样式已插入到模块内容容器`);
                    }
                    else {
                        // 创建模块数据元素
                        const moduleDataElement = document.createElement('div');
                        moduleDataElement.className = 'module-data-container';
                        let moduleStrings = moduleData?.data?.map(item => item.moduleString || JSON.stringify(item)).join('\n') || '';
                        // 添加处理后的模块数据
                        const moduleContent = `<details class="module-data"><summary>${moduleConfig.displayName || moduleConfig.name} (${moduleData.moduleCount})</summary><div class="module-data-content" style="white-space: pre-wrap;max-height: 200px;">${moduleStrings}</div></details>`;
                        moduleDataElement.innerHTML = moduleContent;
                        contentContainer.appendChild(moduleDataElement);
                        debugLog(`模块 ${moduleName} 的数据已插入到模块内容容器`);
                    }
                }
                debugLog('模块数据和样式已插入到模块内容容器');
            }
        });
        return processResult;
    } catch (error) {
        errorLog('插入/更新模块数据和样式到模块内容容器失败:', error);
        return null;
    }
}

/**
 * 从上下文底部移除UI
 */
export function removeUIfromContextBottom() {
    try {
        const container = document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);
        const msgContainer = document.getElementById(CONTEXT_MSG_CONTAINER_ID);
        if (container) {
            container.remove();
            debugLog('UI已从上下文底部移除');
        }
        if (msgContainer) {
            msgContainer.remove();
            debugLog('消息底部UI已从上下文底部移除');
        }
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

export function renderCurrentMessageContext() {
    try {
        // 防止重复插入
        // if (isUpdatingRenderUI) {
        //     debugLog('渲染消息内部UI操作正在进行中，跳过重复调用');
        //     return false;
        // }
        // 设置插入标记
        isUpdatingRenderUI = true;

        // 检查jQuery是否可用
        if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
            errorLog('jQuery未加载，无法使用选择器');
            isUpdatingRenderUI = false;
            return false;
        }

        const containers = getCurrentMessageContainer();
        const startIndex = $(containers[0]).attr('mesid');
        const endIndex = $(containers[containers.length - 1]).attr('mesid');

        // 提取全部聊天记录的所有模块数据（一次性获取）
        const extractParams = {
            startIndex: 0,
            endIndex: null, // null表示提取到最新楼层
            moduleFilters: getRenderUIFilteredModuleConfigs() // 只提取符合条件的模块
        };
        // todo 可以获取的时候获取所有index，然后下面按messageIndex分组的时候过滤掉显示范围外的条目

        const processResult = updateModulesDataAndStyles(null, extractParams, false);
        if (!processResult) {
            errorLog('更新上下文底部UI失败');
            isUpdatingRenderUI = false;
            return false;
        }
        // debugLog('按messageIndex分组前的模块数据:', processResult);
        // 按messageIndex分组处理模块数据
        const groupedByMessageIndex = groupProcessResultByMessageIndex(processResult);
        // infoLog('[CUSTOM STYLES]按messageIndex分组前后的模块数据:', processResult, groupedByMessageIndex);

        for (let i = containers.length - 1; i >= 0; i--) {
            const message = $(containers[i]);
            const messageText = message.find('.mes_text');

            // 从分组数据中获取当前消息的模块数据
            const messageIndex = message.attr('mesid');
            const modulesForThisMessage = groupedByMessageIndex[messageIndex] || [];

            debugLog(messageIndex, `当前消息的模块数据:`, modulesForThisMessage);

            renderSingleMessageContext(modulesForThisMessage, messageText, message)
        }

        isUpdatingRenderUI = false;
        return true;

    } catch (error) {
        errorLog('更新上下文底部UI失败:', error);
        isUpdatingRenderUI = false;
        return false;
    }
}

export function renderSingleMessageContext(messages, container, mes) {
    try {
        // 检查参数有效性
        if (!messages || !container || container.length === 0) {
            debugLog('renderSingleMessageContext: 参数无效，跳过渲染');
            return;
        }

        const swipeId = mes.attr('swipeid');
        const renderSwipe = mes.attr('renderSwipe');
        // 检查是否已渲染过
        if (renderSwipe === swipeId) {
            debugLog('renderSingleMessageContext: 消息已渲染过，跳过重复渲染');
            return;
        }

        // 获取mes_text div内部的原文内容
        const originalText = container.html();
        let newHtml = originalText;

        if (messages.length > 0) {
            messages.forEach((entry) => {
                // 检查是否有moduleData.raw内容用于匹配
                if (!entry.moduleData || !entry.moduleData.raw || typeof entry.moduleData.raw !== 'string' || entry.moduleData.raw.trim() === '') {
                    debugLog('renderSingleMessageContext: entry.moduleData.raw为空或无效，无法匹配原文');
                }
                // 检查是否有customStyles内容用于替换
                else if (!entry.customStyles || typeof entry.customStyles !== 'string' || entry.customStyles.trim() === '') {
                    debugLog('renderSingleMessageContext: entry.customStyles为空或无效，无法替换');
                }
                // 使用entry.moduleData.raw来匹配mes_text div内部的原文，包括后面的<br>标签
                else {
                    // 先使用processQuotes处理raw文本，如果匹配不上就直接返回原文
                    // const processedRaw = processQuotes(entry.moduleData.raw);
                    const processedRaw = entry.moduleData.processedRaw;

                    // infoLog('renderSingleMessageContext: 处理后的raw文本:', processedRaw, entry);
                    // 构建匹配模式：entry.moduleData.raw后面可能跟着0个或多个<br>标签
                    const rawPattern = new RegExp(processedRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:<br>)*', 'g');

                    // if (rawPattern.test(newHtml)) {
                    const matchResult = rawPattern.exec(newHtml);
                    if (matchResult) {
                        const matchedText = matchResult[0].replace(processedRaw + '<br>', processedRaw);
                        // 如果匹配上了，用customStyles替换匹配到的内容（包括后面的<br>标签）
                        newHtml = newHtml.replaceAll(matchedText, entry.customStyles); //因为有可能出现同模块在一个页面多次的情况
                        debugLog('renderSingleMessageContext: 成功匹配并替换了mes_text内容', entry, matchedText, processedRaw);
                        // }
                    } else {
                        debugLog('renderSingleMessageContext: 未找到匹配的原文内容，跳过替换', entry, processedRaw);
                    }
                }
            });
            container.html(newHtml);
            // 渲染成功后设置renderSwipe属性
            mes.attr('renderSwipe', swipeId);
        }
    } catch (error) {
        errorLog('renderSingleMessageContext: 渲染单个消息上下文失败:', error);
        mes.attr('renderSwipe', '');
    }
}

export function getCurrentMessageContainer() {
    // 只获取$('#chat')内的.mes容器元素
    return jQuery('#chat .mes');
}

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
    debugLog('[UI EVENTS]UpdateUI: 开始更新上下文底部UI');
    if (configManager.isExtensionEnabled()) {
        if (!isInChatPage()) {
            debugLog('[PAGE_CHECK] 当前不在聊天页面，不插入UI');
            return false;
        }

        if (!isUpdatingContextBottomUI) {
            isUpdatingContextBottomUI = true;
            // 处理底部UI（统合的模块内容）
            (async () => {
                await updateUItoContextBottom();
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
    debugLog('[UI EVENTS]UpdateUI: 开始更新消息底部UI');
    if (configManager.isExtensionEnabled()) {
        if (!isInChatPage()) {
            debugLog('[PAGE_CHECK] 当前不在聊天页面，不插入UI');
            return false;
        }

        if (!isUpdatingMsgUI) {
            isUpdatingMsgUI = true;
            (async () => {
                // 处理消息中UI（每层的模块内容）
                await updateUItoMsgBottom();
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
    debugLog('[UI EVENTS]RenderUI: 开始渲染当前消息上下文');
    if (configManager.isExtensionEnabled()) {
        if (!isInChatPage()) {
            debugLog('[PAGE_CHECK] 当前不在聊天页面，不渲染UI');
            return false;
        }

        if (!isUpdatingRenderUI) {
            isUpdatingRenderUI = true;
            // 渲染消息内UI（每层的模块内容）- 延迟执行
            // setTimeout(() => {
            (async () => {
                await renderCurrentMessageContext();
            })();
            // }, 1000); // 延迟100毫秒执行
        }
        else {
            debugLog('渲染当前消息上下文操作正在进行中，跳过重复调用');
        }
    } else {
        // debugLog("[UI EVENTS][CHAT_CHANGED]插件已禁用，移除UI");
        // removeUIfromContextBottom();
    }
}
