// src/features/nai-preset-switcher/ChatScan.js
// 聊天扫描：扫描聊天正文，确定「提示词 ↔ 楼层/角色」对应关系。
// 结果按聊天多份保留到 nai_preset_config.chatScan（聊天外可见），供文生图按 角色→聊天→楼层→提示词 分组。
//
// 存储结构（2026-08-16 用户拍板：多聊天保留 + 聊天外可见 + 去 tag 冗余）：
//   chatScan = { chats: [ { chatId, name, scannedAt, map: [{ storageKey, characterName, floors:[数字] }] } ] }
//   - chats 按 chatId 索引，每个聊天一份，多聊天互不覆盖。
//   - map[].storageKey = jiuguanStorage 的 md5 key（定位图）；不存提示词原文（体积，靠 md5 反查 change）。
//   - map[].characterName = 该提示词归属角色；floors = 消息索引数字数组。
//
// 数据来源（⚠️ 2026-08-15 更正：不再依赖 extra.images）：
//  1. 提示词从【聊天正文 chat[i].mes】提取。智绘姬会把提示词写进正文：
//     - 常见形态一：<image>image###纯提示词###</image>
//     - 常见形态二：直接 <image>纯提示词</image>
//     - 兜底形态三：正文里裸的 startTag...endTag（默认 image###...###）
//  2. jiuguanStorage 的 key = md5(提示词)（智绘姬 setItemImg 用 CryptoJS.MD5(tag) 计算，
//     且智绘姬图片按钮 getItemImg(link) 用「去包裹纯 tag」也能命中）。
//     因此扫描时对每个正文 tag 尝试多种候选 md5 + 文本匹配，命中 jiuguanStorage 的 key 才落盘。
//  3. chat[i].name / is_user → 角色归属；楼层 = 消息索引 i。
//
// 标记配置：extension_settings["st-chatu8"].startTag（默认 image###）/ endTag（默认 ###）。

import { extension_settings } from '../../../../../../extensions.js';
import { saveSettings } from '../../../../../../../script.js';
import { errorLog, debugLog } from '../../utils/logger.js';
import configManager from '../../singleton/configManager.js';
import { showToast } from '../../shared/Toast.js';

const CHATU8 = 'st-chatu8';

let doc = null;

export function setChatScanDoc(d) { doc = d; }

/* ============ 轻量 MD5（兼容 CryptoJS.MD5 的 UTF-8 字符串输入） ============ */

const MD5_LOOKUP = (() => {
    const arr = [];
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        arr[i] = c >>> 0;
    }
    return arr;
})();

function md5Utf8(input) {
    const str = String(input ?? '');
    // UTF-8 编码
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
        } else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
            const low = str.charCodeAt(i + 1);
            if (low >= 0xDC00 && low <= 0xDFFF) {
                const combined = ((code - 0xD800) << 10) + (low - 0xDC00) + 0x10000;
                bytes.push(
                    0xF0 | (combined >> 18),
                    0x80 | ((combined >> 12) & 0x3F),
                    0x80 | ((combined >> 6) & 0x3F),
                    0x80 | (combined & 0x3F)
                );
                i++;
            } else {
                bytes.push(0xEF, 0xBF, 0xBD);
            }
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            bytes.push(0xEF, 0xBF, 0xBD);
        } else {
            bytes.push(
                0xE0 | (code >> 12),
                0x80 | ((code >> 6) & 0x3F),
                0x80 | (code & 0x3F)
            );
        }
    }
    return md5FromBytes(bytes);
}

