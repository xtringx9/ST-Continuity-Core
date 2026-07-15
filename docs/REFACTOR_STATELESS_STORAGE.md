# perMessageStorage 无状态重构计划

> 创建日期：2026-06-27
> 目标：把 `perMessageStorage` 从"有状态单例"改为"无状态按聊天 key 缓存"，消除 `initChat` 状态依赖

---

## 1. 重构动机

### 1.1 当前设计的根本问题

`perMessageStorage` 是单例对象，用 `this.currentChat` 存"当前是哪个聊天"，所有方法靠它拼路径。

这导致 4 个问题：

1. **`currentChat` 未设置就崩** — `writeMessage` 第一行 `_ensureInitialized()` 抛异常，用户从 Cc 菜单"重新生成 → 保存"会悄悄失败
2. **切换聊天不自动同步** — `CHAT_CHANGED` 事件没注册 `initChat`，`currentChat` 永远停在第一次设置的那个聊天
3. **并发会串数据** — 多标签页 / 后台批量 + 前台切换会写到错误聊天的目录
4. **调用方已经在绕过状态** — `extensionSettingsManager.js` 里每个按钮处理函数都自己调 `initChat`，本质是"伪无状态"，还多付了 3-4 次网络请求的代价

### 1.2 为什么无状态更好

| 维度 | 有状态（当前） | 无状态（目标） |
|---|---|---|
| 首次进入聊天 | 3-4 次请求（initChat） | 0 次 |
| 每次 writeMessage | 1 次 | 1 次（+ 首次 readMeta 可缓存） |
| 多标签页/多聊天 | **直接坏掉** | 天然支持 |
| 并发安全 | 差 | 好 |
| 切换聊天开销 | 3-4 次 + 全部缓存清空 | 0 次 |
| 调用方代码 | 每次都要 initChat | 直接调 writeMessage |

无状态在性能上不输，正确性上完胜。

---

## 2. 当前调用点全景（重构影响范围）

### 2.1 `perMessageStorage` 对外 API（共 11 个方法）

| 方法 | 当前签名 | 状态依赖 |
|---|---|---|
| `initChat(charName, chatFile, chatIdHash)` | — | 设置 `currentChat` |
| `extractMessageModules(text)` | 纯函数，无依赖 | 无 |
| `getMessage(mesId, swipeId)` | 内部用 `currentChat` | **强依赖** |
| `writeMessage(mesId, swipeId, data, opts)` | 内部用 `currentChat` | **强依赖** |
| `updateMessage(mesId, swipeId, data)` | 调 writeMessage | **强依赖** |
| `deleteMessage(mesId)` | 内部用 `currentChat` | **强依赖** |
| `getMessages(from, to)` | 内部用 `currentChat` | **强依赖** |
| `getSnapshot(mesId)` | 内部用 `currentChat` | **强依赖** |
| `writeSnapshot(mesId, states)` | 内部用 `currentChat` | **强依赖** |
| `getAccumulatedState(mesId)` | 调 getSnapshot + getMessages | **强依赖** |
| `migrateChat(old, new)` | 内部用 `currentChat` 比对 | 部分 |
| `clearCache()` / `flush()` | 内部用 `currentChat` | **强依赖** |
| 属性 `metaCache` | 内部用 `currentChat` 拼 path | **强依赖** |

`extractMessageModules` 是唯一的纯函数，不需要改。

### 2.2 调用点清单（共 22 处，5 个文件）

