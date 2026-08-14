/**
 * 模块编辑器主逻辑
 * 注意：此脚本现在运行在主窗口上下文中，直接操作 Iframe 的 DOM
 */

import { translate } from '../../../../../../i18n.js';
import configManager from '../../singleton/configManager.js';
import { debugLog, infoLog } from '../../utils/logger.js';
import { renderGlobalSettings } from './GlobalSettings.js';
import { renderToolbox } from './Toolbox.js';
import { initCharacterBinding } from './CharacterBinding.js';
import { parseModuleString, validateModuleString } from '../../modules/moduleParser.js';
import { IframeDialog } from '../../shared/IframeDialog.js';
import { generateChangesSummary } from './ChangesSummary.js';
import { handleExport, handleImport } from './ImportExport.js';
import { renderModuleDetail } from './ModuleDetailRenderer.js';
import { generateModuleFormat } from '../../modules/promptGenerator.js';
import { handleDragStart, handleDragOver, handleDragEnter, handleDragLeave, handleDrop, handleDragEnd } from './DragHandler.js';
import { persistScroll, restoreScroll } from '../../shared/scrollPersistence.js';

// === 状态管理 ===
let originalModules = []; // 保存时用于比较的原始模块列表
let currentModules = []; // 当前编辑的模块列表副本
let originalGlobalSettings = {}; // 保存时用于比较的原始全局设置
let currentGlobalSettings = {}; // 当前编辑的全局设置副本
let selectedModuleId = null; // 记录当前选中的模块 ID
let activeDetailTab = 'module-detail-settings'; // 记录当前详情页的活动Tab
let activeViewSectionId = 'view-modules'; // 当前主视图的活动ID
let searchTerm = ''; // 搜索关键词

// 模块列表滚动位置记忆：重新打开编辑器 / 重渲后还原，避免频繁编辑时列表跳回顶部
const MODULE_LIST_SCROLL_KEY = 'ccore_modulelist_scroll';
// 注意：本脚本运行在父窗口上下文，模块级变量跨编辑器开关不重置。
// 因此不能用"一次性首次渲染"标志来区分"重新打开"与"同会话内重渲"，
// 而要用 doc（iframe 的 document）对象身份：新 iframe 的 doc 是不同对象 → 还原存档；
// 同 iframe 内重渲 doc 不变 → 保留当前位置。
let lastRenderedDoc = null;

// 全局文档引用 (指向 Iframe 的 document)
let doc = null;

/**
 * 手动应用 iframe 内的 data-i18n 翻译
 * ST 的 MutationObserver 只监听主文档，不会处理 iframe 内的 data-i18n 属性
 */
function applyI18nToStaticElements(doc) {
    doc.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translated = translate(key);
        if (translated && translated !== key) {
            el.textContent = translated;
        }
    });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const translated = translate(key);
        if (translated && translated !== key) {
            el.placeholder = translated;
        }
    });
}

/**
 * 复制文本到剪贴板（兼容非安全上下文，如 HTTP 局域网）
 */
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
    } catch (err) {
        console.error('[ModuleEditor] 复制失败:', err);
    }
}

/**
 * 初始化模块编辑器
 * @param {Document} iframeDocument Iframe 的文档对象
 */
