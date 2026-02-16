import { IframeModal } from '../../_utils/IframeModal.js';

export class ChatBarButton {
    /**
     * @param {string} extensionPath - 插件的根目录路径 (e.g. /scripts/extensions/third-party/...)
     */
    constructor(extensionPath) {
        this.extensionPath = extensionPath;
        this.buttonId = 'continuity-new-entry-btn';
        this.iframeModal = new IframeModal();
    }

    /**
     * 初始化并注入按钮
     */
    init() {
        // 避免重复注入
        if (document.getElementById(this.buttonId)) {
            return;
        }

        // 寻找注入点：SillyTavern 的左侧发送按钮区域
        // 参考路径: #form_sheld > #send_form > #nonQRFormItems > #leftSendForm
        const targetContainer = document.querySelector('#form_sheld #send_form #nonQRFormItems #leftSendForm');

        if (!targetContainer) {
            console.warn('[Continuity] 无法找到按钮注入容器 (#leftSendForm)');
            return;
        }

        const btn = this._createButtonElement();

        // 使用 CSS order 确保它排在最后 (ST常用技巧)
        btn.style.order = '9999';

        targetContainer.appendChild(btn);
    }

    /**
     * 创建按钮 DOM 元素
     */
    _createButtonElement() {
        const btn = document.createElement('div');
        btn.id = this.buttonId;

        // 使用 ST 的通用按钮类名，保持外观一致性
        btn.className = 'mes_text_paste';
        btn.title = '打开 Continuity 配置 (Iframe)';

        // 简单的图标样式
        btn.innerHTML = '⚙️';
        Object.assign(btn.style, {
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2em',
            marginLeft: '5px'
        });

        btn.addEventListener('click', () => {
            this._handleClick();
        });

        return btn;
    }

    /**
     * 处理点击事件
     */
    _handleClick() {
        // 构建 HTML 文件的完整路径
        const pageUrl = `${this.extensionPath}/src/_features/module-editor/index.html`;

        this.iframeModal.open(pageUrl);
    }
}