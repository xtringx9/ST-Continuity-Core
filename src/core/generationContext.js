// generationContext.js
// 生成期上下文状态（F 二期「宏按楼层截断」问题 A）。
//
// 场景：重新生成第 X 层模块时，正文给到 X 层，但宏 {{CONTINUITY_MODULE_DATA}} 应只读到 X-1 层
// （X 层的模块数据正要生成，不该作为已存在数据发给 AI）。
//
// 用法：
//   moduleAiGenerator 在调 aiCaller 前：setGenerationContextEndFloor(truncateToMesId - 1)
//   promptGenerator 宏读取：getGenerationContextEndFloor()（null 表示正常上下文）
//
// 与 includeHiddenMessages 解耦：不依赖 is_system 隐藏，宏按楼层显式截断。

let generationContextEndFloor = null; // number | null

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

/** 清除生成期上下文（生成完成/失败后调用） */
export function clearGenerationContext() {
    generationContextEndFloor = null;
}
