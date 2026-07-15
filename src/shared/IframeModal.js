// src/shared/IframeModal.js
// 通用 iframe 模态窗口：支持多实例（每次 new 即独立实例），同实例不重复 open

let modalCounter = 0;

export class IframeModal {
    constructor(options = {}) {
        modalCounter++;
        this.modalId = options.modalId || `st-continuity-iframe-modal-${modalCounter}`;
        this.iframeId = options.iframeId || `st-continuity-iframe-${modalCounter}`;
        this.containerClass = options.containerClass || 'st-continuity-iframe-container';
        this.backdrop = null;
    }

    /**
     * 打开 Iframe 模态窗口
     * @param {string|null} url - Iframe 要加载的 HTML 路径（与 srcdoc 二选一）
     * @param {string} title - (可选) 用于无障碍访问的标题
     * @param {Object} options - (可选) 配置项
     * @param {string} options.variant - 样式变体: 'drawer-left' (默认), 'drawer-right', 'center'
     * @param {function} options.onLoad - iframe 加载完成回调，参数为 iframe 元素
     * @param {string} options.srcdoc - HTML 字符串，用于 srcdoc 模式（与 url 二选一）
     */
    open(url, title = 'Continuity Editor', options = {}) {
        // 同实例已打开则不重复打开（保持单实例语义；多开请 new 新实例）
        if (this.backdrop) return;

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
        iframe.title = title;

        // srcdoc 模式：注入 HTML 字符串；否则加载 url
        if (options.srcdoc) {
            iframe.srcdoc = options.srcdoc;
        } else {
            iframe.src = url;
        }

        // fitContent：容器随内容自适应（去除深色外框），iframe 先给定尺寸避免加载前塌陷
        if (options.fitContent) {
            Object.assign(iframeContainer.style, {
                width: 'fit-content',
                height: 'fit-content',
                maxWidth: '95vw',
                maxHeight: '95vh',
                background: 'transparent',
                boxShadow: 'none',
            });
            Object.assign(iframe.style, {
                width: '390px',
                height: '780px',
                border: 'none',
                display: 'block',
            });
            iframe.onload = () => this._fitToContent(iframe);
        } else {
            Object.assign(iframe.style, {
                width: '100%',
                height: '100%',
                border: 'none',
                display: 'block',
            });
            // 支持 onLoad 回调 (用于注入逻辑)
            if (typeof options.onLoad === 'function') {
                iframe.onload = () => options.onLoad(iframe);
            }
        }

        // 4. 组装
        iframeContainer.appendChild(iframe);
        this.backdrop.appendChild(iframeContainer);
        document.body.appendChild(this.backdrop);

        // 5. 动画显示
        requestAnimationFrame(() => {
            this.backdrop.classList.add('open');
        });

        // 6. 点击遮罩关闭
        this.backdrop.addEventListener('click', (e) => {
            if (e.target === this.backdrop) {
                this.close();
            }
        });

        // 7. 监听来自 Iframe 的关闭消息（需带 modalId 匹配，否则关闭所有）
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
        if (event.data && event.data.type === 'CLOSE_CONTINUITY_MODAL') {
            // 带 modalId 则只关匹配的实例，否则关所有（向后兼容）
            if (event.data.modalId && event.data.modalId !== this.modalId) return;
            this.close();
        }
    }

    /**
     * 使 iframe 尺寸贴合内容（fitContent 用）
     * 同域 srcdoc 可直接读取 contentDocument；内容变化时由 ResizeObserver 自动重适配。
     */
    _fitToContent(iframe) {
        try {
            const doc = iframe.contentDocument;
            if (!doc) return;
            const phone = doc.querySelector('.phone');
            const w = phone ? phone.offsetWidth : doc.body.scrollWidth;
            const h = phone ? phone.offsetHeight : doc.body.scrollHeight;
            const maxW = window.innerWidth * 0.95;
            const maxH = window.innerHeight * 0.95;
            const newW = Math.min(w || 390, maxW);
            const newH = Math.min(h || 780, maxH);
            // 尺寸无变化则跳过，避免任何残留的来回抖动
            if (iframe.style.width === newW + 'px' && iframe.style.height === newH + 'px') return;
            iframe.style.width = newW + 'px';
            iframe.style.height = newH + 'px';

            // 内容变化时重新适配（仅挂一次）
            if (!iframe._fitObserver) {
                iframe._fitObserver = new ResizeObserver(() => this._fitToContent(iframe));
                iframe._fitObserver.observe(phone || doc.body);
            }
        } catch (e) {
            // 跨域或尚未就绪时静默跳过
        }
    }

    /**
     * 直接替换 iframe 内容（用于同实例内重渲染，如保存设置后刷新手机视图）
     * @param {string} html srcdoc HTML 字符串
     */
    setSrcdoc(html) {
        if (!this.backdrop) return;
        const iframe = this.backdrop.querySelector('iframe');
        if (iframe) iframe.srcdoc = html;
    }
}
