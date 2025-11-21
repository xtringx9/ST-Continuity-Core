// 世界书工具模块 - 处理世界书集成功能
import { debugLog, errorLog, infoLog } from "./logger.js";

// 导入世界书系统模块（使用静态导入方式）
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    world_info,
    world_names,
    selected_world_info,
    createNewWorldInfo,
    createWorldInfoEntry,
    saveWorldInfo,
    loadWorldInfo,
    updateWorldInfoList,
    newWorldInfoEntryTemplate,
    getWorldInfoSettings,
    worldInfoCache,
    onWorldInfoChange,
    reloadEditor,
} from '../index.js';

/**
 * 世界书工具类
 */
// export class WorldBookUtils {
//     constructor() {
//         this.isInitialized = false;
//     }

/**
 * 初始化世界书集成
 * 检查world_names中是否有测试世界书名，无则创建世界书，有则通过loadWorldInfo获取世界书条目，
 * 检查是否有测试条目，无则创建，并最终调用saveWorldInfo保存
 */
// initializeWorldBookIntegration(eventSource, event_types) {
// try {
//     // 检查世界书系统函数是否可用（简化检查）
//     if (!loadWorldInfo || !saveWorldInfo || !createNewWorldInfo) {
//         errorLog('世界书系统函数未完全加载，延迟初始化');
//         // 延迟重试
//         setTimeout(() => {
//             this.initializeWorldBookIntegration(eventSource, event_types);
//         }, 2000);
//         return;
//     }

//     // 监听世界书设置加载事件
//     if (eventSource && eventSource.on) {
//         eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, () => {
//             debugLog('世界书扩展设置已加载，初始化世界书集成');
//             setTimeout(() => {
//                 this.checkAndInitializeWorldBook();
//             }, 500);
//         });
//     }

//     // 立即尝试初始化（如果系统已经就绪）
//     setTimeout(() => {
//         this.checkAndInitializeWorldBook();
//     }, 3000);

//     this.isInitialized = true;
//     infoLog('世界书集成初始化完成');
// } catch (error) {
//     errorLog('初始化世界书集成失败:', error);
// }
// }

/**
 * 检查并初始化世界书和测试条目
 */
export async function checkAndInitializeWorldBook() {
    try {
        // debugLog('[WORLD BOOK]开始检查并初始化世界书', world_info); 世界书设置
        // debugLog('[WORLD BOOK]开始检查并初始化世界书', world_names); 所有世界书名
        const testWorldBookName = '_CC_1.0';

        // 检查世界书是否存在
        if (!world_names || !Array.isArray(world_names)) {
            errorLog('world_names未定义或不是数组，无法检查世界书');
            return;
        }

        const worldBookExists = world_names.includes(testWorldBookName);

        if (!worldBookExists) {
            // 创建新的世界书
            debugLog(`[WORLD BOOK]测试世界书"${testWorldBookName}"不存在，开始创建`);
            await createWorldBookAndTestEntry(testWorldBookName);
        } else {
            // 世界书存在，检查测试条目
            debugLog(`[WORLD BOOK]测试世界书"${testWorldBookName}"已存在，检查测试条目`);
            await checkAndCreateTestEntry(testWorldBookName);
        }

        if (!selected_world_info.includes(testWorldBookName)) {
            debugLog(`[WORLD BOOK]测试世界书"${testWorldBookName}"未添加到selected_world_info，添加`);
            selected_world_info.push(testWorldBookName);
            Object.assign(world_info, { globalSelect: selected_world_info });
            saveSettingsDebounced();
        }
        await updateWorldInfoList();
    } catch (error) {
        errorLog('检查并初始化世界书失败:', error);
    }
}

/**
 * 创建世界书和测试条目
 */
