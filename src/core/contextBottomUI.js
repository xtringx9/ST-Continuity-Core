/**
 * 上下文底部UI管理模块
 * 实现将UI插入到mes_text下方的功能
 * 细长折叠栏样式版本
 */

import { debugLog, errorLog } from '../utils/logger.js';

// 上下文底部UI容器ID
const CONTEXT_BOTTOM_CONTAINER_ID = 'continuity-context-bottom-ui';

/**
 * 创建上下文底部UI容器
 * @returns {HTMLElement} 创建的容器元素
 */
function createContextBottomContainer() {
    // 检查容器是否已存在
    if (document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID)) {
        debugLog('上下文底部UI容器已存在');
        return document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);
    }

    // 创建容器元素
    const container = document.createElement('div');
    container.id = CONTEXT_BOTTOM_CONTAINER_ID;
    container.className = 'continuity-context-bottom-container collapsed';
    container.innerHTML = `
        <div class="continuity-context-bottom-content">
            <h3 class="continuity-context-title">ST-Continuity-Core</h3>
            <div class="continuity-context-info">
                <p>这是插入到消息底部的细长折叠栏</p>
                <p>点击标题可以展开/折叠内容</p>
                <p>自动跟随最新AI消息位置</p>
            </div>
        </div>
    `;

    // 添加点击折叠功能
    container.addEventListener('click', function (e) {
        // 检查点击的是标题或标题内的任何元素
        if (e.target.closest('.continuity-context-title') || e.target.classList.contains('continuity-context-title')) {
            container.classList.toggle('collapsed');
            debugLog('UI折叠状态切换: ' + (container.classList.contains('collapsed') ? '折叠' : '展开'));
        }
    });

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

/**
 * 将UI插入到上下文底部
 * 修改为插入到mes_text下方，确保折叠功能正常工作
 */
export function insertUItoContextBottom() {
    try {
        // 使用setTimeout确保DOM完全渲染后再插入
        setTimeout(() => {
            // 检查jQuery是否可用
            if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
                errorLog('jQuery未加载，无法使用选择器');
                return false;
            }

            // 查找合适的消息容器
            const messageContainer = findSuitableMessageContainer();

            if (!messageContainer) {
                debugLog('没有找到合适的消息容器，等待下次事件触发');
                return false;
            }

            // 额外检查：确保容器包含消息内容
            const messageText = messageContainer.find('.mes_text');
            if (messageText.length === 0 || messageText.text().trim() === '') {
                debugLog('消息容器中没有消息内容，等待下次事件触发');
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
                        return true;
                    } else {
                        debugLog('UI在错误的容器中，移动到新的消息容器');
                        existingUI.remove();
                    }
                }
                const contextBottomUI = existingUI || createContextBottomContainer();
                messageContainer.append(contextBottomUI);
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
                    return true;
                } else {
                    // UI在错误的容器中，需要移动到新的容器
                    debugLog('UI在错误的容器中，移动到mes_text下方');
                    existingUI.remove();
                }
            }

            // 创建或重新插入上下文底部UI
            const contextBottomUI = existingUI || createContextBottomContainer();

            // 插入到mes_text下方
            messageText.after(contextBottomUI);

            debugLog('UI已成功插入/移动到mes_text下方');
            return true;
        }, 0);
    } catch (error) {
        errorLog('插入UI到mes_text下方失败:', error);
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
