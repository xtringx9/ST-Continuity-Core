import { debugLog, errorLog, infoLog } from '../../utils/logger.js';
import { groupProcessResultByMessageIndex } from '../moduleProcessor.js';
import { getCurrentMessageContainer } from './containerManager.js';
import { getRenderUIFilteredModuleConfigs } from './moduleFilters.js';
import { buildStyledProcessResult } from './processResultBuilder.js';

function injectHtmlWithScript(targetElement, htmlString, clearContainer = false) {
    try {
        const domNode = targetElement.jquery ? targetElement[0] : targetElement;

        if (clearContainer) {
            domNode.innerHTML = '';
        }

        const range = document.createRange();
        range.selectNode(domNode);
        const fragment = range.createContextualFragment(htmlString);
        domNode.appendChild(fragment);
    } catch (error) {
        errorLog('injectHtmlWithScript 错误:', error);
        targetElement.innerHTML = htmlString;
    }
}

export function renderCurrentMessageContext() {
    try {
        if (typeof jQuery === 'undefined' || typeof $ === 'undefined') {
            errorLog('jQuery未加载，无法使用选择器');
            return false;
        }

        const containers = getCurrentMessageContainer();
        const extractParams = {
            startIndex: 0,
            endIndex: null,
            moduleFilters: getRenderUIFilteredModuleConfigs(),
        };

        const processResult = buildStyledProcessResult(null, extractParams);
        if (!processResult) {
            errorLog('更新上下文底部UI失败');
            return false;
        }

        const groupedByMessageIndex = groupProcessResultByMessageIndex(processResult, true, true);
        infoLog('[CUSTOM STYLES]按messageIndex分组前后的模块数据:', processResult, groupedByMessageIndex);

        for (let i = containers.length - 1; i >= 0; i--) {
            const message = $(containers[i]);
            const messageText = message.find('.mes_text');
            const messageIndex = message.attr('mesid');
            const modulesForThisMessage = groupedByMessageIndex[messageIndex] || [];

            renderSingleMessageContext(modulesForThisMessage, messageText, message);
        }

        return true;
    } catch (error) {
        errorLog('更新上下文底部UI失败:', error);
        return false;
    }
}

const REGEX_ESCAPE_PATTERN = /[.*+?^${}()|[\]\\><]/g;

export function renderSingleMessageContext(messages, container, mes) {
    try {
        if (!messages || !container || container.length === 0) {
            debugLog('renderSingleMessageContext: 参数无效，跳过渲染');
            return;
        }

        const swipeId = mes.attr('swipeid');
        const renderSwipe = mes.attr('renderSwipe');
        const originalText = container.html();
        if (renderSwipe === swipeId) {
            if (messages.length > 0) {
                const firstMessage = messages[Math.floor(messages.length / 2)];
                if (firstMessage && firstMessage.moduleData && firstMessage.moduleData.processedRaw) {
                    const processedRaw = firstMessage.moduleData.processedRaw;
                    const rawPattern = new RegExp(processedRaw.replace(REGEX_ESCAPE_PATTERN, '\\$&') + '(?:<br>)*', 'g');

                    const matchResults = originalText.match(rawPattern);
                    if (!matchResults || matchResults.length === 0) {
                        debugLog('renderSingleMessageContext: processedRaw无法匹配原始HTML内容，可能已渲染过，跳过渲染');
                        return;
                    }
                }
            }
        }

        let newHtml = originalText;

        if (messages.length > 0) {
            messages.forEach((entry) => {
                if (!entry.moduleData || !entry.moduleData.raw || typeof entry.moduleData.raw !== 'string' || entry.moduleData.raw.trim() === '') {
                    debugLog('renderSingleMessageContext: entry.moduleData.raw为空或无效，无法匹配原文');
                } else if (!entry.customStyles || typeof entry.customStyles !== 'string' || entry.customStyles.trim() === '') {
                    debugLog('renderSingleMessageContext: entry.customStyles为空或无效，无法替换');
                } else {
                    const processedRaw = entry.moduleData.processedRaw;
                    const rawPattern = new RegExp(processedRaw.replace(REGEX_ESCAPE_PATTERN, '\\$&') + '(?:<br>)*', 'g');

                    const matchResults = newHtml.match(rawPattern);
                    if (matchResults && matchResults.length > 0) {
                        matchResults.forEach(matchResult => {
                            const matchedText = matchResult.replace(processedRaw + '<br>', processedRaw);
                            newHtml = newHtml.replace(matchedText, entry.customStyles);
                        });
                    } else {
                        const raw = entry.moduleData.raw;
                        const rawPattern = new RegExp(raw.replace(REGEX_ESCAPE_PATTERN, '\\$&') + '(?:<br>)*', 'g');
                        const matchResults = newHtml.match(rawPattern);
                        if (matchResults && matchResults.length > 0) {
                            matchResults.forEach(matchResult => {
                                const matchedText = matchResult.replace(raw + '<br>', raw);
                                newHtml = newHtml.replace(matchedText, entry.customStyles);
                            });
                        } else {
                            infoLog(`messageIndex: ${mes.attr('mesid')} renderSingleMessageContext: 未找到匹配的原文内容，跳过替换`, {
                                entry: entry,
                                raw: raw,
                                processedRaw: processedRaw,
                                rawPattern: rawPattern,
                                newHtml: newHtml,
                                patternString: rawPattern.toString(),
                            });
                        }
                    }
                }
            });
            injectHtmlWithScript(container[0], newHtml, true);
            mes.attr('renderSwipe', swipeId);
        }
    } catch (error) {
        errorLog('renderSingleMessageContext: 渲染单个消息上下文失败:', error);
        mes.attr('renderSwipe', '');
    }
}
