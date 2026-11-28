// src/shared/version.js
// 扩展版本号的显示工具（唯一实现，供编辑器 iframe 与主页面设置面板共用）。
//
// 数据源：manifest.json —— ST 只认它（扩展列表 / 更新检测），所以界面也跟它走。
// APP_VERSION 只是 fetch 失败时的兜底值，正常路径不会用到。
//
// 调用方负责拼 manifestUrl（iframe 与主页面的相对路径不同），本模块不猜路径：
//   编辑器 iframe: new URL('../../../manifest.json', iframeDoc.baseURI)
//   主页面设置面板: `${extensionFolderPath}/manifest.json`
//
// 用法：
//   applyVersionText(el, manifestUrl)                     // → "v2.0.0"
//   applyVersionText(el, manifestUrl, { withName: true }) // → "Continuity Core v2.0.0"

/** 兜底版本号（仅 manifest 读取失败时显示）。发版时建议与 manifest 同步。 */
export const APP_VERSION = '2.0.0';

/** manifest 缺失 display_name 时的默认名称 */
export const DEFAULT_DISPLAY_NAME = 'Continuity Core';

/**
 * 读取 manifest.json
 * @param {string|URL} manifestUrl
 * @returns {Promise<object|null>} 非 200 / 网络异常 / 解析失败均返回 null
 */
export async function loadManifest(manifestUrl) {
    try {
        const res = await fetch(manifestUrl, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

/**
 * 组装版本号文本（manifest 为空时用兜底值）
 * @param {object|null} manifest
 * @param {{withName?: boolean, fallbackName?: string}} [options]
 * @returns {string}
 */
export function formatVersion(manifest, { withName = false, fallbackName = DEFAULT_DISPLAY_NAME } = {}) {
    const version = manifest?.version || APP_VERSION;
    if (!withName) return `v${version}`;
    return `${manifest?.display_name || fallbackName} v${version}`;
}

/**
 * 把版本号写进元素：先同步写兜底值（避免空白），再异步用 manifest 覆盖。
 * manifest 不含 version 时保留兜底值，不做改动。
 * @param {Element|null} el
 * @param {string|URL} manifestUrl
 * @param {{withName?: boolean, fallbackName?: string}} [options]
 */
export async function applyVersionText(el, manifestUrl, options = {}) {
    if (!el) return;
    el.textContent = formatVersion(null, options);

    const manifest = await loadManifest(manifestUrl);
    if (manifest?.version) {
        el.textContent = formatVersion(manifest, options);
    }
}
