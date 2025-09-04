import { chat } from "../../../../script.js";

const extensionName = "ST-Continuity-Core";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// SillyTavern的聊天记录存储在全局变量 chat 中

// 你的后端服务器地址
const backendUrl = "http://192.168.0.119:8888/simple-process";

console.log("♥️ Continuity Core LOADED!");

// 当文档加载完毕后执行
$(document).ready(function () {
    const button = $('<button id="send-to-backend-btn">发送最新楼层到后端</button>');
    $('body').append(button);

    // Bind the click event - notice we removed 'async' as it's no longer needed
    button.on('click', function () {

        // 2. Now we can directly and reliably use the imported 'chat' variable.
        // It will always be the up-to-date chat history.
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

        // 3. The fetch logic remains the same, but we wrap it in an async IIFE 
        //    or simply let the promise run. Using .then() .catch() is also clean.
        fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ last_message: lastMessageContent }),
        })
            .then(response => {
                if (!response.ok) {
                    // Throws an error to be caught by the .catch block
                    throw new Error(`后端服务器错误: ${response.status}`);
                }
                return response.json();
            })
            .then(result => {
                toastr.success(`后端返回: "${result.response}"`);
            })
            .catch(error => {
                console.error("发送到后端失败:", error);
                toastr.error(`发送失败: ${error.message}`);
            });
    });
});