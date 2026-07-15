# 配置体系说明

> 更新日期：2026-07-15

## 三套配置结构

| 配置 | 存储位置 | 管理者 | 内容 |
|---|---|---|---|
| `extension_config` | `extension_settings[extensionName]['extension_config']` | `configManager`（singleton） | 全局开关、后端 URL、调试日志、按钮类型、异步模块存储配置 |
| `module_config` | `extension_settings[extensionName]['module_config']` | `configManager`（singleton） | 模块定义、全局设置（标题标签、输出规则等） |
| `generator_config` | `extension_settings[extensionName]['generator_config']` | `configManager`（singleton） | 生成内容配置（小剧场、角色心理等） |

所有配置通过 ST 的 `saveSettings()` 持久化到 `settings.json`。

## 关键文件与职责

### 配置读写
- **`src/singleton/configManager.js`** — 单例，配置的内存缓存 + 自动加载/保存。改配置时主要通过它。
  - `load()` / `getExtensionConfig()` / `getModules()` / `getGeneratorConfig()` / `getGlobalSettings()`
  - `setExtensionConfig()` / `setModules()` / `scheduleAutoSave()` / `saveModuleConfigNow()`
  - `isExtensionEnabled()` / `isLoaded`
  - 字段补全：`setExtensionConfig` 用 `DEFAULT_EXTENSION_CONFIG` 补全缺失字段
- **`src/singleton/moduleConfigService.js`** — 模块配置业务逻辑（导入/导出/合并/重置），调用 `normalizeConfig`
- **`src/features/module-editor/ImportExport.js`** — 配置导入导出 UI 逻辑（模块配置）

### 配置 schema / 规范化
- **`src/config/moduleConfigTemplate.js`** — `module_config` 的 schema、校验、规范化、默认值
  - `normalizeConfig()` — **所有保存/导入/导出操作的规范化入口**（仅处理 `module_config`）。改变模块字段时必须同步更新此处
  - `DEFAULT_CONFIG_VALUES` — 模块级字段默认值
- **`src/config/generatorConfigTemplate.js`** — `generator_config` 的 schema、校验、规范化、默认值
  - `normalizeGeneratorConfig()` / `DEFAULT_GENERATOR_CONFIG_VALUES`

### UI 收集与渲染
- **`src/features/module-editor/ModuleDetailRenderer.js`** — 模块详情页 HTML + 表单联动（新增字段需加 UI 控件 + 事件 + 数据绑定）
- **`src/features/module-editor/ModuleEditor.js`** — 模块编辑器主编排（导航、列表渲染、保存/恢复）
- **`src/features/module-editor/ChangesSummary.js`** — 变更检测（新增字段需在 `compareModuleLists` / `compareVariables` 中处理）
- **`src/features/generator-editor/GeneratorEditor.js`** — 生成内容配置编辑器
- **`src/ui/extensionSettingsManager.js`** — 扩展设置面板逻辑（`extension_config` 的 UI）

### 提示词生成（读配置）
- **`src/modules/promptGenerator.js`** — 从配置 + 缓存数据构建提示词字符串。过滤逻辑（outputPosition × outputMode × includeInModuleData）在此文件
- **`src/core/context-ui/moduleFilters.js`** — UI 渲染用的模块过滤（与提示词过滤条件保持一致）

## 保存机制

ST 提供两个保存函数，行为不同：
- `saveSettings()` — 立即写入磁盘（`configManager.saveModuleConfigNow()` 用此）
- `saveSettingsDebounced()` — 1 秒防抖（其他模块如 worldBookUtils/regexUtils 用此）

本项目规则：
- `saveModuleConfigNow()` → `saveSettings()` — 用户主动保存时用
- `scheduleAutoSave()` → setTimeout 1 秒后调 `saveSettings()` — 非关键路径自动保存

### normalizeConfig 的副作用
`normalizeConfig()` 生成**全新对象**，只保留已知字段：
- 保存后 `this.moduleConfig` 变成新对象，与之前引用断开
- 未在 `normalizeConfig` 中列出的自定义字段会被丢弃
- **新增模块字段必须在 normalizeConfig 的 `DEFAULT_CONFIG_VALUES` + 规范化逻辑中同步添加**

## 新增模块字段时的检查清单

1. `src/config/moduleConfigTemplate.js`
   - `DEFAULT_CONFIG_VALUES` 加默认值
   - `normalizeConfig()` 的规范化逻辑加字段
   - `validateConfig()` 的校验逻辑（如需要）
2. `src/features/module-editor/ModuleDetailRenderer.js`
   - HTML 加 UI 控件
   - `updateModuleData()` 加数据读取
   - 事件监听加绑定
3. `src/features/module-editor/ChangesSummary.js`
   - `compareModuleLists` / `compareVariables` 加字段对比（如需要检测变更）
4. `src/modules/promptGenerator.js` + `src/core/context-ui/moduleFilters.js`
   - 如字段影响过滤逻辑，同步更新所有过滤条件
5. `locales/zh-cn.json` + `locales/en.json`
   - 加翻译 key
6. `CLAUDE.md`
   - 关键概念节补充说明

## 新增 generator 字段时的检查清单

1. `src/config/generatorConfigTemplate.js` — schema + normalize + 默认值
2. `src/features/generator-editor/GeneratorEditor.js` — UI 控件 + 数据绑定
3. `locales/` — 翻译

## raw 数据处理（不参与配置体系）

以下函数处理原始模块数据（从聊天文本提取），与配置读写无关：
- `mergeModulesByOrder`（`src/core/pipeline/output.js`）— 按顺序合并同标识符模块
- `groupProcessResultByMessageIndex`（`src/core/moduleProcessor.js`）— 按消息索引分组处理结果
- `extractModulesFromChat`（`src/core/moduleExtractor.js`）— 从聊天记录提取模块数据
