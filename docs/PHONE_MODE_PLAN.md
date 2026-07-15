# 手机模式（Phone Mode）功能规划

> 状态：Phase 0 + Phase 1 + Phase 2 已完成（存储骨架 + 渲染链路 + 手机内齿轮设置 + 黑框自适应 + 目录迁至 src/features/phone/）
> 更新日期：2026-07-15
> 入口：Cc 菜单的「手机模式」按钮（`src/features/entry/EntryButton.js`）→ 打开后点右上角 ⚙️ 设置模块/字段映射
> 存储方案：**方案 B —— 独立顶层配置组 `phone_config`**（镜像 `generator_config`）

## 一、目标与定位

点击 Cc 菜单「手机模式」按钮，打开一个 **iframe 模态**（srcdoc 同源），内部渲染一个「手机外壳」UI，把**特定模块**遵循以下格式的已生成输出，渲染成手机聊天界面的一条条气泡：

```
[msg|plat(平台):线上平台|grp(群组):（如非群聊可为空）群组名|dm(私聊):（如非私聊可为空）消息接收方线上id(真实姓名)|mems(成员):线上id(真实姓名),etc.|sender(发送):消息发送人线上id(真实姓名)|time(时间):YYYY-MM-DD HH:MM:SS|type(类型):text/voice/img/money/loc/call/file,默认为text|cont(内容):money格式:货币金额,voice格式:语音内容(时长),call格式:来电/结束电话(时长),loc格式:大地点/中地点/小地点,...([file]模块可在此嵌入)]
```

- **必须用 iframe（srcdoc）隔离**，避免 SillyTavern 样式污染。
- **只读查看器**：只渲染已生成内容，不重新触发生成。
- 一条 `[msg]` 段 = 一条消息。

## 二、核心设计决策（已与用户确认）

| # | 决策 | 理由 |
|---|---|---|
| 1 | **模块识别走配置驱动**（运行时从 module_config 选模块），不硬编码模块名 | 模块名会被用户改名/删除，硬编码迟早崩 |
| 2 | **新增独立顶层配置组 `phone_config`**（挂 `extension_settings[ext]['phone_config']`），与 `generator_config` 同构；**不放** module_config、也**不放** extension_config | 手机是与「模块定义」正交的「查看器应用」；集中管理、可单独导出/备份，且 module-editor 保持纯净 |
| 3 | 字段映射（sender/plat/grp/...）做成**通用映射表**，存在 `phone_config` 里，**不写回/污染 module_config**（variables/prompts） | 映射是手机专属偏好，与模块本体解耦 |
| 4 | **手机 iframe 不需要「注入配置让 iframe 读」**；父主窗口读 `configManager` 生成 HTML 后写入 srcdoc，交互在 `onLoad` 里由父直接 `addEventListener` | 与 module-editor / 汇总弹窗完全一致：iframe 只是渲染表面，读配置全在父主窗口脚本（见 §五） |
| 5 | 仅**只读**展示，气泡无跳转功能 | 当前需求 |
| 6 | 当前仅渲染**单个模块**（= 一个手机场景），不做多模块合并 | 未来购物/朋友圈等各自一个模块 + 各自条目即可天然支持 |
| 7 | **引用模块按 `name`**（模块落盘无稳定 id，见 §三注） | 项目既定：`normalizeConfig` 落盘时丢弃 `id`，全项目按 name 引用 |
| 8 | **模块级失配 → 诚实回退选择器**；**变量级失配 → 保留映射 + UI 提示**（见 §八） | 改名/删模块必须重选；个别变量对不上不必推翻全部映射 |
| 9 | 字段映射引用的是变量**定义名**（`variable.name`，非最近一次生成值） | 配置只有定义名；下拉选项来自 `module.variables` |
| 10 | 渲染取数复用现有 `processModuleData`（已按消息索引分组、带 timeline）+ `timeParser.js`（现成时间戳排序），不重造 | 消息已按时间排序完毕 |

## 三、独立配置组 `phone_config`（Phase 0）

新增 `src/config/phoneConfigTemplate.js`，并在 `configManager` 里镜像 `generator_config` 的四件套方法。

### 结构
```js
// extension_settings[ext]['phone_config']
{
  metadata: { version, updatedAt },       // 同 generator_config 风格
  scenes: [                               // 每个「手机场景」= 一个启用的模块视图
    {
      moduleName: 'wechat',               // 引用模块（按 name；模块无稳定 id）
      enabled: true,
      fieldMap: {                         // [msg] 各字段映射，默认 raw（不出现即 raw）
        sender: { source: 'variable', variable: 'char_name' },
        plat:   { source: 'raw' }
        // grp/dm/mems/time/type/cont 缺省即 raw
      }
    }
  ],
  appearance: { /* 预留：手机外壳全局外观，MVP 可空 */ }
}
```
> 说明：用 `scenes[]` 而非单模块，是为未来「多个手机场景（购物/朋友圈）」留结构位；MVP 阶段只渲染 `enabled` 的场景（当前按单个处理，不做跨场景合并）。

