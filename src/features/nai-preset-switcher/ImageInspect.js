// src/features/nai-preset-switcher/ImageInspect.js
// 图片生成参数解析：纯浏览器端实现，无后端依赖。
// 支持的来源（与 novelai.net/inspect 等价，并补充更多展示字段）：
//   1) PNG 文本块 tEXt / iTXt：
//        - NAI 格式：key=Comment 的 JSON（含 prompt / negative_prompt / steps / sampler / seed / cfg_scale / model 等）
//        - SD WebUI 格式：key=parameters 的纯文本（以 "Negative prompt:" 分隔，后接 Steps/Sampler/CFG...）
//        - NAI 旧格式：key=Description 纯文本
//   2) NAI 隐写（stealth）：alpha 通道最低位（LSB）编码，前缀 stealth_pnginfo（明文）或 stealth_pngcomp（gzip）
//   3) JPEG / WEBP 的 EXIF / XMP：部分工具会把 prompt 写进 XMP（UserComment / raw XMP xml），作为兜底
//
// 对外暴露 initImageInspect(doc)：绑定解析 tab 的拖拽、点击选择、复制等交互。

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const NAI_STEALTH_INFO = 'stealth_pnginfo';
const NAI_STEALTH_COMP = 'stealth_pngcomp';

// 把 NAI Comment JSON 解析出正向/负向提示词与参数表
function parseNaiComment(raw) {
    let obj;
    try {
        obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
        return null;
    }
    if (!obj || typeof obj !== 'object') return null;

    // 提示词：v4 结构用 caption.base_caption，否则用 prompt / uc
    let positive = obj.prompt || '';
    let negative = obj.uc || '';
    if (obj.v4_prompt && obj.v4_prompt.caption && obj.v4_prompt.caption.base_caption) {
        positive = obj.v4_prompt.caption.base_caption || positive;
    }
    if (obj.v4_negative_prompt && obj.v4_negative_prompt.caption && obj.v4_negative_prompt.caption.base_caption) {
        negative = obj.v4_negative_prompt.caption.base_caption || negative;
    }

    // 参数：尽量原样保留，过滤掉嵌套的大对象（caption）以免展示过于冗长
    const params = {};
    const SKIP = new Set(['prompt', 'uc', 'v4_prompt', 'v4_negative_prompt']);
    for (const [k, v] of Object.entries(obj)) {
        if (SKIP.has(k)) continue;
        if (v && typeof v === 'object') {
            params[k] = JSON.stringify(v);
        } else {
            params[k] = v;
        }
    }
    return { positive, negative, params };
}

// 解析 SD WebUI 的 parameters 文本：第一行是正向，Negative prompt: 后是负向，再后是参数行
function parseSdParameters(text) {
    const negIdx = text.indexOf('Negative prompt:');
    let positive = text;
    let negative = '';
    let rest = '';
    if (negIdx >= 0) {
        positive = text.substring(0, negIdx).trim();
        rest = text.substring(negIdx + 'Negative prompt:'.length);
        const m = rest.match(/\n(Steps:|Sampler:|CFG scale:|Size:|Model:|Seed:)/);
        negative = (m ? rest.substring(0, m.index) : rest).trim();
        rest = m ? rest.substring(m.index).trim() : '';
    } else {
        positive = text.trim();
    }

    const params = {};
    // 形如 "Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 123, Size: 512x768"
    const re = /([A-Za-z 0-9]+?):\s*([^,]+)(?:,|$)/g;
    let mm;
    while ((mm = re.exec(rest)) !== null) {
        params[mm[1].trim()] = mm[2].trim();
    }
    return { positive, negative, params };
}

// 解码 tEXt / iTXt chunk 为 { key, value }
function decodeTextChunk(chunk) {
    const data = chunk.data;
    if (chunk.type === 'tEXt') {
        let z = data.indexOf(0);
        if (z < 0) z = data.length;
        return {
            key: utf8Decode(data.subarray(0, z)),
            value: utf8Decode(data.subarray(z + 1)),
        };
    }
    if (chunk.type === 'iTXt') {
        let p = 0;
        const keyEnd = data.indexOf(0, p);
        const key = utf8Decode(data.subarray(p, keyEnd));
        p = keyEnd + 1;
        const compression = data[p];
        p += 2; // compression flag + compression method
        const langEnd = data.indexOf(0, p);
        p = langEnd + 1;
        const transEnd = data.indexOf(0, p);
        p = transEnd + 1;
        if (compression === 1) {
            try {
                return { key, value: p < data.length ? pngInflate(data.subarray(p)) : '' };
            } catch (e) {
                return { key, value: '' };
            }
        }
        return { key, value: utf8Decode(data.subarray(p)) };
    }
    return null;
}

