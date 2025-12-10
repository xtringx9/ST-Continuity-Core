// 模块配置模板 - 定义标准的模块JSON配置结构
// 所有保存、导入导出操作都基于此模板进行验证

/**
 * 模块配置模板对象
 * 定义了完整的模块配置结构，包括模块和变量的所有字段
 */
export const MODULE_CONFIG_TEMPLATE = {
    // 配置版本
    version: '1.1.0',

    // 最后更新时间
    lastUpdated: new Date().toISOString(),

    // 全局设置
    globalSettings: {
        moduleTag: {
            type: 'string',
            default: 'module',
            description: '模块标签'
        },
        compatibleModuleTags: {
            type: 'array',
            default: ['module', 'modules'],
            description: '兼容模块标签，从左到右'
        },
        contentTag: {
            type: 'array',
            default: ['content', 'game'],
            description: '正文标签，从左到右'
        },
        contentRemainLayers: {
            type: 'number',
            default: 6,
            description: '正文保留层数'
        },
        // 核心原则提示词
        corePrinciples: {
            type: 'string',
            default: '',
            description: '核心原则提示词，用于指导整个系统的行为'
        },
        // 通用格式描述提示词
        formatDescription: {
            type: 'string',
            default: '',
            description: '通用格式描述提示词，用于定义输出格式'
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
                enum: ['before_body', 'after_body', 'embedded', 'specific_position', 'custom'],
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
 * 用于初始化新配置或填充缺失字段
 */
export const DEFAULT_CONFIG_VALUES = {
    version: '1.1.0',
    lastUpdated: new Date().toISOString(),
    globalSettings: {
        corePrinciples: '',
        formatDescription: ''
    },
    modules: []
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

    if (!config.modules || !Array.isArray(config.modules)) {
        errors.push('配置缺少modules数组或modules不是数组');
        return { isValid: false, errors, warnings };
    }

    // 验证每个模块
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
        const validOutputPositions = ['before_body', 'after_body', 'embedded', 'specific_position', 'custom'];
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
export function normalizeConfig(config) {
    if (!config) {
        return { ...DEFAULT_CONFIG_VALUES };
    }

    const normalized = {
        version: config.version || DEFAULT_CONFIG_VALUES.version,
        lastUpdated: config.lastUpdated || new Date().toISOString(),
        globalSettings: {
            moduleTag: config.globalSettings?.moduleTag || 'module',
            compatibleModuleTags: config.globalSettings?.compatibleModuleTags || ['module', 'modules'],
            contentTag: config.globalSettings?.contentTag || ['content', 'game'],
            contentRemainLayers: config.globalSettings?.contentRemainLayers || 6,
            corePrinciples: config.globalSettings?.corePrinciples || '',
            formatDescription: config.globalSettings?.formatDescription || ''
        },
        modules: [],
    };

    // 规范化每个模块
    if (Array.isArray(config.modules)) {
        normalized.modules = config.modules.map(module => ({
            // id: module.id || generateId(),
            name: module.name || '',
            displayName: module.displayName || module.name || '',
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
                    displayName: variable.displayName || variable.name || '',
                    compatibleVariableNames: variable.compatibleVariableNames || '',
                    description: variable.description || '',
                    enabled: variable.enabled !== undefined ? variable.enabled : true,
                    // type: variable.type || 'text',
                    // defaultValue: variable.defaultValue || '',
                    isIdentifier: variable.isIdentifier || false,
                    isBackupIdentifier: variable.isBackupIdentifier || false,
                    isHideCondition: variable.isHideCondition || false,
                    hideConditionValues: variable.hideConditionValues || '',
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
                    corePrinciples: {
                        type: 'string',
                        description: '核心原则提示词'
                    },
                    formatDescription: {
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
