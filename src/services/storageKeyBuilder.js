/**
 * storageKeyBuilder.js
 * 存储路径构建工具 — 与后端阅读服务器的符号处理规则保持一致
 *
 * 规则：只替换 '.' 为 '_'，保留所有其他字符
 * 目录结构：chats/{safeCharName}/{safeFileName}/
 */

/**
 * 安全化角色名：替换 '.' 为 '_'
 * @param {string} characterName
 * @returns {string}
 */
export function getSafeCharName(characterName) {
    return (characterName || 'unknown').replace(/\./g, '_');
}

/**
 * 安全化聊天文件名：去掉 .jsonl 扩展名，替换所有 '.' 为 '_'
 * @param {string} chatFileName - 原始聊天文件名，如 "[user]CharName-Main- 2025-01-01.jsonl"
 * @returns {string} - 如 "[user]CharName-Main- 2025-01-01_jsonl"
 */
export function getSafeFileName(chatFileName) {
    const baseName = chatFileName.replace(/\.jsonl$/i, '');
    return baseName.replace(/\./g, '_');
}

/**
 * 获取聊天的存储目录（相对于 continuity-core 根目录）
 * @param {string} characterName
 * @param {string} chatFileName
 * @returns {string} - 如 "chats/CharFolder/[user]CharName-Main- 2025-01-01_jsonl"
 */
export function getChatStorageDir(characterName, chatFileName) {
    const safeCharName = getSafeCharName(characterName);
    const safeFileName = getSafeFileName(chatFileName);
    return `chats/${safeCharName}/${safeFileName}`;
}

/**
 * 计算 mesId 所属的 batch 起始索引
 * @param {number} mesId
 * @param {number} batchSize - 默认 100
 * @returns {number}
 */
export function getBatchStart(mesId, batchSize = 100) {
    return Math.floor(mesId / batchSize) * batchSize;
}

/**
 * 获取消息 batch 文件名
 * @param {number} mesId
 * @param {number} batchSize - 默认 100
 * @returns {string} - 如 "0000-0099.jsonl"
 */
export function getMessageBatchFileName(mesId, batchSize = 100) {
    const start = getBatchStart(mesId, batchSize);
    const end = start + batchSize - 1;
    return `${String(start).padStart(4, '0')}-${String(end).padStart(4, '0')}.jsonl`;
}

/**
 * 获取快照 batch 文件名
 * @param {number} mesId
 * @param {number} batchSize - 默认 100
 * @returns {string} - 如 "0000-0099.json"
 */
export function getSnapshotBatchFileName(mesId, batchSize = 100) {
    const start = getBatchStart(mesId, batchSize);
    const end = start + batchSize - 1;
    return `${String(start).padStart(4, '0')}-${String(end).padStart(4, '0')}.json`;
}

/**
 * 获取消息 batch 文件的相对路径
 * @param {string} characterName
 * @param {string} chatFileName
 * @param {number} mesId
 * @param {number} batchSize
 * @returns {string}
 */
export function getMessageBatchPath(characterName, chatFileName, mesId, batchSize = 100) {
    const storageDir = getChatStorageDir(characterName, chatFileName);
    const batchFileName = getMessageBatchFileName(mesId, batchSize);
    return `${storageDir}/messages/${batchFileName}`;
}

/**
 * 获取快照 batch 文件的相对路径
 * @param {string} characterName
 * @param {string} chatFileName
 * @param {number} mesId
 * @param {number} batchSize
 * @returns {string}
 */
export function getSnapshotBatchPath(characterName, chatFileName, mesId, batchSize = 100) {
    const storageDir = getChatStorageDir(characterName, chatFileName);
    const batchFileName = getSnapshotBatchFileName(mesId, batchSize);
    return `${storageDir}/snapshots/${batchFileName}`;
}

/**
 * 获取 meta.json 的相对路径
 * @param {string} characterName
 * @param {string} chatFileName
 * @returns {string}
 */
export function getMetaPath(characterName, chatFileName) {
    const storageDir = getChatStorageDir(characterName, chatFileName);
    return `${storageDir}/meta.json`;
}
