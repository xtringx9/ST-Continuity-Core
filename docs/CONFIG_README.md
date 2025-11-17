# ST-Continuity-Core 配置系统文档

## 概述

本文档详细说明了ST-Continuity-Core扩展的配置系统架构，包括所有与配置相关的脚本文件及其职责。当需要修改或增加配置功能时，请参考此文档确保所有相关文件都得到相应更新。

## 核心配置文件

### 1. 模块配置模板文件
**文件路径**: `src/modules/moduleConfigTemplate.js`
**职责**: 定义整个系统的配置结构和验证规则

#### 主要功能
- **配置结构定义**: 定义模块、变量、全局设置等所有字段的结构
- **验证规则**: 提供配置验证逻辑，确保数据完整性
- **默认值管理**: 为所有可选字段提供合理的默认值
- **规范化处理**: 将用户输入转换为标准格式

#### 核心函数
```javascript
// 配置验证
validateConfig(config) // 验证配置是否符合模板规范

// 配置规范化
normalizeConfig(config) // 规范化配置，填充默认值

// 字段验证
validateModule(module, index) // 验证单个模块
validateVariable(variable, index) // 验证单个变量

// 工具函数
generateId() // 生成唯一ID
sanitizeString(value) // 字符串清理
```

### 2. 配置导入导出管理器
**文件路径**: `src/utils/configImporterExporter.js`
**职责**: 处理配置的导入、导出和验证流程

#### 主要功能
- **导入功能**: 从JSON文件导入配置，包含验证逻辑
- **导出功能**: 将当前配置导出为JSON文件
- **数据收集**: 从DOM收集模块和变量数据
- **事件绑定**: 绑定导入导出按钮的事件处理

#### 核心函数
```javascript
// 初始化
initJsonImportExport() // 初始化导入导出功能

// 导入功能
importModuleConfigWithValidation(file) // 带验证的导入

// 导出功能
collectModulesForExport() // 收集模块数据用于导出

// 事件绑定
bindSaveButtonEvent() // 绑定保存按钮事件
```

### 3. 配置管理器
**文件路径**: `src/utils/configManager.js`
**职责**: 管理配置的加载、保存和基础操作

#### 主要功能
- **配置存储**: 管理配置的持久化存储
- **配置操作**: 提供获取、设置配置的API
- **版本管理**: 处理配置版本兼容性

#### 核心配置结构
```javascript
{
    version: '1.1.0',
    lastUpdated: 'ISO日期字符串',
    globalSettings: {
        corePrinciples: '',
        formatDescription: ''
    },
    modules: [] // 模块数组
}
```

### 4. 模块配置管理器
**文件路径**: `src/modules/moduleConfigManager.js`
**职责**: 专门处理模块级别的配置操作

#### 主要功能
- **模块配置保存**: 保存模块配置到配置管理器
- **模块配置导入导出**: 处理模块级别的导入导出
- **配置转换**: 在DOM数据和配置对象之间转换

## 配置字段说明

### 模块字段 (Module Fields)

#### 必填字段
- `name`: 模块唯一标识符（必填）
- `displayName`: 模块显示名称（必填）
- `enabled`: 模块启用状态（必填，布尔值）

#### 可选字段
- `prompt`: 生成提示词
- `timingPrompt`: 生成时机提示词
- `contentPrompt`: 内容提示词
- `outputPosition`: 输出位置（after_body/before_body）
- `outputMode`: 输出模式（full/compact）
- `retainLayers`: 保留层数（默认-1）
- `rangeMode`: 数量范围模式（unlimited/specified/range）
- `compatibleModuleNames`: 兼容模块名称
- `timeReferenceStandard`: 时间参考标准

### 变量字段 (Variable Fields)

#### 必填字段
- `name`: 变量唯一标识符（必填）
- `displayName`: 变量显示名称（必填）

#### 可选字段
- `description`: 变量描述
- `type`: 变量类型（text/number/select）
- `defaultValue`: 默认值
- `isIdentifier`: 是否标识符变量
- `isBackupIdentifier`: 是否备用标识符
- `compatibleVariableNames`: 兼容变量名称
- `required`: 是否必填
- `options`: 选项列表（select类型时使用）

## 修改配置时的注意事项

### 1. 添加新字段时的步骤

1. **更新模板文件** (`moduleConfigTemplate.js`)
   - 在 `MODULE_CONFIG_TEMPLATE` 中添加新字段定义
   - 在 `DEFAULT_CONFIG_VALUES` 中设置默认值
   - 在 `validateModule` 或 `validateVariable` 中添加验证规则

2. **更新导入导出功能** (`configImporterExporter.js`)
   - 在 `collectModulesForExport` 中添加字段收集逻辑
   - 确保导入时能正确处理新字段

3. **更新UI相关文件**
   - 相应的HTML模板文件
   - 模块管理器的渲染逻辑

### 2. 修改字段验证规则

1. **更新验证函数** (`moduleConfigTemplate.js`)
   - 修改 `validateModule` 或 `validateVariable` 中的验证逻辑
   - 更新错误和警告消息

2. **测试验证功能**
   - 使用测试用例验证新规则
   - 确保向后兼容性

### 3. 处理配置版本升级

1. **更新版本号** (`configManager.js`)
   - 修改 `DEFAULT_CONFIG` 中的版本号
   - 添加版本迁移逻辑（如果需要）

2. **处理旧配置**
   - 在 `normalizeConfig` 中添加旧配置转换逻辑
   - 确保旧配置能正确升级到新版本

## 测试和验证

### 配置验证测试
```javascript
// 测试有效配置
const validConfig = { /* 有效配置数据 */ };
const validation = validateConfig(validConfig);
console.log('验证结果:', validation);

// 测试无效配置
const invalidConfig = { /* 无效配置数据 */ };
const invalidValidation = validateConfig(invalidConfig);
console.log('验证结果:', invalidValidation);
```

### 导入导出测试
- 测试配置导入功能
- 测试配置导出功能
- 验证导入导出数据的完整性

## 常见问题

### Q: 添加新字段后导入旧配置失败？
A: 在 `normalizeConfig` 函数中为新字段设置合理的默认值，确保旧配置能正常升级。

### Q: 验证规则太严格导致合法配置被拒绝？
A: 检查验证逻辑，确保只对必填字段进行严格验证，可选字段应有合理的默认值处理。

### Q: 导入的配置无法正确渲染？
A: 检查 `collectModulesForExport` 和渲染逻辑是否一致，确保所有字段都能正确收集和显示。

## 维护建议

1. **保持文档同步**: 修改配置系统时，及时更新此文档
2. **测试覆盖**: 添加新功能时，编写相应的测试用例
3. **版本控制**: 重大修改时考虑版本兼容性
4. **错误处理**: 提供清晰的错误信息和用户指导

---

**最后更新**: 2025-11-17  
**版本**: 1.0.0
