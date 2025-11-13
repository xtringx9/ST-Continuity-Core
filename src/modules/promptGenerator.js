// 提示词生成器模块
import { debugLog, errorLog, infoLog, getModulesData } from "../index.js";

// 默认插入设置
const DEFAULT_INSERTION_SETTINGS = {
    depth: 1,
    role: 'system'
};

/**
 * 生成正式提示词
 * @returns {string} 生成的正式提示词
 */
export function generateFormalPrompt() {
    try {
        const modules = getModulesData();
        debugLog('开始生成正式提示词，模块数量:', modules.length);

        if (modules.length === 0) {
            infoLog('没有配置模块，无法生成提示词');
            return '暂无模块配置，请先添加模块。';
        }

        let prompt = '模块组织提示词：\n\n';

        // 按模块顺序生成提示词
        modules.forEach((module, index) => {
            const moduleNumber = index + 1;

            // 模块标题
            prompt += `${moduleNumber}. ${module.name}模块\n`;

            // 模块提示词（如果有）
            if (module.prompt) {
                prompt += `   说明：${module.prompt}\n`;
            }

            // 变量列表
            if (module.variables && module.variables.length > 0) {
                prompt += `   变量：\n`;
                module.variables.forEach(variable => {
                    const description = variable.description ? ` - ${variable.description}` : '';
                    prompt += `     • ${variable.name}${description}\n`;
                });
            }

            // 模块格式预览
            const variablesPreview = module.variables && module.variables.length > 0
                ? module.variables.map(v => `${v.name}:值`).join('|')
                : '';

            const moduleFormat = variablesPreview
                ? `[${module.name}|${variablesPreview}]`
                : `[${module.name}]`;

            prompt += `   格式：${moduleFormat}\n\n`;
        });

        // 添加使用说明
        prompt += '使用说明：\n';
        prompt += '• 每个模块用方括号表示，格式为[模块名|变量1:值1|变量2:值2...]\n';
        prompt += '• 变量值需要根据实际情况填写\n';
        prompt += '• 模块可以按需组合使用\n';

        infoLog('正式提示词生成成功');

        // 使用logger输出生成的提示词
        debugLog('=== Continuity 生成的正式提示词 ===');
        debugLog(prompt);
        debugLog('===================================');

        return prompt;

    } catch (error) {
        errorLog('生成正式提示词失败:', error);
        return '生成提示词时发生错误：' + error.message;
    }
}

/**
 * 生成模块组织后的提示词（不包含结构化信息）
 * @returns {string} 模块组织后的提示词
 */
export function generateModulePrompt() {
    try {
        return generateFormalPrompt();
    } catch (error) {
        errorLog('生成模块提示词失败:', error);
        return '生成提示词时发生错误：' + error.message;
    }
}

/**
 * 生成带有插入设置的提示词
 * @param {Object} insertionSettings 插入设置
 * @param {number} insertionSettings.depth 插入深度
 * @param {string} insertionSettings.role 插入角色
 * @returns {string} 带有插入设置的提示词
 */
export function generatePromptWithInsertion(insertionSettings = DEFAULT_INSERTION_SETTINGS) {
    try {
        const { depth, role } = insertionSettings;
        const prompt = generateFormalPrompt();

        // 根据st-memory-enhancement插件的格式生成扩展提示词
        const extensionPrompt = `{
    "depth": ${depth},
    "role": "${role}",
    "content": "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"
}`;

        debugLog(`生成带有插入设置的提示词: 深度=${depth}, 角色=${role}`);

        // 使用logger输出生成的扩展提示词
        debugLog('=== Continuity 生成的扩展提示词（带插入设置） ===');
        debugLog(extensionPrompt);
        debugLog('================================================');

        return extensionPrompt;

    } catch (error) {
        errorLog('生成带有插入设置的提示词失败:', error);
        return '生成提示词时发生错误：' + error.message;
    }
}

/**
 * 生成模块结构预览HTML
 * @returns {string} 模块结构预览HTML
 */
export function generateStructurePreview() {
    try {
        const modules = getModulesData();
        debugLog('生成模块结构预览，模块数量:', modules.length);

        if (modules.length === 0) {
            return '<div class="structure-item">暂无模块配置</div>';
        }

        let structureHTML = '';

        modules.forEach((module, index) => {
            const moduleNumber = index + 1;

            structureHTML += `<div class="structure-item">
                <div class="structure-module-name">${moduleNumber}. ${module.name}</div>`;

            if (module.variables && module.variables.length > 0) {
                structureHTML += '<div class="structure-variables">';
                module.variables.forEach(variable => {
                    const description = variable.description ? ` - ${variable.description}` : '';
                    structureHTML += `<div class="structure-variable">• ${variable.name}${description}</div>`;
                });
                structureHTML += '</div>';
            }

            // 添加模块格式预览
            const variablesPreview = module.variables && module.variables.length > 0
                ? module.variables.map(v => `${v.name}:值`).join('|')
                : '';

            const moduleFormat = variablesPreview
                ? `[${module.name}|${variablesPreview}]`
                : `[${module.name}]`;

            structureHTML += `<div style="margin-top: 5px; font-size: 11px; color: rgba(255,255,255,0.6);">格式：${moduleFormat}</div>`;

            structureHTML += '</div>';
        });

        infoLog('模块结构预览生成成功');
        return structureHTML;

    } catch (error) {
        errorLog('生成模块结构预览失败:', error);
        return '<div class="structure-item">生成预览时发生错误</div>';
    }
}

/**
 * 复制提示词到剪贴板
 * @param {string} text 要复制的文本
 */
export function copyToClipboard(text) {
    try {
        navigator.clipboard.writeText(text).then(() => {
            infoLog('提示词已复制到剪贴板');
            toastr.success('提示词已复制到剪贴板');
        }).catch(err => {
            errorLog('复制到剪贴板失败:', err);
            toastr.error('复制失败，请手动复制');
        });
    } catch (error) {
        errorLog('复制到剪贴板失败:', error);
        // 备用方法：使用textarea方式复制
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            infoLog('提示词已复制到剪贴板（备用方法）');
            toastr.success('提示词已复制到剪贴板');
        } catch (err) {
            errorLog('备用复制方法也失败:', err);
            toastr.error('复制失败，请手动复制');
        }
        document.body.removeChild(textarea);
    }
}
