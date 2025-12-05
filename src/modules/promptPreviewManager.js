// 提示词预览区域管理模块
import { configManager, debugLog, errorLog, infoLog } from '../index.js';
import { generateModulePrompt, generatePromptWithInsertion, copyToClipboard } from './promptGenerator.js';
import { getContinuityPrompt, getContinuityConfig, getContinuityModules, getContinuityOrder, getContinuityUsageGuide, getContinuityModuleData, getContinuityChatModule } from '../core/macroManager.js';

// 默认插入设置
const DEFAULT_INSERTION_SETTINGS = {
    depth: 1,
    role: 'system'
};

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
 * 获取所有可用的预览模式配置
 * @returns {Array} 预览模式配置数组
 */
function getPreviewModes() {
    // 获取聊天消息层数配置
    const entryCount = configManager.getGlobalSettings().contentRemainLayers || 9;
    const chatModuleModes = [];

    // 生成聊天模块宏选项（只在奇数索引时生成）
    for (let i = 0; i < entryCount; i++) {
        if (i % 2 === 1) {
            chatModuleModes.push({
                value: `macro-chat-module-${i}`,
                label: `{{CONTINUITY_CHAT_MODULE_${i}}} 宏`
            });
        }
    }

    return [
        { value: 'macro', label: '{{CONTINUITY_PROMPT}} 宏' },
        // { value: 'macro-config', label: '{{CONTINUITY_CONFIG}} 宏' },
        // { value: 'macro-modules', label: '{{CONTINUITY_MODULES}} 宏' },
        { value: 'macro-usage-guide', label: '{{CONTINUITY_USAGE_GUIDE}} 宏' },
        { value: 'macro-order', label: '{{CONTINUITY_ORDER}} 宏' },
        { value: 'macro-module-data', label: '{{CONTINUITY_MODULE_DATA}} 宏' },
        ...chatModuleModes
    ];
}

/**
 * 获取当前预览模式
 * @returns {string} 预览模式：'macro' | 'macro-config' | 'macro-modules'
 */
function getCurrentPreviewMode() {
    try {
        const mode = $('#preview-mode-select').val();
        return mode || 'macro';
    } catch (error) {
        errorLog('获取预览模式失败:', error);
        return 'macro';
    }
}

/**
 * 根据当前模式生成对应的提示词预览
 * @returns {string} 生成的提示词内容
 */
function generatePreviewContent() {
    const mode = getCurrentPreviewMode();

    // 处理聊天模块宏（格式：macro-chat-module-{index}）
    if (mode.startsWith('macro-chat-module-')) {
        const index = parseInt(mode.split('-').pop());
        if (!isNaN(index)) {
            return getContinuityChatModule(index);
        }
    }

    switch (mode) {
        case 'macro-config':
            return getContinuityConfig();
        case 'macro-modules':
            return getContinuityModules();
        case 'macro-order':
            return getContinuityOrder();
        case 'macro-usage-guide':
            return getContinuityUsageGuide();
        case 'macro-module-data':
            return getContinuityModuleData();
        case 'macro':
        default:
            return getContinuityPrompt();
    }
}

/**
 * 获取当前预览模式的描述
 * @returns {string} 预览模式描述
 */
function getPreviewModeDescription() {
    const mode = getCurrentPreviewMode();

    // 处理聊天模块宏（格式：macro-chat-module-{index}）
    if (mode.startsWith('macro-chat-module-')) {
        const index = parseInt(mode.split('-').pop());
        if (!isNaN(index)) {
            return `{{CONTINUITY_CHAT_MODULE_${index}}} 宏会生成的聊天消息 ${index} 的模块数据`;
        }
    }

    switch (mode) {
        case 'macro-config':
            return '{{CONTINUITY_CONFIG}} 宏会生成的配置数据';
        case 'macro-modules':
            return '{{CONTINUITY_MODULES}} 宏会生成的模块列表';
        case 'macro-order':
            return '{{CONTINUITY_ORDER}} 宏会生成的顺序提示词';
        case 'macro-usage-guide':
            return '{{CONTINUITY_USAGE_GUIDE}} 宏会生成的使用指导提示词';
        case 'macro-module-data':
            return '{{CONTINUITY_MODULE_DATA}} 宏会生成的连续性模块数据';
        case 'macro':
        default:
            return '{{CONTINUITY_PROMPT}} 宏会生成的提示词';
    }
}

/**
 * 更新提示词预览内容
 */
