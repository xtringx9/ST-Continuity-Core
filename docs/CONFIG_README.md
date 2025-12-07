修改配置的时候，需要注意以下几点：
- configManager 从UI收集数据和保存配置的单例
   - UIDataCollector 从UI收集模块配置数据的工具，改变配置时需要更新Fields
- moduleConfigManager.renderModulesFromConfig 从配置对象渲染模块到UI
- moduleConfigTemplate.normalizeConfig 规范化配置对象，导入导出保存都需要经过
   - 改变配置时记得修改
- configImporterExporter 配置导入导出工具，用于处理配置文件的导入导出


raw数据：
mergeModulesByOrder
groupProcessResultByMessageIndex
extractModulesFromChat
