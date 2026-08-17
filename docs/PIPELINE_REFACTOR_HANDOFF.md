# 管线重构与性能优化交接文档

> 整理日期：2026-08-14
> 范围：contextBottomUI 性能优化（Q1/Q2/Q3）+ 模块管线通用化重构（Tier 1）
> 目的：记录已完成工作、设计决策、剩余工作，方便其他 agent 接手

---

## 1. 已完成工作总览

### 1.1 性能优化（contextBottomUI，已 commit）

| commit | 内容 |
|---|---|
| `de4e8a2` | **Q1+Q2**：msg-bottom 调度器 `scheduleMsgBottom`（80ms 防抖+单飞+trailing），合并 burst 事件；`updateUItoMsgBottom(targetMesIds)` 只重注入脏消息 iframe（数据层仍全量提取）。事件精简：EDITED→UPDATED(suffix)，注释 CHAT_COMPLETION_PROMPT_READY。 |
| `40b4e7a` | **Q3**：`injectHtmlToIframe` 首屏 srcdoc 建文档（含稳定挂载点 `#cc-iframe-content-root`），后续仅替换挂载点 innerHTML，不再重建整文档。修复 innerHTML 不执行 `<script>`（`rerunContentScripts` + `ensureBaseScripts` + ResizeObserver guard）。 |

**性能收益**：一次新消息/编辑从「N 条消息 × 整文档重建」降为「只重注入脏消息 × 仅换内容」。长聊天刷新开销大幅降低。

### 1.2 管线通用化重构（Tier 1 Phase A，已 commit `2f8ab77`）

新建 4 文件 + 旧入口改薄封装：

| 文件 | 职责 |
|---|---|
| `src/core/pipeline/runModulePipeline.js` | 编排入口，options 对象签名取代 7 位置参数 |
| `src/core/pipeline/moduleDataSources.js` | 数据源注册表 + 源头路由 `getActiveSourceName()`；P 阶段注册 `chatText`，`asyncChat` 预留 |
| `src/core/pipeline/cacheLayer.js` | 显式 `readCache`/`writeCache`，从原隐式分支抽出 |
| `src/core/pipeline/groupByMessage.js` | `groupProcessResultByMessageIndex` 迁此（切断循环依赖） |
| `src/core/moduleProcessor.js` | `processModuleData` → @deprecated 薄封装；`groupProcessResultByMessageIndex` re-export |

**顺手修旧 bug**：原 `moduleProcessor.js:57` 误用 `module.moduleName`（应为 `.name`），导致「全量+未传 selectedModuleNames+缓存命中」分支返回空 content。已修（实际无可见症状，因唯一触发方 `moduleCacheManager.updateModuleCache` 不用返回值）。

---

## 2. 关键设计决策

### 2.1 数据源接缝（为异步模式铺路）

- 管线的 `normalize` 及以下阶段**对数据源无知**：只消费 `{raw, messageIndex, ...}` 对象。
- 唯一耦合点是原 `extractModulesFromChat` 硬编码扫 `chat[].mes`。抽成 `moduleDataSources` 后，新源只需注册一行。
- **异步模式只走「存聊天内容」**（floorBridge，`chat[floor].extra.ccore`），**不做服务器 fetch 源**。理由：
  - floorBridge 同步无状态 → 宏同步读约束消失、`perMessageStorage.initChat` 状态依赖（文档问题4）结构性消失。
  - 数据随聊天 jsonl 走，可移植。
- swipe 维度走 **A 方案**：`extra.ccore.modulesBySwipe = {[swipeId]: rawText}`（per-swipe 保留，语义正确）。

### 2.2 数据源矩阵（收窄后）

| 模式 | 源 | 读取 |
|---|---|---|
| 同步（现状） | `chatText` | 扫 `chat[i].mes` 文本正则 |
| 异步·存聊天 | `asyncChat` | 读 `chat[i].extra.ccore.modulesBySwipe[currentSwipeId]` |

两者都**同步**产出 `[{raw, messageIndex}]`，下游零改动。`asyncChat` P 阶段未实现，预留注册位。

### 2.3 缓存语义（cacheLayer 显式化）

