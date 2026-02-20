import { i18n } from '../../_utils/i18n.js';

function truncate(value, length = 50) {
    if (typeof value === 'string') {
        if (value.length > length) {
            return `"${value.substring(0, length)}..."`;
        }
        return `"${value}"`;
    }
    if (Array.isArray(value)) {
        return `[${value.length} items]`;
    }
    if (value === undefined) {
        return 'N/A';
    }
    return String(value);
}

function compareObjects(obj1, obj2, keysToIgnore = []) {
    const changes = [];
    const allKeys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

    for (const key of allKeys) {
        if (keysToIgnore.includes(key)) continue;

        const val1 = JSON.stringify(obj1 ? obj1[key] : undefined);
        const val2 = JSON.stringify(obj2 ? obj2[key] : undefined);

        if (val1 !== val2) {
            changes.push({
                key,
                oldValue: truncate(obj1 ? obj1[key] : undefined),
                newValue: truncate(obj2 ? obj2[key] : undefined),
            });
        }
    }
    return changes;
}

function compareModuleLists(list1, list2) {
    const map1 = new Map((list1 || []).map(m => [m.name, m]));
    const map2 = new Map((list2 || []).map(m => [m.name, m]));
    const added = (list2 || []).filter(m => !map1.has(m.name));
    const deleted = (list1 || []).filter(m => !map2.has(m.name));
    const modified = [];

    for (const [name, module2] of map2) {
        if (map1.has(name)) {
            const module1 = map1.get(name);
            if (JSON.stringify(module1) !== JSON.stringify(module2)) {
                const moduleChanges = compareObjects(module1, module2, ['variables']);
                const variableChanges = compareObjects(
                    { vars: module1.variables || [] },
                    { vars: module2.variables || [] }
                );

                if (variableChanges.length > 0) {
                    moduleChanges.push({
                        key: 'variables',
                        oldValue: `[${(module1.variables || []).length} 个变量]`,
                        newValue: `[${(module2.variables || []).length} 个变量] (有修改)`,
                    });
                }

                if (moduleChanges.length > 0) {
                    modified.push({ module: module2, changes: moduleChanges });
                }
            }
        }
    }

    return { added, deleted, modified };
}


/**
 * Compares original and current configurations to generate a summary of changes.
 * @param {Array} originalModules
 * @param {Array} currentModules
 * @param {Object} originalSettings
 * @param {Object} currentSettings
 * @returns {{html: string, hasChanges: boolean}}
 */
export function generateChangesSummary(originalModules, currentModules, originalSettings, currentSettings) {
    let html = '';
    let hasChanges = false;

    // 1. Compare Global Settings
    const settingsChanges = compareObjects(originalSettings, currentSettings);
    if (settingsChanges.length > 0) {
        hasChanges = true;
        html += '<h4>全局设置变更:</h4><ul>';
        settingsChanges.forEach(change => {
            const label = i18n.t(`label_global_${change.key.replace(/([A-Z])/g, '_$1').toLowerCase()}`, 'module_editor') || change.key;
            html += `<li><strong>${label}</strong>: <span class="change-old">${change.oldValue}</span> → <span class="change-new">${change.newValue}</span></li>`;
        });
        html += '</ul>';
    }

    // 2. Compare Modules
    const moduleChanges = compareModuleLists(originalModules, currentModules);
    if (moduleChanges.added.length > 0 || moduleChanges.deleted.length > 0 || moduleChanges.modified.length > 0) {
        hasChanges = true;
        html += '<h4>模块定义变更:</h4>';

        if (moduleChanges.added.length > 0) {
            html += '<h5>新增模块:</h5><ul>';
            moduleChanges.added.forEach(mod => {
                html += `<li><span class="change-new">${mod.displayName || mod.name}</span></li>`;
            });
            html += '</ul>';
        }

        if (moduleChanges.deleted.length > 0) {
            html += '<h5>删除模块:</h5><ul>';
            moduleChanges.deleted.forEach(mod => {
                html += `<li><span class="change-deleted">${mod.displayName || mod.name}</span></li>`;
            });
            html += '</ul>';
        }

        if (moduleChanges.modified.length > 0) {
            html += '<h5>修改模块:</h5>';
            moduleChanges.modified.forEach(modChange => {
                html += `<details><summary>${modChange.module.displayName || modChange.module.name}</summary><ul>`;
                modChange.changes.forEach(change => {
                    html += `<li><strong>${change.key}</strong>: <span class="change-old">${change.oldValue}</span> → <span class="change-new">${change.newValue}</span></li>`;
                });
                html += '</ul></details>';
            });
        }
    }

    if (!hasChanges) {
        html = '<p>未检测到任何更改。</p>';
    }

    return { html, hasChanges };
}