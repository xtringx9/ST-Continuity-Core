# ST-Continuity-Core 开发指南

SillyTavern 扩展，用于在 AI 角色扮演中管理结构化连续性数据。允许用户定义带类型变量的数据模块，从聊天记录中提取、缓存并注入到提示词中。

## 项目结构

```
continuity-core.js        # ST 扩展加载入口 — 直接从各源文件导入，无中间层
src/singleton/            # 全局单例状态
  configManager.js        #   配置读写：加载、缓存、自动保存（纯读写职责）
  moduleConfigService.js  #   模块配置业务逻辑：导入/导出/合并/重置
  moduleCacheManager.js   #   每个聊天的模块数据缓存（嵌套 Map）
src/core/                 # 核心逻辑
  moduleExtractor.js      #   从聊天 + 世界书中解析 [模块名|键:值|...] 格式
  moduleProcessor.js      #   处理管线入口：processModuleData + groupProcessResultByMessageIndex
  pipeline/               #   管线子模块（由 moduleProcessor 调用）
    deduplicate.js        #     去重：增量/全量模块去重，messageIndexHistory 管理
    time.js               #     时间：附加结构化时间数据、智能补全时间变量
    sort.js               #     排序：标识符排序、层级压缩、ID补全
    normalize.js          #     标准化：变量名映射、兼容名处理、管线编排
    output.js             #     输出：增量/全量/提取/自动处理、字符串构建
  promptInjector.js       #   在 CHAT_COMPLETION_PROMPT_READY 事件中注入提示词
  macroManager.js         #   注册 {{CONTINUITY_PROMPT}} 等宏到 SillyTavern
  eventHandler.js         #   注册 ST 事件 → UI 更新、缓存刷新、正则初始化、世界书
  contextBottomUI.js      #   UI 协调：上下文底部、消息底部、行内渲染
  context-ui/             #   子模块：容器管理、iframe 渲染、过滤器、样式
src/modules/              # 模块数据类型和提示词
  moduleConfigTemplate.js #   配置 JSON schema、校验、规范化、默认值
  moduleParser.js         #   字符串 ↔ 结构化模块数据互转
  promptGenerator.js      #   从配置 + 缓存数据构建正式提示词字符串
  styleCombiner.js        #   样式组合器（customStyles 变量替换与容器样式处理）
src/features/             # UI 功能面板
  entry/EntryButton.js
  extension-settings/
  module-editor/          #   完整编辑器（HTML + CSS），用于模块管理
    ModuleEditor.js       #     主编排：初始化、导航、列表渲染、保存/恢复
    ModuleDetailRenderer.js #  模块详情页 HTML + 表单联动
    VariableListRenderer.js # 变量列表渲染 + 事件绑定
    DragHandler.js        #     通用拖拽排序
    GlobalSettings.js     #     全局设置面板
    Toolbox.js            #     工具箱面板
    ChangesSummary.js     #     变更检测与保存确认弹窗
    ImportExport.js       #     导入导出逻辑
src/services/             # 外部集成
  backendService.js           #   HTTP POST 到用户配置的后端
  continuityCoreServerApi.js  #   ST 服务端插件客户端（保存/读取/列表/删除/追加/快照/迁移）
  storageKeyBuilder.js        #   存储路径构建工具（符号处理与后端一致）
  perMessageStorage.js        #   每楼层模块数据存储管理器（单例）
  aiCaller.js                 #   AI 调用封装（raw/pipeline 两种模式 + 独立 API + debug 事件）
  moduleAiGenerator.js        #   模块 AI 生成器（构建提示词 + 调用 aiCaller + 解析响应 + 存储）
src/utils/                # 工具函数
  logger.js               #   日志（debugLog/infoLog/warnLog/errorLog）
  regexUtils.js           #   正则扩展集成
  worldBookUtils.js       #   世界书集成
  timeParser.js           #   时间解析
  identifierParser.js     #   标识符解析
  stringUtils.js          #   字符串工具
  textConverter.js        #   文本转换
  variableReplacer.js     #   变量替换
src/ui/                   # UI 管理
  extensionSettingsManager.js  # 扩展设置面板逻辑
  generatorDebugPanel.js       # AI 生成调试弹窗（IframeModal + 独立 HTML/CSS，主题同步）
  generatorDebugPanel.html     # 调试面板 HTML（<link> 引入 themes.css）
  generatorDebugPanel.css      # 调试面板样式（全用 themes.css 变量，ccore-debug-* 前缀）
  messageAiButton.js           # 消息内 Cc 菜单触发器（浮动定位 + 编辑模块数据）
src/shared/               # 可复用 UI 组件
  IframeDialog.js
  IframeModal.js               # 通用 iframe 模态窗口（多实例 + srcdoc 模式）
locales/                  # 翻译资源（ST 标准 i18n）
  zh-cn.json              #   中文（默认）
  en.json                  #   英文
server-plugin/continuity-core-server/  # ST 服务端插件 (Node.js)
  index.js                #   REST API：隔离用户路径的文件的增删查改
                          #   接口：saveFile, readFile, listFiles, deleteFile, ensureDir,
                          #         appendMessage, readMessage, writeMessage, readMessages,
                          #         readSnapshot, writeSnapshot, readMeta, writeMeta,
                          #         moveChat, deleteChat, listChats
assets/                   # CSS、HTML 模板
continuity-core.js        # 打包后的输出文件（ST 实际加载的文件 — 请编辑 src/）
```

