# 提示词组合与注入路径分析

> 整理日期：2026-06-27
> 范围：异步/非异步模式下的提示词组合、宏注册、世界书条目、正则隐藏、AI 生成调用
> 目的：理清现状、定位问题、给出修复方向

---

## 1. 提示词组合现状

### 1.1 同步模式（`asyncModule.enabled = false`，默认）

**模块数据流**：
```
聊天文本
  → moduleExtractor 提取 [Module|key:val|...] 格式
  → moduleProcessor 管线（normalize → deduplicate → time → sort → output）
  → moduleCacheManager 内存缓存（按 chatIdHash 分组）
  → 宏读取（generateFormalPrompt / generateModuleDataPrompt 等）
  → 世界书条目展开（[CCore] 世界书内的 {{CONTINUITY_*}} 占位）
  → 主聊天提示词
```

**生成内容流（小剧场、角色心理等 generator_config 项）**：
- 同步模式下 `moduleAiGenerator` 不被自动触发
- `generatedContentCache` 通常是空的
- 即使用户通过 Cc 菜单手动生成，结果只写入 `perMessageStorage` + `generatedContentCache`
- **没有任何机制把生成内容注入到主聊天提示词**（见问题 2）

### 1.2 异步模式（`asyncModule.enabled = true`，需服务器插件）

**模块数据流**：
```
moduleAiGenerator.generate()
  → aiCaller.call()
  → AI 回复
  ├── isModule=true：
  │     extractMessageModules(result.text)
  │     → perMessageStorage.writeMessage(mesId, swipeId, { modules: ... })
  └── isModule=false：
        直接存 → perMessageStorage.writeMessage(mesId, swipeId, { [generatorName]: text })
        + generatedContentCache.set(mesId, generatorName, text)（内存缓存）
```

**问题**：异步模式生成的模块数据**没有同步回 `moduleCacheManager`**。宏 `{{CONTINUITY_MODULE_DATA}}` 仍读 `moduleExtractor` 从聊天文本提取的数据，与异步存储脱节（见问题 3）。

---

## 2. 宏注册机制（macroManager.js）

所有宏通过 `context.registerMacro(name, fn)` 注册到 SillyTavern，可被世界书条目、预设、角色卡使用。

| 宏 | 实现函数 | 内容 |
|---|---|---|
| `{{CONTINUITY_PROMPT}}` | `generateFormalPrompt()` | 模块生成规则（标签 + 配置 + 格式） |
| `{{CONTINUITY_ORDER}}` | `generateModuleOrderPrompt()` | 输出顺序规则（按位置分组：embedded/body/body_start/body_end/body_surround/specific_position/after_body） |
| `{{CONTINUITY_USAGE_GUIDE}}` | `generateUsageGuide()` | 模块内容使用指导（只含 `contentPrompt` 非空的模块） |
| `{{CONTINUITY_MODULE_DATA}}` | `generateModuleDataPrompt()` | 实际模块数据 |
| `{{CONTINUITY_MSG_MODULE_N}}` | `generateSingleChatModuleData(N)` | 逐楼层模块数据（N 取奇数：1/3/5/...） |

**关键点**：
- `CONTINUITY_MSG_MODULE_N` 数量由 `globalSettings.contentRemainLayers` 控制，默认 9
- 只注册奇数索引（`i % 2 === 1`）—— 偶数层不注入
- 数据源全部来自 `moduleCacheManager`（即 `moduleExtractor` 提取的结果）

---

## 3. 世界书条目（worldBookUtils.js）

扩展启动时自动创建名为 `[CCore]` 的世界书，包含默认条目。

### 3.1 固定条目（6 条）

| 条目 comment | content | order | depth | position | 说明 |
|---|---|---|---|---|---|
| 必看说明 | 注释文本 | 9999 | 0 | 4 (before_char) | 用户提示 |
| 版本信息 | 注释文本 | 9999 | 0 | 4 | 版本/日期 |
| `{{CONTINUITY_PROMPT}}` | 宏展开 | 1 | 9999 | 4 | 模块生成规则 |
| `{{CONTINUITY_ORDER}}` | 宏展开 | 9999 | 1 | 4 | 输出顺序 |
| `{{CONTINUITY_USAGE_GUIDE}}` | 宏展开 | 9998 | 1 | 4 | 使用指导 |
| `{{CONTINUITY_MODULE_DATA}}` | 宏展开 | 2 | 9999 | 4 | 模块数据 |

### 3.2 动态条目（CONTINUITY_MSG_MODULE_N）

