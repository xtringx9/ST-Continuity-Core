// 提取模块控制器 - 独立管理提取模块功能
import { debugLog, errorLog } from '../index.js';
import { chat } from '../index.js';
import { ModuleExtractor } from './moduleExtractor.js';

/**
 * 提取模块控制器类
 */
export class ExtractModuleController {
    constructor() {
        this.moduleExtractor = new ModuleExtractor();
    }

    /**
     * 初始化提取模块功能
     */
    init() {
        this.bindExtractModuleButtonEvent();
        this.bindShowFloorContentEvent();
    }

    /**
     * 绑定提取模块按钮事件
     */
    bindExtractModuleButtonEvent() {
        $('#extract-modules-btn').on('click', () => {
            this.extractModules();
        });
    }

    /**
     * 绑定显示楼层内容按钮事件
     */
    bindShowFloorContentEvent() {
        $('#show-floor-btn').on('click', () => {
            const floorNumber = parseInt($('#floor-input').val().trim());
            if (isNaN(floorNumber) || floorNumber < 1) {
                toastr.warning('请输入有效的楼层号');
                return;
            }
            this.showFloorContent(floorNumber);
        });
    }

    /**
     * 提取模块功能
     */
    extractModules() {
        try {
            debugLog('开始提取模块功能');

            // 使用ModuleExtractor提取模块
            const modules = this.moduleExtractor.extractModulesFromChat();

            // 清空结果容器
            const resultsContainer = $('#extract-results-container');
            resultsContainer.empty();

            if (modules.length > 0) {
                // 创建结果列表
                const resultsList = $('<div class="modules-list"></div>');

                modules.forEach((module, index) => {
                    // 对模块内容进行HTML转义，确保标签显示为文本
                    const escapedModuleContent = this.htmlEscape(module.raw);

                    // 创建模块项
                    const moduleItem = $(`
                        <div class="extracted-module-item">
                            <div class="module-header">
                                <span class="module-index">模块 ${index + 1}</span>
                                <button class="btn-small add-to-config-btn" data-module="${JSON.stringify(module).replace(/"/g, '&quot;')}">添加到配置</button>
                            </div>
                            <div class="module-content">
                                <pre>${escapedModuleContent}</pre>
                                <div class="module-info">
                                    <p>消息索引：${module.messageIndex}</p>
                                    <p>发送者：${module.speakerName}</p>
                                </div>
                            </div>
                        </div>
                    `);

                    resultsList.append(moduleItem);
                });

                resultsContainer.append(resultsList);
                debugLog(`提取模块成功，共发现 ${modules.length} 个模块`);

                // 绑定添加到配置按钮事件
                $('.add-to-config-btn').on('click', (e) => {
                    const moduleData = JSON.parse($(e.currentTarget).data('module'));
                    this.addToConfig(moduleData);
                });
            } else {
                resultsContainer.append('<p class="no-results">未找到任何[模块名|键A:值A|键B:值B...]格式的模块。</p>');
                debugLog('提取模块完成，未发现模块');
            }
        } catch (error) {
            errorLog('提取模块失败:', error);
            toastr.error('提取模块失败，请查看控制台日志');
        }
    }

    /**
     * HTML转义函数 - 将特殊字符转换为HTML实体，确保标签显示为文本
     * @param {string} text - 需要转义的文本
     * @returns {string} 转义后的文本
     */
    htmlEscape(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 显示特定楼层的聊天内容
     * @param {number} floorNumber - 楼层号
     */
    showFloorContent(floorNumber) {
        try {
            debugLog(`开始显示第 ${floorNumber} 层的聊天内容`);

            // 检查是否有权限访问聊天记录
            if (!chat || !Array.isArray(chat)) {
                toastr.warning('无法访问聊天记录或聊天记录格式错误');
                return;
            }

            const messages = chat;
            if (messages.length === 0) {
                toastr.warning('未找到任何聊天消息');
                return;
            }

            // 计算索引（楼层号从1开始，索引从0开始）
            const index = floorNumber - 1;
            if (index < 0 || index >= messages.length) {
                toastr.warning(`楼层号超出范围，当前共有 ${messages.length} 条消息`);
                return;
            }

            // 获取目标消息
            const targetMessage = messages[index];
            // 支持两种消息格式：SillyTavern原生格式(mes)和标准格式(content)
            const messageContent = targetMessage.mes !== undefined ? targetMessage.mes : targetMessage.content;
            const isUserMessage = targetMessage.is_user || targetMessage.role === 'user';
            const speakerName = targetMessage.name || (isUserMessage ? 'user' : 'assistant');

            // 对消息内容进行HTML转义，确保标签显示为文本
            const escapedContent = this.htmlEscape(messageContent);

            // 清空结果容器
            const resultsContainer = $('#extract-results-container');
            resultsContainer.empty();

            // 创建楼层内容显示
            const floorContent = $(`
                <div class="floor-content-item">
                    <div class="module-header">
                        <span class="module-index">第 ${floorNumber} 层</span>
                    </div>
                    <div class="module-content">
                        <div class="module-info">
                            <p>发送者：${speakerName}</p>
                        </div>
                        <pre>${escapedContent}</pre>
                    </div>
                </div>
            `);

            resultsContainer.append(floorContent);
            debugLog(`显示第 ${floorNumber} 层聊天内容成功`);
        } catch (error) {
            errorLog(`显示第 ${floorNumber} 层聊天内容失败:`, error);
            toastr.error('显示楼层内容失败，请查看控制台日志');
        }
    }

    /**
     * 将提取的模块添加到配置
     * @param {Object} moduleData - 模块数据
     */
    addToConfig(moduleData) {
        try {
            debugLog('添加模块到配置:', moduleData);

            // 调用全局的addModule函数（需要确保在index.js中导出）
            if (typeof window.addModule === 'function') {
                window.addModule(moduleData);

                // 切换到配置标签页
                $('.tab-item[data-tab="config"]').click();
                toastr.success('模块已添加到配置');
            } else {
                errorLog('未找到addModule函数');
                toastr.error('添加模块失败，未找到相关函数');
            }
        } catch (error) {
            errorLog('添加模块到配置失败:', error);
            toastr.error('添加模块到配置失败，请查看控制台日志');
        }
    }
}
