// dedupSemanticStep.js
// 语义级二次去重（全量模块专用，F 二期去重增强）。
//
// 解决的问题：
//   ① 非 after_body 全量模块（如 embedded / body / body_surround / specific_position）在
//      dedupStep.js 中因 key 含完整 raw（notAfterBody 项），书写差异（空格、变量顺序）或 time
//      格式差异（如「2024-09-21 周六 17:41:15」vs「2024-09-21 17:41:15」）无法合并，几乎不去重。
//   ② 第一次 deduplicateModules 发生在 attachStructuredTimeData / completeTimeVariables 之前，
//      time 尚未数值化，只能比原始文本。
//
// 本步骤放在 normalize 的「时间数值化之后」，此时每条模块已带 module.timeData.startTime.timestamp，
// 直接复用（不重解析），把 time 变量替换为时间戳签名参与 key，其余变量走归一化后的 variables。
//
// 范围：仅作用于 outputMode === 'full'。增量模块由 processIncrementalModules 按 identifier 分组 +
// mergeModulesByOrder 自管（且第一次 dedup 已按值合并），不在此重复处理，避免改变其 diff>2 的
// messageIndex 推进语义——增量模块原样透传。
//
// 性能：
//   - 模块总数 < 2 或全量模块 < 2 条时短路返回（第一次 dedup 已处理，免遍历）；
//   - 只对 full 模块构建 key / JSON.stringify，增量模块零开销；
//   - 复用已数值化的 timeData，不调用 parseTimeDetailed。
//
// 本文件无 ST 依赖（纯函数），可在纯 node 下单元测试。

/**
 * 取模块 time 变量对应的时间戳签名；无效 / 不完整 / 无 timestamp 时返回 null。
 * @param {Object} module 已数值化时间的模块
 * @returns {string|null}
 */
function getTimeSignature(module) {
    const td = module?.timeData;
    const st = td?.startTime;
    if (td?.isValid && td?.isComplete && st?.timestamp !== undefined) {
        return `t${st.timestamp}`;
    }
    return null;
}

/**
 * 构建语义去重键（不含 raw；time 变量用时间戳签名替代文本）。
 * key = { moduleName, variables }，其中变量名含 time 的条目值替换为 `t{timestamp}`（若可用）。
 * @param {Object} module
 * @returns {string}
 */
export function getSemanticKey(module) {
    const vars = {};
    for (const [name, value] of Object.entries(module.variables)) {
        if (name.toLowerCase().includes('time')) {
            const sig = getTimeSignature(module);
            vars[name] = sig !== null ? sig : value;
        } else {
            vars[name] = value;
        }
    }
    return JSON.stringify({ moduleName: module.moduleName, variables: vars });
}

/**
 * 把单条模块并入语义去重 Map（跨层/跨批复用：主管线 dedupSemantic 与快照 rebuildProcessor 共用）。
 * ⚠️ 增量模块（outputMode==='incremental'）不参与、恒返回 true（由调用方透传），
 *    其合并归 processIncrementalModules 按 identifier 分组 + merge 自管。
 * @param {Map} map 语义去重 Map（key → module）
 * @param {Object} module 已数值化时间（attach+complete 之后）的模块
 * @param {Array} moduleConfigs 模块配置数组
 * @returns {boolean} true=新增（调用方应保留）；false=语义重复（调用方应丢弃）
 */
export function mergeSemanticModule(map, module, moduleConfigs) {
    const cfg = moduleConfigs?.find(c => c.name === module.moduleName);
    if (cfg && cfg.outputMode === 'incremental') return true;

    const key = getSemanticKey(module);
    const existing = map.get(key);
    if (existing) {
        // 累积本模块出现过的楼层
        if (!existing.messageIndexHistory) existing.messageIndexHistory = [existing.messageIndex];
        if (!existing.messageIndexHistory.includes(module.messageIndex)) {
            existing.messageIndexHistory.push(module.messageIndex);
        }
        // 全量模块：保留较小 messageIndex（与 dedupStep 全量分支一致）
        const cur = module.messageIndex;
        const old = existing.messageIndex;
        if (cur >= 0 && old >= 0 && cur < old) existing.messageIndex = cur;
        else if (cur >= 0 && old < 0) existing.messageIndex = cur;
        return false;
    }
    if (!module.messageIndexHistory) module.messageIndexHistory = [module.messageIndex];
    map.set(key, module);
    return true;
}

/**
 * 对全量模块做语义级二次去重（增量模块原样透传）。
 * @param {Array} modules 已去重一次（deduplicateModules）且已数值化时间（attach+complete）的模块数组
 * @param {Array} moduleConfigs 模块配置数组
 * @returns {Array} 二次去重后的模块数组（顺序无关：下游会按 moduleName 分组 + 排序）
 */
export function dedupSemantic(modules, moduleConfigs) {
    if (!Array.isArray(modules) || modules.length < 2) return modules;

    const fullModules = [];
    const otherModules = []; // 增量模块 + 无法匹配配置的模块（原样透传）
    for (const m of modules) {
        const cfg = moduleConfigs?.find(c => c.name === m.moduleName);
        if (cfg && cfg.outputMode !== 'incremental') {
            fullModules.push(m);
        } else {
            otherModules.push(m);
        }
    }

    // 全量模块少于 2 条：第一次 dedup 已处理，无需二次遍历（性能短路）
    if (fullModules.length < 2) {
        return modules;
    }

    const map = new Map();
    const kept = [];
    for (const m of fullModules) {
        if (mergeSemanticModule(map, m, moduleConfigs)) kept.push(m);
    }

    return [...kept, ...otherModules];
}
