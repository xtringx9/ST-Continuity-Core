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
    const scenes = settings.scenes || [];
    // 默认预选第一个场景（若齿轮是从某个已打开 App 点击，则脚本会按当前打开的 App 重填）
    const first = scenes[0] || { moduleName: '', enabled: true, appLabel: '', appIcon: '' };
    const sel = first.moduleName || '';
    let moduleOptions = modules
        .map((m) => `<option value="${escapeHtml(m.name)}"${m.name === sel ? ' selected' : ''}>${escapeHtml(m.displayName || m.name)}</option>`)
        .join('');
    if (first.moduleName && !modules.some((m) => m.name === first.moduleName)) {
        moduleOptions = `<option value="${escapeHtml(first.moduleName)}" class="ps-invalid-opt" selected>已失效：${escapeHtml(first.moduleName)}</option>` + moduleOptions;
    }

    // JSON 数据（转义 < 避免提前闭合 script 标签）
    const json = JSON.stringify(settings).replace(/</g, '\\u003c');

    return `<div class="phone-settings-overlay" id="phoneSettings" hidden>
  <div class="phone-settings-panel">
    <div class="ps-header"><span>手机设置</span><button id="psClose" class="ps-close" type="button">✕</button></div>
    <div class="ps-body">
      <div class="ps-row"><label>模块</label><select id="psModule">${moduleOptions}</select></div>
      <div class="ps-row"><label class="ps-check"><input type="checkbox" id="psEnabled"> 在手机桌面显示此应用</label></div>
      <div class="ps-row"><label>名称</label><input type="text" id="psLabel" placeholder="留空则用模块名"></div>
      <div class="ps-row"><label>图标</label><input type="text" id="psIcon" value="💬" maxlength="2"></div>
      <div id="psMismatch" class="ps-mismatch"></div>
      <div class="ps-hint">每个启用模块 = 桌面上一个 App，点击图标打开其消息</div>
    </div>
    <div class="ps-footer"><button id="psSave" class="ps-save" type="button">保存</button></div>
  </div>
</div>
<script id="phoneSettingsData" type="application/json">${json}</script>
<script>${SETTINGS_SCRIPT}</script>`;
}

// 设置面板交互脚本（纯静态，无外部数据注入，安全）。
// 负责：齿轮开合（按当前打开的 App 预填）、模块级失配提示、保存时 postMessage 给父窗口。
const SETTINGS_SCRIPT = `
(function () {
  var data = JSON.parse(document.getElementById('phoneSettingsData').textContent);
  var gear = document.getElementById('phoneGear');
  var overlay = document.getElementById('phoneSettings');
  var closeBtn = document.getElementById('psClose');
  var saveBtn = document.getElementById('psSave');
  var moduleSel = document.getElementById('psModule');
  var enabledChk = document.getElementById('psEnabled');
  var labelInput = document.getElementById('psLabel');
  var iconInput = document.getElementById('psIcon');
  var mismatchBox = document.getElementById('psMismatch');

  // 当前已打开的 App（若有），用于确定编辑哪个场景
  function getOpenAppKey() {
    var open = document.querySelector('.phone-app:not([hidden])');
    return open ? open.id.replace(/^app-/, '') : '';
  }
  function findScene(name) {
    return (data.scenes || []).find(function (s) { return s.moduleName === name; }) || null;
  }

  function openSettings() {
    var key = getOpenAppKey();
    var sc = (key && findScene(key)) || data.scenes[0] || { moduleName: '', enabled: true, appLabel: '', appIcon: '💬' };
    moduleSel.value = sc.moduleName || '';
    enabledChk.checked = sc.enabled !== false;
    labelInput.value = sc.appLabel || '';
    iconInput.value = sc.appIcon || '💬';
    checkMismatch();
    overlay.hidden = false;
  }
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
    var scene = {
      moduleName: name,
      enabled: enabledChk.checked,
      appLabel: labelInput.value.trim(),
      appIcon: iconInput.value.trim() || '💬',
    };
    window.parent.postMessage({ type: 'SAVE_PHONE_CONFIG', scene: scene }, '*');
    closeSettings();
  });
})();
`;

