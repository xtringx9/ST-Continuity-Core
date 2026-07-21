// 去重管线步骤
import configManager from '../../singleton/configManager.js';
import { debugLog } from '../../utils/logger.js';

/**
 * 获取模块历史中最大的messageIndex（排除当前messageIndex）
 * @param {Object} module 模块对象
 * @param {number} currentMessageIndex 当前消息索引
 * @returns {number} 最大的历史messageIndex，无则返回-1
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
 * 模块去重
 * 基于模块名+变量值组合去重，增量模块和全量模块采用不同的messageIndex保留策略
 * @param {Array} modules 模块数组
 * @returns {Array} 去重后的模块数组
 */
export function deduplicateModules(modules) {
    // 获取所有模块配置
    const modulesConfig = configManager.getEffectiveModules() || [];

    // 使用Map来存储每个唯一模块的最小messageIndex版本
    const moduleMap = new Map();
    let duplicateCount = 0;

    modules.forEach(module => {
        // 获取当前模块的配置
        const moduleConfig = modulesConfig.find(config => config.name === module.moduleName);
        // 判断是否为增量模块（outputMode === 'incremental'）
        const isIncrementalModule = moduleConfig && moduleConfig.outputMode === 'incremental';
        const notAfterBody = moduleConfig && moduleConfig.outputPosition !== 'after_body';

        // 构建模块的唯一标识符：基于所有变量值的组合
        const moduleKey = JSON.stringify({
            moduleName: module.moduleName,
            variables: module.variables,
            notAfterBody: !isIncrementalModule && notAfterBody ? module.raw : '',
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
                    existingModule.messageIndex = currentMessageIndex;
                } else if (!shouldCompare && currentMessageIndex >= 0 && existingMessageIndex < 0) {
                    existingModule.messageIndex = currentMessageIndex;
                }
            }

            duplicateCount++;
        } else {
            if (isIncrementalModule) {
                // 检查是否只输出了moduleConfig中isIdentifier或isBackupIdentifier的变量，是的话视为无效条目
                let hasValidVariable = false;
                let hasIdentifierVariable = false;
                let identifierValid = false;
                let backupIdentifierValid = false;

                for (const [variableName] of Object.entries(module.variables)) {
                    const variableConfig = moduleConfig.variables.find(v => v.name === variableName);
                    if (module.variables[variableName] !== "" && variableConfig && !variableConfig.isIdentifier && !variableConfig.isBackupIdentifier) {
                        hasValidVariable = true;
                        break;
                    }

                    // 检查标识符变量
                    if (variableConfig && variableConfig.isIdentifier && module.variables[variableName] !== "") {
                        hasIdentifierVariable = true;
                        identifierValid = true;
                    }
                    if (variableConfig && variableConfig.isBackupIdentifier && module.variables[variableName] !== "") {
                        hasIdentifierVariable = true;
                        backupIdentifierValid = true;
                    }
                }

                // 如果标识符变量存在但两个标识符都无效（值为空），视为无效条目
                if (hasIdentifierVariable && !identifierValid && !backupIdentifierValid) {
                    debugLog('[Deduplication] 增量模块标识符变量都无效，视为无效条目:', module.moduleName, 'variables:', module.variables, 'module:', module);
                } else if (hasValidVariable) {
                    moduleMap.set(moduleKey, module);
                } else {
                    debugLog('[Deduplication] 增量模块输出了无效变量:', module.moduleName, 'variables:', module.variables, 'module:', module);
                }
            } else {
                // 第一次遇到这个模块，直接存储
                moduleMap.set(moduleKey, module);
            }
            if (!module.messageIndexHistory) {
                module.messageIndexHistory = [module.messageIndex];
            }
        }
    });

    // 将Map中的值转换为数组
    const uniqueModules = Array.from(moduleMap.values());

    debugLog('[Deduplication] 去重完成，原始模块数:', modules.length, '去重后模块数:', uniqueModules.length, '重复模块数:', duplicateCount);

    return uniqueModules;
}
