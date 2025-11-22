// 正则工具模块 - 处理Regex扩展集成
import { eventSource, event_types, getRegexScripts, saveScriptsByType, SCRIPT_TYPES, uuidv4, extension_settings, reloadCurrentChat } from "../index.js";
import { debugLog, errorLog, infoLog } from "./logger.js";
import { saveSettingsDebounced } from "../../../../../../script.js";

/**
 * 正则工具类
 */
// export class RegexUtils {
//     constructor() {
//         this.isInitialized = false;
//     }

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
        const scriptName = '_CC_1.0';

        // 定义Continuity正则模式
        const regexPattern = {
            id: '',
            scriptName: scriptName,
            findRegex: '/\\[\\w+\\|[^\\]]*\\]/g',
            replaceString: '',
            trimStrings: [],
            placement: [2], // AI输出 (regex_placement.AI_OUTPUT = 2)
            disabled: false,
            markdownOnly: false,
            promptOnly: true, // 仅格式提示词
            runOnEdit: true, // 在编辑时运行
            substituteRegex: 0,
            minDepth: NaN,
            maxDepth: NaN,
        };

        const scripts = extension_settings.regex;
        // 检查是否已经注册过，避免重复
        const existingPatternIndex = scripts.findIndex(p =>
            p.scriptName === scriptName
        );

        debugLog('[REGEX]Continuity正则:', scripts);
        if (existingPatternIndex === -1) {
            // 添加新的正则模式
            regexPattern.id = uuidv4();
            scripts.push(regexPattern);
            infoLog('[REGEX]Continuity正则模式已成功注册到Regex扩展');
        } else {
            // 更新现有的模式
            scripts[existingPatternIndex] = regexPattern;
            debugLog('[REGEX]Continuity正则模式已更新');
        }
        await saveScriptsByType(scripts, SCRIPT_TYPES.GLOBAL);

        if (eventSource && event_types) {
            eventSource.emit(event_types.CHAT_CHANGED);
            debugLog('[REGEX]已触发事件刷新Regex扩展UI');
        }

    } catch (error) {
        errorLog('[REGEX]注册Continuity正则模式失败:', error);
        return null;
    }
}