// 从 ArrayBuffer 拆出 PNG 的所有 chunk（仅取我们关心的文本类）
function parsePngChunks(buf) {
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (bytes[i] !== PNG_SIGNATURE[i]) return null; // 非 PNG
    }
    let off = 8;
    const chunks = [];
    while (off + 8 <= bytes.length) {
        const len = view.getUint32(off);
        const type = utf8Decode(bytes.subarray(off + 4, off + 8));
        const dataStart = off + 8;
        const data = bytes.subarray(dataStart, dataStart + len);
        chunks.push({ type, data });
        off = dataStart + len + 4; // 跳过 CRC
        if (type === 'IEND') break;
    }
    return chunks;
}

// 从 PNG alpha 通道最低位提取隐写数据
async function extractStealth(buf) {
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    // 用 canvas 取像素（需经 Image 解码，浏览器环境）
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = reject;
            im.src = url;
        });
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return null;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, w, h).data;
        const total = w * h;

        let bitPos = 0;
        const readBit = () => {
            const idx = bitPos++;
            const pxIdx = 4 * (idx % w * h + Math.floor(idx / w));
            return px[pxIdx + 3] & 1;
        };
        const readByte = () => {
            let b = 0;
            for (let i = 0; i < 8; i++) b = (b << 1) | readBit();
            return b;
        };

        // 1) 读前缀，长度取 stealth_pnginfo / stealth_pngcomp 二者较长者
        const maxPrefix = Math.max(NAI_STEALTH_INFO.length, NAI_STEALTH_COMP.length);
        let prefix = '';
        while (prefix.length < maxPrefix && bitPos < total) {
            prefix += String.fromCharCode(readByte());
        }
        let isCompressed = false;
        if (prefix === NAI_STEALTH_INFO) {
            isCompressed = false;
        } else if (prefix === NAI_STEALTH_COMP) {
            isCompressed = true;
        } else {
            return null;
        }

        // 2) 读 32 位长度
        let len = 0;
        for (let i = 0; i < 32; i++) len = (len << 1) | readBit();
        if (len <= 0 || len > total) return null;

        // 3) 读 payload
        const out = new Uint8Array(Math.ceil(len / 8));
        for (let i = 0; i < out.length; i++) {
            out[i] = (i * 8) < len ? readByte() : 0;
        }

        let text;
        if (isCompressed) {
            try {
                const ds = new DecompressionStream('gzip');
                const ab = await new Response(new Blob([out]).stream().pipeThrough(ds)).arrayBuffer();
                text = new TextDecoder('utf-8').decode(ab);
            } catch (e) {
                return null;
            }
        } else {
            text = new TextDecoder('utf-8').decode(out.subarray(0, len));
        }
        return text;
    } catch (e) {
        return null;
    } finally {
        URL.revokeObjectURL(url);
    }
}

// 极小 PNG 文本解压（iTXt zlib/deflate），优先用浏览器 DecompressionStream，否则回退放弃
async function pngInflate(bytes) {
    try {
        const ds = new DecompressionStream('deflate');
        const ab = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
        return new TextDecoder('utf-8').decode(ab);
    } catch (e) {
        return '';
    }
}

function utf8Decode(arr) {
    try {
        return new TextDecoder('utf-8').decode(arr);
    } catch (e) {
        let s = '';
        for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
        return s;
    }
}

// 从 JPEG/WEBP 的 EXIF/XMP 提取 prompt（兜底）
function extractFromExifXmp(buf) {
    const bytes = new Uint8Array(buf);
    // XMP 通常含 <x:xmpmeta；UserComment 可能含 prompt。这里做粗匹配。
    const head = utf8Decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
    const xmpMatch = head.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/i);
    if (xmpMatch) {
        const xml = xmpMatch[0];
        if (/prompt|Negative/i.test(xml)) return xml;
    }
    // EXIF UserComment (0x9286) 或 Description (0x010e) 中含 prompt 关键字
    const commentMatch = head.match(/(?:UserComment|Description)(?:.{0,40}?)(prompt[\s\S]{0,2000}?)(?:;|\x00|$)/i);
    if (commentMatch) return commentMatch[1];
    return null;
}

