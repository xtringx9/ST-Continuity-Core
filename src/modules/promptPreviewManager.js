// 提示词预览窗口管理模块
import { debugLog, errorLog, infoLog } from "../index.js";
import { generateFormalPrompt, generateStructurePreview, copyToClipboard } from "./promptGenerator.js";

/**
 * 打开提示词预览窗口
 */
export function openPromptPreviewWindow() {
    try {
        debugLog('打开提示词预览窗口');
        
        // 检查窗口是否已存在
        if (!$("#continuity-prompt-preview-window").length) {
            errorLog('提示词预览窗口HTML未找到');
            toastr.error('提示词预览窗口加载失败');
            return;
        }
        
        // 生成提示词和结构预览
        const prompt = generateFormalPrompt();
        const structure = generateStructurePreview();
        
        // 更新预览内容
        $("#prompt-preview-textarea").val(prompt);
        $("#prompt-preview-structure").html(structure);
        
        // 显示窗口
        $("#continuity-prompt-preview-window").addClass('show');
        
        infoLog('提示词预览窗口已打开');
        
    } catch (error) {
        errorLog('打开提示词预览窗口失败:', error);
        toastr.error('打开提示词预览窗口失败');
    }
}

/**
 * 关闭提示词预览窗口
 */
export function closePromptPreviewWindow() {
    try {
        debugLog('关闭提示词预览窗口');
        $("#continuity-prompt-preview-window").removeClass('show');
        infoLog('提示词预览窗口已关闭');
    } catch (error) {
        errorLog('关闭提示词预览窗口失败:', error);
    }
}

/**
 * 绑定提示词预览窗口事件
 */
export function bindPromptPreviewEvents() {
    try {
        debugLog('绑定提示词预览窗口事件');
        
        // 绑定关闭按钮事件
        $("#prompt-preview-close").off('click').on('click', closePromptPreviewWindow);
        $("#close-preview-btn").off('click').on('click', closePromptPreviewWindow);
        
        // 绑定复制按钮事件
        $("#copy-prompt-btn").off('click').on('click', function() {
            const promptText = $("#prompt-preview-textarea").val();
            if (promptText) {
                copyToClipboard(promptText);
            }
        });
        
        // 绑定ESC键关闭窗口
        $(document).off('keyup.promptPreview').on('keyup.promptPreview', function(e) {
            if (e.key === 'Escape' && $("#continuity-prompt-preview-window").hasClass('show')) {
                closePromptPreviewWindow();
            }
        });
        
        infoLog('提示词预览窗口事件绑定成功');
        
    } catch (error) {
        errorLog('绑定提示词预览窗口事件失败:', error);
    }
}

/**
 * 初始化提示词预览功能
 */
export function initPromptPreview() {
    try {
        debugLog('初始化提示词预览功能');
        
        // 绑定预览按钮事件
        $("#preview-prompt-btn").off('click').on('click', function() {
            openPromptPreviewWindow();
        });
        
        // 绑定预览窗口事件
        bindPromptPreviewEvents();
        
        infoLog('提示词预览功能初始化成功');
        
    } catch (error) {
        errorLog('初始化提示词预览功能失败:', error);
    }
}