import { translate } from '../../../../../../i18n.js';

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        return unsafe;
    }
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * 格式化变更值为可读的HTML。
 * - 对长字符串使用可展开的 <details> 标签。
 * - 对数组显示其长度。
 * - 对其他值进行HTML转义。
 * @param {*} value - 要格式化的值
 * @param {number} length - 字符串截断长度
 * @returns {string} - 格式化后的HTML字符串
 */
function formatChangeValue(value, length = 50) {
    if (value === undefined) {
        return 'N/A';
    }
    if (Array.isArray(value)) {
        return `[${value.length} 项]`;
    }
    if (typeof value === 'string') {
        if (value.length > length) {
            // 使用 <details> 标签创建可展开的区域
            return `<details style="display: inline-block; cursor: pointer; max-width: 100%;">
                        <summary style="display: inline; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">"${escapeHtml(value.substring(0, length))}..."</summary>
                        <pre style="margin-top: 5px; padding: 5px; background: rgba(0,0,0,0.1); border-radius: 3px; white-space: pre-wrap; word-break: break-all;">${escapeHtml(value)}</pre>
                    </details>`;
        }
        return `"${escapeHtml(value)}"`;
    }
    return escapeHtml(String(value));
}

function compareObjects(obj1, obj2, keysToIgnore = []) {
    const changes = [];
    const allKeys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

    for (const key of allKeys) {
        if (keysToIgnore.includes(key)) continue;

        const val1 = obj1 ? obj1[key] : undefined;
        const val2 = obj2 ? obj2[key] : undefined;

        // 对数组进行特殊处理，以显示具体差异
        if (Array.isArray(val1) || Array.isArray(val2)) {
            const arr1 = val1 || [];
            const arr2 = val2 || [];
            if (JSON.stringify(arr1.sort()) !== JSON.stringify(arr2.sort())) {
                const set1 = new Set(arr1);
                const set2 = new Set(arr2);
                const added = [...set2].filter(item => !set1.has(item));
                const removed = [...set1].filter(item => !set2.has(item));
                let details = [];
                if (added.length > 0) details.push(`新增: "${added.join('", "')}"`);
                if (removed.length > 0) details.push(`移除: "${removed.join('", "')}"`);
                changes.push({ key, oldValue: arr1, newValue: arr2, details: details.join('; ') });
            }
        } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
            changes.push({
                key, oldValue: val1, newValue: val2,
            });
        }
    }
    return changes;
}

function compareVariables(vars1, vars2) {
    const changes = [];
    const map1 = new Map((vars1 || []).map(v => [v.name, v]));
    const map2 = new Map((vars2 || []).map(v => [v.name, v]));

    // Added variables
    (vars2 || []).filter(v => !map1.has(v.name)).forEach(v => {
        changes.push({
            isVariableChange: true,
            variableName: v.name,
            key: 'added', // Special key for new variable
            oldValue: '-',
            newValue: v.displayName || v.name
        });
    });

    // Deleted variables
    (vars1 || []).filter(v => !map2.has(v.name)).forEach(v => {
        changes.push({
            isVariableChange: true,
            variableName: v.name,
            key: 'deleted', // Special key for deleted variable
            oldValue: v.displayName || v.name,
            newValue: '-'
        });
    });

    // Modified variables
    (vars2 || []).filter(v => map1.has(v.name)).forEach(v2 => {
        const v1 = map1.get(v2.name);
        if (JSON.stringify(v1) !== JSON.stringify(v2)) {
            const propChanges = compareObjects(v1, v2, ['id']); // Ignore id changes for variables
            propChanges.forEach(pc => {
                changes.push({
                    isVariableChange: true,
                    variableName: v2.name,
                    key: pc.key,
                    oldValue: pc.oldValue,
                    newValue: pc.newValue,
                    details: pc.details,
                });
            });
        }
    });

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

                const varChanges = compareVariables(module1.variables || [], module2.variables || []);
                moduleChanges.push(...varChanges);

                if (moduleChanges.length > 0) {
                    modified.push({ module: module2, changes: moduleChanges });
                }
            }
        }
    }

    return { added, deleted, modified };
}