原隐式 → 新显式 `cache:'read'|'write'|'both'|'none'|'auto'`：
- 读条件：`processType==='auto' && !force && hasCurrentChatData`
- 写条件：`processType==='auto' && isAllModule`（moduleFilters===null）
- `'auto'` 按旧语义推导（非 auto→none；auto+force→write；auto+!force→both）

---

## 3. 6 个调用方现状（全部已迁移到 runModulePipeline）

| # | 调用方 | 迁移后调用 | 备注 |
|---|---|---|---|
| 1 | `moduleCacheManager._doUpdateModuleCache` | `runModulePipeline({range:{0,end},modules:null,processType:'auto',force:isForce,cache:isForce?'write':'both'})` ×2 | 已迁移 2026-08-17 |
| 2 | `processResultBuilder.buildStyledProcessResult` | `runModulePipeline({range,modules:extractParams.moduleFilters,processType:'auto',selectedModuleNames})` | 已迁移；style 仍由自身 styleCombiner 处理（不传 style:true） |
| 3 | `promptGenerator.generateModuleDataPrompt`（宏） | `runModulePipeline({range,modules,processType:'auto',selectedModuleNames,showModuleNames:true})` | 已迁移 |
| 4 | `promptGenerator.generateSingleChatModuleData`（宏） | `runModulePipeline({range,modules,processType:'auto',selectedModuleNames,groupByMessage:true})` → 读 `result.byMessage` | 已迁移；groupByMessage 分支修复了原 `groupByMessageIndex` 未定义 bug |
| 5 | `Toolbox` 提取按钮 | `runModulePipeline({range,modules,processType:type,selectedModuleNames,force:true,cache:'none',showModuleNames:true,showProcessInfo:true})` | 已迁移 |
| 6 | timeRef 自动并入（内部） | runModulePipeline 内部自动并入 | 无需迁移 |

**薄封装已删除（2026-08-17）**：`moduleProcessor.js` 的 `processModuleData` 已删除，仅保留 `groupProcessResultByMessageIndex` re-export（`contextBottomUI`/`inlineMessageRenderer` 依赖）。`macroManager.js` 死 import 已清理。

---

## 4. 剩余工作（按优先级）

### Tier 2：缓存维护器去重/防抖（**已落地**）
- **问题**：`moduleCacheManager.updateModuleCache` 绑 7+ 事件零防抖；一次调 `processModuleData` 两遍（双范围写）。
- **改法**：
  - 拆 `_doUpdateModuleCache`（双范围写 + 冗余修复：末条是用户消息时两范围相同，提取一次写两键，省一次全量提取）。
  - `updateModuleCacheImmediate`（同步）：CHAT_CHANGED / MESSAGE_SENT 用——必须在 PROMPT_READY 宏同步读前保证缓存新鲜。
  - `updateModuleCacheDebounced`（80ms 合并 + force 取并集）：RECEIVED/EDITED/UPDATED/SWIPED/SWIPE_DELETED/RENDERED 用——消除 EDITED+UPDATED、RECEIVED+RENDERED 双触发。
  - 移除 cache 的 CHAT_COMPLETION_PROMPT_READY 注册（生成前触发、缓存已 warm、立即被覆盖，纯浪费）。
- **关键安全约束**：不能无脑 debounce——MESSAGE_SENT 在 PROMPT_READY 前不久触发，若 debounce 宏会读到 stale 缓存（漏用户新消息模块）。故 MESSAGE_SENT/CHAT_CHANGED 走 Immediate，其余走 Debounced。
- **收益**：编辑从 4 次提取（EDITED+UPDATED 各 ×双调用）→ 1 次（debounce 合并 + 冗余修复）；生成期 RECEIVED+RENDERED 双触发合并；每轮省去 PROMPT_READY 一次提取。
- **风险**：低。UI 渲染读缓存 miss 时自提取（不依赖缓存新鲜），故 debounce 不影响 UI。

### F：floor 存储 + asyncChatSource（异步模式落地）
- 写侧：生成保存处把 perMessageStorage 换 floorBridge（`extra.ccore.modulesBySwipe`）。
- 读侧：新建 `asyncChatSource` 注册到 moduleDataSources。
- 一致性（难点）：缓存失效时机（floorBridge 写入不发 ST 事件，需主动失效）、源互斥（异步模式主回复 mes 不应含 `[模块|k:v]`，防双算）、swipe 一致性。
- 难度：低-中（存储 swap 机械，一致性需思考）。

