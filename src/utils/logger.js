// 日志管理模块
import { EXTENSION_CONFIG_KEY, extension_settings, extensionName } from "../index.js";

/**
 * 检查调试日志是否启用
 * @returns {boolean} 调试日志是否启用
 */
export function isDebugLogsEnabled() {
    const settings = extension_settings[extensionName][EXTENSION_CONFIG_KEY];
    // console.log("settings:", settings, settings.debugLogs);
    return settings && settings.debugLogs === true;
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
    if (isDebugLogsEnabled()) {
        const callerInfo = getCallerInfo();
        console.log("[Continuity]", `[${callerInfo}]`, ...args);
    }
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
