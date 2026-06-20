// 提示词注入管理器
import { extension_settings } from "../../../../../extensions.js";
import { extensionName } from '../singleton/configManager.js';
import configManager from '../singleton/configManager.js';
import generatedContentCache from '../singleton/generatedContentCache.js';
import { chat } from '../../../../../../script.js';
import { debugLog, errorLog, infoLog } from "../utils/logger.js";
import { generateFormalPrompt } from "../modules/promptGenerator.js";

/**
 * 提示词注入管理器类
 */
export class PromptInjector {
    constructor() {
        this.injectionEnabled = false;
        this.injectionDepth = 1;
        this.injectionRole = 'system';
        this.isInitialized = false;
        // 不在构造函数中自动初始化
    }

    /**
     * 初始化注入管理器
     */
    initialize() {
        try {
            if (this.isInitialized) {
                debugLog('提示词注入管理器已经初始化');
                return;
            }

            // 从扩展设置获取注入配置
            const settings = extension_settings[extensionName];
            if (settings) {
                // 不再缓存enabled状态，每次都从设置中获取
                // 从UI控件获取深度和角色设置
                this.loadUIControls();
            }

            this.isInitialized = true;
            debugLog('提示词注入管理器初始化完成');
        } catch (error) {
            errorLog('提示词注入管理器初始化失败:', error);
        }
    }

    /**
     * 从UI控件加载注入设置
     */
    loadUIControls() {
        try {
            // 获取插入深度设置
            const depthInput = document.getElementById('insertion-depth');
            if (depthInput) {
                this.injectionDepth = parseInt(depthInput.value) || 1;
            }

            // 获取插入角色设置
            const roleSelect = document.getElementById('insertion-role');
            if (roleSelect) {
                this.injectionRole = roleSelect.value || 'system';
            }

            debugLog(`加载UI控件设置: 深度=${this.injectionDepth}, 角色=${this.injectionRole}`);
        } catch (error) {
            errorLog('加载UI控件设置失败:', error);
        }
    }

    /**
     * 检查是否应该注入提示词
     * @returns {boolean} 是否应该注入
     */
    shouldInject() {
        // 获取当前设置（每次都重新获取，确保使用最新设置）
        const settings = extension_settings[extensionName];
        const autoInject = settings?.autoInject !== false; // 默认为true
        const enabled = settings?.enabled || false;

        return enabled && this.injectionDepth >= 0 && autoInject;
    }

    /**
     * 生成要注入的提示词对象
     * 模块提示词 + 生成内容（小剧场、角色心理等）
     * @returns {Object} 提示词对象
     */
    generateInjectionPrompt() {
        try {
            const modulePrompt = generateFormalPrompt();
            const generatedContentPrompt = generateGeneratedContentPrompt();

            // 合并模块提示词和生成内容
            let content = modulePrompt;
            if (generatedContentPrompt) {
                content = content ? `${content}\n\n${generatedContentPrompt}` : generatedContentPrompt;
            }

            return {
                depth: this.injectionDepth,
                role: this.injectionRole,
                content: content
            };
        } catch (error) {
            errorLog('生成注入提示词失败:', error);
            return null;
        }
    }

    /**
     * 根据深度将提示词注入到聊天数组中
     * @param {Array} chatArray 聊天数组
     * @param {Object} promptObject 提示词对象
     * @returns {Array} 注入后的聊天数组
     */
    injectPromptToChat(chatArray, promptObject) {
        try {
            if (!chatArray || !promptObject) {
                return chatArray;
            }

            const { depth, role, content } = promptObject;
            const injectionMessage = {
                role: role,
                content: content
            };

            // 创建聊天数组的副本以避免修改原始引用
            const chatCopy = [...chatArray];

            // 根据注入深度将提示词插入到聊天数组中
            if (depth === 0) {
                // 深度0：插入到最后一条消息之后
                chatCopy.push(injectionMessage);
            } else {
                // 深度>0：插入到指定位置
                const insertIndex = Math.max(0, chatCopy.length - depth);
                chatCopy.splice(insertIndex, 0, injectionMessage);
            }

            debugLog(`提示词注入成功: 深度=${depth}, 角色=${role}, 位置=${depth === 0 ? '最后' : `倒数第${depth}条之前`}`);
            return chatCopy;
        } catch (error) {
            errorLog('提示词注入失败:', error);
            return chatArray;
        }
    }