async function createWorldBookAndTestEntry(worldBookName) {
    try {
        // 创建新的世界书
        const newWorldBook = createNewWorldInfo(worldBookName);
        if (!newWorldBook) {
            errorLog(`[WORLD BOOK]创建世界书"${worldBookName}"失败`);
            return;
        }
        const worldBookData = await loadWorldInfo(worldBookName);
        if (!worldBookData || !worldBookData.entries) {
            errorLog(`[WORLD BOOK]加载世界书"${worldBookName}"数据失败，无法创建条目`);
            return;
        }

        debugLog(`[WORLD BOOK]世界书"${worldBookName}"创建成功，开始创建测试条目`);

        // 创建测试条目
        await createTestEntry(worldBookName, worldBookData);

        // 保存世界书
        await saveWorldInfo(worldBookName, worldBookData, true);
        reloadEditor(worldBookName, true);

        infoLog(`[WORLD BOOK]世界书"${worldBookName}"和测试条目创建并保存成功`);
    } catch (error) {
        errorLog(`[WORLD BOOK]创建世界书"${worldBookName}"和测试条目失败:`, error);
    }
}

/**
 * 检查并创建测试条目
 */
async function checkAndCreateTestEntry(worldBookName) {
    try {
        // 加载世界书条目
        const worldBookData = await loadWorldInfo(worldBookName);
        if (!worldBookData || !worldBookData.entries) {
            errorLog(`[WORLD BOOK]加载世界书"${worldBookName}"条目失败`);
            return;
        }

        // 将entries对象转换为数组
        const entriesArray = Object.keys(worldBookData.entries).map(key => worldBookData.entries[key]);

        // 检查是否存在测试条目
        const testEntryExists = entriesArray.some(entry =>
            entry.key && (Array.isArray(entry.key) ? entry.key.some(k => k.includes('test')) : entry.key.includes('test')) ||
            entry.name && entry.name.includes('测试')
        );

        if (!testEntryExists) {
            debugLog(`[WORLD BOOK]测试世界书"${worldBookName}"中未找到测试条目，开始创建`, worldBookData);
            await createTestEntry(worldBookName, worldBookData);

            // 保存世界书
            await saveWorldInfo(worldBookName, worldBookData, true);
            reloadEditor(worldBookName, true);
            infoLog(`[WORLD BOOK]测试条目创建并保存成功`, worldBookData);
        } else {
            debugLog(`[WORLD BOOK]测试世界书"${worldBookName}"中已存在测试条目`);
        }
    } catch (error) {
        errorLog(`[WORLD BOOK]检查并创建测试条目失败:`, error);
    }
}

/**
 * 创建测试条目
 */
async function createTestEntry(worldBookName, worldBookData) {
    try {
        // 创建测试条目 - 需要传递世界书数据对象作为第二个参数
        const testEntry = createWorldInfoEntry(worldBookName, worldBookData);
        debugLog('创建测试条目', testEntry);
        debugLog('创建测试条目', worldBookData);
        if (!testEntry) {
            errorLog('创建测试条目失败，无法分配UID');
            return;
        }

        // 更新测试条目的属性，确保格式符合世界书系统要求
        Object.assign(testEntry, {
            key: ['test_entry'], // 键值必须是数组
            keysecondary: [], // 次要键值数组
            name: '测试条目',
            comment: '这是ST-Continuity-Core扩展的测试条目',
            content: '这是一个用于测试ST-Continuity-Core扩展世界书集成功能的测试条目。',
            constant: true, // 蓝灯
            selective: false,
            selectiveLogic: 0,
            addMemo: true,
            order: 100,
            position: 0, // 0 = before_char
            disable: false,
            excludeRecursion: false,
            preventRecursion: false,
            probability: 100,
            useProbability: true,
            depth: 4,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            use_regex: false,
            characterFilter: {
                isExclude: false,
                names: [],
                tags: []
            }
        });

        // debugLog('更新测试条目前', worldInfoCache);
        await saveWorldInfo(worldBookName, worldBookData, true);
        reloadEditor(worldBookName, true);
        // debugLog('更新测试条目后', worldInfoCache);

        debugLog(`[WORLD BOOK]测试条目创建成功`);
        return testEntry;
    } catch (error) {
        errorLog('创建测试条目失败:', error);
        return null;
    }
}

// /**
//  * 销毁世界书工具
//  */
// function destroy() {
//     this.isInitialized = false;
//     infoLog('世界书工具已销毁');
// }
// }

