import { configManager, chat, processModuleData, chat_metadata, getContext, extension_settings, saveSettingsDebounced, infoLog, errorLog, debugLog } from "../index.js";
class ModuleCacheManager {
    constructor() {
        // 使用嵌套Map结构存储缓存数据
        // 第一层：chat_id_hash -> Map
        // 第二层：messageIndex范围 -> 缓存数据
        this.cache = new Map();
        this.charWorldBookCache = new Map();

        console.log("[Module Cache]ModuleCacheManager 初始化完成");
    }

    updateModuleCache(isForce) {
        if (!configManager.isLoaded) return;
        if (!chat || chat.length < 1) return;
        // debugLog("[Module Cache]updateModuleCache 开始执行, isForce: ", isForce);
        const isUserMessage = chat[chat.length - 1].is_user !== undefined ? chat[chat.length - 1].is_user : chat[chat.length - 1].role === 'user';
        const endIndex = chat.length - 1 - (isUserMessage ? 0 : 1);

        const extractParams = {
            startIndex: 0,
            endIndex: endIndex,
            moduleFilters: null
        };
        processModuleData(
            extractParams,
            'auto',
            undefined,
            isForce
        );
        extractParams.endIndex = null;
        processModuleData(
            extractParams,
            'auto',
            undefined,
            isForce
        );
        infoLog("[Module Cache]updateModuleCache 执行完成, isForce:", isForce, this.cache);
    }

    updateModuleCacheNoForce() {
        moduleCacheManager.updateModuleCache(false);
    }

    updateModuleCacheForce() {
        moduleCacheManager.updateModuleCache(true);
    }

    /**
     * 生成messageIndex范围的键名
     * @param {number} startIndex 起始索引
     * @param {number} endIndex 结束索引
     * @returns {string} 范围键名
     */
    generateRangeKey(startIndex, endIndex) {
        return `${startIndex}-${endIndex}`;
    }

    /**
     * 获取当前聊天的chat_id_hash
     * @returns {string|number} 当前聊天的chat_id_hash
     */
    getCurrentChatIdHash() {
        return chat_metadata?.chat_id_hash || '';
    }

    /**
     * 检查数据是否已存在
     * @param {string} chatIdHash 聊天ID哈希
     * @param {number} startIndex 起始索引
     * @param {number} endIndex 结束索引
     * @returns {boolean} 是否存在
     */
    hasData(chatIdHash, startIndex, endIndex) {
        if (!this.cache.has(chatIdHash)) {
            return false;
        }

        const chatCache = this.cache.get(chatIdHash);
        const rangeKey = this.generateRangeKey(startIndex, endIndex);

        return chatCache.has(rangeKey);
    }

    /**
     * 检查当前聊天数据是否已存在（便捷方法）
     * @param {number} startIndex 起始索引
     * @param {number} endIndex 结束索引
     * @returns {boolean} 是否存在
     */
    hasCurrentChatData(startIndex, endIndex) {
        const chatIdHash = this.getCurrentChatIdHash();
        return this.hasData(chatIdHash, startIndex, endIndex);
    }

    /**
     * 获取缓存数据
     * @param {string} chatIdHash 聊天ID哈希
     * @param {number} startIndex 起始索引
     * @param {number} endIndex 结束索引
     * @returns {*} 缓存数据，如果不存在则返回undefined
     */
    getData(chatIdHash, startIndex, endIndex) {
        if (!this.hasData(chatIdHash, startIndex, endIndex)) {
            return undefined;
        }

        const chatCache = this.cache.get(chatIdHash);
        const rangeKey = this.generateRangeKey(startIndex, endIndex);

        return chatCache.get(rangeKey);
    }

    /**
     * 获取当前聊天缓存数据（便捷方法）
     * @param {number} startIndex 起始索引
     * @param {number} endIndex 结束索引
     * @returns {*} 缓存数据，如果不存在则返回undefined
     */
    getCurrentChatData(startIndex, endIndex) {
        const chatIdHash = this.getCurrentChatIdHash();
        return this.getData(chatIdHash, startIndex, endIndex);
    }

