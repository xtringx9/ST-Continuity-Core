// 模块配置模板 - 定义标准的模块JSON配置结构
// 所有保存、导入导出操作都基于此模板进行验证
export const CONFIG_CONSTANTS = {
    // 配置版本
    version: '1.0.0',
};

/** 三态模式 key */
export const PROMPT_MODES = ['sync', 'async-body', 'async-alone'];

/**
 * 规范化「三态 × 前置/后置」提示词结构。
 * 兼容旧字符串（作为 sync.pre 迁移）。
 * 新结构：{ sync:{pre,post}, 'async-body':{pre,post}, 'async-alone':{pre,post} }
 * @param {string|Object} value 旧字符串或新结构对象
 * @returns {Object} { sync:{pre,post}, 'async-body':{pre,post}, 'async-alone':{pre,post} }
 */
export function normalizeTristatePrompt(value) {
    const empty = { pre: '', post: '' };
    const out = {
        sync: { ...empty },
        'async-body': { ...empty },
        'async-alone': { ...empty },
    };
    if (typeof value === 'string') {
        // 旧格式：字符串 → sync.pre
        out.sync.pre = value;
        return out;
    }
    if (value && typeof value === 'object') {
        for (const mode of PROMPT_MODES) {
            const part = value[mode];
            if (typeof part === 'string') {
                // 部分迁移态：{ sync: '...' } 字符串
                out[mode].pre = part;
            } else if (part && typeof part === 'object') {
                out[mode].pre = typeof part.pre === 'string' ? part.pre : '';
                out[mode].post = typeof part.post === 'string' ? part.post : '';
            }
        }
    }
    return out;
}

/** 空的三态×前后置结构（DEFAULT_CONFIG_VALUES 用） */
export function emptyTristatePrompt() {
    return normalizeTristatePrompt('');
}

/**
 * 异步配置默认值（module_config.asyncConfig，与 globalSettings/modules 平级）。
 * 2026-08-17 迁移：原 extension_config.module.asyncModule 中除 enabled/customApi 外的字段整体移入。
 */
export const DEFAULT_ASYNC_CONFIG = {
    snapshotInterval: 5, // 快照间隔（层）
    generationMode: 'pipeline', // AI 生成模式: 'pipeline' | 'raw'
    useIndependentApi: false, // 是否使用独立 API（false=主API, true=独立API）
    rawSystemPrompt: '你是一个模块数据提取助手。请从用户提供的文本中提取模块数据，使用 [模块名|键:值|键:值] 格式输出。只输出模块数据，不要输出其他内容。', // raw 模式的系统提示词
    rawUserPromptTemplate: '--- 楼层 {{mesId}} ({{senderType}}) ---\n{{messageText}}', // raw 模式的用户提示词模板
    showDebug: true, // 生成完成后是否弹出面板手动确认（false=自动存储）
    pushUserMessageAsLast: false, // 重新生成时：true=生成指令 push 进 chat 作为最后 user 消息；false=经 quietPrompt 传入（UI 暂隐藏，保留配置）
    askPromptBeforeGenerate: false, // 点击小 Cc 生成按钮时弹出输入框（UI 暂隐藏，保留配置）
    autoGenerateOnMessageEnd: true, // 聊天消息收到完毕（GENERATION_ENDED）时自动触发模块异步生成
    promptGroups: [], // 提示词组：[{ id, name(简名), role(消息角色), prompt(提示词), isDefault }]
    presetName: '', // 指定 ST OpenAI 预设（pipeline dryRun 组装时临时使用；空=用当前预设，2026-08-18）
    customApi: { // 独立 API 配置（useIndependentApi=true 时生效；2026-08-18 从 asyncModule.customApi 迁入）
        apiurl: '',
        key: '',
        model: '',
        source: 'openai',
        temperature: 0.3,
        max_tokens: 0, // 0=不限制
    },
    // ⚠️ 2026-08-18 移除字段：pipelineModifier（旧追加指令）/ defaultPrompt / fallbackPromptRole——
    //   默认生成提示词 = 设为默认的提示词组（promptGroups 中 isDefault 的 prompt）；提示词组为空则默认提示词为空；
    //   消息角色由提示词组 role 承担（aiCaller 默认回退 'user'）。
};

