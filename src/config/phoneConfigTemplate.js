// 手机模式配置模板 - 定义手机查看器（只读渲染场景）的 JSON 配置结构
// 独立于 module_config / extension_config，存储在 extension_settings[extensionName]['phone_config']
//
// 设计要点（详见 docs/PHONE_MODE_PLAN.md §三）：
// - 手机是与「模块定义」正交的「查看器应用」，故独立顶层配置组，镜像 generator_config。
// - 通过 scenes[] 引用模块（按 name，因模块落盘无稳定 id）。
// - fieldMap 引用变量「定义名」(variable.name)，非生成值（见文档决策 9）。
export const PHONE_CONFIG_CONSTANTS = {
    version: '1.0.0',
};

/**
 * 手机模式配置模板对象
 * 定义了 phone_config 的完整结构（仅作说明/校验参考，运行时以 normalize 为准）
 */
export const PHONE_CONFIG_TEMPLATE = {
    version: PHONE_CONFIG_CONSTANTS.version,
    lastUpdated: new Date().toISOString(),

    // 手机场景数组，每个场景 = 一个被查看的模块视图
    scenes: [
        {
            moduleName: {
                type: 'string',
                required: true,
                description: '引用的模块名（按 name 引用，模块落盘无稳定 id）'
            },
            enabled: {
                type: 'boolean',
                default: true,
                description: '是否在手机桌面显示此 App'
            },
            appLabel: {
                type: 'string',
                default: '',
                description: '桌面 App 名称，留空则用模块显示名'
            },
            appIcon: {
                type: 'string',
                default: '💬',
                description: '桌面 App 图标 emoji，留空则用 💬'
            },
            fieldMap: {
                type: 'object',
                default: {},
                description: '[msg] 各字段映射：{ 字段: { source: "raw" | "variable", variable: "变量定义名" } }，缺省即 raw'
            },
        }
    ],

    // 预留：手机外壳全局外观，MVP 可空
    appearance: {
        type: 'object',
        default: {},
        description: '手机外壳全局外观（状态栏/背景等），MVP 留空'
    },
};

/**
 * 默认手机模式配置值
 */
export const DEFAULT_PHONE_CONFIG_VALUES = {
    metadata: {
        version: PHONE_CONFIG_CONSTANTS.version,
        updatedAt: new Date().toISOString(),
        source: "ST-Continuity-Core",
    },
    scenes: [],
    appearance: {},
};

/**
 * 创建一个空的场景条目（供设置 UI 新增场景时复用）
 * @param {string} [moduleName] 初始模块名
 * @returns {Object} 场景条目
 */
export function createEmptyScene(moduleName = '') {
    return {
        moduleName,
        enabled: true,
        appLabel: '',
        appIcon: '',
        fieldMap: {},
    };
}

/**
 * 验证手机模式配置
 * @param {Object} config 要验证的配置对象
 * @returns {Object} 验证结果 { isValid: boolean, errors: Array, warnings: Array }
 */
export function validatePhoneConfig(config) {
    const errors = [];
    const warnings = [];

    if (!config) {
        errors.push('配置对象为空');
        return { isValid: false, errors, warnings };
    }

    if (!Array.isArray(config.scenes)) {
        errors.push('配置缺少scenes数组或scenes不是数组');
        return { isValid: false, errors, warnings };
    }

    const names = new Set();
    config.scenes.forEach((scene, index) => {
        const prefix = `手机场景${index + 1}`;

        if (!scene.moduleName) {
            errors.push(`${prefix}: 缺少moduleName字段（引用的模块名）`);
        } else if (names.has(scene.moduleName)) {
            errors.push(`${prefix}: moduleName "${scene.moduleName}" 重复`);
        } else {
            names.add(scene.moduleName);
        }

        if (scene.enabled !== undefined && typeof scene.enabled !== 'boolean') {
            warnings.push(`${prefix}: enabled字段应为布尔值`);
        }

        if (scene.fieldMap && typeof scene.fieldMap !== 'object') {
            warnings.push(`${prefix}: fieldMap字段应为对象`);
        }
    });

    return { isValid: errors.length === 0, errors, warnings };
}

/**
 * 规范化手机模式配置，填充缺失的默认值
 * @param {Object} config 要规范化的配置对象
 * @returns {Object} 规范化后的配置
 */
export function normalizePhoneConfig(config) {
    if (!config) {
        return { ...DEFAULT_PHONE_CONFIG_VALUES };
    }

    const normalized = {
        metadata: {
            version: DEFAULT_PHONE_CONFIG_VALUES.metadata.version,
            updatedAt: config.metadata?.updatedAt || new Date().toISOString(),
            source: config.metadata?.source || DEFAULT_PHONE_CONFIG_VALUES.metadata.source,
        },
        scenes: [],
        appearance: config.appearance && typeof config.appearance === 'object'
            ? { ...config.appearance }
            : {},
    };

    if (Array.isArray(config.scenes)) {
        normalized.scenes = config.scenes.map((scene) => ({
            moduleName: scene.moduleName || '',
            enabled: scene.enabled !== undefined ? scene.enabled : true,
            appLabel: typeof scene.appLabel === 'string' ? scene.appLabel : '',
            appIcon: typeof scene.appIcon === 'string' ? scene.appIcon : '',
            fieldMap: scene.fieldMap && typeof scene.fieldMap === 'object'
                ? { ...scene.fieldMap }
                : {},
        }));
    }

    return normalized;
}

/**
 * 创建新的空手机模式配置
 * @returns {Object} 新的空配置对象
 */
export function createEmptyPhoneConfig() {
    return {
        metadata: {
            version: DEFAULT_PHONE_CONFIG_VALUES.metadata.version,
            updatedAt: new Date().toISOString(),
            source: DEFAULT_PHONE_CONFIG_VALUES.metadata.source,
        },
        scenes: [],
        appearance: {},
    };
}
