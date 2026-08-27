// 手机模式入口：取数 → 字段映射 → 按发送者分组会话 → 皮肤渲染 → 组装 srcdoc HTML → 调 IframeModal 打开。
// 详见 docs/PHONE_MODE_PLAN.md §五（srcdoc 同源，交互通过 postMessage 把编辑后的场景回传此处持久化）。
//
// 取数链路（2026-08-27 起）：直接走 runModulePipeline 拿目标模块的逐条数据（moduleData.data[].moduleData.variables），
// 再按 scene.fieldMap 映射出「消息四元组 {sender, content, time, type}」并分组为会话 ——
// **不再使用 buildStyledProcessResult/containerStyles 整块气泡方案**（containerStyles 链路已在该文件与
// phoneRenderer.js 注释中标注弃用，仅手机模式弃用，其他入口如上下文底部不受影响）。
//
// 配置与皮肤：
// - scene.skinId 引用 apps/ 注册表（见 apps/index.js），同一皮肤下多个 scene = 该 App 内多个会话。
// - 会话按「发送者」值分组（同 sender 一个会话），解决「同平台不同角色 / 同角色不同平台」。
import { IframeModal } from '../../shared/IframeModal.js';
import configManager from '../../singleton/configManager.js';
import { runModulePipeline } from '../../core/pipeline/runModulePipeline.js';
import { getUserAndCharNames } from '../../utils/variableReplacer.js';
import { getRegisteredSkins } from './apps/index.js';
import { buildPhoneHtml } from './phoneRenderer.js';
import { errorLog } from '../../utils/logger.js';

let phoneModal = null;
let currentExtensionPath = '';
let lastView = 'home';   // 退出时所在界面（'home' 或 skinId），重开时恢复到此 App 的会话列表

/**
 * 打开手机模式模态
 * @param {string} extensionPath 插件根目录路径（用于拼 css URL）
 */
export function openPhoneModeModal(extensionPath) {
    if (!configManager.isLoaded) return;
    // 门控在源头：isPhoneModeEnabled 已包含「插件总开关 + phone_config.enabled」双重判定，
    // 任一关闭即不可用（手机模式依赖模块功能）。
    if (!configManager.isPhoneModeEnabled()) return;
    currentExtensionPath = extensionPath;

    // 单实例 + 仅挂一次保存消息监听
    if (!phoneModal) {
        phoneModal = new IframeModal();
        window.addEventListener('message', handlePhoneMessage);
    }

    const html = renderPhoneHtml();
    if (!html) return;
    phoneModal.open(null, '手机模式', { srcdoc: html, variant: 'center', phone: true });
}

/**
 * 处理来自手机 iframe 的保存消息（齿轮设置保存）
 */
function handlePhoneMessage(event) {
    if (!event.data) return;
    // 界面切换上报：记录当前所在界面，重开手机模式时恢复
    if (event.data.type === 'PHONE_VIEW_CHANGED') {
        lastView = event.data.view || 'home';
        return;
    }
    if (event.data.type !== 'SAVE_PHONE_CONFIG') return;
    const scene = event.data.scene;

    const existing = configManager.getPhoneConfig();
    const scenes = Array.isArray(existing.scenes) ? existing.scenes.slice() : [];
    // 按 moduleName 匹配更新对应场景；未匹配则新增（一个模块一个 scene，保留原 fieldMap 等字段，仅合并设置项）
    const idx = scenes.findIndex((s) => s.moduleName === scene.moduleName);
    if (idx >= 0) scenes[idx] = { ...scenes[idx], ...scene };
    else scenes.push(scene);
    const newConfig = { ...existing, scenes };

    // 直接落盘（不依赖 setPhoneConfig 内部的 guard/调度，杜绝静默不保存）
    // 无条件赋值内存最新值：等不到 isPhoneConfigLoaded 就等，避免 load 覆盖丢失 fieldMap
    configManager.phoneConfig = newConfig;
    try {
        configManager.setPhoneConfig(newConfig);
    } catch (e) {
        errorLog('[手机] setPhoneConfig 失败:', e);
    }
    const ok = configManager.savePhoneConfigNow();

    // 回执给手机 iframe（保存确认 + 字段摘要）
    try {
        const iframe = phoneModal?.backdrop?.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
                type: 'PHONE_CONFIG_SAVED',
                ok: Boolean(ok),
                fieldMapSample: (configManager.getPhoneConfig().scenes || []).map((s) => ({
                    moduleName: s.moduleName,
                    fieldMap: s.fieldMap || {},
                })),
            }, '*');
        }
    } catch (e) { /* 回执失败不阻断保存 */ }

    // 保存后同实例重渲染
    const html = renderPhoneHtml();
    if (html && phoneModal) phoneModal.setSrcdoc(html);
}

