/**
 * 上下文底部UI管理模块
 * 实现将UI插入到mes_text下方的功能
 * 细长折叠栏样式版本
 */

import { debugLog, errorLog, infoLog } from '../utils/logger.js';
import styleCombiner from '../modules/styleCombiner.js';
import { getCombinedStyles, insertCombinedStylesToDetails, clearStyleCombinerCache, getStyleCombinerStats, getAllModuleConfigs } from '../modules/styleCombiner.js';
import { ModuleProcessor } from './moduleProcessor.js';

// 上下文底部UI容器ID
const CONTEXT_BOTTOM_CONTAINER_ID = 'CONTEXT_BOTTOM_CONTAINER_ID';

/**
 * 加载外部CSS样式文件
 */
function loadContextBottomUICSS() {
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
async function loadContextBottomUITemplate() {
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
async function createContextBottomContainer() {
    // 检查容器是否已存在
    if (document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID)) {
        debugLog('上下文底部UI容器已存在');
        return document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);
    }

    // 加载CSS样式
    loadContextBottomUICSS();

    // 加载HTML模板
    const template = await loadContextBottomUITemplate();

    // 创建容器元素
    const container = document.createElement('div');
    container.id = CONTEXT_BOTTOM_CONTAINER_ID;
    container.innerHTML = template;

    return container;
}

/**
 * 查找合适的消息容器用于插入UI
 * 优先使用last_mes，如果是用户消息则向上查找AI消息
 */
