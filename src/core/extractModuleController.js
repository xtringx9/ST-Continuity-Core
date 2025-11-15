// 提取模块控制器 - 独立管理提取模块功能
import { debugLog, errorLog, getModulesData } from '../index.js';
import { chat } from '../index.js';
import { ModuleExtractor } from './moduleExtractor.js';
import { parseCompatibleNames } from '../modules/moduleParser.js';
import { parseMultipleModules } from '../modules/parseModuleManager.js';

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

        // 绑定提取整理后模块按钮事件
        $('#extract-processed-modules-btn').on('click', () => {
            this.extractProcessedModules();
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

            // 解析变量部分 - 支持嵌套模块
            const variablesMap = {};
            selectedModule.variables.forEach(variable => {
                variablesMap[variable.name] = '';
            });

            // 解析变量字符串
            let lastPipePos = content.indexOf('|') + 1;
            let inNestedModule = 0;

            for (let i = lastPipePos; i < content.length; i++) {
                const char = content[i];

                if (char === '[') {
                    inNestedModule++;
                } else if (char === ']') {
                    inNestedModule--;
                } else if (char === '|' && inNestedModule === 0) {
                    // 只在顶级管道符处分割
                    const varPart = content.substring(lastPipePos, i).trim();
                    this.parseSingleVariableInProcess(varPart, variablesMap, variableNameMap);
                    lastPipePos = i + 1;
                }
            }

            // 处理最后一个变量部分
            const lastPart = content.substring(lastPipePos).trim();
            this.parseSingleVariableInProcess(lastPart, variablesMap, variableNameMap);

            // 构建当前模块的字符串
            let moduleString = `[${selectedModule.name}`;

            // 按照模块配置中的变量顺序添加变量
            selectedModule.variables.forEach(variable => {
                // 获取变量值
                let varValue = variablesMap[variable.name];

                moduleString += `|${variable.name}:${varValue}`;
            });

            moduleString += ']';

            return moduleString;
        });

        // 返回所有处理后的模块，用换行符分隔
        return processedModules.join('\n');
    }

    /**
     * 解析单个变量部分，支持嵌套模块
     * @param {string} part 单个变量部分，如 "own:所属人"
     * @param {Object} variablesMap 变量映射表
     * @param {Object} variableNameMap 变量名映射表（兼容变量名 -> 当前变量名）
     */
    parseSingleVariableInProcess(part, variablesMap, variableNameMap) {
        if (!part) return;

        let colonIndex = -1;
        let inNestedModule = 0;

        // 找到第一个顶级冒号
        for (let i = 0; i < part.length; i++) {
            const char = part[i];

            if (char === '[') {
                inNestedModule++;
            } else if (char === ']') {
                inNestedModule--;
            } else if (char === ':' && inNestedModule === 0) {
                colonIndex = i;
                break;
            }
        }

        if (colonIndex === -1) return;

        const varName = part.substring(0, colonIndex).trim();
        const varValue = part.substring(colonIndex + 1).trim();

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
     * 提取整理后模块功能
     */
    extractProcessedModules() {
        try {
            debugLog('开始提取整理后模块功能');

            // 获取用户输入的楼层范围
            const startFloor = parseInt($('#start-floor-input').val().trim());
            const endFloor = parseInt($('#end-floor-input').val().trim());

            // 获取选中的模块名
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
                // 按模块名和标识符分组处理
                const moduleGroups = this.groupModulesByIdentifier(modules);

                // 构建结果显示内容
                let resultContent = '';

                // 获取所有模块配置
                const modulesData = getModulesData();

                // 处理每个模块组
                for (const [moduleKey, moduleList] of Object.entries(moduleGroups)) {
                    const [moduleName, identifier] = moduleKey.split('_');

                    // 查找模块配置
                    const moduleConfig = modulesData.find(module => module.name === moduleName);

                    // 只有outputMode为"incremental"的模块才需要统合
                    const needMerge = moduleConfig && moduleConfig.outputMode === 'incremental';

                    if (needMerge) {
                        // 统合处理模块
                        const mergedModule = this.mergeModulesByOrder(moduleList, moduleConfig);

                        // 构建统合后的模块字符串
                        const mergedModuleStr = this.buildModuleString(mergedModule, moduleConfig);

                        // 构建历史记录
                        const historyModulesStr = moduleList.map(module => module.raw).join('\n');

                        // 添加到结果内容
                        resultContent += `统合：\n${mergedModuleStr}\n\n历史：\n${historyModulesStr}\n\n`;
                    } else {
                        // 不需要统合的模块，按模板格式化输出每个模块
                        const formattedModulesStr = moduleList.map(module => {
                            // 解析单个模块
                            const [modName, ...parts] = module.raw.slice(1, -1).split('|');
                            const moduleData = {
                                name: modName,
                                variables: {}
                            };

                            // 处理每个变量
                            parts.forEach(part => {
                                const colonIndex = part.indexOf(':');
                                if (colonIndex === -1) return;

                                const key = part.substring(0, colonIndex).trim();
                                const value = part.substring(colonIndex + 1).trim();

                                if (key) {
                                    moduleData.variables[key] = value;
                                }
                            });

                            // 按模板格式化构建模块字符串
                            return this.buildModuleString(moduleData, moduleConfig);
                        }).join('\n');

                        resultContent += `${moduleName}_${identifier}：\n${formattedModulesStr}\n\n`;
                    }
                }

                // 创建结果显示
                const resultDisplay = $(`
                    <div class="processed-module-result">
                        <div class="module-header">
                            <span class="module-index">整理后模块结果</span>
                        </div>
                        <div class="module-content">
                            <pre>${this.htmlEscape(resultContent)}</pre>
                        </div>
                    </div>
                `);

                resultsContainer.append(resultDisplay);
                debugLog(`提取整理后模块成功，共处理 ${modules.length} 个模块`);
            } else {
                resultsContainer.append('<p class="no-results">未找到任何[模块名|键A:值A|键B:值B...]格式的模块。</p>');
                debugLog('提取整理后模块完成，未发现模块');
            }
        } catch (error) {
            errorLog('提取整理后模块失败:', error);
            toastr.error('提取整理后模块失败，请查看控制台日志');
        }
    }

    /**
     * 将模块按模块名和标识符分组
     * @param {Array} modules 提取的模块数组
     * @returns {Object} 分组后的模块对象
     */
    groupModulesByIdentifier(modules) {
        const groups = {};

        modules.forEach(module => {
            // 解析模块名和标识符
            const [moduleName, ...parts] = module.raw.slice(1, -1).split('|');
            let identifier = 'default';

            // 查找标识符变量（如id、identifier等）
            for (const part of parts) {
                const colonIndex = part.indexOf(':');
                if (colonIndex === -1) continue;

                const key = part.substring(0, colonIndex).trim();
                const value = part.substring(colonIndex + 1).trim();

                if (key && (key.toLowerCase() === 'id' || key.toLowerCase() === 'identifier')) {
                    identifier = value || 'default';
                    break;
                }
            }

            // 构建分组键
            const groupKey = `${moduleName}_${identifier}`;

            // 添加到分组
            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }
            groups[groupKey].push(module);
        });

        return groups;
    }

    /**
     * 按顺序合并模块，后面的模块覆盖前面的
     * @param {Array} modules 模块数组
     * @param {Object} moduleConfig 模块配置
     * @returns {Object} 合并后的模块数据
     */
    mergeModulesByOrder(modules, moduleConfig) {
        // 初始化合并结果
        const merged = {
            name: '',
            variables: {}
        };

        modules.forEach(module => {
            // 解析模块
            const [moduleName, ...parts] = module.raw.slice(1, -1).split('|');
            merged.name = moduleName;

            // 处理每个变量
            parts.forEach(part => {
                const colonIndex = part.indexOf(':');
                if (colonIndex === -1) return;

                const key = part.substring(0, colonIndex).trim();
                const value = part.substring(colonIndex + 1).trim();

                if (key) {
                    // 如果值为空或undefined，则清空该变量
                    if (value === '' || value === undefined) {
                        merged.variables[key] = '';
                    } else {
                        merged.variables[key] = value;
                    }
                }
            });
        });

        return merged;
    }

    /**
     * 构建模块字符串
     * @param {Object} moduleData 模块数据
     * @param {Object} moduleConfig 模块配置
     * @returns {string} 模块字符串
     */
    buildModuleString(moduleData, moduleConfig) {
        let moduleStr = `[${moduleData.name}`;

        // 如果有模块配置，按配置的变量顺序构建
        if (moduleConfig && moduleConfig.variables) {
            moduleConfig.variables.forEach(variable => {
                const value = moduleData.variables[variable.name] || '';
                moduleStr += `|${variable.name}:${value}`;
            });
        } else {
            // 没有配置时，按变量名顺序构建
            Object.keys(moduleData.variables).sort().forEach(key => {
                const value = moduleData.variables[key] || '';
                moduleStr += `|${key}:${value}`;
            });
        }

        moduleStr += ']';
        return moduleStr;
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
