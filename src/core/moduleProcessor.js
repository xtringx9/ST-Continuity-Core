// 模块数据处理器 - 独立管理模块数据的文本处理方法
import { chat, moduleCacheManager, configManager, debugLog, errorLog } from '../index.js';
import { extractModulesFromChat } from './moduleExtractor.js';
import { IdentifierParser } from '../utils/identifierParser.js';
import { parseTimeDetailed, formatTimeDataToStandard, completeTimeDataWithStandard } from '../utils/timeParser.js';
import { removeHyphens } from '../utils/stringUtils.js';

// /**
//  * 模块数据处理器类
//  */
// export class ModuleProcessor {
//     constructor() {
//         moduleExtractor = new ModuleExtractor();
//     }

/**
 * 提取模块数据
 * @param {number} startIndex 起始索引
 * @param {number} endIndex 结束索引
 * @param {Array} moduleFilters 模块过滤条件数组，每个过滤条件包含name和compatibleModuleNames
 * @returns {Promise<Array>} 提取到的原始模块数组
 */
function extractModules(startIndex, endIndex, moduleFilters) {
    return extractModulesFromChat(startIndex, endIndex, moduleFilters);
}

/**
 * 处理原生模块提取
 * @param {Array} rawModules 原始模块数组
 * @param {Array} selectedModuleNames 选中的模块名数组
 * @param {boolean} returnString 是否返回字符串格式
 * @returns {Object} 包含resultContent和displayTitle的对象
 */
export function processExtractModules(rawModules, selectedModuleNames, returnString) {
    // 对于extract类型，直接返回原生的模块数据，不进行标准化处理
    const modules = rawModules;

    // 过滤出选中的模块（支持多选）
    const filteredModules = modules.filter(module => {
        // 如果没有选择任何模块，显示所有模块
        if (!selectedModuleNames || selectedModuleNames.length === 0) {
            return true;
        }

        // 由于是原生数据，需要解析模块名来匹配
        const originalModuleName = module.raw.slice(1, module.raw.indexOf('|') > 0 ? module.raw.indexOf('|') : module.raw.length - 1);

        // 获取所有模块配置
        const modulesData = configManager.getModules() || [];

        // 检查是否匹配选中的模块名（支持兼容模块名）
        return selectedModuleNames.some(selectedModuleName => {
            // 直接匹配模块名
            if (selectedModuleName === originalModuleName) {
                return true;
            }

            // 查找对应的模块配置
            const moduleConfig = modulesData.find(configModule => configModule.name === selectedModuleName);
            if (moduleConfig && moduleConfig.compatibleModuleNames) {
                // 检查兼容模块名是否包含当前原生模块名
                return moduleConfig.compatibleModuleNames.includes(originalModuleName);
            }

            return false;
        });
    });

    let resultContent = '';
    const displayTitle = '原生模块提取结果';

    // 根据参数决定返回格式
    if (returnString) {
        // 直接返回原始模块字符串
        resultContent = filteredModules.map(module => module.raw).join('\n');
    } else {
        // 返回原生结构化数据
        resultContent = filteredModules.map(module => {
            // 解析模块名和变量
            const content = module.raw.slice(1, -1);
            const [moduleName, ...parts] = content.split('|');

            // 解析变量
            const variables = {};
            parts.forEach(part => {
                const colonIndex = part.indexOf(':');
                if (colonIndex === -1) return;
                const key = part.substring(0, colonIndex).trim();
                const value = part.substring(colonIndex + 1).trim();
                if (key) {
                    variables[key] = value;
                }
            });

            // 构建原生模块的结构化数据
            const moduleData = {
                moduleName: moduleName,
                identifier: module.identifier || '',
                variables: variables,
                raw: module.raw
                // 不再存储moduleConfig，需要时从configManager动态获取
            };

            return moduleData;
        });
    }

    return { resultContent, displayTitle };
}

/**
 * 处理标准化后的模块
 * @param {Array} rawModules 原始模块数组
 * @param {Array} selectedModuleNames 选中的模块名数组
 * @param {boolean} returnString 是否返回字符串格式
 * @returns {Object} 包含resultContent和displayTitle的对象
 */
export function processProcessedModules(rawModules, selectedModuleNames, returnString) {
    // 标准化模块数据，直接传入selectedModuleNames参数，normalizeModules会返回按模块名分组的结构
    const moduleGroups = normalizeModules(rawModules, selectedModuleNames);

    // 将分组结构展平为模块数组，保持原有逻辑兼容
    const filteredModules = Object.values(moduleGroups).flat();

    let resultContent = '';
    const displayTitle = '整理后模块结果';

    // 根据参数决定返回格式
    if (returnString) {
        // 构建处理后的模块字符串
        const processedModules = filteredModules.map(module => {
            // 动态获取模块配置
            const modulesData = configManager.getModules() || [];
            const moduleConfig = modulesData.find(config => config.name === module.moduleName);

            if (!moduleConfig) {
                // 没有模块配置，返回原始内容
                return module.raw;
            }

            // 构建当前模块的字符串
            let moduleString = `[${module.moduleName}`;

            // 按照模块配置中的变量顺序添加变量
            moduleConfig.variables.forEach(variable => {
                // 获取变量值
                let varValue = module.variables[variable.name] || '';

                moduleString += `|${variable.name}:${varValue}`;
            });

            moduleString += ']';

            return moduleString;
        });

        resultContent = processedModules.join('\n');
    } else {
        // 返回结构化数据
        resultContent = filteredModules.map(module => {
            // 构建当前模块的结构化数据
            const moduleData = {
                moduleName: module.moduleName,
                identifier: module.identifier || '',
                variables: module.variables || {},
                raw: module.raw
                // 不再存储moduleConfig，需要时从configManager动态获取
            };

            return moduleData;
        });
    }

    return { resultContent, displayTitle };
}

/**
 * 标准化模块数据，处理兼容模块名和兼容变量
 * @param {Array} modules 提取到的原始模块数组
 * @param {Array} selectedModuleNames 选中的模块名称数组（可选）
 * @returns {Object} 按模块名分组的标准化模块对象
 */
export function normalizeModules(modules, selectedModuleNames = []) {
    const modulesData = configManager.getModules() || [];
    const normalizedModules = [];

    // 第一步：标准化所有模块
    modules.forEach(module => {
        // 解析模块名和变量
        const [originalModuleName, ...parts] = module.raw.slice(1, -1).split('|');
        const moduleName = removeHyphens(originalModuleName.trim());

        // 解析当前模块的变量
        let isValid = false;
        const originalVariables = {};
        parts.forEach(part => {
            const colonIndex = part.indexOf(':');
            if (colonIndex === -1) return;

            const key = removeHyphens(part.substring(0, colonIndex).trim());
            const value = part.substring(colonIndex + 1).trim();
            if (value) isValid = true;
            if (key) {
                originalVariables[key] = value;
            }
        });

        if (isValid) {
            // 查找模块配置（支持兼容模块名）
            const moduleConfig = modulesData.find(configModule => {
                // 检查主模块名是否匹配（使用去'-'后的模块名）
                if (configModule.name === moduleName) return true;
                // 检查兼容模块名是否包含当前模块名
                if (configModule.compatibleModuleNames) {
                    // const compatibleNames = configModule.compatibleModuleNames.split(',').map(name => name.trim());
                    return configModule.compatibleModuleNames.includes(originalModuleName) ||
                        configModule.compatibleModuleNames.includes(moduleName);
                }
                return false;
            });

            if (moduleConfig) {
                // 构建变量名映射（兼容变量名 -> 当前变量名）
                const variableNameMap = buildVariableNameMap(moduleConfig);

                // 标准化变量
                const normalizedVariables = {};
                moduleConfig.variables.forEach(variable => {
                    normalizedVariables[variable.name] = '';
                });

                // 提取模块内容（去掉首尾的[]）
                const content = module.raw.slice(1, -1);

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
                        parseSingleVariableInProcess(varPart, normalizedVariables, variableNameMap);
                        lastPipePos = i + 1;
                    }
                }

                // 处理最后一个变量部分
                const lastPart = content.substring(lastPipePos).trim();
                parseSingleVariableInProcess(lastPart, normalizedVariables, variableNameMap);

                // 构建标准化模块
                const normalizedModule = {
                    ...module,
                    originalModuleName,
                    moduleName: moduleConfig.name, // 使用配置中的标准模块名
                    variables: normalizedVariables
                    // 不再存储moduleConfig，需要时从configManager动态获取
                };

                normalizedModules.push(normalizedModule);
            } else {
                // 如果没有找到模块配置，使用原始模块数据（使用去'-'后的模块名）
                normalizedModules.push({
                    ...module,
                    originalModuleName,
                    moduleName: moduleName,
                    variables: originalVariables
                    // 不再存储moduleConfig，需要时从configManager动态获取
                });
            }
        }
    });


    debugLog('[Module Processor] 初步标准化模块完成，模块:', normalizedModules);

    // 第二步：模块内容去重
    const deduplicatedModules = deduplicateModules(normalizedModules);

    // 第三步：为包含time变量的模块附加结构化时间数据（包含格式化）
    attachStructuredTimeData(deduplicatedModules);

    // 第四步：智能补全time变量
    completeTimeVariables(deduplicatedModules);

    // 第四点五步：按模块名分组，同时根据selectedModuleNames进行过滤
    let moduleGroups = {};
    deduplicatedModules.forEach(module => {
        // 过滤逻辑：如果没有选择任何模块，或者当前模块在选中列表中，则保留
        if (!selectedModuleNames || selectedModuleNames.length === 0 ||
            selectedModuleNames.includes(module.moduleName)) {
            if (!moduleGroups[module.moduleName]) {
                moduleGroups[module.moduleName] = [];
            }
            moduleGroups[module.moduleName].push(module);
        }
    });

    // 按照modulesData中模块配置的order属性对moduleGroups进行排序
    debugLog('[Module Processor] 开始对moduleGroups按order排序，原始moduleGroups:', Object.keys(moduleGroups));
    const sortedModuleGroups = {};
    const moduleOrderInfo = Object.keys(moduleGroups)
        .map(moduleName => {
            const moduleConfig = modulesData.find(config => config.name === moduleName);
            const order = moduleConfig?.order !== undefined ? moduleConfig.order : 0;
            debugLog('[Module Processor] 模块排序信息:', moduleName, 'order:', order);
            return { moduleName, order };
        })
        .sort((a, b) => a.order - b.order);

    debugLog('[Module Processor] 排序后的模块顺序:', moduleOrderInfo.map(item => `${item.moduleName} (order: ${item.order})`));

    moduleOrderInfo.forEach(item => {
        sortedModuleGroups[item.moduleName] = moduleGroups[item.moduleName];
    });

    // 使用排序后的moduleGroups
    moduleGroups = sortedModuleGroups;
    debugLog('[Module Processor] 排序后的moduleGroups:', Object.keys(moduleGroups));

    // 直接在moduleGroups上处理每个模块组
    Object.entries(moduleGroups).forEach(([moduleName, moduleGroup]) => {
        // 在模块组内部进行排序
        const sortedGroup = sortModules(moduleGroup);

        // 查找当前模块的配置
        const moduleConfig = modulesData.find(config => config.name === moduleName);
        // 只有当模块配置中存在id变量时才补全id变量
        if (configManager.hasModuleVariable(moduleConfig, 'id')) {
            completeIdVariables(sortedGroup);
        }

        // 只有当模块配置中存在level变量时才处理level变量
        if (configManager.hasModuleVariable(moduleConfig, 'level')) {
            moduleGroups[moduleName] = processLevelVariables(sortedGroup, modulesData);
        } else {
            // 如果没有level变量，直接使用排序后的模块组
            moduleGroups[moduleName] = sortedGroup;
        }
    });

    debugLog('[Module Processor] 标准化模块完成:', moduleGroups);

    // 返回按模块名分组的结构
    return moduleGroups;
}

