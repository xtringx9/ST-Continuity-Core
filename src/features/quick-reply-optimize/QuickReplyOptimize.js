// 优化 SillyTavern 原生 Quick Reply：
// 1) 横滑——任意宽度下，只要 #qr--bar 内容超过一行就单行横向滚动，避免堆成多行挤占聊天区。
// 2) 按住拖拽平移——不用去拖滚动条，直接按住栏体左右拖动即可滚动按钮列表。
// 3) 滚动条完全隐藏（省高度），横向滚动仍可用（靠拖拽平移 / 滚轮）；跨浏览器用 scrollbar-width/-ms-overflow-style/::-webkit-scrollbar。
// 4) 横滑默认从开头（首）显示：每次 #qr--bar 被重建（QR 配置保存/刷新）时把 scrollLeft 归零。
//
// 关键：原生 #qr--bar > .qr--buttons 是 display:flex; flex-wrap:wrap; width:100% 且会 flex-shrink，
// 因此多行是 .qr--buttons 内部换行造成的；要让其横滑，必须同时禁止 .qr--buttons 的 shrink 与 wrap。
// 原生 #qr--bar（style.css:25）是 justify-content:center，溢出横滑时首按钮会被推到视口外，需改为 flex-start。
//
// overflow-x:auto 只在内容溢出时才出现滚动条，不溢出时布局与原生一致。

const STYLE_ID = 'ccore_qr_optimize_styles';
let observer = null;

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#qr--bar {
    flex: 1 1 100% !important;
    min-width: 0 !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    /* 强制单行：不合并时每个集合是独立的 .qr--buttons 组，避免被某些主题/flex 类换成 wrap 而竖排 */
    flex-wrap: nowrap !important;
    /* 组间间距改由分割线两侧 padding 控制，抵消原生 flexGap5 以免干扰对称性 */
    gap: 0 !important;
    /* 原生为 center，溢出横滑时首按钮被推出视口外；用 safe center：放得下时居中，放不下(溢出)时回退到 start 保证首按钮可见 */
    justify-content: safe center !important;
    padding: 1px 0 !important;
    /* 不显示滚动条（省高度），横向滚动仍可用（按住栏体拖拽平移） */
    scrollbar-width: none !important;        /* Firefox */
    -ms-overflow-style: none !important;     /* 旧 Edge / IE */
}
#qr--bar::-webkit-scrollbar {
    display: none !important;                /* Chrome / Safari / Edge */
}
#qr--bar > .qr--buttons,
#qr--bar > .qr--buttons > .qr--buttons {
    flex-wrap: nowrap !important;
    flex: 0 0 auto !important;
    width: auto !important;
    justify-content: flex-start !important;
}
/* 原生 #qr--bar > .qr--buttons:has(.qr--buttons.qr--color){margin:5px} 只对「合并」生效
   （合并时外层 .qr--buttons 内含彩色集合），不合并时不命中，导致合并模式比不合并高 10px。
   这里抵消，两种模式竖向高度一致、都更省空间。 */
#qr--bar > .qr--buttons:has(.qr--buttons.qr--color) {
    margin: 0 !important;
}
#qr--bar .qr--button {
    flex: 0 0 auto !important;
    /* 缩小按钮：更小内边距、字号、行高，降低栏高 */
    padding: 1px 7px !important;
    margin: 2px 0 !important;
    font-size: 0.85em !important;
    line-height: 1.4 !important;
    border-radius: 8px !important;
}
/* 不合并时每个集合是独立的 .qr--buttons 组；在相邻组之间画分割线（合并时只有一个组，不显示） */
#qr--bar > .qr--buttons {
    position: relative !important;
}
/* 分割线夹在两组之间：两组各让出 8px，线居中，左右严格对称 */
#qr--bar > .qr--buttons + .qr--buttons {
    padding-left: 8px !important;
}
#qr--bar > .qr--buttons:has(+ .qr--buttons) {
    padding-right: 8px !important;
}
#qr--bar > .qr--buttons + .qr--buttons::before {
    content: '' !important;
    position: absolute !important;
    left: 0 !important;             /* 线落在两组边界正中 */
    top: 15% !important;
    bottom: 15% !important;
    width: 1px !important;
    background: var(--SmartThemeBorderColor) !important;
}
/* 拖拽平移时禁用选中、显示抓取光标 */
#qr--bar.ccore-qr-dragging {
    cursor: grabbing !important;
    user-select: none !important;
}
`;
    document.head.appendChild(style);
}

/** 把新出现的 #qr--bar 滚动位置归零（从首开始显示）。 */
function resetScroll(node) {
    if (node.id === 'qr--bar') {
        node.scrollLeft = 0;
    } else if (node.querySelectorAll) {
        node.querySelectorAll('#qr--bar').forEach((bar) => { bar.scrollLeft = 0; });
    }
}

/**
 * 给 #qr--bar 绑定「按住拖拽横向平移」手势：
 * 不必去拖滚动条，按下后左右拖动即可滚动按钮列表；拖动超过阈值则吞掉误触发的按钮 click。
 */
function attachDragScroll(bar) {
    if (bar.dataset.ccoreDragScroll) return;
    bar.dataset.ccoreDragScroll = '1';

    let down = false;
    let startX = 0;
    let startScroll = 0;
    let moved = false;

    const onMove = (e) => {
        if (!down) return;
        const dx = e.clientX - startX;
        if (Math.abs(dx) > 4) moved = true;
        bar.scrollLeft = startScroll - dx;
    };

    const onUp = () => {
        if (!down) return;
        down = false;
        bar.classList.remove('ccore-qr-dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) {
            // 拖拽结束后紧跟的 click 是误触（落在按钮上），在捕获阶段拦截一次
            const suppress = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                window.removeEventListener('click', suppress, true);
            };
            window.addEventListener('click', suppress, true);
        }
    };

    bar.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // 仅左键
        down = true;
        moved = false;
        startX = e.clientX;
        startScroll = bar.scrollLeft;
        bar.classList.add('ccore-qr-dragging');
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });
}

function handleNode(node) {
    resetScroll(node);
    if (node.id === 'qr--bar') {
        attachDragScroll(node);
    } else if (node.querySelectorAll) {
        node.querySelectorAll('#qr--bar').forEach(attachDragScroll);
    }
}

function attachTo(target) {
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
        observer.disconnect();
        try {
            for (const m of mutations) {
                m.addedNodes.forEach(handleNode);
            }
        } finally {
            if (observer) observer.observe(target, { childList: true, subtree: true });
        }
    });
    observer.observe(target, { childList: true, subtree: true });
}

export function initQuickReplyOptimize() {
    injectStyles();
    const sendForm = document.getElementById('send_form');
    if (sendForm) {
        sendForm.querySelectorAll('#qr--bar').forEach(handleNode);
        attachTo(sendForm);
    } else {
        const boot = new MutationObserver(() => {
            const sf = document.getElementById('send_form');
            if (sf) {
                boot.disconnect();
                sf.querySelectorAll('#qr--bar').forEach(handleNode);
                attachTo(sf);
            }
        });
        boot.observe(document.body, { childList: true, subtree: true });
    }
}

/** 关闭 / 禁用插件时还原：移除注入的样式与监听，#qr--bar 恢复原生行为。 */
export function removeQuickReplyOptimize() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    document.getElementById(STYLE_ID)?.remove();
}
