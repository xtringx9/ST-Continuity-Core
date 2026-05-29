import { extensionFolderPath } from '../../index.js';
import { debugLog } from '../../utils/logger.js';

export const CONTEXT_BOTTOM_CONTAINER_ID = 'CONTEXT_BOTTOM_CONTAINER_ID';
export const CONTEXT_MSG_CONTAINER_ID = 'CONTEXT_MSG_CONTAINER_ID';

export function loadContextUICSS() {
    if (document.getElementById('continuity-context-bottom-css')) {
        return;
    }

    const link = document.createElement('link');
    link.id = 'continuity-context-bottom-css';
    link.rel = 'stylesheet';
    link.href = `${extensionFolderPath}/assets/css/context-bottom-ui.css`;

    document.head.appendChild(link);
    debugLog('上下文底部UI样式已加载');
}

export async function createContextContainer(containerId = CONTEXT_BOTTOM_CONTAINER_ID, parentContainer = null) {
    let existingContainer = null;
    if (parentContainer) {
        if (typeof parentContainer.find === 'function') {
            existingContainer = parentContainer.find(`#${containerId}`)[0];
        } else if (typeof parentContainer.querySelector === 'function') {
            existingContainer = parentContainer.querySelector(`#${containerId}`);
        }
    } else {
        existingContainer = document.getElementById(containerId);
    }

    if (existingContainer) {
        debugLog('上下文底部UI容器已存在');
        return existingContainer;
    }

    debugLog(`创建上下文底部UI容器 ${containerId}`);
    loadContextUICSS();

    const container = document.createElement('div');
    container.id = containerId;
    container.classList.add('continuity-context-bottom-ui');

    return container;
}

export function findSuitableMessageContainer(excludeUserMes = false) {
    const lastMessageContainer = $('.last_mes');

    if (lastMessageContainer.length === 0) {
        debugLog('当前没有last_mes容器');
        return null;
    }

    if (!excludeUserMes) {
        return lastMessageContainer;
    }

    const isUserMessage = lastMessageContainer.attr('is_user') === 'true';

    if (!isUserMessage) {
        return lastMessageContainer;
    }

    debugLog('last_mes是用户消息，向上查找AI消息');

    const allMessages = $('.mes');
    let suitableContainer = null;

    for (let i = allMessages.length - 1; i >= 0; i--) {
        const message = $(allMessages[i]);
        const isCurrentUserMessage = message.attr('is_user') === 'true';

        if (!isCurrentUserMessage) {
            suitableContainer = message;
            debugLog('找到AI消息容器');
            break;
        }
    }

    return suitableContainer;
}

export function getCurrentMessageContainer() {
    return jQuery('#chat .mes');
}

export function removeContextUIContainers() {
    const contextBottomContainer = document.getElementById(CONTEXT_BOTTOM_CONTAINER_ID);
    if (contextBottomContainer) {
        contextBottomContainer.remove();
        debugLog('UI已从上下文底部移除');
    }

    document.querySelectorAll(`#${CONTEXT_MSG_CONTAINER_ID}`).forEach(container => {
        container.remove();
    });
    debugLog('消息底部UI已从上下文底部移除');
}