export function initModuleEditor(iframeDocument) {
    doc = iframeDocument;
    debugLog("ModuleEditor initialized with document context");

    // 应用静态文本翻译 — iframe 内 ST 的 MutationObserver 不会运行，需手动遍历
    applyI18nToStaticElements(doc);

    // 从 localStorage 加载上次打开的页面
    activeViewSectionId = localStorage.getItem('continuity_editor_last_tab') || 'view-modules';

    // 加载真实数据 (深拷贝以避免直接修改引用，直到保存)
    const modules = configManager.getModules(true); // true 表示获取所有模块(包括禁用的)
    currentModules = JSON.parse(JSON.stringify(modules));
    resyncModuleOrders(); // 让 order 与数组 index 保持一致，避免宏输出顺序与编辑器显示顺序脱节
    originalModules = JSON.parse(JSON.stringify(currentModules));

    // 加载全局设置
    originalGlobalSettings = JSON.parse(JSON.stringify(configManager.getGlobalSettings()));
    currentGlobalSettings = JSON.parse(JSON.stringify(originalGlobalSettings));

    // 初始化视图
    renderModuleList();

    // 实时记忆模块列表滚动位置（关闭/重新打开编辑器时还原）
    const mlEl = doc.getElementById('module-list');
    if (mlEl) {
        mlEl.addEventListener('scroll', () => persistScroll(mlEl, MODULE_LIST_SCROLL_KEY));
    }

    // 恢复上次选中的模块详情
    if (selectedModuleId) {
        const selectedIndex = currentModules.findIndex(m => m.name === selectedModuleId);
        if (selectedIndex !== -1) {
            renderModuleDetail(currentModules[selectedIndex], selectedIndex, doc, checkForChanges, deleteModule, renderModuleList, activeDetailTab, (tabId) => { activeDetailTab = tabId; }, currentModules, renderModuleList, (name) => { selectedModuleId = name; });
        }
    }

    renderToolbox(doc, currentModules);
    renderGlobalSettings(doc, currentGlobalSettings, checkForChanges);

    // 初始化角色绑定页（左栏角色树 + 右栏编辑器骨架）
    initCharacterBinding(doc);

    // 绑定调试按钮 (打印当前编辑器状态)
    bindDebugStateButton();

    // 绑定顶部栏事件 (主题切换等)
    bindHeaderEvents();

    // 绑定导航事件
    bindNavigationEvents();

    // 绑定侧边栏事件 (搜索和添加)
    bindSidebarEvents();

    // ---- 设置初始活动页面 ----
    const navItems = doc.querySelectorAll('.nav-item');
    const sections = doc.querySelectorAll('.view-section');
    navItems.forEach(n => n.classList.remove('active'));
    sections.forEach(s => s.classList.remove('active'));

    const initialNavItem = doc.querySelector(`.nav-item[data-target="${activeViewSectionId}"]`);
    const initialSection = doc.getElementById(activeViewSectionId);

    if (initialNavItem && initialSection) {
        initialNavItem.classList.add('active');
        initialSection.classList.add('active');
    } else {
        // Fallback to the first one if the saved one is invalid
        const firstNavItem = doc.querySelector('.nav-item');
        if (firstNavItem) {
            const firstTargetId = firstNavItem.getAttribute('data-target');
            firstNavItem.classList.add('active');
            doc.getElementById(firstTargetId)?.classList.add('active');
            activeViewSectionId = firstTargetId; // Update state
        }
    }

    // 控制"清空模块"按钮的初始显示/隐藏
    doc.getElementById('header-clear-btn').style.display = (activeViewSectionId === 'view-modules') ? 'inline-block' : 'none';

    // 初始化保存按钮状态
    checkForChanges();
}

function bindHeaderEvents() {
    const saveBtn = doc.getElementById('header-save-btn');
    if (saveBtn) {
        // 移除旧的监听器（如果有）
        saveBtn.replaceWith(saveBtn.cloneNode(true));
        doc.getElementById('header-save-btn').addEventListener('click', confirmAndSave);
    }

    const exportBtn = doc.getElementById('header-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            // 直接导出 configManager 中的数据，不强制保存
            handleExport(doc);
        });
    }

    const importBtn = doc.getElementById('header-import-btn');
    if (importBtn) {
        importBtn.addEventListener('click', onImportClick);
    }

    // 动态注入清空按钮 (放在导入按钮左边)
    let clearBtn = doc.getElementById('header-clear-btn');
    if (!clearBtn && importBtn) {
        clearBtn = doc.createElement('button');
        clearBtn.id = 'header-clear-btn';
        clearBtn.className = 'btn-secondary';
        clearBtn.style.marginRight = '5px';
        clearBtn.style.color = 'var(--text-error, #ff6b6b)';

        // 插入到导入按钮之前
        importBtn.parentNode.insertBefore(clearBtn, importBtn);
    }

    if (clearBtn) {
        clearBtn.textContent = translate('ccore_btn_clear_modules');
        clearBtn.addEventListener('click', clearAllModules);
    }

    // 绑定点击标题切换主题
    const headerTitle = doc.querySelector('.header-title') || doc.getElementById('header-title');
    if (headerTitle) {
        // 初始化主题 (读取本地存储)
        const savedTheme = localStorage.getItem('st_continuity_theme') || 'light';
        doc.documentElement.setAttribute('data-theme', savedTheme);

        // 跨 iframe 联动：同源其他窗口写入主题后，本 iframe 收到 storage 事件并同步
        window.addEventListener('storage', (e) => {
            if (e.key !== 'st_continuity_theme') return;
            doc.documentElement.setAttribute('data-theme', e.newValue || 'light');
        });

        headerTitle.style.cursor = 'pointer';
        headerTitle.title = translate('ccore_title_toggle_theme');

        headerTitle.addEventListener('click', () => {
            const current = doc.documentElement.getAttribute('data-theme') || 'light';
            const next = current === 'light' ? 'dark' : 'light';
            doc.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('st_continuity_theme', next);
            // 派发自定义事件，通知同一窗口下的其他组件（如 EntryButton）
            window.dispatchEvent(new CustomEvent('continuity-theme-change'));
        });
    }
}

