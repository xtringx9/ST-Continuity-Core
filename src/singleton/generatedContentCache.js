// src/singleton/generatedContentCache.js
// 生成内容内存缓存（模块以外的生成内容，如小剧场、角色心理）
// 在 moduleAiGenerator.generate() 存储成功后写入，promptInjector 注入时同步读取
// 生命周期：页面刷新丢失（与 moduleCacheManager 一致），CHAT_CHANGED 时清空

import { debugLog } from '../utils/logger.js';

const LOG_TAG = 'GeneratedContentCache';

// mesId -> Map<generatorName, text>
const cache = new Map();

export const generatedContentCache = {
    /**
     * 写入生成内容
     * @param {number} mesId
     * @param {string} generatorName - 'modules' 或 generator.name
     * @param {string} text - 生成内容文本
     */
    set(mesId, generatorName, text) {
        if (!cache.has(mesId)) cache.set(mesId, new Map());
        cache.get(mesId).set(generatorName, text);
        debugLog(LOG_TAG, `写入: mesId=${mesId}, key=${generatorName}, 长度=${text?.length || 0}`);
    },

    /**
     * 读取单条消息的某个生成内容
     * @param {number} mesId
     * @param {string} generatorName
     * @returns {string}
     */
    get(mesId, generatorName) {
        return cache.get(mesId)?.get(generatorName) || '';
    },

    /**
     * 获取最近 N 条消息的所有生成内容（按 mesId 升序）
     * @param {number} count - 最近多少条消息
     * @returns {Array<{mesId: number, name: string, text: string}>}
     */
    getRecent(count) {
        const result = [];
        const sortedMesIds = [...cache.keys()].sort((a, b) => a - b);
        const recent = sortedMesIds.slice(-count);
        for (const mesId of recent) {
            const genMap = cache.get(mesId);
            for (const [name, text] of genMap) {
                if (text) result.push({ mesId, name, text });
            }
        }
        return result;
    },

    /**
     * 清空缓存（CHAT_CHANGED 时调用）
     */
    clear() {
        cache.clear();
        debugLog(LOG_TAG, '缓存已清空');
    },

    /**
     * 删除某条消息的缓存
     * @param {number} mesId
     */
    delete(mesId) {
        cache.delete(mesId);
    },
};

export default generatedContentCache;
