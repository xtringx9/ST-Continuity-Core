// 手机模式渲染器
// 职责：把已解析好的 App 皮肤视图（会话列表 + 聊天窗口，由 apps/ 注册表皮肤产出）装进手机壳，
// 并产出含「设置 App」的手机外壳（桌面 / 导航 / 状态栏）。
//
// 架构（2026-08-27 起）：桌面图标 = 注册表里的 App 皮肤（aggregate 其下 scene 的会话），
// App 内两级导航：会话列表 ↔ 聊天窗口。皮肤只负责「会话列表 HTML + 聊天窗口 HTML」
// （见 apps/index.js 契约），外壳层负责切换与返回链。
//
// ⚠️ 弃用说明：早期方案的 containerStyles 整块气泡渲染（buildStyledProcessResult +
// styleCombiner 的 content[moduleName].containerStyles）已不再用于手机渲染 —— 手机改为
// 逐条消息 + 字段映射自绘（见 phoneMode.buildConversations）。containerStyles 链路在
// contextBottomUI / inlineMessageRenderer 等处仍正常使用，此处仅手机模式弃用。
//
// 设计要点：
// - 全程只读、纯字符串拼接；所有动态文本经 escapeHtml 防止 XSS / 破坏结构。
// - 设置面板内置于同一 iframe，由桌面「设置」App 打开，保存时通过 postMessage 通知父窗口持久化（见 phoneMode.js）。
// - moduleConfig 仅用于场景标签，不参与消息渲染。
import { skinIcon } from './apps/icons.js';

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
 * 构建设置面板（由桌面「设置」App 打开）的覆盖层 HTML + 内联脚本。
 * 职责：模块选择 + 字段映射（消息进哪个 App 由 platform 映射值决定，面板无 App 选择）。
 * @param {Object} settings { scenes, modules }
 */
