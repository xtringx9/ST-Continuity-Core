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

        const variant = options.variant || 'drawer-left';

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
            // justifyContent 和 alignItems 根据 variant 动态设置
            opacity: '0',
            transition: 'opacity 0.2s ease-in-out'
        });

        // 2. 创建 Iframe 容器
        const iframeContainer = document.createElement('div');

        // 基础样式
        const containerStyles = {
            width: '100%',              // 默认占满（移动端优先）
            height: '100%',             // 全高
            backgroundColor: '#1a1b1e', // 默认深色底，防止加载时闪白
            overflow: 'hidden',
            position: 'relative',
            transition: 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)' // 平滑的缓动动画
        };

        // 根据变体应用特定样式
        if (variant === 'drawer-left') {
            this.backdrop.style.justifyContent = 'flex-start';
            this.backdrop.style.alignItems = 'stretch';
            Object.assign(containerStyles, {
                maxWidth: '950px',
                boxShadow: '4px 0 20px rgba(0,0,0,0.5)',
                transform: 'translateX(-100%)', // 初始在左外
            });
            this._enterTransform = 'translateX(0)';
            this._exitTransform = 'translateX(-100%)';
        }
        else if (variant === 'drawer-right') {
            this.backdrop.style.justifyContent = 'flex-end';
            this.backdrop.style.alignItems = 'stretch';
            Object.assign(containerStyles, {
                maxWidth: '950px',
                boxShadow: '-4px 0 20px rgba(0,0,0,0.5)',
                transform: 'translateX(100%)', // 初始在右外
            });
            this._enterTransform = 'translateX(0)';
            this._exitTransform = 'translateX(100%)';
        }
        else if (variant === 'center') {
            this.backdrop.style.justifyContent = 'center';
            this.backdrop.style.alignItems = 'center';
            Object.assign(containerStyles, {
                width: '90%',
                height: '90%',
                maxWidth: '1400px',
                maxHeight: '900px',
                borderRadius: '8px',
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                transform: 'scale(0.95)', // 初始略微缩小
                opacity: '0',
                transition: 'transform 0.2s ease-out, opacity 0.2s ease-out'
            });
            this._enterTransform = 'scale(1)';
            this._exitTransform = 'scale(0.95)';
        }

        Object.assign(iframeContainer.style, containerStyles);

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
            if (variant === 'center') {
                iframeContainer.style.opacity = '1';
            }
            iframeContainer.style.transform = this._enterTransform;
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

        const container = this.backdrop.firstElementChild;
        if (container) {
            container.style.transform = this._exitTransform;
            if (this._exitTransform.includes('scale')) {
                container.style.opacity = '0';
            }
        }
        this.backdrop.style.opacity = '0';

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