### Tier 3：增量 ModuleStore（可选）
- 按 identifier 组缓存累积状态，编辑/新消息只重算受影响组。
- 异步存储（F）天然是「每楼层 raw」持久层，可作其 occurrences 输入。
- 风险：dedup 的「同值合并+diff>2」和 `mergeModulesByOrder` 累积/timeline 语义须逐字节对齐。

### 调用方迁移（已完成 2026-08-17）
6 处从薄封装改直调 runModulePipeline，全部迁移完成，薄封装 `processModuleData` 已删除。

---

## 4.1 F：异步 floor 存储（分期设计，2026-08-16 讨论收敛）

### 背景与决策
- 异步输出走单独消息：复用 `messageAiButton`「重新生成」→ `onRegenerate` → `moduleAiGenerator.generate(mesId, options)`（已带 mesId、pipeline/raw 独立发收、现 skipStorage=true）。
- 自动/手动可配置：自动=主回复生成完成后另起独立发收；手动=用户点 messageAiButton 按钮。
- 数据源只走「存聊天内容」（floorBridge），不做服务器 fetch 源（服务器逻辑未做且不确定继续做）。
- floor 落点：`chat[floor].extra.ccore`（floorBridge 已封装，FLOOR_NS='ccore' 与 chat_metadata.ccore 同体系）。**不存 `chat[floor].ccore` 顶层**（ST 规范：扩展数据放 extra，避免污染消息对象/撞字段）。
- 存储 key：`modulesBySwipe = { [swipeId]: raw模块文本块 }`（每 swipe 各自一份）。
- 缓存通知：机制 A（自定义事件 `ccore-floor-modules-updated`，detail `{mesId}`），eventHandler 统一监听 → `updateModuleCacheDebounced(true)`。写侧收口工具函数 `notifyFloorModulesUpdated(mesId)`，将来换机制只改此函数。

### F 一期（已实现，2026-08-16）
1. **`src/core/floorModuleStore.js`（新）**：写侧唯一入口。`modulesBySwipe = {[swipeId]: raw}` 落 `chat[floor].extra.ccore`（floorBridge）；`writeFloorModules/readFloorModules/deleteFloorModules/notifyFloorModulesUpdated`。事件 `ccore-floor-modules-updated`。
2. **`asyncChatSource` 注册到 moduleDataSources**：读 floor raw 按 \n 拆块、附 messageIndex，**支持 filters 过滤模块名**（与 chatText 语义对齐）。
3. **多源合并**：`moduleDataSources` 新增 `getActiveSources()`（同步=[chatText]，异步=[chatText, asyncChat]）；`runModulePipeline` 合并多源 raw，交给 normalize 的 dedup 去重。
4. **写盘切 floor**：`moduleAiGenerator` 的 `_createSaveCallback` 和主流程 `isModule` 分支改 `writeFloorModules`（非模块 generator 仍走 perMessageStorage + generatedContentCache）。
5. **`onEditModules` 切 floor**：读优先 floor、回退 perMessageStorage（旧数据兼容）；保存写回 floor + `scheduleMsgBottom('single', mesId)` 刷新 UI。修正了「编辑按 swipe 存」此前遗漏。
6. **缓存失效接线（机制 A）**：eventHandler `initializeModuleCache` 里 `window.addEventListener(FLOOR_MODULES_UPDATED_EVENT)` → `updateModuleCacheDebounced(true)`；destroy 时移除。

**已知限制（F 一期接受，F 二期治理）**：
- **双源同内容**：正文与 floor 同模块名+同变量值会由 `deduplicateModules`（deduplicate.js:48 按模块名+全变量值合并）**自然去重**，不产生两份输出。原则：**不动正文原有内容**。F 二期的「position 裁剪」指异步模式下提示词层面不再要求 AI 输出 after_body 模块（生成规则变化），非剥正文。
- `asyncChatSource` 产出的 nestedInfo 是空结构（floor 模块按非嵌套处理），与 chatText 的 parseNestedModules 不一致但 normalize 可接受。
- 异步时宏 `{{CONTINUITY_MODULE_DATA}}` 等仍走 runModulePipeline → 已自动读到 floor 数据（混合源生效），无需额外接线。
- 极端：正文与 floor 同模块但**不同版本**时，dedup 按模块名+变量值保留最后出现版本，不输出两份矛盾数据。