| 文件 | 行号 | 调用 | 上下文 |
|---|---|---|---|
| `extensionSettingsManager.js` | 209 | `initChat` | 提取当前聊天 |
| `extensionSettingsManager.js` | 225 | `writeMessage` | 提取后逐条写入 |
| `extensionSettingsManager.js` | 274 | `initChat` | 提取指定楼层 |
| `extensionSettingsManager.js` | 289 | `updateMessage` | 更新楼层 |
| `extensionSettingsManager.js` | 307 | `currentChat` | 重建快照前检查 |
| `extensionSettingsManager.js` | 312 | `metaCache` | 读 dirtyFrom |
| `extensionSettingsManager.js` | 366/373 | `extractMessageModules` | 提取 swipe 文本 |
| `extensionSettingsManager.js` | 503 | `initChat` | AI 生成楼层 |
| `extensionSettingsManager.js` | 535 | `initChat` | AI 生成聊天 |
| `moduleAiGenerator.js` | 77 | `writeMessage` | 保存回调（skipStorage 路径） |
| `moduleAiGenerator.js` | 102 | `getMessage` | loadCurrentContent 回调 |
| `moduleAiGenerator.js` | 323 | `extractMessageModules` | 从 AI 回复提取 |
| `moduleAiGenerator.js` | 345/351 | `writeMessage` | 批量生成后写入 |
| `messageAiButton.js` | 607 | `getMessage` | 编辑模块前读取 |
| `messageAiButton.js` | 640 | `updateMessage` | 编辑模块后保存 |
| `messageAiButton.js` | 696 | `getMessage` | 编辑 generator 前读取 |
| `messageAiButton.js` | 726 | `updateMessage` | 编辑 generator 后保存 |
| `Toolbox.js` | 475 | `initChat` | 调试按钮 |
| `Toolbox.js` | 490 | `writeMessage` | 调试按钮 |
| `Toolbox.js` | 498 | `getMessage` | 调试按钮 |
| `Toolbox.js` | 511 | `updateMessage` | 调试按钮 |
| `Toolbox.js` | 523 | `writeSnapshot` | 调试按钮 |
| `Toolbox.js` | 531 | `getSnapshot` | 调试按钮 |
| `Toolbox.js` | 539 | `getAccumulatedState` | 调试按钮 |
| `Toolbox.js` | 544 | `metaCache` | 调试按钮 |

---

## 3. 重构目标设计

### 3.1 核心思路：按 chatKey 缓存，方法签名加 chatKey

**chatKey 定义**：`${characterName}::${chatFileName}`（与 `moduleAiGenerator._getChatKey()` 一致）

**缓存结构改造**：

```javascript
// 旧：单一 currentChat + 扁平 Map
this.currentChat = { characterName, chatFileName, chatIdHash };
this.messageCache = new Map();        // batchKey → { mesId → data }
this.metaCache = null;                // 单一对象

// 新：按 chatKey 分组的嵌套 Map
this.chatStores = new Map();          // chatKey → ChatStore
// ChatStore 结构：
// {
//   characterName, chatFileName, chatIdHash,
//   messageCache: Map<batchKey, Map<mesId, data>>,
//   snapshotCache: Map<batchKey, object>,
//   metaCache: object|null,
//   metaDirty: boolean,
//   dirEnsured: boolean,
//   saveTimer: number|null,
// }
```

### 3.2 新方法签名（所有方法加 chatKey 首参）

```javascript
// 替代 initChat —— 惰性初始化，返回 ChatStore
async _ensureChatStore(characterName, chatFileName, chatIdHash)

// 对外 API（全部加 characterName + chatFileName 首参）
async getMessage(characterName, chatFileName, mesId, swipeId)
async writeMessage(characterName, chatFileName, mesId, activeSwipeId, swipesData, opts)
async updateMessage(characterName, chatFileName, mesId, activeSwipeId, swipesData)
async deleteMessage(characterName, chatFileName, mesId)
async getMessages(characterName, chatFileName, fromMesId, toMesId)
async getSnapshot(characterName, chatFileName, mesId)
async writeSnapshot(characterName, chatFileName, mesId, moduleStates)
async getAccumulatedState(characterName, chatFileName, mesId)
async migrateChat(oldCharName, oldChatFile, newCharName, newChatFile)
getMeta(characterName, chatFileName)  // 同步读 metaCache
clearChatCache(characterName, chatFileName)
async flush(characterName, chatFileName)  // 或 flushAll()
```

### 3.3 关键改动点