/**
 * 按 fieldMap 取目标条目的字段值。
 * 映射表字段格式：{ source: 'variable', variable: '变量名' }；source 缺失/raw 时回退到同名变量兜底。
 * @param {Object} fm fieldMap
 * @param {Object} vars 目标条目 variables（变量名 → 值）
 * @param {string} field 界面语义字段（sender/content/time/type）
 * @returns {string}
 */
function resolveField(fm, vars, field) {
    const m = fm && fm[field];
    const varName = m && m.source === 'variable' && m.variable ? m.variable : null;
    const candidates = varName ? [varName, field] : [field];
    for (const name of candidates) {
        if (vars[name] !== undefined && vars[name] !== null && vars[name] !== '') {
            return String(vars[name]);
        }
    }
    return '';
}

/**
 * 名字解析工具：处理「线上id(真实姓名)」格式。
 * 保险策略（同 containerStyles 的 extractNames）：完整串 + 括号外(id) + 括号内(真实姓名)
 * 都作为变体参与匹配，只要双方变体集合有交集即视为同一人。
 */

/**
 * 提取名字变体集合（小写，去除空白字符——id 与括号间、字母与空白混排等写法都统一）
 * 变体：完整串 / 括号外(id) / 括号内(真实姓名)，均去除空白后参与匹配；
 * 显示名不受影响（extractDisplayName 保留原文格式）。
 * @param {string} value
 * @returns {Array<string>}
 */
function extractNameVariants(value) {
    const variants = [];
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return variants;
    // 去除所有空白：完整串变体（'Z (郑重)'→'z(郑重)'）、括号外 id、括号内真名一致归一
    const compact = raw.toLowerCase().replace(/\s+/g, '');
    variants.push(compact);
    const m = compact.match(/^([^\(（]+)[\(（]([^\)）]+)[\)）]$/);
    if (m) {
        variants.push(m[1]);
        variants.push(m[2]);
    }
    return variants;
}

/**
 * 标准化身份：返回「用于 key 的简化 id」+「用于显示（线上id(真实姓名)）」
 * @param {string} value
 * @returns {{ id: string, display: string }}
 */
function normalizeName(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return { id: '', display: '' };
    const m = raw.match(/^([^\(（]+)[\(（]([^\)）]+)[\)）]$/);
    if (m) {
        const idRaw = m[1].trim();
        const real = m[2].trim();
        return {
            id: idRaw.toLowerCase(),
            display: `${idRaw}(${real})`,
        };
    }
    // 无括号：id 和显示都是原值
    return { id: raw.toLowerCase(), display: raw };
}

/**
 * 提取显示名：保留原值格式「线上id(真实姓名)」（线上id 优先可见）
 * @param {string} value
 * @returns {string}
 */
function extractDisplayName(value) {
    return String(value == null ? '' : value).trim();
}

/**
 * 双方是否同一人（变体集合求交集）
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function isSamePerson(a, b) {
    const va = extractNameVariants(a);
    const vb = extractNameVariants(b);
    return va.some((n) => vb.includes(n));
}

/**
 * 把模块数据条目映射为消息（扁平数组）。
 * @param {Object} scene { moduleName, fieldMap }
 * @param {Object} moduleData runModulePipeline 返回的 content[moduleName]
 * @param {string} userName 当前用户名字（isMine 判断，容器名解析：id/真实姓名任一匹配即可）
 * @returns {Array} [{ plat, from, content, time, type, dm, grp, mems, isMine }]
 */
function buildMessages(scene, moduleData, userName) {
    const fm = scene.fieldMap || {};
    const entries = (moduleData && moduleData.data) || [];
    const msgs = [];

    for (const entry of entries) {
        const vars = (entry && entry.moduleData && entry.moduleData.variables) || {};
        const from = resolveField(fm, vars, 'sender');
        const msg = {
            plat: resolveField(fm, vars, 'plat'),
            from,
            content: resolveField(fm, vars, 'content'),
            time: resolveField(fm, vars, 'time'),
            type: resolveField(fm, vars, 'type') || 'text',
            dm: resolveField(fm, vars, 'dm'),
            grp: resolveField(fm, vars, 'grp'),
            mems: resolveField(fm, vars, 'mems'),
        };
        // 空内容楼层不渲染（与存储 skipEmpty 策略一致）
        if (!msg.content) continue;
        // isMine：sender 与用户名的「id/真实姓名」任一变体匹配即视为本人
        msg.isMine = isSamePerson(from, userName);
        msgs.push(msg);
    }
    return msgs;
}