### F 二期：swipe 套 swipe 统一存储（已实现，2026-08-17）
**核心结构**（`chat[floor].extra.ccore`）：
- `generators[genName][outerSwipeId] = { swipe_id: innerSwipeId, swipes: { [innerSwipeId]: text } }`（genName='modules' 或 generator.name；outer=正文 swipe_id；inner=生成内容多版本）
- **激活指针 `swipe_id` 内嵌在 swipe 节点内**（方案 A，用户拍板）：随消息/复制迁移不悬空；`swipes`/`swipe_id` 沿用 ST 概念（正文即 `chat[floor].swipes` + 当前激活 `chat[floor].swipe_id`），子对象隔离版本表，遍历版本号只碰 swipes。
- 惰性迁移兼容三来源：最旧 `modulesBySwipe`（→ 节点 `{swipe_id:0, swipes:{'0':raw}}`）、13f9e91 纯版本表（→ 包 swipes 层）、13f9e91 独立 `generatorActive` 层（→ 合并进节点 swipe_id）。迁移后删旧 key（幂等）。

**API**（floorModuleStore.js，签名不变调用方零改动）：`write/read/readAll(includeEmpty)/append(max+1并激活)/overwrite(覆盖active)/deleteGeneratorContent` + `get/setActiveGeneratorSwipe`（无指针回退最大版本）。`read/writeFloorModules` 保留为 'modules' 便捷别名（读 active）。

**行为决策（用户拍板）**：
- 生成默认**追加**新版本（append 自动激活）；调试面板给「保存方式」radio（追加/覆盖）。
- 小 Cc 菜单：隐藏「模块汇总」（大 Cc 已有）；每个 generator 框加 `‹ N/M ›` 切版本（多版本才显示箭头，总数 0 不显示）；**再次点击小 Cc 才折叠**（去掉外部点击关闭）。
- 切模块版本：对比前后增量模块文本（`_incrementalModulesChanged`）→ 变化刷下游（suffix）否则 single。
- 编辑区（onEditGeneratedContent 通用，onEditModules 委托）：版本条 `‹ N/M › ＋ 🗑` + ST 原生 menu_button 样式按钮；总数 0 保存即新建（append）；`＋` 新建空版本；`🗑` 删除当前版本（ST Popup 确认）+ 模块删后增量判断刷下游。**不用 ST 的 mes_edit_* / mes_edit_buttons 类**（ST 编辑态会连坐控制显隐）。
- 非模块生成内容也统一存 floor（perMessageStorage 全面停用：调用已注释，Toolbox 存储调试按钮/设置面板旧控件已移除，文件保留备回用）。
- 注入（promptInjector.generateGeneratedContentPrompt）暂未改从 floor 读（用户待定；非模块不注入提示词，将来可能渲染 UI）。

**待办**：
- 非模块注入/渲染 UI（用户待定）
- 异步提示词裁剪（`{{CONTINUITY_PROMPT}}/{{CONTINUITY_ORDER}}` 异步模式是否照发）
- F 二期快照/非全量更新系统（内存级累积中间态，推迟到正式可用后）

### 重新生成模块·提示词上下文重构（第二版，2026-08-16，未 commit）
**目标**：在「第 X 层点重新生成」时，发给 AI 的提示词 = 标准 ST 组装（预设/世界书/宏全保留），且：
- **正文历史**：`chat[0..X]`（含目标层正文，作为历史最后一条）
- **quietPrompt（最后 user 消息）**：生成指令（`pipelineModifier` 等 config），语义=「第 X+1 层的 user 消息」