const variableKeyToI18nKey = {
    'name': 'label_var_name',
    'displayName': 'label_var_display_name',
    'description': 'label_var_description',
    'enabled': 'label_var_enabled',
    'isIdentifier': 'label_var_identifier',
    'isBackupIdentifier': 'label_var_backup_identifier',
    'isHideCondition': 'label_var_hide_condition',
    'hideConditionValues': 'label_var_hide_values',
    'isNoNormalize': 'label_var_no_normalize',
    'customStyles': 'label_var_custom_styles',
    'compatibleVariableNames': 'label_compatible_variables'
};

function getVariablePropertyLabel(key) {
    return translate(`ccore_${variableKeyToI18nKey[key] || key}`);
}


const moduleKeyToI18nKey = {
    'displayName': 'label_display_name',
    'enabled': 'label_enabled',
    'outputPosition': 'label_output_pos',
    'outputMode': 'label_output_mode',
    'rangeMode': 'label_range_mode',
    'retainLayers': 'label_retain_layers',
    'timeReferenceStandard': 'label_time_ref',
    'isExternalDisplay': 'label_external',
    'compatibleModuleNames': 'label_compatible_modules',
    'timingPrompt': 'label_prompt_timing',
    'prompt': 'label_prompt_gen',
    'contentPrompt': 'label_prompt_usage',
    'positionPrompt': 'label_prompt_position',
    'containerStyles': 'label_styles_container',
    'externalStyles': 'label_styles_external',
    'customStyles': 'label_styles_custom',
    'itemMin': 'label_item_min',
    'itemMax': 'label_item_max',
};
function getModulePropertyLabel(key) {
    return translate(`ccore_${moduleKeyToI18nKey[key] || key}`);
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
            const label = translate(`ccore_label_global_${change.key.replace(/([A-Z])/g, '_$1').toLowerCase()}`) || change.key;
            const oldValueFormatted = formatChangeValue(change.oldValue);
            const newValueFormatted = formatChangeValue(change.newValue);
            html += `<li><strong>${escapeHtml(label)}</strong>: <span class="change-old">${oldValueFormatted}</span> → <span class="change-new">${newValueFormatted}</span>`;
            if (change.details) {
                html += `<div class="change-details" style="font-size: 0.9em; color: #888; margin-left: 1em; margin-top: 2px;">${escapeHtml(change.details)}</div>`;
            }
            html += '</li>';
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
                html += `<li><span class="change-new">${escapeHtml(mod.displayName || mod.name)}</span></li>`;
            });
            html += '</ul>';
        }

        if (moduleChanges.deleted.length > 0) {
            html += '<h5>删除模块:</h5><ul>';
            moduleChanges.deleted.forEach(mod => {
                html += `<li><span class="change-deleted">${escapeHtml(mod.displayName || mod.name)}</span></li>`;
            });
            html += '</ul>';
        }

        if (moduleChanges.modified.length > 0) {
            html += '<h5>修改模块:</h5>';
            moduleChanges.modified.forEach(modChange => {
                html += `<details><summary>${escapeHtml(modChange.module.displayName || modChange.module.name)}</summary><ul>`;
                modChange.changes.forEach(change => {
                    let label;
                    if (change.isVariableChange) {
                        if (change.key === 'added') {
                            label = `${translate('ccore_label_var_added')}: ${change.variableName}`;
                        } else if (change.key === 'deleted') {
                            label = `${translate('ccore_label_var_deleted')}: ${change.variableName}`;
                        } else {
                            const varPropLabel = getVariablePropertyLabel(change.key);
                            label = `变量 ${change.variableName} / ${varPropLabel}`;
                        }
                    } else {
                        label = getModulePropertyLabel(change.key);
                    }
                    const oldValueFormatted = formatChangeValue(change.oldValue);
                    const newValueFormatted = formatChangeValue(change.newValue);
                    html += `<li><strong>${escapeHtml(label)}</strong>: <span class="change-old">${oldValueFormatted}</span> → <span class="change-new">${newValueFormatted}</span>`;
                    if (change.details) {
                        html += `<div class="change-details" style="font-size: 0.9em; color: #888; margin-left: 1em; margin-top: 2px;">${escapeHtml(change.details)}</div>`;
                    }
                    html += '</li>';
                });
                html += '</ul></details>';
            });
        }
    }

    if (!hasChanges) {
        html = `<p>${translate('ccore_msg_no_changes')}</p>`;
    }

    return { html, hasChanges };
}
