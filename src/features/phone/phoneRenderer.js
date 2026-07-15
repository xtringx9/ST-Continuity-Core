// 手机模式渲染器
// 职责：把 styleCombiner 已组合好的气泡 HTML（moduleData.containerStyles）放进手机壳，并产出含「齿轮设置」的手机外壳。
//
// 设计要点（详见 docs/PHONE_MODE_PLAN.md）：
// - 气泡由 styleCombiner（src/modules/styleCombiner.js）产出，结果在 processResult.content[moduleName].containerStyles，
//   已包含变量替换后的真实气泡 HTML。本文件【不再】自行解析 [msg] 或渲染气泡——直接复用 styleCombiner 的结果。
// - 手机壳仅负责外壳（状态栏 / 屏幕 / 导航条）与设置面板（齿轮）。
// - 全程只读、纯字符串拼接；所有动态文本经 escapeHtml 防止 XSS / 破坏结构。
// - 设置面板（齿轮）内置于同一 iframe，保存时通过 postMessage 通知父窗口持久化（见 phoneMode.js）。
// - moduleConfig 仅用于取模块显示名（标题），不参与气泡渲染。

/**
 * HTML 转义（防 XSS / 破坏结构）
 */
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 构建设置面板（齿轮）的覆盖层 HTML + 内联脚本。
 * 仅需：模块选择 + 启用开关（气泡由 styleCombiner 决定，无需字段映射）。
 * @param {Object} settings { scene, modules }
 */
function buildSettingsOverlay(settings) {
    const modules = settings.modules || [];
    const scene = settings.scene || { moduleName: '', enabled: true };

    // 模块下拉选项；预选中当前 scene.moduleName（否则浏览器默认选第一个，看起来像没保存）
    const sel = scene.moduleName || '';
    let moduleOptions = modules
        .map((m) => `<option value="${escapeHtml(m.name)}"${m.name === sel ? ' selected' : ''}>${escapeHtml(m.displayName || m.name)}</option>`)
        .join('');
    if (scene.moduleName && !modules.some((m) => m.name === scene.moduleName)) {
        moduleOptions = `<option value="${escapeHtml(scene.moduleName)}" class="ps-invalid-opt" selected>已失效：${escapeHtml(scene.moduleName)}</option>` + moduleOptions;
    }

    // JSON 数据（转义 < 避免提前闭合 script 标签）
    const json = JSON.stringify(settings).replace(/</g, '\\u003c');

    return `<div class="phone-settings-overlay" id="phoneSettings" hidden>
  <div class="phone-settings-panel">
    <div class="ps-header"><span>手机设置</span><button id="psClose" class="ps-close" type="button">✕</button></div>
    <div class="ps-body">
      <div class="ps-row"><label>模块</label><select id="psModule">${moduleOptions}</select></div>
      <div class="ps-row"><label class="ps-check"><input type="checkbox" id="psEnabled"> 在手机中显示此模块</label></div>
      <div id="psMismatch" class="ps-mismatch"></div>
    </div>
    <div class="ps-footer"><button id="psSave" class="ps-save" type="button">保存</button></div>
  </div>
</div>
<script id="phoneSettingsData" type="application/json">${json}</script>
<script>${SETTINGS_SCRIPT}</script>`;
}

// 设置面板交互脚本（纯静态，无外部数据注入，安全）。
// 负责：齿轮开合、模块级失配提示、保存时 postMessage 给父窗口。
const SETTINGS_SCRIPT = `
(function () {
  var data = JSON.parse(document.getElementById('phoneSettingsData').textContent);
  var gear = document.getElementById('phoneGear');
  var overlay = document.getElementById('phoneSettings');
  var closeBtn = document.getElementById('psClose');
  var saveBtn = document.getElementById('psSave');
  var moduleSel = document.getElementById('psModule');
  var enabledChk = document.getElementById('psEnabled');
  var mismatchBox = document.getElementById('psMismatch');

  function openSettings() { overlay.hidden = false; checkMismatch(); }
  function closeSettings() { overlay.hidden = true; }

  gear.addEventListener('click', openSettings);
  closeBtn.addEventListener('click', closeSettings);

  function checkMismatch() {
    mismatchBox.innerHTML = '';
    var mod = moduleSel.value;
    var exists = data.modules.some(function (m) { return m.name === mod; });
    if (!exists) {
      var d = document.createElement('div');
      d.className = 'ps-mismatch-err';
      d.textContent = '当前模块「' + mod + '」已不存在，请重新选择';
      mismatchBox.appendChild(d);
    }
  }

  moduleSel.addEventListener('change', checkMismatch);

  saveBtn.addEventListener('click', function () {
    var name = moduleSel.value;
    var exists = data.modules.some(function (m) { return m.name === name; });
    if (!exists) { window.alert('请选择一个有效模块'); return; }
    var scene = { moduleName: name, enabled: enabledChk.checked };
    window.parent.postMessage({ type: 'SAVE_PHONE_CONFIG', scene: scene }, '*');
    closeSettings();
  });

  // 初始化启用状态
  enabledChk.checked = !data.scene || data.scene.enabled !== false;
})();
`;

/**
 * 组装完整手机外壳 HTML（用于 IframeModal srcdoc）
 * @param {Object} opts
 * @param {string} opts.cssUrl phone.css 的 URL
 * @param {string} opts.title 聊天标题（模块显示名）
 * @param {string} opts.styledHtml styleCombiner 产出的气泡 HTML（moduleData.containerStyles），直接放入屏幕
 * @param {string} opts.emptyStateHtml 空状态提示；非空时优先渲染空状态
 * @param {Object|null} opts.settings 设置面板数据；为空则不渲染齿轮
 */
export function buildPhoneHtml({ cssUrl = '', title = '', styledHtml = '', emptyStateHtml = '', settings = null }) {
    const now = currentClock();
    const screen = emptyStateHtml
        ? `<div class="phone-empty">${escapeHtml(emptyStateHtml)}</div>`
        : `<div class="phone-screen-inner">${styledHtml}</div>`;

    // 齿轮：settings 存在即渲染（始终可达，确保用户能打开手机设置）
    const gear = settings
        ? `<span class="ps-gear" id="phoneGear" title="手机设置">⚙️</span>`
        : '';

    const overlay = settings ? buildSettingsOverlay(settings) : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeHtml(cssUrl)}">
</head>
<body>
<div class="phone">
  <div class="phone-statusbar">
    <span class="ps-time">${now}</span>
    <span class="ps-title">${escapeHtml(title)}</span>
    <span class="ps-status-right">${gear}<span class="ps-icons">📶 🔋</span></span>
  </div>
  <div class="phone-screen">
    ${screen}
  </div>
  <div class="phone-navbar">
    <span class="nav-item">💬</span>
    <span class="nav-item">👥</span>
    <span class="nav-item">📞</span>
    <span class="nav-item">🧭</span>
  </div>
</div>
${overlay}
</body>
</html>`;
}

/**
 * 当前时钟 HH:MM（状态栏用）
 */
function currentClock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}