## 数据流

### 提示词注入流程
1. **提取** — `moduleExtractor` 从聊天消息与世界书条目中解析 `[模块名|键:值|...]` 格式，支持嵌套模块
2. **缓存** — `moduleCacheManager` 将处理结果存入按聊天分组的嵌套 Map（`chatIdHash → rangeKey → data`）
3. **处理** — `moduleProcessor` 入口调用 `pipeline/` 子模块：`normalize`（变量名映射 + 兼容名处理）→ `deduplicate`（去重）→ `time`（时间数据附加与补全）→ `sort`（标识符/时间/ID 排序 + 层级压缩 + ID补全）→ `output`（增量/全量处理 + retainLayers + 字符串构建）
4. **注入** — `macroManager` 注册 `{{CONTINUITY_PROMPT}}`、`{{CONTINUITY_ORDER}}`、`{{CONTINUITY_USAGE_GUIDE}}`、`{{CONTINUITY_MODULE_DATA}}`、逐消息 `{{CONTINUITY_MSG_MODULE_N}}` 宏；`promptInjector` 监听 `CHAT_COMPLETION_PROMPT_READY` 事件
5. **UI** — `contextBottomUI` 渲染 3 种目标：上下文底部汇总、.mes_text 后的消息块、.mes_text 内的行内替换

### 每楼层存储流程
1. **路径构建** — `storageKeyBuilder` 生成与后端一致的存储路径（`chats/{safeCharName}/{safeFileName}/messages/{batch}.jsonl`）
2. **写入** — `perMessageStorage` 通过服务端插件将每楼层的模块数据追加到批量 JSONL 文件（每100层一个文件）
3. **快照** — 每 N 层（默认5）自动生成累积状态快照，存入 `snapshots/{batch}.json`，加速后续读取
4. **读取** — 先查最近快照，再增量计算从快照到目标楼层的累积状态
5. **迁移** — 聊天文件重命名时，通过 `moveChat` 接口自动迁移存储目录（Phase 3）
6. **脏检测** — 切换 swipe 或编辑消息后，标记从该层起快照为脏；下次读取时按需重建

## 关键概念

- **模块**：结构化数据，格式如 `[Location|name:Tavern|time:afternoon]`
- **输出模式**：`full`（全部变量）、`incremental`（仅变更变量 + 标识符）、`extract`（原始）
- **层级压缩**：高级别模块隐藏其时间/ID 范围内的低级别模块
- **时间参考标准**：指定某个模块的时间作为同一消息中其他模块的时间参考
- **变量**：模块内的字段，可设为主标识符、备用标识符、隐藏条件、不规范化

