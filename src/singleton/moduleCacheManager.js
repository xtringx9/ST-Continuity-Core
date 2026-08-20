import configManager from "./configManager.js";
import { chat, chat_metadata, saveSettingsDebounced } from "../../../../../../script.js";
import { getContext, extension_settings } from "../../../../../extensions.js";
import { errorLog, debugLog } from "../utils/logger.js";
import { runModulePipeline } from "../core/pipeline/runModulePipeline.js";

// Tier 2：缓存更新防抖状态（模块级单例状态）
const CACHE_DEBOUNCE_MS = 80;
let _cacheUpdateTimer = null;
let _cacheUpdatePendingForce = false;

class ModuleCacheManager {
    constructor() {
        // 使用嵌套Map结构存储缓存数据
        // 第一层：chat_id_hash -> Map
        // 第二层：messageIndex范围 -> 缓存数据
        this.cache = new Map();
        this.charWorldBookCache = new Map();

        debugLog("[Module Cache]ModuleCacheManager 初始化完成");
    }

    /**
     * 实际执行缓存重建（双范围写）。
     * 优化：末条是用户消息时，0-endIndex 与 0-null 范围相同，只提取一次、写两个键，
     * 省一次全量提取。末条是 AI 消息时两范围不同，仍提取两次。
     */
    _doUpdateModuleCache(isForce) {
        if (!configManager.isLoaded) return;
        if (!chat || chat.length < 1) return;

        const lastMsg = chat[chat.length - 1];
        const isUserMessage = lastMsg.is_user !== undefined ? lastMsg.is_user : lastMsg.role === 'user';
        const endIndex = chat.length - 1 - (isUserMessage ? 0 : 1);
        const lastIdx = chat.length - 1;

        // 第一次提取（0-endIndex），runModulePipeline 内部会写 0-endIndex 缓存键
        const result = runModulePipeline({
            range: { start: 0, end: endIndex },
            modules: null,
            processType: 'auto',
            force: isForce,
            cache: isForce ? 'write' : 'both',
        });

        if (endIndex !== lastIdx) {
            // 末条是 AI 消息：0-null 范围不同，需独立提取
            runModulePipeline({
                range: { start: 0, end: null },
                modules: null,
                processType: 'auto',
                force: isForce,
                cache: isForce ? 'write' : 'both',
            });
        } else {
            // 末条是用户消息：0-endIndex === 0-null，复用第一次结果写 0-null 键
            moduleCacheManager.setCurrentChatData(0, null, result);
        }

        debugLog("[Module Cache]updateModuleCache 执行完成, isForce:", isForce);
    }

    /**
     * 立即刷新缓存（同步）。
     * 用于必须在同步读（宏 PROMPT_READY）前保证缓存新鲜的场景：CHAT_CHANGED / MESSAGE_SENT。
     * 会合并并消费已排队的 debounce 请求（force 取并集）。
     */
    updateModuleCacheImmediate(isForce) {
        if (_cacheUpdateTimer !== null) {
            if (isForce) _cacheUpdatePendingForce = true;
            isForce = _cacheUpdatePendingForce;
            _cacheUpdatePendingForce = false;
            clearTimeout(_cacheUpdateTimer);
            _cacheUpdateTimer = null;
        }
        moduleCacheManager._doUpdateModuleCache(isForce);
    }

    /**
     * 防抖刷新缓存（80ms 合并 + force 取并集）。
     * 用于 burst 事件（RECEIVED+RENDERED、EDITED+UPDATED 等），无同步读约束。
     */
    updateModuleCacheDebounced(isForce) {
        if (!configManager.isLoaded) return;
        if (!chat || chat.length < 1) return;
        if (isForce) _cacheUpdatePendingForce = true;
        if (_cacheUpdateTimer !== null) return;
        _cacheUpdateTimer = setTimeout(() => {
            const force = _cacheUpdatePendingForce;
            _cacheUpdatePendingForce = false;
            _cacheUpdateTimer = null;
            moduleCacheManager._doUpdateModuleCache(force);
        }, CACHE_DEBOUNCE_MS);
    }

    /** @deprecated 用 updateModuleCacheDebounced/Immediate */
    updateModuleCache(isForce) {
        moduleCacheManager.updateModuleCacheDebounced(isForce);
    }

    /** @deprecated */
    updateModuleCacheNoForce() {
        moduleCacheManager.updateModuleCacheDebounced(false);
    }

    /** @deprecated */
    updateModuleCacheForce() {
        moduleCacheManager.updateModuleCacheDebounced(true);
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
        return getContext().chatId + '_' + chat_metadata?.chat_id_hash || '';
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
        let haveData = this.hasData(chatIdHash, startIndex, endIndex);
        if (!this.cache.has(chatIdHash)) {
            this.cache.set(chatIdHash, new Map());
        }

        const chatCache = this.cache.get(chatIdHash);
        const rangeKey = this.generateRangeKey(startIndex, endIndex);

        // 清理同 startIndex 下过期的数字 rangeKey(单聊天内累积主因)
        // endIndex 为 null 的是全量缓存,set 会自动覆盖旧值,无需额外清理
        // 保留 updateModuleCache 两次写入的 0-N 和 0-null 各一份
        if (endIndex !== null && endIndex !== undefined) {
            const prefix = `${startIndex}-`;
            for (const existingKey of Array.from(chatCache.keys())) {
                if (existingKey.startsWith(prefix) && existingKey !== rangeKey && !existingKey.endsWith('-null')) {
                    chatCache.delete(existingKey);
                }
            }
        }

        chatCache.set(rangeKey, data);
        debugLog(`[Module Cache]${haveData ? '更新缓存' : '存入缓存'},缓存数据已设置：chatIdHash=${chatIdHash}, range=${rangeKey}`, data);
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
        debugLog("[Module Cache]打印当前缓存数据:", moduleCacheManager.cache, moduleCacheManager.charWorldBookCache);
    }
}

// 创建单例实例
const moduleCacheManager = new ModuleCacheManager();
export default moduleCacheManager;
