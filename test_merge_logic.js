// 测试新的合并逻辑
const testConfig = {
    modules: [
        {
            name: "existing-module",
            enabled: true, // 导入的启用状态
            variables: [
                { name: "var1", enabled: true },
                { name: "var2", enabled: false },
                { name: "new-var", enabled: true } // 新变量
            ]
        },
        {
            name: "new-module", // 新模块
            enabled: false,
            variables: [
                { name: "var3", enabled: true }
            ]
        }
    ]
};

const currentConfig = {
    modules: [
        {
            name: "existing-module",
            enabled: false, // 当前配置中的启用状态
            variables: [
                { name: "var1", enabled: false }, // 当前为false
                { name: "var2", enabled: true },  // 当前为true
                // 当前配置中没有 new-var
            ]
        },
        {
            name: "current-only-module", // 当前配置中有但导入配置中没有的模块
            enabled: true,
            variables: []
        }
    ]
};

console.log("=== 测试用例说明 ===");
console.log("1. existing-module: 模块存在，变量有新增和修改");
console.log("2. new-module: 新模块，应保持导入状态");
console.log("3. current-only-module: 当前配置中有但导入配置中没有，不应出现在结果中");
console.log("\n=== 预期结果 ===");
console.log("existing-module.enabled: false (使用当前配置的启用状态)");
console.log("existing-module.var1.enabled: false (使用当前配置的启用状态)");
console.log("existing-module.var2.enabled: true (使用当前配置的启用状态)");
console.log("existing-module.new-var.enabled: true (新变量，保持导入状态)");
console.log("new-module.enabled: false (新模块，保持导入状态)");
console.log("current-only-module: 不应出现在结果中");