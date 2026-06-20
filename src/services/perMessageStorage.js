/**
 * perMessageStorage.js
 * 每楼层模块数据存储管理器
 *
 * 目录结构：
 * chats/{safeCharName}/{safeFileName}/
 * ├── meta.json
 * ├── messages/
 * │   ├── 0000-0099.jsonl     ← 每行一个楼层
 * │   ├── 0100-0199.jsonl
 * │   └── ...
 * └── snapshots/
 *     ├── 0000-0099.json      ← key 为快照起始 mesId
 *     ├── 0100-0199.json
 *     └── ...
 */

import {
    getChatStorageDir,
    getMessageBatchPath,
    getSnapshotBatchPath,
    getMetaPath,
    getBatchStart,
} from './storageKeyBuilder.js';

import {
    readContinuityCoreMessage,
    writeContinuityCoreMessage,
    readContinuityCoreMessages,
    readContinuityCoreSnapshot,
    writeContinuityCoreSnapshot,
    readContinuityCoreMeta,
    writeContinuityCoreMeta,
    moveContinuityCoreChat,
    deleteContinuityCoreChat,
    ensureContinuityCoreDir,
} from './continuityCoreServerApi.js';

import { debugLog, errorLog } from '../utils/logger.js';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_SNAPSHOT_INTERVAL = 5;
const SAVE_DEBOUNCE_MS = 1000;

class PerMessageStorageManager {
    constructor() {
        /** @type {Map<string, object>} batch 缓存：batchKey → { lines: Map<mesId, data> } */
        this.messageCache = new Map();

        /** @type {Map<string, object>} 快照缓存：batchKey → { snapshots: object } */
        this.snapshotCache = new Map();

        /** @type {object|null} 当前聊天信息 */
        this.currentChat = null;

        /** @type {number} */
        this.batchSize = DEFAULT_BATCH_SIZE;

        /** @type {number} */
        this.snapshotInterval = DEFAULT_SNAPSHOT_INTERVAL;

        /** @type {Set<string>} 脏标记的 batch key */
        this.dirtyBatches = new Set();

        /** @type {number|null} 防抖定时器 */
        this.saveTimer = null;

        /** @type {object|null} meta 缓存 */
        this.metaCache = null;
    }

    // ==========================================
    // 初始化
    // ==========================================

    /**
     * 初始化当前聊天的存储
     * @param {string} characterName
     * @param {string} chatFileName
     * @param {string} chatIdHash
     */
    async initChat(characterName, chatFileName, chatIdHash) {
        this.currentChat = { characterName, chatFileName, chatIdHash };
        this.messageCache.clear();
        this.snapshotCache.clear();
        this.dirtyBatches.clear();
        this.metaCache = null;

        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }

        // 确保目录存在
        const storageDir = getChatStorageDir(characterName, chatFileName);
        await ensureContinuityCoreDir(`${storageDir}/messages`);
        await ensureContinuityCoreDir(`${storageDir}/snapshots`);

        // 读取或创建 meta
        const metaPath = getMetaPath(characterName, chatFileName);
        const result = await readContinuityCoreMeta(metaPath);

        if (result.success && result.data) {
            this.metaCache = result.data;
            // 如果 chatIdHash 不匹配，说明聊天被替换了
            if (this.metaCache.chatIdHash && this.metaCache.chatIdHash !== chatIdHash) {
                debugLog('PerMessageStorage', `chatIdHash 不匹配，聊天可能已被替换: ${this.metaCache.chatIdHash} → ${chatIdHash}`);
            }
        } else {
            // 创建新的 meta
            this.metaCache = {
                version: '1.0',
                chatIdHash,
                characterName,
                chatFileName,
                storagePath: storageDir,
                totalMessages: 0,
                snapshotInterval: this.snapshotInterval,
                latestSnapshotMesId: -1,
                dirtyFromMesId: null,
                lastUpdated: new Date().toISOString(),
            };
            await writeContinuityCoreMeta(metaPath, this.metaCache);
        }

