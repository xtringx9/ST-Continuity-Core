// levelCompressionStep.js
// processLevelVariables 层纯函数（F 二期快照：可组合性改造）。
// 本文件无 ST 依赖（模块配置 + sortFn 都作为参数注入），可在纯 node 下单元测试。
//
// ⚠️ processLevelVariables 是「后面楼层压缩前面楼层」：level>0 的压缩模块扫整组，
// 把 level 更低、id/time 范围在压缩范围内的历史模块 visibility=false 并压入 timeline。
// 因此【不能逐模块流式】——从 X-1 快照继续时，X..end 的新压缩模块要能回看 X-1 之前
// 的模块。方案：快照存「去重+id补全+time解析后、未压缩」的组内模块集合（干净副本），
// 从 X 重算 = 快照[X-1] 集合 ∪ X..end 新模块 → 组内全量重跑本函数。
//
// ⚠️ 副作用：就地修改 module.visibility / compressedModule.timeline。重跑必须用干净副本
//（否则旧 timeline 叠加、已折叠模块被重复处理）。
//
// ⚠️ sortModules 依赖 configManager（getModuleIdentifierInfo → configManager.getModules），
// 不能直接搬 → 作为 sortFn 注入（真实用 sort.js 的 sortModules，测试用等价实现）。

import { IdentifierParser } from '../../utils/identifierParser.js';
import { convertAlphaNumericId } from '../../utils/numberParser.js';

/** 将被压缩模块推入压缩模块的 timeline */
function pushToCompressed(compressedModule, module) {
    if (compressedModule) {
        if (!compressedModule.timeline) compressedModule.timeline = [];
        compressedModule.timeline.push(module);
    }
}

/** 解析 id 范围（001~004 / 001-004） */
function parseIdRange(idValue) {
    if (typeof idValue !== 'string') return null;
    const rangeMatch = idValue.match(/^(.+)[~-](.+)$/);
    if (!rangeMatch || rangeMatch.length !== 3) return null;
    const start = convertAlphaNumericId(rangeMatch[1].trim());
    const end = convertAlphaNumericId(rangeMatch[2].trim());
    return { start, end };
}

/** 检查 id 是否在范围内 */
function isIdInRange(id, range) {
    const idNum = typeof id === 'string' ? parseInt(id, 10) : id;
    const startNum = typeof range.start === 'string' ? parseInt(range.start, 10) : range.start;
    const endNum = typeof range.end === 'string' ? parseInt(range.end, 10) : range.end;
    return !isNaN(idNum) && !isNaN(startNum) && !isNaN(endNum) &&
        idNum >= startNum && idNum <= endNum;
}

/** 处理基于时间的压缩 */
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
    } catch (e) {
        // 忽略单模块压缩错误（与原 errorLog 行为一致，但不依赖 logger）
    }
}

/** 处理基于 ID 的压缩 */
function processIdBasedCompression(compressedModule, modules, identifierVar, backupIdentifierName) {
    const identifierName = identifierVar.name;
    const compressedIdValue = compressedModule.variables[identifierName];
    const compressedLevel = compressedModule.variables.level;
    const comporessedBackupIdentifierValue = backupIdentifierName ? compressedModule.variables[backupIdentifierName] : '';

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
 * 组内全量重跑 level 压缩（等价于原 processLevelVariables）。
 * ⚠️ 输入应为「干净副本」——该函数就地改 visibility / timeline，重跑会叠加。
 * @param {Array} modules 组内模块数组（排序前，允许任意顺序——函数内部先补 level/visibility）
 * @param {Array} moduleConfigs 模块配置
 * @param {Function} sortFn 排序函数（注入：真实用 sort.js 的 sortModules）
 * @returns {Array} 处理后的可见模块数组
 */
export function compressLevelToState(modules, moduleConfigs, sortFn) {
    modules.forEach(module => {
        if (module.variables.level === undefined || module.variables.level === null || module.variables.level === '') {
            module.variables.level = 0;
        }
        module.visibility = true;
    });

    const compressedModules = modules.filter(module => module.variables.level > 0)
        .sort((a, b) => b.variables.level - a.variables.level);

    compressedModules.forEach(compressedModule => {
        const moduleConfig = moduleConfigs.find(config => config.name === compressedModule.moduleName);
        if (!moduleConfig) return;

        const identifierVariables = moduleConfig.variables.filter(variable => variable.isIdentifier);
        if (identifierVariables.length !== 1) return;

        const identifierVar = identifierVariables[0];
        const identifierName = identifierVar.name;
        const identifierValue = compressedModule.variables[identifierName];

        const backupIdentifierName = moduleConfig.variables.filter(variable => variable.isBackupIdentifier)?.[0]?.name || '';

        if (identifierName.toLowerCase().includes('time')) {
            processTimeBasedCompression(compressedModule, modules, backupIdentifierName);
        } else if (identifierName.toLowerCase() === 'id') {
            processIdBasedCompression(compressedModule, modules, identifierVar, backupIdentifierName);
        }
    });

    const visibleModules = sortFn(modules.filter(module => module.visibility));
    return visibleModules;
}