function bindDebugStateButton() {
    const btn = doc.getElementById('btn-debug-state');
    if (btn) {
        // 应用翻译
        btn.textContent = translate('ccore_btn_debug_state');

        // 绑定点击事件
        btn.addEventListener('click', () => {
            infoLog("[Debug] === Editor State Dump ===");
            infoLog("[Debug] Original Modules (Saved):", originalModules);
            infoLog("[Debug] Current Modules (Editing):", currentModules);
            infoLog("[Debug] =========================");
        });
    }
}

function bindNavigationEvents() {
    const navItems = doc.querySelectorAll('.nav-item');
    const sections = doc.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // 1. 移除所有 active 状态
            navItems.forEach(n => n.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));

            // 2. 激活当前项
            item.classList.add('active');
            const targetId = item.getAttribute('data-target');
            const targetSection = doc.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');
            }

            // 保存当前激活的页面ID
            localStorage.setItem('continuity_editor_last_tab', targetId);
            activeViewSectionId = targetId;

            // 进入模块视图时还原上次滚动位置（重新打开编辑器/切回本视图后不再跳回顶部）
            if (targetId === 'view-modules') {
                restoreModuleListScroll();
            }

            // 控制"清空模块"按钮的显示/隐藏
            const clearBtn = doc.getElementById('header-clear-btn');
            if (clearBtn) {
                // 假设 'view-modules' 是模块列表页面的 ID
                clearBtn.style.display = (targetId === 'view-modules') ? 'inline-block' : 'none';
            }
        });
    });
}

function bindSidebarEvents() {
    const toolbar = doc.querySelector('.module-list-panel .list-toolbar');
    if (!toolbar) return;

    const searchInput = toolbar.querySelector('input');
    const addBtn = toolbar.querySelector('button');

    if (searchInput) {
        // 更新 placeholder
        searchInput.placeholder = translate('ccore_search_add_placeholder');

        // 绑定搜索输入
        searchInput.addEventListener('input', (e) => {
            searchTerm = e.target.value.trim().toLowerCase();
            renderModuleList();
        });

        // 绑定回车键添加
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && addBtn) {
                addBtn.click();
            }
        });
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const inputValue = searchInput ? searchInput.value.trim() : '';
            if (searchInput) {
                searchInput.value = '';
                searchTerm = '';
            }
            handleSmartAdd(inputValue);
        });
    }
}

/**
 * 将 currentModules 中每个模块的 order 同步为其当前数组 index
 * 在 renderModuleList 开头调用，保证拖拽/新建/删除/导入后 order 与显示顺序一致
 */
function resyncModuleOrders() {
    currentModules.forEach((mod, index) => {
        mod.order = index;
    });
}

/**
 * 渲染模块列表
 */
