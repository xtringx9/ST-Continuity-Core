// 手机模式入口：组装 srcdoc HTML，调 IframeModal 打开（srcdoc 同源，无需 postMessage 取数）。
// 详见 docs/PHONE_MODE_PLAN.md §五。
//
// 与「模块汇总」同构，但额外：
// - 使用 fitContent，使 iframe 容器贴合手机壳尺寸（去除深色外框，黑框随内容自适应）。
// - 内置设置面板（齿轮）通过 postMessage 把编辑后的场景回传此处持久化（§八 失配处理在 UI 内完成）。
import { IframeModal } from '../../shared/IframeModal.js';
import configManager from '../../singleton/configManager.js';
import { buildStyledProcessResult } from '../../core/context-ui/processResultBuilder.js';
import { buildPhoneHtml } from './phoneRenderer.js';
import { errorLog } from '../../utils/logger.js';

let phoneModal = null;
let currentExtensionPath = '';

/**
 * 打开手机模式模态
 * @param {string} extensionPath 插件根目录路径（用于拼 phone.css URL）
 */
export function openPhoneModeModal(extensionPath) {
    if (!configManager.isLoaded) return;
    if (!configManager.isExtensionEnabled()) return;
    currentExtensionPath = extensionPath;

    // 单实例 + 仅挂一次保存消息监听
    if (!phoneModal) {
        phoneModal = new IframeModal();
        window.addEventListener('message', handlePhoneMessage);
    }

    const html = renderPhoneHtml();
    if (!html) return;
    phoneModal.open(null, '手机模式', { srcdoc: html, variant: 'center', fitContent: true });
}

/**
 * 处理来自手机 iframe 的保存消息（齿轮设置保存）
 */
function handlePhoneMessage(event) {
    if (!event.data || event.data.type !== 'SAVE_PHONE_CONFIG') return;
    const scene = event.data.scene;
    console.info('[Continuity][手机] 收到 SAVE_PHONE_CONFIG：', JSON.parse(JSON.stringify(scene)));

    const existing = configManager.getPhoneConfig();
    const scenes = Array.isArray(existing.scenes) ? existing.scenes.slice() : [];
    if (scenes.length) scenes[0] = scene;
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
 * 构建手机视图 HTML（含设置面板数据）
 * @returns {string|null}
 */
function renderPhoneHtml() {
    const cssUrl = `${currentExtensionPath}/src/features/phone/styles/phone.css`;
    const phoneConfig = configManager.getPhoneConfig();

    // 取首个启用场景；若无启用场景则退而取 scenes[0]（可能未启用，仅用于设置面板预填）
    const enabledScenes = (phoneConfig.scenes || []).filter((s) => s.enabled !== false);
    const scene = enabledScenes[0] || (phoneConfig.scenes && phoneConfig.scenes[0]) || null;

    // 所有模块（含未启用）用于设置下拉
    const allModules = configManager.getModules(true);
    const modules = allModules.map((m) => ({ name: m.name, displayName: m.displayName || m.name }));

    const settings = {
        scene: scene
            ? { moduleName: scene.moduleName, enabled: scene.enabled !== false }
            : { moduleName: '', enabled: true },
        modules,
    };

    let title = '';
    let emptyStateHtml = '';
    let styledHtml = '';

    if (!scene || !scene.moduleName) {
        // 空状态 1：尚未配置场景（但齿轮仍可达，用户可在此选择模块）
        emptyStateHtml = '请在手机设置（右上角 ⚙️）中选择要渲染的模块';
    } else {
        const moduleConfig = configManager.getModuleByName(scene.moduleName);
        if (!moduleConfig) {
            // 模块级失配：红字提示 + 齿轮内可重选
            title = scene.moduleName;
            emptyStateHtml = `模块「${scene.moduleName}」不存在，请在手机设置中重新选择`;
        } else {
            title = moduleConfig.displayName || scene.moduleName;
            const processResult = buildStyledProcessResult(null, {
                startIndex: 0,
                endIndex: null,
                moduleFilters: [{ name: scene.moduleName }],
            });
            const moduleData = processResult?.content?.[scene.moduleName];
            // 直接复用 styleCombiner 产出的完整气泡 HTML（已含变量替换）
            styledHtml = moduleData?.containerStyles || '';
            if (!styledHtml) {
                // 空状态：本会话尚未生成内容
                emptyStateHtml = '该模块本会话尚未生成内容，请先触发一次';
            }
        }
    }

    return buildPhoneHtml({ cssUrl, title, styledHtml, emptyStateHtml, settings });
}