/**
 * 模块内容去重
 * 如果所有变量的值都一致，则视为重复条目并去除
 * 去重时保留messageIndex最小的模块
 * 对于增量模块，使用临时messageIndex进行特殊处理
 * @param {Array} modules 标准化后的模块数组
 * @returns {Array} 去重后的模块数组
 */
/**
 * 处理level变量，管理压缩层级和可见性
 * 1. 为level变量为空的模块设置默认值0
 * 2. 根据最高层级level，隐藏其范围内的低层级条目
 * @param {Array} modules 排序后的模块数组
 * @param {Array} modulesData 模块配置数据
 */
function processLevelVariables(modules, modulesData) {
    debugLog('[Level Processor] 开始处理level变量，模块:', modules);
    // 首先，为所有模块设置默认level值为0（如果未定义）
    modules.forEach(module => {
        if (module.variables.level === undefined || module.variables.level === null || module.variables.level === '') {
            module.variables.level = 0;
            // debugLog('[Level Processor] 为模块设置level值为:', module.variables.level, module);
        }
        // else {
        //     // 确保level是数字类型
        //     module.variables.level = parseInt(module.variables.level, 10) || 0;
        // }
        // 初始化visibility属性，默认为可见
        module.visibility = true;
    });

    // 找出所有level大于0的压缩模块，并按level从高到低排序
    const compressedModules = modules.filter(module => module.variables.level > 0)
        .sort((a, b) => b.variables.level - a.variables.level);
    debugLog('[Level Processor] level大于0的模块：', compressedModules);
    // 处理每个压缩模块
    compressedModules.forEach(compressedModule => {
        // 获取模块配置以确定identifier变量
        const moduleConfig = modulesData.find(config => config.name === compressedModule.moduleName);
        if (!moduleConfig) return;

        // 找出有且仅有一个isIdentifier为true的变量
        const identifierVariables = moduleConfig.variables.filter(variable => variable.isIdentifier);
        if (identifierVariables.length !== 1) return;

        const identifierVar = identifierVariables[0];
        const identifierName = identifierVar.name;
        const identifierValue = compressedModule.variables[identifierName];
        debugLog('[Level Processor] 压缩模块的identifier变量:', identifierVar, '名称:', identifierName, '值:', identifierValue, compressedModule);

        // 根据不同类型的identifier进行处理
        if (identifierName.toLowerCase().includes('time')) {
            // 时间类型identifier，使用timeData
            processTimeBasedCompression(compressedModule, modules);
        } else if (identifierName.toLowerCase() === 'id') {
            // ID类型identifier，使用convertAlphaNumericId处理
            processIdBasedCompression(compressedModule, modules, identifierVar);
        }
    });

    // 返回过滤掉visibility为false的模块
    const visibleModules = sortModules(modules.filter(module => module.visibility));
    debugLog('[Level Processor] 可见模块:', visibleModules);
    return visibleModules;
}

/**
 * 处理基于时间的压缩
 * @param {Object} compressedModule 压缩模块
 * @param {Array} modules 所有模块数组
 */
function processTimeBasedCompression(compressedModule, modules) {
    const { timeData } = compressedModule;
    if (!timeData || !timeData.isValid || (!timeData.isComplete && !timeData.startTime.hasDate)) return;

    // 获取压缩模块的时间范围
    const compressedStart = timeData.startTime.timestamp;
    const compressedEnd = timeData.endTime.timestamp;
    const compressedLevel = compressedModule.variables.level;

    // 隐藏所有在时间范围内且level小于压缩模块level的模块
    modules.forEach(module => {
        // 跳过自身和已隐藏的模块
        if (module === compressedModule || !module.visibility) return;

        // 跳过level不小于压缩模块level的模块
        if (module.variables.level >= compressedLevel) return;

        // 检查时间范围
        const moduleTimeData = module.timeData;
        if (moduleTimeData && moduleTimeData.isValid && (moduleTimeData.isComplete || (!moduleTimeData.isComplete && moduleTimeData.startTime.hasDate))) {
            if (!moduleTimeData.isRange) {
                const moduleStart = moduleTimeData.startTime.timestamp;
                // 如果模块的时间范围完全包含在压缩模块的时间范围内，则隐藏
                if (moduleStart >= compressedStart && moduleStart <= compressedEnd) {
                    debugLog('[Level Processor] 隐藏模块，因为其时间范围完全包含在压缩模块时间范围内:', moduleStart, '压缩开始时间:', compressedStart, '压缩结束时间:', compressedEnd, module, compressedModule);
                    module.visibility = false;
                }
                else {
                    debugLog('[Level Processor] 检查模块时间范围:', module, '压缩模块时间范围:', compressedStart, compressedEnd);
                }
            }
            else {
                const moduleStart = moduleTimeData.startTime.timestamp;
                const moduleEnd = moduleTimeData.endTime.timestamp;
                // 如果模块的时间范围完全包含在压缩模块的时间范围内，则隐藏
                if (moduleStart >= compressedStart && moduleEnd <= compressedEnd) {
                    debugLog('[Level Processor] 隐藏模块，因为其时间范围完全包含在压缩模块时间范围内:', moduleStart, ' ', moduleEnd, '压缩开始时间:', compressedStart, '压缩结束时间:', compressedEnd, module, compressedModule);
                    module.visibility = false;
                }
                else {
                    debugLog('[Level Processor] 检查模块时间范围:', module, '压缩模块时间范围:', compressedStart, compressedEnd);
                }
            }
        }
    });
}

/**
 * 处理基于ID的压缩
 * @param {Object} compressedModule 压缩模块
 * @param {Array} modules 所有模块数组
 * @param {Object} identifierVar 标识符变量配置
 */
function processIdBasedCompression(compressedModule, modules, identifierVar) {
    const identifierName = identifierVar.name;
    const compressedIdValue = compressedModule.variables[identifierName];
    const compressedLevel = compressedModule.variables.level;

    debugLog('[Level Processor] 压缩模块的ID值:', compressedIdValue, '压缩模块的level:', compressedLevel, compressedModule);
    // 解析压缩模块的ID范围
    const idRange = parseIdRange(compressedIdValue);
    if (!idRange) return;

    // 隐藏所有在ID范围内且level小于压缩模块level的模块
    modules.forEach(module => {
        // 跳过自身和已隐藏的模块
        if (module === compressedModule || !module.visibility) return;

        // 跳过level不小于压缩模块level的模块
        if (module.variables.level >= compressedLevel) return;

        // 检查ID范围
        const moduleIdValue = module.variables[identifierName];
        if (moduleIdValue) {
            // 转换为可排序的格式
            const convertedModuleId = convertAlphaNumericId(moduleIdValue);

            // 如果模块的ID在压缩模块的ID范围内，则隐藏
            if (isIdInRange(convertedModuleId, idRange)) {
                module.visibility = false;
            }
        }
    });
}

/**
 * 解析ID范围
 * 支持格式如：001~004, 001-004
 * @param {string} idValue ID值
 * @returns {Object|null} 包含start和end的范围对象
 */
function parseIdRange(idValue) {
    if (typeof idValue !== 'string') return null;

    // 匹配范围格式
    const rangeMatch = idValue.match(/^(.+)[~-](.+)$/);
    if (!rangeMatch || rangeMatch.length !== 3) return null;

    const start = convertAlphaNumericId(rangeMatch[1].trim());
    const end = convertAlphaNumericId(rangeMatch[2].trim());
    // debugLog('[ID Range] 解析ID范围:', idValue, '转换后的范围:', start, end);
    return { start, end };
}

/**
 * 检查ID是否在范围内
 * @param {string|number} id 要检查的ID
 * @param {Object} range 范围对象
 * @returns {boolean} 是否在范围内
 */
function isIdInRange(id, range) {
    // 将ID转换为数字进行比较
    const idNum = typeof id === 'string' ? parseInt(id, 10) : id;
    const startNum = typeof range.start === 'string' ? parseInt(range.start, 10) : range.start;
    const endNum = typeof range.end === 'string' ? parseInt(range.end, 10) : range.end;

    return !isNaN(idNum) && !isNaN(startNum) && !isNaN(endNum) &&
        idNum >= startNum && idNum <= endNum;
}

/**
 * 获取模块配置
 * @param {string} moduleName 模块名称
 * @returns {Object|null} 模块配置对象
 */
function getModuleConfigByName(moduleName) {
    // 从全局获取modulesData
    // 这里需要确保modulesData在当前作用域可用
    // 参考getModuleIdentifierInfo函数的实现方式
    // 注意：在实际使用processLevelVariables时，需要传入modulesData
    return global.modulesData ? global.modulesData.find(config => config.name === moduleName) : null;
}