### 存储层概念
- **批量 JSONL**：每100层楼层的模块数据存储在一个 `.jsonl` 文件中，每行一条消息数据
- **快照**：累积状态的检查点，每 N 层（默认5，可配置）自动生成，存储在 `snapshots/` 目录下的 JSON 文件中
- **累积状态**：从第0层到目标楼层的所有模块数据的合并结果
- **符号处理**：角色名和文件名中的 `.` 替换为 `_`，与后端保持一致
- **存储路径**：`chats/{safeCharName}/{safeFileName}/`，与 ST 的 `data/default-user/chats/` 结构对齐
- **聊天标识**：`{safeCharName}::{safeFileName}` 作为唯一标识，Branch 聊天因文件名不同而自动隔离
- **脏检测**：`meta.json` 记录 `dirtyFrom`（null=干净，数字=从该层起脏），切换 swipe 或编辑消息时标记；读取时按需重建受影响的快照
- **Swipe 支持**：每条消息存储 `activeSwipeId`（写入时 `chat[mesId].swipe_id` 的值），用于脏检测（对比存储值与当前值是否一致）

### 存储数据结构

单条消息存储格式：
```javascript
{
    mesId: 5,
    activeSwipeId: 0,           // 写入时 chat[5].swipe_id 的值
    swipes: {
        "0": {
            moduleTagModules: ["[Location|name:Tavern]", "[Mood|val:happy]"],  // contentTag 后 — 主要
            contentTagModules: ["[Inner|val:1]"],                                // <content>...</content> 内
            extraModules: []                                                      // 其他位置
        },
        "1": { ... }
    }
}
```

- 三层分类只存 raw 字符串数组，不解析内部结构。读取时由 `moduleProcessor` 重新解析 raw
- 嵌套模块包含在顶层模块的 raw 内，不单独存储

三层分类提取逻辑：
1. 先找所有 `moduleTag` 区间（`[Module|...]` 到配对结束，考虑嵌套）→ `moduleTagModules`
2. `contentTag` 内但 `moduleTag` 外 → `contentTagModules`
3. 其余位置 → `extraModules`

快照存储格式（不含 activeSwipeId，swipe 信息从聊天记录实时读取）：
```javascript
{
    mesId: 10,
    moduleStates: { ... }       // 累积模块状态
}
```

meta.json 格式：
```javascript
{
    charName: "...",
    chatFile: "...",
    totalMessages: 100,
    lastSnapshotMesId: 50,
    dirtyFrom: null             // null = 干净，数字 = 从该层起脏
}
```

### 异步模块存储配置

存储在 `extension_config.asyncModule` 中（扩展级，非模块级）：

```javascript
asyncModule: {
    enabled: false,              // 异步模块存储（需服务器插件）
    snapshotInterval: 5,         // 快照间隔（层）
    generationMode: 'pipeline',  // AI 生成模式: 'pipeline' | 'raw'
    customApi: {                 // 独立 API 配置（留空则使用 ST 主 API）
        apiurl: '',
        key: '',
        model: '',
        source: 'openai',
        temperature: 0.3,
        max_tokens: 500,
    },
    rawSystemPrompt: '',         // raw 模式的系统提示词
    rawUserPromptTemplate: '',   // raw 模式的用户提示词模板
    pipelineModifier: '',        // pipeline 模式追加的指令
    showDebug: true,             // 生成后是否显示调试面板
}
```

- `enabled`：开启后，非正文模块异步生成 + 分开存储，需安装服务器插件
- `snapshotInterval`：快照间隔，默认5层，一般不需修改
- `generationMode`：AI 生成模式
  - `pipeline`：走 ST 完整管线（角色卡/世界书/预设），通过 `CHAT_COMPLETION_PROMPT_READY` 事件拦截修改提示词
  - `raw`：完全自定义提示词，通过 `generateRaw` 调用
- `customApi`：独立 API 配置，通过 `CHAT_COMPLETION_SETTINGS_READY` 事件拦截替换 API 参数
- `rawSystemPrompt`/`rawUserPromptTemplate`：raw 模式的提示词模板
- `pipelineModifier`：pipeline 模式追加到提示词末尾的指令
- `showDebug`：生成后是否弹出调试面板（展示提示词/响应/提取结果 + 复制按钮）
- `BATCH_SIZE = 100`：内部常量，不暴露给用户
- 关闭 `enabled` 时，行为与现有全量同步处理完全一致

### AI 调用架构

