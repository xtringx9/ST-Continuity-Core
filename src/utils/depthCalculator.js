/**
 * 深度计算工具 - 提供聊天深度计算功能
 * 用于消息格式化和提示词格式化模块共享
 */
import { warnLog } from './logger.js';

export class DepthCalculator {
    /**
     * 计算聊天深度
     * @returns {number} 当前聊天的深度
     */
    static calculateChatDepth() {
        try {
            // 获取当前聊天中的所有消息
            const messages = this.getCurrentChatMessages();
            if (!messages || !Array.isArray(messages)) return 0;

            // 深度基于当前消息数量计算
            return Math.max(0, messages.length);
        } catch (error) {
            warnLog('DepthCalculator: 深度计算失败，使用默认深度0', error);
            return 0;
        }
    }

    /**
     * 计算特定消息的深度
     * @param {string} messageId - 消息ID
     * @returns {number} 消息在聊天记录中的深度
     */
    static calculateMessageDepth(messageId) {
        try {
            // 获取当前聊天中的所有消息
            const messages = this.getCurrentChatMessages();
            if (!messages || !Array.isArray(messages)) return 0;

            // 查找当前消息在数组中的位置
            const messageIndex = messages.findIndex(msg => msg.id === messageId);
            if (messageIndex === -1) return 0;

            // 深度 = 总消息数 - 当前索引 - 1
            return Math.max(0, messages.length - messageIndex - 1);
        } catch (error) {
            warnLog('DepthCalculator: 消息深度计算失败，使用默认深度0', error);
            return 0;
        }
    }

    /**
     * 获取当前聊天消息
     * @returns {Array} 当前聊天的消息数组
     */
    static getCurrentChatMessages() {
        // 尝试从SillyTavern全局变量获取消息
        if (typeof chat !== 'undefined' && chat.length) {
            return chat;
        }

        // 备用方法：从DOM中解析消息
        const messageElements = document.querySelectorAll('[data-message-id]');
        return Array.from(messageElements).map(el => ({
            id: el.getAttribute('data-message-id'),
            // 其他消息属性可以根据需要添加
        }));
    }

    /**
     * 获取当前聊天深度（便捷方法）
     * @returns {number} 当前聊天的深度
     */
    static getDepth() {
        return this.calculateChatDepth();
    }

    /**
     * 获取消息深度（便捷方法）
     * @param {string} messageId - 消息ID
     * @returns {number} 消息在聊天记录中的深度
     */
    static getMessageDepth(messageId) {
        return this.calculateMessageDepth(messageId);
    }
}

// 导出单例实例
const depthCalculator = new DepthCalculator();
export default depthCalculator;