function renderModuleList() {
    resyncModuleOrders();
    const listContainer = doc.getElementById('module-list');
    const prevScroll = listContainer.scrollTop; // 重渲前记录（刷新 iframe 后此处为 0）
    listContainer.innerHTML = ''; // 清空

    currentModules.forEach((mod, index) => {
        // 搜索过滤
        if (searchTerm) {
            const name = (mod.name || '').toLowerCase();
            const displayName = (mod.displayName || '').toLowerCase();
            if (!name.includes(searchTerm) && !displayName.includes(searchTerm)) {
                return;
            }
        }

        const item = doc.createElement('div');
        item.className = 'module-list-item';
        item.setAttribute('draggable', 'true'); // 启用拖拽
        item.dataset.index = index; // 存储索引
        item.dataset.moduleName = mod.name; // 存储模块名，便于复制后精准定位
        item.__moduleRef = mod; // 存储模块对象引用，供改名后稳定定位列表项
        if (!mod.enabled) item.classList.add('disabled');
        // 如果是当前选中的模块，添加 active 类
        if (mod.name === selectedModuleId) { // 使用 name 作为 ID
            item.classList.add('active');
        }

        // 列表项简化：只显示名字和ID
        item.innerHTML = `
            <div class="module-item-content">
                <div class="module-item-header">
                    <span class="module-item-name">${mod.displayName || mod.name}</span>
                    <small style="opacity: 0.5; font-size: 0.8em;">#${mod.name}${mod.variables && mod.variables.length ? ` · ${mod.variables.length}` : ''}</small>
                </div>
            </div>
            <div class="module-item-actions">
                <span class="module-copy-module-btn" title="${translate('ccore_title_copy_module')}">⧈</span>
                <span class="module-copy-format-btn" title="${translate('ccore_title_copy_format')}">⧉</span>
                <label class="toggle-switch" title="${translate('ccore_title_toggle_enabled')}">
                    <input type="checkbox" class="module-enable-toggle" ${mod.enabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </div>
        `;

        // 点击事件
        item.addEventListener('click', () => {
            // 移除其他选中状态
            doc.querySelectorAll('.module-list-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            selectedModuleId = mod.name;
            renderModuleDetail(mod, index, doc, checkForChanges, deleteModule, renderModuleList, activeDetailTab, (tabId) => { activeDetailTab = tabId; }, currentModules, renderModuleList, (name) => { selectedModuleId = name; });

            // 移动端适配：点击后切换到详情视图
            if (window.innerWidth <= 768) {
                doc.body.classList.add('mobile-view-detail-module');
            }
        });

        // 绑定启用/禁用开关事件
        const toggle = item.querySelector('.module-enable-toggle');
        toggle.addEventListener('click', (e) => {
            mod.enabled = e.target.checked;
            if (!mod.enabled) item.classList.add('disabled');
            else item.classList.remove('disabled');

            checkForChanges(); // 检查变更
        });

        // 绑定复制格式按钮事件
        const copyBtn = item.querySelector('.module-copy-format-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const formatStr = generateModuleFormat(mod, true, true).trim();
                copyToClipboard(formatStr);
                // 短暂反馈
                copyBtn.textContent = '✓';
                setTimeout(() => { copyBtn.textContent = '⧉'; }, 1000);
            });
        }

        // 绑定复制整个模块按钮事件
        const copyModuleBtn = item.querySelector('.module-copy-module-btn');
        if (copyModuleBtn) {
            copyModuleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                duplicateModule(mod);
            });
        }

        // 阻止开关容器的点击冒泡，防止触发列表项选中 (特别是点击 label/span 时)
        const actions = item.querySelector('.module-item-actions');
        if (actions) {
            actions.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // 绑定拖拽事件
        item.addEventListener('dragstart', (e) => handleDragStart(e, item, 'module', item));
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', (e) => handleDrop(e, item, 'module', currentModules, () => {
            renderModuleList();
            checkForChanges(); // 检查变更
        }));
        item.addEventListener('dragend', (e) => handleDragEnd(e, doc));

        listContainer.appendChild(item);
    });

    // 还原滚动位置：
    // - 新 iframe（重新打开编辑器，doc 为不同对象）从 localStorage 读取上次位置；
    // - 否则（同 iframe 内重渲：搜索/保存/拖拽）沿用本次重渲前的位置，避免跳回顶部。
    if (doc !== lastRenderedDoc) {
        lastRenderedDoc = doc;
        restoreModuleListScroll();
    } else {
        listContainer.scrollTop = prevScroll;
    }
}

// 从 localStorage 还原模块列表滚动位置（仅在模块视图可见时有效，隐藏元素设置 scrollTop 无效）
function restoreModuleListScroll() {
    const el = doc.getElementById('module-list');
    if (!el) return;
    if (!doc.getElementById('view-modules')?.classList.contains('active')) return;
    restoreScroll(el, MODULE_LIST_SCROLL_KEY);
}

/**
 * 复制整个模块（深拷贝）
 * 生成唯一 name（name_copy / name_copy_2 ... 自动去重），displayName 保持原名，
 * 追加到列表末尾，并自动跳转选中新模块（与"新建模块"行为一致）
 * @param {object} sourceMod 源模块对象（currentModules 中的引用）
 */
