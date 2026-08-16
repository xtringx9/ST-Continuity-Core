// src/features/nai-preset-switcher/ImageManager.js
// 图片管理：把智绘姬三类图片（文内生图 / 角色预设 / 服装预设）按来源分组展示，
// 支持点击放大预览。不做删除（后续再做）。
//
// 数据来源（均直接读 extension_settings["st-chatu8"]，本插件已 import 同一对象）：
//  1. 文内生图  → jiuguanStorage[md5(提示词)].images[]（path/uuid）
//  2. 角色预设  → characterPresets[name].photoImageIds[] → configImageStorage[id].path
//  3. 服装预设  → outfitPresets[name].photoImageIds[]    → configImageStorage[id].path
//
// 图片渲染：服务端 path 用 fetch(getRequestHeaders) 取 blob → objectURL（与智绘姬 getItemImg 一致，
// 避免 <img> 直接带 path 因缺 token 鉴权而 403）。

import { extension_settings } from '../../../../../../extensions.js';
import { getRequestHeaders, saveSettings } from '../../../../../../../script.js';
import { errorLog } from '../../utils/logger.js';
import { initSortControl } from './SortControl.js';
import { setDupContext, setDeleteDoc, deleteImageItem, deleteImageItems, isDeleteReady } from './ImageDelete.js';
import configManager from '../../singleton/configManager.js';
import { showToast } from '../../shared/Toast.js';
import { scanCurrentChat, getChatScanForCurrentChat, getAllChatScans, setChatScanDoc } from './ChatScan.js';

const CHATU8 = 'st-chatu8';

let doc = null;
let currentCat = 'chat';       // chat | character | outfit
// chat 可叠加维度：prompt(按提示词) | preset(按预设 yushe) | character(按角色→楼层→提示词)
// 全部可叠加（用户拍板与角色/服装一致）；localStorage 持久化。空=全部按排序铺开（不分组）。
let chatGroupDims = new Set();
const CHAT_DIMS_KEY = 'st_continuity_nai_chat_dims';
function loadChatGroupDims() {
    try {
        const saved = JSON.parse(localStorage.getItem(CHAT_DIMS_KEY) || '[]');
        chatGroupDims = new Set(Array.isArray(saved) ? saved.filter(d => d === 'prompt' || d === 'preset' || d === 'character') : []);
    } catch (e) { chatGroupDims = new Set(); }
}
function persistChatGroupDims() {
    try { localStorage.setItem(CHAT_DIMS_KEY, JSON.stringify([...chatGroupDims])); } catch (e) { /* 忽略 */ }
}
loadChatGroupDims();
// 聊天扫描结果缓存（全部已扫描聊天，聊天外可见）：
//   storageKey(=md5) → [{ chatId, chatName, characterName, floors:[] }]
// 同一提示词可能出现在多个聊天/角色（同一 md5 跨聊天），聚合为数组，图片按数组逐份归属。
// 角色名为记录层字段（getAllChatScans 扁平化自 characters 结构，天然顶层）。
let chatScanByKey = new Map();
let chatScanChatId = '';
let chatScanChatsCount = 0;
function reloadChatScan() {
    const currentScan = getChatScanForCurrentChat();
    chatScanChatId = currentScan.chatId || '';
    const allScans = getAllChatScans();
    chatScanChatsCount = allScans.length;
    chatScanByKey = new Map();
    allScans.forEach(scan => {
        const chatId = scan.chatId || '';
        const chatName = scan.name || chatId;
        const characterName = scan.characterName || '未知角色';
        (scan.map || []).forEach(m => {
            if (!m.storageKey) return;
            const floors = Array.isArray(m.floors) ? m.floors.map(Number).filter(n => !isNaN(n)) : [];
            if (!chatScanByKey.has(m.storageKey)) chatScanByKey.set(m.storageKey, []);
            chatScanByKey.get(m.storageKey).push({
                chatId,
                chatName,
                characterName,
                floors,
            });
        });
    });
}
let searchTerm = '';
let sortMode = 'dateDesc';      // dateDesc(新→旧) | dateAsc(旧→新) | nameAsc(名称)
const SORT_KEY = 'st_continuity_nai_img_sort';
try {
    const saved = localStorage.getItem(SORT_KEY);
    if (saved === 'dateDesc' || saved === 'dateAsc' || saved === 'nameAsc') sortMode = saved;
} catch (e) { /* ignore */ }
const blobUrlCache = new Map(); // path -> objectURL，避免重复 fetch

/* ============ 角色/服装副本识别（方案 C：延迟加载 + 异步标记） ============ */
// 智绘姬角色/服装生图会双写：同一张图在 jiuguanStorage（文内）与
// configImageStorage（预设）各存一份物理文件。文内视图里这些「副本」加徽标识别。
// 判定思路：先给角色/服装引用图建索引（path/size/hash，数量少）；文内图先比 size，
// 不命中的直接跳过（不 fetch），size 疑似命中的才异步 fetch 做内容 hash 确认。
let presetRefs = null;           // [{path,size,source,name,hash}] 引用图索引
let presetRefsSignature = '';    // 引用图 path 集合签名（变化则重建）
let dupCache = new Map();        // 文内图 path -> {source,name}|null（null=已判定非副本）
let dupReverse = new Map();      // hash -> [{cat,name,path,configId?}] 内容反查（预设+文内对称）
let imgHashCache = new Map();    // path -> hash（删除反查/二级分组用，构建时填充）
let chatMetaByHash = new Map();  // hash -> {md5, change, yushe}（角色/服装图反查提示词/预设分组）
let dupCheckRunning = false;     // 防并发
let refsBuildPromise = null;     // 引用图索引构建共享 promise（多次触发只建一次）
const DUP_BATCH = 20;            // 每批确认的疑似副本数

/* ============ 分组维度（通用嵌套分组引擎） ============ */
// 角色/服装分类的二级分组开关：prompt(按提示词) | preset(按预设)，可叠加、默认不选。
// 存 localStorage 持久化（与 sortMode 同约定）。chat 分类已统一为可叠加维度。
let presetGroupDims = new Set(); // 角色/服装激活的维度
const DIMS_KEY = 'st_continuity_nai_img_dims';
function loadPresetGroupDims() {
    try {
        const saved = JSON.parse(localStorage.getItem(DIMS_KEY) || '[]');
        presetGroupDims = new Set(Array.isArray(saved) ? saved.filter(d => d === 'prompt' || d === 'preset') : []);
    } catch (e) { presetGroupDims = new Set(); }
}
function persistPresetGroupDims() {
    try { localStorage.setItem(DIMS_KEY, JSON.stringify([...presetGroupDims])); } catch (e) { /* 忽略 */ }
}
loadPresetGroupDims();

/* ============ 数据读取 ============ */

function getChatu8() {
    try {
        return extension_settings[CHATU8] || null;
    } catch (e) {
        return null;
    }
}

// 取单张图片的可用 src（优先服务端 path，否则回退 IndexedDB uuid）
async function resolveImageSrc(imgEntry) {
    if (!imgEntry) return null;
    // 服务端 path
    if (imgEntry.path) {
        if (blobUrlCache.has(imgEntry.path)) return blobUrlCache.get(imgEntry.path);
        try {
            const res = await fetch(imgEntry.path, { headers: getRequestHeaders() });
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                blobUrlCache.set(imgEntry.path, url);
                return url;
            }
        } catch (e) {
            errorLog('[图片管理] 读取服务端图片失败:', e);
        }
    }
    // IndexedDB uuid（文内生图本地存储时）
    if (imgEntry.uuid) {
        try {
            const db = await openChatu8ConfigDB();
            const data = await idbGet(db, imgEntry.uuid);
            if (data && data.data) {
                const mime = imgEntry.isVideo ? 'video/mp4' : 'image/png';
                return `data:${mime};base64,` + arrayBufferToBase64(data.data);
            }
        } catch (e) {
            errorLog('[图片管理] 读取 IndexedDB 图片失败:', e);
        }
    }
    return null;
}

// 从 configImageStorage[id] 取预设类图片 src
async function resolveConfigImageSrc(imageId) {
    const chatu8 = getChatu8();
    if (!chatu8 || !imageId) return null;
    const entry = chatu8.configImageStorage && chatu8.configImageStorage[imageId];
    if (entry && entry.path) {
        if (blobUrlCache.has(entry.path)) return blobUrlCache.get(entry.path);
        try {
            const res = await fetch(entry.path, { headers: getRequestHeaders() });
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                blobUrlCache.set(entry.path, url);
                return url;
            }
        } catch (e) {
            errorLog('[图片管理] 读取预设图片失败:', e);
        }
    }
    // IndexedDB 回退（configImageStorage 无 path 时本地存储）
    try {
        const db = await openChatu8ConfigDB();
        const data = await idbGet(db, imageId);
        if (data && data.data) {
            const mime = (data.mimeType && data.mimeType.startsWith('video')) ? 'video/mp4' : 'image/png';
            const b64 = typeof data.data === 'string' && data.data.startsWith('data:')
                ? data.data
                : `data:${mime};base64,` + arrayBufferToBase64(data.data);
            return b64;
        }
    } catch (e) {
        errorLog('[图片管理] 读取预设 IndexedDB 图片失败:', e);
    }
    return null;
}

