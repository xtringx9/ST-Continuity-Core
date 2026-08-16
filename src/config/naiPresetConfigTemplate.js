// 智绘姬NAI预设切换配置模板 - 定义 NAI 提示词预设的 JSON 配置结构
// 走与 moduleConfigTemplate / generatorConfigTemplate 一致的范式：
// TEMPLATE + DEFAULT + validate + normalize + metadata，落盘经 configManager.setNaiPresets()。
export const NAI_PRESET_CONSTANTS = {
    version: '1.0.0',
};

/**
 * NAI 预设配置模板对象
 *
 * 设计原则（2026-08-14 与用户敲定）：
 * - 本插件是「智绘姬预设管理器」的优化版，只管【标签 + 与智绘姬的关联锚点】。
 * - 提示词（positive/negative）不在此存储 —— 实时读写智绘姬
 *   extension_settings["st-chatu8"].yushe[name]（{fixedPrompt, fixedPrompt_end, negativePrompt}）。
 * - 预览图不在此存储 —— 实时读智绘姬 yushe[name].previewImageId（经 saveConfigImage/getConfigImage，
 *   存于 st-chatu8 的 configImageStorage），两边共享同一张图。
 * - 因此 preset 只需：name（= 智绘姬 yushe key，可变）+ tags（自建多标签）+ 时间戳/排序占位。
 * - 标签是一等概念（独立 tags 库，2026-08-15 方案 A）：可无关联预设独立存在，
 *   预设的 preset.tags 只引用 tags 库里的 name。新增/改名/删除标签须同时维护 tags 库与预设引用。
 * - 失联处理：若 yushe[name] 不存在（智绘姬侧改名/删除），tags 仍可用，需提供「重新关联」功能（待做）。
 */
export const NAI_PRESET_TEMPLATE = {
    version: NAI_PRESET_CONSTANTS.version,
    lastUpdated: new Date().toISOString(),

    // 独立标签库：可脱离预设存在，preset.tags 仅引用这里的 name
    tags: [
        {
            name: {
                type: 'string',
                required: true,
                description: '标签名（唯一，preset.tags 的引用锚点）'
            },
            createdAt: {
                type: 'number',
                default: 0,
                description: '创建时间（ms 时间戳）'
            },
        }
    ],

    // 预设数组
    presets: [
        {
            id: {
                type: 'string',
                required: true,
                description: '内部唯一标识符（防 name 改动后失联）'
            },
            name: {
                type: 'string',
                required: true,
                description: '预设名称，= 智绘姬 yushe 的 key（关联锚点，可变）'
            },
            tags: {
                type: 'array',
                default: [],
                description: '标签数组（自建多标签体系，可编辑）'
            },
            createdAt: {
                type: 'number',
                default: 0,
                description: '创建时间（ms 时间戳）'
            },
            updatedAt: {
                type: 'number',
                default: 0,
                description: '更新时间（ms 时间戳）'
            },
            favorite: {
                type: 'boolean',
                default: false,
                description: '是否收藏（红心），可独立筛选'
            },
            sortOrder: {
                type: 'number',
                default: 0,
                description: '排序权重（视图层排序态，暂留）'
            },
        }
    ],

    // 图片收藏（2026-08-15 用户拍板：独立于预设 tags，复用同一顶层键）
    // 只收藏图片（点红心即时收藏，不弹标签窗）；标签在「图片收藏」tab 内管理。
    // items 的 key = 图片唯一标识（chat:<uuid|path> / character:<configId> / outfit:<configId>）。
    // 图片被删后对应收藏项自动清除（失效自愈）。
    // 聊天扫描（2026-08-16 用户拍板：按角色→聊天 双层索引，聊天外可见）
    // 扫描各聊天正文，确定「提示词 ↔ 楼层」对应关系，供文生图按 角色→聊天→楼层→提示词 分组。
    // 结构：{ characters: { [characterName]: { chats: { [chatId]: { name, scannedAt, map:[{storageKey, floors:[数字]}] } } } } }
    //  - characters 以角色名为 key（天然顶层：单角色多聊天），角色名只出现一次，map 内不再重复记。
    //  - chats 按 chatId（聊天文件名无扩展名）索引，每个聊天一份，多聊天互不覆盖。
    //  - map[].storageKey = jiuguanStorage 的 md5 key（定位图）；不存提示词原文（体积，靠 md5 反查 change）。
    //  - map[].floors = 消息索引数字数组。
    chatScan: {
        characters: [
            {
                characterName: {
                    type: 'string',
                    required: true,
                    description: '角色名（顶层 key）'
                },
                chats: [
                    {
                        chatId: {
                            type: 'string',
                            required: true,
                            description: '聊天标识（= 文件名无扩展名，context.chatId）'
                        },
                        name: {
                            type: 'string',
                            default: '',
                            description: '聊天名（chat_metadata.title 优先，否则 chatId）'
                        },
                        scannedAt: {
                            type: 'number',
                            default: 0,
                            description: '扫描时间（ms 时间戳）'
                        },
                        map: [
                            {
                                storageKey: {
                                    type: 'string',
                                    default: '',
                                    description: 'jiuguanStorage 的 md5 key（关联图）'
                                },
                                floors: {
                                    type: 'array',
                                    default: [],
                                    description: '消息索引数字数组（楼层）'
                                },
                            }
                        ],
                    }
                ],
            }
        ],
    },

    imageFavorites: {
        tags: [
            {
                name: {
                    type: 'string',
                    required: true,
                    description: '图片收藏专属标签名（唯一，与预设 tags 库不混用）'
                },
                createdAt: {
                    type: 'number',
                    default: 0,
                    description: '创建时间（ms 时间戳）'
                },
            }
        ],
        items: [
            {
                key: {
                    type: 'string',
                    required: true,
                    description: '图片唯一标识（chat:<uuid|path> / character:<configId> / outfit:<configId>）'
                },
                cat: {
                    type: 'string',
                    required: true,
                    description: '来源分类：chat | character | outfit'
                },
                path: {
                    type: 'string',
                    default: '',
                    description: '服务端文件路径（渲染/失效检查用）'
                },
                hash: {
                    type: 'string',
                    default: '',
                    description: '内容指纹（双向图两记录 hash 相同，收藏 tab 按此去重合并显示）'
                },
                tags: {
                    type: 'array',
                    default: [],
                    description: '图片收藏专属标签数组'
                },
                createdAt: {
                    type: 'number',
                    default: 0,
                    description: '收藏时间（ms 时间戳）'
                },
                updatedAt: {
                    type: 'number',
                    default: 0,
                    description: '更新时间（ms 时间戳）'
                },
            }
        ]
    }
};

