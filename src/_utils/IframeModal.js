// src/_utils/IframeModal.js

export class IframeModal {
    constructor() {
        this.modalId = 'st-continuity-iframe-modal';
        this.iframeId = 'st-continuity-iframe';
        this.backdrop = null;
    }

    /**
     * 打开 Iframe 模态窗口
     * @param {string} url - Iframe 要加载的 HTML 路径
     * @param {string} title - (可选) 用于无障碍访问的标题
     */
    open(url, title = 'Continuity Editor') {
        // 防止重复创建
        if (document.getElementById(this.modalId)) {
            return;
        }

        // 1. 创建遮罩层 (Backdrop)
        this.backdrop = document.createElement('div');
        this.backdrop.id = this.modalId;

        // 设置遮罩层样式 (宿主环境样式)
        Object.assign(this.backdrop.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.6)', // 半透明黑色背景
            zIndex: '9999', // 确保在最上层
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            opacity: '0',
            transition: 'opacity 0.2s ease-in-out'
        });

        // 2. 创建 Iframe 容器
        const iframeContainer = document.createElement('div');
        Object.assign(iframeContainer.style, {
            width: '90%',
            height: '90%',
            maxWidth: '1400px',
            maxHeight: '900px',
            backgroundColor: '#1a1b1e', // 默认深色底，防止加载时闪白
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            overflow: 'hidden',
            position: 'relative'
        });

        // 3. 创建 Iframe
        const iframe = document.createElement('iframe');
        iframe.id = this.iframeId;
        iframe.src = url;
        iframe.title = title;
        Object.assign(iframe.style, {
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block'
        });

        // 4. 组装
        iframeContainer.appendChild(iframe);
        this.backdrop.appendChild(iframeContainer);
        document.body.appendChild(this.backdrop);

        // 5. 动画显示
        requestAnimationFrame(() => {
            this.backdrop.style.opacity = '1';
        });

        // 6. 点击遮罩关闭 (可选，防止误触可以注释掉)
        this.backdrop.addEventListener('click', (e) => {
            if (e.target === this.backdrop) {
                this.close();
            }
        });

        // 7. 监听来自 Iframe 的关闭消息 (预留)
        window.addEventListener('message', this._handleMessage);
    }

    /**
     * 关闭模态窗口
     */
    close() {
        if (!this.backdrop) return;

        this.backdrop.style.opacity = '0';

        // 等待动画结束后移除 DOM
        setTimeout(() => {
            if (this.backdrop && this.backdrop.parentNode) {
                this.backdrop.parentNode.removeChild(this.backdrop);
            }
            this.backdrop = null;
            window.removeEventListener('message', this._handleMessage);
        }, 200);
    }

    /**
     * 内部消息处理
     */
    _handleMessage = (event) => {
        // 简单的安全检查，确保只处理本插件的消息
        if (event.data && event.data.type === 'CLOSE_CONTINUITY_MODAL') {
            this.close();
        }
    }
}
