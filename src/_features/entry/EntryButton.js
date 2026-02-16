import { IframeModal } from '../../_utils/IframeModal.js';
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
    }

    /**
     * 初始化并注入按钮
     */
    init() {
        // 移除旧按钮（防止重复或类型切换残留）
        this.remove();

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
        btn.innerHTML = '⚙️';
        Object.assign(btn.style, {
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2em',
            marginLeft: '5px',
            order: '9999' // 确保排在最后
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

        // 浮动按钮样式
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            backgroundColor: 'var(--smart-background, #202123)',
            color: 'var(--smart-text-color, #fff)',
            border: '1px solid var(--smart-border-color, #444)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            cursor: 'pointer',
            zIndex: '2000',
            transition: 'transform 0.2s ease'
        });

        btn.innerHTML = '⚙️';

        // 悬停效果
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'scale(1.1)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'scale(1)';
        });

        btn.addEventListener('click', () => this._handleClick());

        document.body.appendChild(btn);
    }

    /**
     * 处理点击事件
     */
    _handleClick() {
        // 构建 HTML 文件的完整路径
        const pageUrl = `${this.extensionPath}/src/_features/module-editor/index.html`;

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