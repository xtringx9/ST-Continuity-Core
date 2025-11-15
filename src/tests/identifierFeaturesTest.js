/**
 * 标识符功能测试
 * 测试新添加的主标识符和备用标识符功能
 */

// 导入所需的模块
import { addModule, getModulesData } from '../modules/moduleManager.js';
import { renderModulesFromConfig } from '../modules/moduleConfigManager.js';
import { addVariable } from '../modules/variableManager.js';

// 测试用例：验证标识符功能是否正常工作
function testIdentifierFeatures() {
    console.log('=== 开始测试标识符功能 ===');

    // 1. 测试添加新模块
    console.log('\n1. 测试添加新模块');
    const moduleItem = addModule();
    console.log('模块添加成功:', moduleItem.length > 0);

    // 2. 测试添加新变量
    console.log('\n2. 测试添加新变量');
    addVariable(moduleItem);
    const variableItem = moduleItem.find('.variable-item').first();
    console.log('变量添加成功:', variableItem.length > 0);

    // 3. 测试标识符按钮是否存在
    console.log('\n3. 测试标识符按钮是否存在');
    const identifierButton = variableItem.find('.variable-is-identifier');
    const backupIdentifierButton = variableItem.find('.variable-is-backup-identifier');
    console.log('主标识符按钮存在:', identifierButton.length > 0);
    console.log('备用标识符按钮存在:', backupIdentifierButton.length > 0);

    // 4. 测试标识符按钮点击事件
    console.log('\n4. 测试标识符按钮点击事件');
    const identifierInput = variableItem.find('.variable-is-identifier-input');
    const backupIdentifierInput = variableItem.find('.variable-is-backup-identifier-input');
    
    // 初始状态应该是false
    console.log('主标识符初始状态:', identifierInput.val() === 'false');
    console.log('备用标识符初始状态:', backupIdentifierInput.val() === 'false');
    
    // 模拟点击主标识符按钮
    identifierButton.click();
    console.log('主标识符点击后状态:', identifierInput.val() === 'true');
    
    // 模拟点击备用标识符按钮
    backupIdentifierButton.click();
    console.log('备用标识符点击后状态:', backupIdentifierInput.val() === 'true');

    // 5. 测试配置保存
    console.log('\n5. 测试配置保存');
    const modulesData = getModulesData();
    console.log('配置保存成功:', modulesData.length > 0);
    
    // 检查保存的配置中是否包含标识符信息
    const savedModule = modulesData[0];
    const savedVariable = savedModule.variables[0];
    console.log('配置中包含主标识符:', savedVariable.isIdentifier === true);
    console.log('配置中包含备用标识符:', savedVariable.isBackupIdentifier === true);

    // 6. 测试配置加载
    console.log('\n6. 测试配置加载');
    
    // 创建一个测试配置
    const testConfig = {
        modules: [{
            name: 'test_module',
            displayName: '测试模块',
            enabled: true,
            variables: [{
                name: 'test_var',
                displayName: '测试变量',
                isIdentifier: true,
                isBackupIdentifier: false,
                compatibleVariableNames: ''
            }, {
                name: 'backup_var',
                displayName: '备用变量',
                isIdentifier: false,
                isBackupIdentifier: true,
                compatibleVariableNames: ''
            }]
        }]
    };
    
    // 清空现有模块
    $('.custom-modules-container > div').each(function () {
        if (!$(this).hasClass('module-template') && !$(this).hasClass('section-title')) {
            $(this).remove();
        }
    });
    
    // 渲染测试配置
    renderModulesFromConfig(testConfig);
    
    // 检查渲染后的模块是否包含正确的标识符信息
    const renderedModule = $('.custom-modules-container > div').not('.module-template, .section-title').first();
    const renderedVariables = renderedModule.find('.variable-item');
    
    const firstVariableIdentifier = renderedVariables.eq(0).find('.variable-is-identifier-input').val();
    const firstVariableBackupIdentifier = renderedVariables.eq(0).find('.variable-is-backup-identifier-input').val();
    const secondVariableIdentifier = renderedVariables.eq(1).find('.variable-is-identifier-input').val();
    const secondVariableBackupIdentifier = renderedVariables.eq(1).find('.variable-is-backup-identifier-input').val();
    
    console.log('第一变量主标识符渲染正确:', firstVariableIdentifier === 'true');
    console.log('第一变量备用标识符渲染正确:', firstVariableBackupIdentifier === 'false');
    console.log('第二变量主标识符渲染正确:', secondVariableIdentifier === 'false');
    console.log('第二变量备用标识符渲染正确:', secondVariableBackupIdentifier === 'true');

    console.log('\n=== 标识符功能测试完成 ===');
}

// 运行测试
if (typeof window !== 'undefined') {
    // 在浏览器环境中运行
    window.addEventListener('load', testIdentifierFeatures);
} else {
    // 在Node.js环境中运行
    console.log('此测试需要在浏览器环境中运行');
}