/**
 * 规范化 asyncConfig（合并默认值 + 规范化 promptGroups/customApi）。
 * @param {Object} config
 * @returns {Object}
 */
export function normalizeAsyncConfig(config) {
    const base = { ...DEFAULT_ASYNC_CONFIG, ...(config && typeof config === 'object' ? config : {}) };
    const groups = Array.isArray(base.promptGroups) ? base.promptGroups : [];
    let normalizedGroups = groups.map((g, i) => ({
        id: String(g?.id ?? `pg_${Date.now()}_${i}`),
        name: String(g?.name || ''),
        role: ['user', 'assistant', 'system'].includes(g?.role) ? g.role : 'user',
        prompt: String(g?.prompt || ''),
        isDefault: !!g?.isDefault,
    }));
    // 只有一组提示词组 → 自动设为默认（2026-08-18 用户拍板）
    if (normalizedGroups.length === 1) {
        normalizedGroups[0].isDefault = true;
    }
    const api = base.customApi && typeof base.customApi === 'object' ? base.customApi : {};
    return {
        ...base,
        presetName: String(base.presetName || ''), // ST OpenAI 预设名（空=用当前预设）
        customApi: {
            apiurl: String(api.apiurl || ''),
            key: String(api.key || ''),
            model: String(api.model || ''),
            source: ['openai', 'claude', 'custom'].includes(api.source) ? api.source : 'openai',
            temperature: typeof api.temperature === 'number' ? api.temperature : 0.3,
            max_tokens: typeof api.max_tokens === 'number' ? api.max_tokens : 0,
        },
        promptGroups: normalizedGroups,
    };
}

/**
 * 模块配置模板对象
 * 定义了完整的模块配置结构，包括模块和变量的所有字段
 */
