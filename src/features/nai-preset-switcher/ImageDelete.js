// src/features/nai-preset-switcher/ImageDelete.js
// 图片管理 · 删除核心逻辑：物理删图、引用计数、stego 重编码、双向副本弹窗。
//
// 数据模型（均直接读 extension_settings["st-chatu8"]）：
//  1. 文内生图（chat）→ jiuguanStorage[md5].images[]，删图后须重编码 stego 备份
//     （chatu8List/图片缓存列表.png，智绘姬把整个 jiuguanStorage 隐写其中）。
//  2. 角色/服装预设 → preset.photoImageIds[] → configImageStorage[id]。
//     同一 id 可能被多个预设引用 → 删前必须查引用计数：
//       - 引用 >1：只从当前预设移除引用，不动存储/物理文件
//       - 引用 =1：移除引用 + 删 configImageStorage[id] + 物理删 + 删 IndexedDB
//  3. 双向副本：同一张图因智绘姬双写会同时出现在文内与预设。删除任一侧时，
//     经 ImageManager 的 dupReverse（hash → [{cat,name,path,configId?}]）对称反查，
//     另一侧存在副本则弹通用弹窗询问是否一起删。索引未就绪时禁用删除。

import { extension_settings } from '../../../../../../extensions.js';
import { saveSettings, getRequestHeaders } from '../../../../../../../script.js';
import { errorLog } from '../../utils/logger.js';
import { IframeDialog } from '../../shared/IframeDialog.js';
import { showToast } from '../../shared/Toast.js';

const CHATU8 = 'st-chatu8';
const STEGO_FOLDER = 'chatu8List';
const STEGO_FILENAME = '图片缓存列表';

let doc = null;
let _dupMap = null;       // 文内图 path -> {source,name}|null
let _reverseMap = null;   // hash -> [{cat,name,path,configId?}]（预设+文内对称）
let _onChanged = null;    // 删除完成后回调（ImageManager 负责重渲）

/** ImageManager 注入上下文：映射 + 变更回调 */
export function setDupContext(ctx) {
    if (!ctx) return;
    if (ctx.dupMap instanceof Map) _dupMap = ctx.dupMap;
    if (ctx.reverseMap instanceof Map) _reverseMap = ctx.reverseMap;
    if (typeof ctx.onChanged === 'function') _onChanged = ctx.onChanged;
}

export function setDeleteDoc(d) { doc = d; }

/** 反向索引是否就绪（删除的前提：未跑完命中时禁用删除） */
export function isDeleteReady() {
    return !!(_reverseMap && _reverseMap.size > 0);
}

/* ============ 底层：物理删除 / IndexedDB / stego ============ */

async function deleteServerImage(path) {
    if (!path) return;
    try {
        const res = await fetch('/api/images/delete', {
            method: 'POST',
            headers: getRequestHeaders(window.token),
            body: JSON.stringify({ path }),
        });
        // 404 视为已删除（与智绘姬一致）
        if (!res.ok && res.status !== 404) errorLog(`[图片删除] 物理删除失败 ${path} (${res.status})`);
    } catch (e) {
        errorLog(`[图片删除] 物理删除异常 ${path}:`, e);
    }
}

function deleteIndexedDbImage(id) {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open('chatu8_config_images', 2);
            req.onsuccess = () => {
                try {
                    const db = req.result;
                    if (!db || !db.objectStoreNames.contains('config_images')) { resolve(); return; }
                    const tx = db.transaction('config_images', 'readwrite');
                    tx.objectStore('config_images').delete(id);
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => { db.close(); resolve(); };
                } catch (e) { resolve(); }
            };
            req.onerror = () => resolve();
        } catch (e) { resolve(); }
    });
}

