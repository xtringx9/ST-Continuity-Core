// 简化版UI配置模板 - 定义UI美化相关的配置结构
// 只包含模块名、美化代码和变量美化代码等核心字段

/**
 * UI配置模板对象
 * 简化版配置结构，专注于模块和变量的美化代码
 */
export const MODULE_UI_CONFIG_TEMPLATE = {
    // 配置版本
    version: '1.0.0',

    // 最后更新时间
    lastUpdated: new Date().toISOString(),

    // 配置类型标识
    configType: 'ui',

    // 模块UI配置数组
    modulesUI: [
        {
            // 模块名称（关联业务模块）
            moduleName: {
                type: 'string',
                required: true,
                description: '关联的业务模块名称'
            },

            // 模块美化代码（多行字符串）
            moduleStyleCode: {
                type: 'string',
                default: '',
                description: '模块容器美化代码（CSS/HTML/JS）'
            },

            // 变量美化配置数组
            variablesUI: [
                {
                    // 变量名称
                    variableName: {
                        type: 'string',
                        required: true,
                        description: '关联的变量名称'
                    },

                    // 变量美化代码（多行字符串）
                    variableStyleCode: {
                        type: 'string',
                        default: '',
                        description: '变量美化代码（CSS/HTML/JS）'
                    }
                }
            ]
        }
    ]
};

/**
 * 使用示例
 */
const exampleUIConfig = {
    version: '1.0.0',
    lastUpdated: '2024-01-15T10:30:00Z',
    configType: 'ui',
    modulesUI: [
        {
            moduleName: 'userProfile',
            moduleStyleCode: `
.user-profile {
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 8px;
    padding: 16px;
}
                    `,
            variablesUI: [
                {
                    variableName: 'username',
                    variableStyleCode: `
.username {
    font-weight: bold;
    color: #007bff;
    font-size: 18px;
}
                            `
                },
                {
                    variableName: 'avatar',
                    variableStyleCode: `
.avatar {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    object-fit: cover;
}
                            `
                }
            ]
        }
    ]
};

/**
 * 默认UI配置值
 * 用于初始化新UI配置或填充缺失字段
 */
export const DEFAULT_UI_CONFIG_VALUES = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    configType: 'ui',
    modulesUI: []
};

/**
 * 验证UI配置是否符合模板规范
 * @param {Object} uiConfig 要验证的UI配置对象
 * @returns {Object} 验证结果 { isValid: boolean, errors: Array, warnings: Array }
 */
export function validateUIConfig(uiConfig) {
    const errors = [];
    const warnings = [];

    // 检查必需字段
    if (!uiConfig) {
        errors.push('UI配置对象为空');
        return { isValid: false, errors, warnings };
    }

    if (uiConfig.configType !== 'ui') {
        warnings.push('配置类型标识不是"ui"，可能不是有效的UI配置');
    }

    // 验证模块UI配置
    if (uiConfig.modulesUI && Array.isArray(uiConfig.modulesUI)) {
        uiConfig.modulesUI.forEach((moduleUI, index) => {
            const modulePrefix = `模块UI${index + 1}`;

            // 检查模块必需字段
            if (!moduleUI.moduleName) {
                errors.push(`${modulePrefix}: 缺少moduleName字段`);
            }

            // 验证变量UI配置
            if (moduleUI.variablesUI && Array.isArray(moduleUI.variablesUI)) {
                moduleUI.variablesUI.forEach((variableUI, varIndex) => {
                    const varPrefix = `${modulePrefix} -> 变量UI${varIndex + 1}`;

                    if (!variableUI.variableName) {
                        errors.push(`${varPrefix}: 缺少variableName字段`);
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
 * 规范化UI配置，填充缺失的默认值
 * @param {Object} uiConfig 要规范化的UI配置对象
 * @returns {Object} 规范化后的UI配置
 */
export function normalizeUIConfig(uiConfig) {
    if (!uiConfig) {
        return { ...DEFAULT_UI_CONFIG_VALUES };
    }

    const normalized = {
        version: uiConfig.version || DEFAULT_UI_CONFIG_VALUES.version,
        lastUpdated: uiConfig.lastUpdated || new Date().toISOString(),
        configType: uiConfig.configType || 'ui',
        modulesUI: []
    };

    // 规范化模块UI配置
    if (Array.isArray(uiConfig.modulesUI)) {
        normalized.modulesUI = uiConfig.modulesUI.map(moduleUI => ({
            moduleName: moduleUI.moduleName || '',
            moduleStyleCode: moduleUI.moduleStyleCode || '',
            variablesUI: []
        }));

        // 规范化变量UI配置
        normalized.modulesUI.forEach((moduleUI, index) => {
            if (uiConfig.modulesUI[index].variablesUI && Array.isArray(uiConfig.modulesUI[index].variablesUI)) {
                moduleUI.variablesUI = uiConfig.modulesUI[index].variablesUI.map(variableUI => ({
                    variableName: variableUI.variableName || '',
                    variableStyleCode: variableUI.variableStyleCode || ''
                }));
            }
        });
    }

    return normalized;
}

/**
 * 创建新的空UI配置
 * @returns {Object} 新的空UI配置对象
 */
export function createEmptyUIConfig() {
    return { ...DEFAULT_UI_CONFIG_VALUES };
}

/**
 * 获取UI配置模板的JSON Schema
 * @returns {Object} JSON Schema对象
 */
export function getUIConfigSchema() {
    return {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'ST-Continuity-Core UI配置',
        description: 'ST-Continuity-Core 扩展的UI配置模板',
        type: 'object',
        properties: {
            version: {
                type: 'string',
                description: '配置版本'
            },
            configType: {
                type: 'string',
                enum: ['ui'],
                description: '配置类型标识'
            },
            modulesUI: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        moduleName: {
                            type: 'string',
                            description: '模块名称'
                        },
                        moduleStyleCode: {
                            type: 'string',
                            description: '模块美化代码'
                        }
                    },
                    required: ['moduleName']
                }
            }
        },
        required: ['configType', 'modulesUI']
    };
}
