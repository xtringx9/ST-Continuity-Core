import { syncStThemeToIframe } from '../../shared/iframeThemeSync.js';

/**
 * Renders Continuity custom HTML inside an isolated iframe.
 *
 * Iframe content runs in its own window/document. Custom HTML that needs to
 * reach the SillyTavern page should explicitly use window.parent.
 */
// 稳定的内容挂载点：首次 srcdoc 创建，后续只替换其内部 HTML，避免整文档重建
const CONTENT_ROOT_ID = 'cc-iframe-content-root';

// iframe 基础交互脚本（body 同级，首次 srcdoc 注入一次，增量路径由 ensureBaseScripts 补齐）
const interactionScript = `
    <script>
        window.toggleVariableDisplay = function(id) {
            const container = document.getElementById(id);
            if (!container) return;

            const currentSpan = container.querySelector('.cc-variable-change-current');
            const lastSpan = container.querySelector('.cc-variable-change-last');
            if (!currentSpan || !lastSpan) return;

            if (currentSpan.style.display !== 'none') {
                currentSpan.style.display = 'none';
                lastSpan.style.display = 'inline';
                container.title = '点击显示旧值：' + lastSpan.textContent;
            } else {
                currentSpan.style.display = 'inline';
                lastSpan.style.display = 'none';
                container.title = '点击显示新值：' + currentSpan.textContent;
            }

            if (typeof window.updateHeight === 'function') {
                setTimeout(window.updateHeight, 0);
            }
        };
    </script>`;

const resizeScript = `
    <script>
        window.updateHeight = function() {
            const html = document.documentElement;
            const height = html.offsetHeight;
            if (window.frameElement) {
                window.frameElement.style.height = height + 'px';
            }
        };
        // 幂等 guard：增量更新可能重复执行本脚本，避免 ResizeObserver 累积泄漏
        if (!window.__ccResizeAttached) {
            window.__ccResizeAttached = true;
            const observer = new ResizeObserver(window.updateHeight);
            observer.observe(document.body);
            document.addEventListener('toggle', () => setTimeout(window.updateHeight, 50), true);
            window.addEventListener('load', window.updateHeight);
            window.addEventListener('resize', window.updateHeight);
        }
    </script>`;

/**
 * innerHTML 赋值不会自动执行其中的 <script>。模块自定义交互脚本在增量更新后需手动重跑。
 */
function rerunContentScripts(root) {
    root.querySelectorAll('script').forEach(old => {
        const neo = root.ownerDocument.createElement('script');
        neo.textContent = old.textContent;
        old.replaceWith(neo);
    });
}

/**
 * 确保 iframe 基础交互脚本就位（增量更新不会重跑 body 脚本，这里补齐）。
 * interactionScript 幂等赋函数；resizeScript 自带 observer guard，重复执行不泄漏。
 */
function ensureBaseScripts(iframe) {
    const win = iframe.contentWindow;
    if (!win || win.__ccBaseReady) return;
    const doc = iframe.contentDocument;
    if (!doc || !doc.body) return;
    if (typeof win.toggleVariableDisplay === 'function' && typeof win.updateHeight === 'function') {
        win.__ccBaseReady = true;
        return;
    }
    const run = (code) => {
        const s = doc.createElement('script');
        s.textContent = code;
        doc.body.appendChild(s);
    };
    run(interactionScript);
    run(resizeScript);
    win.__ccBaseReady = true;
}

export function injectHtmlToIframe(container, htmlString) {
    const domNode = container.jquery ? container[0] : container;

    let iframe = domNode.querySelector('iframe');
    if (!iframe) {
        domNode.innerHTML = '';
        iframe = document.createElement('iframe');
        Object.assign(iframe.style, {
            width: '100%',
            border: 'none',
            overflow: 'hidden',
            display: 'block',
            backgroundColor: 'transparent',
        });
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('scrolling', 'no');

        domNode.appendChild(iframe);
    }

    const doc = iframe.contentDocument;
    const contentRoot = doc && doc.getElementById(CONTENT_ROOT_ID);

    // 已加载过（挂载点存在）：仅替换内部 HTML，保留 head CSS link + 已注册的 ResizeObserver/脚本。
    // 这样每次刷新不再重拉 CSS、不重建 window/observer，消除 O(刷新次数) 的文档重建开销。
    // 注意：innerHTML 不执行 <script>，故重跑内容脚本并补齐基础脚本。
    if (contentRoot) {
        contentRoot.innerHTML = htmlString;
        rerunContentScripts(contentRoot);
        ensureBaseScripts(iframe);
        // 主题同步（已加载文档上幂等且廉价，保证换肤即时生效）
        syncStThemeToIframe(iframe, { inheritBackground: false });
        return;
    }

    // 首次：完整 srcdoc（含 CSS link + 内容挂载点 + 交互/尺寸脚本）。
    // 内容直接写入挂载点；onload 后同步主题。后续调用走上方增量分支。
    const fullHtml = `
<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="./scripts/extensions/third-party/ST-Continuity-Core/assets/css/context-bottom-ui.css"></head>
<body style="margin:0;padding:0;background:transparent;"><div id="${CONTENT_ROOT_ID}">${htmlString}</div>${interactionScript}${resizeScript}</body>
</html>`;

    // 继承 ST 主题（消息内 iframe 保持透明背景，不继承 ST body 背景）
    iframe.onload = () => syncStThemeToIframe(iframe, { inheritBackground: false });
    iframe.srcdoc = fullHtml;
}