**方案（generateQuietPrompt + is_system 临时隐藏）**：
- `aiCaller._callPipeline` 改为 `generateQuietPrompt({quietPrompt, responseLength})`（script.js:2390，走 Generate('quiet') 完整 ST 管线 → 正则/文件/宏/世界书/预设全保留）。
- **临时隐藏**：`truncateToMesId` 时把 `chat[i].is_system = true`（i>truncateToMesId），coreChat 组装 `chat.filter(!is_system)`（script.js:3665）自动跳过；生成完 finally 还原。**不保存、不动 chat.length、不 push 消息 → 聊天记录零风险**。
- `moduleAiGenerator.generate`：`truncateToMesId = max(messages.mesId)` 传给 aiCaller；`quietPrompt` = `effectivePipelineModifier`。
- raw 模式保持现状（用户自配 prompt，不走 ST 管线）。

**第一版方案已废弃（自实现历史喂 messageData.messages）**：历史倒序（setOpenAIMessages 内部倒序+populateChatHistory 反转不匹配）、没过 ST 正则/文件、quietPrompt 不在 chat 数组 → `{{lastUserMessage}}` 取不到。

**待后续（F 二期）**：宏 `{{CONTINUITY_MODULE_DATA}}` 按楼层截断（正文给到 X、宏数据给到 X-1）；多楼层生成历史截断细粒度优化。

**第三版方案（dryRun 组装 + 自 send，2026-08-16 已实现）**：
- `aiCaller._callPipeline` 改 `Generate('quiet', {quiet_prompt}, true)`（dryRun）组装完整提示词 → 捕获 `eventData.chat` → 自行 `sendOpenAIRequest('normal', chat, signal)`。
- dryRun 不锁发送按钮（script.js:3596-3598 `if(!dryRun)`）、不发请求（4475-4477）。自 send 使 customApi 拦截生效（独立 API 恢复）。
- `configManager.asyncModule.pushUserMessageAsLast`（默认 false）：true=push 生成指令进 chat 作为最后 user 消息（{{lastUserMessage}} 可取，pop 还原）；false=经 quiet_prompt（system 角色末尾）。
- **宏按楼层截断**：新建 `src/core/generationContext.js`（set/get/clearGenerationContextEndFloor）。moduleAiGenerator pipeline 模式设 `truncateToMesId - 1`，promptGenerator.generateModuleDataPrompt 读它截断 endIndex。**不依赖 includeHiddenMessages/is_system，宏显式按楼层截断**。
- **独立 API「拉取模型」**：`#continuity_custom_api_fetch_models` 按钮 + `onFetchModels`（fetch /models，OpenAI/Anthropic 兼容）。

**备注**：CLAUDE.md 287-290 是过期文档（描述旧 generateQuietPrompt 方案，代码当时已是 prepareOpenAIMessages），用户要求暂不修正。

### 任务状态追踪 + 按钮增强（阶段 1，2026-08-16 已实现）
- **`src/core/taskRegistry.js`（新）**：全局任务状态（key=`${chatKey}::${mesId}::${generatorName}`，running/success/error）。事件 `ccore-task-updated`。running 跨聊天保留（按 chatKey 归属）。
- moduleAiGenerator：start/finish 任务 + 生成中 debugData（setDebugData 供生成中开面板）；`_createSaveCallback` 加聊天归属校验（chatKey 不符拒绝保存 + toast，不破坏 pending）。
- messageAiButton：`createMenuButton` 重建恢复按钮态（修「菜单收起再展开状态丢失」）；`onRegenerate` 查 running 防重复 + 生成中开面板；小 Cc 加楼层任务数角标（`.ccore-cc-badge`）。
- EntryButton：大 Cc 加总任务数角标（`.ccore-entry-task-badge`），`_attachTaskBadge` 监听刷新。
- **流式实时面板（阶段 2，2026-08-16 已实现）**：
  - aiCaller 流式 `for await` 每 chunk 调 `options.onStream?.(text)`。
  - moduleAiGenerator `onStream` 更新 taskRegistry debugData + `updateDebugPanelResponse(taskKey, text)`；生成中 debugData 带 `taskKey`。
  - generatorDebugPanel：`panelIframes: Map<taskKey, {iframe, responsePre, statusEl}>`；「完整响应」pre 加 `data-ccore-response-pre`；`updateDebugPanelResponse` 用 textContent 实时更新（父窗口直操作 iframe.contentDocument）。
  - 已知小泄漏：面板关闭后注册不清理（无害）；非流式下面板停「生成中…」可接受。