export const MODULE_CONFIG_TEMPLATE = {
    // 配置版本
    version: CONFIG_CONSTANTS.version,

    // 最后更新时间
    lastUpdated: new Date().toISOString(),

    // 全局设置
    globalSettings: {
        moduleTag: {
            type: 'string',
            default: 'module',
            description: '模块标签'
        },
        moduleUpdateTag: {
            type: 'string',
            default: 'module_update',
            description: '模块更新标签'
        },
        compatibleModuleTags: {
            type: 'array',
            default: ['module', 'modules'],
            description: '兼容更新标签，从左到右'
        },
        cotTags: {
            type: 'array',
            default: [],
            description: '思维链标签，从左到右'
        },
        contentTag: {
            type: 'array',
            default: [],
            description: '正文标签，从左到右'
        },
        contentRemainLayers: {
            type: 'number',
            default: 6,
            description: '正文保留层数'
        },
        // 核心原则提示词（三态×前置/后置结构，normalizeTristatePrompt 规范化）
        prompt: {
            type: 'object',
            default: emptyTristatePrompt(),
            description: '{{CONTINUITY_PROMPT}}前置/后置提示词（三态）'
        },
        // 通用格式描述提示词
        orderPrompt: {
            type: 'object',
            default: emptyTristatePrompt(),
            description: '{{CONTINUITY_ORDER}}前置/后置提示词（三态）'
        },
        usagePrompt: {
            type: 'object',
            default: emptyTristatePrompt(),
            description: '{{CONTINUITY_USAGE_GUIDE}}前置/后置提示词（三态）'
        },
        moduleDataPrompt: {
            type: 'object',
            default: emptyTristatePrompt(),
            description: '{{CONTINUITY_MODULE_DATA}}前置/后置提示词（三态）'
        },
        externalStyles: {
            type: 'string',
            default: '${customStyles}',
            description: '外部CSS/HTML样式'
        },
        containerStyles: {
            type: 'string',
            default: '${customStyles}',
            description: '消息内CSS/HTML样式'
        },
        bottomStyles: {
            type: 'string',
            default: '${customStyles}',
            description: '底部CSS/HTML样式'
        },
        timeFormat: {
            type: 'string',
            default: '${year}-${month}-${day} ${weekday} ${hour}:${minute}:${second}',
            description: '时间格式，例如：${year}-${month}-${day} ${weekday} ${hour}:${minute}:${second}'
        },
    },

    // 模块数组
    modules: [
        {
            // 模块基本信息
            id: {
                type: 'string',
                required: true,
                description: '模块唯一标识符'
            },
            name: {
                type: 'string',
                required: true,
                description: '模块名称（英文标识）'
            },
            displayName: {
                type: 'string',
                required: true,
                description: '模块显示名称（中文）'
            },
            enabled: {
                type: 'boolean',
                default: true,
                description: '模块是否启用'
            },

            // 模块配置
            prompt: {
                type: 'string',
                default: '',
                description: '模块提示词'
            },
            timingPrompt: {
                type: 'string',
                default: '',
                description: '时机提示词'
            },
            contentPrompt: {
                type: 'string',
                default: '',
                description: '内容提示词'
            },
            positionPrompt: {
                type: 'string',
                default: '',
                description: '顺序提示词'
            },

            // 输出设置
            outputPosition: {
                type: 'string',
                enum: ['body', 'body_start', 'body_dynamic', 'body_end', 'body_start', 'body_end', 'body_surround', 'after_body', 'embedded', 'specific_position', 'custom'], // todo custom可以考虑找个时间实现
                default: 'after_body',
                description: '输出位置'
            },
            outputMode: {
                type: 'string',
                enum: ['full', 'incremental'],
                default: 'full',
                description: '输出模式'
            },

            // 范围设置
            rangeMode: {
                type: 'string',
                enum: ['unlimited', 'specified', 'range'],
                default: 'specified',
                description: '范围模式'
            },
            itemMin: {
                type: 'number',
                default: 0,
                description: '最小值（范围模式使用）'
            },
            itemMax: {
                type: 'number',
                default: 1,
                description: '最大值/指定值'
            },

            // 高级设置
            compatibleModuleNames: {
                type: 'array',
                default: [],
                description: '兼容模块名称（逗号分隔）'
            },
            timeReferenceStandard: {
                type: 'boolean',
                default: false,
                description: '时间参考标准（是否使用标准时间格式）'
            },
            retainLayers: {
                type: 'number',
                default: -1,
                description: '保留层数（-1表示不限制）'
            },
            isExternalDisplay: {
                type: 'boolean',
                default: false,
                description: '是否在外部显示模块'
            },
            includeInModuleData: {
                type: 'boolean',
                default: true,
                description: '是否包含在 {{CONTINUITY_MODULE_DATA}} 汇总提示词中（仅全量模块生效，增量模块始终包含）'
            },
            externalStyles: {
                type: 'string',
                default: '',
                description: '外置容器CSS/HTML样式，用于包裹所有模块条目，支持多行代码和${customStyles}变量引用'
            },
            containerStyles: {
                type: 'string',
                default: '',
                description: '容器CSS/HTML样式，用于包裹所有模块条目，支持多行代码和${customStyles}变量引用'
            },
            customStyles: {
                type: 'string',
                default: '',
                description: '自定义CSS/HTML样式，用于每条模块条目，支持多行代码'
            },

            // 变量数组
            variables: [
                {
                    // 变量基本信息
                    id: {
                        type: 'string',
                        required: true,
                        description: '变量唯一标识符'
                    },
                    name: {
                        type: 'string',
                        required: true,
                        description: '变量名称（英文标识）'
                    },
                    displayName: {
                        type: 'string',
                        required: true,
                        description: '变量显示名称（中文）'
                    },
                    enabled: {
                        type: 'boolean',
                        default: true,
                        description: '变量是否启用'
                    },
                    description: {
                        type: 'string',
                        default: '',
                        description: '变量描述'
                    },
                    usagePrompt: {
                        type: 'string',
                        default: '',
                        description: '变量使用指导（异步跟随正文 USAGE_GUIDE 增强用：告诉 AI 该 key 是什么、如何使用）'
                    },

                    // // 变量类型设置
                    // type: {
                    //     type: 'string',
                    //     enum: ['text', 'number', 'boolean', 'select'],
                    //     default: 'text',
                    //     description: '变量类型'
                    // },
                    // defaultValue: {
                    //     type: 'string',
                    //     default: '',
                    //     description: '默认值'
                    // },

                    // 标识符设置
                    isIdentifier: {
                        type: 'boolean',
                        default: false,
                        description: '是否为主标识符'
                    },
                    isBackupIdentifier: {
                        type: 'boolean',
                        default: false,
                        description: '是否为备用标识符'
                    },

                    // 高级设置
                    compatibleVariableNames: {
                        type: 'array',
                        default: [],
                        description: '兼容变量名称别名（逗号分隔）'
                    },
                    isHideCondition: {
                        type: 'boolean',
                        default: false,
                        description: '是否为隐藏条件变量'
                    },
                    hideConditionValues: {
                        type: 'array',
                        default: [],
                        description: '隐藏条件值（逗号分隔）'
                    },
                    isNoNormalize: {
                        type: 'boolean',
                        default: false,
                        description: '是否不需要规范化'
                    },
                    // required: {
                    //     type: 'boolean',
                    //     default: false,
                    //     description: '是否必填'
                    // },
                    customStyles: {
                        type: 'string',
                        default: '',
                        description: '变量级自定义CSS/HTML样式，支持多行代码'
                    },

                    // // 选择类型特有设置
                    // options: {
                    //     type: 'array',
                    //     default: [],
                    //     description: '选项列表（仅select类型使用）'
                    // }
                }
            ]
        }
    ]
};