```
moduleAiGenerator（高层业务）
  ├── generateForMessage(mesId)      — 单条生成
  ├── generateForRange(from, to)     — 批量逐条生成
  └── generateForMultipleMessages(ids) — 合并生成（多条消息一次调用）
        │
        ▼
aiCaller（底层调用）
  ├── mode: 'raw'     → generateRaw + CHAT_COMPLETION_PROMPT_READY 拦截
  ├── mode: 'pipeline' → generateQuietPrompt + CHAT_COMPLETION_PROMPT_READY 拦截
  └── customApi       → CHAT_COMPLETION_SETTINGS_READY 拦截替换 API
        │
        ▼
generatorDebugPanel（调试弹窗）
  └── 展示提示词/响应/提取结果 + 复制按钮（支持多个弹窗同时存在）
```

### 存储集成事件映射

| ST 事件 | 存储动作 |
|---------|---------|
| `CHAT_CHANGED` | `perMessageStorage.initChat(charName, chatFile)` |
| `MESSAGE_RECEIVED` | 提取单条 → `writeMessage(mesId, swipeData)` → 检查快照 |
| `MESSAGE_SENT` | 同上 |
| `MESSAGE_EDITED` | 提取单条 → `updateMessage(mesId, swipeId, data)` → 标记脏 |
| `MESSAGE_DELETED` | `deleteMessage(mesId)` → 标记脏 |
| `MESSAGE_SWIPED` | 对比 activeSwipeId → 不一致则标记脏 + 更新存储 |

### 存储与缓存协调

| | moduleCacheManager | perMessageStorage |
|---|---|---|
| 存储 | 内存（Map） | 磁盘（JSONL/JSON） |
| 内容 | 管线处理后的结果 | 原始模块数据（三层分类） |
| 生命周期 | 页面刷新丢失 | 持久化 |
| 用途 | 即时 UI/提示词响应 | 历史数据持久化 + 加速 |

写入顺序：先更新内存缓存（同步，即时响应），再写存储（异步，不阻塞）。

### 实施阶段

- **Phase 1**：写入管道 — 配置 + 单条提取 + 事件注册 + Toolbox 按钮 + 旧聊天构建
- **Phase 2**：读取加速 — 累积状态 → 管线输入格式转换 + 加速开关
- **Phase 3**：生命周期 + 脏快照 — 聊天重命名/删除处理 + 自动重建

## UI 架构

### 菜单触发器模式

Cc 按钮（消息内）和 EntryButton（全局）都采用"触发器 + 展开菜单"模式：

- **触发器**：单图标按钮，点击展开/收起菜单
- **菜单容器**：带边框（`2px solid` + `border-radius:6px`），内部按钮无边框，作为整体视觉组
- **展开方向**：向右展开（与 EntryButton 一致）
- **高度对齐**：菜单容器高度显式锁死，确保与触发器对齐（Cc: 22px，EntryButton: 30px）
- **激活样式**：触发器激活时用 `filter: brightness(0.85)`（主题无关，避免白色主题下半透明灰透出深色 body）

**Cc 浮动定位**：紧贴消息左下角（`position:absolute; left:0; bottom:0; z-index:9999`），仿 ST 的 swipe 按钮。默认 `opacity:0.5`，hover `1.0`。

**异步模块未开启时**：重新生成/编辑按钮置灰（`opacity:0.4 + cursor:not-allowed`），不绑定事件。

### IframeModal 多实例 + srcdoc 模式

`src/shared/IframeModal.js` 支持：
- **多实例**：`modalCounter` 生成唯一 modalId/iframeId，`_handleMessage` 加 modalId 匹配。同实例 `if (this.backdrop) return` 防重开
- **srcdoc 模式**：`open()` 新增 `options.srcdoc`，传 HTML 字符串时用 `iframe.srcdoc` 代替 `iframe.src`。用于 `openContextBottomAsModal` 汇总弹窗

### 主题同步机制

调试面板与 module-editor 主题系统统一：
- 读 `localStorage.st_continuity_theme` 设置 `data-theme`
- `<link>` 引入 `themes.css`（零变量重复，所有样式用 CSS 变量）
- iframe 内 ST 的 MutationObserver 不运行，需手动调用 `applyI18nToStaticElements`