/* ============ IndexedDB 读取（config_images，与智绘姬同源） ============ */

let _dbPromise = null;
function openChatu8ConfigDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('chatu8_config_images', 2);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _dbPromise;
}

function idbGet(db, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('config_images', 'readonly');
        const store = tx.objectStore('config_images');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
}

/* ============ 分组数据构建 ============ */

// 返回 [{ key, label, images:[{src, title, meta, dup}] }]
// pendingSet：收集 size 疑似命中角色/服装引用图的 path（供后台 fetch 确认）
function buildChatGroups(pendingSet) {
    const chatu8 = getChatu8();
    const storage = (chatu8 && chatu8.jiuguanStorage) || {};
    const needScan = chatGroupDims.has('character'); // 「按角色」激活才展开扫描归属
    // 收集所有图（带维度信息）
    const allImages = [];
    for (const md5 in storage) {
        const entry = storage[md5];
        if (!entry || !Array.isArray(entry.images) || entry.images.length === 0) continue;
        const change = entry.change || '';
        const label = change || '(未命名提示词)';
        const yushe0 = (entry.images[0] && entry.images[0].genParams && entry.images[0].genParams.yushe) || '';
        // 扫描归属（全部已扫描聊天聚合）：storageKey → [{chatId, chatName, characterName, floors}]
        const scanRecords = needScan ? (chatScanByKey.get(md5) || null) : null;
        entry.images.forEach((img, idx) => {
            const yushe = (img.genParams && img.genParams.yushe) || yushe0;
            const base = {
                entry: img,
                title: `${label} #${idx + 1}`,
                meta: img.genParams || null,
                date: img.date || 0, // 供组内按日期排序
                path: img.path || '', // 文件路径（lightbox 显示）
                dup: judgeChatImage(img, pendingSet), // 角色/服装副本标记（可为 null）
                chatMeta: { md5, change, yushe, uuid: img.uuid || '' }, // 供 chatMetaByHash 填充 / 二级分组 / 对侧 key
            };
            // 「按角色」且该提示词有扫描归属：每张图按扫描记录展开（同一提示词跨聊天/角色时在各组都出现）
            if (needScan && scanRecords && scanRecords.length > 0) {
                scanRecords.forEach(rec => {
                    allImages.push({ ...base, scanInfo: rec });
                });
            } else {
                // 无扫描归属（未扫描）或未按角色：scanInfo=null → 「未扫描」组
                allImages.push({ ...base, scanInfo: needScan ? null : undefined });
            }
        });
    }
    if (allImages.length === 0) return [];
    // 激活维度（全可叠加）。空=全部按排序铺开（单组，不按任何维度分组）。
    // 顺序固定：角色 → 聊天 → 楼层 → 预设 → 提示词（用户拍板：按角色时列出聊天）
    const dims = [];
    if (chatGroupDims.has('character')) dims.push({ key: 'character' }, { key: 'chat' }, { key: 'floor' });
    if (chatGroupDims.has('preset')) dims.push({ key: 'preset' });
    if (chatGroupDims.has('prompt')) dims.push({ key: 'prompt' });
    // 无激活维度 → 铺开：单组「全部图片」叶子（含全部图，标题显示总数+最新日期）
    if (dims.length === 0) {
        let maxDate = 0;
        allImages.forEach(im => { if (im.date && im.date > maxDate) maxDate = im.date; });
        return [{ key: 'all', label: '全部图片', date: maxDate, children: [], images: allImages }];
    }
    // 用通用嵌套引擎按维度逐层分组
    return buildNestedGroupTree(allImages, dims);
}

// 同步判断一张文内图是否疑似角色/服装副本：
//  - 已判定过 → 返回缓存结果
//  - size 不命中引用图集合 → 记为 null（非副本），无需 fetch
//  - size 疑似命中 → 把 path 记入 pendingSet，返回 null（等待后台 fetch 确认）
function judgeChatImage(img, pendingSet) {
    // 兼容：直接传原图 entry（无 chatMeta）或包装对象（含 chatMeta/entry）
    const entry = img.entry || img;
    const path = entry.path || '';
    if (!path || !presetRefs || presetRefs.length === 0) return null;
    if (dupCache.has(path)) return dupCache.get(path);
    const size = typeof entry.size === 'number' ? entry.size : null;
    if (size === null || !presetRefs.some(r => r.size === size)) {
        dupCache.set(path, null);
        return null;
    }
    if (pendingSet) pendingSet.set(path, img.chatMeta || null); // Map<path, meta>
    return null;
}