function md5FromBytes(bytes) {
    const len = bytes.length;
    // 补位：先补 0x80，再补到 56 mod 64
    const padded = bytes.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0);
    // 追加 64 位长度（小端，低 32 位 + 高 32 位）
    const low = (len * 8) >>> 0;
    const high = Math.floor(len / 0x20000000) >>> 0; // (len*8)/2^32
    for (let i = 0; i < 4; i++) padded.push((low >>> (8 * i)) & 0xFF);
    for (let i = 0; i < 4; i++) padded.push((high >>> (8 * i)) & 0xFF);

    let a0 = 0x67452301, b0 = 0xEFCDAB89, c0 = 0x98BADCFE, d0 = 0x10325476;

    const shiftTable = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];
    const K = [];
    for (let i = 0; i < 64; i++) {
        K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    }

    for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
        const M = [];
        for (let j = 0; j < 16; j++) {
            M[j] = (
                (padded[chunkStart + j * 4]) |
                (padded[chunkStart + j * 4 + 1] << 8) |
                (padded[chunkStart + j * 4 + 2] << 16) |
                (padded[chunkStart + j * 4 + 3] << 24)
            ) >>> 0;
        }
        let A = a0, B = b0, C = c0, D = d0;

        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) {
                F = (B & C) | (~B & D);
                g = i;
            } else if (i < 32) {
                F = (D & B) | (~D & C);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                F = B ^ C ^ D;
                g = (3 * i + 5) % 16;
            } else {
                F = C ^ (B | ~D);
                g = (7 * i) % 16;
            }
            F = (F + A + K[i] + M[g]) >>> 0;
            const shift = shiftTable[i];
            F = (F << shift) | (F >>> (32 - shift));
            A = D;
            D = C;
            C = B;
            B = (B + F) >>> 0;
        }
        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }

    const hex = [];
    for (const val of [a0, b0, c0, d0]) {
        for (let i = 0; i < 4; i++) {
            hex.push(((val >>> (i * 8)) & 0xFF).toString(16).padStart(2, '0'));
        }
    }
    return hex.join('');
}

/* ============ 标记配置与提取 ============ */

function getImageTags() {
    const s = extension_settings[CHATU8] || {};
    return { startTag: s.startTag || 'image###', endTag: s.endTag || '###' };
}