function duplicateModule(sourceMod) {
    const copy = JSON.parse(JSON.stringify(sourceMod)); // 深拷贝（含全部属性与变量）

    // 生成唯一模块名，避免与现有模块冲突
    const existingNames = currentModules.map(m => m.name);
    let newName = `${sourceMod.name}_copy`;
    let suffix = 2;
    while (existingNames.includes(newName)) {
        newName = `${sourceMod.name}_copy_${suffix}`;
        suffix++;
    }
    copy.name = newName;
    // displayName 保持原名，不改写

    copy.order = currentModules.length;
    currentModules.push(copy);

    renderModuleList();

    // 自动选中并打开新模块详情，方便立即改名
    selectedModuleId = newName;
    const newItem = doc.querySelector(`.module-list-item[data-module-name="${CSS.escape(newName)}"]`);
    if (newItem) newItem.click();

    // 移动端适配：切换到详情视图
    if (window.innerWidth <= 768) {
        doc.body.classList.add('mobile-view-detail-module');
    }

    checkForChanges(); // 标记变更
}

/**
 * 创建新模块
 * @param {string} name 可选的模块名称
 */
function createNewModule(name) {
    const newModule = {
        name: name || `new_module_${Date.now()}`,
        displayName: name || translate('ccore_msg_new_module'),
        compatibleModuleNames: '',
        order: currentModules.length,
        enabled: true,
        prompt: '',
        timingPrompt: '',
        contentPrompt: '',
        positionPrompt: '',
        outputPosition: 'after_body',
        outputMode: 'full',
        retainLayers: -1,
        rangeMode: 'specified',
        itemMin: 0,
        itemMax: 1,
        timeReferenceStandard: false,
        isExternalDisplay: false,
        includeInModuleData: true,
        externalStyles: '',
        containerStyles: '',
        customStyles: '',
        variables: []
    };
    currentModules.push(newModule);
    renderModuleList();
    // 自动选中新模块
    const lastIndex = currentModules.length - 1;
    selectedModuleId = newModule.name;
    // 触发点击以显示详情
    const items = doc.querySelectorAll('.module-list-item');
    if (items[lastIndex]) items[lastIndex].click();

    // 自动保存
    checkForChanges(); // 检查变更
}

/**
 * 智能添加模块：根据输入内容决定是解析还是新建
 * @param {string} inputValue 输入框内容
 */
function handleSmartAdd(inputValue) {
    if (!inputValue) {
        createNewModule();
        return;
    }

    // 尝试解析为模块字符串
    const moduleMatches = parseNestedModules(inputValue);

    if (moduleMatches && moduleMatches.length > 0) {
        // 是模块格式字符串，执行解析添加逻辑
        let createdCount = 0;
        let updatedCount = 0;

        moduleMatches.forEach(match => {
            if (validateModuleString(match)) {
                const parsedModule = parseModuleString(match);
                if (parsedModule) {
                    // 查找现有模块
                    const existingModule = currentModules.find(m => m.name === parsedModule.name);

                    if (existingModule) {
                        // 更新现有模块：合并变量
                        if (!existingModule.variables) existingModule.variables = [];

                        parsedModule.variables.forEach(newVar => {
                            const existingVar = existingModule.variables.find(v => v.name === newVar.name);
                            if (existingVar) {
                                // 更新描述
                                if (newVar.description) existingVar.description = newVar.description;
                            } else {
                                // 添加新变量
                                existingModule.variables.push({
                                    name: newVar.name,
                                    displayName: newVar.displayName || newVar.name, // 优先使用解析出的显示名
                                    description: newVar.description || '',
                                    enabled: true,
                                    isIdentifier: false
                                });
                            }
                        });
                        updatedCount++;
                    } else {
                        // 创建新模块
                        const newModule = {
                            name: parsedModule.name,
                            displayName: parsedModule.displayName || parsedModule.name,
                            compatibleModuleNames: '',
                            order: currentModules.length,
                            enabled: true,
                            prompt: '',
                            timingPrompt: '',
                            contentPrompt: '',
                            positionPrompt: '',
                            outputPosition: 'after_body',
                            outputMode: 'full',
                            retainLayers: -1,
                            rangeMode: 'specified',
                            itemMin: 0,
                            itemMax: 1,
                            timeReferenceStandard: false,
                            isExternalDisplay: false,
                            includeInModuleData: true,
                            externalStyles: '',
                            containerStyles: '',
                            customStyles: '',
                            variables: parsedModule.variables.map(v => ({
                                name: v.name,
                                displayName: v.displayName || v.name,
                                description: v.description || '',
                                enabled: true,
                                isIdentifier: false
                            }))
                        };
                        currentModules.push(newModule);
                        createdCount++;
                    }
                }
            }
        });

        infoLog(`智能添加: 新建 ${createdCount} 个, 更新 ${updatedCount} 个`);
        renderModuleList();
        checkForChanges(); // 检查变更
    } else {
        // 不是模块格式，直接作为名称新建
        createNewModule(inputValue);
    }
}

