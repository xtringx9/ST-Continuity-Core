// 提示词预览区域管理模块
import { debugLog, errorLog, infoLog } from '../index.js';
import { generateFormalPrompt, copyToClipboard } from './promptGenerator.js';

/**
 * 切换提示词预览区域的展开/折叠状态
 */
export function togglePromptPreview() {
    try {
        const previewContent = $('#prompt-preview-content');
        const toggleBtn = $('#toggle-preview-btn');

        if (previewContent.is(':visible')) {
            // 如果当前是展开状态，则折叠
            previewContent.slideUp(300);
            toggleBtn.removeClass('expanded');
            toggleBtn.html('<span class="toggle-arrow">▶</span> 展开预览');
            debugLog('提示词预览区域已折叠');
        } else {
            // 如果当前是折叠状态，则展开并生成预览内容
            updatePromptPreview();
            
            previewContent.slideDown(300);
            toggleBtn.addClass('expanded');
            toggleBtn.html('<span class="toggle-arrow">▶</span> 折叠预览');
            debugLog('提示词预览区域已展开');
        }

    } catch (error) {
        errorLog('切换提示词预览区域状态失败:', error);
        toastr.error('切换预览状态失败');
    }
}

/**
 * 更新提示词预览内容
 */
export function updatePromptPreview() {
    try {
        const prompt = generateFormalPrompt();
        $('#prompt-preview-textarea').val(prompt);
        debugLog('提示词预览内容已更新');
        toastr.success('提示词已更新');
    } catch (error) {
        errorLog('更新提示词预览失败:', error);
        toastr.error('更新提示词失败');
    }
}

/**
 * 复制提示词到剪贴板
 */
export function copyPromptToClipboard() {
    try {
        const promptText = $('#prompt-preview-textarea').val();
        if (promptText) {
            copyToClipboard(promptText);
        } else {
            toastr.info('请先展开预览生成提示词');
        }
    } catch (error) {
        errorLog('复制提示词失败:', error);
        toastr.error('复制提示词失败');
    }
}

/**
 * 绑定提示词预览区域事件
 */
export function bindPromptPreviewEvents() {
    try {
        debugLog('绑定提示词预览区域事件');

        // 绑定切换按钮事件
        $('#toggle-preview-btn').off('click').on('click', togglePromptPreview);

        // 绑定复制按钮事件
        $('#copy-prompt-btn').off('click').on('click', copyPromptToClipboard);

        // 绑定更新按钮事件
        $('#update-prompt-btn').off('click').on('click', updatePromptPreview);

        infoLog('提示词预览区域事件绑定成功');

    } catch (error) {
        errorLog('绑定提示词预览区域事件失败:', error);
    }
}

/**
 * 初始化提示词预览功能
 */
export function initPromptPreview() {
    try {
        debugLog('初始化提示词预览功能');

        // 绑定预览区域事件
        bindPromptPreviewEvents();

        infoLog('提示词预览功能初始化成功');

    } catch (error) {
        errorLog('初始化提示词预览功能失败:', error);
    }
}