export function deduplicateModules(modules) {
    // debugLog('[Deduplication] 开始模块去重，模块数量:', modules.length);

    // 获取所有模块配置
    const modulesConfig = configManager.getModules() || [];

    // 使用Map来存储每个唯一模块的最小messageIndex版本
    const moduleMap = new Map();
    // 使用Map来存储临时messageIndex信息
    // const tempMessageIndexMap = new Map();
    let duplicateCount = 0;

    modules.forEach(module => {
        // 获取当前模块的配置
        const moduleConfig = modulesConfig.find(config => config.name === module.moduleName);
        // 判断是否为增量模块（outputMode === 'incremental'）
        const isIncrementalModule = moduleConfig && moduleConfig.outputMode === 'incremental';

        // 构建模块的唯一标识符：基于所有变量值的组合
        const moduleKey = JSON.stringify({
            moduleName: module.moduleName,
            variables: module.variables
        });

        // 检查是否已经存在相同的模块
        if (moduleMap.has(moduleKey)) {
            const existingModule = moduleMap.get(moduleKey);

            if (!existingModule.messageIndexHistory.includes(module.messageIndex)) {
                existingModule.messageIndexHistory.push(module.messageIndex);
            }

            const currentMessageIndex = module.messageIndex;
            let existingMessageIndex = existingModule.messageIndex;

            if (isIncrementalModule) {
                existingMessageIndex = getMaxMessageIndexFromHistory(existingModule, currentMessageIndex);

                const diff = Math.abs(currentMessageIndex - existingMessageIndex);

                if (diff > 2) {
                    existingModule.messageIndex = currentMessageIndex;
                }
            } else {
                // 全量模块使用原有逻辑
                // 比较messageIndex，保留较小的那个，但只在messageIndex都非负数时进行比较
                const shouldCompare = currentMessageIndex >= 0 && existingMessageIndex >= 0;

                if (shouldCompare && currentMessageIndex < existingMessageIndex) {
                    // 两个messageIndex都非负数，且当前模块的messageIndex更小
                    existingModule.messageIndex = currentMessageIndex;
                    debugLog('[Deduplication] 替换为更小的messageIndex:', module.moduleName, '新messageIndex:', currentMessageIndex, '旧messageIndex:', existingMessageIndex, 'module:', module, 'existingModule:', existingModule);
                } else if (!shouldCompare && currentMessageIndex >= 0 && existingMessageIndex < 0) {
                    // 当前模块messageIndex非负数，已存在模块为负数，保留非负数
                    existingModule.messageIndex = currentMessageIndex;
                    debugLog('[Deduplication] 替换负数messageIndex为正数:', module.moduleName, '新messageIndex:', currentMessageIndex, '旧messageIndex:', existingMessageIndex, 'module:', module, 'existingModule:', existingModule);
                } else if (!shouldCompare && currentMessageIndex < 0 && existingMessageIndex >= 0) {
                    // 当前模块messageIndex为负数，已存在模块为非负数，保留非负数
                    // existingModule.messageIndex = existingMessageIndex;
                    debugLog('[Deduplication] 保留非负数messageIndex:', module.moduleName, '当前messageIndex:', currentMessageIndex, '已有messageIndex:', existingMessageIndex, 'module:', module, 'existingModule:', existingModule);
                } else {
                    // 其他情况（包括两个都为负数，或比较后保留原有模块）
                    debugLog('[Deduplication] 保留原有模块:', module.moduleName, '当前messageIndex:', module.messageIndex, '已有messageIndex:', existingModule.messageIndex, 'module:', module, 'existingModule:', existingModule);
                }
            }

            //     if (isIncrementalModule) {
            //         // 增量模块的特殊处理逻辑

            //         // 获取或初始化临时messageIndex
            //         let tempMessageIndex = tempMessageIndexMap.get(moduleKey) || Math.max(existingModule.messageIndex, module.messageIndex);

            //         // 比较当前模块的messageIndex与临时messageIndex的差值
            //         const currentMessageIndex = module.messageIndex >= 0 ? module.messageIndex : tempMessageIndex;
            //         const diff = Math.abs(currentMessageIndex - tempMessageIndex);

            //         // 如果差值大于2，则保留两个模块（通过创建新的key来实现）
            //         if (diff > 2) {
            //             // 创建一个新的唯一key，避免去重
            //             const newModuleKey = `${moduleKey}_${Date.now()}_${Math.random()}`;
            //             moduleMap.set(newModuleKey, module);
            //             // 为新模块设置临时messageIndex
            //             tempMessageIndexMap.set(newModuleKey, currentMessageIndex);
            //             debugLog('[Deduplication] 增量模块差值大于2，保留两个模块:', module.moduleName, '差值:', diff, 'messageIndex1:', tempMessageIndex, 'messageIndex2:', currentMessageIndex);
            //         } else {
            //             // 如果差值小于等于2，则保留原有模块，但更新临时messageIndex
            //             tempMessageIndex = Math.max(tempMessageIndex, currentMessageIndex);
            //             tempMessageIndexMap.set(moduleKey, tempMessageIndex);
            //             debugLog('[Deduplication] 增量模块差值小于等于2，保留原有模块并更新临时messageIndex:', module.moduleName, '差值:', diff, '新临时messageIndex:', tempMessageIndex);
            //         }
            //     } else {
            //         // 全量模块使用原有逻辑
            //         // 比较messageIndex，保留较小的那个，但只在messageIndex都非负数时进行比较
            //         const shouldCompare = module.messageIndex >= 0 && existingModule.messageIndex >= 0;

            //         if (shouldCompare && module.messageIndex < existingModule.messageIndex) {
            //             // 两个messageIndex都非负数，且当前模块的messageIndex更小
            //             moduleMap.set(moduleKey, module);
            //             debugLog('[Deduplication] 替换为更小的messageIndex:', module.moduleName, '新messageIndex:', module.messageIndex, '旧messageIndex:', existingModule.messageIndex, 'module:', module, 'existingModule:', existingModule);
            //         } else if (!shouldCompare && module.messageIndex >= 0 && existingModule.messageIndex < 0) {
            //             // 当前模块messageIndex非负数，已存在模块为负数，保留非负数
            //             moduleMap.set(moduleKey, module);
            //             debugLog('[Deduplication] 替换负数messageIndex为正数:', module.moduleName, '新messageIndex:', module.messageIndex, '旧messageIndex:', existingModule.messageIndex, 'module:', module, 'existingModule:', existingModule);
            //         } else if (!shouldCompare && module.messageIndex < 0 && existingModule.messageIndex >= 0) {
            //             // 当前模块messageIndex为负数，已存在模块为非负数，保留非负数
            //             debugLog('[Deduplication] 保留非负数messageIndex:', module.moduleName, '当前messageIndex:', module.messageIndex, '已有messageIndex:', existingModule.messageIndex, 'module:', module, 'existingModule:', existingModule);
            //         } else {
            //             // 其他情况（包括两个都为负数，或比较后保留原有模块）
            //             debugLog('[Deduplication] 保留原有模块:', module.moduleName, '当前messageIndex:', module.messageIndex, '已有messageIndex:', existingModule.messageIndex, 'module:', module, 'existingModule:', existingModule);
            //         }
            //     }

            duplicateCount++;
        } else {
            // 第一次遇到这个模块，直接存储
            moduleMap.set(moduleKey, module);
            if (!module.messageIndexHistory) {
                module.messageIndexHistory = [module.messageIndex];
            }
            // 为增量模块初始化临时messageIndex
            // if (isIncrementalModule) {
            // const tempMessageIndex = module.messageIndex >= 0 ? module.messageIndex : 0;
            // tempMessageIndexMap.set(moduleKey, tempMessageIndex);
            // debugLog('[Deduplication] 初始化增量模块临时messageIndex:', module.moduleName, 'tempMessageIndex:', tempMessageIndex);
            // }
        }
    });

    // 将Map中的值转换为数组
    const uniqueModules = Array.from(moduleMap.values());

    debugLog('[Deduplication] 去重完成，原始模块数:', modules.length, '去重后模块数:', uniqueModules.length, '重复模块数:', duplicateCount);

    return uniqueModules;
}

/**
 * 智能补全time变量
 * 利用已附加的timeData属性，为同一message内的模块补全时间数据
 * @param {Array} modules 标准化后的模块数组
 */
export function completeTimeVariables(modules) {
    // debugLog('[TimeCompletion] 开始智能补全time变量，模块数量:', modules.length);

    // 按messageIndex分组
    const messageModulesMap = {};

    // 第一步：分组
    modules.forEach(module => {
        const messageIndex = module.messageIndex;
        if (messageIndex >= 0) {
            if (!messageModulesMap[messageIndex]) {
                messageModulesMap[messageIndex] = [];
            }
            messageModulesMap[messageIndex].push(module);
        }
    });

    // 第二步：为每组message中的模块补全time变量
    Object.values(messageModulesMap).forEach((messageModules, index) => {
        // 获取所有模块配置
        const modulesData = configManager.getModules() || [];

        // 查找该message中包含完整time信息的模块作为标准时间
        let standardTimeData = null;
        let standardTimeModuleName = '';

        // 策略1：优先查找开启了时间参考标准且timeData有效且完整的模块
        for (const module of messageModules) {
            if (module.timeData && module.timeData.isValid && module.timeData.isComplete) {
                // 查找当前模块的配置
                const moduleConfig = modulesData.find(config => config.name === module.moduleName);

                // 如果是时间参考标准模块，直接使用
                if (moduleConfig && moduleConfig.timeReferenceStandard) {
                    standardTimeData = module.timeData;
                    standardTimeModuleName = module.moduleName;
                    // debugLog(`[TimeCompletion] 找到时间参考标准模块 ${standardTimeModuleName} 的标准时间数据`);
                    break;
                }
            }
        }

        // 策略2：如果策略1没找到，查找任何timeData有效且完整的模块
        if (!standardTimeData) {
            for (const module of messageModules) {
                if (module.timeData && module.timeData.isValid && module.timeData.isComplete) {
                    standardTimeData = module.timeData;
                    standardTimeModuleName = module.moduleName;
                    debugLog(`[TimeCompletion] 找到标准时间数据，来自模块 ${standardTimeModuleName}`);
                    break;
                }
            }
        }

        if (!standardTimeData) {
            // debugLog(`[TimeCompletion] 第${index + 1}组message中未找到完整的标准时间数据`);
            return;
        }

        // 获取标准时间的年月日信息
        // 使用standardTimeData直接进行时间补全

        // 使用标准时间为其他模块补全
        let completionCount = 0;

        for (const module of messageModules) {
            // 跳过标准时间模块本身
            if (module.timeData === standardTimeData) continue;

            for (const [variableName] of Object.entries(module.variables)) {
                if (variableName.toLowerCase().includes('time')) {
                    if (!module.timeData || (!module.timeData.isValid && !module.timeData.originalText)) {
                        debugLog(`[TimeCompletion] 模块 ${module.moduleName} 的时间数据无效，${module.timeData?.originalText}`, module);
                        module.timeData = standardTimeData;
                        module.variables[variableName] = module.timeData.formattedString;
                        completionCount++;
                        break;
                    }
                }
            }
            for (const [variableName] of Object.entries(module.variables)) {
                if (variableName.toLowerCase().includes('time')) {
                    if (module.timeData && module.timeData.isValid && !module.timeData.isComplete) {

                        const formattedString = module.timeData.formattedString;

                        // 检查是否需要补全日年月日
                        // 使用completeTimeDataWithStandard函数补全时间数据
                        const updatedTimeData = completeTimeDataWithStandard(module.timeData, standardTimeData);

                        // 如果时间数据被成功补全
                        if (updatedTimeData !== module.timeData) {
                            module.timeData = updatedTimeData;
                        }
                        debugLog(`[TimeCompletion] 补全模块 ${module.moduleName} 的时间数据，添加年月日信息${module.timeData.formattedString}，旧时间：${formattedString}`, module);

                        // 更新模块的time变量值
                        if (module.variables && module.timeData.isComplete) {
                            debugLog(`[TimeCompletion] 补全模块 ${module.moduleName} 的时间数据，添加年月日信息${module.timeData.formattedString}，旧时间：${formattedString}`, module);
                            module.variables[variableName] = module.timeData.formattedString;
                            completionCount++;
                            break;
                        }
                    }
                }
            }
        }

        if (completionCount > 0) {
            debugLog(`[TimeCompletion] 第${index + 1}组message完成时间补全，共补全${completionCount}个模块`);
        }
    });
    debugLog('[TimeCompletion] 智能补全time变量完成');
}

// /**
//  * 根据参考时间字符串的格式，格式化新的时间对象
//  * @param {string} referenceTimeStr 参考时间字符串
//  * @param {Date} date 要格式化的时间对象
//  * @returns {string} 格式化后的时间字符串
//  */
// export function formatTimeToSamePattern(referenceTimeStr, date) {
//     // 根据参考时间的格式返回相应格式的时间字符串
//     if (/^\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
//         // 格式：2023年09月30日 21:30
//         return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
//     } else if (/^\d{2}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
//         // 格式：24年4月11日 08:23
//         return `${String(date.getFullYear()).slice(-2)}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
//     } else if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
//         // 格式：2023-09-30 21:30
//         return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
//     } else if (/^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
//         // 格式：2023/09/30 21:30
//         return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
//     } else {
//         // 默认格式
//         return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
//     }
// }

// /**
//  * 解析时间字符串为时间戳
//  * 支持多种时间格式，包括时间段
//  * @param {string} timeStr 时间字符串
//  * @returns {number} 时间戳（毫秒）
//  */
// export function parseTime(timeStr) {
//     if (!timeStr || typeof timeStr !== 'string') {
//         return 0;
//     }

//     // 尝试匹配时间段格式，例如 "24年4月11日 周四 08:23 ~ 24年4月22日 周一 18:40"
//     // 支持中英文时间范围格式：
//     // 2023年09月28日 周四 10:10~17:30
//     // 2023年09月28日 周四 10:10~2023年09月28日 周五 17:30
//     // 2023-09-28 Thursday 10:10~17:30
//     // 2023-09-28 Thursday 10:10~2023-09-29 Friday 17:30
//     const timeRangeMatch = timeStr.match(/(.*?)\s*~\s*(.*)/);
//     if (timeRangeMatch) {
//         // 如果是时间段，取开始时间
//         timeStr = timeRangeMatch[1].trim();
//     }

//     // 尝试匹配各种时间格式（按从具体到通用的顺序）
//     const patterns = [
//         // 最具体的格式：带星期的完整日期时间
//         // 格式：2023年09月28日 周四 10:10
//         /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(?:周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})$/,
//         // 格式：24年4月11日 周四 08:23
//         /^(\d{2})年(\d{1,2})月(\d{1,2})日\s+(?:周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})$/,
//         // 格式：2023-09-28 Thursday 10:10
//         /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(?:周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})$/,
//         // 格式：2023/09/28 Thursday 10:10
//         /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(?:周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})$/,