/** 平台值 → 皮肤 id 的别名（skin.id 精确匹配优先；未匹配/空值走 generic） */
const PLATFORM_ALIASES = {
    wechat: ['微信', 'weixin', 'wx'],
    qq: ['企鹅', 'qq聊天'],
    line: ['連我', 'line聊天'],
    sms: ['短信', 'iMessage', 'imessage', 'message', 'messages'],
};

/**
 * 按消息 platform 值路由到 App 皮肤 id（数据驱动：消息进哪个 App 由映射字段决定，不由配置选择）
 * @param {string} platform 映射后的平台值（如 wechat / 微信 / qq…）
 * @param {Array} skins 已注册皮肤
 * @returns {string} 皮肤 id（未匹配归 generic）
 */
function routePlatform(platform, skins) {
    const raw = String(platform || '').trim().toLowerCase();
    if (!raw) return 'generic';
    // 解析结果必须是「已注册皮肤」，否则回退 generic（别名指向的皮肤未注册时兜底，防崩溃）
    let id = '';
    if (skins.some((s) => s.id === raw)) id = raw;
    if (!id) {
        for (const [aliasId, aliases] of Object.entries(PLATFORM_ALIASES)) {
            if (aliases.includes(raw) || aliases.includes(platform)) { id = aliasId; break; }
        }
    }
    return id && skins.some((s) => s.id === id) ? id : 'generic';
}

/** 无序对 key：私聊双方组合（A↔B 与 B↔A 视为同一会话）。入参为已标准化的 id（小写） */
function pairKey(a, b) {
    const x = String(a == null ? '' : a);
    const y = String(b == null ? '' : b);
    return x <= y ? x + '\u0001' + y : y + '\u0001' + x;
}

/**
 * 跨消息统一「同一人的不同写法 → 同一会话 key」：
 * 收集消息中所有名字（sender/dm/mems/grp）做并查集归并——名字变体（完整串/括号外 id/括号内真名）
 * 有交集即视为同一人。同时把 userName（ST 用户真名）注册进并查集作为锚点：
 * 只要历史消息中出现过「线上id(真名)」形式，变体即可桥接，后续纯 id 消息也能识别 user。
 * 根变体 → 该人所有写法中「最长」的（保留「线上id(真实姓名)」全格式）作为规范写法。
 * 返回 { resolve(lower) } 解析任意名字为规范写法。
 * @param {Array} messages
 * @param {string} userName 当前用户真名（锚点：用于把纯 id 桥接为 user）
 * @returns {{ resolve: (name: string) => string }}
 */
function buildNameCanonicalMap(messages, userName) {
    const parent = new Map();               // 变体(小写) → 根变体(小写)
    const owner = new Map();                // 变体(小写) → 该变体最早的名字
    const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
    const union = (a, b) => {
        const ra = find(a), rb = find(b);
        if (ra === rb) return;
        // 让「拥有更长 owner」的一方当根，保证规范写法是最长的那个（含线上id(真实姓名)）
        const la = (owner.get(ra) || ra).length;
        const lb = (owner.get(rb) || rb).length;
        if (lb > la) parent.set(ra, rb);
        else parent.set(rb, ra);
    };

    const register = (name) => {
        const raw = String(name == null ? '' : name).trim();
        if (!raw) return;
        const variants = extractNameVariants(raw);
        for (const v of variants) if (!parent.has(v)) { parent.set(v, v); owner.set(v, raw); }
        // 该名字的所有变体并入同一人
        const root = find(variants[0]);
        for (let i = 1; i < variants.length; i++) union(root, find(variants[i]));
    };

    // 先注册全部消息名
    for (const m of messages) {
        register(m.from);
        register(m.dm);
        register(m.grp);
        if (m.mems) for (const mm of String(m.mems).split(/[,，、]/)) register(mm);
    }

    // 判定 userName 是否被消息提及（变体交集）：有 mention 才启用 user 桥接判定，
    // 否则消息里纯 id 无法可靠断言谁是 user，避免误把任意名字判成 user
    const userVariants = extractNameVariants(userName);
    let userMentioned = false;
    for (const [variant] of parent) {
        const vSet = new Set(extractNameVariants(variant));
        if (userVariants.some((u) => vSet.has(u))) { userMentioned = true; break; }
    }
    // 若被提及：把 userName 并进对应的根（该根即 user 身份的锚点）
    if (userMentioned) register(userName);

    // 根变体 → 该人所有写法中「最长」（保留「线上id(真实姓名)」全格式）作为规范写法
    const rootName = new Map();
    for (const [variant] of parent) {
        const root = find(variant);
        const cand = owner.get(variant) || variant;
        const cur = rootName.get(root);
        if (!cur || cand.length > cur.length) rootName.set(root, cand);
    }

    // 独立 resolve 函数（对象方法 isUser 也复用；对象字面量内同名方法名不会遮蔽外层变量，
    // 直接引用函数即可，避免与方法名解析混乱）
    const resolveName = (lower) => {
        if (!lower) return '';
        const lowerStr = String(lower).toLowerCase();
        for (const v of extractNameVariants(lowerStr)) {
            let node = v;
            const seen = new Set();
            while (parent.has(node) && !seen.has(node)) {
                seen.add(node);
                if (parent.get(node) === node) break;
                node = parent.get(node);
            }
            if (seen.has(node) && parent.get(node) === node) return rootName.get(node) || lowerStr;
        }
        return lowerStr;
    };

    return {
        /** userName 是否被消息提及（决定是否可做 user 判定） */
        userMentioned,
        /** 解析名字为规范写法（同一人多写法 → 同一根 → 同一规范写法） */
        resolve: resolveName,
        /**
         * 判断名字是否指向 user：
         * - 变体直接交集（id/真名命中）始终有效；
         * - 消息未提及 userName 时不做桥接判定（避免误判）。
         */
        isUser(name) {
            if (!name) return false;
            if (isSamePerson(name, userName)) return true;
            if (!userMentioned) return false;
            // 桥接判定：与 userName 归一后落在同一根
            return resolveName(name) === resolveName(userName) && resolveName(name) !== '';
        },
    };
}