function buildSettingsOverlay(settings) {
    const modules = settings.modules || [];
    const scenes = settings.scenes || [];
    const first = scenes[0] || { moduleName: '', enabled: true, fieldMap: {} };
    const sel = first.moduleName || '';
    // 模块下拉：display 名 (模块本身 name)，同 module-editor 惯例；相同时只显示一个
    const moduleLabel = (m) => (m.displayName && m.displayName !== m.name) ? `${m.displayName} (${m.name})` : m.name;
    let moduleOptions = modules
        .map((m) => `<option value="${escapeHtml(m.name)}"${m.name === sel ? ' selected' : ''}>${escapeHtml(moduleLabel(m))}</option>`)
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
      <div class="ps-row"><label class="ps-check"><input type="checkbox" id="psEnabled"> 启用此模块（在手机中显示）</label></div>
      <div class="ps-fm">
        <div class="ps-fm-title">字段映射（raw = 模块数据原文）</div>
        <div class="ps-row"><label>发送者</label><select id="psFmsender"></select></div>
        <div class="ps-row"><label>内容</label><select id="psFmcontent"></select></div>
        <div class="ps-row"><label>时间</label><select id="psFmtime"></select></div>
        <div class="ps-row"><label>类型</label><select id="psFmtype"></select></div>
        <div class="ps-row"><label>平台</label><select id="psFmplat"></select></div>
        <div class="ps-row"><label>私聊</label><select id="psFmdm"></select></div>
        <div class="ps-row"><label>群组</label><select id="psFmgrp"></select></div>
        <div class="ps-row"><label>成员</label><select id="psFmmems"></select></div>
      </div>
      <div id="psMismatch" class="ps-mismatch"></div>
      <div class="ps-hint">会话分组：私聊（dm 有值）= 发送者+接收方双方组成一窗（A↔B 无论谁发同一会话）；群聊（grp 有值）→ 归群组；都没有 → 按发送者兜底；「我」（ST 用户名）的消息只作右侧气泡；「平台」值路由到对应 App</div>
    </div>
    <div class="ps-footer"><span id="psResult" class="ps-result"></span><button id="psSave" class="ps-save" type="button">保存</button></div>
  </div>
</div>
<script id="phoneSettingsData" type="application/json">${json}</script>
<script>${SETTINGS_SCRIPT}</script>`;
}

// 设置面板交互脚本（纯静态，无外部数据注入，安全）。
// 职责：由桌面「设置」App 打开、模块失配提示、字段映射下拉（raw / 模块变量）、保存时 postMessage 给父窗口。
const SETTINGS_SCRIPT = `
(function () {
  var data = JSON.parse(document.getElementById('phoneSettingsData').textContent);
  var settingsApp = document.querySelector('.app-icon[data-app="settings"]');
  var overlay = document.getElementById('phoneSettings');
  var closeBtn = document.getElementById('psClose');
  var saveBtn = document.getElementById('psSave');
  var moduleSel = document.getElementById('psModule');
  var enabledChk = document.getElementById('psEnabled');
  var mismatchBox = document.getElementById('psMismatch');

  // 字段映射常量（与 apps/index.js 的 MESSAGE_FIELDS 一一对应）
  var FM_FIELDS = ['sender', 'content', 'time', 'type', 'plat', 'dm', 'grp', 'mems'];
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  function moduleVariables() {
    var mod = (data.modules || []).find(function (m) { return m.name === moduleSel.value; });
    return mod && Array.isArray(mod.variables) ? mod.variables : [];
  }

  // 渲染字段标签：display 名 (变量名)，同模块下拉惯例
  function fieldLabel(v) {
    return (v.displayName && v.displayName !== v.name) ? v.displayName + ' (' + v.name + ')' : v.name;
  }

  // 重建字段映射下拉：raw + 当前模块的变量名
  function renderFieldMap(fieldMap) {
    FM_FIELDS.forEach(function (f) {
      var sel = document.getElementById('psFm' + f);
      if (!sel) return;
      var cur = (fieldMap && fieldMap[f] && fieldMap[f].source === 'variable') ? fieldMap[f].variable : '';
      var opts = '<option value="">raw</option>';
      moduleVariables().forEach(function (v) {
        opts += '<option value="' + esc(v.name) + '"' + (v.name === cur ? ' selected' : '') + '>' + esc(fieldLabel(v)) + '</option>';
      });
      sel.innerHTML = opts;
    });
  }

  function openSettings() {
    // 优先回显当前已选中模块的已有映射；否则第一个场景
    var sc = currentScene() || data.scenes[0] || { moduleName: '', enabled: true, fieldMap: {} };
    moduleSel.value = sc.moduleName || '';
    enabledChk.checked = sc.enabled !== false;
    renderFieldMap(sc.fieldMap || {});
    checkMismatch();
    overlay.hidden = false;
  }
  function closeSettings() { overlay.hidden = true; }

  if (settingsApp) settingsApp.addEventListener('click', openSettings);
  closeBtn.addEventListener('click', closeSettings);

  // 当前选中的模块对应已有场景（用于回显已保存的字段映射，避免每次重设）
  function currentScene() {
    return (data.scenes || []).find(function (s) { return s.moduleName === moduleSel.value; }) || null;
  }

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

  moduleSel.addEventListener('change', function () {
    var sc = currentScene();
    renderFieldMap(sc ? (sc.fieldMap || {}) : {});
    checkMismatch();
  });

  saveBtn.addEventListener('click', function () {
    var name = moduleSel.value;
    var exists = data.modules.some(function (m) { return m.name === name; });
    if (!exists) { window.alert('请选择一个有效模块'); return; }
    var fieldMap = {};
    FM_FIELDS.forEach(function (f) {
      var sel = document.getElementById('psFm' + f);
      if (sel && sel.value) fieldMap[f] = { source: 'variable', variable: sel.value };
    });
    var scene = {
      moduleName: name,
      enabled: enabledChk.checked,
      fieldMap: fieldMap,
    };
    window.parent.postMessage({ type: 'SAVE_PHONE_CONFIG', scene: scene }, '*');
    closeSettings();
  });

  // 保存回执（父窗口 POST 回）：成功显示「已保存 ✓」，失败显示「保存失败 ✗」
  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.data.type !== 'PHONE_CONFIG_SAVED') return;
    var el = document.getElementById('psResult');
    if (!el) return;
    el.textContent = ev.data.ok ? '已保存 ✓' : '保存失败 ✗';
    el.className = 'ps-result ' + (ev.data.ok ? 'ok' : 'err');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.textContent = ''; }, 2500);
  });
})();
`;

/**
 * 组装完整手机外壳 HTML（用于 IframeModal srcdoc）
 * 结构：状态栏（时间 + 返回/退出）+ 屏幕容器（桌面网格 + 各 App 视图）+ 设置面板。
 * @param {Object} opts
 * @param {Array} opts.cssUrls 样式 URL 列表（外壳 + 各皮肤 css）
 * @param {Array} opts.apps 桌面 App 列表 [{ key, label, icon, html }]；html 为皮肤产出的 App 内视图（会话列表+聊天窗口）
 * @param {Object|null} opts.settings 设置面板数据；为空则不渲染「设置」App 与面板
 */
export function buildPhoneHtml({ cssUrls = [], apps = [], settings = null, initView = 'home' }) {
    const now = currentClock();
    const links = cssUrls.map((u) => `<link rel="stylesheet" href="${escapeHtml(u)}">`).join('\n');

    // 「设置」App（固定在桌面；图标用 SVG 齿轮）
    const settingsApp = settings
        ? `<button class="app-icon" type="button" data-app="settings">
             <span class="app-icon-img" style="background:#8e8e93">${skinIcon('settings')}</span>
             <span class="app-icon-label">设置</span>
           </button>`
        : '';

    // 桌面（首页）：App 图标网格（图标 = 各皮肤品牌 SVG + 品牌色底）
    const emptyHtml = apps.length
        ? ''
        : `<div class="phone-empty">暂无应用，请在手机设置中添加模块</div>`;
    const homeApps = emptyHtml + apps.map((a) => `
            <button class="app-icon" type="button" data-app="${escapeHtml(a.key)}">
                <span class="app-icon-img" style="background:${escapeHtml(a.iconBg || '#4f8cff')}">${skinIcon(a.iconKey || 'generic')}</span>
                <span class="app-icon-label">${escapeHtml(a.label)}</span>
            </button>`).join('') + settingsApp;
    const homeView = `<div class="phone-home" id="phoneHome"><div class="phone-home-grid">${homeApps}</div></div>`;

    // 每个 App 的视图（皮肤已产出会话列表 + 聊天窗口），默认隐藏
    const appViews = apps.map((a) => `
        <div class="phone-app" id="app-${escapeHtml(a.key)}" hidden>
            ${a.html}
        </div>`).join('');

    // 设置面板：「设置」App 打开
    const overlay = settings ? buildSettingsOverlay(settings) : '';
    const navScript = settings ? NAV_SCRIPT : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${links}
</head>
<body>
<div class="phone-frame">
  <div class="phone">
    <div class="phone-statusbar">
      <div class="ps-left">
        <button class="ps-back" type="button" title="返回" hidden>‹ 返回</button>
      </div>
      <span class="ps-time">${now}</span>
      <div class="ps-right">
        <button class="ps-exit" type="button" title="退出手机">✕</button>
      </div>
    </div>
    <div class="phone-screen-host" id="phoneScreenHost">
      ${homeView}
      ${appViews}
    </div>
    ${overlay}
    <script>window.__PHONE_INIT_VIEW = ${JSON.stringify(initView || 'home')};</script>
    ${navScript}
  </div>
</div>
</body>
</html>`;
}