//         // 完整的日期时间格式
//         // 格式：2023年09月30日 21:30
//         /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})$/,
//         // 格式：24年4月11日 08:23
//         /^(\d{2})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})$/,
//         // 格式：2023-09-30 21:30
//         /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/,
//         // 格式：2023/09/30 21:30
//         /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/,

//         // 仅日期格式
//         // 格式：2023年09月30日
//         /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
//         // 格式：24年4月11日
//         /^(\d{2})年(\d{1,2})月(\d{1,2})日$/,
//         // 格式：2023-09-30
//         /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
//         // 格式：2023/09/30
//         /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,

//         // 仅时间格式（放在最后，因为最通用）
//         // 格式：08:23
//         /^(\d{1,2}):(\d{1,2})$/,
//     ];

//     for (const pattern of patterns) {
//         const match = timeStr.match(pattern);
//         if (match) {
//             let year, month, day, hour = 0, minute = 0;

//             switch (match.length) {
//                 case 4: // 时间格式：HH:MM 或 日期格式：YYYY年MM月DD日
//                     if (pattern.toString().includes('年') && pattern.toString().includes('月') && pattern.toString().includes('日')) {
//                         // 日期格式：YYYY年MM月DD日
//                         [, year, month, day] = match;
//                     } else {
//                         // 时间格式：HH:MM
//                         [, hour, minute] = match;
//                         year = new Date().getFullYear();
//                         month = new Date().getMonth() + 1;
//                         day = new Date().getDate();
//                     }
//                     break;
//                 case 6: // 日期+时间格式
//                     if (match[1].length === 2) {
//                         // 两位数年份
//                         [, year, month, day, hour, minute] = match;
//                         year = parseInt(year, 10) + 2000; // 假设是2000年后
//                     } else {
//                         // 四位数年份
//                         [, year, month, day, hour, minute] = match;
//                     }
//                     break;
//                 case 5: // 日期格式
//                     if (match[1].length === 2) {
//                         // 两位数年份
//                         [, year, month, day] = match;
//                         year = parseInt(year, 10) + 2000; // 假设是2000年后
//                     } else {
//                         // 四位数年份
//                         [, year, month, day] = match;
//                     }
//                     break;
//             }

//             // 转换为数字
//             year = parseInt(year, 10);
//             month = parseInt(month, 10) - 1; // JavaScript月份从0开始
//             day = parseInt(day, 10);
//             hour = parseInt(hour, 10);
//             minute = parseInt(minute, 10);

//             // 创建日期对象
//             const date = new Date(year, month, day, hour, minute);
//             if (!isNaN(date.getTime())) {
//                 return date.getTime();
//             }
//         }
//     }

//     // 如果无法解析，返回0
//     return 0;
// }

// /**
//  * 解析时间字符串为时间戳，支持时间段的中点排序
//  * 支持混合时间格式：完整日期时间、仅日期、仅时间、时间段
//  * @param {string} timeStr 时间字符串
//  * @returns {number} 时间戳（毫秒），对于时间段返回中点时间戳
//  */
// export function parseTimeForSorting(timeStr) {
//     if (!timeStr || typeof timeStr !== 'string') {
//         return 0;
//     }

//     // 尝试匹配时间段格式，例如 "24年4月11日 周四 08:23 ~ 24年4月22日 周一 18:40"
//     const timeRangeMatch = timeStr.match(/(.*?)\s*~\s*(.*)/);
//     if (timeRangeMatch) {
//         // 如果是时间段，计算中点时间
//         const startTimeStr = timeRangeMatch[1].trim();
//         const endTimeStr = timeRangeMatch[2].trim();

//         const startTime = parseTime(startTimeStr);
//         const endTime = parseTime(endTimeStr);

//         // 如果开始时间和结束时间都有效，计算中点
//         if (startTime > 0 && endTime > 0) {
//             return (startTime + endTime) / 2;
//         }
//         // 如果只有开始时间有效，使用开始时间
//         else if (startTime > 0) {
//             return startTime;
//         }
//         // 如果只有结束时间有效，使用结束时间
//         else if (endTime > 0) {
//             return endTime;
//         }
//         // 如果都无法解析，返回0
//         else {
//             return 0;
//         }
//     }

//     // 如果不是时间段，使用原有的parseTime逻辑
//     return parseTime(timeStr);
// }

/**
 * 判断字符串是否可以转换为数值
 * @param {string} str 要检查的字符串
 * @returns {boolean} 是否可以转换为数值
 */
export function isNumeric(str) {
    if (typeof str !== 'string') {
        return false;
    }
    // 检查是否是数字字符串（整数或小数）
    return !isNaN(str) && !isNaN(parseFloat(str));
}

/**
 * 获取模块的标识符信息
 * @param {Object} module - 模块对象
 * @param {Array} modulesData - 所有模块配置数组
 * @returns {Object} 包含identifierValue、isTimeIdentifier和hasValidIdentifier的对象
 */
function getModuleIdentifierInfo(module, modulesData) {
    let identifierValue = '';
    let isTimeIdentifier = false;
    let hasValidIdentifier = false;

    // 动态获取模块配置
    const moduleConfig = modulesData.find(config => config.name === module.moduleName);

    if (moduleConfig) {
        // 检查是否有主标识符
        const primaryIdentifiers = moduleConfig.variables
            .filter(variable => variable.isMainIdentifier || variable.isIdentifier);

        if (primaryIdentifiers.length > 0) {
            // 收集主标识符的值
            const primaryValues = primaryIdentifiers.map(variable => {
                // 检查是否是time变量
                if (variable.name.toLowerCase().includes('time')) {
                    isTimeIdentifier = true;
                }
                let value = module.variables[variable.name] || '';

                // 对变量名为"id"的标识符进行特殊处理，支持字母+数字的排序
                if (variable.name.toLowerCase() === 'id' && typeof value === 'string' && value.trim()) {
                    // 将带字母的id转换为可排序的格式：字母转为ASCII码值，与数字组合
                    // 例如：m001 -> 109001, s001 -> 115001, m002 -> 109002
                    value = convertAlphaNumericId(value);
                }

                return value;
            });

            // 如果主标识符有值，使用它们的组合
            if (primaryValues.some(val => val)) {
                identifierValue = primaryValues.join('__');
                hasValidIdentifier = true;
            } else {
                // 主标识符没有值，尝试使用备用标识符
                const backupResult = getBackupIdentifierInfo(module, moduleConfig, identifierValue, isTimeIdentifier, hasValidIdentifier);
                identifierValue = backupResult.identifierValue;
                isTimeIdentifier = backupResult.isTimeIdentifier;
                hasValidIdentifier = backupResult.hasValidIdentifier;
            }
        } else {
            // 没有主标识符，尝试使用备用标识符
            const backupResult = getBackupIdentifierInfo(module, moduleConfig, identifierValue, isTimeIdentifier, hasValidIdentifier);
            identifierValue = backupResult.identifierValue;
            isTimeIdentifier = backupResult.isTimeIdentifier;
            hasValidIdentifier = backupResult.hasValidIdentifier;
        }
    }

    return {
        identifierValue,
        isTimeIdentifier,
        hasValidIdentifier
    };
}

/**
 * 获取模块的备用标识符信息
 * @param {Object} module - 模块对象
 * @param {Object} moduleConfig - 模块配置
 * @param {string} currentIdentifierValue - 当前标识符值
 * @param {boolean} currentIsTimeIdentifier - 当前是否是时间标识符
 * @param {boolean} currentHasValidIdentifier - 当前是否有有效标识符
 * @returns {Object} 更新后的标识符信息对象
 */
/**
 * 将字母数字组合的id转换为可排序的数值格式
 * @param {string} id - 字母数字组合的id（如m001、s001）
 * @returns {string|number} 转换后的数值格式
 */
function convertAlphaNumericId(id) {
    // 匹配字母前缀和数字后缀
    const match = id.match(/^([a-zA-Z]+)(\d+)$/);
    if (match) {
        const letters = match[1];
        const numbers = match[2];

        // 将字母转换为ASCII码值（每个字母占3位以确保唯一性）
        let lettersAsNumbers = '';
        for (let i = 0; i < letters.length; i++) {
            const charCode = letters.charCodeAt(i);
            // 格式化ASCII码为3位数字，前面补0
            lettersAsNumbers += String(charCode).padStart(3, '0');
        }

        // 组合字母ASCII码和数字部分
        return lettersAsNumbers + numbers;
    }
    // 如果不是字母数字组合，返回原值
    return id;
}

function getBackupIdentifierInfo(module, moduleConfig, currentIdentifierValue, currentIsTimeIdentifier, currentHasValidIdentifier) {
    // 创建返回对象，初始值为传入的值
    const result = {
        identifierValue: currentIdentifierValue,
        isTimeIdentifier: currentIsTimeIdentifier,
        hasValidIdentifier: currentHasValidIdentifier
    };

    const backupIdentifiers = moduleConfig.variables
        .filter(variable => variable.isBackupIdentifier);

    if (backupIdentifiers.length > 0) {
        const backupValues = backupIdentifiers.map(variable => {
            // 检查是否是time变量
            if (variable.name.toLowerCase().includes('time')) {
                result.isTimeIdentifier = true;
            }
            let value = module.variables[variable.name] || '';

            // 对变量名为"id"的标识符进行特殊处理
            if (variable.name.toLowerCase() === 'id' && typeof value === 'string' && value.trim()) {
                value = convertAlphaNumericId(value);
            }

            return value;
        });

        if (backupValues.some(val => val)) {
            result.identifierValue = backupValues.join('__');
            result.hasValidIdentifier = true;
        }
    }

    return result;
}

/**
 * 通用模块排序方法
 * 按照主标识符排序，如果主标识符不完整或为空，尝试使用备用标识符排序
 * 如果标识符是时间类型，按时间排序
 * 如果主标识符和备用标识符都不能数值化（时间除外），则按messageIndex排序
 * @param {Array} modules 模块数组
 * @returns {Array} 排序后的模块数组
 */
