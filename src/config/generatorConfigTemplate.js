// 生成内容配置模板 - 定义生成内容（小剧场、角色心理等）的JSON配置结构
// 独立于 module_config，存储在 extension_settings[extensionName]['generator_config']
export const GENERATOR_CONFIG_CONSTANTS = {
    version: '1.0.0',
};

/**
 * 生成内容配置模板对象
 * 定义了生成内容配置的完整结构
 */
export const GENERATOR_CONFIG_TEMPLATE = {
    version: GENERATOR_CONFIG_CONSTANTS.version,
    lastUpdated: new Date().toISOString(),

    // 生成内容配置数组
    generators: [
        {
            id: {
                type: 'number',
                required: true,
                description: '排序用数字,可变'
            },
            name: {
                type: 'string',
                required: true,
                description: '唯一标识(英文),= 存储 key'
            },
            displayName: {
                type: 'string',
                required: true,
                description: '显示名称'
            },
            enabled: {
                type: 'boolean',
                default: true,
                description: '是否启用'
            },
            prompts: {
                type: 'array',
                default: [],
                description: '提示词数组(支持多情况),每项 { label, content }'
            },
            promptMode: {
                type: 'string',
                enum: ['random', 'select'],
                default: 'random',
                description: '提示词选择模式: random=随机选一个, select=面板多选合并一次调用'
            },
            presetName: {
                type: 'string',
                default: '',
                description: '指定 ST OpenAI 预设（pipeline dryRun 组装时临时使用；空=用当前预设，2026-08-18）'
            },
            customStyles: {
                type: 'string',
                default: '',
                description: '单个版本的展示容器(HTML 模板, 渲染时套; 模板用 ${content} 标记生成内容插入位)'
            },
            multiContainerStyles: {
                type: 'string',
                default: '',
                description: '多版本整体外壳(HTML 模板, 可选; 模板用 ${customStyles} 标记多个单版本样式注入位)'
            },
            filters: {
                type: 'array',
                default: [],
                description: '过滤正则列表, 组合内容时对纯文本清洗(不改动落库原文), 每项 { pattern, flags, replacement }'
            },
        }
    ]
};

/**
 * 默认生成内容配置值
 */
export const DEFAULT_GENERATOR_CONFIG_VALUES = {
    metadata: {
        version: GENERATOR_CONFIG_CONSTANTS.version,
        lastUpdated: new Date().toISOString(),
        source: "ST-Continuity-Core",
    },
    generators: []
};

/**
 * 验证生成内容配置
 * @param {Object} config 要验证的配置对象
 * @returns {Object} 验证结果 { isValid: boolean, errors: Array, warnings: Array }
 */
export function validateGeneratorConfig(config) {
    const errors = [];
    const warnings = [];

    if (!config) {
        errors.push('配置对象为空');
        return { isValid: false, errors, warnings };
    }

    if (!config.generators || !Array.isArray(config.generators)) {
        errors.push('配置缺少generators数组或generators不是数组');
        return { isValid: false, errors, warnings };
    }

    // 检查 name 唯一性
    const names = new Set();
    config.generators.forEach((gen, index) => {
        const prefix = `生成内容${index + 1}`;

        if (!gen.name) {
            errors.push(`${prefix}: 缺少name字段`);
        } else if (names.has(gen.name)) {
            errors.push(`${prefix}: name "${gen.name}" 重复`);
        } else {
            names.add(gen.name);
        }

        if (!gen.displayName) {
            warnings.push(`${prefix}: 缺少displayName字段，将使用name作为显示名称`);
        }

        if (gen.enabled !== undefined && typeof gen.enabled !== 'boolean') {
            warnings.push(`${prefix}: enabled字段应为布尔值`);
        }

        if (gen.prompts && !Array.isArray(gen.prompts)) {
            warnings.push(`${prefix}: prompts字段应为数组`);
        }

        const validModes = ['random', 'select'];
        if (gen.promptMode && !validModes.includes(gen.promptMode)) {
            warnings.push(`${prefix}: promptMode应为 ${validModes.join(', ')} 之一`);
        }

        if (gen.customStyles !== undefined && typeof gen.customStyles !== 'string') {
            warnings.push(`${prefix}: customStyles字段应为字符串`);
        }
        if (gen.multiContainerStyles !== undefined && typeof gen.multiContainerStyles !== 'string') {
            warnings.push(`${prefix}: multiContainerStyles字段应为字符串`);
        }
        if (gen.filters !== undefined && !Array.isArray(gen.filters)) {
            warnings.push(`${prefix}: filters字段应为数组`);
        }
    });

    return { isValid: errors.length === 0, errors, warnings };
}

/**
 * 规范化生成内容配置，填充缺失的默认值
 * @param {Object} config 要规范化的配置对象
 * @returns {Object} 规范化后的配置
 */
export function normalizeGeneratorConfig(config) {
    if (!config) {
        return { ...DEFAULT_GENERATOR_CONFIG_VALUES };
    }

    const normalized = {
        metadata: {
            version: DEFAULT_GENERATOR_CONFIG_VALUES.metadata.version,
            lastUpdated: config.metadata?.lastUpdated || new Date().toISOString(),
            source: config.metadata?.source || DEFAULT_GENERATOR_CONFIG_VALUES.metadata.source
        },
        generators: [],
    };

    if (Array.isArray(config.generators)) {
        normalized.generators = config.generators.map((gen, index) => ({
            id: gen.id !== undefined ? Number(gen.id) : index + 1,
            name: gen.name || '',
            displayName: gen.displayName || gen.name || '',
            enabled: gen.enabled !== undefined ? gen.enabled : true,
            prompts: Array.isArray(gen.prompts)
                ? gen.prompts.map(p => ({
                    label: p.label || '',
                    content: p.content || ''
                }))
                : [],
            promptMode: gen.promptMode || 'random',
            presetName: gen.presetName || '',
            customStyles: typeof gen.customStyles === 'string' ? gen.customStyles : '',
            multiContainerStyles: typeof gen.multiContainerStyles === 'string' ? gen.multiContainerStyles : '',
            filters: Array.isArray(gen.filters)
                ? gen.filters.map(f => ({
                    pattern: f?.pattern || '',
                    flags: f?.flags || '',
                    replacement: typeof f?.replacement === 'string' ? f.replacement : '',
                })).filter(f => f.pattern)
                : [],
        }));
    }

    return normalized;
}

/**
 * 创建新的空生成内容配置
 * @returns {Object} 新的空配置对象
 */
export function createEmptyGeneratorConfig() {
    return { ...DEFAULT_GENERATOR_CONFIG_VALUES };
}
