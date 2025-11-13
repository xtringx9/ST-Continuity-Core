// 提示词注入管理器
import { extension_settings, extensionName, chat } from "../index.js";
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
                this.injectionEnabled = settings.enabled || false;
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
        return this.injectionEnabled && this.injectionDepth >= 0;
    }

    /**
     * 生成要注入的提示词对象
     * @returns {Object} 提示词对象
     */
    generateInjectionPrompt() {
        try {
            const promptContent = generateFormalPrompt();

            return {
                depth: this.injectionDepth,
                role: this.injectionRole,
                content: promptContent
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

            // 根据st-memory-enhancement的注入逻辑
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
            debugLog('原始事件数据:', eventData);

            // 检查是否应该注入
            if (!this.shouldInject()) {
                debugLog('提示词注入已禁用，跳过注入');
                return; // 不返回值，让事件系统自动处理
            }

            // 重新加载UI控件设置（确保使用最新设置）
            this.loadUIControls();

            // 生成要注入的提示词
            const promptObject = this.generateInjectionPrompt();
            if (!promptObject) {
                errorLog('无法生成提示词对象，跳过注入');
                return; // 不返回值，让事件系统自动处理
            }

            debugLog('生成的提示词对象:', promptObject);

            // 检查聊天数组是否存在
            if (!eventData.chat || !Array.isArray(eventData.chat)) {
                errorLog('聊天数组不存在或格式错误，跳过注入');
                return; // 不返回值，让事件系统自动处理
            }

            debugLog('原始聊天数组长度:', eventData.chat.length);
            debugLog('原始聊天数组内容:', eventData.chat);

            // 按照st-memory-enhancement的方式直接修改eventData.chat数组
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
            // 关键修复：不返回值，让SillyTavern事件系统自动处理修改后的eventData
        } catch (error) {
            errorLog('处理聊天完成前提示词注入失败:', error);
            // 出错时也不返回值
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
     * 销毁注入管理器
     */
    destroy() {
        try {
            this.injectionEnabled = false;
            this.isInitialized = false;
            debugLog('提示词注入管理器已销毁');
        } catch (error) {
            errorLog('销毁提示词注入管理器失败:', error);
        }
    }
}