// 主解析：输入 File，输出标准化结果
export async function inspectImageFile(file) {
    const buf = await file.arrayBuffer();
    const result = {
        source: '未识别',
        positive: '',
        negative: '',
        params: {},
        raw: '',
        thumb: '',
    };

    // 缩略图（用于结果区预览，不依赖能否解析）
    result.thumb = await makeThumb(file);

    // 1) PNG 文本块
    const chunks = parsePngChunks(buf);
    if (chunks) {
        const textMap = {};
        for (const c of chunks) {
            if (c.type === 'tEXt' || c.type === 'iTXt') {
                const d = decodeTextChunk(c);
                if (d && d.key) textMap[d.key] = d.value;
            }
        }
        if (textMap.Comment) {
            const p = parseNaiComment(textMap.Comment);
            if (p && (p.positive || p.negative)) {
                result.source = 'NovelAI';
                result.positive = p.positive;
                result.negative = p.negative;
                result.params = p.params;
                result.raw = typeof textMap.Comment === 'string' ? textMap.Comment : JSON.stringify(textMap.Comment, null, 2);
                return finalize(result);
            }
        }
        if (textMap.parameters) {
            const p = parseSdParameters(textMap.parameters);
            result.source = 'SD WebUI';
            result.positive = p.positive;
            result.negative = p.negative;
            result.params = p.params;
            result.raw = textMap.parameters;
            return finalize(result);
        }
        if (textMap.Description) {
            result.source = 'NovelAI (Description)';
            result.positive = textMap.Description;
            return finalize(result);
        }

        // 2) PNG 隐写通道
        const stealth = await extractStealth(buf);
        if (stealth) {
            const p = parseNaiComment(stealth) || parseSdParameters(stealth);
            if (p && (p.positive || p.negative)) {
                result.source = 'NovelAI (隐写)';
                result.positive = p.positive;
                result.negative = p.negative;
                result.params = p.params;
                result.raw = stealth;
                return finalize(result);
            }
        }
        return finalize(result);
    }

    // 3) 非 PNG：尝试 EXIF/XMP 兜底
    const exif = extractFromExifXmp(buf);
    if (exif) {
        result.source = 'EXIF/XMP';
        result.raw = exif;
        // 尝试从 XMP 里抽 prompt/negative
        const pm = exif.match(/(?:positive_?prompt|prompt)["']?\s*[:=]\s*["']([^"']+)["']/i);
        const nm = exif.match(/(?:negative_?prompt)["']?\s*[:=]\s*["']([^"']+)["']/i);
        if (pm) result.positive = pm[1];
        if (nm) result.negative = nm[1];
        return finalize(result);
    }

    return finalize(result);
}

function finalize(r) {
    // 把 params 整理成可展示的顺序数组（保持常见字段在前）
    const ORDER = ['steps', 'sampler', 'schedule', 'seed', 'cfg_scale', 'cfg scale', 'width', 'height', 'size', 'model', 'models', 'noise_schedule', 'qualityToggle', 'scale'];
    const keys = Object.keys(r.params);
    keys.sort((a, b) => {
        const ia = ORDER.indexOf(a.toLowerCase()), ib = ORDER.indexOf(b.toLowerCase());
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return a.localeCompare(b);
    });
    r.paramList = keys.map(k => ({ key: k, value: String(r.params[k]) }));
    return r;
}

async function makeThumb(file) {
    try {
        const url = URL.createObjectURL(file);
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = reject;
            im.src = url;
        });
        const max = 360;
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        return canvas.toDataURL('image/png');
    } catch (e) {
        return '';
    }
}

