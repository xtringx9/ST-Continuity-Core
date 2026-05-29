/**
 * Renders Continuity custom HTML inside an isolated iframe.
 *
 * Iframe content runs in its own window/document. Custom HTML that needs to
 * reach the SillyTavern page should explicitly use window.parent.
 */
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

    const interactionScript = `
    <script>
        window.toggleVariableDisplay = function(id, lastValue, currentValue) {
            const container = document.getElementById(id);
            if (!container) return;

            const currentSpan = container.children[0];
            const lastSpan = container.children[1];
            if (!currentSpan || !lastSpan) return;

            if (currentSpan.style.display !== 'none') {
                currentSpan.style.display = 'none';
                lastSpan.style.display = 'inline';
                container.title = '点击显示新值: ' + currentValue;
            } else {
                currentSpan.style.display = 'inline';
                lastSpan.style.display = 'none';
                container.title = '点击显示旧值: ' + lastValue;
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
        const observer = new ResizeObserver(window.updateHeight);
        observer.observe(document.body);
        document.addEventListener('toggle', () => setTimeout(window.updateHeight, 50), true);
        window.addEventListener('load', window.updateHeight);
        window.addEventListener('resize', window.updateHeight);
    </script>`;

    const fullHtml = `
    <!DOCTYPE html>
    <html>
    <head><link rel="stylesheet" href="./scripts/extensions/third-party/ST-Continuity-Core/assets/css/context-bottom-ui.css"></head>
    <body style="margin:0;padding:0;background:transparent;">${htmlString}${interactionScript}${resizeScript}</body>
    </html>`;

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(fullHtml);
    doc.close();
}