        debugLog('PerMessageStorage', `初始化完成: ${storageDir}`);
    }

    // ==========================================
    // 单条消息提取
    // ==========================================

    /**
     * 从单条消息文本中提取模块 raw 字符串,合并为单个文本块
     * 新格式:key→value map,modules 是特殊 key,存大段带换行的文本
     * 三层分类逻辑已废弃(moduleExtractor 那边独立处理,与存储无关)
     * @param {string} messageText - 消息原始文本
     * @returns {{ modules: string }} - 所有顶层模块 raw 用 '\n' 连接
     */
    extractMessageModules(messageText) {
        const empty = { modules: '' };

        if (!messageText || typeof messageText !== 'string') return empty;

        // 用栈找所有顶层模块的 raw + 位置
        const topLevelModules = this._findTopLevelModuleRanges(messageText);

        if (topLevelModules.length === 0) return empty;

        // 合并所有顶层模块 raw 为单个文本块
        return { modules: topLevelModules.map(m => m.raw).join('\n') };
    }

    // ==========================================
    // 消息操作
    // ==========================================

    /**
     * 读取指定楼层的模块数据
     * @param {number} mesId
     * @param {number} [swipeId=0]
     * @returns {Promise<object|null>}
     */
    async getMessage(mesId, swipeId = 0) {
        this._ensureInitialized();

        // 先查缓存
        const batchKey = this._getMessageBatchKey(mesId);
        const cached = this.messageCache.get(batchKey);
        if (cached) {
            const msgData = cached.get(mesId);
            if (msgData) {
                return msgData.swipes?.[swipeId] || null;
            }
        }

        // 从服务端读取
        const filePath = getMessageBatchPath(
            this.currentChat.characterName,
            this.currentChat.chatFileName,
            mesId,
            this.batchSize,
        );

        const result = await readContinuityCoreMessage(filePath, mesId, getBatchStart(mesId, this.batchSize));
        if (result.success && result.data) {
            // 更新缓存
            if (!this.messageCache.has(batchKey)) {
                this.messageCache.set(batchKey, new Map());
            }
            this.messageCache.get(batchKey).set(mesId, result.data);
            return result.data.swipes?.[swipeId] || null;
        }

        return null;
    }

    /**
     * 写入楼层的模块数据（upsert 语义）
     * 新格式:swipe 数据是 key→value map,modules 是特殊 key,其他 key = generator.name
     * @param {number} mesId
     * @param {number} activeSwipeId - 写入时 chat[mesId].swipe_id 的值
     * @param {object} swipesData - { "0": { modules: "...", side_scene: "..." }, "1": ... }
     *   如果只传单个 swipe 数据(含 modules 字段或任意 generator key),自动包装为 { [activeSwipeId]: swipesData }
     * @param {object} [options] - 可选配置
     * @param {boolean} [options.merge=false] - 是否与已有 swipes 合并（updateMessage 场景）
     * @param {boolean} [options.skipEmpty=true] - 新数据为空时跳过（不覆盖已有数据）
     */
    async writeMessage(mesId, activeSwipeId, swipesData, { merge = false, skipEmpty = true } = {}) {
        this._ensureInitialized();

        // 兼容：如果传入的是单个 swipe 数据（对象但不含 swipes 嵌套），自动包装
        // 单 swipe 数据特征：含 modules 字段(字符串)或任意 generator key,但不是 { "0": {...}, "1": {...} } 结构
        let swipes;
        if (swipesData && typeof swipesData === 'object' && !this._isSwipesMap(swipesData)) {
            swipes = { [activeSwipeId]: swipesData };
        } else {
            swipes = swipesData;
        }

        const filePath = getMessageBatchPath(
            this.currentChat.characterName,
            this.currentChat.chatFileName,
            mesId,
            this.batchSize,
        );
        const batchStart = getBatchStart(mesId, this.batchSize);

        // 读取已有数据（合并模式或空值保护需要）
        let existingData = null;
        if (merge || skipEmpty) {
            const result = await readContinuityCoreMessage(filePath, mesId, batchStart);
            if (result.success && result.data) {
                existingData = result.data;
            }
        }

        // 空值保护：新数据所有 swipe 的所有 key 都为空字符串时,跳过
        const hasNewData = Object.values(swipes).some(sd =>
            Object.values(sd).some(v => typeof v === 'string' && v.length > 0)
        );
        if (skipEmpty && !hasNewData && existingData) {
            debugLog('PerMessageStorage', `楼层 ${mesId} 新数据为空，跳过（已有数据保留）`);
            return;
        }

        // 合并模式：与已有 swipes 合并(同 key 的新值覆盖旧值)
        let finalSwipes = swipes;
        if (merge && existingData?.swipes) {
            const merged = { ...existingData.swipes };
            for (const [swipeId, newData] of Object.entries(swipes)) {
                if (merged[swipeId]) {
                    merged[swipeId] = { ...merged[swipeId], ...newData };
                } else {
                    merged[swipeId] = newData;
                }
            }
            finalSwipes = merged;
        }

        const data = { mesId, activeSwipeId, swipes: finalSwipes };
        await writeContinuityCoreMessage(filePath, mesId, { swipes: finalSwipes, activeSwipeId }, batchStart);

        // 更新缓存
        const batchKey = this._getMessageBatchKey(mesId);
        if (!this.messageCache.has(batchKey)) {
            this.messageCache.set(batchKey, new Map());
        }
        this.messageCache.get(batchKey).set(mesId, data);

        // 更新 meta
        if (this.metaCache) {
            this.metaCache.totalMessages = Math.max(this.metaCache.totalMessages, mesId + 1);
            this.metaCache.lastUpdated = new Date().toISOString();
            this._scheduleMetaSave();
        }

        debugLog('PerMessageStorage', `写入楼层 ${mesId}，swipes: ${Object.keys(finalSwipes).join(',')}`);
    }

    /**
     * 更新指定楼层的模块数据（合并已有 swipes + 标记脏）
     */
    async updateMessage(mesId, activeSwipeId, swipesData) {
        await this.writeMessage(mesId, activeSwipeId, swipesData, { merge: true, skipEmpty: false });

        // 标记后续快照为脏
        this._markSnapshotsDirty(mesId);
    }

    /**
     * 删除指定楼层的模块数据
     * @param {number} mesId
     */
    async deleteMessage(mesId) {
        this._ensureInitialized();

        // 读取整个 batch，移除该行，写回
        const batchStart = getBatchStart(mesId, this.batchSize);
        const batchKey = this._getMessageBatchKey(mesId);
        const filePath = getMessageBatchPath(
            this.currentChat.characterName,
            this.currentChat.chatFileName,
            mesId,
            this.batchSize,
        );

        // 读取 batch 所有行
        const batchEnd = batchStart + this.batchSize - 1;
        const result = await readContinuityCoreMessages(filePath, batchStart, batchEnd);

        if (result.success && result.data) {
            // 过滤掉目标 mesId
            const remaining = result.data.filter(m => m.mesId !== mesId);

            // 重写整个 batch 文件
            const { saveContinuityCoreFile } = await import('./continuityCoreServerApi.js');
            const lines = remaining.map(m => JSON.stringify(m)).join('\n') + '\n';
            await saveContinuityCoreFile(filePath, lines);
        }

        // 更新缓存
        const cached = this.messageCache.get(batchKey);
        if (cached) {
            cached.delete(mesId);
        }

        // 标记后续快照为脏
        this._markSnapshotsDirty(mesId);

        debugLog('PerMessageStorage', `删除楼层 ${mesId}`);
    }

    /**
     * 批量读取楼层
     * @param {number} fromMesId
     * @param {number} toMesId
     * @returns {Promise<object[]>}
     */
    async getMessages(fromMesId, toMesId) {
        this._ensureInitialized();

        // 计算涉及的 batch 文件
        const filePaths = [];
        for (let mesId = fromMesId; mesId <= toMesId; mesId += this.batchSize) {
            const batchStart = getBatchStart(mesId, this.batchSize);
            const filePath = getMessageBatchPath(
                this.currentChat.characterName,
                this.currentChat.chatFileName,
                batchStart,
                this.batchSize,
            );
            if (!filePaths.includes(filePath)) {
                filePaths.push(filePath);
            }
        }

        const result = await readContinuityCoreMessages(filePaths, fromMesId, toMesId);
        return result.success ? result.data : [];
    }

    // ==========================================
    // 快照操作
    // ==========================================

    /**
     * 读取指定楼层最近的快照
     * @param {number} mesId
     * @returns {Promise<object|null>}
     */
    async getSnapshot(mesId) {
        this._ensureInitialized();

        const filePath = getSnapshotBatchPath(
            this.currentChat.characterName,
            this.currentChat.chatFileName,
            mesId,
            this.batchSize,
        );

        // 先查缓存
        const batchKey = this._getSnapshotBatchKey(mesId);
        const cached = this.snapshotCache.get(batchKey);
        if (cached) {
            return this._findClosestSnapshot(cached, mesId);
        }

        const result = await readContinuityCoreSnapshot(filePath, mesId);
        if (result.success && result.data) {
            // 缓存整个 batch
            // 注意：readSnapshot 只返回单个快照，需要读取整个文件来缓存
            return result.data;
        }

        return null;
    }

    /**
     * 写入快照
     * @param {number} mesId
     * @param {object} moduleStates
     */
    async writeSnapshot(mesId, moduleStates) {
        this._ensureInitialized();

        const filePath = getSnapshotBatchPath(
            this.currentChat.characterName,
            this.currentChat.chatFileName,
            mesId,
            this.batchSize,
        );

        await writeContinuityCoreSnapshot(filePath, mesId, { moduleStates });

        // 更新 meta
        if (this.metaCache) {
            if (mesId > (this.metaCache.latestSnapshotMesId ?? -1)) {
                this.metaCache.latestSnapshotMesId = mesId;
            }
            // 如果脏标记的起始楼层 > 当前快照楼层，清除脏标记
            if (this.metaCache.dirtyFromMesId !== null && mesId >= this.metaCache.dirtyFromMesId) {
                this.metaCache.dirtyFromMesId = null;
            }
            this.metaCache.lastUpdated = new Date().toISOString();
            this._scheduleMetaSave();
        }

        // 清除快照缓存（因为已更新）
        const batchKey = this._getSnapshotBatchKey(mesId);
        this.snapshotCache.delete(batchKey);

        debugLog('PerMessageStorage', `写入快照 ${mesId}`);
    }

    /**
     * 获取指定楼层的累积模块状态
     * 1. 找最近前置快照
     * 2. 从快照后一层的消息开始增量计算
     * @param {number} mesId
     * @returns {Promise<object>}
     */
    async getAccumulatedState(mesId) {
        this._ensureInitialized();

        // 找最近前置快照
        let snapshotMesId = -1;
        let moduleStates = {};

        // 从当前 mesId 向前查找快照
        for (let checkMesId = mesId; checkMesId >= 0; checkMesId -= this.snapshotInterval) {
            const snapshot = await this.getSnapshot(checkMesId);
            if (snapshot) {
                snapshotMesId = snapshot.mesId ?? checkMesId;
                moduleStates = snapshot.moduleStates || {};
                break;
            }
        }

        // 从快照后一层的消息开始增量计算
        const fromMesId = snapshotMesId + 1;
        if (fromMesId <= mesId) {
            const messages = await this.getMessages(fromMesId, mesId);
            for (const msg of messages) {
                if (!msg.swipes) continue;
                // 使用当前激活的 swipe（通常是 0）
                const activeSwipe = msg.swipes['0'] || Object.values(msg.swipes)[0];
                if (!activeSwipe) continue;

                // 合并 modules 文本(新格式:直接取 modules 字符串)
                const modulesText = this._mergeModules(activeSwipe);
                this._applyModulesToState(moduleStates, modulesText, msg.mesId);
            }
        }

        return moduleStates;
    }

    // ==========================================
    // 迁移
    // ==========================================

    /**
     * 迁移聊天目录（重命名时调用）
     * @param {string} oldCharName
     * @param {string} oldChatFile
     * @param {string} newCharName
     * @param {string} newChatFile
     */
    async migrateChat(oldCharName, oldChatFile, newCharName, newChatFile) {
        const oldDir = getChatStorageDir(oldCharName, oldChatFile);
        const newDir = getChatStorageDir(newCharName, newChatFile);

        if (oldDir === newDir) return;

        await moveContinuityCoreChat(oldDir, newDir);

        // 如果是当前聊天，更新引用
        if (this.currentChat &&
            this.currentChat.characterName === oldCharName &&
            this.currentChat.chatFileName === oldChatFile) {
            this.currentChat.characterName = newCharName;
            this.currentChat.chatFileName = newChatFile;
            // 清除缓存，重新加载
            this.messageCache.clear();
            this.snapshotCache.clear();
            this.metaCache = null;
        }

        debugLog('PerMessageStorage', `迁移: ${oldDir} → ${newDir}`);
    }

    // ==========================================
    // 缓存与持久化
    // ==========================================

    /**
     * 清除所有缓存
     */
    clearCache() {
        this.messageCache.clear();
        this.snapshotCache.clear();
        this.dirtyBatches.clear();
        this.metaCache = null;
    }

    /**
     * 刷新脏数据到磁盘
     */
    async flush() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }

        // 保存 meta
        if (this.metaCache) {
            const metaPath = getMetaPath(
                this.currentChat.characterName,
                this.currentChat.chatFileName,
            );
            await writeContinuityCoreMeta(metaPath, this.metaCache);
        }
    }

    // ==========================================
    // 内部方法
    // ==========================================

    _ensureInitialized() {
        if (!this.currentChat) {
            throw new Error('PerMessageStorage: 未初始化，请先调用 initChat()');
        }
    }

    _getMessageBatchKey(mesId) {
        const batchStart = getBatchStart(mesId, this.batchSize);
        return `msg_${batchStart}`;
    }

    _getSnapshotBatchKey(mesId) {
        const batchStart = getBatchStart(mesId, this.batchSize);
        return `snap_${batchStart}`;
    }

    _findClosestSnapshot(snapshots, mesId) {
        const keys = Object.keys(snapshots).map(Number).sort((a, b) => a - b);
        let bestKey = null;
        for (const key of keys) {
            if (key <= mesId) bestKey = key;
            else break;
        }
        return bestKey !== null ? { mesId: bestKey, ...snapshots[bestKey] } : null;
    }

    /**
     * 合并 swipe 数据中的模块文本
     * 新格式:modules 是单个字符串,直接返回(供 _applyModulesToState 按行处理)
     * @param {object} swipeData - { modules: string, ... }
     * @returns {string} modules 文本
     */
    _mergeModules(swipeData) {
        return swipeData.modules || '';
    }

    /**
     * 将模块文本应用到累积状态
     * TODO: Phase 2 实现累积状态逻辑,届时需要解析文本提取模块名
     * @param {object} moduleStates - 累积状态
     * @param {string} modulesText - 模块文本(可能含多个 [Module|...] 块)
     * @param {number} mesId
     */
    _applyModulesToState(moduleStates, modulesText, mesId) {
        if (!modulesText) return;
        // Phase 2 实现:解析文本字符串,提取模块名和变量,合并到累积状态
        debugLog('PerMessageStorage', `应用 ${modulesText.length} 字符模块文本到楼层 ${mesId}（累积逻辑待实现）`);
    }

    /**
     * 判断对象是否是 swipes map 结构({ "0": {...}, "1": {...} })
     * 用于区分单 swipe 数据和多 swipe 包装
     */
    _isSwipesMap(obj) {
        if (!obj || typeof obj !== 'object') return false;
        const keys = Object.keys(obj);
        if (keys.length === 0) return false;
        // 所有 key 都是数字字符串,且所有 value 都是对象 → 是 swipes map
        return keys.every(k => /^\d+$/.test(k) && typeof obj[k] === 'object' && obj[k] !== null);
    }

    /**
     * 标记从 mesId 开始的后续快照为脏
     */
    _markSnapshotsDirty(mesId) {
        if (this.metaCache) {
            if (this.metaCache.dirtyFromMesId === null || mesId < this.metaCache.dirtyFromMesId) {
                this.metaCache.dirtyFromMesId = mesId;
            }
            this._scheduleMetaSave();
        }
    }

    /**
     * 用栈找所有顶层模块的 raw 字符串 + 起始位置
     * 嵌套模块包含在顶层模块的 raw 内，不单独提取
     * @param {string} text
     * @returns {Array<{ raw: string, startIndex: number }>}
     */
    _findTopLevelModuleRanges(text) {
        const results = [];
        const stack = []; // { start, level }

        for (let i = 0; i < text.length; i++) {
            if (text[i] === '[') {
                stack.push({ start: i, level: stack.length });
            } else if (text[i] === ']' && stack.length > 0) {
                const frame = stack.pop();
                const content = text.substring(frame.start + 1, i);

                if (content.includes('|')) {
                    const pipeIdx = content.indexOf('|');
                    const name = content.substring(0, pipeIdx).trim();

                    // 模块名不含 : 或 | 才是有效模块
                    if (!name.includes(':') && !name.includes('|')) {
                        // 只在栈为空时（顶层）收集
                        if (stack.length === 0) {
                            results.push({
                                raw: text.substring(frame.start, i + 1),
                                startIndex: frame.start,
                            });
                        }
                    }
                }
            }
        }

        return results;
    }

    _scheduleMetaSave() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
    }
}

// 单例导出
const perMessageStorage = new PerMessageStorageManager();
export default perMessageStorage;
