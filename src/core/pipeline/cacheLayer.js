// cacheLayer.js
// 显式缓存读写层（Tier 1：把 moduleProcessor.js:51-92 的隐式缓存分支抽出来）。
//
// 行为保持映射：
//   原读条件：processType==='auto' && hasCurrentChatData(start,end) && !isForce
//   原写条件：processType==='auto' && isAllModule（moduleFilters===null）
// 新 API：runModulePipeline 用 cache:'read'|'write'|'both'|'none' 显式控制，
// 本层按 cache 选项 + processType + isAllModule 决定是否读写，保持原语义。
//
// 缓存键沿用 moduleCacheManager（chatIdHash + rangeKey），不改存储结构。

import { chat } from '../../../../../../../script.js';
import configManager from '../../singleton/configManager.js';
import moduleCacheManager from '../../singleton/moduleCacheManager.js';
import { buildModulesString } from './output.js';
import { debugLog } from '../../utils/logger.js';

/**
 * 读缓存（命中则返回结构化结果，否则返回 null）。
 * 复刻原 moduleProcessor.js:51-92 的缓存命中分支（含按 selectedModuleNames 过滤 + 重建 contentString）。
 * @param {{start:number, end:number|null, processType:string, isAllModule:boolean, force:boolean, selectedModuleNames:string[]|undefined, moduleFilters:Array|null, showModuleNames:boolean, showProcessInfo:boolean, showRule:boolean}} ctx
 * @returns {object|null}
 */
export function readCache(ctx) {
    const { start, end, processType, isAllModule, force, selectedModuleNames, moduleFilters, showModuleNames, showProcessInfo, showRule } = ctx;

    // 原读条件：仅 auto 且未 force 且有缓存
    if (processType !== 'auto' || force) return null;

    let checkEndIndex = end;
    if (checkEndIndex === null) {
        checkEndIndex = chat?.length - 1;
    }

    if (!moduleCacheManager.hasCurrentChatData(start, checkEndIndex)) return null;

    const cachedData = moduleCacheManager.getCurrentChatData(start, checkEndIndex);

    // 按 selectedModuleNames 过滤缓存内容（原 53-67 行）
    let content = {};
    let tmpSelectedModuleNames = selectedModuleNames;
    if (tmpSelectedModuleNames === undefined) {
        if (isAllModule) {
            // 修正：原 moduleProcessor.js:57 误用 module.moduleName（undefined），
            // 导致「全量 + 未传 selectedModuleNames + 缓存命中」分支返回空 content。
            // configManager 模块配置字段为 module.name，此处改回正确字段。
            tmpSelectedModuleNames = configManager.getModules().map(module => module.name);
        } else {
            tmpSelectedModuleNames = moduleFilters.map(config => config.name);
        }
    }
    Object.keys(cachedData.content).forEach(moduleName => {
        if (tmpSelectedModuleNames.includes(moduleName)) {
            content[moduleName] = cachedData.content[moduleName];
        }
    });

    let contentString = '';
    if (typeof content !== 'string') {
        contentString = buildModulesString(content, showModuleNames, showProcessInfo, showRule);
    }
    let count = 0;
    let hasContent = false;
    if (Array.isArray(content)) {
        count = content.length;
        hasContent = count > 0;
    } else if (content && typeof content === 'object') {
        count = Object.keys(content).length;
        hasContent = count > 0;
    }

    debugLog(`[cacheLayer] 缓存命中，范围：${start} - ${checkEndIndex}`);
    return {
        success: cachedData.success,
        content,
        contentString,
        displayTitle: cachedData.displayTitle,
        moduleCount: count,
        hasContent,
    };
}

/**
 * 写缓存（仅 auto + 全量时写，复刻原 moduleProcessor.js:178 条件）。
 * @param {{start:number, end:number|null, processType:string, isAllModule:boolean, result:object}} ctx
 */
export function writeCache(ctx) {
    const { start, end, processType, isAllModule, result } = ctx;
    if (processType !== 'auto' || !isAllModule) return;

    let checkEndIndex = end;
    if (checkEndIndex === null) {
        checkEndIndex = chat?.length - 1;
    }
    moduleCacheManager.setCurrentChatData(start, checkEndIndex, result);
    debugLog(`[cacheLayer] 写入缓存，范围：${start} - ${checkEndIndex}`);
}
