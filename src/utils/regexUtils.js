// 正则工具模块 - 处理Regex扩展集成
import { uuidv4, extension_settings, reloadCurrentChat } from "../index.js";
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
export function registerContinuityRegexPattern() {
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

        // 检查是否已经注册过，避免重复
        const existingPatternIndex = extension_settings.regex.findIndex(p =>
            p.scriptName === scriptName
        );

        if (existingPatternIndex === -1) {
            // 添加新的正则模式
            regexPattern.id = uuidv4();
            extension_settings.regex.push(regexPattern);
            infoLog('[REGEX]Continuity正则模式已成功注册到Regex扩展');
        } else {
            // 更新现有的模式
            extension_settings.regex[existingPatternIndex] = regexPattern;
            debugLog('[REGEX]Continuity正则模式已更新');
        }

        // 保存设置
        saveSettingsDebounced();
        // reloadCurrentChat();
    } catch (error) {
        errorLog('[REGEX]注册Continuity正则模式失败:', error);
        return null;
    }
}

// /**
//  * 初始化Regex扩展集成
//  */
// function initializeRegexIntegration(eventSource, event_types) {
//     try {
//         // 监听Regex扩展设置加载事件
//         if (eventSource && eventSource.on) {
//             eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, () => {
//                 debugLog('[REGEX]Regex扩展设置已加载，注册Continuity正则模式');
//                 registerContinuityRegexPattern();
//             });
//         }

//         // 立即尝试注册（如果扩展已经加载）
//         setTimeout(() => {
//             registerContinuityRegexPattern();
//         }, 1000);

//         // isInitialized = true;
//         infoLog('[REGEX]Regex扩展集成初始化完成');
//     } catch (error) {
//         errorLog('[REGEX]初始化Regex扩展集成失败:', error);
//     }
// }

// /**
//  * 销毁正则工具
//  */
// destroy() {
//     this.isInitialized = false;
//     infoLog('[REGEX]正则工具已销毁');
// }
// }
