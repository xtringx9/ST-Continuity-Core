// 排序与层级压缩管线步骤
import configManager from '../../singleton/configManager.js';
import { debugLog, errorLog } from '../../utils/logger.js';
import { IdentifierParser } from '../../utils/identifierParser.js';
import { convertAlphaNumericId } from '../../utils/numberParser.js';

/**
 * 判断字符串是否可以转换为数值
 * @param {string} str 要检查的字符串
 * @returns {boolean} 是否可以转换为数值
 */
export function isNumeric(str) {
    if (typeof str !== 'string') {
        return false;
    }
    return !isNaN(str) && !isNaN(parseFloat(str));
}

/**
 * 获取模块的标识符信息
 * @param {Object} module - 模块对象
 * @param {Array} modulesData - 所有模块配置数组
 * @returns {Object} 包含identifierValue、isTimeIdentifier和hasValidIdentifier的对象
 */
export function getModuleIdentifierInfo(module, modulesData) {
    let identifierValue = '';
    let isTimeIdentifier = false;
    let hasValidIdentifier = false;

    const moduleConfig = modulesData.find(config => config.name === module.moduleName);

    if (moduleConfig) {
        const primaryIdentifiers = moduleConfig.variables
            .filter(variable => variable.isMainIdentifier || variable.isIdentifier);

        if (primaryIdentifiers.length > 0) {
            const primaryValues = primaryIdentifiers.map(variable => {
                if (variable.name.toLowerCase().includes('time')) {
                    isTimeIdentifier = true;
                }
                let value = module.variables[variable.name] || '';

                if (variable.name.toLowerCase() === 'id' && typeof value === 'string' && value.trim()) {
                    value = convertAlphaNumericId(value);
                }

                return value;
            });

            if (primaryValues.some(val => val)) {
                identifierValue = primaryValues.join('__');
                hasValidIdentifier = true;
            } else {
                const backupResult = getBackupIdentifierInfo(module, moduleConfig, identifierValue, isTimeIdentifier, hasValidIdentifier);
                identifierValue = backupResult.identifierValue;
                isTimeIdentifier = backupResult.isTimeIdentifier;
                hasValidIdentifier = backupResult.hasValidIdentifier;
            }
        } else {
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
 */
function getBackupIdentifierInfo(module, moduleConfig, currentIdentifierValue, currentIsTimeIdentifier, currentHasValidIdentifier) {
    const result = {
        identifierValue: currentIdentifierValue,
        isTimeIdentifier: currentIsTimeIdentifier,
        hasValidIdentifier: currentHasValidIdentifier
    };

    const backupIdentifiers = moduleConfig.variables
        .filter(variable => variable.isBackupIdentifier);

    if (backupIdentifiers.length > 0) {
        const backupValues = backupIdentifiers.map(variable => {
            if (variable.name.toLowerCase().includes('time')) {
                result.isTimeIdentifier = true;
            }
            let value = module.variables[variable.name] || '';

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
 * 解析ID范围
 * 支持格式如：001~004, 001-004
 * @param {string} idValue ID值
 * @returns {Object|null} 包含start和end的范围对象
 */
function parseIdRange(idValue) {
    if (typeof idValue !== 'string') return null;

    const rangeMatch = idValue.match(/^(.+)[~-](.+)$/);
    if (!rangeMatch || rangeMatch.length !== 3) return null;

    const start = convertAlphaNumericId(rangeMatch[1].trim());
    const end = convertAlphaNumericId(rangeMatch[2].trim());
    return { start, end };
}

/**
 * 检查ID是否在范围内
 * @param {string|number} id 要检查的ID
 * @param {Object} range 范围对象
 * @returns {boolean} 是否在范围内
 */
function isIdInRange(id, range) {
    const idNum = typeof id === 'string' ? parseInt(id, 10) : id;
    const startNum = typeof range.start === 'string' ? parseInt(range.start, 10) : range.start;
    const endNum = typeof range.end === 'string' ? parseInt(range.end, 10) : range.end;

    return !isNaN(idNum) && !isNaN(startNum) && !isNaN(endNum) &&
        idNum >= startNum && idNum <= endNum;
}

/**
 * 通用模块排序方法
 * @param {Array} modules 模块数组
 * @returns {Array} 排序后的模块数组
 */
export function sortModules(modules) {
    // 提升到比较器外，避免每次比较都深拷贝全部模块 + 解析绑定（O(n log n) 次，导致卡顿）
    const modulesData = configManager.getModules() || [];
    return modules.sort((a, b) => {
        const aInfo = getModuleIdentifierInfo(a, modulesData);
        const bInfo = getModuleIdentifierInfo(b, modulesData);

        // 如果双方都有标识符，但都不能数值化（时间除外），则按messageIndex排序
        if (aInfo.hasValidIdentifier && bInfo.hasValidIdentifier &&
            !aInfo.isTimeIdentifier && !bInfo.isTimeIdentifier &&
            !isNumeric(aInfo.identifierValue) && !isNumeric(bInfo.identifierValue)) {
            return a.messageIndex - b.messageIndex;
        }

        // 处理时间类型的标识符 - 只在同模块内进行时间排序
        if (aInfo.isTimeIdentifier && bInfo.isTimeIdentifier && a.moduleName === b.moduleName) {
            const canUseATimeData = a.timeData && a.timeData.isValid && (a.timeData.isComplete || !a.timeData.isComplete && a.timeData.startTime?.hasDate) && a.timeData.startTime?.timestamp !== undefined;
            const canUseBTimeData = b.timeData && b.timeData.isValid && (b.timeData.isComplete || !b.timeData.isComplete && b.timeData.startTime?.hasDate) && b.timeData.startTime?.timestamp !== undefined;

            if (canUseATimeData && canUseBTimeData) {
                let aTime;
                let bTime;

                if (a.timeData.isRange) {
                    aTime = (a.timeData.startTime.timestamp + a.timeData.endTime.timestamp) / 2;
                } else {
                    aTime = a.timeData.startTime.timestamp;
                }

                if (b.timeData.isRange) {
                    bTime = (b.timeData.startTime.timestamp + b.timeData.endTime.timestamp) / 2;
                } else {
                    bTime = b.timeData.startTime.timestamp;
                }

                const timeDiff = aTime - bTime;
                return timeDiff !== 0 ? timeDiff : a.messageIndex - b.messageIndex;
            }
        }

        // 处理数值类型和范围类型的标识符
        if (aInfo.hasValidIdentifier && bInfo.hasValidIdentifier &&
            !aInfo.isTimeIdentifier && !bInfo.isTimeIdentifier) {
            let aNum;
            const aRange = parseIdRange(aInfo.identifierValue);
            if (aRange) {
                aNum = (parseFloat(aRange.start) + parseFloat(aRange.end)) / 2;
            } else if (isNumeric(aInfo.identifierValue)) {
                aNum = parseFloat(aInfo.identifierValue);
            }

            let bNum;
            const bRange = parseIdRange(bInfo.identifierValue);
            if (bRange) {
                bNum = (parseFloat(bRange.start) + parseFloat(bRange.end)) / 2;
            } else if (isNumeric(bInfo.identifierValue)) {
                bNum = parseFloat(bInfo.identifierValue);
            }

            if (aNum !== undefined && bNum !== undefined) {
                const numDiff = aNum - bNum;
                return numDiff !== 0 ? numDiff : a.messageIndex - b.messageIndex;
            }
        }

        // 处理普通标识符
        if (aInfo.hasValidIdentifier && bInfo.hasValidIdentifier) {
            const compareResult = aInfo.identifierValue.localeCompare(bInfo.identifierValue);
            return compareResult !== 0 ? compareResult : a.messageIndex - b.messageIndex;
        }

        if (aInfo.hasValidIdentifier && !bInfo.hasValidIdentifier) {
            return -1;
        }
        if (!aInfo.hasValidIdentifier && bInfo.hasValidIdentifier) {
            return 1;
        }

        return a.messageIndex - b.messageIndex;
    });
}

/**
 * 将被压缩模块推入压缩模块的timeline
 */
function pushToCompressed(compressedModule, module) {
    if (compressedModule) {
        if (!compressedModule.timeline) compressedModule.timeline = [];
        compressedModule.timeline.push(module);
        debugLog('[timeline] 模块添加到时间线:', module, '压缩模块:', compressedModule);
    }
}

/**
 * 处理基于时间的压缩
 */
function processTimeBasedCompression(compressedModule, modules, backupIdentifierName) {
    try {
        const { timeData } = compressedModule;
        if (!timeData || !timeData.isValid || (!timeData.isComplete && !timeData.startTime.hasDate)) return;
        const compressedStart = timeData.startTime.timestamp;
        const compressedEnd = timeData.endTime.timestamp;
        const compressedLevel = compressedModule.variables.level;
        const comporessedBackupIdentifierValue = backupIdentifierName ? compressedModule.variables[backupIdentifierName] : '';

        modules.forEach(module => {
            if (module === compressedModule || !module.visibility) return;
            if (module.variables.level >= compressedLevel) return;

            const backupIdentifierValue = backupIdentifierName ? module.variables[backupIdentifierName] : '';
            if (!IdentifierParser.isIdentifierMatch(comporessedBackupIdentifierValue, backupIdentifierValue)) return;

            const moduleTimeData = module.timeData;
            if (moduleTimeData && moduleTimeData.isValid && (moduleTimeData.isComplete || (!moduleTimeData.isComplete && moduleTimeData.startTime.hasDate))) {
                if (!moduleTimeData.isRange) {
                    const moduleStart = moduleTimeData.startTime.timestamp;
                    if (moduleStart >= compressedStart && moduleStart <= compressedEnd) {
                        module.visibility = false;
                        pushToCompressed(compressedModule, module);
                    }
                } else {
                    const moduleStart = moduleTimeData.startTime.timestamp;
                    const moduleEnd = moduleTimeData.endTime.timestamp;
                    if (moduleStart >= compressedStart && moduleEnd <= compressedEnd) {
                        module.visibility = false;
                        pushToCompressed(compressedModule, module);
                    }
                }
            }
        });
        pushToCompressed(compressedModule, compressedModule);
    } catch (error) {
        errorLog('[Level Processor] 处理时间压缩模块时出错:', error, compressedModule, modules);
    }
}

/**
 * 处理基于ID的压缩
 */
function processIdBasedCompression(compressedModule, modules, identifierVar, backupIdentifierName) {
    const identifierName = identifierVar.name;
    const compressedIdValue = compressedModule.variables[identifierName];
    const compressedLevel = compressedModule.variables.level;
    const comporessedBackupIdentifierValue = backupIdentifierName ? compressedModule.variables[backupIdentifierName] : '';

    debugLog('[Level Processor] 压缩模块的ID值:', compressedIdValue, '压缩模块的level:', compressedLevel, compressedModule);

    const idRange = parseIdRange(compressedIdValue);
    if (!idRange) return;

    modules.forEach(module => {
        if (module === compressedModule || !module.visibility) return;
        if (module.variables.level >= compressedLevel) return;

        const backupIdentifierValue = backupIdentifierName ? module.variables[backupIdentifierName] : '';
        if (!IdentifierParser.isIdentifierMatch(comporessedBackupIdentifierValue, backupIdentifierValue)) return;

        const moduleIdValue = module.variables[identifierName];
        if (moduleIdValue) {
            const convertedModuleId = convertAlphaNumericId(moduleIdValue);
            if (isIdInRange(convertedModuleId, idRange)) {
                module.visibility = false;
                pushToCompressed(compressedModule, module);
            }
        }
    });
}

/**
 * 处理level变量，管理压缩层级和可见性
 * @param {Array} modules 排序后的模块数组
 * @param {Array} modulesData 模块配置数据
 * @returns {Array} 处理后的可见模块数组
 */
export function processLevelVariables(modules, modulesData) {
    debugLog('[Level Processor] 开始处理level变量，模块:', modules);

    modules.forEach(module => {
        if (module.variables.level === undefined || module.variables.level === null || module.variables.level === '') {
            module.variables.level = 0;
        }
        module.visibility = true;
    });

    const compressedModules = modules.filter(module => module.variables.level > 0)
        .sort((a, b) => b.variables.level - a.variables.level);
    debugLog('[Level Processor] level大于0的模块：', compressedModules);

    compressedModules.forEach(compressedModule => {
        const moduleConfig = modulesData.find(config => config.name === compressedModule.moduleName);
        if (!moduleConfig) return;

        const identifierVariables = moduleConfig.variables.filter(variable => variable.isIdentifier);
        if (identifierVariables.length !== 1) return;

        const identifierVar = identifierVariables[0];
        const identifierName = identifierVar.name;
        const identifierValue = compressedModule.variables[identifierName];
        debugLog('[Level Processor] 压缩模块的identifier变量:', identifierVar, '名称:', identifierName, '值:', identifierValue, compressedModule);

        const backupIdentifierName = moduleConfig.variables.filter(variable => variable.isBackupIdentifier)?.[0]?.name || '';

        if (identifierName.toLowerCase().includes('time')) {
            processTimeBasedCompression(compressedModule, modules, backupIdentifierName);
        } else if (identifierName.toLowerCase() === 'id') {
            processIdBasedCompression(compressedModule, modules, identifierVar, backupIdentifierName);
        }
    });

    const visibleModules = sortModules(modules.filter(module => module.visibility));
    debugLog('[Level Processor] 可见模块:', visibleModules);
    return visibleModules;
}

/**
 * 智能补全id变量
 * 对于有id变量但值为空的模块条目，根据备用标识符智能补全id
 * @param {Array} modules 排序后的模块数组
 */
export function completeIdVariables(modules) {
    debugLog('[IdCompletion] 开始智能补全id变量，模块数量:', modules.length);

    const moduleGroups = {};
    modules.forEach(module => {
        const moduleName = module.moduleName;
        if (!moduleGroups[moduleName]) {
            moduleGroups[moduleName] = [];
        }
        moduleGroups[moduleName].push(module);
    });

    // 提升到循环外，避免每组都深拷贝全部模块
    const modulesData = configManager.getModules() || [];
    Object.entries(moduleGroups).forEach(([moduleName, moduleList]) => {
        debugLog(`[IdCompletion] 处理模块组 ${moduleName}，包含 ${moduleList.length} 个模块`);

        const moduleConfig = modulesData.find(config => config.name === moduleName);

        if (!moduleConfig) {
            debugLog(`[IdCompletion] 模块 ${moduleName} 没有配置，跳过处理`);
            return;
        }

        const hasIdVariable = moduleConfig.variables.some(variable => variable.name === 'id');

        if (!hasIdVariable) {
            debugLog(`[IdCompletion] 模块 ${moduleName} 没有id变量，跳过处理`);
            return;
        }

        const backupIdentifiers = moduleConfig.variables
            .filter(variable => variable.isBackupIdentifier)
            .map(variable => variable.name);

        const identifierIdMap = new Map();
        let currentId = 1;

        moduleList.forEach(module => {
            let currentIdValue = module.variables.id || '';

            if (!currentIdValue) {
                let backupKey = '';
                if (backupIdentifiers.length > 0) {
                    backupKey = backupIdentifiers.map(identifier => module.variables[identifier] || '').join('__');
                }

                if (backupKey) {
                    if (identifierIdMap.has(backupKey)) {
                        currentIdValue = identifierIdMap.get(backupKey);
                    } else {
                        currentIdValue = currentId;
                        identifierIdMap.set(backupKey, currentIdValue);
                        currentId++;
                    }
                } else {
                    currentIdValue = currentId;
                    currentId++;
                }

                module.variables.id = currentIdValue;
            }
        });
    });

    debugLog('[IdCompletion] 智能补全id变量完成');
}