### openContextBottomAsModal

底部固定汇总改为弹窗模式（原 `checkUItoContextBottom` 调用注释保留）：
- 用 IframeModal srcdoc 模式，单实例
- 复用原渲染逻辑（`buildStyledProcessResult` + `getModulesDataAndStyles` + `interactionScript`）
- container 背景设透明（`.st-continuity-iframe-container` 的默认深色背景不适用）

### 编辑模块数据（就地 textarea）

Cc 菜单的"编辑"操作：
- 隐藏模块展示区 iframe，插入 textarea + 保存/取消按钮
- 保存/取消按钮用 ST 原生样式（`menu_button fa-solid fa-check/fa-times interactable`）
- 读取 `perMessageStorage.readMessage(mesId, swipeId)` 获取 `moduleTagModules` 的 raw
- 保存用 `perMessageStorage.updateMessage`，保留 `contentTagModules`/`extraModules` 不变

## 构建与开发

- **无构建步骤** — 纯 JavaScript，无打包工具。`continuity-core.js` 是编译输出，编辑 `src/` 下的文件
- **无测试** — 仓库中没有测试框架或测试文件
- **扩展运行在 SillyTavern 中** — 通过 manifest.json 在 `scripts/extensions/third-party/ST-Continuity-Core/` 加载
- **服务端插件** 位于 `server-plugin/continuity-core-server/` — 由 ST 的服务端插件系统单独加载

## 导入导出规范

### 核心原则：直接导入，不通过 index.js 中转

`src/index.js` 仅导出 `continuity-core.js`（ST 扩展加载入口）所需的符号，不作为内部模块的中转站。

**内部模块之间必须直接从源文件导入：**

```javascript
// ✓ 正确 — 直接从源文件导入
import configManager from '../singleton/configManager.js';
import { debugLog, infoLog } from '../utils/logger.js';
import { processModuleData } from '../core/moduleProcessor.js';

// ✗ 错误 — 不要通过 index.js 中转
import { configManager, debugLog, processModuleData } from '../index.js';
```

### ST 外部依赖的导入路径

从 SillyTavern 核心代码导入时，注意各模块的来源不同：

| 符号 | 来源文件 | 路径（相对于 `src/` 下1层目录） |
|------|----------|------|
| `chat`, `chat_metadata`, `characters`, `this_chid`, `saveSettings`, `getRequestHeaders`, `reloadCurrentChat`, `eventSource`, `event_types` | `public/script.js` | `../../../../../../script.js` |
| `getContext`, `extension_settings` | `public/scripts/extensions.js` | `../../../../../extensions.js` |
| `currentUser`, `getCurrentUserHandle` | `public/scripts/user.js` | `../../../../../user.js` |
| `findChar`, `uuidv4` | `public/scripts/utils.js` | `../../../../../utils.js` |
| `world_info`, `METADATA_KEY` 等 | `public/scripts/world-info.js` | `../../../../../world-info.js` |
| `getRegexScripts` 等 | `public/scripts/regex/engine.js` | `../../../../regex/engine.js` |

路径层数规则（从 `src/` 算起）：
- `src/` 下1层（如 `singleton/`、`core/`）：到 `script.js` = 6层 `../`，到 `extensions.js` = 5层 `../`
- `src/` 下2层（如 `core/context-ui/`、`features/module-editor/`、`core/pipeline/`）：各加1层 `../`
- `src/` 本身：到 `script.js` = 5层 `../`，到 `extensions.js` = 4层 `../`

### pipeline 子模块的导入规则

`core/pipeline/` 内的子模块按管线顺序单向依赖，**禁止反向依赖**：

```
output.js → normalize.js → deduplicate.js
                         → time.js
                         → sort.js
```

- `moduleProcessor.js`（入口）只导入 `output.js`，不直接导入其他管线子模块
- `output.js` 导入 `normalize.js`；`normalize.js` 导入 `deduplicate.js`、`time.js`、`sort.js`
- `sort.js`、`time.js`、`deduplicate.js` 之间互不依赖
- 外部模块（如 `promptGenerator.js`、`macroManager.js`）只从 `moduleProcessor.js` 导入，不直接导入 `pipeline/` 子模块

