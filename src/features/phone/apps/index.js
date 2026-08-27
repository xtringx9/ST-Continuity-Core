// App 皮肤注册表（手机模式）
//
// 架构：手机桌面上每个「App」= 一个皮肤模块，全部固定显示（真手机形态）。
// 消息进哪个 App 由**数据驱动**：scene.fieldMap 把模块的某个变量映射到「platform」
// 语义字段，消息的 platform 值（wechat/微信/qq/line…）经 routePlatform 分发进对应 App，
// 未匹配/空值归 generic。scene 不再承载 App 归属配置（旧配置里的 skinId 字段仅兼容保留）。
// 皮肤内按「发送者」分组会话（同平台不同角色 = 多会话；同角色不同平台 = 进不同 App）。
// 每个皮肤独立目录（index.js 渲染逻辑 + 独立 css），扩展新 App 两步：
//   1) 新建 apps/<id>/ 目录，实现皮肤契约（见下）
//   2) 在下方 SKINS 数组挂一行（platform 别名见 phoneMode.PLATFORM_ALIASES）
//
// 皮肤契约（renderAppHtml）：
//   renderAppHtml(conversations) → { list, chats }
//     list: 会话列表 HTML（皮肤自带容器样式；每个可点击项带 data-conv=索引）
//     chats: 各会话聊天窗口 HTML（皮肤自带容器，默认 hidden，data-conv=索引）
//   phoneRenderer 负责外壳层导航：home ↔ App（会话列表）↔ 会话（聊天窗口）
//
// 注意：新增皮肤时若需要照片/文件等富媒体渲染，通知 phoneMode 在映射阶段补数据
// （当前 MESSAGE_FIELDS 仅 sender/content/time/type/platform 五字段的最小集）。
import { buildGenericSkin } from './generic/index.js';

const SKINS = [
    buildGenericSkin(),
    // 后续：wechat / qq / line 各占一个目录，实现相同契约后在此挂载
];

/** 界面语义字段列表（设置面板字段映射下拉与渲染共用） */
export const MESSAGE_FIELDS = ['sender', 'content', 'time', 'type', 'plat', 'dm', 'grp', 'mems'];

/** 界面语义字段中文名（设置面板标签） */
export const MESSAGE_FIELD_LABELS = {
    sender: '发送者',
    content: '内容',
    time: '时间',
    type: '类型',
    plat: '平台（wechat/qq/line → 路由到对应 App）',
    dm: '私聊（接收方）',
    grp: '群组',
    mems: '成员（逗号分隔）',
};

/**
 * 获取全部已注册皮肤
 * @returns {Array<Object>}
 */
export function getRegisteredSkins() {
    return SKINS.slice();
}

/**
 * 按 skinId 取皮肤；未注册 / 空 → 回退到第一个（generic）
 * @param {string} skinId
 * @returns {Object} 皮肤对象 { id, label, icon, cssPath, renderAppHtml }
 */
export function getAppSkin(skinId) {
    return SKINS.find((s) => s.id === skinId) || SKINS[0];
}