/**
 * 解析嵌套的模块字符串 (简单的栈解析)
 */
function parseNestedModules(inputText) {
    const results = [];
    // 简单正则匹配所有 [xxx] 格式，不处理嵌套，因为 moduleParser.js 的 parseModuleString 也不支持复杂嵌套解析
    // 但为了支持 [mod1][mod2] 这种连写，我们用正则
    const regex = /\[[^\]]+\]/g;
    let match;
    while ((match = regex.exec(inputText)) !== null) {
        results.push(match[0]);
    }
    return results;
}

/**
 * 删除模块
 * @param {number} index 索引
 */
function deleteModule(index) {
    if (confirm(translate('ccore_msg_confirm_delete_module'))) {
        currentModules.splice(index, 1);
        selectedModuleId = null;
        // 清空详情页或显示占位符
        doc.querySelector('.module-detail-panel .detail-content').innerHTML = `
            <div style="text-align: center; margin-top: 50px; color: var(--text-muted);">
                <p>模块已删除</p>
            </div>
        `;
        renderModuleList();
        checkForChanges(); // 检查变更
        // 如果在移动端，返回列表
        doc.body.classList.remove('mobile-view-detail-module');
    }
}

// === 初始化 ===
// 移除 DOMContentLoaded 监听，改为由 initModuleEditor 显式调用

function checkForChanges() {
    const modulesChanged = JSON.stringify(originalModules) !== JSON.stringify(currentModules);
    const settingsChanged = JSON.stringify(originalGlobalSettings) !== JSON.stringify(currentGlobalSettings);
    const hasChanges = modulesChanged || settingsChanged;

    const saveBtn = doc.getElementById('header-save-btn');
    if (saveBtn) {
        saveBtn.disabled = !hasChanges;
        if (hasChanges) {
            saveBtn.classList.remove('btn-secondary');
            saveBtn.classList.add('btn-primary');
            saveBtn.textContent = translate('ccore_btn_save');
        } else {
            saveBtn.classList.remove('btn-primary');
            saveBtn.classList.add('btn-secondary');
            saveBtn.textContent = translate('ccore_btn_save');
        }
    }
}

async function onImportClick() {
    const importData = await handleImport(doc);
    if (!importData) return;

    let changesMade = false;

    // 1. 导入全局设置
    if (importData.globalSettings) {
        currentGlobalSettings = { ...currentGlobalSettings, ...importData.globalSettings }; // 合并导入的设置
        renderGlobalSettings(doc, currentGlobalSettings, checkForChanges); // 重新渲染全局设置视图
        changesMade = true;
    }

    // 2. 导入模块
    if (importData.modules && importData.modules.length > 0) {
        const newModules = importData.modules;
        const overrideEnabled = importData.overrideEnabled;

        newModules.forEach(newMod => {
            const existingIndex = currentModules.findIndex(m => m.name === newMod.name);
            if (existingIndex !== -1) {
                // 存在同名模块：合并/覆盖
                const existingMod = currentModules[existingIndex];

                // 如果不覆盖启用状态，则保留原状态
                if (!overrideEnabled) {
                    newMod.enabled = existingMod.enabled;
                }

                // 替换模块
                currentModules[existingIndex] = newMod;
            } else {
                // 新模块：添加
                currentModules.push(newMod);
            }
        });

        renderModuleList();
        renderToolbox(doc, currentModules);
        changesMade = true;
    }

    if (changesMade) {
        infoLog("[ModuleEditor] 导入成功，已更新编辑器状态");

        // 如果有模块被选中，需要重新渲染详情视图以反映导入的更改
        if (selectedModuleId) {
            const updatedModuleIndex = currentModules.findIndex(m => m.name === selectedModuleId);
            if (updatedModuleIndex !== -1) {
                // 模块仍然存在（可能已被覆盖），重新渲染其详情
                renderModuleDetail(currentModules[updatedModuleIndex], updatedModuleIndex, doc, checkForChanges, deleteModule, renderModuleList, activeDetailTab, (tabId) => { activeDetailTab = tabId; }, currentModules, renderModuleList, (name) => { selectedModuleId = name; });
            }
        }

        checkForChanges(); // 检查变更
    }
}