/**
 * 默认 NAI 预设配置值
 */
export const DEFAULT_NAI_PRESET_CONFIG = {
    enabled: false, // 功能开关（与数据同处 nai_preset_config 顶层键）
    // 文生图工作台启动器：在发送栏（大Cc/魔棒右侧）独立按钮，点击打开智绘姬设置面板，
    // 并轮询 #st-chatu8-fab.dataset.isLoading 实时反馈生图请求状态。
    chatu8Launcher: {
        enabled: false,
    },
    metadata: {
        version: NAI_PRESET_CONSTANTS.version,
        lastUpdated: new Date().toISOString(),
        source: "ST-Continuity-Core",
    },
    tags: [],
    presets: [],
    chatScan: {
        characters: {},
    },
    imageFavorites: {
        tags: [],
        items: [],
    }
};

/**
 * 归一化 chatu8Launcher 子配置，缺失字段补默认值。
 * @param {Object} config
 * @returns {{enabled: boolean}}
 */
export function normalizeChatu8Launcher(config) {
    const src = config && typeof config === 'object' ? config : {};
    return {
        enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_NAI_PRESET_CONFIG.chatu8Launcher.enabled,
    };
}

/**
 * 归一化聊天扫描配置。
 * 最新格式（2026-08-16 拍板：角色天然顶层）：{ characters: { [characterName]: { chats: { [chatId]: { name, scannedAt, map:[{storageKey, floors:[数字]}] } } } } }
 * 兼容中间格式：{ chats: [{ chatId, name, scannedAt, map:[{storageKey, characterName, floors}] }] } → 按 characterName 归入 characters。
 * 兼容最旧格式：{ chatId, scannedAt, map:[{tag, storageKey, floors:[{floor, characterName}]}] } → 迁移。
 * @param {Object} chatScan
 * @returns {{characters: Object}}
 */