### 新增模块时

1. 在源文件中定义并 `export`
2. 需要该模块的文件直接 `import` 源文件
3. 只有 `continuity-core.js` 需要的符号才直接在该文件中导入

### 事件注册规范

**所有 ST 事件注册必须走 `eventHandler.registerEvent`，不直接用 `eventSource.on`。**

```javascript
// ✓ 正确 — 走 eventHandler 统一注册
this.registerEvent(event_types.CHARACTER_MESSAGE_RENDERED, addAiButtonToMessage);

// ✗ 错误 — 绕过 eventHandler，丢失统一错误处理/事件引用管理/调试支持
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, addAiButtonToMessage);
```

`registerEvent` 的好处：
- 统一 try-catch 错误处理
- 事件处理器引用纳入 `eventHandlers` Map（支持排查/卸载）
- `printEvent` 参数支持调试

**ST 事件知识点**：
- `noEmitTypes = ['swipe', 'impersonate', 'continue']`（[script.js](file:///e:/Data/Apps/SillyTavern/public/script.js)）— 当 `addOneMessage` 的 `type` 为这三者时，**不触发** `MESSAGE_RECEIVED`/`CHARACTER_MESSAGE_RENDERED`。swipe 切换时需监听 `MESSAGE_SWIPED` 或用 MutationObserver 兜底
- `GENERATION_ENDED` 在生成结束（含失败/中止）时触发，`CHARACTER_MESSAGE_RENDERED` 只在生成成功时触发

## 配置系统

- **双配置结构**：`extension_config`（全局开关、后端 URL、调试日志、按钮类型、异步模块存储）和 `module_config`（模块、全局设置）
- **持久化**：通过 ST 的 `saveSettings` 存储在 `extension_settings[extensionName]` 中（见下方"保存机制"说明）
- **DEV_SAVE_GUARD**（`configManager.js` 中的 `ENABLE_DEV_SAVE_GUARD`）— 为 `false` 时阻止所有保存，设置为 `true` 恢复正常操作
- **normalizeConfig()**（`moduleConfigTemplate.js`）— 所有保存/导入/导出操作的规范化入口（仅处理 `module_config`，不处理 `extension_config`）
- **extension_config 字段补全** — `DEFAULT_EXTENSION_CONFIG` 定义默认值，`setExtensionConfig` 中做字段补全

### 保存机制

ST 提供两个保存函数，行为完全不同：

| 函数 | 行为 | 适用场景 |
|------|------|----------|
| `saveSettings()` | **立即**写入磁盘 | 用户主动保存（如点击保存按钮） |
| `saveSettingsDebounced()` | **1 秒防抖**，每次调用重置计时器 | 非关键路径的自动保存（如世界书、正则保存） |

**关键区别**：`saveSettingsDebounced(true)` 的 `true` 参数是 `loopCounter`，不是"立即执行"标志。调用后仍需等 1 秒才写入磁盘。

**本项目规则**：
- `configManager.saveModuleConfigNow()` 使用 `saveSettings()` — 确保用户保存操作立即持久化
- `configManager.scheduleAutoSave()` 使用 `saveSettings()` — 通过 1 秒 setTimeout 延迟调用，但最终执行的是立即写入
- 其他模块（`worldBookUtils`、`regexUtils`）使用 `saveSettingsDebounced` — 遵循 ST 标准做法

### normalizeConfig 的副作用

`normalizeConfig()` 会生成一个**全新对象**，只保留已知字段。这意味着：
- 保存后 `this.moduleConfig` 变成新对象，与之前的引用断开
- 任何未在 `normalizeConfig` 中列出的自定义字段会被丢弃
- 调用 `setModules()` 后再调用 `saveModuleConfigNow()` 时，`normalizeConfig` 会重新生成对象

## 常见陷阱

### 1. `saveSettingsDebounced` 不是立即保存

```javascript
// ✗ 错误 — 1 秒后才写入，用户刷新会丢数据
saveSettingsDebounced(true);

// ✓ 正确 — 立即写入磁盘
saveSettings();
```

### 2. DragHandler 中 `this` 绑定

`DragHandler.js` 的函数通过 `doc.addEventListener` 绑定时，`this` 指向 DOM 元素。但通过箭头函数调用时 `this` 丢失：

```javascript
// ✗ 错误 — 箭头函数中 this 不是 DOM 元素
el.addEventListener('dragend', (e) => handleDragEnd(e, doc));
// handleDragEnd 内部 this.classList 报错

// ✓ 正确 — 传入 event.currentTarget
el.addEventListener('dragend', (e) => handleDragEnd(e, doc, e.currentTarget));
```

### 3. ChangesSummary 不检测顺序变化

`compareModuleLists` 和 `compareVariables` 使用 `Map<name, item>` 查找，只检测内容差异。拖拽换位后内容相同但顺序不同，需要额外检测 `reordered` 情况。

### 4. `continuity-core.js` 的路径层级

`continuity-core.js` 在项目根目录（`src/` 外），到 ST 核心文件的路径比 `src/` 下1层目录少1层 `../`：
- 到 `extensions.js` = `../../../extensions.js`（3 层）
- 到 `script.js` = `../../../../script.js`（4 层）

### 5. `navigator.clipboard` 在非安全上下文不可用

HTTP 局域网（非 HTTPS）下 `navigator.clipboard` 为 `undefined`，直接调用 `navigator.clipboard.writeText` 会报 `Cannot read properties of undefined`。

```javascript
// ✓ 正确 — 优先 clipboard API，不可用时 fallback 到 execCommand
async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
}
```

iframe 内的复制按钮尤其要注意（iframe 可能是非安全上下文）。

### 6. swipe 类型不触发 `CHARACTER_MESSAGE_RENDERED`

ST 源码 `noEmitTypes = ['swipe', 'impersonate', 'continue']`，当 `addOneMessage` 的 `type` 为这三者时，不触发 `MESSAGE_RECEIVED`/`CHARACTER_MESSAGE_RENDERED`。

**影响**：Cc 按钮 append 到 `.mes` 内，ST 重新渲染消息块（swipe 切换/生成/编辑）时会清除 `.mes` 子元素，按钮消失。而 swipe 类型不触发 `CHARACTER_MESSAGE_RENDERED`，按钮不重新添加。

**解决**：
- 监听 `MESSAGE_SWIPED` + `GENERATION_ENDED` 事件（在 eventHandler 注册）
- `MutationObserver` 监听 `#chat` 子元素变化作为兜底（200ms 防抖）

### 7. `getCurrentChatId()` 判断聊天页不可靠

`getCurrentChatId()` 在群组聊天无 `chat_id` 时也返回 `undefined`，误判为非聊天页。

**正确做法**：用 `contextBottomUI.isInChatPage()`，它优先用 `getContext().characterId/groupId` 判断（`characterId = this_chid`，非聊天页时 `undefined`；`groupId = selected_group`，群组聊天时有值），DOM 检查作为兜底。

```javascript
// ✓ 正确 — 复用统一的 isInChatPage
import { isInChatPage } from '../core/contextBottomUI.js';
if (isInChatPage()) { ... }

// ✗ 错误 — getCurrentChatId 在群组聊天时不可靠
if (getCurrentChatId()) { ... }
```

### 8. Cc 按钮被 ST 重新渲染清除

Cc 按钮 `append` 到 `.mes` 元素内部。ST 在 swipe 切换/生成新内容/编辑消息时会调用 `addOneMessage` 重建 `.mes` 元素，append 进去的浮动按钮作为 `.mes` 子元素被一起清除。

**解决**：`MutationObserver` 监听 `#chat` 直接子元素（`.mes`）的添加/删除/替换，触发防抖刷新重新添加按钮。事件监听（`MESSAGE_SWIPED`/`GENERATION_ENDED`）无法覆盖所有场景，Observer 作为兜底。

### 9. PowerShell 不支持 heredoc

`$(cat <<'EOF')` 在 PowerShell 中不支持，git commit 会静默失败。

```powershell
# ✗ 错误 — PowerShell 不支持 heredoc
git commit -m "$(cat <<'EOF'
提交信息
EOF
)"

# ✓ 正确 — 用多个 -m 参数
git commit -m "标题" -m "正文行1" -m "正文行2"
```

## 待确认项

- **聊天重命名事件**：ST 没有 `CHAT_RENAMED` 事件。重命名后触发 `reloadCurrentChat()` → `CHAT_CHANGED`。需通过对比存储路径与新路径间接检测重命名。具体检测方案待定。
- **角色重命名事件**：角色重命名后，存储路径中的 `safeCharName` 会变化，需迁移整个角色目录。检测方案同聊天重命名（对比存储路径）。
- **异步模式下模块内容判空**：开启异步生成后，模块原始内容可能直接写入存储而非聊天记录。读取时需判空 + 校验内容一致性。细节待实现时细化。
- **chatIdHash 不可用于分支聊天**：分支聊天的 hash 与主聊天相同，不能作为唯一标识。使用 `charName + chatFile` 组合替代。
- **异步存储 per-chat 操作按钮迁移**：当前"手动提取当前聊天"和"重建快照"按钮放在异步存储 tab（全局设置），但这些操作本质是 per-chat 的。角色绑定页（Profiles）做好后，应迁移到该页面，异步 tab 只保留全局配置（开关、快照间隔）。

## 后续优化项

- **提取时数据对比**：覆写已有楼层前，对比新旧数据差异，让用户选择保留哪个版本（当前策略：新数据直接覆写旧数据，空数据不覆盖）
- **提取进度反馈**：提取当前聊天时，长聊天可能耗时较长，应加进度提示（如 toastr 或进度条）
- **提取楼层输入优化**：改为更友好的 UI（如两个 number input），替代 prompt 弹窗
- **JSONL 行号与 mesId 对齐**：已实现 — 服务端 `writeMessage`/`readMessage` 支持 `batchStart` 参数，按行号（mesId - batchStart）直接定位读写，铁律：第N行 = mesId - batchStart
- **`appendMessage` 方法重命名**：已完成 — 改为 `writeMessage`，支持 `{ merge, skipEmpty }` 选项；`updateMessage` 委托给 `writeMessage({ merge: true, skipEmpty: false })`

## 国际化（i18n）

采用 SillyTavern 标准 i18n 机制，翻译资源存放在 `locales/` 目录，通过 `manifest.json` 声明加载。

### 翻译资源

- `locales/zh-cn.json` — 中文（默认语言，ST 回退语言）
- `locales/en.json` — 英文
- 所有 key 统一使用 `ccore_` 前缀，避免与其他扩展冲突
- 两个文件必须保持 key 一一对应

### 使用方式

**HTML 静态文本**（ST 主文档中的面板，如 `settings-panel.html`）：
```html
<span data-i18n="ccore_settings_enabled">启用插件</span>
<input data-i18n-placeholder="ccore_search_placeholder" placeholder="搜索模块...">
```
ST 的 MutationObserver 会自动翻译 `data-i18n` 和 `data-i18n-placeholder` 属性。

**JS 动态文本**：
```javascript
import { translate } from '../../../../../../i18n.js';
btn.textContent = translate('ccore_btn_save');
```

**iframe 内的静态文本**（如 `module-editor/index.html`）：
iframe 内 ST 的 MutationObserver 不会运行，`data-i18n` 属性不会自动翻译。必须在 JS 初始化时手动调用 `applyI18nToStaticElements(doc)` 遍历翻译：
```javascript
function applyI18nToStaticElements(doc) {
    doc.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translated = translate(key);
        if (translated && translated !== key) el.textContent = translated;
    });
    doc.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const translated = translate(key);
        if (translated && translated !== key) el.placeholder = translated;
    });
}
```

### 新增翻译的步骤

1. 在 `locales/zh-cn.json` 和 `locales/en.json` 中添加对应的 key-value
2. HTML 中用 `data-i18n="key"` 标记静态文本，JS 中用 `translate('key')` 处理动态文本
3. iframe 内的 HTML 还需确保 `applyI18nToStaticElements` 被调用

### 不需要 i18n 的文本

- `infoLog`/`debugLog`/`warnLog`/`errorLog` 日志输出（仅开发者可见）
- 世界书条目的 `comment` 和 `content`（由用户自定义内容）
