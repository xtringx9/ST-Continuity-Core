// 手机模式入口：组装 srcdoc HTML，调 IframeModal 打开（srcdoc 同源，无需 postMessage 取数）。
// 详见 docs/PHONE_MODE_PLAN.md §五。
//
// 与「模块汇总」同构，但额外：
// - 使用 phone 选项，iframe 用父视口单位自适应（桌面居中、移动撑满），手机填满 iframe（去除深色外框）。
// - 内置设置面板（齿轮）通过 postMessage 把编辑后的场景回传此处持久化（§八 失配处理在 UI 内完成）。
import { IframeModal } from '../../shared/IframeModal.js';
import configManager from '../../singleton/configManager.js';
import { buildStyledProcessResult } from '../../core/context-ui/processResultBuilder.js';
import { buildPhoneHtml } from './phoneRenderer.js';
import { errorLog } from '../../utils/logger.js';

let phoneModal = null;
let currentExtensionPath = '';
let lastView = 'home';   // 退出时所在界面（'home' 或 appKey），重开时恢复到此界面

/**
 * 打开手机模式模态
 * @param {string} extensionPath 插件根目录路径（用于拼 phone.css URL）
 */
export function openPhoneModeModal(extensionPath) {
    if (!configManager.isLoaded) return;
    // 门控在源头：isPhoneModeEnabled 已包含「插件总开关 + phone_config.enabled」双重判定，
    // 任一关闭即不可用（手机模式依赖模块功能）。
    if (!configManager.isPhoneModeEnabled()) return;
    currentExtensionPath = extensionPath;

    // 单实例 + 仅挂一次保存消息监听
    if (!phoneModal) {
        phoneModal = new IframeModal();
        window.addEventListener('message', handlePhoneMessage);
    }

    const html = renderPhoneHtml();
    if (!html) return;
    phoneModal.open(null, '手机模式', { srcdoc: html, variant: 'center', phone: true });
}

/**
 * 处理来自手机 iframe 的保存消息（齿轮设置保存）
 */
function handlePhoneMessage(event) {
    if (!event.data) return;
    // 界面切换上报：记录当前所在界面，重开手机模式时恢复
    if (event.data.type === 'PHONE_VIEW_CHANGED') {
        lastView = event.data.view || 'home';
        return;
    }
    if (event.data.type !== 'SAVE_PHONE_CONFIG') return;
    const scene = event.data.scene;
    console.info('[Continuity][手机] 收到 SAVE_PHONE_CONFIG：', JSON.parse(JSON.stringify(scene)));

    const existing = configManager.getPhoneConfig();
    const scenes = Array.isArray(existing.scenes) ? existing.scenes.slice() : [];
    // 按 moduleName 匹配更新对应 App（支持多 App；未匹配则新增）
    const idx = scenes.findIndex((s) => s.moduleName === scene.moduleName);
    if (idx >= 0) scenes[idx] = { ...scenes[idx], ...scene };
    else scenes.push(scene);
    const newConfig = { ...existing, scenes };

    // 直接落盘（不依赖 setPhoneConfig 内部的 guard/调度，杜绝静默不保存）
    if (configManager.isPhoneConfigLoaded) configManager.phoneConfig = newConfig;
    try {
        configManager.setPhoneConfig(newConfig);
    } catch (e) {
        errorLog('[手机] setPhoneConfig 失败:', e);
    }
    const ok = configManager.savePhoneConfigNow();
    console.info('[Continuity][手机] 保存结果：', ok,
        'extension_settings 现有 phone_config =',
        JSON.parse(JSON.stringify(configManager.getPhoneConfig())));

    // 保存后同实例重渲染
    const html = renderPhoneHtml();
    if (html && phoneModal) phoneModal.setSrcdoc(html);
}

/**
 * 构建手机视图 HTML（含桌面 App 图标 + 设置面板数据）
 * @returns {string|null}
 */
function renderPhoneHtml() {
    const cssUrl = `${currentExtensionPath}/src/features/phone/styles/phone.css`;
    const phoneConfig = configManager.getPhoneConfig();
    const scenes = Array.isArray(phoneConfig.scenes) ? phoneConfig.scenes : [];

    // 所有模块（含未启用）用于设置下拉
    const allModules = configManager.getModules(true);
    const modules = allModules.map((m) => ({ name: m.name, displayName: m.displayName || m.name }));

    // 每个启用场景 = 手机桌面上一个 App 图标；点击打开该场景的消息视图
    const apps = [];
    for (const scene of scenes) {
        if (!scene || scene.enabled === false || !scene.moduleName) continue;
        const moduleConfig = configManager.getModuleByName(scene.moduleName);
        const label = (scene.appLabel && scene.appLabel.trim()) ||
            (moduleConfig ? (moduleConfig.displayName || scene.moduleName) : scene.moduleName);
        const icon = (scene.appIcon && scene.appIcon.trim()) || '💬';
        let contentHtml = '';
        let emptyStateHtml = '';
        if (!moduleConfig) {
            // 模块级失配：红字提示 + 齿轮内可重选
            emptyStateHtml = `模块「${scene.moduleName}」不存在，请在手机设置中重新选择`;
        } else {
            const processResult = buildStyledProcessResult(null, {
                startIndex: 0,
                endIndex: null,
                moduleFilters: [{ name: scene.moduleName }],
            });
            const moduleData = processResult?.content?.[scene.moduleName];
            // 直接复用 styleCombiner 产出的完整气泡 HTML（已含变量替换）
            contentHtml = moduleData?.containerStyles || '';
            if (!contentHtml) {
                // 空状态：本会话尚未生成内容
                emptyStateHtml = '该模块本会话尚未生成内容，请先触发一次';
            }
        }
        apps.push({ key: scene.moduleName, label, icon, contentHtml, emptyStateHtml });
    }

    // 设置面板数据：全部场景 + 模块列表（齿轮内按当前打开的 App 编辑）
    const settings = {
        scenes: scenes.map((s) => ({
            moduleName: s.moduleName || '',
            enabled: s.enabled !== false,
            appLabel: s.appLabel || '',
            appIcon: s.appIcon || '',
        })),
        modules,
    };

    return buildPhoneHtml({ cssUrl, apps, settings, initView: lastView });
}