export function normalizeChatScan(chatScan) {
    const src = chatScan && typeof chatScan === 'object' ? chatScan : {};
    const now = Date.now();
    const characters = {}; // characterName -> { chats: { chatId -> {name, scannedAt, map} } }

    const putChat = (characterName, chatId, name, scannedAt, map) => {
        if (!characterName || !chatId) return;
        if (!characters[characterName]) characters[characterName] = { chats: {} };
        characters[characterName].chats[chatId] = {
            name: String(name || ''),
            scannedAt: typeof scannedAt === 'number' ? scannedAt : now,
            map,
        };
    };

    // 最旧格式（单聊天，含 {floor, characterName} 嵌套）：{ chatId, scannedAt, map }
    const isOldestFormat = !Array.isArray(src.chats) && !src.characters && (src.chatId || Array.isArray(src.map));
    if (isOldestFormat) {
        const oldMap = Array.isArray(src.map) ? src.map : [];
        const byChar = new Map(); // characterName -> map 数组
        oldMap.forEach(m => {
            if (!m || (!m.tag && !m.storageKey)) return;
            const characterName = String((Array.isArray(m.floors) && m.floors[0] && m.floors[0].characterName) || '未知角色');
            if (!byChar.has(characterName)) byChar.set(characterName, []);
            byChar.get(characterName).push({
                storageKey: String(m.storageKey || ''),
                floors: Array.isArray(m.floors)
                    ? m.floors.filter(f => f && typeof f.floor === 'number').map(f => f.floor)
                    : [],
            });
        });
        if (String(src.chatId || '')) {
            for (const [characterName, map] of byChar) {
                putChat(characterName, String(src.chatId), String(src.name || ''), src.scannedAt, map);
            }
        }
    }
    // 中间格式（chats 数组，map 含 characterName）
    else if (Array.isArray(src.chats)) {
        src.chats.forEach(c => {
            if (!c || !c.chatId) return;
            const byChar = new Map();
            (Array.isArray(c.map) ? c.map : []).forEach(m => {
                if (!m || !m.storageKey) return;
                const characterName = String(m.characterName || '未知角色');
                if (!byChar.has(characterName)) byChar.set(characterName, []);
                byChar.get(characterName).push({
                    storageKey: String(m.storageKey),
                    floors: Array.isArray(m.floors) ? m.floors.filter(f => typeof f === 'number').map(f => f) : [],
                });
            });
            for (const [characterName, map] of byChar) {
                putChat(characterName, String(c.chatId), String(c.name || ''), c.scannedAt, map);
            }
        });
    }
    // 最新格式（characters 对象）
    else if (src.characters && typeof src.characters === 'object') {
        for (const characterName in src.characters) {
            const charEntry = src.characters[characterName];
            if (!charEntry || typeof charEntry !== 'object') continue;
            const chatsObj = (charEntry.chats && typeof charEntry.chats === 'object') ? charEntry.chats : {};
            for (const chatId in chatsObj) {
                const c = chatsObj[chatId];
                if (!c || typeof c !== 'object') continue;
                const map = Array.isArray(c.map) ? c.map
                    .filter(m => m && m.storageKey)
                    .map(m => ({
                        storageKey: String(m.storageKey),
                        floors: Array.isArray(m.floors) ? m.floors.filter(f => typeof f === 'number').map(f => f) : [],
                    })) : [];
                putChat(characterName, chatId, c.name, c.scannedAt, map);
            }
        }
    }

    return { characters };
}

/**
 * 验证 NAI 预设配置
 * @param {Object} config 要验证的配置对象
 * @returns {Object} 验证结果 { isValid: boolean, errors: Array, warnings: Array }
 */
export function validateNaiPresetConfig(config) {
    const errors = [];
    const warnings = [];

    if (!config) {
        errors.push('配置对象为空');
        return { isValid: false, errors, warnings };
    }

    if (!config.presets || !Array.isArray(config.presets)) {
        errors.push('配置缺少presets数组或presets不是数组');
        return { isValid: false, errors, warnings };
    }

    // 检查 name 唯一性
    const names = new Set();
    config.presets.forEach((p, index) => {
        const prefix = `预设${index + 1}`;

        if (!p.name) {
            errors.push(`${prefix}: 缺少name字段`);
        } else if (names.has(p.name)) {
            errors.push(`${prefix}: name "${p.name}" 重复`);
        } else {
            names.add(p.name);
        }
    });

    return { isValid: errors.length === 0, errors, warnings };
}

/**
 * 规范化 NAI 预设配置，填充缺失的默认值
 * @param {Object} config 要规范化的配置对象
 * @returns {Object} 规范化后的配置
 */