// ============ UI 绑定 ============
export function initImageInspect(doc, onParsed) {
    const dropZone = doc.getElementById('np-inspect-drop');
    const dropImg = doc.getElementById('np-inspect-drop-img');
    const fileInput = doc.getElementById('np-inspect-file');
    const resultBox = doc.getElementById('np-inspect-result');
    const copyBtn = doc.getElementById('np-inspect-copy');

    if (!dropZone || !fileInput || !resultBox) return;

    // 会话守卫：连续拖入多张图时，只有最后一次的异步回调允许刷新 UI，
    // 避免旧图（较慢的异步链）在最后完成把新图覆盖回去。
    let session = 0;

    const handleFile = async (file) => {
        if (!file) return;
        const mySession = ++session;
        resultBox.innerHTML = '<div class="np-inspect-loading">解析中…</div>';
        if (copyBtn) copyBtn.disabled = true;
        try {
            const data = await inspectImageFile(file);
            if (mySession !== session) return; // 已有更新的解析在进行，放弃本次渲染
            renderInspectResult(doc, resultBox, data);
            // 通知外部（用于「添加为预设」预填）：传出解析结果与原始文件
            if (typeof onParsed === 'function') {
                onParsed({ positive: data.positive, negative: data.negative, thumb: data.thumb, source: data.source, file });
            }
            // 在拖拽区内显示预览图，仍可点击/拖拽重新解析
            if (dropImg) {
                if (data.thumb) {
                    dropImg.src = data.thumb;
                    dropZone.classList.add('has-image');
                } else {
                    dropImg.removeAttribute('src');
                    dropZone.classList.remove('has-image');
                }
            }
        } catch (e) {
            if (mySession !== session) return;
            resultBox.innerHTML = `<div class="np-inspect-error">解析失败：${escapeHtml(String(e && e.message || e))}</div>`;
        }
    };

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        handleFile(f);
        fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach(ev =>
        dropZone.addEventListener(ev, (e) => {
            e.preventDefault(); e.stopPropagation();
            dropZone.classList.add('drag');
        })
    );
    ['dragleave', 'drop'].forEach(ev =>
        dropZone.addEventListener(ev, (e) => {
            e.preventDefault(); e.stopPropagation();
            dropZone.classList.remove('drag');
        })
    );
    dropZone.addEventListener('drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        handleFile(f);
    });

    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            if (copyBtn.disabled) return;
            const text = resultBox.getAttribute('data-copy') || '';
            if (!text) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
            } else {
                fallbackCopy(text);
            }
            const old = copyBtn.textContent;
            copyBtn.textContent = '已复制';
            setTimeout(() => { copyBtn.textContent = old; }, 1500);
        });
    }
}

function renderInspectResult(doc, box, data) {
    const rows = [];
    rows.push(`<div class="np-inspect-source">来源：<b>${escapeHtml(data.source)}</b></div>`);

    rows.push(fieldBlock('正向提示词', data.positive));
    rows.push(fieldBlock('负向提示词', data.negative));

    if (data.paramList && data.paramList.length) {
        const items = data.paramList.map(p =>
            `<div class="np-param-row"><span class="np-param-key">${escapeHtml(p.key)}</span><span class="np-param-val">${escapeHtml(p.value)}</span></div>`
        ).join('');
        rows.push(`<div class="np-param-block"><div class="np-field-label">生成参数</div>${items}</div>`);
    }

    if (data.raw && !data.positive && !data.negative && !(data.paramList && data.paramList.length)) {
        rows.push(`<div class="np-field-label">原始数据</div><textarea class="np-inspect-raw" readonly>${escapeHtml(data.raw)}</textarea>`);
    }

    box.innerHTML = rows.join('');

    // 组装可复制文本并启用复制按钮
    const copyParts = [];
    if (data.positive) copyParts.push(`正向提示词：\n${data.positive}`);
    if (data.negative) copyParts.push(`负向提示词：\n${data.negative}`);
    if (data.paramList && data.paramList.length) {
        copyParts.push('生成参数：\n' + data.paramList.map(p => `${p.key}: ${p.value}`).join('\n'));
    }
    const text = copyParts.join('\n\n');
    box.setAttribute('data-copy', text);
    const copyBtn = doc.getElementById('np-inspect-copy');
    if (copyBtn) copyBtn.disabled = !text;
}

function fieldBlock(label, text) {
    if (!text) return '';
    return `<div class="np-field-block">
        <div class="np-field-label">${escapeHtml(label)}</div>
        <textarea class="np-inspect-text" readonly>${escapeHtml(text)}</textarea>
    </div>`;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
}