/**
 * 按「对方」分组会话（true IM 语义）：
 * 优先级：私聊(dm 有值) > 群聊(grp 有值) > 兜底(sender)：
 *   - dm 有值 = 私聊 → 会话 = (sender, dm) 的「双方组合」，无序对同一会话（A发B收 与 B发A收 同窗）
 *   - grp 有值 = 群聊 → 归为「群组名」会话（成员从 mems/sender/dm 收集）
 *   - 都没有 → 以非我的 sender 兜底
 * 用户判定：优先规范 id 对比（经 buildNameCanonicalMap 桥接，纯 id 也能识别 user），
 * 会话标题：user 与别人 → 只显示对方（保留「线上id(真实姓名)」格式）
 * 同一人的不同写法（周宙 / Z(周宙)）经 buildNameCanonicalMap 归一到同一组 key；
 * 无任何归属信息（sender/dm/grp 为空，多为未配置映射）→ 兜底「未分类」，消息不丢。
 * @param {Array} messages
 * @param {string} userName 当前用户名字（过滤 user 会话 / 判定方向）
 * @returns {Array} [{ key, title, members, preview, messages }]
 */
function groupMessagesToConversations(messages, userName) {
    const { resolve, isUser, userMentioned } = buildNameCanonicalMap(messages, userName);
    // userName 的规范 id（仅当消息提及过 user 时才可作对比锚点；未提及则纯 id 无法可靠断言）
    const userC = userMentioned ? resolve(userName) : '';
    const map = new Map();
    for (const m of messages) {
        const from = m.from || '';
        const dm = m.dm || '';
        const grp = m.grp || '';
        // 用规范写法做 key + 标题（同一人多写法 → 同一根 → 同一规范写法）
        const fromC = resolve(from) || from;
        const dmC = resolve(dm) || dm;
        const fromIsUser = !!fromC && !!userC && (fromC === userC || isUser(from));
        const dmIsUser = !!dmC && !!userC && (dmC === userC || isUser(dm));
        let key;
        let title;
        if (dm) {
            // 私聊：会话 = (sender, dm) 双方组合，无序对同一会话
            key = 'dm:' + pairKey(fromC, dmC);
            if (fromIsUser && dmIsUser) continue;           // 自己和自己
            if (fromIsUser) {
                title = extractDisplayName(dmC);             // 我发 → 对方=接收方
            } else if (dmIsUser) {
                title = extractDisplayName(fromC);           // 对方发 → 对方=发送者
            } else {
                title = (extractDisplayName(fromC) || '?') + ' · ' + (extractDisplayName(dmC) || '?');
            }
        } else if (grp) {
            // 群聊：归为群组会话
            key = 'grp:' + grp;
            title = grp;
        } else if (from && !fromIsUser) {
            // 无类型标签：以非我发送者兜底
            key = 'dm:' + pairKey(fromC, '');
            title = extractDisplayName(fromC);
        } else {
            // 无任何归属信息（sender/dm/grp 均取不到，多为未配置映射）：兜底到「未分类」，
            // 保证消息不丢（含 user 自己发出的）；字段映射配置后这类消息会自然消失
            key = 'unassigned';
            title = '未分类';
        }
        if (!title) continue;

        if (!map.has(key)) map.set(key, { key, title, members: [], messages: [] });
        const conv = map.get(key);
        // 成员：mems 字段 + 私聊双方（sender/dm，供皮肤展示；同一人多写法按规范写法去重）
        const collect = [];
        if (m.mems) collect.push(...String(m.mems).split(/[,，、]/));
        if (from && !fromIsUser) collect.push(from);
        if (dm && !dmIsUser) collect.push(dm);
        collect.map((x) => String(x).trim()).filter(Boolean).forEach((mm) => {
            const rc = resolve(mm) || mm;
            if (!conv.members.includes(rc)) conv.members.push(rc);
        });
        conv.messages.push(m);
    }

    const out = [];
    for (const conv of map.values()) {
        const last = conv.messages[conv.messages.length - 1];
        conv.preview = last ? last.content : '';
        out.push(conv);
    }
    return out;
}