- **边界**：退出聊天再保存 → 拒绝 + 提示回原聊天；回原聊天点生成按钮可重新唤出 pending 面板；不做跨聊天自动保存（复杂低价值，以后再说）。

### 阶段 2 补丁 + 调试面板完善（2026-08-16，commit fb2604a）
- **API 信息实时显示**：aiCaller 拦截器总是注册（有 customApi 覆盖独立 API；无则捕获主 API source/model），捕获后 `options.onApiUsed` 推送 → `updateDebugPanelApi` 动态追加/更新面板 API section（可读格式：独立/主 API + 模型 + source + URL）。
- **section 展开修复（既有 bug）**：`_updatePreVisibility` 里普通 section 的 pre 无 `data-ccore-format` → `undefined===format` 恒 false → 折叠后无法展开。修复：`!p.dataset.ccoreFormat ||` 视为匹配。
- **完成态标题去重**：`finishDebugPanel` 原来把 titleBody 塞进 badge span 内部 + 外面又有一个 → 聊天名显示两遍。改更新整个 `.ccore-debug-title`。
- **中止不自动关面板**：中止后保留现场（失败原因/已流式内容），按钮禁用+「已中止」，用户点 × 手动关。
- **中止后不弹新面板**：catch 分支 showDebugPanel 加 `isDebugPanelOpen` 判断 → 已打开则 finishDebugPanel 更新失败态。
- **独立 API 开关绑定**：SettingsPanel 缺 `$('#continuity_use_independent_api').on('input', ...)` → 勾选不保存、回填旧值 →「去不掉」。已补。
- **立即还原隐藏楼层**：`_callPipeline` 组装完成拿到 assembledChat 后立即还原 is_system（发送阶段 chat 已是原状），finally 兜底。原值精确恢复，不误设已隐藏楼层。

### 设置面板 async tab 清理 + 重排（2026-08-16）
- 注释旧控件：快照间隔、提取当前聊天、提取指定楼层、重建快照、AI 生成楼层/聊天按钮（perMessageStorage 旧方案，待 F 二期）。
- 保留：异步存储开关（移到底部，标注「高级」）、生成模式、独立 API 配置（含拉取模型）、独立 API 开关、生成指令作为最后 user 消息、生成后显示调试面板。
- 独立 API 配置 details 移到「使用独立 API」开关正下方（原来与开关分离）。
- `#continuity_async_actions` 去掉 display:none + `updateAsyncActionsVisibility` 不再隐藏生成区（手动生成不依赖异步开关）。
- tab 名：`异步存储`（用户决定不改名；曾短暂试过「模块生成」已回退）。

### 上线前 P0/P1 建议（2026-08-16，用户确认后实施）
- **P0**：保存链路兜底——`writeFloorModules` + `perMessageStorage.writeMessage` 写失败时 toast（现模块 floor 写失败可能静默）。
- **P0**：确认生成结果确实落盘（floor 有数据 + UI 显示，已实测应通）。
- **P1**：编辑一致性命中——`onEditGeneratedContent`（非模块 generator）与 floor 模块编辑的边界确认。
- **P1**：异步提示词裁剪——决定 `{{CONTINUITY_PROMPT}}/{{CONTINUITY_ORDER}}` 在异步模式是否照发（需用户拍板行为）。

### F 二期：快照/非全量更新系统（设计量较大，单独出稿）
- **问题 A（生成上下文截断）**：重新生成 X 时发给 AI 的 moduleData 须截止到 X-1（把 X-1 当最新），`runModulePipeline` 的 range.end=X-1 已支持，改动集中在宏按目标楼层截断。
- **问题 B（链式后缀重算）**：X 的 raw 更新 → 从 X 到末尾重算 merged。**关键：必须依赖「每层累积中间态快照」才能不全量**——`mergeModulesByOrder` 不是简单可组合函数（有 cumulativeVariables/lastTimeData 等跨 item 中间态），不能 `merge(merge(a,b),c)` 拼接。
  - **快照=内存级累积中间态缓存**（ModuleStore / moduleCacheManager 扩展），**不持久化到 floor**（floor 只存 raw 事实；快照是派生数据，持久化会引入级联一致性维护成本，冷启动一次性全量重建便宜）。
  - 「从 X 重算」= 取 X-1 的中间态快照起步 → 用 X 新 raw 更新 occurrences[X] → 重跑 X..末尾 merge → 更新 X..末尾快照缓存。
  - 冷启动：无缓存时从 0 算到 X-1 一次（一次性 O(X)），后续编辑只花 O(受影响段)。
