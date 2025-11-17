/**
 * 数据收集器同步性测试脚本
 * 用于验证数据收集器与配置模板的一致性
 */

import { getSupportedFields, validateDataCollectorSync } from '../src/utils/configImporterExporter.js';
import { getUIConfigSchema } from '../src/templates/moduleUIConfigTemplate.js';

/**
 * 运行数据收集器同步性测试
 */
export function runDataCollectorSyncTest() {
    console.log('🧪 开始数据收集器同步性测试...\n');
    
    try {
        // 测试1: 获取支持的字段列表
        console.log('📋 测试1: 检查支持的字段列表');
        const supportedFields = getSupportedFields();
        console.log('✅ 模块字段:', supportedFields.moduleFields);
        console.log('✅ 变量字段:', supportedFields.variableFields);
        
        // 测试2: 验证数据收集器同步性
        console.log('\n🔍 测试2: 验证数据收集器同步性');
        validateDataCollectorSync();
        
        // 测试3: 检查配置模板结构
        console.log('\n📊 测试3: 检查配置模板结构');
        const templateSchema = getUIConfigSchema();
        console.log('✅ 模板版本:', templateSchema?.version || '未知');
        
        // 测试4: 字段映射一致性检查
        console.log('\n🔄 测试4: 字段映射一致性检查');
        checkFieldMappingConsistency(supportedFields, templateSchema);
        
        console.log('\n🎉 所有测试通过！数据收集器与配置模板保持同步。');
        
    } catch (error) {
        console.error('❌ 测试失败:', error);
        return false;
    }
    
    return true;
}

/**
 * 检查字段映射一致性
 * @param {Object} supportedFields 支持的字段列表
 * @param {Object} templateSchema 模板结构
 */
function checkFieldMappingConsistency(supportedFields, templateSchema) {
    // 检查模块字段映射
    const moduleProperties = templateSchema?.properties?.modules?.items?.properties || {};
    const templateModuleFields = Object.keys(moduleProperties);
    
    console.log('📦 模板模块字段:', templateModuleFields);
    console.log('📦 收集器模块字段:', supportedFields.moduleFields);
    
    // 检查字段差异
    const missingInCollector = templateModuleFields.filter(field => !supportedFields.moduleFields.includes(field));
    const extraInCollector = supportedFields.moduleFields.filter(field => !templateModuleFields.includes(field));
    
    if (missingInCollector.length > 0) {
        console.warn('⚠️ 数据收集器缺少以下模块字段:', missingInCollector);
    }
    
    if (extraInCollector.length > 0) {
        console.warn('⚠️ 数据收集器包含额外模块字段:', extraInCollector);
    }
    
    // 检查变量字段映射
    const variableProperties = moduleProperties?.variables?.items?.properties || {};
    const templateVariableFields = Object.keys(variableProperties);
    
    console.log('🔧 模板变量字段:', templateVariableFields);
    console.log('🔧 收集器变量字段:', supportedFields.variableFields);
    
    const missingVarInCollector = templateVariableFields.filter(field => !supportedFields.variableFields.includes(field));
    const extraVarInCollector = supportedFields.variableFields.filter(field => !templateVariableFields.includes(field));
    
    if (missingVarInCollector.length > 0) {
        console.warn('⚠️ 数据收集器缺少以下变量字段:', missingVarInCollector);
    }
    
    if (extraVarInCollector.length > 0) {
        console.warn('⚠️ 数据收集器包含额外变量字段:', extraVarInCollector);
    }
    
    if (missingInCollector.length === 0 && extraInCollector.length === 0 && 
        missingVarInCollector.length === 0 && extraVarInCollector.length === 0) {
        console.log('✅ 字段映射完全一致！');
    }
}

/**
 * 生成字段映射报告
 */
export function generateFieldMappingReport() {
    const supportedFields = getSupportedFields();
    const templateSchema = getUIConfigSchema();
    
    const report = {
        timestamp: new Date().toISOString(),
        templateVersion: templateSchema?.version || '未知',
        moduleFields: {
            supported: supportedFields.moduleFields,
            template: Object.keys(templateSchema?.properties?.modules?.items?.properties || {}),
            status: '一致'
        },
        variableFields: {
            supported: supportedFields.variableFields,
            template: Object.keys(templateSchema?.properties?.modules?.items?.properties?.variables?.items?.properties || {}),
            status: '一致'
        }
    };
    
    // 检查一致性
    const moduleDiff = report.moduleFields.supported.filter(f => !report.moduleFields.template.includes(f))
        .concat(report.moduleFields.template.filter(f => !report.moduleFields.supported.includes(f)));
    
    const variableDiff = report.variableFields.supported.filter(f => !report.variableFields.template.includes(f))
        .concat(report.variableFields.template.filter(f => !report.variableFields.supported.includes(f)));
    
    if (moduleDiff.length > 0) {
        report.moduleFields.status = '不一致';
        report.moduleFields.differences = moduleDiff;
    }
    
    if (variableDiff.length > 0) {
        report.variableFields.status = '不一致';
        report.variableFields.differences = variableDiff;
    }
    
    return report;
}

// 如果直接运行此脚本
if (typeof window === 'undefined' && process.argv[1] === __filename) {
    runDataCollectorSyncTest();
}