// 重编码并上传 stego 隐写备份（等价实现智绘姬 ImageSteganography.encode：
// data:image/png;base64, + base64(JSON.stringify(jiuguanStorage))）
async function rebuildStego() {
    try {
        const chatu8 = extension_settings[CHATU8];
        if (!chatu8) return;
        const json = JSON.stringify(chatu8.jiuguanStorage || {});
        const bytes = new TextEncoder().encode(json);
        const b64 = bytesToBase64(bytes);
        // 删旧图（可能不存在，忽略错误）
        await fetch('/api/images/delete', {
            method: 'POST',
            headers: getRequestHeaders(window.token),
            body: JSON.stringify({ path: `user/images/${STEGO_FOLDER}/${STEGO_FILENAME}.png` }),
        }).catch(() => {});
        // 上传新图
        const res = await fetch('/api/images/upload', {
            method: 'POST',
            headers: getRequestHeaders(window.token),
            body: JSON.stringify({
                image: b64,
                format: 'png',
                ch_name: STEGO_FOLDER,
                filename: STEGO_FILENAME,
            }),
        });
        if (!res.ok) errorLog('[图片删除] stego 重编码上传失败', res.status);
    } catch (e) {
        errorLog('[图片删除] stego 重编码失败:', e);
    }
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return window.btoa(binary);
}

/* ============ 文内生图（chat）删除 ============ */

async function deleteChatImage(imgEntry) {
    const chatu8 = extension_settings[CHATU8];
    if (!chatu8 || !imgEntry) return false;
    const storage = chatu8.jiuguanStorage;
    if (!storage) return false;
    for (const md5 in storage) {
        const entry = storage[md5];
        if (!entry || !Array.isArray(entry.images)) continue;
        const idx = entry.images.findIndex(im =>
            (imgEntry.uuid && im.uuid === imgEntry.uuid) ||
            (imgEntry.path && im.path && im.path === imgEntry.path));
        if (idx === -1) continue;
        const [removed] = entry.images.splice(idx, 1);
        if (removed) {
            if (removed.path) await deleteServerImage(removed.path);
            if (removed.thumbnail_path) await deleteServerImage(removed.thumbnail_path);
        }
        if (entry.images.length === 0) delete storage[md5];
        else if (entry.index >= entry.images.length) entry.index = entry.images.length - 1;
        await rebuildStego();
        return true;
    }
    return false;
}

/* ============ 角色/服装预设删除 ============ */

function countConfigRefs(configId) {
    const chatu8 = extension_settings[CHATU8];
    if (!chatu8) return 0;
    let count = 0;
    for (const map of [chatu8.characterPresets, chatu8.outfitPresets]) {
        for (const name in (map || {})) {
            const preset = map[name];
            if (preset && Array.isArray(preset.photoImageIds) && preset.photoImageIds.includes(configId)) count++;
        }
    }
    return count;
}

// 从角色/服装预设移除某张图。返回 {removedId, removedStorage}
async function deletePresetImage(presetType, presetName, configId) {
    const chatu8 = extension_settings[CHATU8];
    if (!chatu8) return { removedId: false, removedStorage: false };
    const map = presetType === 'character' ? chatu8.characterPresets : chatu8.outfitPresets;
    const preset = map && map[presetName];
    if (!preset || !Array.isArray(preset.photoImageIds)) return { removedId: false, removedStorage: false };

    const newIds = preset.photoImageIds.filter(id => id !== configId);
    const removedId = newIds.length !== preset.photoImageIds.length;
    preset.photoImageIds = newIds;
    if (typeof preset.selectedPhotoIndex === 'number') {
        preset.selectedPhotoIndex = Math.min(Math.max(preset.selectedPhotoIndex - 1, 0), Math.max(newIds.length - 1, 0));
    }

    let removedStorage = false;
    if (removedId && countConfigRefs(configId) === 0) {
        const storage = chatu8.configImageStorage || {};
        const entry = storage[configId];
        if (entry && entry.path) await deleteServerImage(entry.path);
        delete storage[configId];
        await deleteIndexedDbImage(configId);
        removedStorage = true;
    }
    return { removedId, removedStorage };
}

