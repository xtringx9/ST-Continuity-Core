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