### 注：模块引用为何按 `name`
`moduleConfigTemplate.js` 里模块 schema 虽定义了 `id`（必填），但 `normalizeConfig`（:478）落盘时 `// id: module.id || generateId()` 被注释掉——**`id` 实际不持久化**。全项目按 `name` 引用模块，故 `phone_config` 也按 `name`。（若未来要彻底免疫改名，需先重启用模块 `id`，属独立改动，blast radius 大，暂不做。）

### configManager 需新增（镜像 generator_config）
- `loadPhoneConfig()` / `getPhoneConfig()` / `setPhoneConfig(cfg)` / `savePhoneConfigNow()` / `schedulePhoneAutoSave()`
- 常量 `PHONE_CONFIG_KEY = 'phone_config'`，缓存 `this.phoneConfig` / `this.isPhoneConfigLoaded`
- `load()`（:159）里追加 `this.loadPhoneConfig()`
- `phoneConfigTemplate.js` 提供 `normalizePhoneConfig()` / `DEFAULT_PHONE_CONFIG_VALUES`

### 好处
- module_config / module-editor 完全不动，保持纯净。
- 手机配置集中，可单独导入/导出/备份。
- 与 generator_config 同构，复用成熟模式，风险低。

## 四、`[msg|…]` 解析规范

- **分隔符**：`|`；首段固定 `msg` 标识。
- **字段映射**：
  - `plat`：平台名（→ 标题/图标）
  - `grp`：群组名（→ 群聊标题，非群聊可空）
  - `dm`：私聊接收方线上 id/真实姓名（非私聊可空）
  - `mems`：成员列表（逗号分隔）
  - `sender`：发送者
  - `time`：`YYYY-MM-DD HH:MM:SS`（气泡时间 / 排序键，复用 `timeParser`）
  - `type`：`text/voice/img/money/loc/call/file`，默认 `text`
  - `cont`：内容，按 type 二次解析
- **type 分支渲染**：
  - `text` → 纯文本气泡
  - `voice` → 语音条 + 时长
  - `img` → 图片占位/链接
  - `money` → 金额卡片（货币+金额）
  - `loc` → 大/中/小地点三级
  - `call` → 来电/通话结束 + 时长
  - `file` → `cont` 内嵌其他模块
- **容错**：缺省值（type=text，dm/grp 可空）；非法格式降级为普通文本气泡，不崩。

## 五、iframe 渲染机制（关键，已修正旧思路）

**旧思路（已废弃）**：向 srcdoc iframe 注入 config payload + postMessage 回父写盘。

**正确机制（与现有架构一致）**：
- 手机页用 `IframeModal`（`src/shared/IframeModal.js`）的 **srcdoc 模式**（`variant:'center'`、单实例），与汇总弹窗（`openContextBottomAsModal`，`contextBottomUI.js:535`）同源。
- srcdoc iframe 是**同源**的，父脚本在 `onLoad` 通过 `iframe.contentDocument` 直接拿文档并操作/绑事件——**`module-editor` 就是这么干的**：
  - `EntryButton.js:402` 用 `iframeModal.open(pageUrl, ..., { onLoad: (iframe) => { const doc = iframe.contentDocument; initModuleEditor(doc); ... } })`
  - `ModuleEditor.js:1-7` 注释明确「脚本运行在主窗口上下文，直接操作 iframe 的 DOM」，且 `ModuleEditor.js:7` import 了 `configManager`。
  - iframe 内**无任何读配置代码**，所有读/写都在父主窗口。
- 因此手机模式链路：
  1. 父读 `configManager.getModules()` + `configManager.getPhoneConfig()` → 生成手机 HTML（外壳 + 气泡，数据已烤进 HTML）
  2. `iframeModal.open(html, { srcdoc:true, variant:'center', onLoad })`
  3. 齿轮/模块勾选等交互，由父在 `onLoad` 里直接给 iframe 内元素 `addEventListener`，改完调 `configManager.setPhoneConfig` + `savePhoneConfigNow` 再重渲
  4. **全程无 postMessage、无额外注入机制**

## 六、双层渲染：手机外壳 vs 气泡皮肤

- **外壳**（状态栏、聊天背景、滚动区、底部导航条）= `assets/css/phone.css`，由插件控制，极简。
- **气泡皮肤** = 复用 `styleCombiner`（`getCombinedCustomStyles`，`src/modules/styleCombiner.js`）注入的模块 `customStyles`，由用户控制。
  - `styleCombiner` 输入 x 条 entries → 产出 x 条样式字符串，**不包 `<details>`**（`<details class="bottom-summary">` 是 `contextBottomUI.js:552` 的 bottom 容器模板带的，非 styleCombiner）。
  - **结构（哪条 msg、type、字段值）从 raw 生成文本解析 `[msg|…]`**（最可靠）；**皮肤调 `buildStyledProcessResult` / `getCombinedCustomStyles` 拿该模块注入 customStyles 后的样式**，作为气泡容器 class/样式来源。即「结构读 raw 文本，皮肤读 styleCombiner」。

