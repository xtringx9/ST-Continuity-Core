// generationContext.js
// 生成期上下文状态（F 二期「宏按楼层截断」问题 A + 三态提示词分流）。
//
// 场景1（楼层截断）：重新生成第 X 层模块时，正文给到 X 层，但宏 {{CONTINUITY_MODULE_DATA}}
//   应只读到 X-1 层（X 层的模块数据正要生成，不该作为已存在数据发给 AI）。
// 场景2（三态分流）：异步开启时，宏 {{CONTINUITY_PROMPT}}/{{CONTINUITY_ORDER}} 等需要按
//   当前生成场景区分「同步/异步跟随正文/异步单独生成」。Cc 按钮生成 after_body 模块时，
//   宏应只输出 after_body+embedded 模块；正常游玩时只输出 body 系+embedded。
//
// 用法：
//   moduleAiGenerator 在调 aiCaller 前：setGenerationContextEndFloor(truncateToMesId - 1)
//   moduleAiGenerator pipeline 生成时：setGenerationContextMode('async-alone')
//   promptGenerator 宏读取：getGenerationContextEndFloor() / getGenerationContextMode()
//   （两者为 null 表示正常上下文）
//
// 与 includeHiddenMessages 解耦：不依赖 is_system 隐藏，宏按楼层显式截断。

let generationContextEndFloor = null; // number | null
let generationContextMode = null;     // 'async-alone' | 'async-body' | null

/**
 * 设置生成期上下文截止楼层（含该层）。
 * 生成完成后务必调用 clearGenerationContext() 恢复。
 * @param {number|null} endFloor null=正常上下文
 */
export function setGenerationContextEndFloor(endFloor) {
    generationContextEndFloor = endFloor;
}

/**
 * 读取生成期上下文截止楼层；非生成期返回 null。
 * @returns {number|null}
 */
export function getGenerationContextEndFloor() {
    return generationContextEndFloor;
}

/**
 * 设置生成期上下文模式（三态提示词分流）。
 * 仅 Cc 按钮 pipeline 生成时设置 'async-alone'；raw 模式不走宏无需设置。
 * @param {'async-alone'|'async-body'|null} mode null=清除
 */
export function setGenerationContextMode(mode) {
    generationContextMode = mode;
}

/**
 * 读取生成期上下文模式；非生成期返回 null。
 * @returns {'async-alone'|'async-body'|null}
 */
export function getGenerationContextMode() {
    return generationContextMode;
}

/** 清除生成期上下文（生成完成/失败后调用） */
export function clearGenerationContext() {
    generationContextEndFloor = null;
    generationContextMode = null;
}