/* ============ 副本查询与确认 ============ */

// 给定当前图信息，查询「另一侧」副本列表。
// item: {cat, path, hash?}  cat∈chat/character/outfit
function findDuplicates(item) {
    if (!_reverseMap || !item || !item.hash) return [];
    const all = _reverseMap.get(item.hash) || [];
    // 排除当前图自己（按 cat+path 精确匹配）
    return all.filter(x => !(x.cat === item.cat && x.path === item.path));
}

// 弹窗确认；返回 'cancel' | 'self'(只删当前) | 'both'(一起删)
async function confirmDeletion(dupList) {
    if (!doc) return 'cancel';
    if (!dupList || dupList.length === 0) {
        return new Promise(resolve => {
            const dlg = new IframeDialog(doc);
            dlg.open({
                title: '删除图片',
                content: '<p>确定删除这张图片吗？此操作不可恢复。</p>',
                buttons: [
                    { text: '取消', className: 'btn-secondary', onClick: () => { dlg.close(); resolve('cancel'); } },
                    { text: '删除', className: 'btn-primary', onClick: () => { dlg.close(); resolve('self'); } },
                ],
            });
        });
    }
    // 有副本：说明副本在哪一侧
    const sideText = dupList[0].cat === 'chat' ? '文生图' : '预设';
    const names = [...new Set(dupList.filter(d => d.name).map(d => d.name))].join('、');
    return new Promise(resolve => {
        const dlg = new IframeDialog(doc);
        dlg.open({
            title: '存在相同图片',
            content: `<p>此图在「${sideText}」中还有 <b>${dupList.length}</b> 张相同副本${names ? `（${escapeHtml(names)}）` : ''}。</p><p>是否一起删除？</p>`,
            buttons: [
                { text: '只删当前', className: 'btn-secondary', onClick: () => { dlg.close(); resolve('self'); } },
                { text: '一起删除', className: 'btn-danger', onClick: () => { dlg.close(); resolve('both'); } },
            ],
        });
    });
}

/* ============ 对外删除入口 ============ */

/**
 * 删除单个图片项。
 * @param {Object} item 定位信息：
 *  - cat: 'chat'|'character'|'outfit'
 *  - path: 服务端文件路径（用于反查/物理删）
 *  - hash: 内容 hash（用于反查副本；无则跳过副本确认）
 *  - chat 专用：entry（jiuguanStorage 图片对象，含 uuid/path）
 *  - character/outfit 专用：configId, presetName, presetType
 */
export async function deleteImageItem(item) {
    if (!item || !item.cat) return;
    // 反向索引未就绪 → 不做副本确认，仅轻量确认后删除当前（避免误删双写另一份时无提示）
    const dupList = isDeleteReady() && item.hash ? findDuplicates(item) : [];
    const action = await confirmDeletion(dupList);
    if (action === 'cancel') return;

    try {
        let deletedHere = false;
        if (item.cat === 'chat') {
            deletedHere = await deleteChatImage(item.entry || { path: item.path });
        } else {
            const res = await deletePresetImage(item.presetType || item.cat, item.presetName, item.configId);
            deletedHere = res.removedId;
        }
        if (!deletedHere) {
            showToast(doc, '未找到对应图片', 'error');
            return;
        }
        // 一起删副本
        if (action === 'both') {
            for (const d of dupList) {
                if (d.cat === 'chat') await deleteChatImage({ path: d.path });
                else await deletePresetImage(d.cat, d.name, d.configId);
            }
        }
        saveSettings();
        if (_onChanged) _onChanged();
        showToast(doc, action === 'both' ? '已删除（含副本）' : '已删除', 'success');
    } catch (e) {
        errorLog('[图片删除] 删除失败:', e);
        showToast(doc, '删除失败：' + (e?.message || e), 'error');
    }
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