- 数量由 `globalSettings.contentRemainLayers` 控制
- 只创建奇数索引：1, 3, 5, ..., contentRemainLayers-1
- 每条 `order:0, depth:N, position:4, role:2 (assistant)`
- 超出当前 `contentRemainLayers` 的旧条目会被 `disable=true`
- `CHARACTER_EDITOR_OPENED` / `WORLDINFO_*` 事件触发缓存更新

### 3.3 启用/禁用逻辑

`configManager.isExtensionEnabled()` 控制：
- 启用 → `addWorldBookToGlobalSettings` 把 `[CCore]` 加入 `selected_world_info`
- 禁用 → `removeWorldBookFromGlobalSettings` 移除

---

## 4. 正则隐藏（regexUtils.js）

注册两条全局正则脚本到 ST 的 Regex 扩展：

### 4.1 隐藏正文后模块数据
- **脚本名**：`[CCore]隐藏正文后模块数据_{version}`
- **findRegex**：`/(?<!<details>\s*)<(modules?|module_update|{moduleUpdateTag}|{compatibleModuleTags})>([\s\S]*?)<\/\1>/g`
- **replaceString**：空（清空）
- **placement**：`[1, 2]`（AI 输出 + 用户输入）
- **markdownOnly**: true, **promptOnly**: true
- 作用：避免历史模块数据重复发送给 AI

### 4.2 不发送保留层数前任何内容
- **脚本名**：`[CCore]不发送保留层数前任何内容_{version}`
- **findRegex**：`[\s\S]*`（匹配全部）
- **replaceString**：空
- **minDepth**: `contentRemainLayers`（默认 9）
- **disabled**: `!sumModule.enabled`（仅当 `sum` 模块启用时才生效）
- 作用：深度 ≥ contentRemainLayers 的消息整段清空，配合 `sum` 模块做总结

### 4.3 更新逻辑

- `EXTENSION_SETTINGS_LOADED` 事件触发注册
- 每次注册都遍历现有 scripts，按"忽略版本号的名称"匹配
- 存在则更新（保留 id），不存在则新增
- 扩展禁用时，`不发送保留层数前...` 脚本被 disabled

---

## 5. AI 生成调用（aiCaller.js + moduleAiGenerator.js）

### 5.1 调用架构

```
moduleAiGenerator.generate()           ← 高层业务
  ├── 收集消息 + 选提示词（generator_config）
  ├── 构建 callOptions
  └── aiCaller.call(callOptions)       ← 底层封装
        ├── mode: 'raw'
        │     → generateRaw()
        │     + 监听 CHAT_COMPLETION_PROMPT_READY 抓提示词（debug 用）
        └── mode: 'pipeline'
              → setExtensionPrompt(key, injectPrompt, ...)  ← 临时注入
              → prepareOpenAIMessages() 组装
              → sendOpenAIRequest()
              + finally: setExtensionPrompt(key, '', ...)   ← 清理

独立 API 拦截（customApi.apiurl 非空时）：
  CHAT_COMPLETION_SETTINGS_READY 事件 once 拦截
  → 替换 reverse_proxy / chat_completion_source / proxy_password / model / temperature / max_tokens
```

### 5.2 调用入口

| 入口 | 触发方式 | skipStorage |
|---|---|---|
| Cc 菜单"重新生成" | 用户点击 | `true`（先展示，保存由调试面板回调决定） |
| 扩展设置"AI 生成楼层" | 用户点击 | `false`（直接存储） |
| 扩展设置"AI 生成聊天" | 用户点击 | `false` |
| 模块编辑器工具箱 | 用户点击 | `false` |

### 5.3 待处理结果（pendingResults）

`skipStorage: true` 且单条生成成功时：
1. 结果暂存到 `pendingResults` Map，key = `${chatKey}::${generatorName}::${mesId}`
2. 持久化到 `sessionStorage`（key: `ccore_pending_results`），刷新可恢复
3. 弹出调试面板，提供"保存/抛弃/查看当前内容"按钮
4. 保存 → `_createSaveCallback` → `perMessageStorage.writeMessage`
5. 抛弃 → `clearPendingResult` + 触发 `ccore-pending-cleared` 事件

---

## 6. 发现的问题与修复方向

### 问题 1：`promptInjector.js` 是僵尸代码

> **状态（2026-07-15）**：未修。CLAUDE.md 已标注其为僵尸代码。

**现象**：`PromptInjector` 类被定义，但全项目从未实例化、从未注册到 `CHAT_COMPLETION_PROMPT_READY` 事件。`continuity-core.js` 入口未引入它。