1. **删除 `initChat`**，改为 `_ensureChatStore`（私有，惰性调用）
2. **删除 `_ensureInitialized` 检查** — 不再有"未初始化"状态
3. **删除 `this.currentChat`** — 不再有单一活动聊天概念
4. **`meta.json` 缓存按 chatKey 隔离** — 切换聊天不清空，下次访问命中缓存
5. **`dirEnsured` 标记** — 每个 ChatStore 记录目录是否已创建，避免重复 `ensureDir` 调用
6. **`extractMessageModules` 保持不变** — 纯函数，无状态
7. **`saveTimer` 按 chatKey 独立** — 不同聊天的 meta 防抖互不干扰

### 3.4 不改的部分

- `storageKeyBuilder.js` — 路径构建纯函数，无需改
- `continuityCoreServerApi.js` — HTTP 封装，无需改
- 存储文件格式（JSONL / snapshot JSON / meta JSON）— 完全不变
- `extractMessageModules` 内部逻辑 — 不变

---

## 4. 重构步骤（建议按此顺序，每步可独立验证）

### Step 1：改造 `perMessageStorage.js` 内部结构

**改动**：
- 引入 `ChatStore` 概念，`this.chatStores = new Map()`
- 添加 `_ensureChatStore(characterName, chatFileName, chatIdHash)` 私有方法（封装原 `initChat` 的目录创建 + meta 读取逻辑，但改为"已存在则跳过"）
- 保留 `initChat` 作为兼容包装（内部调 `_ensureChatStore`，供过渡期使用）

**验证**：现有调用点不改，行为不变。

### Step 2：方法签名加 chatKey（内部实现）

**改动**：每个 public 方法加 `characterName, chatFileName` 首参，内部用 `_ensureChatStore` 获取 ChatStore，从 ChatStore 读缓存/拼路径。

**保留旧签名兼容**：旧签名（只有 mesId）仍可工作，内部从"最近活动 chatKey"推导（`this._lastActiveChatKey`）。这样过渡期调用点可逐步迁移。

**验证**：现有调用点不改，行为不变（走兼容路径）。

### Step 3：迁移调用点（批量替换）

**改动**：把 22 处调用点全部改为新签名，传完整 `characterName, chatFileName`。

| 文件 | 迁移策略 |
|---|---|
| `extensionSettingsManager.js` | 删除 4 处 `initChat` 调用，把 `charName/chatFile` 传给 writeMessage/updateMessage |
| `moduleAiGenerator.js` | 从 `getCurrentChatDetails()` 取 charName/chatFile 传入；`_createSaveCallback` 闭包捕获这些值 |
| `messageAiButton.js` | 从 `chat[mesId]` 或 context 取 charName/chatFile 传入 |
| `Toolbox.js` | 调试按钮从 context 取 charName/chatFile 传入 |

**验证**：所有调用点用新签名，兼容路径不再触发。

### Step 4：删除兼容代码 + `initChat`

**改动**：
- 删除 `initChat` 方法
- 删除 `_ensureInitialized` 和 `this.currentChat`
- 删除"最近活动 chatKey"推导逻辑
- 保留 `clearCache` 改为 `clearChatCache(characterName, chatFileName)`

**验证**：全项目搜不到 `initChat` 调用，搜不到 `currentChat` 引用。

### Step 5：eventHandler 接入 + 文档同步

**改动**：
- `eventHandler.js` 注册 `CHAT_CHANGED → clearChatCache(oldChar, oldFile)`（可选，释放内存）
- 不需要 `CHAT_CHANGED → initChat` 了（无状态无需预初始化）
- 更新 CLAUDE.md：删除 `CHAT_CHANGED → initChat`，改写"存储与缓存协调"节
- 更新 PROMPT_INJECTION_ANALYSIS.md 问题 4 状态