## 七、设置入口（均写 `phone_config`）

1. **手机页内齿轮（主入口）**：iframe 内齿轮打开「场景/模块选择 + 字段映射」子视图，列出当前所有模块（父注入到 HTML），勾选模块即增删 `phone_config.scenes[]` 条目并设 `enabled`；字段映射下拉选项来自选定模块的 `module.variables` 定义名。改动由父直接写 `configManager.setPhoneConfig` + `savePhoneConfigNow` 后重渲。
2. （可选，后置）如需在 module-editor 里也能配，同样只读写 `phone_config`，不碰 module 定义。MVP 阶段设置**只放手机页齿轮**，避免两处入口。

## 八、模块/变量失配处理（保留映射，精准降级）

**分两层，触发条件不同：**

### 模块级失配 → 诚实回退选择器
- `phone_config.scenes[].moduleName` 在当前 `module_config` 中**完全找不到**（模块被删或改名）→ 该场景失效，回退到模块选择器让用户重选。

### 变量级失配 → 保留映射 + UI 提示（用户新增策略）
用户重选模块后（或换到相似模块时），**逐字段比对 fieldMap 引用的 `variable` 是否仍存在于新模块的 `variables`（按定义名 `variable.name` 比对）**：
- **仍存在** → 映射**原样保留**（真·改名场景变量集不变时，用户零感知，最大收益）。
- **不存在** → **不静默删除**，而是：
  - 渲染时该字段临时按 `source:'raw'` 处理（不崩）；
  - 设置 UI 中把该条**标红提示**「变量 X 已不存在，请重选」；
  - fieldMap 里原映射**保留**（若用户又改回原模块名，映射自动还原，无需重配）。
- `source:'raw'` 的字段不受任何影响。

**覆盖的三种场景：** 真·改名（全保留）、换相似模块（重叠保留、差异提示）、换无关模块（全部提示重映射）。

## 九、空状态与降级

- 没有任何启用的场景（`scenes` 为空或全 disabled）→ 空状态提示「请在手机设置中选择要渲染的模块」。
- 选定模块在当前聊天尚未生成内容 → 空状态提示「该模块本会话尚未生成内容，请先触发一次」。
- 模块级失配 → 见 §八（回退选择器）。
- 变量级失配 → 见 §八（保留映射 + 回退 raw + 标红提示）。

## 十、建议的分阶段实现

- **Phase 0（schema + configManager）**：新增 `src/config/phoneConfigTemplate.js`（`normalizePhoneConfig` / `DEFAULT_PHONE_CONFIG_VALUES`）；`configManager` 加 `phone_config` 四件套（load/get/set/saveNow + schedule），`load()` 追加 `loadPhoneConfig()`。
- **Phase 1（MVP）**：`EntryButton.js:389` 由 `infoLog` 改为 `openPhoneModeModal()`；新增 `src/core/context-ui/phoneMode.js`（`openPhoneModeModal`）、`src/core/context-ui/phoneRenderer.js`（`buildPhoneHtml` 解析 `[msg]`）、`assets/css/phone.css`；模块选择器 + `[msg]` 解析 + 手机外壳 + customStyles 气泡皮肤 + 空状态。
- **Phase 2**：手机页齿轮设置（场景选择 + 字段映射 UI，含 §八 失配处理）+ 持久化（写 `phone_config`）。
- **Phase 3（可选，未规划）**：多场景合并时间线、范围选择（仅当前消息/指定范围）、`appearance` 外观自定义。

## 十一、待落地的关键文件清单

| 文件 | 动作 |
|---|---|
| `src/config/phoneConfigTemplate.js` | 新增：`phone_config` schema + `normalizePhoneConfig` + `DEFAULT_PHONE_CONFIG_VALUES` |
| `src/singleton/configManager.js` | 改：加 `phone_config` 四件套（load/get/set/saveNow + schedule），`load()` 追加 `loadPhoneConfig()` |
| `src/features/entry/EntryButton.js` | 改：`case 'mobile'` 调 `openPhoneModeModal()` |
| `src/core/context-ui/phoneMode.js` | 新增：`openPhoneModeModal()`，组装 srcdoc HTML，调 IframeModal |
| `src/core/context-ui/phoneRenderer.js` | 新增：`buildPhoneHtml(modulesData)`，`[msg\|…]` 解析为气泡 HTML |
| `assets/css/phone.css` | 新增：手机外壳 + 状态栏 + 气泡 + 各 type 样式 |
| `docs/CONFIG_README.md` | 改（Phase 0 后）：补充第四套配置 `phone_config` 说明 |

> **注**：module_config / module-editor / moduleConfigTemplate.js **均不改动**（方案 B 的核心收益之一）。
