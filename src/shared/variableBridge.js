// variableBridge.js
// 桥接 SillyTavern 原生变量系统：聊天级（local）与全局（global）。
//
// 设计定位：这是对 ST 官方变量 API 的"薄封装/对接层"，刻意保留 ST 原生语义，
// 因此存进去的值可被 ST 原生宏（{{getvar}} / {{getglobalvar}}）与 /setvar 等直接复用。
//
// 重要 caveat（来自 public/scripts/variables.js）：
//   - 读取值时，纯数字字符串会被强制转成 Number；空/不存在返回 ''。
//   - 对象/数组如需保真存储，请改用 floorBridge（extra.ccore），或自行 JSON 序列化。
// 若下游功能需要"类型保真的结构化内部数据"，优先用 floorBridge，而非本模块。

import {
    getLocalVariable,
    setLocalVariable,
    getGlobalVariable,
    setGlobalVariable,
} from '../../../../../../scripts/variables.js';
import { chat_metadata, saveSettingsDebounced } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { saveMetadataDebounced } from '../../../../../extensions.js';

/**
 * 读取变量。
 * @param {'chat'|'global'} scope 'chat' = 聊天级 local，'global' = 全局
 * @param {string} name 变量名
 * @param {object} [args] 透传给 ST 原生 API（如 { index, as }）
 * @returns {*} ST 原生语义的返回值（数字会被强制转换，缺省返回 ''）
 */
export function get(scope, name, args = {}) {
    return scope === 'global'
        ? getGlobalVariable(name, args)
        : getLocalVariable(name, args);
}

/**
 * 写入变量（自动触发 ST 原生持久化）。
 * @param {'chat'|'global'} scope
 * @param {string} name
 * @param {*} value
 * @param {object} [args] 透传给 ST 原生 API（如 { index, as }）
 * @returns {*} 写入的值
 */
export function set(scope, name, value, args = {}) {
    return scope === 'global'
        ? setGlobalVariable(name, value, args)
        : setLocalVariable(name, value, args);
}

/**
 * 判断变量是否存在（直接查 ST 原生存储，避免 get 的 ''/数字强制转换干扰）。
 * @param {'chat'|'global'} scope
 * @param {string} name
 * @returns {boolean}
 */
export function has(scope, name) {
    if (scope === 'global') {
        return !!(extension_settings.variables?.global && extension_settings.variables.global[name] !== undefined);
    }
    return !!(chat_metadata.variables && chat_metadata.variables[name] !== undefined);
}

/**
 * 删除变量（直接操作 ST 原生存储并触发对应持久化）。
 * @param {'chat'|'global'} scope
 * @param {string} name
 */
export function del(scope, name) {
    if (scope === 'global') {
        if (extension_settings.variables?.global) delete extension_settings.variables.global[name];
        saveSettingsDebounced();
    } else {
        if (chat_metadata.variables) delete chat_metadata.variables[name];
        saveMetadataDebounced();
    }
}
