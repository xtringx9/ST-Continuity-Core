/**
 * 变量替换器 - 负责处理提示词中的变量替换
 * 统一处理 {{user}}、{{char}} 等变量的替换
 */

import { debugLog, errorLog } from './logger.js';
// ST 官方宏展开（script.js 导出，父窗口可用）
import { substituteParams } from '../../../../../../script.js';

// {{ccore_msg_module}} 宏：由 moduleAiGenerator 通过 setMsgModuleResolver 注入解析器，
// 避免 variableReplacer 反向依赖 promptGenerator（promptGenerator → variableReplacer 已存在）。
let msgModuleResolver = null;
/**
 * 注册 {{ccore_msg_module}} 宏的解析器（生成期专用，注入 generateChatModuleDataForFloor）。
 * @param {(mesId:number)=>string} fn
 */
export function setMsgModuleResolver(fn) {
    msgModuleResolver = fn;
}

// 导入SillyTavern的getContext函数
let getContext;
try {
    // 尝试从SillyTavern的扩展系统导入getContext函数
    const { getContext: importedGetContext } = await import('/scripts/extensions.js');
    getContext = importedGetContext;
} catch (error) {
    debugLog("变量替换器: 无法从/scripts/extensions.js导入getContext函数", error);

    // 备用方案：从全局对象获取
    getContext = () => {
        try {
            // 方法1: 尝试从全局对象获取
            if (typeof window !== 'undefined' && window.SillyTavern && window.SillyTavern.getContext) {
                return window.SillyTavern.getContext();
            }

            // 方法2: 尝试直接访问SillyTavern的上下文
            if (typeof window !== 'undefined' && window.SillyTavern && window.SillyTavern.context) {
                return window.SillyTavern.context;
            }

            // 方法3: 尝试从扩展设置获取
            if (typeof globalThis !== 'undefined' && globalThis.extension_settings && globalThis.extension_settings.getContext) {
                return globalThis.extension_settings.getContext();
            }

            return null;
        } catch (err) {
            debugLog("变量替换器: 备用getContext函数调用失败", err);
            return null;
        }
    };
}

/**
 * 获取用户和角色名称
 * 使用多种方式尝试获取用户和角色的实际名称
 * @returns {{userName: string, charName: string}} 用户和角色名称
 */
export function getUserAndCharNames() {
    try {
        debugLog("变量替换器: 开始获取用户和角色名称");

        // 方法1: 尝试从Context对象获取
        try {
            debugLog("变量替换器: 尝试使用内部getContext函数获取用户和角色名称");

            // 使用我们自己的getContext函数
            const context = getContext();
            if (context && context.name1 && context.name2) {
                debugLog("变量替换器: 通过内部getContext函数获取用户和角色名称");
                return {
                    userName: context.name1,
                    charName: context.name2
                };
            }
        } catch (contextError) {
            debugLog("变量替换器: 内部getContext函数调用失败", contextError);
        }

        // 方法2: 尝试从全局SillyTavern对象获取
        try {
            debugLog("变量替换器: 尝试从全局SillyTavern对象获取");

            if (typeof window !== 'undefined' && window.SillyTavern) {
                // 尝试从window.SillyTavern.context获取
                if (window.SillyTavern.context && window.SillyTavern.context.name1 && window.SillyTavern.context.name2) {
                    debugLog("变量替换器: 从全局SillyTavern对象获取用户和角色名称");
                    return {
                        userName: window.SillyTavern.context.name1,
                        charName: window.SillyTavern.context.name2
                    };
                }

                // 尝试直接获取name1和name2属性
                if (window.SillyTavern.name1 && window.SillyTavern.name2) {
                    debugLog("变量替换器: 从全局SillyTavern属性获取用户和角色名称");
                    return {
                        userName: window.SillyTavern.name1,
                        charName: window.SillyTavern.name2
                    };
                }
            }
        } catch (globalError) {
            debugLog("变量替换器: 全局SillyTavern对象访问失败", globalError);
        }

        // 方法3: 尝试使用SillyTavern的标准变量替换
        try {
            debugLog("变量替换器: 尝试使用SillyTavern标准变量替换");

            if (typeof window !== 'undefined' && window.SillyTavern && typeof window.SillyTavern.substituteParams === 'function') {
                // 使用SillyTavern的标准变量替换函数
                const testPrompt = "{{user}} {{char}}";
                const replaced = window.SillyTavern.substituteParams(testPrompt);

                // 解析替换后的结果
                const parts = replaced.split(' ');
                if (parts.length >= 2) {
                    const userName = parts[0] || "用户";
                    const charName = parts[1] || "角色";

                    debugLog("变量替换器: 通过SillyTavern标准变量替换获取用户和角色名称");
                    return {
                        userName,
                        charName
                    };
                }
            }
        } catch (substituteError) {
            debugLog("变量替换器: SillyTavern标准变量替换失败", substituteError);
        }

        // 方法4: 尝试使用Slash命令解析
        try {
            debugLog("变量替换器: 尝试使用Slash命令解析变量");

            // 使用executeSlashCommand方法（如果存在）
            if (typeof executeSlashCommand === 'function') {
                const userName = executeSlashCommand('/pass {{user}}');
                const charName = executeSlashCommand('/pass {{char}}');

                if (userName && charName) {
                    debugLog("变量替换器: 通过Slash命令成功获取用户和角色名称");
                    return {
                        userName: userName.trim(),
                        charName: charName.trim()
                    };
                }
            }
        } catch (slashError) {
            debugLog("变量替换器: Slash命令解析失败", slashError);
        }

        // 方法5: 最后尝试使用变量系统
        try {
            debugLog("变量替换器: 尝试使用变量系统");

            if (typeof getVariables === 'function') {
                const variables = getVariables();
                if (variables) {
                    const userName = variables.user || variables.name1 || "用户";
                    const charName = variables.char || variables.name2 || "角色";

                    debugLog("变量替换器: 通过变量系统获取用户和角色名称");
                    return {
                        userName,
                        charName
                    };
                }
            }
        } catch (varError) {
            debugLog("变量替换器: 变量系统调用失败", varError);
        }

        // 如果所有方法都失败，返回默认值
        debugLog("变量替换器: 所有方法失败，使用默认值");
        return {
            userName: "用户",
            charName: "角色"
        };

    } catch (error) {
        errorLog("变量替换器: 获取用户和角色名称失败", error);
        return {
            userName: "用户",
            charName: "角色"
        };
    }
}

