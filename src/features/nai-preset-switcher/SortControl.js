// src/features/nai-preset-switcher/SortControl.js
// 卡片排序控件：图标按钮 + 下拉菜单（名称 / 创建时间 / 修改时间，各含正反序）。
// 与 NaiPresetSwitcher 解耦：通过 { getCurrentMode, onModeChange } 回调同步排序模式。

const SORT_OPTIONS = [
    { mode: 'nameAsc', label: '名称（A→Z）' },
    { mode: 'nameDesc', label: '名称（Z→A）' },
    { mode: 'createdDesc', label: '创建时间（新→旧）' },
    { mode: 'createdAsc', label: '创建时间（旧→新）' },
    { mode: 'updatedDesc', label: '修改时间（新→旧）' },
    { mode: 'updatedAsc', label: '修改时间（旧→新）' },
];

function labelOf(mode) {
    const opt = SORT_OPTIONS.find(o => o.mode === mode);
    return opt ? opt.label : SORT_OPTIONS[0].label;
}

/**
 * 初始化排序控件。
 * @param {Document} doc Iframe 文档
 * @param {{getCurrentMode: () => string, onModeChange: (mode: string) => void}} handlers
 * @param {Array<{mode:string,label:string}>} [options] 自定义选项（默认用预设管理的 6 档）
 * @param {string} [btnId] 按钮 id（默认 'np-sort'，图片管理用 'np-img-sort'）
 */
export function initSortControl(doc, handlers, options, btnId) {
    const btn = doc.getElementById(btnId || 'np-sort');
    if (!btn) return;

    const OPTS = options && options.length ? options : SORT_OPTIONS;
    const labelOfLocal = (mode) => {
        const opt = OPTS.find(o => o.mode === mode);
        return opt ? opt.label : OPTS[0].label;
    };

    const renderBtn = () => {
        const mode = handlers.getCurrentMode();
        btn.innerHTML = `<span class="np-sort-icon">⇅</span><span class="np-sort-label">${labelOfLocal(mode)}</span>`;
    };
    renderBtn();

    let menu = null;

    const closeMenu = () => {
        if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
        menu = null;
        doc.removeEventListener('click', onDocClick, true);
    };

    const onDocClick = (e) => {
        if (menu && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            closeMenu();
        }
    };

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu) { closeMenu(); return; }

        const rect = btn.getBoundingClientRect();
        menu = doc.createElement('div');
        menu.className = 'np-sort-menu';
        menu.style.position = 'absolute';
        menu.style.zIndex = '60';
        menu.style.minWidth = '160px';
        menu.style.background = 'var(--bg-card, #fff)';
        menu.style.border = '1px solid var(--border-color, rgba(128,128,128,0.25))';
        menu.style.borderRadius = '6px';
        menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
        menu.style.padding = '4px';
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${rect.left}px`;

        const current = handlers.getCurrentMode();
        OPTS.forEach(opt => {
            const item = doc.createElement('div');
            item.className = 'np-sort-menu-item' + (opt.mode === current ? ' active' : '');
            item.textContent = opt.label;
            item.style.padding = '7px 10px';
            item.style.cursor = 'pointer';
            item.style.borderRadius = '4px';
            item.style.fontSize = '13px';
            item.style.color = 'var(--text-primary, #222)';
            if (opt.mode === current) {
                item.style.background = 'var(--accent-color, #2563eb)';
                item.style.color = '#fff';
            }
            item.addEventListener('mouseenter', () => {
                if (opt.mode !== current) item.style.background = 'var(--bg-hover, #f3f4f6)';
            });
            item.addEventListener('mouseleave', () => {
                if (opt.mode !== current) item.style.background = 'transparent';
            });
            item.addEventListener('click', (ev) => {
                ev.stopPropagation();
                handlers.onModeChange(opt.mode);
                renderBtn();
                closeMenu();
            });
            menu.appendChild(item);
        });

        doc.body.appendChild(menu);
        // 延后注册，避免本次 click 立即触发关闭
        setTimeout(() => doc.addEventListener('click', onDocClick, true), 0);
    });
}
