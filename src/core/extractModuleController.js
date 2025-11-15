// 提取模块控制器 - 独立管理提取模块功能
import { debugLog, errorLog, getModulesData } from '../index.js';
import { chat } from '../index.js';
import { ModuleExtractor } from './moduleExtractor.js';
import { parseCompatibleNames } from '../modules/moduleParser.js';

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
        this.populateModuleSelect();
        this.bindExtractModuleButtonEvent();
        this.bindShowFloorContentEvent();

        // 当切换到提取标签页时，重新填充模块下拉框
        $('.tab-item[data-tab="extract"]').on('click', () => {
            this.populateModuleSelect();
        });
    }

    /**
     * 填充模块选择下拉框
     */
    populateModuleSelect() {
        try {
            const moduleSelect = $('#module-select');
            if (!moduleSelect.length) return;

            // 清空下拉框，保留默认选项
            moduleSelect.find('option:not(:first)').remove();

            // 获取所有模块数据
            const modulesData = getModulesData();

            if (modulesData && modulesData.length > 0) {
                modulesData.forEach(module => {
                    // 添加模块到下拉框
                    moduleSelect.append($('<option>', {
                        value: module.name,
                        text: module.name
                    }));
                });
            }

            debugLog('模块选择下拉框填充完成');
        } catch (error) {
            errorLog('填充模块选择下拉框失败:', error);
        }
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

            // 获取用户输入的楼层范围
            const startFloor = parseInt($('#start-floor-input').val().trim());
            const endFloor = parseInt($('#end-floor-input').val().trim());

            // 获取选择的模块
            const selectedModuleName = $('#module-select').val();

            // 转换为索引（楼层从1开始，索引从0开始）
            let startIndex = 0;
            let endIndex = null;

            if (!isNaN(startFloor) && startFloor >= 1) {
                startIndex = startFloor - 1;
            }

            if (!isNaN(endFloor) && endFloor >= 1) {
                endIndex = endFloor - 1;
            }

            // 确保起始索引不大于结束索引
            if (endIndex !== null && startIndex > endIndex) {
                toastr.warning('起始楼层不能大于结束楼层');
                return;
            }

            // 获取模块过滤条件
            let moduleFilter = null;
            if (selectedModuleName && selectedModuleName !== 'all') {
                // 查找选中的模块配置
                const modulesData = getModulesData();
                const selectedModule = modulesData.find(module => module.name === selectedModuleName);

                if (selectedModule) {
                    moduleFilter = {
                        name: selectedModule.name,
                        compatibleModuleNames: selectedModule.compatibleModuleNames
                    };
                }
            }

            // 使用ModuleExtractor提取模块，指定范围和过滤条件
            const modules = this.moduleExtractor.extractModulesFromChat(/\[.*?\|.*?\]/g, startIndex, endIndex, moduleFilter);

            // 清空结果容器
            const resultsContainer = $('#extract-results-container');
            resultsContainer.empty();

            if (modules.length > 0) {
                // 合并并处理模块数据
                const processedResult = this.processExtractedModules(modules, selectedModuleName);

                // 创建结果显示
                const resultDisplay = $(`
                    <div class="processed-module-result">
                        <div class="module-header">
                            <span class="module-index">处理结果</span>
                        </div>
                        <div class="module-content">
                            <pre>${this.htmlEscape(processedResult)}</pre>
                        </div>
                    </div>
                `);

                resultsContainer.append(resultDisplay);
                debugLog(`提取模块成功，共发现 ${modules.length} 个模块`);
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
     * 处理提取的模块数据
     * @param {Array} modules 提取的模块数据数组
     * @param {string} selectedModuleName 选择的模块名称
     * @returns {string} 处理后的模块字符串
     */
    processExtractedModules(modules, selectedModuleName) {
        // 查找选中的模块配置
        const modulesData = getModulesData();
        const selectedModule = modulesData.find(module => module.name === selectedModuleName);

        if (!selectedModule) {
            // 如果没有找到模块配置，直接返回所有模块的原始内容
            return modules.map(module => module.raw).join('\n');
        }

        // 构建变量名映射（兼容变量名 -> 当前变量名）
        const variableNameMap = {};

        // 初始化映射表
        selectedModule.variables.forEach(variable => {
            // 当前变量名映射到自身
            variableNameMap[variable.name] = variable.name;

            // 兼容变量名映射到当前变量名
            if (variable.compatibleVariableNames) {
                const compatibleNamesArray = parseCompatibleNames(variable.compatibleVariableNames);
                compatibleNamesArray.forEach(compatName => {
                    variableNameMap[compatName.trim()] = variable.name;
                });
            }
        });

        // 处理每个模块并返回所有处理后的模块
        const processedModules = modules.map(module => {
            const raw = module.raw;

            // 提取模块内容（去掉首尾的[]）
            const content = raw.slice(1, -1);

            // 分割模块名和变量
            const parts = content.split('|');
            if (parts.length < 2) return module.raw;

            // 初始化当前模块的变量映射
            const variablesMap = {};
            selectedModule.variables.forEach(variable => {
                variablesMap[variable.name] = '';
            });

            // 解析变量部分
            for (let i = 1; i < parts.length; i++) {
                const varPart = parts[i].trim();
                // 使用更严格的解析，确保只在第一个冒号处分割
                const colonIndex = varPart.indexOf(':');
                if (colonIndex === -1) continue;

                const varName = varPart.substring(0, colonIndex).trim();
                const varValue = varPart.substring(colonIndex + 1).trim();

                if (varName && varValue) {
                    // 检查变量名是否在映射表中
                    if (variableNameMap.hasOwnProperty(varName)) {
                        const currentVarName = variableNameMap[varName];
                        variablesMap[currentVarName] = varValue;
                    } else {
                        // 处理兼容变量名的精确匹配
                        for (const [compatName, currentName] of Object.entries(variableNameMap)) {
                            if (varName === compatName) {
                                variablesMap[currentName] = varValue;
                                break;
                            }
                        }
                    }
                }
            }

            // 构建当前模块的字符串
            let moduleString = `[${selectedModule.name}`;

            // 按照模块配置中的变量顺序添加变量
            selectedModule.variables.forEach(variable => {
                // 获取变量值
                let varValue = variablesMap[variable.name];

                moduleString += `|${variable.name}: ${varValue}`;
            });

            moduleString += ']';

            return moduleString;
        });

        // 返回所有处理后的模块，用换行符分隔
        return processedModules.join('\n');
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
