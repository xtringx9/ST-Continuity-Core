// 配置信息模块

// 扩展基本信息
export const extensionName = "ST-Continuity-Core";
export const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// 默认设置，包含全局开关
export const defaultSettings = {
    enabled: true, // 全局开关默认开启
    backendUrl: "http://192.168.0.119:8888/simple-process", // 后端服务器地址
    debugLogs: false, // 调试日志开关，默认关闭
    autoInject: true, // 自动注入开关，默认开启
    corePrinciples: "", // 核心原则提示词
    formatDescription: "" // 通用格式描述提示词
};