    /**
     * 处理聊天完成前的提示词注入
     * @param {Object} eventData 事件数据
     * @returns {Object} 处理后的事件数据
     */
    onChatCompletionPromptReady(eventData) {
        try {
            debugLog('收到CHAT_COMPLETION_PROMPT_READY事件，开始处理提示词注入');
            // debugLog('原始事件数据:', eventData);

            // 检查是否应该注入
            if (!this.shouldInject()) {
                debugLog('提示词注入已禁用，跳过注入');
                return eventData; // 返回原始数据
            }

            // 重新加载UI控件设置（确保使用最新设置）
            this.loadUIControls();

            // 生成要注入的提示词
            const promptObject = this.generateInjectionPrompt();
            if (!promptObject) {
                errorLog('无法生成提示词对象，跳过注入');
                return eventData; // 返回原始数据
            }

            debugLog('生成的提示词对象:', promptObject);

            // 检查聊天数组是否存在
            if (!eventData.chat || !Array.isArray(eventData.chat)) {
                errorLog('聊天数组不存在或格式错误，跳过注入');
                return eventData; // 返回原始数据
            }

            debugLog('原始聊天数组长度:', eventData.chat.length);
            debugLog('原始聊天数组内容:', eventData.chat);

            // 直接修改eventData.chat数组
            const { depth, role, content } = promptObject;
            const injectionMessage = {
                role: role,
                content: content
            };

            // 直接修改eventData.chat数组（不创建副本）
            if (depth === 0) {
                // 深度0：插入到最后一条消息之后
                eventData.chat.push(injectionMessage);
            } else {
                // 深度>0：插入到指定位置
                const insertIndex = Math.max(0, eventData.chat.length - depth);
                eventData.chat.splice(insertIndex, 0, injectionMessage);
            }

            debugLog('注入后的聊天数组长度:', eventData.chat.length);
            debugLog('注入后的聊天数组内容:', eventData.chat);

            infoLog(`提示词注入完成: 深度=${promptObject.depth}, 角色=${promptObject.role}, 聊天数组长度=${eventData.chat.length}`);

            // 关键修复：返回修改后的事件数据
            return eventData;
        } catch (error) {
            errorLog('处理聊天完成前提示词注入失败:', error);
            // 出错时返回原始数据
            return eventData;
        }
    }

    /**
     * 更新注入设置
     * @param {boolean} enabled 是否启用
     * @param {number} depth 注入深度
     * @param {string} role 注入角色
     */
    updateSettings(enabled, depth, role) {
        this.injectionEnabled = enabled;
        this.injectionDepth = depth;
        this.injectionRole = role;

        debugLog(`注入设置已更新: 启用=${enabled}, 深度=${depth}, 角色=${role}`);
    }

    /**
     * 重置注入状态（用于新的请求）
     */
    resetInjectionState() {
        this.hasInjectedForCurrentRequest = false;
        debugLog('提示词注入状态已重置，可以接受新的注入请求');
    }

    /**
     * 停止注入管理器功能
     * 不销毁实例，只停止功能，事件监听器仍然存在
     */
    destroy() {
        try {
            this.injectionEnabled = false;
            this.hasInjectedForCurrentRequest = false;
            debugLog('提示词注入管理器功能已停止（实例仍存在）');
        } catch (error) {
            errorLog('停止提示词注入管理器功能失败:', error);
        }
    }
}

/**
 * 生成生成内容提示词（小剧场、角色心理等）
 * 从 generatedContentCache 读取最近 N 条消息的生成内容，按 generator 分组构建
 * 空内容不注入
 * @returns {string} 生成内容提示词，无内容时返回空字符串
 */
function generateGeneratedContentPrompt() {
    try {
        // 获取启用的 generators
        const generators = configManager.getGenerators();
        if (generators.length === 0) return '';

        // 从缓存读取最近 5 条消息的生成内容
        const recentContents = generatedContentCache.getRecent(5);
        if (recentContents.length === 0) return '';

        // 按 generator name 分组
        const grouped = new Map(); // name -> [{mesId, text}]
        for (const item of recentContents) {
            if (!grouped.has(item.name)) grouped.set(item.name, []);
            grouped.get(item.name).push(item);
        }

        // 按 generators 配置顺序构建文本
        const sections = [];
        for (const gen of generators) {
            const items = grouped.get(gen.name);
            if (!items || items.length === 0) continue;

            const lines = [`--- ${gen.displayName} ---`];
            for (const item of items) {
                lines.push(`[楼层${item.mesId}]`);
                lines.push(item.text);
            }
            sections.push(lines.join('\n'));
        }

        if (sections.length === 0) return '';
        return `=== 生成内容 ===\n\n${sections.join('\n\n')}`;
    } catch (error) {
        errorLog('生成生成内容提示词失败:', error);
        return '';
    }
}


