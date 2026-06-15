/**
 * 通用拖拽处理
 * 用于模块列表和变量列表的拖拽排序
 */

// 拖拽状态
let dragSrcEl = null;
let dragType = null; // 'module' or 'variable'
let dropPosition = null; // 'before' or 'after'

export function getDragState() {
    return { dragSrcEl, dragType, dropPosition };
}

export function handleDragStart(e, item, type, dragImageElement) {
    dragSrcEl = item;
    dragType = type;
    e.dataTransfer.effectAllowed = 'move';

    if (dragImageElement) {
        e.dataTransfer.setDragImage(dragImageElement, 0, 0);
    }

    e.dataTransfer.setData('text/plain', item.dataset.index);

    setTimeout(() => {
        item.classList.add('dragging');
    }, 0);
}

export function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }

    const target = e.currentTarget;
    if (dragType === 'module' && !target.classList.contains('module-list-item')) return false;
    if (dragType === 'variable' && !target.classList.contains('variable-edit-item')) return false;
    if (target === dragSrcEl) return false;

    const rect = target.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;

    if (offsetY < rect.height / 2) {
        dropPosition = 'before';
        target.classList.add('over-top');
        target.classList.remove('over-bottom');
    } else {
        dropPosition = 'after';
        target.classList.add('over-bottom');
        target.classList.remove('over-top');
    }

    e.dataTransfer.dropEffect = 'move';
    return false;
}

export function handleDragEnter(e) {
    // 逻辑已移至 handleDragOver 以支持动态位置判断
}

export function handleDragLeave(e) {
    if (this.contains(e.relatedTarget)) return;
    this.classList.remove('over-top');
    this.classList.remove('over-bottom');
}

export function handleDrop(e, item, type, dataArray, renderCallback) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    if (dragSrcEl !== item && dragType === type) {
        const srcIndex = parseInt(dragSrcEl.dataset.index);
        let targetIndex = parseInt(item.dataset.index);

        if (dropPosition === 'after') {
            targetIndex++;
        }

        if (!isNaN(srcIndex) && !isNaN(targetIndex)) {
            const movedItem = dataArray[srcIndex];
            dataArray.splice(srcIndex, 1);

            if (srcIndex < targetIndex) {
                targetIndex--;
            }

            dataArray.splice(targetIndex, 0, movedItem);
            renderCallback();
        }
    }

    return false;
}

export function handleDragEnd(e, doc) {
    const srcEl = e.currentTarget || this;
    if (srcEl) srcEl.classList.remove('dragging');

    const selector = dragType === 'module' ? '.module-list-item' : '.variable-edit-item';
    doc.querySelectorAll(selector).forEach(el => {
        el.classList.remove('over-top');
        el.classList.remove('over-bottom');
    });
}