export function updatePromptPreview() {
    try {
        const prompt = generatePreviewContent();
        const modeDescription = getPreviewModeDescription();

        $('#prompt-preview-textarea').val(prompt);
        // debugLog(`提示词预览内容已更新（${modeDescription}）`);
        // toastr.success(`提示词已更新（${modeDescription}）`);
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
 * 获取当前插入深度和角色设置
 */
export function getInsertionSettings() {
    try {
        const depth = parseInt($('#insertion-depth').val()) || DEFAULT_INSERTION_SETTINGS.depth;
        const role = $('#insertion-role').val() || DEFAULT_INSERTION_SETTINGS.role;

        // 验证深度值
        const validatedDepth = Math.max(0, Math.min(10, depth));

        debugLog(`获取插入设置: 深度=${validatedDepth}, 角色=${role}`);

        return {
            depth: validatedDepth,
            role: role
        };
    } catch (error) {
        errorLog('获取插入设置失败:', error);
        return DEFAULT_INSERTION_SETTINGS;
    }
}

/**
 * 绑定深度设置变化事件
 */
function bindInsertionSettingsEvents() {
    try {
        // 绑定深度输入框变化事件
        $('#insertion-depth').off('input').on('input', function () {
            const value = parseInt($(this).val());
            if (isNaN(value) || value < 0 || value > 10) {
                $(this).val(DEFAULT_INSERTION_SETTINGS.depth);
                toastr.warning('深度值必须在0-10之间');
            }
            debugLog('插入深度已更新:', value);
        });

        // 绑定角色选择框变化事件
        $('#insertion-role').off('change').on('change', function () {
            const role = $(this).val();
            debugLog('插入角色已更新:', role);
        });

        infoLog('插入设置事件绑定成功');

    } catch (error) {
        errorLog('绑定插入设置事件失败:', error);
    }
}

/**
 * 动态生成预览模式选择器选项
 */
function generatePreviewModeOptions() {
    try {
        const previewModes = getPreviewModes();
        const selectElement = $('#preview-mode-select');

        // 清空现有选项
        selectElement.empty();

        // 动态添加选项
        previewModes.forEach(mode => {
            const option = $('<option>').val(mode.value).text(mode.label);
            selectElement.append(option);
        });

        debugLog('动态生成预览模式选项完成，共添加了 ' + previewModes.length + ' 个选项');

    } catch (error) {
        errorLog('动态生成预览模式选项失败:', error);
    }
}

/**
 * 绑定预览模式选择器事件
 */
function bindPreviewModeEvents() {
    try {
        // 动态生成预览模式选项
        generatePreviewModeOptions();

        // 绑定预览模式选择器变化事件
        $('#preview-mode-select').off('change').on('change', function () {
            const mode = $(this).val();
            debugLog('预览模式已切换:', mode);

            // 如果预览区域是展开状态，自动更新预览内容
            if ($('#prompt-preview-content').is(':visible')) {
                updatePromptPreview();
            }
        });

        infoLog('预览模式事件绑定成功');

    } catch (error) {
        errorLog('绑定预览模式事件失败:', error);
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

        // 绑定插入设置事件
        bindInsertionSettingsEvents();

        // 绑定预览模式事件
        bindPreviewModeEvents();

        infoLog('提示词预览区域事件绑定成功');

    } catch (error) {
        errorLog('绑定提示词预览区域事件失败:', error);
    }
}

/**
 * 复制当前预览模式对应的宏到剪贴板
 */
export function copyMacroToClipboard() {
    try {
        const mode = getCurrentPreviewMode();
        let macroText = '';

        switch (mode) {
            case 'macro-config':
                macroText = '{{CONTINUITY_CONFIG}}';
                break;
            case 'macro-modules':
                macroText = '{{CONTINUITY_MODULES}}';
                break;
            case 'macro-order':
                macroText = '{{CONTINUITY_ORDER}}';
                break;
            case 'macro-usage-guide':
                macroText = '{{CONTINUITY_USAGE_GUIDE}}';
                break;
            case 'macro':
            default:
                macroText = '{{CONTINUITY_PROMPT}}';
                break;
        }

        if (macroText) {
            copyToClipboard(macroText);
            toastr.success(`已复制宏: ${macroText}`);
            debugLog(`复制宏成功: ${macroText}`);
        }
    } catch (error) {
        errorLog('复制宏失败:', error);
        toastr.error('复制宏失败');
    }
}

/**
 * 绑定复制宏按钮事件
 */
function bindCopyMacroEvents() {
    try {
        // 绑定复制宏按钮事件
        $('#copy-macro-btn').off('click').on('click', copyMacroToClipboard);

        infoLog('复制宏事件绑定成功');

    } catch (error) {
        errorLog('绑定复制宏事件失败:', error);
    }
}

// 标记是否已经初始化过提示词预览功能
let isPromptPreviewInitialized = false;

/**
 * 初始化提示词预览功能
 */
export function initPromptPreview() {
    try {
        // 如果已经初始化过，直接返回
        if (isPromptPreviewInitialized) {
            debugLog('提示词预览功能已经初始化过，跳过重复初始化');
            return;
        }

        debugLog('初始化提示词预览功能');

        // 绑定预览区域事件
        bindPromptPreviewEvents();

        // 绑定复制宏事件
        bindCopyMacroEvents();

        // 标记为已初始化
        isPromptPreviewInitialized = true;

        infoLog('提示词预览功能初始化成功');

    } catch (error) {
        errorLog('初始化提示词预览功能失败:', error);
    }
}