**验证**：文档与代码一致。

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 签名变化大，漏改调用点 | Step 2 的兼容期让漏改不会立即崩，运行时会 warn log 提示 |
| `metaCache` 从单一变 Map，内存占用增加 | 每个 meta.json 很小（< 1KB），即使 100 个聊天 < 100KB，可忽略 |
| `chatIdHash` 不匹配检测语义变化 | 在 `_ensureChatStore` 里保留检测逻辑，warn log 即可，不阻断 |
| `extensionSettingsManager` 批量提取循环性能 | 原本每条都走 `initChat` 3-4 次请求，重构后首次 `_ensureChatStore` 1-2 次，后续命中缓存 0 次，**性能提升** |
| 多聊天并发写 meta.json 冲突 | 不同聊天的 meta 是不同文件，无冲突；同聊天的并发由 `saveTimer` 防抖 |

---

## 6. 不在本次重构范围内的事

以下问题留待后续，不在此重构中处理：

- **问题 2（生成内容注入路径未通）** — 独立任务，改 `macroManager` + 世界书
- **问题 3（异步模式下宏数据源未切换）** — 独立任务，改 `moduleCacheManager` 数据源
- **问题 1（promptInjector 僵尸代码）** — 独立任务，删除或接入
- **`getAccumulatedState` 的 Phase 2 累积逻辑** — `_applyModulesToState` 还是 TODO，独立实现
- **快照重建逻辑（Phase 3）** — `onAsyncRebuildSnapshots` 还是 TODO，独立实现

---

## 7. 验收标准

重构完成后应满足：

1. ✅ 全项目搜不到 `.initChat(` 调用
2. ✅ 全项目搜不到 `currentChat` 引用（除文档历史记录外）
3. ✅ 全项目搜不到 `_ensureInitialized` 调用
4. ✅ 用户刚开 ST、直接进聊天用 Cc 菜单"重新生成 → 保存"能成功（无需先去扩展设置面板点按钮）
5. ✅ 在 A 聊天操作后切换到 B 聊天操作，数据不会串
6. ✅ 调试按钮（Toolbox）功能正常
7. ✅ 扩展设置面板"提取/AI生成"功能正常
8. ✅ CLAUDE.md 和 PROMPT_INJECTION_ANALYSIS.md 与代码一致

---

## 附：新 `_ensureChatStore` 伪代码

```javascript
async _ensureChatStore(characterName, chatFileName, chatIdHash) {
    const chatKey = `${characterName}::${chatFileName}`;

    // 已存在则直接返回（惰性缓存）
    if (this.chatStores.has(chatKey)) {
        return this.chatStores.get(chatKey);
    }

    const store = {
        characterName,
        chatFileName,
        chatIdHash,
        messageCache: new Map(),
        snapshotCache: new Map(),
        metaCache: null,
        metaDirty: false,
        dirEnsured: false,
        saveTimer: null,
    };

    // 确保目录存在（只调一次）
    const storageDir = getChatStorageDir(characterName, chatFileName);
    await ensureContinuityCoreDir(`${storageDir}/messages`);
    await ensureContinuityCoreDir(`${storageDir}/snapshots`);
    store.dirEnsured = true;

    // 读取或创建 meta
    const metaPath = getMetaPath(characterName, chatFileName);
    const result = await readContinuityCoreMeta(metaPath);
    if (result.success && result.data) {
        store.metaCache = result.data;
        if (store.metaCache.chatIdHash && store.metaCache.chatIdHash !== chatIdHash) {
            debugLog('PerMessageStorage', `chatIdHash 不匹配: ${store.metaCache.chatIdHash} → ${chatIdHash}`);
        }
    } else {
        store.metaCache = {
            version: '1.0', chatIdHash, characterName, chatFileName,
            storagePath: storageDir, totalMessages: 0,
            snapshotInterval: this.snapshotInterval,
            latestSnapshotMesId: -1, dirtyFromMesId: null,
            lastUpdated: new Date().toISOString(),
        };
        store.metaDirty = true;
        this._scheduleMetaSave(store);
    }

    this.chatStores.set(chatKey, store);
    return store;
}
```
