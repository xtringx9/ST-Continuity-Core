import { currentUser, getCurrentUserHandle, getRequestHeaders } from '../index.js';

export const CONTINUITY_CORE_SERVER_API_BASE = '/api/plugins/continuity-core';

export function getContinuityCoreUserHandle() {
    return getCurrentUserHandle?.() || currentUser?.handle || 'default-user';
}

export async function continuityCoreServerRequest(endpoint, payload = {}, options = {}) {
    const userHandle = options.userHandle || getContinuityCoreUserHandle();
    const response = await fetch(`${CONTINUITY_CORE_SERVER_API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            ...payload,
            userHandle,
        }),
    });

    let result = null;
    try {
        result = await response.json();
    } catch {
        result = null;
    }

    if (!response.ok) {
        throw new Error(result?.error || `Continuity Core server error: ${response.status}`);
    }

    return result;
}

export function saveContinuityCoreFile(filePath, content, options = {}) {
    return continuityCoreServerRequest('save', { filePath, content }, options);
}

export function readContinuityCoreFile(filePath, options = {}) {
    return continuityCoreServerRequest('read', { filePath }, options);
}

export function listContinuityCoreFiles(dirPath = '', options = {}) {
    return continuityCoreServerRequest('list', { dirPath }, options);
}

export function deleteContinuityCoreFile(filePath, options = {}) {
    return continuityCoreServerRequest('delete', { filePath }, options);
}

// ==========================================
// 存储层接口
// ==========================================

export function ensureContinuityCoreDir(dirPath, options = {}) {
    return continuityCoreServerRequest('ensureDir', { dirPath }, options);
}

export function appendContinuityCoreMessage(filePath, data, options = {}) {
    return continuityCoreServerRequest('appendMessage', { filePath, data }, options);
}

export function readContinuityCoreMessage(filePath, mesId, options = {}) {
    return continuityCoreServerRequest('readMessage', { filePath, mesId }, options);
}

export function writeContinuityCoreMessage(filePath, mesId, data, options = {}) {
    return continuityCoreServerRequest('writeMessage', { filePath, mesId, data }, options);
}

export function readContinuityCoreMessages(filePaths, fromMesId, toMesId, options = {}) {
    return continuityCoreServerRequest('readMessages', { filePaths, fromMesId, toMesId }, options);
}

export function readContinuityCoreSnapshot(filePath, mesId, options = {}) {
    return continuityCoreServerRequest('readSnapshot', { filePath, mesId }, options);
}

export function writeContinuityCoreSnapshot(filePath, mesId, data, options = {}) {
    return continuityCoreServerRequest('writeSnapshot', { filePath, mesId, data }, options);
}

export function readContinuityCoreMeta(filePath, options = {}) {
    return continuityCoreServerRequest('readMeta', { filePath }, options);
}

export function writeContinuityCoreMeta(filePath, data, options = {}) {
    return continuityCoreServerRequest('writeMeta', { filePath, data }, options);
}

export function moveContinuityCoreChat(oldDirPath, newDirPath, options = {}) {
    return continuityCoreServerRequest('moveChat', { oldDirPath, newDirPath }, options);
}

export function deleteContinuityCoreChat(dirPath, options = {}) {
    return continuityCoreServerRequest('deleteChat', { dirPath }, options);
}

export function listContinuityCoreChats(charName, options = {}) {
    return continuityCoreServerRequest('listChats', { charName }, options);
}
