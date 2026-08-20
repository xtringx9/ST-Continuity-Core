// 日志管理模块
import { EXTENSION_CONFIG_KEY, extensionName } from "../singleton/configManager.js";
import { extension_settings } from "../../../../../extensions.js";

/**
 * 调试日志分组（预定义，按功能域组织文件）。
 * debugLog 输出条件 = debug.global 总开关 && （命中「已启用分组」 或 「不属于任何分组」）：
 *   - 勾选某分组 → 只显示该分组文件的 debugLog（未勾选分组文件不显示）
 *   - 无任何勾选 → 只显示「不属于任何分组」的文件（工具类/UI 组件），核心功能文件需勾选分组才显示
 * 匹配用 getCallerInfo 提取的文件名（不含路径，项目内文件名唯一）。
 */
export const DEBUG_GROUPS = [
    { id: 'pipeline', label: '管线/缓存', files: [
        'runModulePipeline.js', 'cacheLayer.js', 'output.js', 'normalize.js', 'normalizeRawStep.js',
        'deduplicate.js', 'deduplicateStep.js', 'groupByMessage.js', 'idCompletionStep.js',
        'incrementalModuleCompare.js', 'levelCompressionStep.js', 'mergeStep.js', 'moduleDataSources.js',
        'resolveModuleChangeAffect.js', 'sort.js', 'time.js', 'timeCompletionStep.js',
        'occurrenceCache.js', 'snapshotStore.js', 'rebuildProcessor.js', 'moduleProcessor.js',
        'moduleExtractor.js', 'moduleCacheManager.js', 'generatedContentCache.js',
    ] },
    { id: 'event', label: '事件/生命周期', files: [
        'eventHandler.js', 'macroManager.js', 'taskRegistry.js', 'generationContext.js', 'promptInjector.js',
    ] },
    { id: 'render', label: '渲染/UI', files: [
        'contextBottomUI.js', 'inlineMessageRenderer.js', 'iframeRenderer.js', 'containerManager.js',
        'moduleFilters.js', 'nestedModuleAnchors.js', 'processResultBuilder.js',
        'messageAiButton.js', 'EntryButton.js', 'ModuleEditor.js', 'generationRecordsPanel.js',
        'Toolbox.js', 'GlobalSettings.js', 'AsyncSettings.js', 'ChangesSummary.js', 'CharacterBinding.js',
        'DragHandler.js', 'ImportExport.js', 'ModuleDetailRenderer.js', 'VariableListRenderer.js',
    ] },
    { id: 'generator', label: '生成器', files: [
        'moduleAiGenerator.js', 'aiCaller.js', 'backendService.js', 'continuityCoreServerApi.js',
    ] },
    { id: 'storage', label: '存储', files: [
        'floorModuleStore.js', 'chatModuleEntryStore.js', 'floorBridge.js', 'chatFileBridge.js',
        'variableBridge.js', 'perMessageStorage.js', 'storageKeyBuilder.js',
    ] },
    { id: 'config', label: '配置/工具', files: [
        'configManager.js', 'moduleConfigService.js', 'regexUtils.js', 'worldBookUtils.js',
        'variableReplacer.js', 'textConverter.js', 'stringUtils.js', 'numberParser.js',
        'timeParser.js', 'identifierParser.js', 'depthCalculator.js', 'moduleParser.js',
        'promptGenerator.js', 'styleCombiner.js',
    ] },
];

/**
 * 检查调试日志是否启用（全局总开关 debug.global）。
 * @returns {boolean} 调试日志是否启用
 */
export function isDebugLogsEnabled() {
    // 检查 extension_settings 是否已定义
    if (typeof extension_settings === 'undefined' || !extension_settings) {
        return false;
    }
    const settings = extension_settings?.[extensionName]?.[EXTENSION_CONFIG_KEY];
    // 注意：此处必须直读 extension_settings，不能走 configManager.getDebugConfig()。
    // 原因：configManager.js 在初始化早期（load 阶段）就会调用 debugLog/errorLog，
    // 若 logger 反向依赖 configManager 会形成循环依赖，导致 configManager is not defined。
    return settings?.debug?.global === true;
}