// 从一段正文里提取所有图片提示词（去包裹后）。
// 返回数组，元素为 { raw, tag }：
//   raw = 去包裹后的原文（保留内部空白，供 md5 精确定位 jiuguanStorage）
//   tag = 折叠空白后的归一化文本（供分组 label / 去重）
function extractTagsFromBody(body) {
    const { startTag, endTag } = getImageTags();
    const tags = [];
    if (typeof body !== 'string' || !body) return tags;

    const escapedStart = startTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = endTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pureTagRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`);

    const push = (raw) => {
        const r = String(raw || '').trim();
        if (!r) return;
        const t = normalizeTag(r);
        if (t && !tags.some(x => x.tag === t)) tags.push({ raw: r, tag: t });
    };

    // 1) <image>...</image> 块：优先取内部的 startTag...endTag，否则取整块
    const imageBlockRegex = /<image>([\s\S]*?)<\/image>/g;
    let blockMatch;
    let sawImageBlock = false;
    while ((blockMatch = imageBlockRegex.exec(body)) !== null) {
        sawImageBlock = true;
        const inner = blockMatch[1];
        const innerMatch = inner.match(pureTagRegex);
        if (innerMatch && innerMatch[1] && innerMatch[1].trim()) {
            push(innerMatch[1]);
        } else if (inner.trim()) {
            push(inner);
        }
    }

    // 2) 正文裸的 startTag...endTag（不在 <image> 内时兜底）
    if (!sawImageBlock) {
        const bareRegex = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, 'g');
        let m;
        while ((m = bareRegex.exec(body)) !== null) {
            push(m[1]);
        }
    }
    return tags;
}

// 归一化提示词文本：折叠空白
function normalizeTag(tag) {
    return String(tag || '').replace(/\s+/g, ' ').trim();
}

/* ============ ST 上下文 ============ */

// 获取 ST 上下文（getContext 是 ES module 导出，挂 globalThis.SillyTavern，不挂 window）
function getStContext() {
    try {
        const st = globalThis.SillyTavern;
        if (st && typeof st.getContext === 'function') return st.getContext();
    } catch (e) { /* 忽略 */ }
    return null;
}

// 当前聊天标识（context.chatId 优先；context.getCurrentChatId() 兜底）
function getChatId(context) {
    try {
        if (context && typeof context.chatId === 'string' && context.chatId) return context.chatId;
        if (context && typeof context.getCurrentChatId === 'function') return context.getCurrentChatId() || '';
    } catch (e) { /* 忽略 */ }
    return '';
}

// 给定一个纯提示词，尝试找到它对应的 jiuguanStorage key（= md5）。
// 复刻智绘姬 button 的 link 链路：pureTag.trim() → 去全角括号 → 去换行。
// 多候选策略：按可信度排序，逐一尝试存在与否；都不中再兜底文本匹配 change。
function resolveStorageKey(rawTag, storage) {
    if (!rawTag) return '';
    const candidates = [];
    // 候选1（智绘姬按钮链路）：pureTag.trim() 去《》去\n —— 与 getItemImg(link) 完全一致
    const link = String(rawTag).trim()
        .replace(/[《》]/g, (c) => c === '《' ? '<' : '>')
        .replace(/\n/g, '');
    candidates.push(link);
    // 候选2：原文（去包裹后原样，保留内部空白）
    candidates.push(rawTag);
    // 候选3：折叠空白后（兼容手动输入/其它写入路径）
    const collapsed = normalizeTag(rawTag);
    if (collapsed !== link) candidates.push(collapsed);
    // 候选4：带 startTag 包裹的原始 tag（老版本可能按包裹存）
    const { startTag, endTag } = getImageTags();
    const wrapped = `${startTag}${rawTag}${endTag}`;
    if (wrapped !== link) candidates.push(wrapped);

    for (const c of candidates) {
        if (!c) continue;
        const md5 = md5Utf8(c);
        if (storage[md5]) return md5;
    }
    // 文本匹配：normalize 后与 storage 各 entry.change 精确比对
    const key = matchChangeText(storage, collapsed);
    if (key) return key;
    return '';
}

// 文本匹配：用纯提示词 normalize 后与 jiuguanStorage 各 entry.change 比对，命中返回 key
function matchChangeText(storage, normalizedTag) {
    if (!normalizedTag) return '';
    for (const md5 in storage) {
        const e = storage[md5];
        if (!e || !e.change) continue;
        if (normalizeTag(e.change) === normalizedTag) return md5;
    }
    return '';
}

// 扫描当前聊天，构建 提示词 → 楼层/角色 映射
export async function scanCurrentChat(ctx) {
    const context = ctx || getStContext();
    if (!context || !Array.isArray(context.chat)) {
        showToast(doc, '未获取到聊天数据', 'error');
        return null;
    }
    const chat = context.chat;
    const chatId = getChatId(context);

    const chatu8 = extension_settings[CHATU8] || {};
    const storage = chatu8.jiuguanStorage || {};

    // 遍历消息，从正文提取提示词 → floors + 角色
    const mapByTag = new Map(); // 纯 tag -> { tag, storageKey, floors:Set, characters:Set }
    let mesWithImages = 0;
    let totalTags = 0;
    for (let i = 0; i < chat.length; i++) {
        const mes = chat[i];
        if (!mes) continue;
        const body = (mes.mes !== undefined ? mes.mes : mes.content) || '';
        // 角色归属：用户消息用 name/用户，否则用 name（可能是空）
        const characterName = mes.is_user ? (mes.name || '用户') : (mes.name || '角色');
        const tags = extractTagsFromBody(body);
        if (tags.length === 0) continue;
        mesWithImages++;
        for (const { raw, tag } of tags) {
            if (!tag) continue;
            totalTags++;
            if (!mapByTag.has(tag)) {
                const storageKey = resolveStorageKey(raw, storage);
                mapByTag.set(tag, {
                    tag,
                    raw,
                    storageKey,
                    floors: new Set(),
                    characters: new Set(),
                });
            }
            const m = mapByTag.get(tag);
            m.floors.add(i);
            if (characterName) m.characters.add(characterName);
        }
    }
    debugLog(`[聊天扫描] 探测：${chat.length} 条消息，${mesWithImages} 条正文含图片提示词，共 ${totalTags} 个提示词实例`);

    // 序列化：按角色分组。mapByTag 里每个提示词记录了出现的角色集合，
    // 该提示词归入每个出现的角色下（同一提示词同聊天跨角色时各角色都记）。
    // 角色名作为顶层 key（天然层级：角色 → 聊天 → 提示词），map 内不再重复记角色名。
    const byCharacter = new Map(); // characterName -> [{storageKey, floors}]
    for (const m of mapByTag.values()) {
        if (!m.storageKey) continue; // 命中失败不落盘（垃圾 key）
        const chars = m.characters.size > 0 ? [...m.characters] : ['未知角色'];
        const floors = [...m.floors].sort((a, b) => a - b);
        for (const characterName of chars) {
            if (!byCharacter.has(characterName)) byCharacter.set(characterName, []);
            byCharacter.get(characterName).push({ storageKey: m.storageKey, floors });
        }
    }

    // 聊天名：chat_metadata.title 优先（自定义标题），否则用 chatId（文件名无扩展名）
    let chatName = '';
    try {
        const md = context.chatMetadata;
        if (md && typeof md === 'object' && typeof md.title === 'string' && md.title.trim()) chatName = md.title.trim();
    } catch (e) { /* 忽略 */ }
    if (!chatName) chatName = chatId;

    // 落盘（按 角色→chatId 双层合并写入，不影响其他角色/聊天）
    let totalMapEntries = 0;
    for (const [characterName, map] of byCharacter) {
        configManager.setNaiChatScan({ characterName, chatId, name: chatName, scannedAt: Date.now(), map });
        totalMapEntries += map.length;
    }

    try { saveSettings(); } catch (e) { /* 忽略 */ }

    debugLog(`[聊天扫描] 扫描完成：${byCharacter.size} 个角色，${totalMapEntries} 个提示词记录，${mapByTag.size} 个提示词`);
    showToast(doc, `扫描完成：识别到 ${totalMapEntries} 个提示词（${byCharacter.size} 个角色）`, 'success');
    return { characterNames: [...byCharacter.keys()], chatId, name: chatName, scannedAt: Date.now() };
}

// 扁平化 characters 结构 → 记录数组 [{characterName, chatId, name, scannedAt, map:[{storageKey, floors}]}]
function flattenChatScans() {
    const scan = configManager.getNaiChatScan();
    const characters = (scan && scan.characters && typeof scan.characters === 'object') ? scan.characters : {};
    const records = [];
    for (const characterName in characters) {
        const charEntry = characters[characterName];
        if (!charEntry || !charEntry.chats || typeof charEntry.chats !== 'object') continue;
        for (const chatId in charEntry.chats) {
            const c = charEntry.chats[chatId];
            if (!c || typeof c !== 'object') continue;
            records.push({
                characterName: String(characterName),
                chatId: String(chatId),
                name: String(c.name || ''),
                scannedAt: typeof c.scannedAt === 'number' ? c.scannedAt : 0,
                map: Array.isArray(c.map) ? c.map : [],
            });
        }
    }
    return records;
}

// 读取当前聊天的扫描结果（无则返回空记录；跨角色合并为单条，供扫描按钮/单聊天视图）
export function getChatScanForCurrentChat() {
    const chatId = getChatId(getStContext());
    const all = flattenChatScans();
    const matches = all.filter(r => r.chatId === chatId);
    if (matches.length === 0) return { chatId, name: chatId, scannedAt: 0, map: [] };
    // 合并各角色的 map（每项补 characterName 供消费端）
    const map = [];
    matches.forEach(r => {
        (r.map || []).forEach(m => {
            if (!m || !m.storageKey) return;
            map.push({ storageKey: m.storageKey, characterName: r.characterName, floors: m.floors || [] });
        });
    });
    return {
        chatId,
        name: matches[0].name || chatId,
        scannedAt: Math.max(...matches.map(r => r.scannedAt)),
        map,
    };
}

// 按 chatId 读单个聊天的扫描记录（跨角色合并）
export function getChatScanRecord(chatId) {
    if (!chatId) return null;
    return getChatScanForCurrentChat(); // 复用（当前聊天即该 chatId 视图）
}

// 读取全部已扫描聊天记录（聊天外可见：图片管理聚合所有聊天）
// 返回扁平记录数组 [{characterName, chatId, name, scannedAt, map:[{storageKey, floors}]}]
export function getAllChatScans() {
    return flattenChatScans();
}
