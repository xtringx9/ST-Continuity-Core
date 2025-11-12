// 后端服务模块
import { chat } from "../../../../../script.js";
import { extension_settings } from "../../../../extensions.js";
import { extensionName } from "../core/config.js";
import { debugLog, errorLog, infoLog } from "./logger.js";

/**
 * 发送消息到后端服务器
 * @returns {Promise<void>}
 */
export async function sendToBackend() {
    const settings = extension_settings[extensionName];

    // 检查是否启用
    if (!settings.enabled) {
        toastr.warning("Continuity Core 已禁用，请先启用扩展。");
        return;
    }

    // 检查聊天记录
    if (!chat || chat.length === 0) {
        toastr.warning("聊天记录为空，无法发送。");
        return;
    }

    const lastMessageContent = chat[chat.length - 1]?.mes;

    if (!lastMessageContent) {
        toastr.error("找到了聊天记录，但无法读取最后一条消息的内容。");
        return;
    }

    toastr.info(`准备发送: "${lastMessageContent.substring(0, 50)}..."`);

    try {
        const response = await fetch(settings.backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ last_message: lastMessageContent }),
        });

        if (!response.ok) {
            throw new Error(`后端服务器错误: ${response.status}`);
        }

        const result = await response.json();
        toastr.success(`后端返回: "${result.response}"`);
    } catch (error) {
        errorLog("发送到后端失败:", error);
        toastr.error(`发送失败: ${error.message}`);
    }
}