// 内容指纹：优先 crypto.subtle SHA-256（安全上下文），否则 FNV-1a 64bit 兜底
async function hashBuffer(buf) {
    try {
        if (crypto.subtle && crypto.subtle.digest) {
            const d = await crypto.subtle.digest('SHA-256', buf);
            return Array.from(new Uint8Array(d)).slice(0, 16)
                .map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (e) { /* 回退 FNV */ }
    const view = new Uint8Array(buf);
    let h1 = 0x811c9dc5, h2 = 0x811c9dc5;
    for (let i = 0; i < view.length; i++) {
        h1 = Math.imul(h1 ^ view[i], 0x01000193) >>> 0;
        if ((i & 3) === 3) h2 = Math.imul(h2 ^ view[i], 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

async function fetchBuffer(path) {
    const res = await fetch(path, { headers: getRequestHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
}

// 构建角色/服装引用图索引（path/size/hash）。仅当引用图集合变化时重建；
// 重建会清空 dupCache（旧判定可能失效），需要重新判定。
async function buildPresetRefs() {
    const chatu8 = getChatu8();
    if (!chatu8) return;
    const storage = chatu8.configImageStorage || {};
    const refs = [];
    for (const [type, map] of [['character', chatu8.characterPresets], ['outfit', chatu8.outfitPresets]]) {
        for (const name in (map || {})) {
            const preset = map[name];
            const ids = (preset && Array.isArray(preset.photoImageIds)) ? preset.photoImageIds : [];
            for (const configId of ids) {
                const entry = storage[configId];
                if (entry && entry.path) refs.push({ path: entry.path, source: type, name, configId });
            }
        }
    }
    const sig = refs.map(r => r.path).join('|');
    if (sig === presetRefsSignature) return;
    presetRefsSignature = sig;
    _fullScanned = false; // 引用图变化 → 全量扫描需重跑
    const indexed = [];
    const reverse = new Map();
    for (let i = 0; i < refs.length; i += DUP_BATCH) {
        const batch = refs.slice(i, i + DUP_BATCH);
        await Promise.all(batch.map(async (r) => {
            try {
                const buf = await fetchBuffer(r.path);
                const hash = await hashBuffer(buf);
                indexed.push({ ...r, size: buf.byteLength, hash });
                imgHashCache.set(r.path, hash);
                // 反向索引：hash → 预设引用（含 configId，供删除定位）
                if (!reverse.has(hash)) reverse.set(hash, []);
                reverse.get(hash).push({ cat: r.source, name: r.name, path: r.path, configId: r.configId });
            } catch (e) { /* 单张读取失败跳过 */ }
        }));
    }
    presetRefs = indexed;
    dupReverse = reverse;
    dupCache = new Map(); // 引用图变化 → 旧判定清空重判
}

function ensurePresetRefs() {
    if (!refsBuildPromise) {
        refsBuildPromise = buildPresetRefs().finally(() => { refsBuildPromise = null; });
    }
    return refsBuildPromise;
}

// 后台分批确认 size 疑似命中的图，完成后整体重渲一次（徽标出现）
// pendingMap: Map<path, meta>（meta 含 md5/change/yushe，供 chatMetaByHash 填充）
async function runDupCheck(pendingMap) {
    if (dupCheckRunning || !pendingMap || pendingMap.size === 0) return;
    dupCheckRunning = true;
    const paths = [...pendingMap.keys()];
    try {
        for (let i = 0; i < paths.length; i += DUP_BATCH) {
            const batch = paths.slice(i, i + DUP_BATCH);
            await Promise.all(batch.map(async (path) => {
                // 已判定过的图：跳过 fetch，但补齐缺失的 chatMetaByHash（hash 已有则直接补 meta）
                if (dupCache.has(path)) {
                    const cachedHash = imgHashCache.get(path);
                    const meta = pendingMap.get(path);
                    if (cachedHash && meta && meta.md5 && !chatMetaByHash.has(cachedHash)) {
                        chatMetaByHash.set(cachedHash, meta);
                    }
                    return;
                }
                try {
                    const buf = await fetchBuffer(path);
                    const hash = await hashBuffer(buf);
                    imgHashCache.set(path, hash);
                    const hit = presetRefs.find(r => r.size === buf.byteLength && r.hash === hash);
                    dupCache.set(path, hit ? { source: hit.source, name: hit.name } : null);
                    // 记录文内图 meta（供角色/服装图反查提示词/预设分组）
                    const meta = pendingMap.get(path);
                    if (meta && meta.md5) chatMetaByHash.set(hash, meta);
                    // 命中文内副本时也并入反向索引（与预设引用同一 hash 桶），删除任一侧可对称查全
                    if (hit && dupReverse.has(hash)) {
                        const list = dupReverse.get(hash);
                        if (!list.some(x => x.cat === 'chat' && x.path === path)) {
                            list.push({ cat: 'chat', path });
                        }
                    }
                } catch (e) {
                    dupCache.set(path, null); // 读取失败按非副本处理，避免反复重试
                }
            }));
        }
    } finally {
        dupCheckRunning = false;
    }
    render(); // 判定完成，重渲（页码保留）让徽标出现
}

// 角色/服装预设：遍历预设对象 → photoImageIds
// 支持通用嵌套分组：外层按预设名，内层按激活维度（prompt/preset，可叠加）。
// 内层分组数据来自 chatMetaByHash（hash 反查文内 md5/change/yushe）。
function buildPresetGroups(presetType) {
    const chatu8 = getChatu8();
    if (!chatu8) return [];
    const map = presetType === 'character' ? chatu8.characterPresets : chatu8.outfitPresets;
    const storage = chatu8.configImageStorage || {};
    if (!map) return [];
    const groups = [];
    // 激活的嵌套维度（localStorage 持久化，可叠加）；字符串转 {key} 供通用引擎消费
    const dims = [...presetGroupDims].map(d => ({ key: d }));
    for (const name in map) {
        const preset = map[name];
        const ids = (preset && Array.isArray(preset.photoImageIds)) ? preset.photoImageIds : [];
        if (ids.length === 0) continue;
        let date = 0;
        const images = ids.map((id, idx) => {
            const sd = (storage[id] && storage[id].date) || 0;
            if (sd && sd > date) date = sd;
            const path = (storage[id] && storage[id].path) || '';
            // 反查文内 meta（hash → chatMetaByHash）
            const hash = (path && imgHashCache.get(path)) || null;
            const meta = (hash && chatMetaByHash.get(hash)) || null;
            return {
                imageId: id,
                title: `${name} #${idx + 1}`,
                date: sd, // 供组内按日期排序
                path, // 文件路径（lightbox 显示）
                presetName: name, // 供删除定位
                hash, // 反查键
                meta, // {md5, change, yushe} 或 null
                // 反向副本角标：hash 在 chatMetaByHash 有记录 → 文内生图里也有对应副本
                dup: (hash && chatMetaByHash.has(hash))
                    ? { source: 'chat', name: '文生图' }
                    : null,
            };
        });
        // 无嵌套维度：保持原有单层分组（按预设名）
        if (dims.length === 0) {
            groups.push({ key: 'preset:' + name, label: name, images, date });
            continue;
        }
        // 有嵌套维度：按维度逐层构建子树（通用嵌套分组），顶层是「预设名」组，其 children 为维度分组
        const children = buildNestedGroupTree(images, dims);
        groups.push({ key: 'preset:' + name, label: name, date, children, images: [] });
    }
    return groups;
}

// 通用嵌套分组：把图片列表按维度序列逐层分组（递归）。
// 每个维度：{ key }，树的中间节点有 children，叶子节点有 images（叶子即最后一维分组，label 非空）。
// node = { key, label, date, children?: [node], images?: [img] }
function buildNestedGroupTree(items, dims) {
    // 按剩余维度序列分组；返回该层节点
    const groupLayer = (list, layerIndex) => {
        const dim = dims[layerIndex];
        const byKey = new Map();
        for (const img of list) {
            const label = getDimLabel(dim, img);
            const key = `${dim.key}:${label}`;
            if (!byKey.has(key)) byKey.set(key, { key, label, children: [], images: [] });
            byKey.get(key).images.push(img);
        }
        const isLast = layerIndex >= dims.length - 1;
        const nodes = [];
        for (const [key, node] of byKey) {
            let date = 0;
            node.images.forEach(im => { if (im.date && im.date > date) date = im.date; });
            if (isLast) {
                // 最后一维：叶子，持有图片（label 非空，标题显示「名字 (数量 · 日期)」）
                nodes.push({ key, label: node.label, date, children: [], images: node.images });
            } else {
                // 非最后一维：中间节点，递归细分
                const children = groupLayer(node.images, layerIndex + 1);
                nodes.push({ key, label: node.label, date, children, images: [] });
            }
        }
        return nodes;
    };
    return groupLayer(items, 0);
}

// 嵌套维度 → 图片的分组 label（提示词/预设/角色/楼层）
function getDimLabel(dim, img) {
    const meta = img.meta;
    if (dim.key === 'prompt') {
        // 优先用 chatMeta.change（提示词原文）；无则回退标题
        return (img.chatMeta && img.chatMeta.change) || (meta && meta.resolvedPrompt) || img.title.split(' #')[0] || '(未命名提示词)';
    }
    if (dim.key === 'preset') {
        return (meta && meta.yushe) || (img.chatMeta && img.chatMeta.yushe) || '未关联预设';
    }
    if (dim.key === 'character') {
        // 聊天扫描的角色归属
        return (img.scanInfo && img.scanInfo.characterName) || '未扫描';
    }
    if (dim.key === 'chat') {
        // 聊天扫描的聊天名（多聊天聚合，聊天外可见）
        return (img.scanInfo && img.scanInfo.chatName) || '未知聊天';
    }
    if (dim.key === 'floor') {
        // 聊天扫描的楼层（取第一个；单图多楼层时显示最早楼层）
        const floors = (img.scanInfo && img.scanInfo.floors) || [];
        return floors.length ? `#${floors[0]}` : '未知楼层';
    }
    return '未知';
}

/* ============ 渲染（分组分页：顶部页码导航） ============ */

const GROUPS_PER_PAGE = 12;       // 每页渲染的分组数（每页分组数 × 单组初始图数 可控）
const IMAGES_PER_GROUP = 12;      // 单组初始渲染的图片数（超出默认折叠，点「展开剩余」显示）
const PROMPT_LABEL_MAX = 40;      // 提示词分组名截断长度（超出显示「…」+ 点击展开）

function getGroups(pendingSet) {
    let groups;
    if (currentCat === 'chat') groups = buildChatGroups(pendingSet);
    else if (currentCat === 'character') groups = buildPresetGroups('character');
    else if (currentCat === 'outfit') groups = buildPresetGroups('outfit');
    else groups = [];
    // 排序：日期降序/升序/名称（顶层组）
    sortGroupNodes(groups);
    return groups;
}

// 通用：对一组分组节点排序（按 sortMode），并递归排序 children 与组内图片
function sortGroupNodes(nodes) {
    if (!Array.isArray(nodes)) return;
    const cmpDate = sortMode === 'dateAsc'
        ? (a, b) => (a.date || 0) - (b.date || 0)
        : (a, b) => (b.date || 0) - (a.date || 0);
    const cmpName = (a, b) => a.label.localeCompare(b.label, 'zh');
    nodes.sort(sortMode === 'nameAsc' ? cmpName : cmpDate);
    for (const g of nodes) {
        if (g.children && g.children.length) {
            sortGroupNodes(g.children);
        } else {
            if (sortMode === 'dateAsc') g.images.sort((x, y) => (x.date || 0) - (y.date || 0));
            else if (sortMode === 'dateDesc') g.images.sort((x, y) => (y.date || 0) - (x.date || 0));
        }
    }
}

// 全局缓存当前过滤后的分组列表与当前页码（分页用）
let _allGroups = [];
let _currentPage = 1;
let _totalPages = 1;

/* ============ 图片收藏（红心，独立于预设标签） ============ */
// 内存缓存：key -> {key, cat, path, tags, createdAt, updatedAt}（读 configManager）
let favMap = new Map();

// 从 configManager 重载收藏缓存
function reloadFavs() {
    const favs = configManager.getNaiImageFavorites();
    favMap = new Map((favs.items || []).map(f => [f.key, f]));
    return favMap;
}

// 图片唯一 key（与 imgKey 一致：chat=uuid/path，character/outfit=configId）
// 收藏 tab 的项自带 key（含 cat），直接复用；图片管理的项走 imgKey 构造
function favKeyFor(img) {
    if (img && typeof img.key === 'string' && img.key.includes(':')) return img.key;
    return imgKey(img);
}

function isFavorited(img) {
    if (favMap.size === 0) reloadFavs();
    return favMap.has(favKeyFor(img));
}

// 切换收藏（只收藏/取消，不弹标签窗；标签在收藏 tab 内管理）
// B2 双向联动：若该图是双写副本（dupReverse 反查到对侧），对侧 key 一并收藏/取消。
function toggleFavoriteImage(img) {
    const key = favKeyFor(img);
    const existed = favMap.has(key);
    // 收集对侧 key（同内容 hash 桶里其它 cat 的项）——双向图红心同步
    const otherKeys = findDupFavKeys(img);
    if (existed) {
        favMap.delete(key);
        otherKeys.forEach(k => favMap.delete(k.key));
    } else {
        const now = Date.now();
        const myPath = img.path || (img.entry && img.entry.path) || '';
        const myHash = myPath && imgHashCache.get(myPath) || '';
        favMap.set(key, { key, cat: currentCat, path: myPath, hash: myHash, tags: [], createdAt: now, updatedAt: now });
        // 对侧项：若无对应记录则补建（path/hash 从 dupReverse 项取，双向红心同步）
        otherKeys.forEach(dup => {
            if (!favMap.has(dup.key)) {
                favMap.set(dup.key, {
                    key: dup.key,
                    cat: dup.cat,
                    path: dup.path || '',
                    hash: myHash, // 同内容，hash 一致
                    tags: [],
                    createdAt: now,
                    updatedAt: now,
                });
            }
        });
    }
    persistFavs();
    showToast(doc, existed ? '已取消收藏' : '已收藏 ♥', existed ? 'info' : 'success');
    // 重渲图片管理：同步所有相同内容图的红心状态（含双向副本在不同分组/缩略图）
    if (window.__refreshImageManagerFavs) window.__refreshImageManagerFavs();
    return !existed;
}

// 反查当前图的对侧收藏 key（dupReverse 同 hash 桶里其它 cat 的项）
function findDupFavKeys(img) {
    const path = img.path || (img.entry && img.entry.path) || '';
    const hash = path && imgHashCache.get(path);
    if (!hash || !dupReverse.has(hash)) return [];
    const chatMeta = chatMetaByHash.get(hash) || null;
    const chatUuid = (chatMeta && chatMeta.uuid) || '';
    const out = [];
    for (const d of dupReverse.get(hash)) {
        if (d.cat === 'chat') {
            // 文内图 key = chat:<uuid>（优先）或 chat:<path>
            const k = chatUuid ? 'chat:' + chatUuid : (d.path ? 'chat:' + d.path : '');
            if (k && k !== imgKey(img)) out.push({ cat: 'chat', key: k, path: d.path });
        } else {
            // 角色/服装 key = <cat>:<configId>
            if (d.configId) out.push({ cat: d.cat, key: d.cat + ':' + d.configId, path: d.path });
        }
    }
    return out;
}

// 批量收藏已选（管理模式「收藏已选」）
function favoriteSelectedImages() {
    const items = [];
    for (const g of _allGroups) {
        for (const img of g.images) {
            if (selectedSet.has(imgKey(img)) && !favMap.has(favKeyFor(img))) {
                const now = Date.now();
                const p = img.path || (img.entry && img.entry.path) || '';
                favMap.set(favKeyFor(img), {
                    key: favKeyFor(img),
                    cat: currentCat,
                    path: p,
                    hash: (p && imgHashCache.get(p)) || '',
                    tags: [],
                    createdAt: now,
                    updatedAt: now,
                });
                items.push(img);
            }
        }
    }
    persistFavs();
    showToast(doc, items.length ? `已收藏 ${items.length} 张` : '已全部收藏过', items.length ? 'success' : 'info');
    render();
}

function persistFavs() {
    configManager.setNaiImageFavorites({
        tags: configManager.getNaiImageFavorites().tags || [],
        items: Array.from(favMap.values()),
    });
    try { saveSettings(); } catch (e) { /* 忽略 */ }
}

// 收藏的红心按钮（缩略图 / lightbox 通用）
function buildFavBtn(img, isLb) {
    const btn = doc.createElement('button');
    btn.className = 'np-img-fav' + (isLb ? ' np-img-fav-lb' : '');
    const on = isFavorited(img);
    btn.textContent = on ? '♥' : '♡';
    btn.classList.toggle('on', on);
    btn.title = on ? '取消收藏' : '收藏';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const now = toggleFavoriteImage(img);
        btn.textContent = now ? '♥' : '♡';
        btn.classList.toggle('on', now);
        btn.title = now ? '取消收藏' : '收藏';
        // 通知收藏 tab 刷新（若激活）
        if (window.__refreshImageFavTab) window.__refreshImageFavTab();
    });
    return btn;
}

/* ============ 管理模式（勾选 + 批量删除） ============ */
let manageMode = false;            // 管理模式开关
const selectedSet = new Set();     // 已选图片唯一 key（见 imgKey）

// 图片项的唯一 key（跨分组稳定，重渲不丢失选择）
function imgKey(img) {
    if (currentCat === 'chat') return 'chat:' + (img.entry?.uuid || img.path);
    return currentCat + ':' + img.imageId;
}

// 选择状态 → 勾选框
function isSelected(img) { return selectedSet.has(imgKey(img)); }
function toggleSelect(img) {
    const k = imgKey(img);
    if (selectedSet.has(k)) selectedSet.delete(k);
    else selectedSet.add(k);
    updateBatchBar();
}

function updateBatchBar() {
    if (!doc) return;
    const bar = doc.getElementById('np-img-batchbar');
    const count = doc.getElementById('np-img-sel-count');
    const del = doc.getElementById('np-img-sel-delete');
    const fav = doc.getElementById('np-img-sel-fav');
    if (bar) bar.style.display = manageMode ? 'flex' : 'none';
    if (count) count.textContent = `已选 ${selectedSet.size} 张`;
    // 反向索引未就绪时删除按钮恒置灰（跑完才能点）
    const ready = isDeleteReady();
    if (del) {
        del.disabled = !ready || selectedSet.size === 0;
        del.title = ready ? '删除已选图片' : '副本识别中，完成前不可删除';
    }
    // 收藏已选：未选中置灰
    if (fav) fav.disabled = selectedSet.size === 0;
    // 管理模式：隐藏红心（避免与管理操作混在一起），显示勾选框
    doc.querySelectorAll('.np-img-fav').forEach(f => { f.style.display = manageMode ? 'none' : 'block'; });
    doc.querySelectorAll('.np-img-check').forEach(cb => {
        cb.style.display = manageMode ? 'block' : 'none';
    });
}

// 管理模式开关
function setManageMode(on) {
    manageMode = on;
    const btn = doc.getElementById('np-img-manage');
    if (btn) {
        btn.textContent = on ? '取消管理' : '管理模式';
        btn.classList.toggle('active', on);
    }
    if (!on) selectedSet.clear();
    // 分组头全选按钮显隐
    doc.querySelectorAll('.np-img-group-sel').forEach(b => { b.style.display = on ? 'inline-block' : 'none'; });
    updateBatchBar();
    render(); // 重渲以显示/隐藏勾选框
}

// 构建图片项的删除定位信息（供 ImageDelete 使用）
function buildDeleteItem(img) {
    const base = { cat: currentCat, path: img.path || '' };
    if (currentCat === 'chat') {
        base.entry = img.entry;
        base.hash = (img.entry && img.entry.path && imgHashCache.get(img.entry.path)) || undefined;
    } else {
        base.configId = img.imageId;
        base.presetName = img.presetName;
        base.presetType = currentCat;
        base.hash = (img.path && imgHashCache.get(img.path)) || undefined;
    }
    return base;
}

// 删除前确保反向索引完整：遍历全部 jiuguanStorage 图（不受当前视图限制），
// size 疑似命中预设引用图的才 fetch 比对；幂等（dupCache 已判定则跳过）。
let _fullScanPromise = null;
let _fullScanned = false; // 全量扫描完成标志（防 render 循环触发）
function ensureFullDupScan() {
    if (_fullScanned) return Promise.resolve();
    if (!_fullScanPromise) {
        _fullScanPromise = (async () => {
            await ensurePresetRefs();
            if (!presetRefs || presetRefs.length === 0) { _fullScanned = true; return; }
            const chatu8 = getChatu8();
            const storage = (chatu8 && chatu8.jiuguanStorage) || {};
            const pending = new Map();
            for (const md5 in storage) {
                const entry = storage[md5];
                if (!entry || !Array.isArray(entry.images)) continue;
                for (const img of entry.images) {
                    const path = img.path || '';
                    if (!path) continue;
                    const yushe = (img.genParams && img.genParams.yushe) || '';
                    const meta = { md5, change: entry.change || '', yushe };
                    if (typeof img.size !== 'number') { dupCache.set(path, null); continue; }
                    // 已判定过的图：仅当 chatMetaByHash 缺 meta 时才补（runDupCheck 走缓存补 meta 分支）
                    if (dupCache.has(path)) {
                        const h = imgHashCache.get(path);
                        if (h && meta.md5 && !chatMetaByHash.has(h)) pending.set(path, meta);
                        continue;
                    }
                    if (presetRefs.some(r => r.size === img.size)) {
                        pending.set(path, meta);
                    }
                }
            }
            if (pending.size > 0) await runDupCheck(pending);
            _fullScanned = true;
        })().finally(() => { _fullScanPromise = null; });
    }
    return _fullScanPromise;
}

// 批量删除已选图片（逐张走副本确认）
async function deleteSelected() {
    if (selectedSet.size === 0) return;
    // 先补全反向索引（可能不在文生图视图），再检查就绪
    try { await ensureFullDupScan(); } catch (e) { /* 扫描失败不阻塞删除，仅提示 */ }
    if (!isDeleteReady()) {
        showToast(doc, '副本识别未完成，请稍候再试', 'error');
        return;
    }
    // 从当前分组收集所选图片对象（selectedSet 的 key 可能在重渲后丢失引用，这里重建）
    const items = [];
    for (const g of _allGroups) {
        for (const img of g.images) {
            if (selectedSet.has(imgKey(img))) items.push(buildDeleteItem(img));
        }
    }
    if (items.length === 0) return;
    // 批量删除：只弹一次汇总确认，不逐张弹窗
    await deleteImageItems(items);
    // 删除完成后清空选择、退出管理模式（ImageDelete 内 onChanged 会重渲）
    selectedSet.clear();
    setManageMode(false);
}

// 向 ImageDelete 注入反向索引与变更回调（渲染后同步，删除后重渲）
function syncDupContext() {
    setDupContext({
        dupMap: dupCache,
        reverseMap: dupReverse,
        onChanged: () => render(),
        // 删除成功后清理对应收藏，并刷新收藏 tab
        onAfterDelete: (item) => {
            removeFavByDeletedItem(item);
            if (window.__refreshImageFavTab) window.__refreshImageFavTab();
        },
    });
}

// 图片被删除后移除对应收藏（chat 用 entry.path/uuid，预设用 configId）
function removeFavByDeletedItem(item) {
    if (!item) return;
    let key = null;
    if (item.cat === 'chat') {
        const uuid = item.entry && item.entry.uuid;
        const p = item.path;
        if (uuid) key = 'chat:' + uuid;
        else if (p) key = 'chat:' + p;
    } else {
        key = item.cat + ':' + item.configId;
    }
    if (!key) return;
    if (favMap.has(key)) {
        favMap.delete(key);
        persistFavs();
    }
}

// 删除 lightbox 当前查看的图片（复用管理模式的删除入口）
async function deleteLightboxImage() {
    if (!_lbList.length || _lbIndex < 0) return;
    const item = buildDeleteItem(_lbList[_lbIndex]);
    if (!item || !item.path) return;
    // 删除前补全反向索引，确保副本提示准确
    try { await ensureFullDupScan(); } catch (e) { /* 不阻塞 */ }
    // 索引未就绪不允许删除（与批量删除一致，防误删双写另一份）
    if (!isDeleteReady()) {
        showToast(doc, '副本识别未完成，请稍候再试', 'error');
        return;
    }
    // 仅在真正删除成功后才关闭 lightbox（取消/失败时保持预览不关闭）
    const deleted = await deleteImageItem(item);
    if (!deleted) return;
    closeLightbox();
    // onChanged（ImageDelete 内）已触发 render 重渲列表
}

// 截断过长分组名（提示词分组名可能很长；嵌套分组的子组同样适用）
function makeGroupTitle(g) {
    const full = g.label || '';
    if (full.length > PROMPT_LABEL_MAX) {
        const short = full.slice(0, PROMPT_LABEL_MAX) + '…';
        return { short, full, truncated: true };
    }
    return { short: full, full, truncated: false };
}

function appendGroups(start, end) {
    if (!doc) return;
    const list = doc.getElementById('np-img-list');
    if (!list) return;

    for (let i = start; i < end && i < _allGroups.length; i++) {
        appendGroupNode(_allGroups[i], list, 0);
    }
}

// 通用递归渲染分组节点：叶子组渲染图片网格；父组渲染子分组头 + 递归 children。
// depth 用于缩进嵌套层级的样式（CSS 类 np-img-group-depth-{depth}）。
function appendGroupNode(g, parent, depth) {
    if (!g) return;
    const groupEl = doc.createElement('div');
    groupEl.className = 'np-img-group np-img-group-depth-' + Math.min(depth, 3);
    const isLeaf = !(g.children && g.children.length);

    const header = doc.createElement('div');
    header.className = 'np-img-group-header';
    const titleInfo = makeGroupTitle(g);

    // 折叠/展开按钮（每个分组节点都有；折叠隐藏内容区）
    const collapse = doc.createElement('button');
    collapse.className = 'np-img-group-collapse';
    collapse.textContent = '▾';
    collapse.title = '折叠/展开';
    collapse.addEventListener('click', () => {
        groupEl.classList.toggle('collapsed');
        collapse.textContent = groupEl.classList.contains('collapsed') ? '▸' : '▾';
    });
    header.appendChild(collapse);

    const title = doc.createElement('span');
    title.className = 'np-img-group-title';
    // 每个分组节点都显示数量（中间节点递归统计子树总数）；日期只在叶子组显示
    let dateLabel = '';
    if (isLeaf && g.date) {
        try {
            const d = new Date(g.date);
            const pad = (n) => String(n).padStart(2, '0');
            dateLabel = ` · ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        } catch (e) { /* ignore */ }
    }
    const count = countGroupImages(g);
    title.textContent = `${titleInfo.short} (${count}${dateLabel})`;
    header.appendChild(title);

    // 管理模式：分组级全选 / 全不选（中间节点收集整棵子树图片，叶子收集自身）
    if (manageMode) {
        const selWrap = doc.createElement('span');
        selWrap.className = 'np-img-group-sel';
        const allBtn = doc.createElement('button');
        allBtn.className = 'np-img-group-sel-all';
        allBtn.textContent = '全选';
        allBtn.addEventListener('click', () => {
            collectGroupImages(g).forEach(img => selectedSet.add(imgKey(img)));
            updateBatchBar();
            render();
        });
        selWrap.appendChild(allBtn);
        const noneBtn = doc.createElement('button');
        noneBtn.className = 'np-img-group-sel-none';
        noneBtn.textContent = '全不选';
        noneBtn.addEventListener('click', () => {
            collectGroupImages(g).forEach(img => selectedSet.delete(imgKey(img)));
            updateBatchBar();
            render();
        });
        selWrap.appendChild(noneBtn);
        header.appendChild(selWrap);
    }

    // 提示词过长：提供「展开」+「复制」按钮；展开后可「收回」（仅提示词分组名）
    if (titleInfo.truncated) {
        const expand = doc.createElement('button');
        expand.className = 'np-img-group-expand';
        expand.textContent = '展开';
        let expanded = false;
        expand.addEventListener('click', () => {
            expanded = !expanded;
            // 展开时显示全名 + 数量（所有节点统一）
            const count = countGroupImages(g);
            title.textContent = `${expanded ? titleInfo.full : titleInfo.short} (${count})`;
            expand.textContent = expanded ? '收回' : '展开';
        });
        header.appendChild(expand);

        const copy = doc.createElement('button');
        copy.className = 'np-img-group-copy';
        copy.textContent = '复制';
        copy.addEventListener('click', async () => {
            // 非安全上下文（如 http://局域网IP 访问 ST）navigator.clipboard 为 undefined，
            // 直接 writeText 会抛 TypeError → 必须走 copyText 的 execCommand 兜底
            const ok = await copyText(titleInfo.full);
            copy.textContent = ok ? '已复制' : '复制失败';
            copy.classList.toggle('copied', ok);
            setTimeout(() => { copy.textContent = '复制'; copy.classList.remove('copied'); }, 1500);
        });
        header.appendChild(copy);
    }
    groupEl.appendChild(header);

    if (isLeaf) {
        const grid = doc.createElement('div');
        grid.className = 'np-img-grid';
        const visible = g.images.slice(0, IMAGES_PER_GROUP);
        visible.forEach(img => grid.appendChild(buildImageCell(img, g.images)));
        // 单组图片超过阈值：提供「展开全部」
        if (g.images.length > IMAGES_PER_GROUP) {
            const more = doc.createElement('button');
            more.className = 'np-img-group-more';
            more.textContent = `展开剩余 ${g.images.length - IMAGES_PER_GROUP} 张`;
            more.addEventListener('click', () => {
                g.images.slice(IMAGES_PER_GROUP).forEach(img => grid.appendChild(buildImageCell(img, g.images)));
                more.remove();
            });
            grid.appendChild(more);
        }
        groupEl.appendChild(grid);
    } else {
        // 递归渲染子分组
        const sub = doc.createElement('div');
        sub.className = 'np-img-subgroups';
        g.children.forEach(child => appendGroupNode(child, sub, depth + 1));
        groupEl.appendChild(sub);
    }
    parent.appendChild(groupEl);
}

// 统计组内图片总数（含子组递归）
function countGroupImages(g) {
    if (!g) return 0;
    if (g.children && g.children.length) {
        return g.children.reduce((n, c) => n + countGroupImages(c), 0);
    }
    return (g.images || []).length;
}

// 收集组内所有图片（含子组递归，管理模式全选用）
function collectGroupImages(g) {
    if (!g) return [];
    if (g.children && g.children.length) {
        return g.children.flatMap(c => collectGroupImages(c));
    }
    return g.images || [];
}

function buildImageCell(img, groupImages) {
    const cell = doc.createElement('div');
    cell.className = 'np-img-cell';
    const el = doc.createElement('div');
    el.className = 'np-img-thumb';
    const loading = doc.createElement('span');
    loading.textContent = '加载中…';
    el.appendChild(loading);

    // 收藏红心（左上角常显；管理模式时隐藏，避免与管理操作混在一起）
    const favBtn = buildFavBtn(img, false);
    favBtn.style.display = manageMode ? 'none' : 'block';
    el.appendChild(favBtn);

    // 管理模式勾选框（覆盖在缩略图左上角，红心隐藏后占据此位置；不随 src 异步重建）
    const check = doc.createElement('span');
    check.className = 'np-img-check';
    check.style.display = manageMode ? 'block' : 'none';
    check.textContent = '✓';
    check.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelect(img);
        check.classList.toggle('checked', isSelected(img));
    });
    check.classList.toggle('checked', isSelected(img));
    el.appendChild(check);

    const srcPromise = currentCat === 'chat'
        ? resolveImageSrc(img.entry)
        : resolveConfigImageSrc(img.imageId);
    srcPromise.then(src => {
        if (!src) { loading.textContent = '读取失败'; return; }
        loading.remove();
        const im = doc.createElement('img');
        im.className = 'np-img-thumb-img';
        im.src = src;
        im.alt = img.title;
        const idx = groupImages.indexOf(img);
        im.addEventListener('click', () => {
            if (manageMode) {
                toggleSelect(img);
                check.classList.toggle('checked', isSelected(img));
            } else {
                openLightbox(groupImages, idx);
            }
        });
        el.appendChild(im);
        if (img.dup) el.appendChild(buildDupBadge(img.dup));
    }).catch(() => { loading.textContent = '读取失败'; });

    cell.appendChild(el);
    const cap = doc.createElement('div');
    cap.className = 'np-img-cap';
    cap.textContent = img.title;
    cell.appendChild(cap);
    return cell;
}

function render() {
    if (!doc) return;
    reloadChatScan(); // 同步聊天扫描结果（可能已被扫描按钮更新）
    const list = doc.getElementById('np-img-list');
    const empty = doc.getElementById('np-img-empty');
    if (!list) return;
    list.innerHTML = '';
    removePager();

    const pendingSet = new Map(); // Map<path, meta>（chat 视图收集待判定的文内图）
    _allGroups = getGroups(pendingSet);

    // 搜索过滤（分组名 / 提示词原文）
    if (searchTerm) {
        _allGroups = _allGroups.filter(g => g.label.toLowerCase().includes(searchTerm));
    }

    if (_allGroups.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    // 总页数：按分组数分页（每页 GROUPS_PER_PAGE 个分组）
    _totalPages = Math.max(1, Math.ceil(_allGroups.length / GROUPS_PER_PAGE));
    if (_currentPage > _totalPages) _currentPage = _totalPages;
    if (_currentPage < 1) _currentPage = 1;

    const start = (_currentPage - 1) * GROUPS_PER_PAGE;
    const end = Math.min(start + GROUPS_PER_PAGE, _allGroups.length);
    appendGroups(start, end);
    renderPager();

    // 后台识别角色/服装副本（先显示，异步补徽标，不阻塞）。
    // 无论当前在哪个分类都要构建索引（删除按钮需依赖就绪态解锁；角色/服装视图同样可删）。
    // 首次进入时 presetRefs 为 null（pendingSet 恒空），必须无条件触发构建，
    // 构建完成后统一 collectPendingAndCheck 重新扫描当前列表，否则徽标永远不会出现。
    ensurePresetRefs().then(() => {
        // chat：扫描当前列表出徽标；角色/服装：全量扫描（chatMetaByHash 完整才能出反向角标 + 反查分组）
        if (currentCat === 'chat') return collectPendingAndCheck();
        return ensureFullDupScan();
    }).catch(() => { /* 失败不影响浏览 */ });
    syncDupContext();
}

// 在 presetRefs 已就绪的前提下，重新扫描当前分组的文内图：
// judgeChatImage 会写入 dupCache（size 不命中记 null）并把 size 疑似命中的收进 pending。
async function collectPendingAndCheck() {
    // 索引就绪后解锁删除按钮（无论当前在哪分类，collectPendingAndCheck 都会被调）
    const unlock = () => {
        updateBatchBar();
        updateLightboxDeleteBtn();
    };
    if (currentCat !== 'chat' || !presetRefs || presetRefs.length === 0) { unlock(); return; }
    const pending = new Map();
    for (const g of _allGroups) {
        for (const img of g.images) {
            judgeChatImage(img, pending); // 包装对象含 chatMeta
        }
    }
    if (pending.size > 0) await runDupCheck(pending);
    unlock();
}

// 顶部页码导航（第一页/上一页/页码/下一页/最后一页）
function renderPager() {
    if (!doc) return;
    const pager = doc.getElementById('np-img-pager-top');
    if (!pager) return;
    pager.innerHTML = '';
    if (_totalPages <= 1) return;

    const mk = (label, page, opts = {}) => {
        const b = doc.createElement('button');
        b.className = 'np-img-page' + (opts.active ? ' active' : '') + (opts.disabled ? ' disabled' : '');
        b.textContent = label;
        if (!opts.disabled && !opts.active) {
            b.addEventListener('click', () => { _currentPage = page; render(); });
        }
        return b;
    };

    const pages = doc.createElement('div');
    pages.className = 'np-img-pager-pages';

    pages.appendChild(mk('«', 1, { disabled: _currentPage === 1 }));
    pages.appendChild(mk('‹', _currentPage - 1, { disabled: _currentPage === 1 }));

    // 页码窗口：按容器实际宽度动态估算可显示的页码数（撑满整行；info 固定右侧）
    const pageW = 36;  // 紧凑按钮约 30px + gap 4px
    const arrowsW = pageW * 4; // « ‹ › » 四个箭头
    const infoW = 140; // 右侧 info「第 x/y 页 · 共 z 组」预留
    const boxW = pager.getBoundingClientRect ? pager.getBoundingClientRect().width : 0;
    const usableW = boxW > arrowsW + pageW + infoW ? boxW - arrowsW - infoW : 260;
    let win = Math.max(1, Math.floor(usableW / pageW)); // 当前页两侧各显示 win 个
    win = Math.min(win, Math.ceil(_totalPages / 2));
    const from = Math.max(1, _currentPage - win);
    const to = Math.min(_totalPages, _currentPage + win);
    if (from > 1) {
        pages.appendChild(mk('1', 1));
        if (from > 2) {
            const dot = doc.createElement('span');
            dot.className = 'np-img-page-dot';
            dot.textContent = '…';
            pages.appendChild(dot);
        }
    }
    for (let p = from; p <= to; p++) {
        pages.appendChild(mk(String(p), p, { active: p === _currentPage }));
    }
    if (to < _totalPages) {
        if (to < _totalPages - 1) {
            const dot = doc.createElement('span');
            dot.className = 'np-img-page-dot';
            dot.textContent = '…';
            pages.appendChild(dot);
        }
        pages.appendChild(mk(String(_totalPages), _totalPages));
    }

    pages.appendChild(mk('›', _currentPage + 1, { disabled: _currentPage === _totalPages }));
    pages.appendChild(mk('»', _totalPages, { disabled: _currentPage === _totalPages }));

    pager.appendChild(pages);

    const info = doc.createElement('span');
    info.className = 'np-img-page-info';
    info.textContent = `第 ${_currentPage}/${_totalPages} 页 · 共 ${_allGroups.length} 组`;
    pager.appendChild(info);
}

function removePager() {
    if (!doc) return;
    const pager = doc.getElementById('np-img-pager-top');
    if (pager) pager.innerHTML = '';
}

/* ============ lightbox（组内左右切图 + 下载原图） ============ */

// 当前 lightbox 状态：所属分组的所有图片对象 + 当前索引
let _lbList = [];
let _lbIndex = 0;
let _lbSession = 0; // 会话计数器：切图/关闭时自增，丢弃迟到的异步渲染

function openLightbox(groupImages, index) {
    if (!doc || !Array.isArray(groupImages) || !groupImages.length) return;
    _lbList = groupImages;
    _lbIndex = Math.max(0, Math.min(index, groupImages.length - 1));
    const box = doc.getElementById('np-lightbox');
    if (!box) return;
    box.style.display = 'flex';
    renderLightbox();
    updateLightboxNav();
    updateLightboxDeleteBtn();
    // 恢复删除/下载按钮显示（收藏 tab 打开时可能隐藏过）
    const delBtn = doc.getElementById('np-lightbox-delete');
    const dlBtn = doc.getElementById('np-lightbox-download');
    if (delBtn) delBtn.style.display = '';
    if (dlBtn) dlBtn.style.display = '';
    box.focus(); // 让键盘左右切图/ESC 生效
}

// lightbox 删除按钮：反向索引未就绪时置灰
function updateLightboxDeleteBtn() {
    if (!doc) return;
    const btn = doc.getElementById('np-lightbox-delete');
    if (!btn) return;
    const ready = isDeleteReady();
    btn.disabled = !ready;
    btn.title = ready ? '删除这张图片' : '副本识别中，完成前不可删除';
}

// 渲染当前索引的图片（异步取 src；防止切图竞态：用会话计数器守卫）
async function renderLightbox() {
    if (!doc) return;
    const img = doc.getElementById('np-lightbox-img');
    const info = doc.getElementById('np-lightbox-info');
    if (!img || !info) return;
    const item = _lbList[_lbIndex];
    if (!item) return;
    const session = ++_lbSession;
    img.src = '';
    img.alt = '加载中…';

    let html = `<div class="np-lb-title">${escapeHtml(item.title)}</div>`;
    // 文件路径（如 /user/images/chatu8/xxx.png），便于与控制台脚本核对
    if (item.path) html += `<div class="np-lb-file">${escapeHtml(item.path)}</div>`;
    if (item.meta) {
        const rows = [];
        if (item.meta.yushe) rows.push(`预设：${escapeHtml(item.meta.yushe)}`);
        if (item.meta.resolvedPrompt) rows.push(`提示词：${escapeHtml(item.meta.resolvedPrompt)}`);
        if (item.meta.backend) rows.push(`后端：${escapeHtml(item.meta.backend)}`);
        if (item.meta.model) rows.push(`模型：${escapeHtml(item.meta.model)}`);
        if (item.meta.seed) rows.push(`种子：${escapeHtml(String(item.meta.seed))}`);
        if (rows.length) html += `<div class="np-lb-meta">${rows.join('<br>')}</div>`;
    }
    if (item.dup) {
        const srcLabel = item.dup.source === 'character' ? '角色副本'
            : item.dup.source === 'outfit' ? '服装副本'
            : '文生图副本';
        html += `<div class="np-lb-dup">${escapeHtml(srcLabel)}：${escapeHtml(item.dup.name)}</div>`;
    }
    info.innerHTML = html;

    let src = null;
    if (item.entry) {
        // 文内图（图片管理）
        src = await resolveImageSrc(item.entry);
    } else if (item.imageId) {
        // 角色/服装图（图片管理）
        src = await resolveConfigImageSrc(item.imageId);
    } else if (item.path) {
        // 纯 path 项（收藏 tab 等）：直接 fetch
        try {
            const res = await fetch(item.path, { headers: getRequestHeaders() });
            if (res.ok) src = URL.createObjectURL(await res.blob());
        } catch (e) { /* 读取失败 */ }
    }
    if (session !== _lbSession) return; // 会话已变（切图/关闭），丢弃晚到结果
    if (!src) { img.alt = '读取失败'; return; }
    img.src = src;
    img.alt = item.title;
    updateLightboxFav();
}

// 同步 lightbox 红心状态（当前查看的图是否已收藏）
function updateLightboxFav() {
    if (!doc) return;
    const btn = doc.getElementById('np-lightbox-fav');
    const item = _lbList[_lbIndex];
    if (!btn || !item) return;
    const on = isFavorited(item);
    btn.textContent = on ? '♥' : '♡';
    btn.classList.toggle('on', on);
    btn.title = on ? '取消收藏' : '收藏';
}

function updateLightboxNav() {
    if (!doc) return;
    const prev = doc.getElementById('np-lightbox-prev');
    const next = doc.getElementById('np-lightbox-next');
    if (prev) prev.disabled = _lbIndex <= 0;
    if (next) next.disabled = _lbIndex >= _lbList.length - 1;
}

function stepLightbox(dir) {
    const next = _lbIndex + dir;
    if (next < 0 || next >= _lbList.length) return;
    _lbIndex = next;
    renderLightbox();
    updateLightboxNav();
}

// 下载当前图片的原图（服务器原文件，优先用 path；无 path 用当前 blob/src）
async function downloadLightboxImage() {
    if (!doc) return;
    const item = _lbList[_lbIndex];
    if (!item) return;
    const img = doc.getElementById('np-lightbox-img');
    let blob = null;
    let filename = '';
    // 优先：按 path 重新 fetch 服务器原图（带鉴权头）
    if (item.path) {
        try {
            const res = await fetch(item.path, { headers: getRequestHeaders() });
            if (res.ok) {
                blob = await res.blob();
                filename = item.path.split('/').pop() || '';
            }
        } catch (e) { /* 回退当前显示图 */ }
    }
    // 回退：当前已渲染的 blob/src（IndexedDB 或 objectURL）
    if (!blob && img && img.src) {
        try {
            const res = await fetch(img.src);
            if (res.ok) blob = await res.blob();
        } catch (e) { /* 忽略 */ }
    }
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename || `${item.title.replace(/[^\w\u4e00-\u9fa5-]+/g, '_') || 'image'}.png`;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function closeLightbox() {
    if (!doc) return;
    _lbSession++; // 使在途异步渲染失效
    const box = doc.getElementById('np-lightbox');
    const img = doc.getElementById('np-lightbox-img');
    if (box) box.style.display = 'none';
    if (img) img.src = '';
    _lbList = [];
    _lbIndex = 0;
}

// 副本徽标（双向：文内视图显示角色/服装副本；角色/服装视图显示文生图副本）
function buildDupBadge(dup) {
    const badge = doc.createElement('span');
    badge.className = 'np-img-dup-badge';
    if (dup.source === 'character') {
        badge.textContent = '👤';
        badge.title = `角色预设「${dup.name}」的副本`;
    } else if (dup.source === 'outfit') {
        badge.textContent = '👗';
        badge.title = `服装预设「${dup.name}」的副本`;
    } else {
        badge.textContent = '💬';
        badge.title = `文生图中也有此图（${dup.name}）`;
    }
    return badge;
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// 复制文本：优先 navigator.clipboard（仅安全上下文可用），不可用/失败时回退
// execCommand('copy')（临时 textarea + select）。与预设管理/解析页的复制兜底一致。
function copyText(text) {
    return new Promise(resolve => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => resolve(true))
                .catch(() => resolve(fallbackCopy(text)));
        } else {
            resolve(fallbackCopy(text));
        }
    });
}

function fallbackCopy(text) {
    try {
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = doc.execCommand('copy');
        ta.remove();
        return ok;
    } catch (e) {
        errorLog('[图片管理] 复制失败:', e);
        return false;
    }
}

/* ============ 事件绑定 ============ */

// 切换分类/子分组/搜索时回到第一页（页码点击的 render 不重置）
function reloadFirstPage() {
    _currentPage = 1;
    render();
}

function bindControls() {
    if (!doc) return;
    // 大类切换
    const cats = doc.querySelectorAll('#np-img-cats .np-img-cat');
    const syncSubVisibility = () => {
        const sub = doc.getElementById('np-img-sub');
        if (!sub) return;
        // chat 显示 chat 组；角色/服装显示 presetcat 组（分隔线一起显示）
        const chatGroup = sub.querySelector('.np-img-sub-group[data-for="chat"]');
        const presetGroup = sub.querySelector('.np-img-sub-group[data-for="presetcat"]');
        if (chatGroup) chatGroup.style.display = (currentCat === 'chat') ? 'inline-flex' : 'none';
        if (presetGroup) presetGroup.style.display = (currentCat === 'character' || currentCat === 'outfit') ? 'inline-flex' : 'none';
    };
    cats.forEach(btn => {
        btn.addEventListener('click', () => {
            cats.forEach(b => b.classList.toggle('active', b === btn));
            currentCat = btn.getAttribute('data-cat');
            syncSubVisibility();
            reloadFirstPage();
        });
    });

    // 文内生图子分组：按提示词/按预设/按角色 全部可叠加 toggle（localStorage 持久化）
    const chatSubBtns = doc.querySelectorAll('.np-img-sub-group[data-for="chat"] .np-img-sub-btn');
    const syncChatToggle = () => {
        chatSubBtns.forEach(b => b.classList.toggle('active', chatGroupDims.has(b.getAttribute('data-group'))));
    };
    chatSubBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const dim = btn.getAttribute('data-group');
            if (chatGroupDims.has(dim)) chatGroupDims.delete(dim);
            else chatGroupDims.add(dim);
            persistChatGroupDims();
            syncChatToggle();
            reloadFirstPage();
        });
    });
    syncChatToggle();

    // 角色/服装子分组（按提示词/按预设，可叠加 toggle，localStorage 持久化）
    const presetSubBtns = doc.querySelectorAll('.np-img-sub-group[data-for="presetcat"] .np-img-sub-btn');
    const syncPresetToggle = () => {
        presetSubBtns.forEach(b => b.classList.toggle('active', presetGroupDims.has(b.getAttribute('data-group'))));
    };
    presetSubBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const dim = btn.getAttribute('data-group');
            if (presetGroupDims.has(dim)) presetGroupDims.delete(dim);
            else presetGroupDims.add(dim);
            persistPresetGroupDims();
            syncPresetToggle();
            reloadFirstPage();
            // 开启维度时重置全量扫描标记，确保 chatMetaByHash 补齐（旧的 meta 可能缺失）
            if (presetGroupDims.size > 0) _fullScanned = false;
        });
    });
    // 初始同步一次
    syncSubVisibility();
    syncPresetToggle();
    // chat 的 +按角色 toggle 初始状态
    chatSubBtns.forEach(b => {
        const d = b.getAttribute('data-group');
        if (d === 'character') b.classList.toggle('active', chatGroupDims.has(d));
    });

    // 搜索
    const search = doc.getElementById('np-img-search');
    if (search) {
        search.addEventListener('input', () => {
            searchTerm = search.value.trim().toLowerCase();
            reloadFirstPage();
        });
    }

    // 排序方式（与预设管理页同款图标按钮 + 下拉菜单交互）
    const IMG_SORT_OPTIONS = [
        { mode: 'dateDesc', label: '日期（新→旧）' },
        { mode: 'dateAsc', label: '日期（旧→新）' },
        { mode: 'nameAsc', label: '名称' },
    ];
    try {
        initSortControl(doc, {
            getCurrentMode: () => sortMode,
            onModeChange: (m) => {
                sortMode = m;
                try { localStorage.setItem(SORT_KEY, sortMode); } catch (e) { /* ignore */ }
                reloadFirstPage();
            },
        }, IMG_SORT_OPTIONS, 'np-img-sort');
    } catch (e) { /* 降级：排序控件不可用不影响其他 */ }

    // 页码容器宽度变化 → 仅重渲页码（不重渲列表），让页码数跟随撑满宽度
    const pagerBox = doc.getElementById('np-img-pager-top');
    if (pagerBox && typeof ResizeObserver !== 'undefined' && !pagerBox._npResizeObs) {
        const ro = new ResizeObserver(() => {
            if (_allGroups.length > 0 && _totalPages > 1) renderPager();
        });
        ro.observe(pagerBox);
        pagerBox._npResizeObs = ro;
    }

    // lightbox 关闭 / 切图 / 下载
    const closeBtn = doc.getElementById('np-lightbox-close');
    if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
    const prevBtn = doc.getElementById('np-lightbox-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => stepLightbox(-1));
    const nextBtn = doc.getElementById('np-lightbox-next');
    if (nextBtn) nextBtn.addEventListener('click', () => stepLightbox(1));
    const dlBtn = doc.getElementById('np-lightbox-download');
    if (dlBtn) dlBtn.addEventListener('click', downloadLightboxImage);
    const lbDelBtn = doc.getElementById('np-lightbox-delete');
    if (lbDelBtn) lbDelBtn.addEventListener('click', deleteLightboxImage);
    const lbFavBtn = doc.getElementById('np-lightbox-fav');
    if (lbFavBtn) lbFavBtn.addEventListener('click', () => {
        const item = _lbList[_lbIndex];
        if (!item) return;
        toggleFavoriteImage(item);
        updateLightboxFav();
        // 通知收藏 tab 刷新（lightbox 里收藏/取消也要同步列表）
        if (window.__refreshImageFavTab) window.__refreshImageFavTab();
    });
    const box = doc.getElementById('np-lightbox');
    if (box) {
        box.addEventListener('click', (e) => {
            if (e.target === box) closeLightbox();
        });
        // 键盘左右切图（lightbox 打开时）
        box.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') stepLightbox(-1);
            else if (e.key === 'ArrowRight') stepLightbox(1);
            else if (e.key === 'Escape') closeLightbox();
        });
        box.setAttribute('tabindex', '-1');
    }

    // 扫描当前聊天（建立提示词→楼层/角色映射，供文生图按角色分组）
    const scanBtn = doc.getElementById('np-chat-scan');
    if (scanBtn) {
        scanBtn.addEventListener('click', async () => {
            try {
                scanBtn.disabled = true;
                scanBtn.textContent = '扫描中…';
                await scanCurrentChat();
                // 扫描完成：render 内会 reloadChatScan 重新加载扫描结果并重渲分组
                render();
            } catch (e) {
                errorLog('[聊天扫描] 失败:', e);
                showToast(doc, '扫描失败：' + (e?.message || e), 'error');
            } finally {
                scanBtn.disabled = false;
                scanBtn.textContent = '扫描聊天';
            }
        });
    }

    // 管理模式开关
    const manageBtn = doc.getElementById('np-img-manage');
    if (manageBtn) manageBtn.addEventListener('click', () => setManageMode(!manageMode));

    // 批量操作：清空 / 删除已选（删除按钮只在批量操作栏，顶栏不重复放）
    const clearBtn = doc.getElementById('np-img-sel-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => { selectedSet.clear(); updateBatchBar(); render(); });
    const selDeleteBtn = doc.getElementById('np-img-sel-delete');
    if (selDeleteBtn) selDeleteBtn.addEventListener('click', deleteSelected);
    const selFavBtn = doc.getElementById('np-img-sel-fav');
    if (selFavBtn) selFavBtn.addEventListener('click', favoriteSelectedImages);

    // 初始同步一次批量栏状态
    updateBatchBar();
}

/* ============ 初始化 ============ */

// 轻量初始化：仅绑定事件，不主动渲染。
// 渲染推迟到用户实际切到「图片管理」tab 时（renderImageManagerOnDemand），
// 避免打开抽屉/渲染预设时与图片读取抢资源、影响其他功能。
export function initImageManager(iframeDocument) {
    doc = iframeDocument;
    if (!doc.getElementById('np-img-list')) return;
    setDeleteDoc(doc);
    setChatScanDoc(doc);
    try {
        bindControls();
        syncDupContext();
    } catch (e) {
        errorLog('[图片管理] 初始化失败（不影响预设管理）:', e);
    }
}

// 按需渲染：由 nav 切换到图片管理 tab 时调用。
// keepAlive 模式下打开抽屉若默认停在图片 tab，本函数也会在切换/显示时被触发。
export function renderImageManagerOnDemand(iframeDocument) {
    if (!iframeDocument) return;
    doc = iframeDocument;
    if (!doc.getElementById('np-img-list')) return;
    try {
        reloadFavs(); // 每次渲染前同步最新收藏状态（收藏 tab 可能已变更）
        render();
    } catch (e) {
        errorLog('[图片管理] 渲染失败（不影响预设管理）:', e);
    }
}

// 保留旧导出名作为别名，避免调用方遗漏（实际不再主动调用）
export function syncImageManager(iframeDocument) {
    renderImageManagerOnDemand(iframeDocument);
}

// 共享 lightbox：供收藏 tab 等外部模块打开图片预览。
// list 项需含 title/path（可选 entry/imageId/meta/dup/key）。
// opts.noDelete=true 时隐藏删除按钮（收藏 tab 删除语义=取消收藏，不物理删图）；下载/红心保留。
export function openSharedLightbox(list, index, opts = {}) {
    openLightbox(list, index);
    const delBtn = doc && doc.getElementById('np-lightbox-delete');
    if (delBtn) delBtn.style.display = opts.noDelete ? 'none' : '';
}