/**
 * 替换提示词中的变量（改用 ST 官方宏展开 substituteParams）。
 * 2026-08-18：此前自行实现 {{user}}/{{char}} 简易替换（以为无法用 ST 宏展开），
 * 现确认 script.js 导出 substituteParams 可在父窗口调用，改用 ST 全套宏展开
 * （{{user}}/{{char}}/{{time}}/自定义宏等全部生效）。
 * @param {string} prompt 原始提示词
 * @returns {string} 替换后的提示词
 */
export function replaceVariables(prompt) {
    try {
        if (!prompt || typeof prompt !== 'string') {
            return prompt || "";
        }
        // 走 ST 官方宏展开（substituteParams 依赖 getContext，父窗口可用）
        return substituteParams(prompt);
    } catch (error) {
        errorLog("变量替换器: 替换变量失败", error);
        return prompt; // 出错时返回原始提示词
    }
}

/**
 * 通用提示词宏展开（2026-08-18 新增；2026-08-21 自有宏改名为 {{ccore_msg_module}} 并改为管线现算）：
 * 先展开「自家自定义宏」，再交给 ST 全套宏展开。
 * 目前自家宏：{{ccore_msg_module}} → 指定楼层 mesId 的模块数据（经注入的解析器现算，与
 * {{CONTINUITY_MSG_MODULE_X}} 同源管线）。未注入解析器时回退为空（保持兼容）。
 * 用于提示词组/弹窗等生成的 quietPrompt——使其既支持模块宏又支持 ST 标准宏
 * （{{user}}/{{char}}/{{time}} 等），且不依赖 ST 组装路径（组装失败自建数组时同样生效）。
 * @param {string} text 原始提示词
 * @param {number} mesId 目标楼层（{{ccore_msg_module}} 注入用）
 * @returns {string}
 */
export function expandPrompts(text, mesId) {
    if (!text || typeof text !== 'string') return text;
    // 1. 自家宏
    let out = text;
    if (out.includes('{{ccore_msg_module}}')) {
        try {
            let moduleData = '';
            if (msgModuleResolver) {
                moduleData = msgModuleResolver(mesId) || '';
            } else {
                debugLog('变量替换器: {{ccore_msg_module}} 解析器未注入，跳过（生成期模块宏需经 moduleAiGenerator 注册）');
            }
            out = out.split('{{ccore_msg_module}}').join(moduleData);
            debugLog(`变量替换器: {{ccore_msg_module}} → ${moduleData.length} 字符（楼层 ${mesId}）`);
        } catch (e) {
            debugLog("变量替换器: {{ccore_msg_module}} 展开失败", e);
        }
    }
    // 2. ST 全套宏
    try {
        return substituteParams(out);
    } catch (e) {
        errorLog("变量替换器: ST 宏展开失败", e);
        return out;
    }
}

/**
 * 批量替换多个提示词中的变量
 * @param {string[]} prompts 提示词数组
 * @returns {string[]} 替换后的提示词数组
 */
export function replaceVariablesBatch(prompts) {
    try {
        debugLog("变量替换器: 开始批量替换变量");

        if (!Array.isArray(prompts)) {
            debugLog("变量替换器: 输入不是数组，返回空数组");
            return [];
        }

        // 获取用户和角色名称（只获取一次，提高性能）
        const { userName, charName } = getUserAndCharNames();

        debugLog(`变量替换器: 批量替换 - 用户: ${userName}, 角色: ${charName}`);

        const replacedPrompts = prompts.map(prompt => {
            if (!prompt || typeof prompt !== 'string') {
                return prompt || "";
            }

            let replaced = prompt;

            // 替换所有变量格式
            replaced = replaced.replace(/\{\{user\}\}/gi, userName);
            replaced = replaced.replace(/\{\{char\}\}/gi, charName);
            replaced = replaced.replace(/\{\{USER\}\}/gi, userName);
            replaced = replaced.replace(/\{\{CHAR\}\}/gi, charName);

            return replaced;
        });

        debugLog("变量替换器: 批量替换完成");
        return replacedPrompts;

    } catch (error) {
        errorLog("变量替换器: 批量替换变量失败", error);
        return prompts; // 出错时返回原始数组
    }
}

/**
 * 检查提示词中是否包含需要替换的变量
 * @param {string} prompt 提示词
 * @returns {boolean} 是否包含变量
 */
export function hasVariables(prompt) {
    if (!prompt || typeof prompt !== 'string') {
        return false;
    }

    const variablePatterns = [
        /\{\{user\}\}/i,
        /\{\{char\}\}/i,
        /\{\{USER\}\}/i,
        /\{\{CHAR\}\}/i,
        /<user>/i,
        /<char>/i
    ];

    return variablePatterns.some(pattern => pattern.test(prompt));
}