function findSuitableMessageContainer() {
    // 使用选择器定位最后一个消息容器
    const lastMessageContainer = $('.last_mes');

    if (lastMessageContainer.length === 0) {
        debugLog('当前没有last_mes容器');
        return null;
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

// 防止重复插入的标记
let isInsertingUI = false;

/**
 * 将UI插入到上下文底部
 * 修改为插入到mes_text下方，确保折叠功能正常工作
 */
export function insertUItoContextBottom() {
    try {
        // 防止重复插入
        if (isInsertingUI) {
            debugLog('UI插入操作正在进行中，跳过重复调用');
            return false;
        }

        // 检查UI是否已经存在且位置正确
        const existingUI = document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);
        if (existingUI) {
            // 检查UI是否在正确的容器中
            const messageContainer = findSuitableMessageContainer();
            if (messageContainer) {
                const mesBlock = messageContainer.find('.mes_block');
                const messageText = messageContainer.find('.mes_text');

                if (mesBlock.length > 0) {
                    const currentParent = $(existingUI).parent();
                    if (currentParent.is(mesBlock) && currentParent.find('.mes_text').next().is(existingUI)) {
                        debugLog('UI已在正确的mes_text下方位置，无需重新插入');
                        return true;
                    }
                } else {
                    const currentParent = $(existingUI).parent();
                    if (currentParent.is(messageContainer)) {
                        debugLog('UI已在正确的消息容器中，无需重新插入');
                        return true;
                    }
                }
            }
        }

        // 设置插入标记
        isInsertingUI = true;

        // 使用setTimeout确保DOM完全渲染后再插入
        setTimeout(() => {
            try {
                // 检查jQuery是否可用
                if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
                    errorLog('jQuery未加载，无法使用选择器');
                    isInsertingUI = false;
                    return false;
                }

                // 查找合适的消息容器
                const messageContainer = findSuitableMessageContainer();

                if (!messageContainer) {
                    debugLog('没有找到合适的消息容器，等待下次事件触发');
                    isInsertingUI = false;
                    return false;
                }

                // 额外检查：确保容器包含消息内容
                const messageText = messageContainer.find('.mes_text');
                if (messageText.length === 0 || messageText.text().trim() === '') {
                    debugLog('消息容器中没有消息内容，等待下次事件触发');
                    isInsertingUI = false;
                    return false;
                }

                // 查找mes_block容器
                const mesBlock = messageContainer.find('.mes_block');
                if (mesBlock.length === 0) {
                    debugLog('消息容器中没有找到mes_block，使用默认插入位置');
                    // 如果没有mes_block，回退到消息容器底部
                    const existingUI = document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);
                    if (existingUI) {
                        const currentParent = $(existingUI).parent();
                        if (currentParent.is(messageContainer)) {
                            debugLog('UI已在正确的消息容器中，无需移动');
                            isInsertingUI = false;
                            return true;
                        } else {
                            debugLog('UI在错误的容器中，移动到新的消息容器');
                            existingUI.remove();
                        }
                    }
                    createContextBottomContainer().then(contextBottomUI => {
                        messageContainer.append(contextBottomUI);
                        isInsertingUI = false;
                    }).catch(error => {
                        errorLog('创建UI容器失败:', error);
                        isInsertingUI = false;
                    });
                    debugLog('UI已成功插入到消息容器内部底部');
                    return true;
                }

                // 检查UI是否已经存在
                const existingUI = document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);

                if (existingUI) {
                    // UI已存在，检查是否在正确的容器中
                    const currentParent = $(existingUI).parent();
                    if (currentParent.is(mesBlock) && currentParent.find('.mes_text').next().is(existingUI)) {
                        debugLog('UI已在正确的mes_text下方位置，无需移动');
                        isInsertingUI = false;
                        return true;
                    } else {
                        // UI在错误的容器中，需要移动到新的容器
                        debugLog('UI在错误的容器中，移动到mes_text下方');
                        existingUI.remove();
                    }
                }

                // 创建或重新插入上下文底部UI
                createContextBottomContainer().then(contextBottomUI => {
                    // 插入到mes_text下方
                    messageText.after(contextBottomUI);
                    debugLog('UI已成功插入/移动到mes_text下方');

                    // 插入模块数据和样式到模块内容容器
                    try {
                        // 获取所有模块配置
                        const allModuleConfigs = getAllModuleConfigs();
                        if (allModuleConfigs && allModuleConfigs.length > 0) {
                            // 为UI容器添加一个特殊的类名，用于样式应用
                            contextBottomUI.classList.add('continuity-context-bottom-ui');

                            // 创建模块处理器实例
                            const moduleProcessor = new ModuleProcessor();

                            // 处理每个模块配置
                            allModuleConfigs.forEach(moduleConfig => {
                                if (moduleConfig) {
                                    // 提取全部聊天记录的模块数据
                                    const extractParams = {
                                        startIndex: 0,
                                        endIndex: null, // null表示提取到最新
                                        moduleFilters: [{ name: moduleConfig.name }]
                                    };

                                    // 使用processModuleData方法处理模块数据
                                    const processResult = moduleProcessor.processModuleData(
                                        extractParams,
                                        'auto', // 自动处理类型
                                        [moduleConfig.name]
                                    );

                                    // 使用contentString确保获得的是字符串表示
                                    const processedData = processResult.success ? processResult.contentString : '';
                                    if (processedData && processedData.trim() !== '') {
                                        // 获取处理后的样式字符串
                                        const processedStyles = insertCombinedStylesToDetails('.modules-content-container', moduleConfig, null, processResult.content);

                                        // 插入模块数据和样式到模块内容容器
                                        const contentContainer = contextBottomUI.querySelector('.modules-content-container');
                                        if (contentContainer) {
                                            // 添加处理后的样式
                                            if (((moduleConfig.customStyles && moduleConfig.customStyles.trim() !== '') || (moduleConfig.containerStyles && moduleConfig.containerStyles.trim() !== ''))) {
                                                contentContainer.innerHTML += `${processedStyles}`;
                                                debugLog(`模块 ${moduleConfig.name} 的样式已插入到模块内容容器`);
                                            }
                                            else {
                                                // 创建模块数据元素
                                                const moduleDataElement = document.createElement('div');
                                                moduleDataElement.className = 'module-data-container';
                                                let moduleContent = '';
                                                // 添加处理后的模块数据
                                                if (processedData && processedData.trim() !== '') {
                                                    moduleContent += `<details class="module-data"><summary>${moduleConfig.displayName || moduleConfig.name}</summary>${processedData}</details>`;
                                                }
                                                // 如果有模块内容，插入到容器中
                                                if (moduleContent) {
                                                    moduleDataElement.innerHTML = moduleContent;
                                                    contentContainer.appendChild(moduleDataElement);
                                                    debugLog(`模块 ${moduleConfig.name} 的数据已插入到模块内容容器`);
                                                }
                                            }
                                        }
                                    }
                                }
                            });
                            debugLog('模块数据和样式已插入到模块内容容器');
                        } else {
                            debugLog('没有找到模块配置，跳过模块数据和样式插入');
                        }
                    } catch (error) {
                        errorLog('插入模块数据和样式到模块内容容器失败:', error);
                    }


                    isInsertingUI = false;
                }).catch(error => {
                    errorLog('创建UI容器失败:', error);
                    isInsertingUI = false;
                });

                debugLog('UI已成功插入/移动到mes_text下方');
                return true;
            } catch (error) {
                errorLog('插入UI到mes_text下方失败:', error);
                isInsertingUI = false;
                return false;
            }
        }, 0);
    } catch (error) {
        errorLog('插入UI到mes_text下方失败:', error);
        isInsertingUI = false;
        return false;
    }
}

