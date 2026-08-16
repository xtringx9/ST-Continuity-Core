import { IframeModal } from '../../shared/IframeModal.js';
import configManager from '../../singleton/configManager.js';
import { initModuleEditor, syncModuleTheme } from '../module-editor/ModuleEditor.js';
import { initGeneratorEditor, syncGeneratorTheme } from '../generator-editor/GeneratorEditor.js';
import { initNaiPresetSwitcher, syncNaiTheme, syncNaiPresetData } from '../nai-preset-switcher/NaiPresetSwitcher.js';
import { warnLog } from '../../utils/logger.js';
import { openContextBottomAsModal, isInChatPage } from '../../core/contextBottomUI.js';
import { openPhoneModeModal } from '../../features/phone/phoneMode.js';
import { eventSource, event_types } from '../../../../../../../script.js';

export class EntryButton {
    /**
     * @param {string} extensionPath - 插件的根目录路径 (e.g. /scripts/extensions/third-party/...)
     */
    constructor(extensionPath) {
        this.extensionPath = extensionPath;
        this.embeddedId = 'continuity-new-entry-btn';
        this.floatingId = 'continuity-new-fab-btn';
        // 编辑器 / 生成内容配置各自独立实例，均 keepAlive（关闭仅隐藏，保留未保存编辑）
        this.editorModal = new IframeModal();
        this.generatorModal = new IframeModal();
        this.naiPresetModal = new IframeModal();
        this._themeListener = null;
        this._activeMenu = null;
        this._activeTrigger = null;
        // 菜单展开期间监听 CHAT_CHANGED，进入/离开聊天时实时刷新按钮禁用状态
        this._menuChatChangedListener = null;
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

        // 如果插件未启用：通常完全不显示。
        // 例外：智绘姬NAI预设切换独立开启时，仍在其原位置显示一个独立按钮（全局工具，不依赖插件总开关）。
        if (!config.enabled) {
            if (configManager.isNaiPresetSwitcherEnabled()) {
                this._createStandaloneNaiPresetButton();
            }
            return;
        }

        const buttonType = configManager.getModuleDomainConfig().buttonType || 'embedded';

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
        this._closeMenu();
        // 清理可能由其他 EntryButton 实例遗留的菜单 DOM
        // （切换按钮类型时 extensionSettingsManager 会 new 新实例，旧实例的 _activeMenu 引用丢失）
        document.querySelectorAll('.continuity-entry-menu').forEach(el => el.remove());
        // 彻底销毁可能打开的编辑器 modal，避免 window 上的 message listener 持有引用导致 modal + iframe 无法 GC
        this.editorModal?.destroy();
        this.generatorModal?.destroy();
        this.naiPresetModal?.destroy();

        const embeddedBtn = document.getElementById(this.embeddedId);
        if (embeddedBtn) embeddedBtn.remove();

        const floatingBtn = document.getElementById(this.floatingId);
        if (floatingBtn) floatingBtn.remove();

        const standaloneNaiBtn = document.getElementById('continuity-nai-preset-standalone');
        if (standaloneNaiBtn) standaloneNaiBtn.remove();

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
        btn.title = 'Continuity 菜单';

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
            this._toggleMenu(btn);
        });

        targetContainer.appendChild(btn);
    }

    /**
     * 创建浮动式按钮
     */
    _createFloatingButton() {
        const btn = document.createElement('div');
        btn.id = this.floatingId;
        btn.title = 'Continuity 菜单';
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

        btn.addEventListener('click', () => this._toggleMenu(btn));

        document.body.appendChild(btn);
    }

    /**
     * 打开「智绘姬NAI预设切换」抽屉（左侧）。
     * 菜单项与独立按钮共用同一入口。
     */
    _openNaiPresetDrawer() {
        this._ensureOnlyOneModal('nai-preset');
        const pageUrl = `${this.extensionPath}/src/features/nai-preset-switcher/index.html`;
        this.naiPresetModal.open(pageUrl, '智绘姬NAI预设切换', {
            variant: 'drawer-left',
            keepAlive: true,
            onLoad: (iframe) => {
                this.naiPresetIframe = iframe;
                const doc = iframe.contentDocument;
                if (doc) {
                    const closeBtn = doc.getElementById('close-btn');
                    if (closeBtn) {
                        closeBtn.addEventListener('click', () => this.naiPresetModal.close());
                    }
                    initNaiPresetSwitcher(doc);
                }
            }
        });
        // keepAlive 重开不重新 onLoad，补取一次主题让抽屉与当前设置一致
        syncNaiTheme(this.naiPresetIframe?.contentDocument);
        // 同时重读智绘姬数据层（当前预设 / 列表），让外部改动即时反映到本页
        syncNaiPresetData(this.naiPresetIframe?.contentDocument);
    }

    /**
     * 创建独立「智绘姬NAI预设切换」按钮（插件总开关关闭、但本功能开启时）。
     * 显示在 Cc 原嵌入式位置（#leftSendForm），点击直接打开抽屉，不带 Cc 菜单。
     */
    _createStandaloneNaiPresetButton() {
        const targetContainer = document.querySelector('#form_sheld #send_form #nonQRFormItems #leftSendForm');
        if (!targetContainer) {
            warnLog('[Continuity] 无法找到独立 NAI 预设按钮注入容器 (#leftSendForm)');
            return;
        }

        const btn = document.createElement('div');
        btn.id = 'continuity-nai-preset-standalone';
        btn.className = 'mes_text_paste';
        btn.title = '智绘姬NAI预设切换';
        btn.innerHTML = '<i class="fa-solid fa-palette"></i>';
        Object.assign(btn.style, {
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '13px',
            fontWeight: 'bold',
            marginLeft: '5px',
            order: '9999',
            border: '2px solid var(--smart-border-color, rgba(128,128,128,0.5))',
            borderRadius: '6px',
            width: '30px',
            height: '30px',
            boxSizing: 'border-box'
        });
        btn.addEventListener('click', () => this._openNaiPresetDrawer());
        targetContainer.appendChild(btn);
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
     * 切换菜单显示
     */
    _toggleMenu(triggerBtn) {
        if (this._activeMenu) {
            this._closeMenu();
            return;
        }
        this._createMenu(triggerBtn);
    }

    /**
     * 创建并显示菜单（向右展开）
     *
     * 菜单容器有边框，内部按钮无边框，作为一个整体视觉组。
     * 高度对齐：触发器 30px（border-box 含 2px border），
     *   菜单 height:30px + box-sizing:border-box → 内容区 26px = 按钮 26x26
     */
    _createMenu(triggerBtn) {
        const menu = document.createElement('div');
        menu.className = 'continuity-entry-menu';

        // 嵌入式：菜单作为 #leftSendForm 的 flex 子元素，推开输入框避免覆盖
        // 浮动式：菜单 fixed 定位向右展开
        const isEmbedded = triggerBtn.id === this.embeddedId;

        const baseStyle = {
            display: 'flex',
            gap: '0',
            // 容器边框：与触发器边框样式一致，按钮作为整体
            border: '2px solid var(--smart-border-color, rgba(128,128,128,0.5))',
            borderRadius: '6px',
            padding: '0',
            height: '30px', // 显式锁死，对齐触发器
            boxSizing: 'border-box',
            backgroundColor: 'transparent',
        };

        if (isEmbedded) {
            Object.assign(menu.style, baseStyle, {
                width: 'auto', // inline 覆盖 #leftSendForm>div 的 width:var(--bottomFormBlockSize)
                marginLeft: '2px',
                order: '10000', // 排在 Cc 触发器(order:9999)之后，紧贴其右侧
            });
        } else {
            const rect = triggerBtn.getBoundingClientRect();
            Object.assign(menu.style, baseStyle, {
                position: 'fixed',
                left: `${rect.right + 4}px`,
                top: `${rect.top}px`,
                zIndex: '2001',
            });
        }

        const items = [
            { action: 'editor', icon: 'fa-cog', title: '打开编辑器' },
            { action: 'generator-editor', icon: 'fa-wand-magic-sparkles', title: '生成内容配置' },
            { action: 'summary', icon: 'fa-table-list', title: '模块汇总' },
            { action: 'mobile', icon: 'fa-mobile-screen', title: '手机模式' },
            { action: 'nai-preset', icon: 'fa-palette', title: '智绘姬NAI预设切换' },
        ];

        items.forEach(item => {
            // 智绘姬 NAI 预设切换按钮：功能未开启则不注入菜单（门控在源头）
            if (item.action === 'nai-preset' && !configManager.isNaiPresetSwitcherEnabled()) {
                return;
            }
            const btn = document.createElement('div');
            btn.className = 'continuity-entry-menu-item';
            btn.dataset.action = item.action;
            btn.dataset.title = item.title;
            btn.innerHTML = `<i class="fa-solid ${item.icon}"></i>`;
            Object.assign(btn.style, {
                width: '26px',
                height: '26px',
                // 无边框：由父容器统一边框
                borderRadius: '4px',
                // ⚠️ 不设 color：让图标继承父容器（#leftSendForm）文本色，与 Cc 触发器 / messageAiButton 图标一致。
                // 之前用 var(--smart-text-color, #fff) 是 ST 非标准变量，部分主题未定义 → fallback #fff，
                // 浅色主题下图标变白不可见，导致"不同主题颜色不一致"。
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                boxSizing: 'border-box',
                transition: 'background-color 0.2s',
            });

            // 事件常驻绑定：点击/hover 时按当前禁用状态实时判断，
            // 使得进入聊天后无需重建菜单即可生效。
            btn.addEventListener('mouseenter', () => {
                if (btn.dataset.disabled === 'true') return;
                btn.style.backgroundColor = 'var(--smart-border-color, rgba(128,128,128,0.3))';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.backgroundColor = '';
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.dataset.disabled === 'true') return;
                this._handleMenuAction(btn.dataset.action);
                // 不自动关闭：菜单保持展开，仅再次点击 Cc 触发器才收起
            });

            menu.appendChild(btn);
        });

        if (isEmbedded) {
            // 放回 #leftSendForm（Cc 按钮父容器），紧贴 Cc 按钮右侧像衍生
            // inline width:auto 覆盖 #leftSendForm>div 的固定正方形尺寸
            triggerBtn.parentElement.appendChild(menu);
        } else {
            document.body.appendChild(menu);
        }
        this._activeMenu = menu;
        this._activeTrigger = triggerBtn;

        // 依据当前聊天状态设置各按钮的禁用样式
        this._refreshMenuItemsState();

        // 触发器激活样式（用 filter 避免主题色冲突）
        triggerBtn.style.filter = 'brightness(0.85)';

        // 菜单展开期间监听 CHAT_CHANGED：进入聊天后实时解禁按钮，
        // 无需再次折叠/展开。菜单关闭时（_closeMenu）会移除该监听。
        this._menuChatChangedListener = () => this._refreshMenuItemsState();
        eventSource.on(event_types.CHAT_CHANGED, this._menuChatChangedListener);

        // 菜单常驻：不注册外部点击/滚动/resize 关闭监听，
        // 仅再次点击 Cc 触发器（_toggleMenu）才会收起。
    }

    /**
     * 根据当前是否在聊天页，刷新菜单内各按钮的禁用状态。
     *
     * 非聊天页：汇总/手机按钮置灰禁用（编辑器、生成内容配置是全局配置，不依赖聊天）。
     * 通过 dataset.disabled 标记状态，常驻的 click/hover 监听据此实时判断。
     */
    _refreshMenuItemsState() {
        if (!this._activeMenu) return;
        const inChat = isInChatPage();
        this._activeMenu.querySelectorAll('.continuity-entry-menu-item').forEach(btn => {
            const action = btn.dataset.action;
            const title = btn.dataset.title || '';
            // nai-preset 是全局工具，不受聊天页限制（与 editor/generator-editor 同等待遇）
            const disabled = !inChat && action !== 'editor' && action !== 'generator-editor' && action !== 'nai-preset';
            btn.dataset.disabled = disabled ? 'true' : 'false';
            if (disabled) {
                btn.style.opacity = '0.4';
                btn.style.cursor = 'not-allowed';
                btn.style.backgroundColor = '';
                btn.title = `${title}（需先打开聊天）`;
            } else {
                btn.style.opacity = '';
                btn.style.cursor = 'pointer';
                btn.title = title;
            }
        });
    }

    /**
     * 关闭菜单
     */
    _closeMenu() {
        // 移除菜单展开期间的 CHAT_CHANGED 监听，避免泄漏
        if (this._menuChatChangedListener) {
            eventSource.removeListener(event_types.CHAT_CHANGED, this._menuChatChangedListener);
            this._menuChatChangedListener = null;
        }
        if (this._activeMenu) {
            this._activeMenu.remove();
            this._activeMenu = null;
        }
        // 恢复触发器样式
        if (this._activeTrigger) {
            this._activeTrigger.style.filter = '';
            this._activeTrigger = null;
        }
    }

    /**
     * 菜单项动作分发
     */
    _handleMenuAction(action) {
        switch (action) {
            case 'editor':
                this._handleClick();
                break;
            case 'generator-editor': {
                this._ensureOnlyOneModal('generator');
                const pageUrl = `${this.extensionPath}/src/features/generator-editor/index.html`;
                this.generatorModal.open(pageUrl, '生成内容配置', {
                    variant: 'drawer-left',
                    keepAlive: true,
                    onLoad: (iframe) => {
                        this.generatorIframe = iframe;
                        const doc = iframe.contentDocument;
                        if (doc) {
                            initGeneratorEditor(doc);
                            const closeBtn = doc.getElementById('close-btn');
                            if (closeBtn) {
                                closeBtn.addEventListener('click', () => this.generatorModal.close());
                            }
                        }
                    }
                });
                // keepAlive 重开不重新 onLoad，补取一次主题让抽屉与当前设置一致
                syncGeneratorTheme(this.generatorIframe?.contentDocument);
                break;
            }
            case 'summary':
                openContextBottomAsModal();
                break;
            case 'mobile':
                openPhoneModeModal(this.extensionPath);
                break;
            case 'nai-preset': {
                this._openNaiPresetDrawer();
                break;
            }
        }
    }

    /**
     * 确保同时只显示一个编辑器类 modal：打开 target 前先把另一个隐藏（keepAlive，不丢编辑）。
     * @param {'editor'|'generator'} target
     */
    _ensureOnlyOneModal(target) {
        if (target !== 'editor') this.editorModal.close();
        if (target !== 'generator') this.generatorModal.close();
        if (target !== 'nai-preset') this.naiPresetModal.close();
    }

    /**
     * 处理点击事件（打开编辑器）
     */
    _handleClick() {
        // 构建 HTML 文件的完整路径
        const pageUrl = `${this.extensionPath}/src/features/module-editor/index.html`;

        this.editorModal.open(pageUrl, 'Continuity Editor', {
            variant: 'drawer-left', // 显式指定样式，以后可以改成 'center' 或 'drawer-right'
            keepAlive: true,
            onLoad: (iframe) => {
                this.editorIframe = iframe;
                const doc = iframe.contentDocument;
                if (doc) {
                    // 初始化编辑器逻辑 (传入 iframe 的 document)
                    initModuleEditor(doc);

                    // 绑定内部关闭按钮
                    const closeBtn = doc.getElementById('close-btn');
                    if (closeBtn) {
                        closeBtn.addEventListener('click', () => this.editorModal.close());
                    }
                }
            }
        });
        // keepAlive 重开不重新 onLoad，补取一次主题让抽屉与当前设置一致
        syncModuleTheme(this.editorIframe?.contentDocument);
    }
}
