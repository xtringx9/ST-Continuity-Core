// 聊天/阅读工具配置模板（extension_settings[扩展名]['chat_tools'] 下的独立顶层段）。
// 现承载：正则提取模板套件（extractTemplates，全局可跨聊天复用）。
// 后续聊天管理 / 阅读器相关配置可在此扩展，无需另起顶层键。

function genTemplateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'tpl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const CHAT_TOOLS_KEY = 'chat_tools';

export const DEFAULT_CHAT_TOOLS_VALUES = {
    version: 1,
    extractTemplates: [],
};

export function normalizeExtractTemplate(t) {
    if (!t || typeof t !== 'object') return null;
    return {
        id: typeof t.id === 'string' && t.id ? t.id : genTemplateId(),
        name: typeof t.name === 'string' && t.name ? t.name : '未命名模板',
        pattern: typeof t.pattern === 'string' ? t.pattern : '',
        flags: typeof t.flags === 'string' ? t.flags : 'g',
        template: typeof t.template === 'string' ? t.template : '',
        // 消息来源：用户消息 / AI消息（AI = 助手 + 系统）
        includeUser: Boolean(t.includeUser),
        includeAI: t.includeAI === undefined ? true : Boolean(t.includeAI),
    };
}

export function normalizeChatToolsConfig(cfg) {
    cfg = cfg && typeof cfg === 'object' ? cfg : {};
    return {
        version: 1,
        extractTemplates: Array.isArray(cfg.extractTemplates)
            ? cfg.extractTemplates.map(normalizeExtractTemplate).filter(Boolean)
            : [],
    };
}