- **结论**：快照=内存级累积中间态，floor 只存 raw。

### 待讨论（已定稿项）
1. **异步提示词裁剪 + 混合数据源（已确认）**：
   - **position 编码了异步语义**：`body` 系=正文内生成（异步不需要提示词、不存 floor）；`after_body`=正文后生成（异步独立生成、存 floor，数据大头）；`embedded`=**正文内部分留正文、正文后部分异步**（异步生成发送全部正文→正文内部分本就在上下文；即使重生成正文后部分，模块处理层 dedup 按模块名+变量值合并剔除重复，双源共存靠 dedup 兜底）。
   - **数据源天然「混合」**：异步模式 = `chatTextSource`（正文内模块+世界书）+ `asyncChatSource`（floor 正文后模块），`runModulePipeline` 合并多源 raw 数组。
   - **不需要专门 key 存正文内模块**（正文里已有，chatTextSource 免费提取；专门 key 引入剥除/双份一致性成本）。
   - **源互斥硬约束**：异步模式下正文不能残留 after_body 模块（否则双算）——由异步提示词裁剪保证，position 天然表达。
   - 异步裁剪**靠 position 推导**（替代 asyncMode 配置项提案）。
2. configManager 的 asyncModule `storageLocation` 开关：**已定先不做**，异步默认存聊天文件（floorBridge）。

### 快照缓存：冷启动语义（2026-08-16 已确认）
- `snapshots: Map<floor, cumulativeState>`（每层每 identifier 组，内存）。**只向前失效，从不向后**——编辑 Y 只影响 Y 及之后的中间态，0..Y-1 永远有效。
- 冷启动（目标 X）：算 0..X-1 落缓存（O(X)）。
- **改选更前楼层 Y<X**：`snapshots[Y-1]` 已在缓存（冷启动覆盖了 0..X-1⊇0..Y-1），O(1) 取 → 更新 occurrences[Y] → 重算 Y..end。**不重新冷启动**。
- 边界：首次操作就选很前楼层（无缓存）→ 0..Y-1 算一次（O(Y)），一次性，之后增量。
- 诚实提醒：编辑很前楼层时 O(end-Y) 仍接近全量——累积链模型固有（下游依赖上游），Tier 3 只能省前缀。长聊天+频繁改老楼层可后续上「checkpoint 稀疏化」（每 N 层存 checkpoint），后续优化。

---

## 5. 关键文件索引

| 模块 | 文件 |
|---|---|
| 编排入口 | `src/core/pipeline/runModulePipeline.js` |
| 数据源 | `src/core/pipeline/moduleDataSources.js` |
| 缓存层 | `src/core/pipeline/cacheLayer.js` |
| 按消息分组 | `src/core/pipeline/groupByMessage.js` |
| 旧入口（薄封装） | `src/core/moduleProcessor.js` |
| 提取器 | `src/core/moduleExtractor.js` |
| 渲染协调 | `src/core/contextBottomUI.js` |
| iframe 注入 | `src/core/context-ui/iframeRenderer.js` |
| 事件中枢 | `src/core/eventHandler.js` |
| 缓存维护器 | `src/singleton/moduleCacheManager.js` |
| 楼层存储桥 | `src/shared/floorBridge.js` |
| 异步分析 | `docs/PROMPT_INJECTION_ANALYSIS.md` |

---

## 6. 已知坑/约定

- **import 层级**（连环 404 教训）：`src/core/pipeline/` 下文件 → `script.js` 需 **7 个 `../`**（`../../../../../../../script.js`）；→ `singleton/utils/modules` 需 2 个 `../`。新增 pipeline 文件务必核对。
- **循环依赖**：runModulePipeline 不能 import moduleProcessor（环）。groupProcessResultByMessageIndex 已迁出解环。
- **用户约定**：判断放源头（configManager getter / getActiveSourceName），下游不散落判断。
- **用户约定**：不主动 commit，做完只报告。
