// src/services/secretRotator.js
// 静默密钥旋转：直接调 ST 服务端 rotate 接口并刷新本地 secret_state。
//
// ⚠️ 为什么不用 ST 的 rotateSecret：其内部会 `$('#main_api').trigger('change')`
//    → 触发 RossAscends 自动重连（RA_autoconnect）→ 连带切换预设/拉取模型，
//    造成明显卡顿；在 AI 生成中还会与并发预设保护互相干扰。
// ST 的 /api/backends/chat-completions/generate 由服务端按当前激活密钥实时读取，
// 故静默旋转即可生效，无需客户端重连。

import { getRequestHeaders } from '../../../../../../script.js';
import { readSecretState } from '../../../../../secrets.js';
import { errorLog } from '../utils/logger.js';

const LOG_TAG = 'SecretRotator';

/**
 * 静默切换某密钥池的激活密钥（不触发 ST 客户端重连）。
 * @param {string} key 密钥池（如 SECRET_KEYS.CUSTOM）
 * @param {string} id 要激活的 secret id
 * @returns {Promise<boolean>} 是否成功
 */
export async function rotateSecretQuiet(key, id) {
    if (!id) return false;
    try {
        const response = await fetch('/api/secrets/rotate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, id }),
        });
        if (!response.ok) return false;
        await readSecretState();
        return true;
    } catch (e) {
        errorLog(LOG_TAG, `静默切换密钥失败 (${key}):`, e);
        return false;
    }
}