/**
 * 组装完整手机外壳 HTML（用于 IframeModal srcdoc）
 * 结构：状态栏 + 屏幕容器（桌面 App 网格 + 各 App 消息视图，默认显示桌面）+ 底部导航条 + 设置面板。
 * @param {Object} opts
 * @param {string} opts.cssUrl phone.css 的 URL
 * @param {Array} opts.apps 桌面 App 列表 [{ key, label, icon, contentHtml, emptyStateHtml }]，每个启用场景一个
 * @param {Object|null} opts.settings 设置面板数据；为空则不渲染齿轮
 */
export function buildPhoneHtml({ cssUrl = '', apps = [], settings = null }) {
    const now = currentClock();

    // 桌面（首页）：App 图标网格
    const homeApps = apps.length
        ? apps.map((a) => `
            <button class="app-icon" type="button" data-app="${escapeHtml(a.key)}">
                <span class="app-icon-img">${escapeHtml(a.icon)}</span>
                <span class="app-icon-label">${escapeHtml(a.label)}</span>
            </button>`).join('')
        : `<div class="phone-empty">暂无应用，请在手机设置（⚙️）中添加模块</div>`;
    const homeView = `<div class="phone-home" id="phoneHome"><div class="phone-home-grid">${homeApps}</div></div>`;

    // 每个 App 的消息视图（默认隐藏，点击图标后显示）
    const appViews = apps.map((a) => {
        const inner = a.emptyStateHtml
            ? `<div class="phone-empty">${escapeHtml(a.emptyStateHtml)}</div>`
            : `<div class="phone-screen-inner">${a.contentHtml}</div>`;
        return `<div class="phone-app" id="app-${escapeHtml(a.key)}" hidden><div class="phone-screen">${inner}</div></div>`;
    }).join('');

    // 齿轮：settings 存在即渲染（始终可达，确保用户能打开手机设置）
    const gear = settings ? `<span class="ps-gear" id="phoneGear" title="手机设置">⚙️</span>` : '';
    const overlay = settings ? buildSettingsOverlay(settings) : '';
    const navScript = settings ? NAV_SCRIPT : '';

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
    <span class="ps-back" id="phoneBack" hidden>‹</span>
    <span class="ps-time">${now}</span>
    <span class="ps-title" id="phoneTitle">手机</span>
    <span class="ps-status-right">${gear}<span class="ps-icons">📶 🔋</span></span>
  </div>
  <div class="phone-screen-host" id="phoneScreenHost">
    ${homeView}
    ${appViews}
  </div>
  <div class="phone-navbar">
    <span class="nav-item">💬</span>
    <span class="nav-item">👥</span>
    <span class="nav-item">📞</span>
    <span class="nav-item">🧭</span>
  </div>
</div>
${overlay}
${navScript}
</body>
</html>`;
}

// 桌面 ↔ App 导航脚本（纯静态）。状态栏「‹」返回桌面；点击 App 图标打开对应消息视图。
const NAV_SCRIPT = `
<script>
(function () {
  var home = document.getElementById('phoneHome');
  var back = document.getElementById('phoneBack');
  var title = document.getElementById('phoneTitle');
  var apps = Array.prototype.slice.call(document.querySelectorAll('.phone-app'));

  function openApp(key, label) {
    home.hidden = true;
    apps.forEach(function (el) { el.hidden = (el.id !== 'app-' + key); });
    title.textContent = label || '';
    back.hidden = false;
    var screen = document.getElementById('app-' + key);
    if (screen) screen.querySelector('.phone-screen').scrollTop = 0;
  }
  function goHome() {
    apps.forEach(function (el) { el.hidden = true; });
    home.hidden = false;
    title.textContent = '手机';
    back.hidden = true;
  }
  document.querySelectorAll('.app-icon').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openApp(btn.getAttribute('data-app'), btn.querySelector('.app-icon-label').textContent);
    });
  });
  if (back) back.addEventListener('click', goHome);
})();
</script>`;

/**
 * 当前时钟 HH:MM（状态栏用）
 */
function currentClock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}
