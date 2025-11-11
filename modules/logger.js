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
 * 调试日志输出函数
 * @param {...any} args 日志参数
 */
export function debugLog(...args) {
    if (isDebugLogsEnabled()) {
        console.log("[Continuity]", ...args);
    }
}

/**
 * 错误日志输出函数（始终显示）
 * @param {...any} args 日志参数
 */
export function errorLog(...args) {
    console.error("[Continuity]", ...args);
}

/**
 * 警告日志输出函数（始终显示）
 * @param {...any} args 日志参数
 */
export function warnLog(...args) {
    console.warn("[Continuity]", ...args);
}

/**
 * 信息日志输出函数（始终显示）
 * @param {...any} args 日志参数
 */
export function infoLog(...args) {
    console.info("[Continuity]", ...args);
}