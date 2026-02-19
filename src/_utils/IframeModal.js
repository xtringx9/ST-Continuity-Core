// src/_utils/IframeModal.js

export class IframeModal {
    constructor(options = {}) {
        this.modalId = options.modalId || 'st-continuity-iframe-modal';
        this.iframeId = options.iframeId || 'st-continuity-iframe';
        this.containerClass = options.containerClass || 'st-continuity-iframe-container';
        this.backdrop = null;
    }

    /**
     * 打开 Iframe 模态窗口
     * @param {string} url - Iframe 要加载的 HTML 路径
     * @param {string} title - (可选) 用于无障碍访问的标题
     * @param {Object} options - (可选) 配置项
     * @param {string} options.variant - 样式变体: 'drawer-left' (默认), 'drawer-right', 'center'
     */
    open(url, title = 'Continuity Editor', options = {}) {
        // 防止重复创建
        if (document.getElementById(this.modalId)) {
            return;
        }

        // 1. 创建遮罩层 (Backdrop)
        this.backdrop = document.createElement('div');
        this.backdrop.id = this.modalId;
        this.backdrop.classList.add('st-continuity-iframe-modal-backdrop');

        const variant = options.variant || 'drawer-left';
        this.backdrop.classList.add(variant);

        // 2. 创建 Iframe 容器
        const iframeContainer = document.createElement('div');
        iframeContainer.classList.add(this.containerClass);

        // 3. 创建 Iframe
        const iframe = document.createElement('iframe');
        iframe.id = this.iframeId;
        iframe.src = url;
        iframe.title = title;

        // 支持 onLoad 回调 (用于注入逻辑)
        if (typeof options.onLoad === 'function') {
            iframe.onload = () => options.onLoad(iframe);
        }

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
            this.backdrop.classList.add('open');
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

        this.backdrop.classList.remove('open');

        // 等待动画结束后移除 DOM
        setTimeout(() => {
            if (this.backdrop && this.backdrop.parentNode) {
                this.backdrop.parentNode.removeChild(this.backdrop);
            }
            this.backdrop = null;
            window.removeEventListener('message', this._handleMessage);
        }, 300); // 对应 transition 时间
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
