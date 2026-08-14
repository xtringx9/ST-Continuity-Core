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
 * - 失联处理：若 yushe[name] 不存在（智绘姬侧改名/删除），tags 仍可用，需提供「重新关联」功能（待做）。
 */
export const NAI_PRESET_TEMPLATE = {
    version: NAI_PRESET_CONSTANTS.version,
    lastUpdated: new Date().toISOString(),

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
            sortOrder: {
                type: 'number',
                default: 0,
                description: '排序权重（视图层排序态，暂留）'
            },
        }
    ]
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
    presets: []
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
        presets: [],
    };

    if (Array.isArray(config.presets)) {
        normalized.presets = config.presets.map((p, index) => ({
            id: p.id || `np_${now}_${index}`,
            name: p.name || '',
            tags: Array.isArray(p.tags) ? p.tags.map(t => String(t).trim()).filter(Boolean) : [],
            createdAt: typeof p.createdAt === 'number' ? p.createdAt : now,
            updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : now,
            sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : index,
        }));
    }

    return normalized;
}

/**
 * 创建新的空 NAI 预设配置
 * @returns {Object} 新的空配置对象
 */
export function createEmptyNaiPresetConfig() {
    return { ...DEFAULT_NAI_PRESET_CONFIG };
}
