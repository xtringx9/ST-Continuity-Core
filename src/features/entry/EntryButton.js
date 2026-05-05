import { IframeModal } from '../../shared/IframeModal.js';
import configManager from '../../singleton/configManager.js';
import { initModuleEditor } from '../module-editor/ModuleEditor.js';
import { warnLog } from '../../utils/logger.js';

export class EntryButton {
    /**
     * @param {string} extensionPath - 插件的根目录路径 (e.g. /scripts/extensions/third-party/...)
     */
    constructor(extensionPath) {
        this.extensionPath = extensionPath;
        this.embeddedId = 'continuity-new-entry-btn';
        this.floatingId = 'continuity-new-fab-btn';
        this.iframeModal = new IframeModal();
        this._themeListener = null;
    }

    /**
     * 初始化并注入按钮
     */
    init() {
        // 移除旧按钮（防止重复或类型切换残留）
        this.remove();

        // 加载模态框所需的 CSS
        this._loadModalCSS();
        this._injectButtonStyles();

        // 获取配置
        const config = configManager.getExtensionConfig();

        // 如果插件未启用，不显示按钮
        if (!config.enabled) {
            return;
        }

        const buttonType = config.buttonType || 'embedded';

        if (buttonType === 'floating') {
            this._createFloatingButton();
        } else {
            this._createEmbeddedButton();
        }
    }

    /**
     * 移除按钮
     */
    remove() {
        const embeddedBtn = document.getElementById(this.embeddedId);
        if (embeddedBtn) embeddedBtn.remove();

        const floatingBtn = document.getElementById(this.floatingId);
        if (floatingBtn) floatingBtn.remove();

        if (this._themeListener) {
            window.removeEventListener('storage', this._themeListener);
            window.removeEventListener('continuity-theme-change', this._themeListener);
            this._themeListener = null;
        }
    }

    /**
     * 创建嵌入式按钮
     */
    _createEmbeddedButton() {
        // 寻找注入点：SillyTavern 的左侧发送按钮区域
        // 参考路径: #form_sheld > #send_form > #nonQRFormItems > #leftSendForm
        const targetContainer = document.querySelector('#form_sheld #send_form #nonQRFormItems #leftSendForm');

        if (!targetContainer) {
            warnLog('[Continuity] 无法找到按钮注入容器 (#leftSendForm)');
            return;
        }

        const btn = document.createElement('div');
        btn.id = this.embeddedId;

        // 使用 ST 的通用按钮类名，保持外观一致性
        btn.className = 'mes_text_paste';
        btn.title = '打开 Continuity 配置 (Iframe)';

        // 简单的图标样式
        btn.innerHTML = 'Cc';
        Object.assign(btn.style, {
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '13px',
            fontWeight: 'bold',
            marginLeft: '5px',
            order: '9999', // 确保排在最后
            border: '2px solid var(--smart-border-color, rgba(128,128,128,0.5))',
            borderRadius: '6px',
            width: '30px',
            height: '30px',
            boxSizing: 'border-box'
        });

        btn.addEventListener('click', () => {
            this._handleClick();
        });

        targetContainer.appendChild(btn);
    }

    /**
     * 创建浮动式按钮
     */
    _createFloatingButton() {
        const btn = document.createElement('div');
        btn.id = this.floatingId;
        btn.title = '打开 Continuity 配置 (Iframe)';
        btn.innerHTML = 'Cc';

        // 初始化主题
        this._updateButtonTheme(btn);

        // 监听主题变化 (跨窗口/Iframe + 同窗口)
        this._themeListener = (e) => {
            if (e.type === 'storage' && e.key !== 'st_continuity_theme') return;
            this._updateButtonTheme(btn);
        };
        window.addEventListener('storage', this._themeListener);
        window.addEventListener('continuity-theme-change', this._themeListener);

        btn.addEventListener('click', () => this._handleClick());

        document.body.appendChild(btn);
    }

    /**
     * 加载 IframeModal 所需的 CSS 文件
     */
    _loadModalCSS() {
        const cssId = 'st-continuity-modal-styles';
        if (document.getElementById(cssId)) {
            return; // 已加载
        }

        const link = document.createElement('link');
        link.id = cssId;
        link.rel = 'stylesheet';
        link.href = `${this.extensionPath}/src/features/module-editor/styles/modal.css`;

        document.head.appendChild(link);
    }

    /**
     * 更新按钮主题样式
     */
    _updateButtonTheme(btn) {
        const theme = localStorage.getItem('st_continuity_theme') || 'light';
        btn.setAttribute('data-theme', theme);
    }

    /**
     * 注入按钮样式 (支持响应式)
     */
    _injectButtonStyles() {
        const styleId = 'continuity-entry-btn-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            #${this.floatingId} {
                position: absolute;
                bottom: 138px;
                left: 10px;
                width: 30px;
                height: 30px;
                border-radius: 6px;
                background-color: var(--smart-background, #202123);
                color: var(--smart-text-color, #fff);
                border: 2px solid var(--smart-border-color, rgba(128,128,128,0.5));
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 13px;
                font-weight: bold;
                cursor: pointer;
                z-index: 2000;
                box-sizing: border-box;
                transition: transform 0.2s ease, background-color 0.3s, color 0.3s, border-color 0.3s;
            }
            #${this.floatingId}:hover {
                transform: scale(1.1);
            }
            #${this.floatingId}[data-theme="light"] {
                background-color: #ffffff;
                color: #333333;
                border-color: #cccccc;
            }
            #${this.floatingId}[data-theme="dark"] {
                background-color: #202123;
                color: #ffffff;
                border-color: rgba(128,128,128,0.5);
            }
            @media (max-width: 768px) {
                #${this.floatingId} {
                    bottom: 150px;
                    left: 15px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 处理点击事件
     */
    _handleClick() {
        // 构建 HTML 文件的完整路径
        const pageUrl = `${this.extensionPath}/src/features/module-editor/index.html`;

        this.iframeModal.open(pageUrl, 'Continuity Editor', {
            variant: 'drawer-left', // 显式指定样式，以后可以改成 'center' 或 'drawer-right'
            onLoad: (iframe) => {
                const doc = iframe.contentDocument;
                if (doc) {
                    // 初始化编辑器逻辑 (传入 iframe 的 document)
                    initModuleEditor(doc);

                    // 绑定内部关闭按钮
                    const closeBtn = doc.getElementById('close-btn');
                    if (closeBtn) {
                        closeBtn.addEventListener('click', () => this.iframeModal.close());
                    }
                }
            }
        });
    }
}
