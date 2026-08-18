# ST-Continuity-Core 开发指南

SillyTavern 扩展，用于在 AI 角色扮演中管理结构化连续性数据。允许用户定义带类型变量的数据模块，从聊天记录中提取、缓存并注入到提示词中。

## 项目结构

```
continuity-core.js        # ST 扩展加载入口 — 直接从各源文件导入，无中间层
src/singleton/            # 全局单例状态
  configManager.js        #   配置读写：加载、缓存、自动保存（纯读写职责）
  moduleConfigService.js  #   模块配置业务逻辑：导入/导出/合并/重置
  moduleCacheManager.js   #   每个聊天的模块数据缓存（嵌套 Map）
  generatedContentCache.js #  生成内容内存缓存（per mesId + generatorName）
src/config/                # 配置 schema 定义
  moduleConfigTemplate.js #   模块配置 JSON schema、校验、规范化、默认值
  generatorConfigTemplate.js # 生成内容配置 schema、校验、规范化、默认值
src/core/                 # 核心逻辑
  moduleExtractor.js      #   从聊天 + 世界书中解析 [模块名|键:值|...] 格式
  moduleProcessor.js      #   处理管线入口：processModuleData + groupProcessResultByMessageIndex
  pipeline/               #   管线子模块（由 moduleProcessor 调用）
    deduplicate.js        #     去重：增量/全量模块去重，messageIndexHistory 管理
    time.js               #     时间：附加结构化时间数据、智能补全时间变量
    sort.js               #     排序：标识符排序、层级压缩、ID补全
    normalize.js          #     标准化：变量名映射、兼容名处理、管线编排
    output.js             #     输出：增量/全量/提取/自动处理、字符串构建
  promptInjector.js       #   ⚠️ 僵尸代码：定义了但从未实例化，主聊天注入实际靠宏+世界书（见 docs/PROMPT_INJECTION_ANALYSIS.md 问题1）
  macroManager.js         #   注册 {{CONTINUITY_PROMPT}} 等宏到 SillyTavern
  eventHandler.js         #   注册 ST 事件 → UI 更新、缓存刷新、正则初始化、世界书
  contextBottomUI.js      #   UI 协调：上下文底部、消息底部、行内渲染
  context-ui/             #   子模块：容器管理、iframe 渲染、过滤器、样式
src/modules/              # 模块数据解析和提示词
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
  generator-editor/       #   生成内容配置编辑器（结构与 module-editor 一致）
    GeneratorEditor.js    #     主编排：初始化、导航、列表渲染、保存/恢复
    index.html            #     iframe.src 模式 HTML（link themes.css + layout.css）
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
  messageAiButton.js           # 消息内 Cc 菜单触发器（浮动定位 + 编辑模块数据）
src/features/generation-records/  # 生成记录面板（2026-08-18 重构，替代 generatorDebugPanel + generatorHistoryPanel）
  generationRecordsPanel.js  # 单一面板双视图：列表（筛选卡片）+ 详情（保存[追加/覆盖]/抛弃/导航/中止）
  generationRecordsPanel.html # 生成记录面板 HTML（themes.css 变量，ccore-records-* 前缀）
  # ⚠️ 通过 window.openGenerationRecords / updateRunningRecord / closeRunningRecord 全局调用（continuity-core.js 副作用导入）
src/shared/               # 可复用 UI 组件
  IframeDialog.js
  IframeModal.js               # 通用 iframe 模态窗口（多实例 + srcdoc 模式）
  styles/
    themes.css                 # 共享主题变量（module-editor/generator-editor/debug 面板共用）
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

### 取数入口（processModuleData 调用方）
所有取数最终汇聚到 `moduleProcessor.processModuleData()`，只有两条数据来源：①`moduleCacheManager` 缓存命中（仅 `auto` 类型且当前范围已有缓存时）；②未命中 → `extractModulesFromChat()`（`moduleExtractor.js`）从 `chat[]` 每条 `mes` 正则解析 `[模块名|k:v]`（嵌套栈解析）+ 世界书条目（`getCurrentCharBooksModuleEntries`，source:'worldbook'）。

样式合成 `buildStyledProcessResult`（processResultBuilder.js）= `processModuleData('auto')` + `insertCombinedStylesToDetails()`（styleCombiner），产出 `content[m].containerStyles`（完整气泡 HTML，含变量替换）与每条 `entry.customStyles`。

各入口区别仅在过滤器、取哪个字段、是否套样式：

| 入口 | 调用函数 | 过滤器 | 取字段 | 套样式 |
|------|---------|--------|--------|--------|
| 消息内行内替换 | `inlineMessageRenderer.renderCurrentMessageContext` | `getRenderUIFilteredModuleConfigs`（非 after_body） | `entry.customStyles` 替换 .mes_text raw | 是 |
| 消息底部块 | `contextBottomUI.updateUItoMsgBottom` | `getMsgUIFilteredModuleConfigs` | 按 mesid 分组渲染到 .mes_text 下方 | 是 |
| 上下文底部汇总 | `contextBottomUI.updateUItoContextBottom` | `getContextBottomUIFilteredModuleConfigs` | `getModulesDataAndStyles` 拼 bottomStyles 模板 | 是 |
| 汇总弹窗 | `contextBottomUI.openContextBottomAsModal` | `getContextBottomUIFilteredModuleConfigs` | 同上 | 是 |
| 汇总→LLM 宏 | `promptGenerator` `{{CONTINUITY_MODULE_DATA}}`（:724） | `getContextBottomFilteredModuleConfigs`（after_body+full+retainLayers≠0 或 includeInModuleData 或 incremental） | `contentString` | 否 |
| 逐消息宏 | `promptGenerator` `{{CONTINUITY_MSG_MODULE_N}}`（:787） | `getChatFilteredModuleConfigs`（无 retainLayers 检查） | `contentString` | 否 |
| 手机 | `phoneMode.renderPhoneHtml` | `[{name: scene.moduleName}]`（唯一按单模块过滤） | `content[m].containerStyles` | 是 |
| 缓存预热（写） | `moduleCacheManager.updateModuleCache` | `null`（全量） | 写入缓存，不直接展示 | 否 |
| 编辑器预览 | `Toolbox.js` 提取按钮（:593） | 用户选定模块（selectedModuleNames + isForce/show* 参数） | `contentString` 显示到 resultArea | 否 |

要点：
- `buildStyledProcessResult` = `processModuleData('auto')` + styleCombiner 样式合成。消息内行内替换、消息底部块、上下文底部/弹窗汇总、手机都走它；发给 LLM 的宏与编辑器预览是唯一直连 `processModuleData` 不套样式的入口。
- 手机是**唯一按单个 moduleName 过滤**的入口；其余均按 outputPosition/outputMode/retainLayers 批量过滤。
- 缓存写入只发生在 `processModuleData` 内部当 `processType==='auto' && moduleFilters===null`（全量）时，由 `moduleCacheManager.updateModuleCache` 触发。带 `moduleFilters` 的调用（如手机）自身不写缓存，但会命中已有全量缓存再过滤。

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
- **输出位置（outputPosition）**：决定模块数据渲染到哪里。`after_body` 的模块进 `{{CONTINUITY_MODULE_DATA}}` 汇总提示词 + 上下文底部 UI；非 `after_body`（`body`/`embedded`/`specific_position` 等）走消息内部渲染
- **outputPosition 与 outputMode 的过滤关系**：`{{CONTINUITY_MODULE_DATA}}`（`generateModuleDataPrompt`）只包含 `outputPosition==='after_body' && outputMode==='full' && retainLayers!==0` 的全量模块 + 所有增量模块；`retainLayers===0` 的全量模块被过滤掉。逐消息宏 `{{CONTINUITY_MSG_MODULE_N}}`（`getChatFilteredModuleConfigs`）条件类似但无 `retainLayers` 检查。过滤逻辑见 `promptGenerator.js` 的 `getContextBottomFilteredModuleConfigs` / `getChatFilteredModuleConfigs` 和 `moduleFilters.js`
- **includeInModuleData**：模块级布尔开关（默认 true）。开启后，非 `after_body` 位置的全量模块也能进 `{{CONTINUITY_MODULE_DATA}}` 汇总提示词 + 上下文底部/消息底部 UI。仅对全量模块生效，增量模块始终包含。过滤条件改为 `(outputPosition==='after_body' || includeInModuleData) && outputMode==='full' && retainLayers!==0`
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

单条消息存储格式（key→value,所有内容当文本存,不解析）：
```javascript
{
    mesId: 5,
    activeSwipeId: 0,           // 写入时 chat[5].swipe_id 的值
    swipes: {
        "0": {
            "modules": "大段带换行的模块文本...",     // 特殊 key,模块专用(有单独按钮)
            "side_scene": "小剧场文本...",            // generator.name 作 key
            "char_thoughts": "角色心理文本..."        // generator.name 作 key
        },
        "1": { ... }
    }
}
```

- **全部当文本存**,不解析内部结构。读取时由 `moduleProcessor` 等模块重新解析
- **`"modules"` 是特殊 key**,模块专用,始终存在,有单独按钮
- **其他 key = `generator.name`**,对应 `generator_config.generators[].name`
- **moduleExtractor 不参与存储流程** — 它只管从聊天文本提取→注入管线,与存储无关
- **不需要兼容迁移** — 旧的三层格式(`moduleTagModules`/`contentTagModules`/`extraModules`)已废弃,直接替换

三层分类提取逻辑（仅用于 `moduleExtractor` 从消息文本提取,不用于存储）：
1. 先找所有 `moduleTag` 区间（`[Module|...]` 到配对结束，考虑嵌套）
2. `contentTag` 内但 `moduleTag` 外
3. 其余位置

快照存储格式（不含 activeSwipeId，swipe 信息从聊天记录实时读取）：
```javascript
{
    mesId: 10,
    moduleStates: { ... }       // 累积模块状态（仅模块,其他生成内容独立不累积）
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

### 生成内容配置（generator_config）

独立于 `module_config` 和 `extension_config` 的第三套配置,定义"生成内容"（小剧场、角色心理等）。

**配置结构**：
```javascript
// 存储位置:extension_settings[extensionName]['generator_config']
{
    generators: [
        {
            id: 1,                      // 数字,排序用,可变
            name: "side_scene",         // 唯一标识(英文),= 存储 key
            displayName: "默认小剧场",   // 显示名称
            enabled: true,              // 是否启用(同 module_config 模块)
            prompts: [                  // 提示词数组(支持多情况)
                { label: "日常场景", content: "..." },
                { label: "战斗场景", content: "..." }
            ],
            promptMode: "random"        // 'random' | 'select'
            // random: 每次随机选一个提示词
            // select: 面板多选,合并一次调用
            // fixed 不需要 — 面板里直接选用哪个
        }
    ]
}
```

**不要的字段**（已确认不需要,记录备忘）：
- ~~`type`~~ — 都当文本存
- ~~`inject`~~ — 默认注入,空 = 不注入
- ~~`storage`~~ — 全局配置(非 per-generator),决定存文件/chat 变量,后续实现
- ~~`style`~~ — 显示样式,后续功能做到再加

**与 module_config 的关系**：
- 模块是特殊的"生成内容" — 有单独按钮,始终在 Cc 菜单排第一
- 模块配置仍在 `module_config`,不在 `generator_config`
- 其他生成内容配置在 `generator_config`

**chat 变量存储兼容**（后续实现）：
- key→value 格式天然映射 `chat_metadata.variables["ccore_{name}"]`
- `storage` 全局配置决定存文件还是 chat 变量

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
generationRecordsPanel（生成记录面板）
  ├── 列表：跨角色/聊天/楼层/状态筛选 + 卡片（status 标色、可直接抛弃）
  └── 详情：发送内容/响应/提取/API/错误 sections + 保存(追加/覆盖)/抛弃 + ‹ › 结果集导航
      ├── 生成中：运行中详情（流式实时刷新 + 中止按钮）
      └── 处理后：自动跳结果集内下一条 pending，无则回列表
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

### 待处理结果管理（pendingResults）

手动"重新生成"（`skipStorage: true`）成功后，结果不立即写入存储，而是暂存到 `moduleAiGenerator.js` 的 `pendingResults` Map，等用户在调试面板中决定保存或抛弃。

**隔离粒度**：key = `${chatKey}::${generatorName}::${mesId}`（聊天标识 + 生成内容名 + 楼层）。mesId 在不同聊天间重复，必须用 chatKey 隔离。

**持久化**：`sessionStorage`（key: `ccore_pending_results`），刷新页面后仍可恢复。

**导出 API**：
- `hasPendingResult(generatorName, mesId)` — 是否有该楼层 + 生成内容的待处理结果
- `clearPendingResult(generatorName, mesId)` — 清除并触发 `ccore-pending-cleared` CustomEvent（带 `{ generatorName, mesId }`）
- `reopenPendingDebugPanel(generatorName, mesId)` — 重开调试面板显示上次结果

**用户流程**：
1. 点"重新生成" → `skipStorage: true` 生成 → 成功后暂存 + 显示调试面板（含保存/抛弃/查看当前内容按钮）
2. 点"保存" → 写入 `perMessageStorage` → `clearPendingResult` → 关闭面板
3. 点"抛弃" → `clearPendingResult` → 关闭面板
4. 关闭面板（不选）→ 暂存保留 → 再次点"重新生成" → `hasPendingResult` 为真 → 重开面板，不发起新生成

### 重新生成按钮状态反馈

每个"重新生成"按钮（模块 + 各 generator 各自一个）通过替换 fa 图标展示状态，**不**用 Cc 触发器展示：

- `setRegenButtonState(button, state, generatorName, mesId)` — 状态：LOADING（`fa-spinner fa-spin`）/ SUCCESS（`fa-check` 绿）/ ERROR（`fa-xmark` 红）/ IDLE
- IDLE 状态根据 `hasPendingResult(generatorName, mesId)` 决定图标：有待处理 → `fa-hourglass-half`，无 → `fa-arrows-rotate`
- 按钮加 `data-generator` 属性，方便事件监听器按 generatorName 查找
- `ccore-pending-cleared` 事件监听器按 `currentMenuMesId` 过滤，只更新当前打开菜单对应楼层的按钮
- generate 操作不关闭菜单，保持按钮可见以展示状态
- 正在生成中（按钮含 `fa-spinner`）时再次点击不重复触发

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

- **三配置结构**：`extension_config`（全局开关、后端 URL、调试日志、按钮类型、异步模块存储）、`module_config`（模块、全局设置）和 `generator_config`（生成内容配置：小剧场、角色心理等）
- **持久化**：通过 ST 的 `saveSettings` 存储在 `extension_settings[extensionName]` 中（见下方"保存机制"说明）
- **DEV_SAVE_GUARD**（`configManager.js` 中的 `ENABLE_DEV_SAVE_GUARD`）— 为 `false` 时阻止所有保存，设置为 `true` 恢复正常操作
- **normalizeConfig()**（`moduleConfigTemplate.js`）— 所有保存/导入/导出操作的规范化入口（仅处理 `module_config`，不处理 `extension_config`/`generator_config`）
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

### 10. mesId 跨聊天不唯一

每个聊天的 mesId 都从 0 开始，不同聊天/角色的楼层 2 是不同的消息。用 mesId 单独作为 key 会导致跨聊天串数据。

**正确做法**：需要跨聊天隔离时，用 `getCurrentChatDetails()` 获取 `characterName::sessionName` 作为 chatKey，与 mesId 组合：

```javascript
// ✓ 正确 — chatKey + mesId 组合隔离
const chatKey = `${details.characterName}::${details.sessionName}`;
const key = `${chatKey}::${generatorName}::${mesId}`;

// ✗ 错误 — mesId 跨聊天重复
const key = `${generatorName}::${mesId}`;
```

## 待确认项

- **聊天重命名事件**：ST 没有 `CHAT_RENAMED` 事件。重命名后触发 `reloadCurrentChat()` → `CHAT_CHANGED`。需通过对比存储路径与新路径间接检测重命名。具体检测方案待定。
- **角色重命名事件**：角色重命名后，存储路径中的 `safeCharName` 会变化，需迁移整个角色目录。检测方案同聊天重命名（对比存储路径）。
- **异步模式下模块内容判空**：开启异步生成后，模块原始内容可能直接写入存储而非聊天记录。读取时需判空 + 校验内容一致性。细节待实现时细化。
- **chatIdHash 不可用于分支聊天**：分支聊天的 hash 与主聊天相同，不能作为唯一标识。使用 `charName + chatFile` 组合替代。
- **异步存储 per-chat 操作按钮迁移**：当前"手动提取当前聊天"和"重建快照"按钮放在异步存储 tab（全局设置），但这些操作本质是 per-chat 的。角色绑定页（Profiles）做好后，应迁移到该页面，异步 tab 只保留全局配置（开关、快照间隔）。

## 实施计划：生成内容配置（generator_config）

> **状态：6 个 Phase 全部完成** ✅

6 个 Phase,按依赖顺序执行:

### Phase 1: 配置基础 ⭐高优先
- 新建 `src/config/` 目录,把 `moduleConfigTemplate.js` 从 `modules/` 移过来
- 创建 `src/config/generatorConfigTemplate.js`(schema/normalize/defaults)
- 改 `configManager.js` — 加 `generatorConfig` 加载/保存(key=`'generator_config'`)
- 改 3 个 importer 路径(configManager / moduleConfigService / ImportExport)
- **验证**:能读写 generator_config,字段补全正常

### Phase 2: 存储格式 ⭐高优先
- 改 `perMessageStorage.js` — swipe 数据从三层分类改为 key→value map
- 改服务端插件 — `writeMessage`/`readMessage` 适配新格式(透传,不关心结构)
- **验证**:能按 `"modules"` / `generator.name` 读写

### Phase 3: 生成逻辑 ⭐高优先
- 重构 `moduleAiGenerator.js` — 抽象为支持按 config.name 生成
  - 模块:用现有 module_config 提示词
  - 其他:用 generator_config 的 prompts(按 promptMode 选提示词)
- **验证**:能按指定 config name 生成内容并存入对应 key

### Phase 4: Cc 菜单 UI
- 改 `messageAiButton.js` — 横向多框布局
  - 第一框:模块(无标签,3 按钮:重新生成/编辑/汇总)
  - 后续框:各 enabled generator(displayName 标签 + 重新生成/编辑)
- **验证**:Cc 点击后横向展开所有配置框

### Phase 5: 配置面板 UI
- 改 `EntryButton.js` — 设置和汇总之间加"生成内容配置"按钮
- 新建 `src/features/generator-editor/` — 配置编辑器(参考 module-editor/)
  - 列表 + 详情(id/name/displayName/enabled/prompts/promptMode)
  - prompts 数组编辑(label + content)
- **验证**:能增删改 generator 配置并保存

### Phase 6: 提示词注入
- 改 `promptInjector.js` — 注入生成内容(默认注入,空=不注入)
- **验证**:生成内容出现在 AI 请求中

**执行顺序**:Phase 1→2→3 是核心链路(配置→存储→生成),做完能跑通"配置→生成→存储"。Phase 4→5 是 UI。Phase 6 最后。

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
- key 命名细分前缀：`ccore_gen_*`（generator-editor）、`ccore_debug_*`（调试面板）、`ccore_msg_*`（消息提示）等
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
