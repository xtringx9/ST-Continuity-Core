// 正则工具模块 - 处理Regex扩展集成
import { configManager, CONTINUITY_CORE_IDENTIFIER, eventSource, event_types, getRegexScripts, saveScriptsByType, SCRIPT_TYPES, uuidv4, extension_settings, reloadCurrentChat } from "../index.js";
import { debugLog, errorLog, infoLog } from "./logger.js";
import { saveSettingsDebounced } from "../../../../../../script.js";


// 世界书相关常量定义
export const REGEX_CONSTANTS = {
    // 版本信息常量
    version: '1.0.0',
};

// 正则模式配置常量
const REGEX_PATTERNS = {
    patterns: [
        {
            scriptName: CONTINUITY_CORE_IDENTIFIER + '隐藏<module>内容_' + REGEX_CONSTANTS.version,
            findRegex: '/(?<!<details>\\s*)<(modules?|ccore|module_update)>([\\s\\S]*?)<\\/\\1>/g',
            replaceString: '',
            trimStrings: [],
            placement: [1, 2], // AI输出 (regex_placement.AI_OUTPUT = 2)
            disabled: false,
            markdownOnly: true, // 仅格式显示
            promptOnly: true, // 仅格式提示词
            runOnEdit: true, // 在编辑时运行
            substituteRegex: 0,
            minDepth: NaN,
            maxDepth: NaN,
        }
    ]
};

/**
 * 向Regex扩展注册Continuity正则模式
 */
export async function registerContinuityRegexPattern() {
    try {
        debugLog('[REGEX]开始注册Continuity正则模式');
        // 确保Regex扩展设置已初始化
        if (!extension_settings.regex) {
            extension_settings.regex = [];
        }

        const scripts = extension_settings.regex;

        // 调用单独的方法处理正则模式注册
        let isChange = registerRegexPatterns(REGEX_PATTERNS.patterns, scripts);


        if (configManager.isLoaded) {
            const scripts = extension_settings.regex;
            isChange = isChange || registerConfigRegexPatterns(scripts);
        }
        else {
            configManager.registerLoadCallback(async () => {
                const scripts = extension_settings.regex;
                const isChange = registerConfigRegexPatterns(scripts);
                if (isChange) {
                    await saveScriptsByType(scripts, SCRIPT_TYPES.GLOBAL);

                    if (eventSource && event_types) {
                        eventSource.emit(event_types.CHAT_CHANGED);
                        debugLog('[REGEX]已触发事件刷新Regex扩展UI');
                    }
                }
            });
        }

        // 如果有变化，保存并刷新Regex扩展UI
        if (isChange) {
            await saveScriptsByType(scripts, SCRIPT_TYPES.GLOBAL);

            if (eventSource && event_types) {
                eventSource.emit(event_types.CHAT_CHANGED);
                debugLog('[REGEX]已触发事件刷新Regex扩展UI');
            }
        }

    } catch (error) {
        errorLog('[REGEX]注册Continuity正则模式失败:', error);
        return null;
    }
}

/**
 * 注册正则模式到Regex扩展
 * @param {Array} patterns - 要注册的正则模式配置数组
 * @param {Array} scripts - Regex扩展的脚本数组
 * @returns {boolean} 是否有变化
 */
function registerRegexPatterns(patterns, scripts) {
    let isChange = false;

    // 遍历所有定义的正则模式并注册
    for (const patternConfig of patterns) {
        const scriptName = patternConfig.scriptName;

        // 提取脚本名称（忽略版本号）
        // scriptName结构：名称_版本号，需要忽略最后一个下划线后的版本号
        const scriptNameWithoutVersion = scriptName.replace(/_[^_]*$/, '');

        // 检查是否已经注册过，避免重复（忽略版本号进行比较）
        const existingPatternIndex = scripts.findIndex(p => {
            const existingScriptNameWithoutVersion = p.scriptName.replace(/_[^_]*$/, '');
            return existingScriptNameWithoutVersion === scriptNameWithoutVersion;
        });

        // debugLog('[REGEX]Continuity正则:', scripts);
        if (existingPatternIndex === -1) {
            // 添加新的正则模式
            const regexPattern = {
                id: uuidv4(),
                ...patternConfig
            };
            scripts.push(regexPattern);
            isChange = true;
            infoLog(`[REGEX]正则模式"${scriptName}"已成功注册到Regex扩展`);
        } else if (scripts[existingPatternIndex].scriptName !== scriptName) {
            // 更新现有的模式，保留原有的id
            const existingPattern = scripts[existingPatternIndex];
            scripts[existingPatternIndex] = {
                ...patternConfig,
                id: existingPattern.id // 保留原有的id
            };
            isChange = true;
            debugLog(`[REGEX]正则模式"${scriptName}"已更新，保留原有ID: ${existingPattern.id}`);
        }
    }

    return isChange;
}

/**
 * 注册正则模式到Regex扩展
 * @param {Array} scripts - Regex扩展的脚本数组
 * @returns {boolean} 是否有变化
 */
function registerConfigRegexPatterns(scripts) {
    const entryCount = configManager.getGlobalSettings().contentRemainLayers || 9;
    let patterns = [];
    const pattern = {
        scriptName: CONTINUITY_CORE_IDENTIFIER + '不发送保留层数前任何内容_' + REGEX_CONSTANTS.version,
        findRegex: '[\\s\\S]*',
        replaceString: '',
        trimStrings: [],
        placement: [1, 2], // AI输出 (regex_placement.AI_OUTPUT = 2)
        disabled: false,
        markdownOnly: false, // 仅格式显示
        promptOnly: true, // 仅格式提示词
        runOnEdit: true, // 在编辑时运行
        substituteRegex: 0,
        minDepth: entryCount,
        maxDepth: NaN,
    }
    patterns.push(pattern);

    let isChange = false;

    // 遍历所有定义的正则模式并注册
    for (const patternConfig of patterns) {
        const scriptName = patternConfig.scriptName;

        // 提取脚本名称（忽略版本号）
        // scriptName结构：名称_版本号，需要忽略最后一个下划线后的版本号
        const scriptNameWithoutVersion = scriptName.replace(/_[^_]*$/, '');

        // 检查是否已经注册过，避免重复（忽略版本号进行比较）
        const existingPatternIndex = scripts.findIndex(p => {
            const existingScriptNameWithoutVersion = p.scriptName.replace(/_[^_]*$/, '');
            return existingScriptNameWithoutVersion === scriptNameWithoutVersion;
        });

        // debugLog('[REGEX]Continuity正则:', scripts);
        if (existingPatternIndex === -1) {
            // 添加新的正则模式
            const regexPattern = {
                id: uuidv4(),
                ...patternConfig
            };
            scripts.push(regexPattern);
            isChange = true;
            infoLog(`[REGEX]配置正则模式"${scriptName}"已成功注册到Regex扩展`);
        } else if (scripts[existingPatternIndex].scriptName !== scriptName) {
            // 更新现有的模式，保留原有的id
            const existingPattern = scripts[existingPatternIndex];
            scripts[existingPatternIndex] = {
                ...patternConfig,
                id: existingPattern.id // 保留原有的id
            };
            isChange = true;
            debugLog(`[REGEX]配置正则模式"${scriptName}"已更新，保留原有ID: ${existingPattern.id}`);
        }
    }

    return isChange;
}