export function sortModules(modules) {
    // debugLog('[SortModules]', '开始排序模块，模块:', modules);
    return modules.sort((a, b) => {
        // debugLog('[SortModules]', '比较模块:', a.moduleName, 'vs', b.moduleName, 'messageIndex:', a.messageIndex, 'vs', b.messageIndex);
        // 动态获取所有模块配置
        const modulesData = configManager.getModules() || [];

        // 获取模块A的标识符信息
        const aInfo = getModuleIdentifierInfo(a, modulesData);

        // 获取模块B的标识符信息
        const bInfo = getModuleIdentifierInfo(b, modulesData);

        // 如果双方都有标识符，但都不能数值化（时间除外），则按messageIndex排序
        if (aInfo.hasValidIdentifier && bInfo.hasValidIdentifier &&
            !aInfo.isTimeIdentifier && !bInfo.isTimeIdentifier &&
            !isNumeric(aInfo.identifierValue) && !isNumeric(bInfo.identifierValue)) {
            // debugLog('[SortModules]', '决策: 双方都有非数值标识符，按messageIndex排序', a, b);
            return a.messageIndex - b.messageIndex;
        }

        // 处理时间类型的标识符 - 只在同模块内进行时间排序
        if (aInfo.isTimeIdentifier && bInfo.isTimeIdentifier && a.moduleName === b.moduleName) {
            // 检查是否可以使用timeData进行排序
            const canUseATimeData = a.timeData && a.timeData.isValid && (a.timeData.isComplete || !a.timeData.isComplete && a.timeData.startTime?.hasDate) && a.timeData.startTime?.timestamp !== undefined;
            const canUseBTimeData = b.timeData && b.timeData.isValid && (b.timeData.isComplete || !b.timeData.isComplete && b.timeData.startTime?.hasDate) && b.timeData.startTime?.timestamp !== undefined;

            // 只有当两个模块都可以使用timeData时才进行时间排序
            if (canUseATimeData && canUseBTimeData) {
                let aTime;
                let bTime;

                // 获取模块A的时间戳
                if (a.timeData.isRange) {
                    // 如果是时间范围，使用开始和结束时间戳中间的中点
                    aTime = (a.timeData.startTime.timestamp + a.timeData.endTime.timestamp) / 2;
                } else {
                    aTime = a.timeData.startTime.timestamp;
                }

                // 获取模块B的时间戳
                if (b.timeData.isRange) {
                    // 如果是时间范围，使用开始和结束时间戳中间的中点
                    bTime = (b.timeData.startTime.timestamp + b.timeData.endTime.timestamp) / 2;
                } else {
                    bTime = b.timeData.startTime.timestamp;
                }

                // debugLog('[SortModules]', '决策: 时间类型标识符排序，A时间:', aTime, 'B时间:', bTime, '差值:', aTime - bTime, a, b);
                const timeDiff = aTime - bTime;
                // 如果时间相等，则按messageIndex排序
                return timeDiff !== 0 ? timeDiff : a.messageIndex - b.messageIndex;
            }

            // 如果timeData不可用，继续执行下一级判断
        }

        // 处理数值类型和范围类型的标识符
        if (aInfo.hasValidIdentifier && bInfo.hasValidIdentifier &&
            !aInfo.isTimeIdentifier && !bInfo.isTimeIdentifier) {
            // 检查A是否是范围ID
            let aNum;
            const aRange = parseIdRange(aInfo.identifierValue);
            if (aRange) {
                // 使用范围的中点进行排序
                aNum = (parseFloat(aRange.start) + parseFloat(aRange.end)) / 2;
            } else if (isNumeric(aInfo.identifierValue)) {
                aNum = parseFloat(aInfo.identifierValue);
            }

            // 检查B是否是范围ID
            let bNum;
            const bRange = parseIdRange(bInfo.identifierValue);
            if (bRange) {
                // 使用范围的中点进行排序
                bNum = (parseFloat(bRange.start) + parseFloat(bRange.end)) / 2;
            } else if (isNumeric(bInfo.identifierValue)) {
                bNum = parseFloat(bInfo.identifierValue);
            }

            // 如果都是数值（包括范围中点），则进行数值比较
            if (aNum !== undefined && bNum !== undefined) {
                // debugLog('[SortModules]', '决策: 数值/范围类型标识符排序，A值:', aNum, 'B值:', bNum, '差值:', aNum - bNum, a, b);
                const numDiff = aNum - bNum;
                // 如果数值相等，则按messageIndex排序
                return numDiff !== 0 ? numDiff : a.messageIndex - b.messageIndex;
            }
        }

        // 处理普通标识符
        if (aInfo.hasValidIdentifier && bInfo.hasValidIdentifier) {
            const compareResult = aInfo.identifierValue.localeCompare(bInfo.identifierValue);
            // debugLog('[SortModules]', '决策: 普通标识符排序，A值:', aInfo.identifierValue, 'B值:', bInfo.identifierValue, '比较结果:', compareResult, a, b);
            // 如果标识符相等，则按messageIndex排序
            return compareResult !== 0 ? compareResult : a.messageIndex - b.messageIndex;
        }

        // 如果只有一个模块有标识符值，有标识符的排在前面
        if (aInfo.hasValidIdentifier && !bInfo.hasValidIdentifier) {
            // debugLog('[SortModules]', '决策: 只有模块A有标识符，A排在前面');
            return -1;
        }
        if (!aInfo.hasValidIdentifier && bInfo.hasValidIdentifier) {
            // debugLog('[SortModules]', '决策: 只有模块B有标识符，B排在前面');
            return 1;
        }

        // 没有标识符的模块按messageIndex排序
        // debugLog('[SortModules]', '决策: 双方都无标识符，按messageIndex排序，A:', a.messageIndex, 'B:', b.messageIndex, '差值:', a.messageIndex - b.messageIndex);
        return a.messageIndex - b.messageIndex;
    });
}

/**
 * 将模块按模块名和标识符分组
 * @param {Array} modules 标准化后的模块数组
 * @returns {Object} 分组后的模块对象
 */
export function groupModulesByIdentifier(modules) {
    const groups = {};

    // 动态获取所有模块配置
    const modulesData = configManager.getModules() || [];

    modules.forEach(module => {
        // 使用标准化后的模块名
        const moduleName = module.moduleName;
        let identifier = 'default';

        // 动态获取模块配置
        const moduleConfig = modulesData.find(config => config.name === moduleName);

        if (moduleConfig) {
            // 获取模块配置中的主标识符
            const primaryIdentifiers = moduleConfig.variables
                .filter(variable => variable.isMainIdentifier || variable.isIdentifier)
                .map(variable => variable.name);

            // 获取模块配置中的备用标识符
            const backupIdentifiers = moduleConfig.variables
                .filter(variable => variable.isBackupIdentifier)
                .map(variable => variable.name);

            // 优先使用主标识符
            if (primaryIdentifiers.length > 0) {
                // 收集所有主标识符的值，并使用新的解析工具处理多值
                const identifierValues = primaryIdentifiers.map(id => {
                    const value = module.variables[id];
                    return value !== undefined ? IdentifierParser.parseMultiValues(value) : undefined;
                });

                // 如果所有主标识符都有值，使用它们的规范化组合作为标识符
                if (identifierValues.every(values => values !== undefined && values.length > 0)) {
                    // 对每个标识符的多值进行排序并合并，确保相同组合产生相同标识符
                    const normalizedValues = identifierValues.map(values =>
                        values.sort().join('|')
                    );
                    identifier = normalizedValues.join('__');
                } else {
                    // 主标识符不完整，尝试使用备用标识符
                    if (backupIdentifiers.length > 0) {
                        // 收集所有备用标识符的值，并使用新的解析工具处理多值
                        const backupValues = backupIdentifiers.map(id => {
                            const value = module.variables[id];
                            return value !== undefined ? IdentifierParser.parseMultiValues(value) : undefined;
                        });

                        // 如果所有备用标识符都有值，使用它们的规范化组合作为标识符
                        if (backupValues.every(values => values !== undefined && values.length > 0)) {
                            const normalizedValues = backupValues.map(values =>
                                values.sort().join('|')
                            );
                            identifier = normalizedValues.join('__');
                        } else {
                            // 否则，使用所有变量值的组合作为标识符
                            const allValues = Object.values(module.variables).join('__');
                            identifier = allValues || 'default';
                        }
                    } else {
                        // 没有备用标识符，使用所有变量值的组合作为标识符
                        const allValues = Object.values(module.variables).join('__');
                        identifier = allValues || 'default';
                    }
                }
            } else if (backupIdentifiers.length > 0) {
                // 没有主标识符，使用备用标识符
                // 收集所有备用标识符的值，并使用新的解析工具处理多值
                const backupValues = backupIdentifiers.map(id => {
                    const value = module.variables[id];
                    return value !== undefined ? IdentifierParser.parseMultiValues(value) : undefined;
                });

                // 如果所有备用标识符都有值，使用它们的规范化组合作为标识符
                if (backupValues.every(values => values !== undefined && values.length > 0)) {
                    const normalizedValues = backupValues.map(values =>
                        values.sort().join('|')
                    );
                    identifier = normalizedValues.join('__');
                } else {
                    // 否则，使用所有变量值的组合作为标识符
                    const allValues = Object.values(module.variables).join('__');
                    identifier = allValues || 'default';
                }
            } else {
                // 没有主标识符和备用标识符时，使用'default'作为标识符
                // 这样同一模块的所有实例会分到同一组，然后按messageIndex排序
                identifier = 'default';
            }
        } else {
            // 没有模块配置时，使用'default'作为标识符
            identifier = 'default';
        }

        // 使用特殊分隔符构建组键
        const groupKey = `__MODULE_GROUP__${moduleName}__IDENTIFIER__${identifier}__`;

        // 添加到分组
        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }
        groups[groupKey].push(module);
    });

    return groups;
}

/**
 * 构建变量名映射表
 * @param {Object} moduleConfig 模块配置
 * @returns {Object} 变量名映射表（兼容变量名 -> 当前变量名）
 */
export function buildVariableNameMap(moduleConfig) {
    const variableNameMap = {};

    if (!moduleConfig || !moduleConfig.variables) return variableNameMap;

    moduleConfig.variables.forEach(variable => {
        // 主变量名
        variableNameMap[variable.name] = variable.name;

        // 兼容变量名 - 使用新的标识符解析工具处理多值分隔符
        if (variable.compatibleVariableNames) {
            // const compatibleNames = IdentifierParser.parseMultiValues(variable.compatibleVariableNames);
            variable.compatibleVariableNames.forEach(name => {
                variableNameMap[name] = variable.name;
            });
        }
    });

    return variableNameMap;
}

/**
 * 按顺序合并模块
 * @param {Array} modules 模块数组
//  * @param {Object} moduleConfig 模块配置
 * @returns {Object} 合并后的模块数据
 */
export function mergeModulesByOrder(modules) {
    if (modules.length === 0) {
        return null;
    }

    // 使用最后一个模块的数据作为基础结构
    const lastModule = modules[modules.length - 1];
    const merged = {
        ...lastModule, // 保留原始结构
        variables: {}, // 初始化空的variables，后续会合并所有变量
        timeline: [] // 记录历史状态的时间线
    };

    // 构建累积的变量状态
    let cumulativeVariables = {};

    modules.forEach((module, index) => {
        const currentVariables = { ...cumulativeVariables };
        const changedKeys = [];

        // 更新当前变量状态
        Object.keys(module.variables).forEach(key => {
            const value = module.variables[key];

            // 只有当值不为空或undefined时才更新
            if (value !== '' && value !== undefined) {
                // 检查变量是否发生变化
                if (currentVariables[key] !== value) {
                    changedKeys.push(key);
                }
                currentVariables[key] = value;
                cumulativeVariables[key] = value;
            }
        });

        // 记录时间点状态
        merged.timeline.push({
            moduleName: module.moduleName,
            messageIndex: module.messageIndex || 0,
            messageIndexHistory: module.messageIndexHistory || [module.messageIndex],
            raw: module.raw || '',
            variables: { ...currentVariables }, // 该messageIndex时的完整变量数据
            changedKeys: changedKeys // 该条messageIndex中发生变化的变量
        });
    });

    // 最终variables使用累积后的完整状态
    merged.variables = cumulativeVariables;

    debugLog('[ModuleMerge] 合并后的模块数据:', merged);
    return merged;
}

/**
 * 构建模块字符串
 * @param {Object} moduleData 模块数据
 * @param {Object} moduleConfig 模块配置
 * @returns {string} 模块字符串
 */
