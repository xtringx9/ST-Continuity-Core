// 事件处理器 - 处理SillyTavern扩展事件
import { extension_settings, extensionName, promptInjector } from "../index.js";
import { debugLog, errorLog, infoLog } from "../utils/logger.js";

// 获取SillyTavern上下文
const { eventSource, event_types } = SillyTavern.getContext();

/**
 * 事件处理器类
 */
export class EventHandler {
    constructor() {
        this.isInitialized = false;
        this.eventHandlers = new Map();
    }

    /**
     * 初始化事件处理器
     */
    initialize() {
        try {
            if (this.isInitialized) {
                debugLog('事件处理器已经初始化');
                return;
            }

            // 注册事件处理器
            this.registerEventHandlers();

            this.isInitialized = true;
            infoLog('事件处理器初始化完成');
        } catch (error) {
            errorLog('事件处理器初始化失败:', error);
        }
    }

    /**
     * 注册事件处理器
     */
    registerEventHandlers() {
        try {
            // 注册聊天完成前提示词准备事件
            this.registerChatCompletionPromptReady();

            // 注册设置变更事件
            this.registerSettingsChangeHandlers();

            debugLog('事件处理器注册完成');
        } catch (error) {
            errorLog('注册事件处理器失败:', error);
        }
    }

    /**
     * 注册聊天完成前提示词准备事件
     */
    registerChatCompletionPromptReady() {
        try {
            debugLog('开始注册chatCompletionPromptReady事件处理器');
            
            // 检查是否已经注册过
            if (this.eventHandlers.has('chatCompletionPromptReady')) {
                debugLog('chatCompletionPromptReady事件处理器已存在');
                return;
            }

            // 创建事件处理器
            const handler = async (eventData) => {
                try {
                    debugLog('chatCompletionPromptReady事件处理器被调用');
                    debugLog('原始事件数据:', eventData);

                    // 检查扩展是否启用
                    const settings = extension_settings[extensionName];
                    if (!settings || !settings.enabled) {
                        debugLog('扩展未启用，跳过处理');
                        return; // 不返回值，让事件系统自动处理
                    }

                    // 调用提示词注入器处理事件（注入器内部会直接修改eventData）
                    await promptInjector.onChatCompletionPromptReady(eventData);

                    debugLog('提示词注入器处理完成，eventData已被直接修改');
                    // 关键修复：不返回值，让SillyTavern事件系统自动处理修改后的eventData
                } catch (error) {
                    errorLog('处理chatCompletionPromptReady事件失败:', error);
                    // 出错时也不返回值
                }
            };

            // 注册到SillyTavern事件系统
            if (eventSource && eventSource.on) {
                eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handler);
                this.eventHandlers.set('chatCompletionPromptReady', handler);
                infoLog('chatCompletionPromptReady事件处理器注册成功');
                debugLog('事件源信息:', { eventSource: !!eventSource, event_types: event_types });
            } else {
                errorLog('无法注册事件处理器：eventSource不存在');
            }
        } catch (error) {
            errorLog('注册chatCompletionPromptReady事件处理器失败:', error);
        }
    }

    /**
     * 重新注册事件处理器（当全局开关状态变化时调用）
     */
    reinitializeEventHandlers() {
        try {
            // 销毁现有事件处理器
            this.destroy();

            // 重新初始化
            this.initialize();

            debugLog('事件处理器已重新初始化');
        } catch (error) {
            errorLog('重新初始化事件处理器失败:', error);
        }
    }

    /**
     * 注册设置变更事件处理器
     */
    registerSettingsChangeHandlers() {
        try {
            // 监听UI控件变化
            this.bindUIControlEvents();

            debugLog('设置变更事件处理器注册完成');
        } catch (error) {
            errorLog('注册设置变更事件处理器失败:', error);
        }
    }

    /**
     * 绑定UI控件事件
     */
    bindUIControlEvents() {
        try {
            // 使用MutationObserver监听UI控件变化
            this.setupMutationObserver();

            // 立即绑定现有控件
            this.bindExistingControls();

            debugLog('UI控件事件绑定完成');
        } catch (error) {
            errorLog('绑定UI控件事件失败:', error);
        }
    }

    /**
     * 设置MutationObserver监听DOM变化
     */
    setupMutationObserver() {
        try {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        this.bindNewControls(mutation.addedNodes);
                    }
                });
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            debugLog('MutationObserver设置完成');
        } catch (error) {
            errorLog('设置MutationObserver失败:', error);
        }
    }

    /**
     * 绑定现有控件
     */
    bindExistingControls() {
        try {
            // 绑定深度输入框
            const depthInput = document.getElementById('insertion-depth');
            if (depthInput) {
                depthInput.addEventListener('input', this.handleDepthChange.bind(this));
                depthInput.addEventListener('change', this.handleDepthChange.bind(this));
            }

            // 绑定角色选择框
            const roleSelect = document.getElementById('insertion-role');
            if (roleSelect) {
                roleSelect.addEventListener('change', this.handleRoleChange.bind(this));
            }

            debugLog('现有UI控件事件绑定完成');
        } catch (error) {
            errorLog('绑定现有UI控件事件失败:', error);
        }
    }

    /**
     * 绑定新添加的控件
     * @param {NodeList} addedNodes 新添加的节点
     */
    bindNewControls(addedNodes) {
        try {
            addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // 检查是否包含我们的控件
                    const depthInput = node.querySelector ? node.querySelector('#insertion-depth') : null;
                    const roleSelect = node.querySelector ? node.querySelector('#insertion-role') : null;

                    if (depthInput && !depthInput.hasAttribute('data-bound')) {
                        depthInput.addEventListener('input', this.handleDepthChange.bind(this));
                        depthInput.addEventListener('change', this.handleDepthChange.bind(this));
                        depthInput.setAttribute('data-bound', 'true');
                    }

                    if (roleSelect && !roleSelect.hasAttribute('data-bound')) {
                        roleSelect.addEventListener('change', this.handleRoleChange.bind(this));
                        roleSelect.setAttribute('data-bound', 'true');
                    }
                }
            });
        } catch (error) {
            errorLog('绑定新控件失败:', error);
        }
    }

    /**
     * 处理深度变更
     * @param {Event} event 事件对象
     */
    handleDepthChange(event) {
        try {
            const depth = parseInt(event.target.value) || 1;
            const settings = extension_settings[extensionName];

            if (settings && settings.enabled) {
                promptInjector.updateSettings(true, depth, promptInjector.injectionRole);
                debugLog(`深度设置已更新: ${depth}`);
            }
        } catch (error) {
            errorLog('处理深度变更失败:', error);
        }
    }

    /**
     * 处理角色变更
     * @param {Event} event 事件对象
     */
    handleRoleChange(event) {
        try {
            const role = event.target.value || 'system';
            const settings = extension_settings[extensionName];

            if (settings && settings.enabled) {
                promptInjector.updateSettings(true, promptInjector.injectionDepth, role);
                debugLog(`角色设置已更新: ${role}`);
            }
        } catch (error) {
            errorLog('处理角色变更失败:', error);
        }
    }

    /**
     * 销毁事件处理器
     */
    destroy() {
        try {
            // 移除所有事件监听器
            this.eventHandlers.forEach((handler, eventName) => {
                if (eventSource && eventSource.off) {
                    eventSource.off(eventName, handler);
                }
            });

            this.eventHandlers.clear();
            this.isInitialized = false;

            infoLog('事件处理器已销毁');
        } catch (error) {
            errorLog('销毁事件处理器失败:', error);
        }
    }
}

// 创建全局事件处理器实例
export const eventHandler = new EventHandler();

// 暴露到全局作用域，以便其他模块可以访问
window.continuityEventHandler = eventHandler;
