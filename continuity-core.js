import { chat } from "../../../../script.js";

const extensionName = "ST-Continuity-Core";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// SillyTavern的聊天记录存储在全局变量 chat 中

// 你的后端服务器地址
const backendUrl = "http://192.168.0.119:8888/simple-process";

console.log("♥️ Continuity Core LOADED!");

// 当文档加载完毕后执行
jQuery(async function () {
    // 1. 创建更复杂的HTML结构，并默认展开
    const fabContainer = $(`
        <div id="continuity-fab-container" class="open">
            <div class="continuity-fab-menu">
                <button id="send-to-backend-btn" class="continuity-fab-item">发送最新楼层</button>
                <button class="continuity-fab-item">功能二</button>
                <button class="continuity-fab-item">功能三</button>
            </div>
            <button id="continuity-fab-main-btn" class="continuity-fab-item">
                <span>&#43;</span>
            </button>
        </div>
    `);

    // 2. 将整个容器添加到body
    $('body').append(fabContainer);

    // 3. 为主按钮绑定点击事件，用于展开/收起菜单
    $('#continuity-fab-main-btn').on('click', function () {
        $('#continuity-fab-container').toggleClass('open');
    });


    // 4. 为“发送最新楼层”按钮绑定原有功能
    $('#send-to-backend-btn').on('click', function () {

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