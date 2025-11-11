// 模块配置管理模块
import { extensionFolderPath } from "./config.js";

/**
 * 保存模块配置到本地存储
 * @param {Array} modules 模块配置数组
 */
export function saveModuleConfig(modules) {
    const config = { modules };
    try {
        localStorage.setItem('continuity_module_config', JSON.stringify(config));
        console.log('模块配置已保存到本地存储');
        return true;
    } catch (error) {
        console.error('保存模块配置失败:', error);
        return false;
    }
}

/**
 * 从本地存储加载模块配置
 * @returns {Object|null} 模块配置对象或null
 */
export function loadModuleConfig() {
    try {
        const configStr = localStorage.getItem('continuity_module_config');
        if (configStr) {
            const config = JSON.parse(configStr);
            console.log('从本地存储加载模块配置:', config);
            return config;
        }
    } catch (error) {
        console.error('加载模块配置失败:', error);
    }
    return null;
}

/**
 * 导出模块配置为JSON文件
 * @param {Array} modules 模块配置数组
 */
export function exportModuleConfig(modules) {
    const config = { modules };
    const dataStr = JSON.stringify(config, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = `continuity-modules-${new Date().toISOString().split('T')[0]}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();

    console.log('模块配置已导出为JSON文件');
}

/**
 * 导入模块配置从JSON文件
 * @param {File} file 选择的JSON文件
 * @returns {Promise<Object|null>} 解析后的配置对象或null
 */
export function importModuleConfig(file) {
    return new Promise((resolve) => {
        if (!file) {
            resolve(null);
            return;
        }

        if (file.type && file.type !== 'application/json') {
            console.error('文件类型错误，需要JSON文件');
            toastr.error('文件类型错误，请选择JSON文件');
            resolve(null);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const result = e.target.result;
                if (typeof result !== 'string') {
                    throw new Error('文件内容不是文本格式');
                }
                const config = JSON.parse(result);
                if (!config.modules || !Array.isArray(config.modules)) {
                    throw new Error('无效的配置格式，缺少modules数组');
                }
                console.log('成功导入模块配置:', config);
                resolve(config);
            } catch (error) {
                console.error('解析JSON文件失败:', error);
                toastr.error('解析JSON文件失败，请检查文件格式');
                resolve(null);
            }
        };
        reader.onerror = () => {
            console.error('读取文件失败');
            toastr.error('读取文件失败');
            resolve(null);
        };
        reader.readAsText(file);
    });
}

/**
 * 从配置对象渲染模块到UI
 * @param {Object} config 配置对象
 */
export function renderModulesFromConfig(config) {
    if (!config || !config.modules) return;

    // 清空现有模块（保留模板和标题区域）
    $('.custom-modules-container > div').each(function() {
        if (!$(this).hasClass('module-template') && !$(this).hasClass('section-title')) {
            $(this).remove();
        }
    });

    // 克隆整个模块模板，与addModule函数保持一致
    const template = $('.module-template').clone();

    config.modules.forEach(module => {
        if (!module.name) return;

        const moduleElement = template.clone();
        moduleElement.removeClass('module-template').css('display', 'block');

        // 获取模块内部的module-item
        const moduleItem = moduleElement.find('.module-item');
        
        // 设置模块名称
        moduleItem.find('.module-name').val(module.name);

        // 清空默认变量
        moduleItem.find('.variable-item').not('.variable-template').remove();

        // 添加变量
        if (module.variables && Array.isArray(module.variables)) {
            const variableTemplate = moduleItem.find('.variable-template');
            const variablesContainer = moduleItem.find('.variables-container');

            module.variables.forEach(variable => {
                if (!variable.name) return;

                // 直接创建变量项HTML结构
                const templateItem = $('<div class="variable-item" style="display: block;"></div>');
                templateItem.append('<input type="text" class="variable-name" placeholder="变量名" value="' + (variable.name || '') + '">');
                templateItem.append('<input type="text" class="variable-desc" placeholder="变量描述" value="' + (variable.description || '') + '">');
                templateItem.append('<button class="remove-variable">移除变量</button>');

                // 直接添加variable-item到容器
                variablesContainer.append(templateItem);
            });
        }

        // 添加到custom-modules-container
        $('.custom-modules-container').append(moduleElement);
    });
}
