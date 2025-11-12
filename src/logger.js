// 日志管理模块
import { extension_settings } from "../../../../extensions.js";
import { extensionName } from "./config.js";

/**
 * 检查调试日志是否启用
 * @returns {boolean} 调试日志是否启用
 */
export function isDebugLogsEnabled() {
    const settings = extension_settings[extensionName];
    return settings && settings.debugLogs === true;
}

/**
 * 获取调用栈信息，提取文件名和行号
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
                // 提取文件名和行号
                const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/) ||
                    line.match(/at\s+(.+?):(\d+):(\d+)/);

                if (match) {
                    // 如果是函数调用格式
                    if (match[2]) {
                        const fileName = match[2].split('/').pop(); // 只取文件名
                        const lineNumber = match[3];
                        return `${fileName}:${lineNumber}`;
                    }
                    // 如果是直接文件格式
                    else if (match[1]) {
                        const fileName = match[1].split('/').pop(); // 只取文件名
                        const lineNumber = match[2];
                        return `${fileName}:${lineNumber}`;
                    }
                }
            }
        }
        return 'unknown:0';
    } catch (error) {
        return 'error:0';
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
