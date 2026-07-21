// 角色绑定配置模板 - 定义按"角色+聊天"层级的配置覆盖结构
// 与 module_config / extension_config / generator_config / phone_config 同级，
// 存储在 extension_settings[extensionName]['character_bindings']
//
// 设计（详见设计记录）：
// - 绑定分两级：scope="character"（应用于该角色所有聊天）与 scope="chat"（特定聊天，优先于角色级）。
// - 三层有效值：默认 < 角色级 < 聊天级（Model A 继承/逐键覆盖）。
// - 引用模块/变量用 name（无稳定 id，沿用 phone_config 惯例）。
// - 模块以"会员制"显式存储；override 始终写入当前 effective 值（添加即钉死，不再用 Delta 差值）。

export const CHARACTER_BINDING_CONSTANTS = {
    version: '1.0.0',
};

export const CHARACTER_BINDING_TEMPLATE = {
    version: CHARACTER_BINDING_CONSTANTS.version,
    lastUpdated: new Date().toISOString(),
    bindings: [
        {
            scope: { type: 'string', enum: ['character', 'chat'], required: true, description: '绑定层级' },
            charName: { type: 'string', required: true, description: '角色名（characterName）' },
            chatFile: { type: 'string', default: null, description: '聊天文件名（sessionName）；角色级为 null' },
            modules: [
                {
                    name: { type: 'string', required: true, description: '引用的模块名' },
                    moduleOverride: { type: 'boolean', default: undefined, description: '模块启停覆盖；省略=继承下层' },
                    variableOverrides: { type: 'object', default: {}, description: '变量启停覆盖 {变量名: bool}' },
                }
            ],
        }
    ],
};

export const DEFAULT_CHARACTER_BINDING_VALUES = {
    metadata: {
        version: CHARACTER_BINDING_CONSTANTS.version,
        lastUpdated: new Date().toISOString(),
        source: 'ST-Continuity-Core',
    },
    bindings: [],
};

/**
 * 创建新的空角色绑定配置
 * @returns {Object}
 */
export function createEmptyCharacterBindingConfig() {
    return {
        metadata: {
            version: CHARACTER_BINDING_CONSTANTS.version,
            lastUpdated: new Date().toISOString(),
            source: DEFAULT_CHARACTER_BINDING_VALUES.metadata.source,
        },
        bindings: [],
    };
}

/**
 * 创建一个空绑定条目
 * @param {'character'|'chat'} scope
 * @param {string} charName
 * @param {string|null} [chatFile]
 */
export function createEmptyBinding(scope, charName, chatFile = null) {
    return {
        scope,
        charName,
        chatFile: scope === 'chat' ? chatFile : null,
        modules: [],
    };
}

/**
 * 创建一个空"绑定模块"条目（会员制：显式存储；override 省略即继承下层）
 * @param {string} name
 */
export function createEmptyBoundModule(name) {
    return {
        name,
        variableOverrides: {},
    };
}

/**
 * 验证角色绑定配置
 * @param {Object} config
 * @returns {Object} { isValid, errors, warnings }
 */
export function validateCharacterBindingConfig(config) {
    const errors = [];
    const warnings = [];

    if (!config) {
        errors.push('配置对象为空');
        return { isValid: false, errors, warnings };
    }
    if (!Array.isArray(config.bindings)) {
        errors.push('配置缺少bindings数组');
        return { isValid: false, errors, warnings };
    }

    const seen = new Set();
    config.bindings.forEach((b, i) => {
        const prefix = `绑定${i + 1}`;
        if (!b.charName) errors.push(`${prefix}: 缺少charName`);
        if (b.scope === 'chat' && !b.chatFile) warnings.push(`${prefix}: 聊天级缺少chatFile`);

        const key = `${b.scope}|${b.charName}|${b.chatFile ?? ''}`;
        if (seen.has(key)) errors.push(`${prefix}: 重复绑定键 ${key}`);
        seen.add(key);

        if (Array.isArray(b.modules)) {
            const mseen = new Set();
            b.modules.forEach((m, j) => {
                const mp = `${prefix} 模块${j + 1}`;
                if (!m.name) errors.push(`${mp}: 缺少name`);
                else if (mseen.has(m.name)) errors.push(`${mp}: 模块 ${m.name} 重复`);
                else mseen.add(m.name);
            });
        }
    });

    return { isValid: errors.length === 0, errors, warnings };
}

/**
 * 规范化角色绑定配置，填充缺失的默认值
 * @param {Object} config
 * @returns {Object}
 */
export function normalizeCharacterBindingConfig(config) {
    if (!config) return createEmptyCharacterBindingConfig();

    const normalized = {
        metadata: {
            version: DEFAULT_CHARACTER_BINDING_VALUES.metadata.version,
            lastUpdated: config.metadata?.lastUpdated || new Date().toISOString(),
            source: config.metadata?.source || DEFAULT_CHARACTER_BINDING_VALUES.metadata.source,
        },
        bindings: [],
    };

    if (Array.isArray(config.bindings)) {
        normalized.bindings = config.bindings.map(b => ({
            scope: b.scope === 'chat' ? 'chat' : 'character',
            charName: b.charName || '',
            chatFile: b.scope === 'chat' ? (b.chatFile || '') : null,
            modules: Array.isArray(b.modules) ? b.modules.map(m => ({
                name: m.name || '',
                moduleOverride: typeof m.moduleOverride === 'boolean' ? m.moduleOverride : undefined,
                variableOverrides: m.variableOverrides && typeof m.variableOverrides === 'object'
                    ? { ...m.variableOverrides }
                    : {},
            })) : [],
        }));
    }

    return normalized;
}