function clearAllModules() {
    const dialog = new IframeDialog(doc);
    dialog.open({
        title: translate('ccore_title_clear_all'),
        content: `
            <div style="margin-bottom: 10px; color: var(--text-error, #ff4444); font-weight: bold;">${translate('ccore_msg_clear_warning')}</div>
            <div>${translate('ccore_msg_clear_confirm')}</div>
        `,
        buttons: [
            {
                text: translate('ccore_btn_confirm_clear'),
                className: 'btn-secondary',
                style: 'background-color: var(--red, #ff4444); color: white;',
                onClick: (d) => {
                    currentModules = [];
                    selectedModuleId = null;

                    // 清空详情页
                    const detailContainer = doc.querySelector('.module-detail-panel .detail-content');
                    if (detailContainer) detailContainer.innerHTML = '';

                    renderModuleList();
                    renderToolbox(doc, currentModules);
                    checkForChanges(); // 检查变更
                    d.close();
                }
            },
            { text: translate('ccore_btn_cancel'), className: 'btn-primary', onClick: (d) => d.close() }
        ]
    });
}

function confirmAndSave() {
    const { html, hasChanges } = generateChangesSummary(originalModules, currentModules, originalGlobalSettings, currentGlobalSettings);

    const dialog = new IframeDialog(doc);

    if (!hasChanges) {
        // If no changes, just show the "Saved" feedback without actually saving.
        showSavedFeedback();
        infoLog(`[ModuleEditor] ${translate('ccore_msg_no_changes')}`);
        return;
    }

    dialog.open({
        title: translate('ccore_title_confirm_save'),
        content: html,
        buttons: [
            {
                text: translate('ccore_btn_undo_changes'),
                id: 'restore-button',
                className: 'btn-secondary',
                align: 'left', // 放在左下角
                onClick: (d) => {
                    restoreAll();
                    d.close();
                }
            },
            {
                text: translate('ccore_btn_cancel'),
                className: 'btn-secondary',
                onClick: (d) => d.close(),
            },
            {
                text: translate('ccore_btn_confirm_save'),
                className: 'btn-primary',
                onClick: (d) => {
                    d.close();
                    saveAll();
                }
            }
        ]
    });
}

function showSavedFeedback() {
    const btn = doc.getElementById('header-save-btn');
    if (btn) {
        if (btn.dataset.saving === 'true') return;
        btn.dataset.saving = 'true';
        btn.textContent = translate('ccore_msg_saved');
        btn.classList.add('saved'); // 添加绿色样式

        setTimeout(() => {
            // 恢复按钮状态（此时应该已保存，所以是禁用状态）
            btn.textContent = translate('ccore_btn_save');
            btn.dataset.saving = 'false';
            btn.classList.remove('saved'); // 移除绿色样式
        }, 1000);
    }
}

/**
 * 比对保存前后模块定义，推导「改名」迁移计划。
 * 仅处理真正改名（旧名消失 + 新名出现）的情况，避免把纯重排/增删误判为改名。
 * @param {Array} original 保存前模块副本
 * @param {Array} current 保存后模块
 * @returns {{moduleRenames: Array, variableRenames: Array}}
 */
