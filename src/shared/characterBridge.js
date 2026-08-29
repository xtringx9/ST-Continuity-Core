// characterBridge.js
// 桥接"角色元数据 / 头像 URL"的获取（与 ST 头像端点约定相关的唯一真相源）。
//
// ⚠️ 头像端点约定（踩坑结论，见 CHAT_READER 头像高清根因）：
//   - 缩略图：getThumbnailUrl('avatar', file) → /thumbnail?type=avatar&file=...
//       ST 后端在 thumbnails.enabled（**默认 true**）时返回 96×144 缩放图，体积/清晰度适合小方框。
//   - 原图（高清）：/characters/<file>
//       ST 聊天里点击头像看大图（src/script.js:10793）、getCharacterAvatar()（src/script.js:2132）均走此路径，
//       即 public/characters/ 静态目录原图，非缩略图。
//   - 切勿用 /User Avatars/<file>：后端虽挂载，但可能不是用户实际头像目录，且仍可能糊。
// 文件名含空格/中文须编码；调用方对原图 img 加 onerror 回退到缩略图更稳妥。

/**
 * 取得角色头像**缩略图** URL（小方框列表用，省流量）。
 * @param {string} avatarFile 角色 avatar 文件名（'none' / undefined 由调用方判默认图）
 * @returns {string}
 */
export function getAvatarThumbUrl(avatarFile) {
    return `/thumbnail?type=avatar&file=${encodeURIComponent(avatarFile)}`;
}

/**
 * 取得角色头像**原图** URL（弹窗大图用，高清，与 ST 聊天大图同源）。
 * @param {string} avatarFile 角色 avatar 文件名
 * @returns {string}
 */
export function getAvatarFullUrl(avatarFile) {
    return `/characters/${encodeURIComponent(avatarFile)}`;
}