**影响**：CLAUDE.md 第 26 行"`promptInjector` 监听 `CHAT_COMPLETION_PROMPT_READY` 事件"的描述与代码不符。实际主聊天提示词注入完全依赖**宏 + 世界书条目展开**，`promptInjector.js` 对运行时毫无影响。

**修复方向**：删除 `promptInjector.js`，或把它真正接入。建议删除（宏方案已经够用）。

---

### 问题 2：生成内容（generator_config）注入路径未通

> **状态（2026-07-15）**：未修。

**现象**：`promptInjector.generateInjectionPrompt()` 内部调用 `generateGeneratedContentPrompt()`，从 `generatedContentCache` 读最近 5 条生成内容拼到模块提示词后。但因为问题 1，这函数**永远不会被调用**。

**影响**：用户用 Cc 菜单生成的"小剧场""角色心理"等内容**无法进入主聊天提示词**，AI 看不到它们。generator_config 的 Phase 6（"生成内容按配置注入提示词"）实际上没真正接通。

**修复方向**：
- **方案 A（推荐）**：注册新宏 `{{CONTINUITY_GENERATED_CONTENT}}` → 在 `macroManager` 实现 → 在 `[CCore]` 世界书加对应条目
- **方案 B**：真正实例化 `promptInjector` 并注册到 `CHAT_COMPLETION_PROMPT_READY`，跟宏方案并存（不推荐，两套机制会冲突）

---

### 问题 3：异步模式下宏数据源未切换

> **状态（2026-07-15）**：未修。

**现象**：异步模式走 `moduleAiGenerator` 生成模块 → 存 `perMessageStorage`。但宏 `{{CONTINUITY_MODULE_DATA}}` 读的是 `moduleCacheManager`（来自 `moduleExtractor` 从聊天文本提取）。

**影响**：两套数据源没有桥接，异步模式下宏注入的模块数据跟实际存储的不一致。

**修复方向**：
- **方案 A**：异步模式启用时，让 `moduleCacheManager` 从 `perMessageStorage` 读累积状态，而不是从聊天文本提取
- **方案 B**：新增 `{{CONTINUITY_MODULE_DATA_ASYNC}}` 宏走另一条数据源
- 推荐 A，避免宏分裂

---

### 问题 4：`perMessageStorage.initChat()` 状态依赖问题

> **状态（2026-07-15）**：未修。`moduleCacheManager` 的跨聊天缓存累积已通过 `eventHandler.js`（CHAT_CHANGED 时 clearAllCache）+ `moduleCacheManager.js`（set 时清理过期 rangeKey）修复，但 `perMessageStorage` 的 `initChat` 状态依赖仍在，重构计划见 `REFACTOR_STATELESS_STORAGE.md`（未执行）。

#### 4.1 `initChat` 的作用