function computeRenameMigrations(original, current) {
    const origNames = new Set(original.map(m => m.name));
    const curNames = new Set(current.map(m => m.name));
    const moduleRenames = [];
    const n = Math.max(original.length, current.length);
    for (let i = 0; i < n; i++) {
        const oMod = original[i];
        const cMod = current[i];
        if (!oMod || !cMod || oMod.name === cMod.name) continue;
        // 真正改名：旧名已不在当前列表，新名不在原列表
        if (!curNames.has(oMod.name) && !origNames.has(cMod.name)) {
            moduleRenames.push({ oldName: oMod.name, newName: cMod.name });
        }
    }

    // 变量改名：按模块名对齐（含模块改名后的新名映射），逐变量按 index + 名集合判定
    const modNewName = new Map(moduleRenames.map(r => [r.oldName, r.newName]));
    const curByName = new Map(current.map(m => [m.name, m]));
    const variableRenames = [];
    for (const oMod of original) {
        const newModName = modNewName.get(oMod.name) || oMod.name;
        const cMod = curByName.get(newModName);
        if (!cMod) continue; // 模块已删或改名未命中（模块级已整体迁移）
        const oVars = oMod.variables || [];
        const cVars = cMod.variables || [];
        const oVarNames = new Set(oVars.map(v => v.name));
        const cVarNames = new Set(cVars.map(v => v.name));
        const vn = Math.max(oVars.length, cVars.length);
        for (let i = 0; i < vn; i++) {
            const oV = oVars[i];
            const cV = cVars[i];
            if (!oV || !cV || oV.name === cV.name) continue;
            if (!cVarNames.has(oV.name) && !oVarNames.has(cV.name)) {
                variableRenames.push({ moduleName: newModName, oldVar: oV.name, newVar: cV.name });
            }
        }
    }
    return { moduleRenames, variableRenames };
}

function saveAll() {
    configManager.setModules(currentModules);
    configManager.setGlobalSettings(currentGlobalSettings);
    // 取消 setModules/setGlobalSettings 触发的延迟自动保存，直接立即保存
    if (configManager.autoSaveTimeout) {
        clearTimeout(configManager.autoSaveTimeout);
        configManager.autoSaveTimeout = null;
    }
    configManager.saveModuleConfigNow();
    infoLog("[ModuleEditor] 所有配置已保存");

    // 模块/变量改名：迁移绑定覆盖（按名保留旧 override）
    const { moduleRenames, variableRenames } = computeRenameMigrations(originalModules, currentModules);
    if (moduleRenames.length || variableRenames.length) {
        configManager.applyBindingRenames(moduleRenames, variableRenames);
    }

    // 保存后同步选中态与左侧列表（模块改名后侧栏需刷新）
    const renamed = moduleRenames.find(r => r.oldName === selectedModuleId);
    if (renamed) selectedModuleId = renamed.newName;
    renderModuleList();

    // 保存后，将当前状态设为新的"原始"状态
    originalModules = JSON.parse(JSON.stringify(currentModules));
    originalGlobalSettings = JSON.parse(JSON.stringify(currentGlobalSettings));

    checkForChanges(); // 更新按钮状态（应变为禁用）
    showSavedFeedback();
}

function restoreAll() {
    currentModules = JSON.parse(JSON.stringify(originalModules));
    currentGlobalSettings = JSON.parse(JSON.stringify(originalGlobalSettings));
    renderModuleList();
    renderGlobalSettings(doc, currentGlobalSettings, checkForChanges);
    renderToolbox(doc, currentModules);

    // 如果有模块被选中，需要重新渲染详情视图以反映撤销的更改
    if (selectedModuleId) {
        const restoredModuleIndex = currentModules.findIndex(m => m.name === selectedModuleId);
        if (restoredModuleIndex !== -1) {
            // 模块仍然存在，重新渲染其详情
            renderModuleDetail(currentModules[restoredModuleIndex], restoredModuleIndex, doc, checkForChanges, deleteModule, renderModuleList, activeDetailTab, (tabId) => { activeDetailTab = tabId; }, currentModules, renderModuleList, (name) => { selectedModuleId = name; });
        } else {
            // 选中的模块在撤销后被删除了（例如，一个新添加的模块），清空详情面板
            selectedModuleId = null;
            const detailContainer = doc.querySelector('.module-detail-panel .detail-content');
            if (detailContainer) {
                detailContainer.innerHTML = `
                    <div style="text-align: center; margin-top: 50px; color: var(--text-muted);">
                        <p>请从左侧选择一个模块进行编辑</p>
                    </div>
                `;
            }
        }
    }

    infoLog("[ModuleEditor] 所有配置已恢复");

    checkForChanges(); // 更新按钮状态（应变为禁用）
}