export function buildModuleString(moduleData, moduleConfig, isIncremental = false) {
    let moduleStr = `[${moduleData.moduleName}`;

    // 如果有模块配置，按配置的变量顺序构建
    if (moduleConfig && moduleConfig.variables) {
        // 如果是增量模式，只包含特定变量
        if (isIncremental) {
            // 获取标识符变量
            const identifierVariables = moduleConfig.variables.filter(variable => variable.isIdentifier);
            // 获取备用标识符变量
            const backupIdentifierVariables = moduleConfig.variables.filter(variable => variable.isBackupIdentifier);
            // 包含标识符变量和备用标识符变量
            const variablesToInclude = [...identifierVariables, ...backupIdentifierVariables];

            // 获取changedKeys（直接从moduleData中获取）
            const changedKeys = moduleData.changedKeys || [];

            // 构建要包含的变量集合
            const includedVariables = new Set();

            // 添加标识符变量
            variablesToInclude.forEach(variable => {
                includedVariables.add(variable.name);
            });

            // 添加changedKeys中的变量
            changedKeys.forEach(key => {
                includedVariables.add(key);
            });

            // 只包含选定的变量
            moduleConfig.variables.forEach(variable => {
                if (includedVariables.has(variable.name)) {
                    const value = String(moduleData.variables[variable.name] !== undefined ? moduleData.variables[variable.name] : '') || '';
                    moduleStr += `|${variable.name}:${value}`;
                }
            });
        } else {
            // 非增量模式，包含所有变量
            moduleConfig.variables.forEach(variable => {
                // 转换为字符串以确保数字0能被正确处理，而不是被视为false值
                const value = String(moduleData.variables[variable.name] !== undefined ? moduleData.variables[variable.name] : '') || '';
                moduleStr += `|${variable.name}:${value}`;
            });
        }
    } else {
        // 没有配置时，按变量名顺序构建
        Object.keys(moduleData.variables).sort().forEach(key => {
            const value = String(moduleData.variables[key] !== undefined ? moduleData.variables[key] : '') || '';
            moduleStr += `|${key}:${value}`;
        });
    }

    moduleStr += ']';
    return moduleStr;
}

/**
 * 智能补全id变量
 * 对于有id变量但值为空的模块条目，根据备用标识符智能补全id
 * @param {Array} modules 排序后的模块数组
 */
export function completeIdVariables(modules) {
    debugLog('[IdCompletion] 开始智能补全id变量，模块数量:', modules.length);

    // 按模块名分组
    const moduleGroups = {};
    modules.forEach(module => {
        const moduleName = module.moduleName;
        if (!moduleGroups[moduleName]) {
            moduleGroups[moduleName] = [];
        }
        moduleGroups[moduleName].push(module);
    });

    // 处理每个模块组
    Object.entries(moduleGroups).forEach(([moduleName, moduleList]) => {
        debugLog(`[IdCompletion] 处理模块组 ${moduleName}，包含 ${moduleList.length} 个模块`);

        // 动态获取模块配置
        const modulesData = configManager.getModules() || [];
        const moduleConfig = modulesData.find(config => config.name === moduleName);

        if (!moduleConfig) {
            debugLog(`[IdCompletion] 模块 ${moduleName} 没有配置，跳过处理`);
            return;
        }

        // 检查该模块是否有id变量
        const hasIdVariable = moduleConfig.variables.some(variable => variable.name === 'id');

        if (!hasIdVariable) {
            debugLog(`[IdCompletion] 模块 ${moduleName} 没有id变量，跳过处理`);
            return;
        }

        // 获取备用标识符
        const backupIdentifiers = moduleConfig.variables
            .filter(variable => variable.isBackupIdentifier)
            .map(variable => variable.name);

        // 记录已处理的备用标识符组合和对应的id
        const identifierIdMap = new Map();
        let currentId = 1;

        // 处理每个模块条目
        moduleList.forEach(module => {
            let currentIdValue = module.variables.id || '';

            // 如果id值为空，需要补全
            if (!currentIdValue) {
                // 生成备用标识符组合
                let backupKey = '';
                if (backupIdentifiers.length > 0) {
                    backupKey = backupIdentifiers.map(identifier => module.variables[identifier] || '').join('__');
                }

                // 如果有备用标识符，检查是否已存在
                if (backupKey) {
                    if (identifierIdMap.has(backupKey)) {
                        // 已存在，使用相同的id
                        currentIdValue = identifierIdMap.get(backupKey);
                        debugLog(`[IdCompletion] 模块 ${moduleName} 使用已存在的id ${currentIdValue}，备用标识符: ${backupKey}`);
                    } else {
                        // 不存在，生成新id
                        currentIdValue = String(currentId).padStart(3, '0');
                        identifierIdMap.set(backupKey, currentIdValue);
                        currentId++;
                        debugLog(`[IdCompletion] 模块 ${moduleName} 生成新id ${currentIdValue}，备用标识符: ${backupKey}`);
                    }
                } else {
                    // 没有备用标识符，直接递增生成id
                    currentIdValue = String(currentId).padStart(3, '0');
                    currentId++;
                    debugLog(`[IdCompletion] 模块 ${moduleName} 生成新id ${currentIdValue}，无备用标识符`);
                }

                // 更新模块的id值
                module.variables.id = currentIdValue;
            }
        });
    });

    debugLog('[IdCompletion] 智能补全id变量完成');
}

/**
 * 解析单个变量部分，支持嵌套模块
 * @param {string} part 单个变量部分，如 "own:所属人"
 * @param {Object} variablesMap 变量映射表
 * @param {Object} variableNameMap 变量名映射表（兼容变量名 -> 当前变量名）
 */