/**
 * 按调用文件名判断是否应输出该 debugLog（细分分组门控，见 DEBUG_GROUPS）。
 * @param {string} fileName 调用文件名
 * @returns {boolean}
 */
function isGroupLogEnabled(fileName) {
    const settings = extension_settings?.[extensionName]?.[EXTENSION_CONFIG_KEY];
    const logGroups = settings?.debug?.logGroups || {};
    // 命中已启用分组 → 显示
    for (const g of DEBUG_GROUPS) {
        if (logGroups[g.id] === true && g.files.includes(fileName)) return true;
    }
    // 属于某分组但未启用 → 不显示；不属于任何分组（工具/UI 组件）→ 随全局总开关显示
    const belongsToAny = DEBUG_GROUPS.some(g => g.files.includes(fileName));
    return !belongsToAny;
}

/**
 * 获取调用栈信息，提取文件名、方法名和行号
 * @returns {string} 格式化的调用栈信息
 */
function getCallerInfo() {
    try {
        const error = new Error();
        const stack = error.stack || '';
        const stackLines = stack.split('\n');

        // 跳过logger.js自身的调用栈
        for (let i = 3; i < stackLines.length; i++) {
            const line = stackLines[i].trim();
            // 匹配文件名和行号，排除node_modules和logger.js本身
            if (line && !line.includes('logger.js') && !line.includes('node_modules')) {
                // 提取文件名、方法名和行号
                // 匹配格式1: at methodName (filePath:line:column)
                const match1 = line.match(/at\s+([^(\s]+)\s+\((.+?):(\d+):(\d+)\)/);
                // 匹配格式2: at filePath:line:column
                const match2 = line.match(/at\s+(.+?):(\d+):(\d+)/);
                // 匹配格式3: at Object.methodName (filePath:line:column)
                const match3 = line.match(/at\s+([^.]+)\.([^(\s]+)\s+\((.+?):(\d+):(\d+)\)/);

                if (match3) {
                    // 格式3: 包含对象和方法名
                    const fileName = match3[3].split('/').pop(); // 只取文件名
                    const methodName = match3[2]; // 方法名
                    const lineNumber = match3[4]; // 行号
                    return `${fileName}:${methodName}:${lineNumber}`;
                } else if (match1) {
                    // 格式1: 包含方法名
                    const fileName = match1[2].split('/').pop(); // 只取文件名
                    const methodName = match1[1]; // 方法名
                    const lineNumber = match1[3]; // 行号
                    return `${fileName}:${methodName}:${lineNumber}`;
                } else if (match2) {
                    // 格式2: 只有文件路径和行号
                    const fileName = match2[1].split('/').pop(); // 只取文件名
                    const lineNumber = match2[2]; // 行号
                    return `${fileName}:anonymous:${lineNumber}`;
                }
            }
        }
        return 'unknown:anonymous:0';
    } catch (error) {
        return 'error:anonymous:0';
    }
}

/**
 * 调试日志输出函数
 * @param {...any} args 日志参数
 */
export function debugLog(...args) {
    if (!isDebugLogsEnabled()) return;
    const callerInfo = getCallerInfo();
    const fileName = callerInfo.split(':')[0];
    if (!isGroupLogEnabled(fileName)) return;
    console.log("[Continuity]", `[${callerInfo}]`, ...args);
}

/**
 * 错误日志输出函数（始终显示）
 * @param {...any} args 日志参数
 */
export function errorLog(...args) {
    const callerInfo = getCallerInfo();
    console.error("[Continuity]", `[${callerInfo}]`, ...args);
}

/**
 * 警告日志输出函数（始终显示）
 * @param {...any} args 日志参数
 */
export function warnLog(...args) {
    const callerInfo = getCallerInfo();
    console.warn("[Continuity]", `[${callerInfo}]`, ...args);
}

/**
 * 信息日志输出函数（始终显示）
 * @param {...any} args 日志参数
 */
export function infoLog(...args) {
    const callerInfo = getCallerInfo();
    console.info("[Continuity]", `[${callerInfo}]`, ...args);
}