[perMessageStorage.js:82-116](../src/services/perMessageStorage.js#L82-L116) 做 4 件事：

1. **设置 `this.currentChat = { characterName, chatFileName, chatIdHash }`** — 后续所有操作靠它构建路径
2. **清空所有缓存**（messageCache / snapshotCache / dirtyBatches / metaCache）
3. **`ensureContinuityCoreDir`** — 在服务器上创建 `chats/{charName}/{chatFile}/messages/` 和 `snapshots/` 目录
4. **读取或创建 `meta.json`** — 缓存到 `this.metaCache`

之后所有 `writeMessage` / `getMessage` / `getAccumulatedState` 都靠 `this.currentChat` 拼 path，靠 `this.metaCache` 更新元数据。

#### 4.2 当前调用点

`initChat()` 只在以下位置被调用：
- [extensionSettingsManager.js:209/274/503/535](../src/ui/extensionSettingsManager.js) — 扩展设置面板"提取/AI生成"按钮
- [Toolbox.js:475](../src/features/module-editor/Toolbox.js#L475) — 模块编辑器工具箱

**[eventHandler.js](../src/core/eventHandler.js) 的 `CHAT_CHANGED` 事件根本没注册 `perMessageStorage.initChat()`** —— CLAUDE.md 第 274 行写的"`CHAT_CHANGED → perMessageStorage.initChat(charName, chatFile)`"是规划，没实现。

#### 4.3 实际后果

- 用户刚开 ST、直接进聊天用 Cc 菜单"重新生成 → 保存" → `currentChat` 为 `null` → `_ensureInitialized()` 抛 `Error: PerMessageStorage: 未初始化，请先调用 initChat()` → **保存失败**
- `_createSaveCallback` 没 try/catch，错误只在控制台，UI 上没反馈
- 用户先去扩展设置面板点过"提取/AI生成"按钮 → `currentChat` 被设置过 → 后续保存能成功
- 用户点过按钮后**切换了聊天** → `currentChat` 还是旧聊天的信息 → 保存会**写到错误聊天的目录下**

#### 4.4 为什么和 eventHandler 有关系？

因为**用户会切换聊天**。如果不监听 `CHAT_CHANGED`：
- 用户在 A 聊天点过"提取"按钮 → `currentChat = A`
- 切换到 B 聊天 → `currentChat` 还是 A
- 在 B 聊天用 Cc 菜单"重新生成 → 保存" → 数据**写到 A 聊天的目录下**

`eventHandler` 是 ST 事件中枢，`CHAT_CHANGED` 是切换聊天的唯一可靠时机。

#### 4.5 为什么一定要 initChat？保存时直接传聊天信息不行吗？

**完全可以**。这是设计选择问题。

**当前设计（"有状态"模式）**：
```
initChat(charName, chatFile)   ← 设置上下文
writeMessage(mesId, ...)       ← 只传 mesId，内部用 currentChat 拼路径
```
- 优点：调用方参数少
- 缺点：状态依赖、切换聊天要手动重置、并发会乱、`currentChat` 没设就崩

**备选设计（"无状态"模式）**：
```
writeMessage(charName, chatFile, mesId, ...)  ← 每次传完整参数
```
- 优点：无状态不会崩、天然支持并发、不需要监听 `CHAT_COMPLETION_PROMPT_READY`
- 缺点：每次参数多；`meta.json` 缓存和目录创建要改成"按聊天 key 缓存"

**关键证据**：[extensionSettingsManager.js](../src/ui/extensionSettingsManager.js) 里每个"提取/AI生成"按钮处理函数都在**自己调 `initChat`**——说明调用方都不信任 `currentChat` 的状态，每次都重新 init。这本身就是设计有问题的信号。

#### 4.6 修复方向

**短期最小修复**：
1. 在 `eventHandler.js` 的 `initializeModuleCache()` 里加 `CHAT_CHANGED → perMessageStorage.initChat()` 监听
2. 在 `_createSaveCallback` 加 try/catch + toastr 提示，保存失败时让用户看到
3. 顺手更新 CLAUDE.md 标注那段"事件映射表"为已实现

**长期重构**：走"无状态"模式，每次保存传完整参数，`perMessageStorage` 改为"按聊天 key 缓存"。

---

### 问题 5：`DEFAULT_EXTENSION_CONFIG.asyncModule` 与 CLAUDE.md 不一致

> **状态（2026-07-15）**：未修。

**现象**：
- 代码有 `useIndependentApi` 字段，CLAUDE.md 没记
- CLAUDE.md 写 `customApi.max_tokens: 500`，代码默认是 `0`（不限制）

**修复**：同步两者。

---

## 7. 推荐处理顺序

1. **修问题 4（短期）** — 让 Cc 菜单保存能正常工作（最影响用户体验）
2. **修问题 1+2** — 接通生成内容注入路径（让 generator_config 真正可用）
3. **修问题 3** — 异步模式数据源桥接
4. **修问题 5** — 文档同步
5. **长期重构** — `perMessageStorage` 无状态化

---

## 附：关键文件索引

| 模块 | 文件 |
|---|---|
| 宏注册 | [src/core/macroManager.js](../src/core/macroManager.js) |
| 提示词生成 | [src/modules/promptGenerator.js](../src/modules/promptGenerator.js) |
| 僵尸注入器 | [src/core/promptInjector.js](../src/core/promptInjector.js) |
| 世界书集成 | [src/utils/worldBookUtils.js](../src/utils/worldBookUtils.js) |
| 正则隐藏 | [src/utils/regexUtils.js](../src/utils/regexUtils.js) |
| AI 调用底层 | [src/services/aiCaller.js](../src/services/aiCaller.js) |
| AI 生成业务 | [src/services/moduleAiGenerator.js](../src/services/moduleAiGenerator.js) |
| 每楼层存储 | [src/services/perMessageStorage.js](../src/services/perMessageStorage.js) |
| 存储路径构建 | [src/services/storageKeyBuilder.js](../src/services/storageKeyBuilder.js) |
| 生成内容缓存 | [src/singleton/generatedContentCache.js](../src/singleton/generatedContentCache.js) |
| 事件中枢 | [src/core/eventHandler.js](../src/core/eventHandler.js) |
| 扩展设置面板 | [src/ui/extensionSettingsManager.js](../src/ui/extensionSettingsManager.js) |
| Cc 菜单按钮 | [src/ui/messageAiButton.js](../src/ui/messageAiButton.js) |