/**
 * 从上下文底部移除UI
 */
export function removeUIfromContextBottom() {
    try {
        const container = document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);
        if (container) {
            container.remove();
            debugLog('UI已从上下文底部移除');
            return true;
        }
        return false;
    } catch (error) {
        errorLog('从上下文底部移除UI失败:', error);
        return false;
    }
}



/**
 * 更新上下文底部UI内容
 * @param {string} content 要显示的内容
 */
export function updateContextBottomUI(content) {
    try {
        // 使用setTimeout确保DOM完全渲染后再更新
        setTimeout(() => {
            let container = document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);

            if (!container) {
                // 如果容器不存在，先创建
                insertUItoContextBottom();
                container = document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);
            }

            if (container) {
                const contentArea = container.querySelector('.continuity-context-info');
                if (contentArea) {
                    contentArea.innerHTML = content;
                    debugLog('上下文底部UI内容已更新');
                    return true;
                }
            }

            return false;
        }, 0);
    } catch (error) {
        errorLog('更新上下文底部UI内容失败:', error);
        return false;
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
export function hasValidMessageContainer() {
    try {
        // 查找合适的消息容器
        const lastMessageContainer = $('.last_mes');
        if (lastMessageContainer.length === 0) {
            return false;
        }

        // 检查消息容器是否有内容
        const messageText = lastMessageContainer.find('.mes_text');
        if (messageText.length === 0 || messageText.text().trim() === '') {
            return false;
        }

        return true;
    } catch (error) {
        errorLog('检查消息容器状态失败:', error);
        return false;
    }
}

/**
 * 检测页面状态并插入UI
 * 确保只有在合适的页面状态下才插入UI
 */
export function checkPageStateAndInsertUI() {
    try {
        // 检查是否在聊天页面
        if (!isInChatPage()) {
            debugLog('[PAGE_CHECK] 当前不在聊天页面，不插入UI');
            return false;
        }

        // 检查是否有有效的消息容器
        if (!hasValidMessageContainer()) {
            debugLog('[PAGE_CHECK] 没有有效的消息容器，不插入UI');
            return false;
        }

        // 检查UI是否已经存在
        const existingUI = document.getElementById('CONTEXT_BOTTOM_CONTAINER_ID');
        if (existingUI) {
            debugLog('[PAGE_CHECK] UI已存在，无需重新插入');
            return true;
        }

        // 所有检查通过，插入UI
        infoLog('[PAGE_CHECK] 页面状态检查通过，插入UI');
        insertUItoContextBottom();
        return true;
    } catch (error) {
        errorLog('检测页面状态并插入UI失败:', error);
        return false;
    }
}

/**
 * 初始化上下文底部UI
 * 使用jQuery确保DOM就绪后插入UI
 */
export function initContextBottomUI() {
    debugLog('初始化上下文底部UI');

    // 使用jQuery确保DOM完全加载后再插入UI
    jQuery(() => {
        // 延迟插入，确保其他扩展和主程序UI已完全加载
        setTimeout(() => {
            insertUItoContextBottom();
        }, 100);
    });
}