    /**
     * 设置缓存数据
     * @param {string} chatIdHash 聊天ID哈希
     * @param {number} startIndex 起始索引
     * @param {number} endIndex 结束索引
     * @param {*} data 要缓存的数据
     */
    setData(chatIdHash, startIndex, endIndex, data) {
        if (!this.cache.has(chatIdHash)) {
            this.cache.set(chatIdHash, new Map());
        }

        const chatCache = this.cache.get(chatIdHash);
        const rangeKey = this.generateRangeKey(startIndex, endIndex);

        chatCache.set(rangeKey, data);
        debugLog(`[Module Cache]缓存数据已设置：chatIdHash=${chatIdHash}, range=${rangeKey}`);
    }

    /**
     * 设置当前聊天缓存数据（便捷方法）
     * @param {number} startIndex 起始索引
     * @param {number} endIndex 结束索引
     * @param {*} data 要缓存的数据
     */
    setCurrentChatData(startIndex, endIndex, data) {
        const chatIdHash = this.getCurrentChatIdHash();
        this.setData(chatIdHash, startIndex, endIndex, data);
    }

    /**
     * 删除缓存数据
     * @param {string} chatIdHash 聊天ID哈希
     * @param {number} startIndex 起始索引
     * @param {number} endIndex 结束索引
     * @returns {boolean} 是否成功删除
     */
    deleteData(chatIdHash, startIndex, endIndex) {
        if (!this.hasData(chatIdHash, startIndex, endIndex)) {
            return false;
        }

        const chatCache = this.cache.get(chatIdHash);
        const rangeKey = this.generateRangeKey(startIndex, endIndex);

        const result = chatCache.delete(rangeKey);

        // 如果chatCache为空，删除整个chatIdHash的缓存
        if (chatCache.size === 0) {
            this.cache.delete(chatIdHash);
        }

        debugLog(`[Module Cache]缓存数据已删除：chatIdHash=${chatIdHash}, range=${rangeKey}`);
        return result;
    }

    /**
     * 删除当前聊天缓存数据（便捷方法）
     * @param {number} startIndex 起始索引
     * @param {number} endIndex 结束索引
     * @returns {boolean} 是否成功删除
     */
    deleteCurrentChatData(startIndex, endIndex) {
        const chatIdHash = this.getCurrentChatIdHash();
        return this.deleteData(chatIdHash, startIndex, endIndex);
    }

    /**
     * 清除指定聊天ID的所有缓存
     * @param {string} chatIdHash 聊天ID哈希
     */
    clearChatCache(chatIdHash) {
        if (this.cache.has(chatIdHash)) {
            this.cache.delete(chatIdHash);
            debugLog(`[Module Cache]已清除聊天缓存：chatIdHash=${chatIdHash}`);
        }
    }

    /**
     * 清除所有缓存
     */
    clearAllCache() {
        this.cache.clear();
        debugLog("[Module Cache]已清除所有缓存数据");
    }

    /**
     * 获取缓存统计信息
     * @returns {Object} 缓存统计信息
     */
    getCacheStats() {
        let totalEntries = 0;
        const chatStats = {};

        for (const [chatIdHash, chatCache] of this.cache) {
            const entryCount = chatCache.size;
            chatStats[chatIdHash] = entryCount;
            totalEntries += entryCount;
        }

        return {
            totalChats: this.cache.size,
            totalEntries: totalEntries,
            chatStats: chatStats
        };
    }


    outputCache() {
        infoLog("[Module Cache]打印当前缓存数据:", moduleCacheManager.cache, moduleCacheManager.charWorldBookCache);
    }
}

// 创建单例实例
const moduleCacheManager = new ModuleCacheManager();
export default moduleCacheManager;