export function parseSingleVariableInProcess(part, variablesMap, variableNameMap) {
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
            variablesMap[currentVarName] = (currentVarName !== 'time' && currentVarName !== 'id') ? removeHyphens(varValue) : varValue;
        } else {
            // 处理兼容变量名的精确匹配
            for (const [compatName, currentName] of Object.entries(variableNameMap)) {
                if (varName === compatName) {
                    variablesMap[currentName] = (currentName !== 'time' && currentName !== 'id') ? removeHyphens(varValue) : varValue;
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
export function htmlEscape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// /**
//  * 处理提取的模块数据（用于提取楼层范围模块按钮，支持多选）
//  * @param {Array} modules 提取到的模块数组
//  * @param {Array} selectedModuleNames 选中的模块名数组
//  * @returns {string} 处理后的模块字符串
//  */
// export function processExtractedModules(modules, selectedModuleNames) {
//     // 标准化模块数据
//     const normalizedModules = normalizeModules(modules);

//     // 过滤出选中的模块（支持多选）
//     const filteredModules = normalizedModules.filter(module => {
//         // 如果没有选择任何模块，显示所有模块
//         if (!selectedModuleNames || selectedModuleNames.length === 0) {
//             return true;
//         }
//         // 如果选择了模块，只显示选中的模块
//         return selectedModuleNames.includes(module.moduleName);
//     });

//     // 构建处理后的模块字符串
//     const processedModules = filteredModules.map(module => {
//         // 动态获取模块配置
//         const modulesData = configManager.getModules() || [];
//         const moduleConfig = modulesData.find(config => config.name === module.moduleName);

//         if (!moduleConfig) {
//             // 没有找到配置，返回原始内容
//             return module.raw;
//         }

//         // 构建当前模块的字符串
//         let moduleString = `[${module.moduleName}`;

//         // 按照模块配置中的变量顺序添加变量
//         moduleConfig.variables.forEach(variable => {
//             // 获取变量值
//             let varValue = module.variables[variable.name] || '';

//             moduleString += `|${variable.name}:${varValue}`;
//         });

//         moduleString += ']';

//         return moduleString;
//     });

//     // 返回所有处理后的模块，用换行符分隔
//     return processedModules.join('\n');
// }

/**
 * 自动根据模块配置判断处理方式
 * @param {Array} rawModules 原始模块数组
 * @param {Array} selectedModuleNames 选中的模块名数组
 * @param {boolean} showModuleNames 是否显示模块名
 * @param {boolean} showProcessInfo 是否显示处理方式说明
 * @returns {Object} 按模块名分组的结构化数据
 */
export function processAutoModules(rawModules, selectedModuleNames, showModuleNames = false, showProcessInfo = false, needOutputformat = false) {
    debugLog('开始自动处理模块');

    // 标准化模块数据，直接传入selectedModuleNames参数，normalizeModules会返回按模块名分组的结构
    const moduleGroups = normalizeModules(rawModules, selectedModuleNames);

    // 处理每个模块组并返回结构化数据
    const structuredResult = {};

    Object.keys(moduleGroups).forEach(moduleName => {
        const moduleGroup = moduleGroups[moduleName];

        // 动态获取模块配置
        const modulesData = configManager.getModules() || [];
        const moduleConfig = modulesData.find(config => config.name === moduleName);

        let processType = 'full';
        let resultData;

        if (!moduleConfig) {
            // 没有模块配置，使用全量处理
            processType = 'full_without_config';
            resultData = moduleGroup.map(module => module.raw);
        } else {
            // 获取模块的outputMode配置
            const outputMode = moduleConfig.outputMode || 'full';
            processType = outputMode;

            // 根据outputMode选择处理方式
            if (outputMode === 'incremental') {
                // 增量处理
                resultData = processIncrementalModules(moduleGroup);
            } else {
                // 全量处理（默认）
                resultData = processFullModules(moduleGroup);
            }
        }

        // 计算包含隐藏模块的最大ID值
        let maxId = null;
        if (processType === 'incremental' && Array.isArray(resultData) && resultData.length > 0) {
            // 从增量处理结果中提取最大ID值
            const maxIds = resultData.map(item => item.maxId).filter(id => id !== null);
            if (maxIds.length > 0) {
                maxId = Math.max(...maxIds);
            }
        }

        structuredResult[moduleName] = {
            processType: processType,
            data: resultData,
            moduleCount: resultData.length,
            moduleConfig: moduleConfig,
            isIncremental: processType === 'incremental',
            maxId: maxId, // 存储最大ID值
        };
    });

    return structuredResult;
}

/**
 * 获取messageIndexHistory内最大的messageIndex（和currentMessageIndex不相等的）
 * @param {Object} module 模块对象
 * @param {number} currentMessageIndex 当前messageIndex
 * @returns {number} 最大的messageIndex，如果没有符合条件的则返回-1
 */
export function getMaxMessageIndexFromHistory(module, currentMessageIndex) {
    if (!module || !module.messageIndexHistory || !Array.isArray(module.messageIndexHistory)) {
        return -1;
    }

    // 过滤掉与currentMessageIndex相等的值，然后找出最大值
    const filteredHistory = module.messageIndexHistory.filter(index => index !== currentMessageIndex);

    if (filteredHistory.length === 0) {
        return -1;
    }

    return Math.max(...filteredHistory);
}

/**
 * 将结构化的模块数据转换为字符串
 * @param {Object} structuredModules 按模块名分组的结构化数据
 * @param {boolean} showModuleNames 是否显示模块名
 * @param {boolean} showProcessInfo 是否显示处理信息
 * @returns {string} 转换后的模块字符串
 */
export function buildModulesString(structuredModules, showModuleNames = false, showProcessInfo = false, needOutputformat = false) {
    let result = '';

    // 处理每个模块组
    Object.keys(structuredModules).forEach(moduleName => {
        const moduleData = structuredModules[moduleName];
        const moduleConfig = moduleData.moduleConfig;
        const { processType, data } = moduleData;

        if (needOutputformat) {
            result += `## ${moduleName}`;
        }

        if (showModuleNames) {
            result += `【${moduleConfig.name} (${moduleConfig.displayName})】 (当前数量:${moduleData.moduleCount}`;
            if (moduleData.isIncremental && moduleData.maxId !== undefined) {
                result += `, 下一可用id:${moduleData.maxId + 1}`;
            }
            result += `)`;
        }

        if (showProcessInfo) {
            let processInfo = '';
            switch (processType) {
                case 'incremental':
                    processInfo = ' (增量处理)';
                    break;
                case 'full_without_config':
                    processInfo = ' (全量处理 - 无配置)';
                    break;
                default:
                    processInfo = ' (全量处理)';
            }
            result += `${processInfo}`;
        }
        result += `\n`;


        // 根据数据类型处理
        if (Array.isArray(data)) {
            // 处理结构化条目数组
            data.forEach(item => {
                result += `${item.moduleString || item}\n`;
            });
        } else if (typeof data === 'string') {
            // 处理字符串
            result += data + '\n\n';
        }

        result += '\n';
    });

    return result.trim();
}

/**
 * 处理增量更新模块
 * @param {Array} modules 标准化后的模块数组
 * @returns {Array} 结构化的增量更新模块条目数组
 */
export function processIncrementalModules(modules) {
    // 按模块名和标识符分组处理
    const moduleGroups = groupModulesByIdentifier(modules);

    // 构建结果数组
    const resultItems = [];

    // 转换模块组为数组，以便排序
    const moduleGroupsArray = Object.entries(moduleGroups);

    // 对模块组进行排序（使用每个组的第一个模块来确定排序）
    moduleGroupsArray.sort(([keyA, modulesA], [keyB, modulesB]) => {
        // 使用第一个模块作为代表进行排序
        const moduleA = modulesA[0];
        const moduleB = modulesB[0];

        // 直接比较messageIndex即可，因为模块已经在标准化阶段排序过
        return moduleA.messageIndex - moduleB.messageIndex;
    });

    debugLog('处理增量更新模块', moduleGroupsArray);

    // 处理每个排序后的模块组
    for (const [moduleKey, moduleList] of moduleGroupsArray) {
        // 解析模块名和标识符（使用特殊分隔符）
        const match = moduleKey.match(/^__MODULE_GROUP__(.*?)__IDENTIFIER__(.*?)__$/);
        if (!match) continue;
        const [, moduleName, identifier] = match;

        // 动态获取模块配置
        const modulesData = configManager.getModules() || [];
        const moduleConfig = modulesData.find(config => config.name === moduleName);

        // 只处理outputMode为"incremental"的模块
        if (moduleConfig && moduleConfig.outputMode === 'incremental') {
            debugLog('处理增量更新模块', moduleName + ':' + identifier, '合并模块按顺序', moduleList);

            // 统合处理模块
            const mergedModule = mergeModulesByOrder(moduleList, moduleConfig);
            mergedModule.isIncremental = true;

            // 检查是否需要隐藏该模块条目
            let shouldHide = false;
            for (const variable of moduleConfig.variables) {
                if (variable.isHideCondition) {
                    const variableValue = mergedModule.variables[variable.name];
                    if (variableValue) {
                        // 使用新的标识符解析工具分割隐藏条件值（支持中英文逗号、分号分隔）
                        // const hideValues = IdentifierParser.parseMultiValues(variable.hideConditionValues);
                        // 修改为包含判断：只要variableValue包含任一条件值即可
                        if (variable.hideConditionValues.some(hideValue => variableValue.includes(hideValue))) {
                            shouldHide = true;
                            break;
                        }
                    }
                }
            }

            // 计算包含隐藏模块的最大ID值
            let maxId = 0;
            const hasIdVariable = moduleConfig.variables.some(variable => variable.name === 'id');

            if (hasIdVariable) {
                // 遍历所有模块（包括隐藏的）来找到最大ID
                for (const module of moduleList) {
                    const idValue = module.variables.id;
                    if (idValue) {
                        // 解析ID值（支持数字和三位数格式）
                        const idNum = parseInt(idValue, 10);
                        if (!isNaN(idNum) && idNum > maxId) {
                            maxId = idNum;
                        }
                    }
                }
            }

            // 如果不需要隐藏，则构建模块条目
            if (!shouldHide) {
                // 构建统合后的模块字符串
                const moduleString = buildModuleString(mergedModule, moduleConfig);
                mergedModule.moduleString = moduleString;

                mergedModule.timeline.forEach(module => {
                    module.moduleString = buildModuleString(module, moduleConfig, true);
                });

                // 添加结构化条目到结果数组
                resultItems.push({
                    moduleName,
                    identifier,
                    moduleData: mergedModule,
                    moduleString,
                    maxId: maxId > 0 ? maxId : null, // 存储最大ID值
                });
            }
        }
    }

    return resultItems;
}

/**
 * 统一处理模块数据（支持多选）
 * @param {Object} extractParams 提取参数对象，包含startIndex, endIndex, moduleFilters
 * @param {string} processType 处理类型：'extract' | 'processed' | 'incremental' | 'full' | 'auto'
 * @param {Array} selectedModuleNames 选中的模块名数组，用于在处理阶段过滤已提取的模块
 * @param {boolean} returnString 是否返回字符串（默认：true），如果为false则返回结构化数据
 * @param {boolean} showModuleNames 是否显示模块名
 * @param {boolean} showProcessInfo 是否显示处理方式说明
 * @returns {Promise<Object>} 包含处理结果和显示信息的对象
 *
 * 注意：extractParams.moduleFilters和selectedModuleNames的区别：
 * - moduleFilters: 在提取阶段使用，是一个包含{name, compatibleModuleNames}的数组，用于从聊天记录中过滤出特定类型的模块
 * - selectedModuleNames: 在处理阶段使用，是一个字符串数组，只包含模块名，用于从已提取的模块中选择需要处理的模块
 */
export function processModuleData(extractParams, processType, selectedModuleNames = undefined, returnString = false, showModuleNames = false, showProcessInfo = false, needOutputformat = false) {
    try {
        debugLog(`[EVENTS]开始处理模块数据，类型：${processType}`);

        // 提取参数验证
        if (!extractParams || typeof extractParams !== 'object') {
            throw new Error('提取参数无效');
        }

        let { startIndex, endIndex, moduleFilters } = extractParams;

        // const isAllModule = moduleFilters === null;

        // if (endIndex === null) {
        //     endIndex = chat?.length - 1;
        // }

        // todo 需要通过moduleCacheManager来判断是否有缓存数据，有的话获取缓存数据并返回。没有的话就存入缓存

        // if (processType === 'auto' && moduleCacheManager.hasCurrentChatData(startIndex, endIndex)) {
        //     // 从缓存中获取数据
        //     const cachedData = moduleCacheManager.getCurrentChatData(startIndex, endIndex);
        //     debugLog(`从缓存中获取模块数据，范围：${startIndex} - ${endIndex}`, cachedData);
        //     return cachedData;
        // }

        // 如果moduleFilters为null，则加载全部模块，不需要添加时间标准模块
        if (moduleFilters !== null) {
            // 添加所有激活了时间参考标准的模块到moduleFilters中
            const modulesData = configManager.getModules() || [];
            if (modulesData && Array.isArray(modulesData)) {
                // 创建一个Set来存储所有需要包含的模块名，避免重复
                const modulesToInclude = new Set();

                // 首先添加原有的moduleFilters中的模块
                if (moduleFilters && Array.isArray(moduleFilters)) {
                    moduleFilters.forEach(filter => {
                        modulesToInclude.add(filter.name);
                    });
                } else {
                    moduleFilters = [];
                }

                // 添加所有激活了时间参考标准的模块
                modulesData.forEach(module => {
                    if (module.timeReferenceStandard) {
                        modulesToInclude.add(module.name);
                    }
                });

                // 更新moduleFilters，确保包含所有需要的模块
                modulesToInclude.forEach(moduleName => {
                    const moduleData = modulesData.find(m => m.name === moduleName);
                    if (moduleData && !moduleFilters.some(f => f.name === moduleName)) {
                        moduleFilters.push({
                            name: moduleName,
                            compatibleModuleNames: moduleData.compatibleModuleNames || []
                        });
                    }
                });
            }
        }

        // 提取模块数据
        const rawModules = extractModules(startIndex, endIndex, moduleFilters);

        // if (!selectedModuleNames || selectedModuleNames.length === 0) {
        //     if (moduleFilters && moduleFilters.length > 0) {
        //         selectedModuleNames = moduleFilters.map(config => config.name);
        //     }
        //     else {
        //         selectedModuleNames = configManager.getModules().map(module => module.moduleName);
        //     }
        // }

        let resultContent = '';
        let displayTitle = '';
        // let modules = [];

        // 根据处理类型选择不同的处理逻辑
        switch (processType) {
            case 'extract':
                // 调用独立的原生模块处理函数
                const extractResult = processExtractModules(rawModules, selectedModuleNames, returnString);
                resultContent = extractResult.resultContent;
                displayTitle = extractResult.displayTitle;
                break;

            case 'processed':
                // 调用独立的标准化模块处理函数
                const processedResult = processProcessedModules(rawModules, selectedModuleNames, returnString);
                resultContent = processedResult.resultContent;
                displayTitle = processedResult.displayTitle;
                break;

            case 'auto':
                // 自动根据模块配置判断处理方式
                const structuredResult = processAutoModules(rawModules, selectedModuleNames, showModuleNames, showProcessInfo, needOutputformat);

                // 如果需要返回字符串，则转换结构化数据
                // if (returnString) {
                //     resultContent = buildModulesString(structuredResult, showModuleNames, showProcessInfo);
                // } else {
                resultContent = structuredResult;
                // }
                displayTitle = '自动处理模块结果';
                break;
            default:
                throw new Error(`不支持的处理类型：${processType}`);
        }

        // 判断是否有内容
        let hasContent = false;
        let count = 0;
        if (typeof resultContent === 'string') {
            hasContent = resultContent.trim().length > 0;
        } else if (Array.isArray(resultContent)) {
            count = resultContent.length;
            hasContent = count > 0;
        } else if (resultContent && typeof resultContent === 'object') {
            count = Object.keys(resultContent).length;
            hasContent = count > 0;
        }

        // 构建字符串表示
        let contentString = resultContent;
        if (typeof resultContent !== 'string') {
            contentString = buildModulesString(resultContent, showModuleNames, showProcessInfo, needOutputformat);
        }

        const moduleFinalData = {
            success: true,
            content: resultContent, // 原始内容（可能是结构化数据或字符串）
            contentString: contentString, // 字符串表示
            displayTitle: displayTitle,
            moduleCount: count,
            hasContent: hasContent
        };

        debugLog(`模块处理结果：`, moduleFinalData);
        // if (processType === 'auto' && isAllModule) {
        //     // 缓存提取结果
        //     moduleCacheManager.setCurrentChatData(startIndex, endIndex, moduleFinalData);
        //     debugLog(`缓存模块数据，范围：${startIndex} - ${endIndex}`, moduleFinalData);
        // }

        return moduleFinalData;

    } catch (error) {
        errorLog(`处理模块数据失败（类型：${processType}）:`, error);
        return {
            success: false,
            error: error.message,
            content: '',
            displayTitle: '处理失败',
            moduleCount: 0,
            hasContent: false
        };
    }
}

/**
 * 处理全量更新模块
 * @param {Array} modules 标准化后的模块数组
 * @returns {Array} 结构化的全量更新模块条目数组
 */
export function processFullModules(modules) {
    // 首先按模块名分组，使retainLayers在所有标识符的模块上工作
    const modulesByModuleName = {};
    modules.forEach(module => {
        const moduleName = module.moduleName;
        if (!modulesByModuleName[moduleName]) {
            modulesByModuleName[moduleName] = [];
        }
        modulesByModuleName[moduleName].push(module);
    });

    // 构建结果数组
    const resultItems = [];

    // 处理每个模块名组
    for (const [moduleName, allModulesOfName] of Object.entries(modulesByModuleName)) {
        // 动态获取模块配置
        const modulesData = configManager.getModules() || [];
        const moduleConfig = modulesData.find(config => config.name === moduleName);
        if (!moduleConfig || moduleConfig.outputMode !== 'full') continue;

        // 调试日志：输出模块配置和保留层数
        debugLog(`处理模块：${moduleName}`);
        // debugLog(`模块配置：${JSON.stringify(moduleConfig)}`);

        // 获取retainLayers值（默认为-1，表示无限）
        const retainLayers = moduleConfig.retainLayers === undefined ? -1 : parseInt(moduleConfig.retainLayers, 10);
        debugLog(`retainLayers值：${retainLayers}`);

        let filteredModules = allModulesOfName;
        debugLog(`原始模块数量：${allModulesOfName.length}`);
        debugLog(`模块messageIndex列表：${allModulesOfName.map(m => m.messageIndex).join(', ')}`);

        // 根据retainLayers值决定显示的模块 - 按楼层而不是条数，在所有标识符的模块上应用
        if (retainLayers === 0) {
            // 0表示不保留任何模块
            filteredModules = [];
            debugLog(`retainLayers为0，不显示任何模块`);
        } else if (retainLayers > 0) {
            // 大于0表示只保留最近的retainLayers个楼层的模块
            debugLog(`retainLayers大于0，开始过滤`);

            // 1. 按楼层分组所有该模块名的模块（跨标识符）
            const modulesByFloor = {};
            allModulesOfName.forEach(module => {
                const floor = module.messageIndex;
                if (!modulesByFloor[floor]) {
                    modulesByFloor[floor] = [];
                }
                modulesByFloor[floor].push(module);
            });
            debugLog(`按楼层分组结果：${JSON.stringify(modulesByFloor)}`);

            // 2. 获取所有楼层并按倒序排列（最近的楼层在前）
            const floors = Object.keys(modulesByFloor).map(Number).sort((a, b) => b - a);
            debugLog(`所有楼层（倒序）：${floors.join(', ')}`);

            // 3. 选择最近的retainLayers个楼层
            const selectedFloors = floors.slice(0, retainLayers);
            debugLog(`选择的楼层：${selectedFloors.join(', ')}`);

            // 4. 收集这些楼层中的所有模块，并按楼层倒序排列
            filteredModules = [];
            selectedFloors.forEach(floor => {
                // 每个楼层内的模块按出现顺序排列
                filteredModules.push(...modulesByFloor[floor]);
            });
            debugLog(`过滤后的模块数量：${filteredModules.length}`);
            debugLog(`过滤后的模块messageIndex列表：${filteredModules.map(m => m.messageIndex).join(', ')}`);
        } else {
            // -1或其他负值表示显示所有模块
            debugLog(`retainLayers为-1或负值，显示所有模块`);
        }

        // 对过滤后的模块按标识符分组
        const moduleGroups = groupModulesByIdentifier(filteredModules);

        // 处理每个标识符组
        for (const [moduleKey, moduleList] of Object.entries(moduleGroups)) {
            // 解析标识符
            const match = moduleKey.match(/^__MODULE_GROUP__(.*?)__IDENTIFIER__(.*?)__$/);
            if (!match) continue;
            const [, , identifier] = match;

            debugLog(`处理模块组：${moduleName}，标识符：${identifier}`);

            // 处理每个模块
            for (const module of moduleList) {
                // 检查是否需要隐藏该模块条目
                let shouldHide = false;
                for (const variable of moduleConfig.variables) {
                    if (variable.isHideCondition) {
                        const variableValue = module.variables[variable.name];
                        if (variableValue) {
                            // 使用新的标识符解析工具分割隐藏条件值（支持中英文逗号、分号分隔）
                            // const hideValues = IdentifierParser.parseMultiValues(variable.hideConditionValues);
                            // 修改为包含判断：只要variableValue包含任一条件值即可
                            if (variable.hideConditionValues.some(hideValue => variableValue.includes(hideValue))) {
                                shouldHide = true;
                                break;
                            }
                        }
                    }
                }

                // 如果不需要隐藏，则构建模块条目
                if (!shouldHide) {
                    // 构建模块字符串
                    const moduleString = buildModuleString(module, moduleConfig);
                    module.moduleString = moduleString;

                    // 添加结构化条目到结果数组
                    resultItems.push({
                        moduleName,
                        identifier,
                        moduleData: module,
                        moduleString
                    });
                }
            }
        }
    }

    return resultItems;
}

/**
 * 为包含time变量的模块附加结构化时间数据
 * 使用timeParser.js中的parseTimeDetailed函数解析时间并添加结构化数据
 * @param {Array} modules 标准化后的模块数组
 */
export function attachStructuredTimeData(modules) {
    debugLog('[TimeDataAttachment] 开始为模块附加结构化时间数据，模块数量:', modules.length);

    let attachmentCount = 0;
    let formattedCount = 0;

    // 动态获取模块配置
    const modulesData = configManager.getModules() || [];
    const moduleConfig = modulesData.find(config => config.timeReferenceStandard === true);

    let standardTimeData = null;
    if (moduleConfig) {
        // 查找标准时间条目：moduleConfig.timeReferenceStandard为true且time值可被解析且完整
        for (const standardModule of modules) {
            if (standardModule.moduleName !== moduleConfig.name) continue;
            if (standardModule.variables) {
                for (const [variableName, timeVal] of Object.entries(standardModule.variables)) {
                    if (variableName.toLowerCase().includes('time') && timeVal) {
                        try {
                            // 尝试解析时间值，验证其是否可被解析且完整和有效
                            const testTimeData = parseTimeDetailed(timeVal);
                            if (testTimeData && testTimeData.isValid && testTimeData.isComplete) {
                                standardTimeData = testTimeData;
                                debugLog(`[TimeDataAttachment WEEKDAY] 找到标准时间参考值: ${timeVal}`);
                                break;
                            }
                        } catch (error) {
                            // 如果解析失败，继续查找下一个
                        }
                    }
                }
                if (standardTimeData) break;
            }
        }
    }

    modules.forEach(module => {
        if (module.variables) {
            // 遍历所有变量，查找包含time的变量名
            for (const [variableName, timeVal] of Object.entries(module.variables)) {
                if (variableName.toLowerCase().includes('time') && timeVal) {
                    // debugLog(`[TimeDataAttachment] 发现time变量 ${variableName}: ${timeVal}`);

                    try {
                        // 使用timeParser.js中的parseTimeDetailed函数解析时间，并传递标准时间数据
                        const timeData = parseTimeDetailed(timeVal, standardTimeData);

                        if (timeData) {
                            // 为模块添加结构化时间数据
                            module.timeData = timeData;
                            attachmentCount++;

                            // 如果解析成功且有格式化字符串，直接更新变量值
                            if (timeData.formattedString) {
                                module.variables[variableName] = timeData.formattedString;
                                formattedCount++;
                                debugLog(`[TimeDataAttachment] 格式化时间变量 ${variableName}: ${timeVal} -> ${timeData.formattedString}`);
                            }

                            // debugLog(`[TimeDataAttachment] 为模块 ${module.moduleName} 附加时间数据成功`);
                        }
                    } catch (error) {
                        debugLog(`[TimeDataAttachment] 解析时间变量失败: ${variableName} = ${timeVal}`, error);
                    }

                    // 每个模块只处理第一个time变量
                    break;
                }
            }
        }
    });

    debugLog('[TimeDataAttachment] 结构化时间数据附加完成，共处理模块数:', attachmentCount, '格式化变量数:', formattedCount);
}


/**
 * 按messageIndex和messageIndexHistory分组处理processResult数据
 * @param {Object} processResult 处理结果对象，包含content属性
 * @returns {Object} 按messageIndex分组的条目数据
 */
export function groupProcessResultByMessageIndex(processResult) {
    try {
        if (!processResult || !processResult.content || typeof processResult.content !== 'object') {
            errorLog('[Module Processor] processResult格式无效');
            return {};
        }

        const groupedResult = {};

        // 遍历所有模块
        Object.keys(processResult.content).forEach(moduleName => {
            const moduleData = processResult.content[moduleName];

            if (!moduleData || !moduleData.data || !Array.isArray(moduleData.data)) {
                debugLog(`[Module Processor]模块 ${moduleName} 没有有效的数据数组`);
                return;
            }

            // 遍历模块的每个条目
            moduleData.data.forEach(entry => {
                if (!entry || !entry.moduleData) {
                    debugLog(`[Module Processor]模块 ${moduleName} 的条目缺少moduleData`);
                    return;
                }
                // 处理增量模块timeline内容
                if (entry.moduleData.isIncremental && entry.moduleData.timeline) {
                    entry.moduleData.timeline.forEach(timelineEntry => {

                        const timelineData = {
                            ...timelineEntry,
                            moduleData: { raw: timelineEntry.raw }
                        }

                        if (!groupedResult[timelineEntry.messageIndex]) {
                            groupedResult[timelineEntry.messageIndex] = [];
                        }

                        if (!groupedResult[timelineEntry.messageIndex].includes(timelineData)) {
                            // 将条目添加到对应的messageIndex分组中
                            groupedResult[timelineEntry.messageIndex].push(timelineData);
                        }

                        // const messageIndexHistory = timelineEntry.messageIndexHistory;

                        // if (!timelineEntry.messageIndexHistory || !Array.isArray(timelineEntry.messageIndexHistory)) {
                        //     debugLog(`[Module Processor]模块 ${moduleName} 的条目 ${timelineEntry.moduleName} 缺少有效的messageIndexHistory数组`);
                        //     // 初始化该messageIndex的分组
                        //     if (!groupedResult[timelineEntry.messageIndex]) {
                        //         groupedResult[timelineEntry.messageIndex] = [];
                        //     }

                        //     if (!groupedResult[timelineEntry.messageIndex].includes(timelineData)) {
                        //         // 将条目添加到对应的messageIndex分组中
                        //         groupedResult[timelineEntry.messageIndex].push(timelineData);
                        //     }

                        //     return;
                        // }

                        // // 为每个messageIndex创建分组并添加条目
                        // messageIndexHistory.forEach(index => {
                        //     // 初始化该messageIndex的分组
                        //     if (!groupedResult[index]) {
                        //         groupedResult[index] = [];
                        //     }

                        //     if (!groupedResult[index].includes(timelineData)) {
                        //         // 将条目添加到对应的messageIndex分组中
                        //         groupedResult[index].push(timelineData);
                        //     }
                        // });
                    });
                }
                else {
                    const messageIndexHistory = entry.moduleData.messageIndexHistory;

                    if (!entry.moduleData.messageIndexHistory || !Array.isArray(entry.moduleData.messageIndexHistory)) {
                        debugLog(`[Module Processor]模块 ${moduleName} 的条目 ${entry.moduleData.moduleName} 缺少有效的messageIndexHistory数组`);
                        // 初始化该messageIndex的分组
                        if (!groupedResult[entry.moduleData.messageIndex]) {
                            groupedResult[entry.moduleData.messageIndex] = [];
                        }

                        if (!groupedResult[timelineEntry.messageIndex].includes(entry)) {
                            // 将条目添加到对应的messageIndex分组中
                            groupedResult[entry.moduleData.messageIndex].push(entry);
                        }
                        return;
                    }

                    // 为每个messageIndex创建分组并添加条目
                    messageIndexHistory.forEach(index => {
                        // 初始化该messageIndex的分组
                        if (!groupedResult[index]) {
                            groupedResult[index] = [];
                        }

                        if (!groupedResult[index].includes(entry)) {
                            // 将条目添加到对应的messageIndex分组中
                            groupedResult[index].push(entry);
                        }
                    });
                }

            });
        });

        // 对每个messageIndex内的条目按模块order排序
        Object.keys(groupedResult).forEach(messageIndex => {
            const entries = groupedResult[messageIndex];

            // 获取模块配置数据
            const modulesData = configManager.getModules() || [];

            // 按模块order排序
            entries.sort((a, b) => {
                const aModuleConfig = modulesData.find(config => config.name === a.moduleName);
                const bModuleConfig = modulesData.find(config => config.name === b.moduleName);

                const aOrder = aModuleConfig?.order !== undefined ? aModuleConfig.order : 0;
                const bOrder = bModuleConfig?.order !== undefined ? bModuleConfig.order : 0;

                return aOrder - bOrder;
            });

            groupedResult[messageIndex] = entries;
        });

        debugLog(`[Module Processor]按messageIndex和messageIndexHistory分组完成，共 ${Object.keys(groupedResult).length} 个不同的messageIndex，前后数据：`, processResult, groupedResult);
        return groupedResult;

    } catch (error) {
        errorLog('[Module Processor]按messageIndex和messageIndexHistory分组处理失败:', error);
        return {};
    }
}
