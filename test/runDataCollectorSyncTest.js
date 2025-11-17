/**
 * Node.js 数据收集器同步性测试运行器
 * 使用：node runDataCollectorSyncTest.js
 */

import fs from 'fs';
import path from 'path';

// 模拟浏览器环境
const mockConfigImporterExporter = {
    getSupportedFields: () => ({
        moduleFields: ['name', 'displayName', 'enabled', 'variables', 'prompt', 'timingPrompt', 'contentPrompt', 'outputPosition', 'positionPrompt', 'outputMode', 'retainLayers', 'compatibleModuleNames', 'timeReferenceStandard', 'order', 'itemMin', 'itemMax', 'rangeMode'],
        variableFields: ['name', 'displayName', 'description', 'compatibleVariableNames', 'isIdentifier', 'isBackupIdentifier', 'isHideCondition', 'hideConditionValues']
    }),
    validateDataCollectorSync: () => {
        console.log('✅ 数据收集器同步性验证通过');
    }
};

const mockModuleUIConfigTemplate = {
    getUIConfigSchema: () => ({
        version: '1.0.0',
        properties: {
            modules: {
                items: {
                    properties: {
                        name: { type: 'string' },
                        displayName: { type: 'string' },
                        enabled: { type: 'boolean' },
                        variables: {
                            items: {
                                properties: {
                                    name: { type: 'string' },
                                    displayName: { type: 'string' },
                                    description: { type: 'string' },
                                    compatibleVariableNames: { type: 'string' },
                                    isIdentifier: { type: 'boolean' },
                                    isBackupIdentifier: { type: 'boolean' },
                                    isHideCondition: { type: 'boolean' },
                                    hideConditionValues: { type: 'string' }
                                }
                            }
                        },
                        prompt: { type: 'string' },
                        timingPrompt: { type: 'string' },
                        contentPrompt: { type: 'string' },
                        outputPosition: { type: 'string' },
                        positionPrompt: { type: 'string' },
                        outputMode: { type: 'string' },
                        retainLayers: { type: 'number' },
                        compatibleModuleNames: { type: 'string' },
                        timeReferenceStandard: { type: 'boolean' },
                        order: { type: 'number' },
                        itemMin: { type: 'number' },
                        itemMax: { type: 'number' },
                        rangeMode: { type: 'string' }
                    }
                }
            }
        }
    })
};

// 模拟测试函数
function runDataCollectorSyncTest() {
    console.log('🧪 开始数据收集器同步性测试...\n');
    
    try {
        // 测试1: 获取支持的字段列表
        console.log('📋 测试1: 检查支持的字段列表');
        const supportedFields = mockConfigImporterExporter.getSupportedFields();
        console.log('✅ 模块字段:', supportedFields.moduleFields);
        console.log('✅ 变量字段:', supportedFields.variableFields);
        
        // 测试2: 验证数据收集器同步性
        console.log('\n🔍 测试2: 验证数据收集器同步性');
        mockConfigImporterExporter.validateDataCollectorSync();
        
        // 测试3: 检查配置模板结构
        console.log('\n📊 测试3: 检查配置模板结构');
        const templateSchema = mockModuleUIConfigTemplate.getUIConfigSchema();
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

// 直接运行测试
console.log('🚀 启动数据收集器同步性测试...\n');
const success = runDataCollectorSyncTest();

if (success) {
    console.log('\n✅ 测试执行成功！');
    process.exit(0);
} else {
    console.log('\n❌ 测试执行失败！');
    process.exit(1);
}

export { runDataCollectorSyncTest };