/**
 * 构建手机视图 HTML（桌面 App 图标 + 数据驱动路由 + 设置面板数据）
 * 路由：每个 scene 的模块数据 → 映射出消息（含 plat）→ 按 plat 值分发进各 App 皮肤，
 * 桌面固定显示全部已注册皮肤（真手机形态），无消息的 App 显示空态。
 * @returns {string|null}
 */
function renderPhoneHtml() {
    const phoneConfig = configManager.getPhoneConfig();
    const scenes = (Array.isArray(phoneConfig.scenes) ? phoneConfig.scenes : [])
        .filter((s) => s && s.enabled !== false && s.moduleName);
    // 所有模块（含未启用）用于设置下拉；variables（含 displayName）供字段映射下拉
    const allModules = configManager.getModules(true);
    const modules = allModules.map((m) => ({
        name: m.name,
        displayName: m.displayName || m.name,
        variables: Array.isArray(m.variables)
            ? m.variables.map((v) => ({ name: v.name, displayName: v.displayName || v.name }))
            : [],
    }));
    const { userName } = getUserAndCharNames();

    const skins = getRegisteredSkins();

    // 1) 解析所有 scene 的消息，按 platform 值分发到各 App
    const messagesBySkin = new Map(skins.map((s) => [s.id, []]));
    for (const scene of scenes) {
        if (!configManager.getModuleByName(scene.moduleName)) continue;
        let processResult = null;
        try {
            processResult = runModulePipeline({
                range: { start: 0, end: null },
                modules: [{ name: scene.moduleName }],
                processType: 'auto',
                selectedModuleNames: [scene.moduleName],
            });
        } catch (e) {
            errorLog(`[手机] 模块「${scene.moduleName}」取数失败:`, e);
            continue;
        }
        const moduleData = processResult?.content?.[scene.moduleName];
        if (!moduleData) continue;
        for (const msg of buildMessages(scene, moduleData, userName)) {
            const key = routePlatform(msg.plat, skins);
            messagesBySkin.get(key).push(msg);
        }
    }

    // 2) 桌面固定渲染全部皮肤；每个 App 内把分发的消息分组为会话
    const cssUrls = [`${currentExtensionPath}/src/features/phone/styles/phone.css`];
    const apps = [];
    for (const skin of skins) {
        cssUrls.push(`${currentExtensionPath}/${skin.cssPath}`);
        // 基于全部消息的规范身份解析，补齐纯 id 消息的 isMine（气泡方向）
        const skinMessages = messagesBySkin.get(skin.id) || [];
        const { isUser } = buildNameCanonicalMap(skinMessages, userName);
        for (const msg of skinMessages) msg.isMine = isUser(msg.from);
        const conversations = groupMessagesToConversations(skinMessages, userName);
        const { list, chats } = skin.renderAppHtml(conversations);
        const appHtml = `<div class="phone-conv-list-host">${list}</div><div class="phone-chat-views">${chats}</div>`;
        apps.push({ key: skin.id, label: skin.label, iconKey: skin.iconKey || 'generic', iconBg: skin.iconBg || '#4f8cff', html: appHtml });
    }

    // 设置面板数据：场景（模块 + 字段映射）+ 模块列表
    const settings = {
        scenes: scenes.map((s) => ({
            moduleName: s.moduleName || '',
            enabled: s.enabled !== false,
            fieldMap: s.fieldMap || {},
        })),
        modules,
    };

    return buildPhoneHtml({ cssUrls, apps, settings, initView: lastView });
}