/**
 * 默认配置值
 */
export const DEFAULT_CONFIG_VALUES = {
    metadata: {
        version: CONFIG_CONSTANTS.version,
        lastUpdated: new Date().toISOString(),
        source: "ST-Continuity-Core",
    },
    globalSettings: {
    },
    modules: [],
    asyncConfig: { ...DEFAULT_ASYNC_CONFIG, promptGroups: [] },
};


/**
 * 验证配置是否符合模板规范
 * @param {Object} config 要验证的配置对象
 * @returns {Object} 验证结果 { isValid: boolean, errors: Array, warnings: Array }
 */
export function validateConfig(config) {
    const errors = [];
    const warnings = [];

    // 检查必需字段
    if (!config) {
        errors.push('配置对象为空');
        return { isValid: false, errors, warnings };
    }

    // 根据导出选项判断是否需要验证modules
    const exportOptions = config.metadata?.exportOptions;
    const shouldValidateModules = !exportOptions || exportOptions.exportModuleConfig !== false;

    if (shouldValidateModules && (!config.modules || !Array.isArray(config.modules))) {
        errors.push('配置缺少modules数组或modules不是数组');
        return { isValid: false, errors, warnings };
    }

    // 验证每个模块（仅在需要验证模块时执行）
    if (shouldValidateModules && config.modules) {
        config.modules.forEach((module, index) => {
            const modulePrefix = `模块${index + 1}`;

            // 检查模块必需字段
            if (!module.name) {
                errors.push(`${modulePrefix}: 缺少name字段`);
            }

            if (!module.displayName) {
                warnings.push(`${modulePrefix}: 缺少displayName字段，将使用name作为显示名称`);
            }

            // 验证字段类型
            if (module.enabled !== undefined && typeof module.enabled !== 'boolean') {
                warnings.push(`${modulePrefix}: enabled字段应为布尔值`);
            }

            if (module.retainLayers !== undefined && typeof module.retainLayers !== 'number') {
                warnings.push(`${modulePrefix}: retainLayers字段应为数字`);
            }

            if (module.timeReferenceStandard !== undefined && typeof module.timeReferenceStandard !== 'boolean') {
                warnings.push(`${modulePrefix}: timeReferenceStandard字段应为布尔值`);
            }

            if (module.isExternalDisplay !== undefined && typeof module.isExternalDisplay !== 'boolean') {
                warnings.push(`${modulePrefix}: isExternalDisplay字段应为布尔值`);
            }

            // 验证枚举值
            const validOutputPositions = ['body', 'body_start', 'body_dynamic', 'body_end', 'body_surround', 'after_body', 'embedded', 'specific_position', 'custom'];
            if (module.outputPosition && !validOutputPositions.includes(module.outputPosition)) {
                warnings.push(`${modulePrefix}: outputPosition应为 ${validOutputPositions.join(', ')} 之一`);
            }

            const validOutputModes = ['full', 'incremental'];
            if (module.outputMode && !validOutputModes.includes(module.outputMode)) {
                warnings.push(`${modulePrefix}: outputMode应为 ${validOutputModes.join(', ')} 之一`);
            }

            const validRangeModes = ['unlimited', 'specified', 'range'];
            if (module.rangeMode && !validRangeModes.includes(module.rangeMode)) {
                warnings.push(`${modulePrefix}: rangeMode应为 ${validRangeModes.join(', ')} 之一`);
            }

            // 验证变量
            if (module.variables && Array.isArray(module.variables)) {
                module.variables.forEach((variable, varIndex) => {
                    const varPrefix = `${modulePrefix} -> 变量${varIndex + 1}`;

                    if (!variable.name) {
                        warnings.push(`${varPrefix}: 缺少name字段`);
                    }

                    if (variable.isIdentifier !== undefined && typeof variable.isIdentifier !== 'boolean') {
                        warnings.push(`${varPrefix}: isIdentifier字段应为布尔值`);
                    }

                    // 验证字段类型
                    if (variable.enabled !== undefined && typeof variable.enabled !== 'boolean') {
                        warnings.push(`${varPrefix}: enabled字段应为布尔值`);
                    }

                    if (variable.isBackupIdentifier !== undefined && typeof variable.isBackupIdentifier !== 'boolean') {
                        warnings.push(`${varPrefix}: isBackupIdentifier字段应为布尔值`);
                    }

                    if (variable.isHideCondition !== undefined && typeof variable.isHideCondition !== 'boolean') {
                        warnings.push(`${varPrefix}: isHideCondition字段应为布尔值`);
                    }
                });
            }
        });
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * 规范化配置，填充缺失的默认值
 * @param {Object} config 要规范化的配置对象
 * @returns {Object} 规范化后的配置
 */
export function normalizeConfig(config, extension_config = null) {
    if (!config) {
        return { ...DEFAULT_CONFIG_VALUES };
    }

    const normalized = {
        metadata: {
            // 导入规范化：extension_config 可能是外部导入的配置对象（非当前激活配置），
            // 不能走 configManager.getModuleDomainConfig()（只返回当前激活配置）。故直读。
            author: (extension_config && extension_config.module?.config?.author) ? extension_config.module.config.author : '',
            authorConfigVersion: (extension_config && extension_config.module?.config?.version) ? extension_config.module.config.version : '',
            version: DEFAULT_CONFIG_VALUES.metadata.version,
            lastUpdated: config.metadata?.lastUpdated || config.lastUpdated || new Date().toISOString(),
            source: config.metadata?.source || DEFAULT_CONFIG_VALUES.metadata.source
        },
        globalSettings: {
            moduleTag: config.globalSettings?.moduleTag || 'module',
            moduleUpdateTag: config.globalSettings?.moduleUpdateTag || 'module_update',
            compatibleModuleTags: config.globalSettings?.compatibleModuleTags || ['module', 'modules'],
            cotTags: config.globalSettings?.cotTags || [],
            contentTag: config.globalSettings?.contentTag || [],
            contentRemainLayers: config.globalSettings?.contentRemainLayers || 6,
            prompt: normalizeTristatePrompt(config.globalSettings?.prompt),
            orderPrompt: normalizeTristatePrompt(config.globalSettings?.orderPrompt),
            usagePrompt: normalizeTristatePrompt(config.globalSettings?.usagePrompt),
            moduleDataPrompt: normalizeTristatePrompt(config.globalSettings?.moduleDataPrompt),
            externalStyles: config.globalSettings?.externalStyles || '${customStyles}',
            containerStyles: config.globalSettings?.containerStyles || '${customStyles}',
            bottomStyles: config.globalSettings?.bottomStyles || '${customStyles}',
            timeFormat: config.globalSettings?.timeFormat || '${year}-${month}-${day} ${weekday} ${hour}:${minute}:${second}',
        },
        modules: [],
        asyncConfig: normalizeAsyncConfig(config.asyncConfig),
    };

    // 规范化每个模块
    if (Array.isArray(config.modules)) {
        normalized.modules = config.modules.map(module => ({
            // id: module.id || generateId(),
            name: module.name || '',
            displayName: module.displayName || '',
            compatibleModuleNames: module.compatibleModuleNames || '',
            order: module.order !== undefined ? Number(module.order) : 0,
            enabled: module.enabled !== undefined ? module.enabled : true,
            prompt: module.prompt || '',
            timingPrompt: module.timingPrompt || '',
            contentPrompt: module.contentPrompt || '',
            positionPrompt: module.positionPrompt || '',
            outputPosition: module.outputPosition || 'after_body',
            outputMode: module.outputMode || 'full',
            retainLayers: module.retainLayers !== undefined ? Number(module.retainLayers) : -1,
            rangeMode: module.rangeMode || 'specified',
            itemMin: typeof module.itemMin === 'number' ? module.itemMin : 0,
            itemMax: typeof module.itemMax === 'number' ? module.itemMax : 1,
            timeReferenceStandard: module.timeReferenceStandard || false,
            isExternalDisplay: module.isExternalDisplay || false,
            includeInModuleData: module.includeInModuleData !== undefined ? module.includeInModuleData : true,
            externalStyles: module.externalStyles || '',
            containerStyles: module.containerStyles || '',
            customStyles: module.customStyles || '',
            variables: []
        }));

        // 规范化每个变量
        normalized.modules.forEach((module, index) => {
            if (config.modules[index].variables && Array.isArray(config.modules[index].variables)) {
                module.variables = config.modules[index].variables.map(variable => ({
                    // id: variable.id || generateId(),
                    name: variable.name || '',
                    displayName: variable.displayName || '',
                    compatibleVariableNames: variable.compatibleVariableNames || '',
                    description: variable.description || '',
                    usagePrompt: variable.usagePrompt || '',
                    enabled: variable.enabled !== undefined ? variable.enabled : true,
                    // type: variable.type || 'text',
                    // defaultValue: variable.defaultValue || '',
                    isIdentifier: variable.isIdentifier || false,
                    isBackupIdentifier: variable.isBackupIdentifier || false,
                    isHideCondition: variable.isHideCondition || false,
                    hideConditionValues: variable.hideConditionValues || '',
                    isNoNormalize: variable.isNoNormalize || false,
                    // required: variable.required || false,
                    customStyles: variable.customStyles || '',
                    // options: Array.isArray(variable.options) ? variable.options : []
                }));
            }
        });
    }

    return normalized;
}

/**
 * 生成唯一ID
 * @returns {string} 唯一标识符
 */
function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 创建新的空配置
 * @returns {Object} 新的空配置对象
 */
export function createEmptyConfig() {
    return { ...DEFAULT_CONFIG_VALUES };
}

/**
 * 获取配置模板的JSON Schema
 * @returns {Object} JSON Schema对象
 */
export function getConfigSchema() {
    return {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'ST-Continuity-Core 模块配置',
        description: 'ST-Continuity-Core 扩展的模块配置模板',
        type: 'object',
        properties: {
            version: {
                type: 'string',
                description: '配置版本'
            },
            lastUpdated: {
                type: 'string',
                format: 'date-time',
                description: '最后更新时间'
            },
            globalSettings: {
                type: 'object',
                properties: {
                    prompt: {
                        type: 'string',
                        description: '核心原则提示词'
                    },
                    orderPrompt: {
                        type: 'string',
                        description: '通用格式描述提示词'
                    }
                }
            },
            modules: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: '模块名称'
                        },
                        displayName: {
                            type: 'string',
                            description: '模块显示名称'
                        },
                        enabled: {
                            type: 'boolean',
                            description: '模块是否启用'
                        }
                        // 其他字段可以继续定义...
                    },
                    required: ['name']
                }
            }
        },
        required: ['modules']
    };
}