// 桌面 ↔ App（会话列表）↔ 会话（聊天窗口）导航脚本（纯静态）。
// 状态栏：右上角退出常驻、左侧返回键逐级返回（会话 → App → 桌面）。
// 每次切换界面都上报父窗口，便于重开时恢复；初始按 __PHONE_INIT_VIEW 恢复（仅恢复到 App 级）。
// 皮肤只提供视图内容；本脚本按皮肤容器的 data-conv 属性切换（list 容器 .phone-conv-list-host，
// chats 容器 .phone-chat-views的直接子元素带 data-conv）。
const NAV_SCRIPT = `
<script>
(function () {
  var home = document.getElementById('phoneHome');
  var apps = Array.prototype.slice.call(document.querySelectorAll('.phone-app'));
  var overlay = document.getElementById('phoneSettings');
  var psExit = document.querySelector('.ps-exit');   // 右上角：常驻退出小手机
  var psBack = document.querySelector('.ps-back');   // 状态栏左侧：逐级返回

  var state = { view: 'home', appId: '' };           // view: home | app | chat

  function reportView(v) {
    try { window.parent.postMessage({ type: 'PHONE_VIEW_CHANGED', view: v }, '*'); } catch (e) {}
  }
  function showAppChrome() { if (psBack) psBack.hidden = false; }
  function showHomeChrome() { if (psBack) psBack.hidden = true; }
  function resetAppToConvList(appEl) {
    var listHost = appEl.querySelector('.phone-conv-list-host');
    if (listHost) listHost.hidden = false;
    var views = appEl.querySelector('.phone-chat-views');
    if (views) {
      // 会话列表视图：整个聊天视图容器隐藏（空态无会话时也占满整屏，避免两个 flex:1 各占半屏）
      views.hidden = true;
      Array.prototype.forEach.call(views.children, function (v) {
        if (v.hasAttribute('data-conv')) v.hidden = true;
      });
    }
  }

  function openApp(key) {
    home.hidden = true;
    apps.forEach(function (el) { el.hidden = (el.id !== 'app-' + key); });
    showAppChrome();
    var appEl = document.getElementById('app-' + key);
    if (appEl) {
      resetAppToConvList(appEl);
      var list = appEl.querySelector('.phone-conv-list-host .g-conv-list, .phone-conv-list-host ul');
      if (list) list.scrollTop = 0;
    }
    state.view = 'app';
    state.appId = key;
    reportView(key);
  }
  function openChat(key, idx) {
    var appEl = document.getElementById('app-' + key);
    if (!appEl) return;
    var listHost = appEl.querySelector('.phone-conv-list-host');
    if (listHost) listHost.hidden = true;
    var views = appEl.querySelector('.phone-chat-views');
    if (views) {
      views.hidden = false;
      Array.prototype.forEach.call(views.children, function (v) {
        if (v.hasAttribute('data-conv')) v.hidden = (v.getAttribute('data-conv') !== String(idx));
      });
    }
    state.view = 'chat';
    state.appId = key;
    reportView(key);
  }
  function goHome() {
    state.view = 'home';
    state.appId = '';
    apps.forEach(function (el) { el.hidden = true; });
    home.hidden = false;
    showHomeChrome();
    if (overlay) overlay.hidden = true;
    reportView('home');
  }
  function handleBack() {
    if (state.view === 'chat' && state.appId) {
      var appEl = document.getElementById('app-' + state.appId);
      if (appEl) { resetAppToConvList(appEl); state.view = 'app'; reportView(state.appId); }
      return;
    }
    goHome();
  }

  document.querySelectorAll('.app-icon').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-app');
      if (key === 'settings') return; // 设置由 SETTINGS_SCRIPT 处理
      openApp(key);
    });
  });

  // 会话列表 → 会话：事件委托，避免皮肤容器结构差异
  apps.forEach(function (appEl) {
    var listHost = appEl.querySelector('.phone-conv-list-host');
    if (!listHost) return;
    listHost.addEventListener('click', function (e) {
      var item = e.target.closest ? e.target.closest('[data-conv]') : null;
      if (!item || !appEl.id) return;
      var idx = item.getAttribute('data-conv');
      if (idx == null) return;
      openChat(appEl.id.replace(/^app-/, ''), idx);
    });
  });

  // 聊天页内返回（拟真 App：皮肤顶栏自带返回按钮，点击回到该 App 会话列表）
  apps.forEach(function (appEl) {
    var views = appEl.querySelector('.phone-chat-views');
    if (!views) return;
    views.addEventListener('click', function (e) {
      var back = e.target.closest ? e.target.closest('.js-chat-back') : null;
      if (!back || !appEl.id) return;
      var appId = appEl.id.replace(/^app-/, '');
      var target = document.getElementById('app-' + appId);
      if (target) { resetAppToConvList(target); state.view = 'app'; state.appId = appId; reportView(appId); }
    });
  });

  if (psBack) psBack.addEventListener('click', handleBack);
  if (psExit) psExit.addEventListener('click', function () {
    window.parent.postMessage({ type: 'CLOSE_CONTINUITY_MODAL' }, '*');
  });

  // 初始界面：恢复到退出时所在的 App（会话列表级）
  var initView = (window.__PHONE_INIT_VIEW || 'home');
  if (initView !== 'home' && document.getElementById('app-' + initView)) {
    openApp(initView);
  } else {
    showHomeChrome();
    reportView('home');
  }
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