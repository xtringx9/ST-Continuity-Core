// 模块数据处理器 - 入口文件
// 核心管线逻辑已拆分到 pipeline/ 子模块；编排入口见 pipeline/runModulePipeline.js
//
// 原 processModuleData 薄封装已删除：所有调用方已迁移到 runModulePipeline（见 docs/PIPELINE_REFACTOR_HANDOFF.md 调用方迁移表）。
// 本文件仅保留 groupProcessResultByMessageIndex 的 re-export，保持外部 import 路径不变。

import { groupProcessResultByMessageIndex } from './pipeline/groupByMessage.js';

/** @deprecated 直接 import from './pipeline/groupByMessage.js' */
export { groupProcessResultByMessageIndex };