export function normalizeNaiPresetConfig(config) {
    if (!config) {
        return { ...DEFAULT_NAI_PRESET_CONFIG };
    }

    const now = Date.now();
    const normalized = {
        enabled: typeof config.enabled === 'boolean' ? config.enabled : DEFAULT_NAI_PRESET_CONFIG.enabled,
        chatu8Launcher: normalizeChatu8Launcher(config.chatu8Launcher),
        metadata: {
            version: DEFAULT_NAI_PRESET_CONFIG.metadata.version,
            lastUpdated: config.metadata?.lastUpdated || new Date().toISOString(),
            source: config.metadata?.source || DEFAULT_NAI_PRESET_CONFIG.metadata.source
        },
        tags: [],
        presets: [],
        chatScan: normalizeChatScan(config.chatScan),
        imageFavorites: {
            tags: [],
            items: [],
        },
    };

    if (Array.isArray(config.presets)) {
        normalized.presets = config.presets.map((p, index) => ({
            id: p.id || `np_${now}_${index}`,
            name: p.name || '',
            tags: Array.isArray(p.tags) ? p.tags.map(t => String(t).trim()).filter(Boolean) : [],
            createdAt: typeof p.createdAt === 'number' ? p.createdAt : now,
            updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : now,
            favorite: typeof p.favorite === 'boolean' ? p.favorite : false,
            sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : index,
        }));
    }

    // 图片收藏：归一化（独立于预设 tags 库）
    const favSrc = (config.imageFavorites && typeof config.imageFavorites === 'object') ? config.imageFavorites : {};
    const favItems = Array.isArray(favSrc.items) ? favSrc.items : [];
    const normalizedFavItems = favItems
        .filter(f => f && f.key)
        .map(f => ({
            key: String(f.key),
            cat: ['chat', 'character', 'outfit'].includes(f.cat) ? f.cat : 'chat',
            path: String(f.path || ''),
            hash: String(f.hash || ''), // 内容指纹（双向图两记录同 hash，收藏 tab 去重用）
            tags: Array.isArray(f.tags) ? f.tags.map(t => String(t).trim()).filter(Boolean) : [],
            createdAt: typeof f.createdAt === 'number' ? f.createdAt : now,
            updatedAt: typeof f.updatedAt === 'number' ? f.updatedAt : now,
        }));
    // 去重（key 唯一）
    const seenKeys = new Set();
    normalizedFavItems.filter(f => !seenKeys.has(f.key) && seenKeys.add(f.key));
    // 图片收藏专属标签库
    const favTagSet = new Map();
    const favTagsSrc = Array.isArray(favSrc.tags) ? favSrc.tags : [];
    favTagsSrc.forEach(t => {
        const name = t && typeof t === 'object' ? String(t.name || '').trim() : String(t || '').trim();
        if (!name) return;
        favTagSet.set(name, {
            name,
            createdAt: (t && typeof t === 'object' && typeof t.createdAt === 'number') ? t.createdAt : now,
        });
    });
    // 反推补全：收藏项里引用但库没有的标签
    normalizedFavItems.forEach(f => {
        (f.tags || []).forEach(tag => {
            if (!favTagSet.has(tag)) favTagSet.set(tag, { name: tag, createdAt: now });
        });
    });
    normalized.imageFavorites = {
        tags: Array.from(favTagSet.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh')),
        items: normalizedFavItems,
    };

    // 独立标签库：优先用显式 tags，否则从预设引用反推补全（兼容旧数据仅含 preset.tags 的情况）
    const tagSet = new Map();
    if (Array.isArray(config.tags)) {
        config.tags.forEach((t, i) => {
            const name = t && typeof t === 'object' ? String(t.name || '').trim() : String(t || '').trim();
            if (!name) return;
            tagSet.set(name, {
                name,
                createdAt: (t && typeof t === 'object' && typeof t.createdAt === 'number') ? t.createdAt : now,
            });
        });
    }
    // 反推补全：预设里引用了但 tags 库没有的标签，自动纳入（时间戳取该标签最早出现的预设 updatedAt）
    normalized.presets.forEach(p => {
        (p.tags || []).forEach(tag => {
            if (!tagSet.has(tag)) tagSet.set(tag, { name: tag, createdAt: p.createdAt || now });
        });
    });
    normalized.tags = Array.from(tagSet.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh'));

    return normalized;
}

/**
 * 创建新的空 NAI 预设配置
 * @returns {Object} 新的空配置对象
 */
export function createEmptyNaiPresetConfig() {
    return { ...DEFAULT_NAI_PRESET_CONFIG };
}
