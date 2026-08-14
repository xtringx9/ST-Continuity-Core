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

## 3. 6 个调用方现状（仍走旧薄封装，透明转发）

| # | 调用方 | 现状 | 迁移目标 |
|---|---|---|---|
| 1 | `moduleCacheManager.updateModuleCache` | `processModuleData({0,end/null},'auto',undefined,isForce)` ×2 | `runModulePipeline({range,modules:null,cache:force?'write':'both',force})` |
| 2 | `processResultBuilder.buildStyledProcessResult` | `processModuleData(...,'auto',names)` + styleCombiner | `runModulePipeline({range,modules:names,cache:'read',style:true})` |
| 3 | `promptGenerator.generateModuleDataPrompt`（宏） | `processModuleData(...,'auto',names,false,true)` | `runModulePipeline({range,modules:names,cache:'read',showModuleNames:true})` |
| 4 | `promptGenerator.generateSingleChatModuleData`（宏） | `processModuleData(...)` + groupByMessage | `runModulePipeline({range,modules:names,cache:'read',groupByMessage:true})` |
| 5 | `Toolbox` 提取按钮 | `await processModuleData({range,filters},type,names,true,true,true)` | `runModulePipeline({range,modules:names,processType:type,cache:'none',force:true,showModuleNames:true,showProcessInfo:true})` |
| 6 | timeRef 自动并入（内部） | moduleProcessor:107-123 隐式 | runModulePipeline 内部自动并入 |

迁移可选（纯清理死代码），不迁移不影响运行。

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

### 调用方迁移（低优先）
6 处从薄封装改直调 runModulePipeline，迁移一个删一个，全部完成后删薄封装。

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
