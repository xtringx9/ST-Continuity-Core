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
    characters,
    getContext,
    chat_metadata, findChar,
    this_chid,
    METADATA_KEY,
    CONTINUITY_CORE_IDENTIFIER,
} from '../index.js';

// 世界书相关常量定义
export const WORLD_BOOK_CONSTANTS = {
    // 世界书名称常量
    worldBookName: CONTINUITY_CORE_IDENTIFIER,

    // 版本信息常量
    version: '1.0.0',
};

// 世界书条目配置常量
export const WORLD_BOOK_ENTRIES = {
    entries: [
        {
            key: [],
            comment: '必看说明',
            content: '{{//\n可以随意修改插入位置，但不要修改条目名。\n}}',
            constant: true,
            order: 9999,
            position: 4, // 0 = before_char
            disable: false,
            excludeRecursion: true,
            preventRecursion: true,
            probability: 100,
            useProbability: true,
            depth: 0,
        },
        {
            key: [],
            comment: '版本信息',
            content: '{{//\n当前世界书版本：' + WORLD_BOOK_CONSTANTS.version + '\n最后更新时间：' + new Date().toISOString().split('T')[0] + '\n}}',
            constant: true,
            order: 9999,
            position: 4, // 0 = before_char
            disable: false,
            excludeRecursion: true,
            preventRecursion: true,
            probability: 100,
            useProbability: true,
            depth: 0,
        },
        {
            key: [],
            comment: 'PROMPT',
            content: '{{CONTINUITY_PROMPT}}',
            constant: true,
            order: 9999,
            position: 1,
            disable: false,
            excludeRecursion: true,
            preventRecursion: true,
            probability: 100,
            useProbability: true,
            depth: 4,
        },
        {
            key: [],
            comment: 'ORDER',
            content: '{{CONTINUITY_ORDER}}',
            constant: true,
            order: 9999,
            position: 4,
            disable: false,
            excludeRecursion: true,
            preventRecursion: true,
            probability: 100,
            useProbability: true,
            depth: 1,
        },
        {
            key: [],
            comment: 'USAGE_GUIDE',
            content: '{{CONTINUITY_USAGE_GUIDE}}',
            constant: true,
            order: 9998,
            position: 4,
            disable: false,
            excludeRecursion: true,
            preventRecursion: true,
            probability: 100,
            useProbability: true,
            depth: 1,
        }
    ]
}


/**
 * 检查并初始化世界书和条目
 */
export async function checkAndInitializeWorldBook() {
    try {
        // debugLog('[WORLD BOOK]开始检查并初始化世界书', world_info); // 世界书设置
        // debugLog('[WORLD BOOK]开始检查并初始化世界书', world_names); // 所有世界书名
        const testWorldBookData = await loadWorldInfo(world_names[0]);
        debugLog('[WORLD BOOK]世界书', testWorldBookData);

        const worldBookName = WORLD_BOOK_CONSTANTS.worldBookName;
        const worldBookData = await getWorldBook(worldBookName);

        await createEntry(worldBookName, worldBookData);

        await updateWorldInfoList();
    } catch (error) {
        errorLog('检查并初始化世界书失败:', error);
    }
}

/**
 * 将世界书添加到全局设置
 */
function addWorldBookToGlobalSettings(worldBookName) {
    if (!selected_world_info.includes(worldBookName)) {
        debugLog(`[WORLD BOOK]世界书"${worldBookName}"未添加到selected_world_info，添加`);
        selected_world_info.push(worldBookName);
        Object.assign(world_info, { globalSelect: selected_world_info });
        saveSettingsDebounced();
    }
}

/**
 * 创建世界书和条目
 */
async function getWorldBook(worldBookName) {
    try {
        // 检查世界书是否存在
        if (!world_names || !Array.isArray(world_names)) {
            errorLog('[WORLD BOOK]world_names未定义或不是数组，无法检查世界书');
            return null;
        }

        let worldBookExists = world_names.includes(worldBookName);
        let result = worldBookExists;
        if (!worldBookExists) {
            // 创建新的世界书
            debugLog(`[WORLD BOOK]世界书"${worldBookName}"不存在，开始创建`);
            result = await createNewWorldInfo(worldBookName);
            if (result === true) {
                // 只在第一次创建时将世界书添加到全局设置
                addWorldBookToGlobalSettings(worldBookName);
            }
        }

        if (result !== true) {
            errorLog(`[WORLD BOOK]创建世界书"${worldBookName}"失败，结果: ${result}`);
            return null;
        }

        return await loadWorldInfo(worldBookName);
    } catch (error) {
        errorLog(`[WORLD BOOK]创建世界书"${worldBookName}"和条目失败:`, error);
        return null;
    }
}

/**
 * 检查条目是否存在
 */
function entryExists(worldBookData, entryConfig) {
    if (!worldBookData || !worldBookData.entries) {
        return false;
    }

    // 将entries对象转换为数组
    const entriesArray = Object.keys(worldBookData.entries).map(key => worldBookData.entries[key]);

    // 检查是否存在相同名称的条目
    return entriesArray.some(entry => entry.comment && entry.comment === entryConfig.comment);
}

/**
 * 创建世界书条目
 */
async function createEntry(worldBookName, worldBookData) {
    try {
        const createdEntries = [];

        // 遍历所有定义的条目并创建
        for (const entryConfig of WORLD_BOOK_ENTRIES.entries) {
            // 检查条目是否已存在
            if (entryExists(worldBookData, entryConfig)) {
                debugLog(`[WORLD BOOK]条目"${entryConfig.comment}"已存在，跳过创建`);
                continue;
            }

            // debugLog('[WORLD BOOK]创建条目的世界书', worldBookData);
            // 创建条目 - 需要传递世界书数据对象作为第二个参数
            const entry = createWorldInfoEntry(worldBookName, worldBookData);

            if (!entry) {
                errorLog(`[WORLD BOOK]创建条目失败: ${entryConfig.comment}`, entryConfig);
                continue;
            }

            // 更新条目的属性，确保格式符合世界书系统要求
            Object.assign(entry, {
                key: entryConfig.key, // 键值必须是数组
                keysecondary: [], // 次要键值数组
                comment: entryConfig.comment,
                content: entryConfig.content,
                constant: entryConfig.constant !== undefined ? entryConfig.constant : true, // 蓝灯
                selective: false,
                selectiveLogic: 0,
                addMemo: true,
                order: entryConfig.order !== undefined ? entryConfig.order : 100,
                position: entryConfig.position !== undefined ? entryConfig.position : 0, // 0 = before_char
                disable: entryConfig.disable !== undefined ? entryConfig.disable : false,
                excludeRecursion: entryConfig.excludeRecursion !== undefined ? entryConfig.excludeRecursion : false,
                preventRecursion: entryConfig.preventRecursion !== undefined ? entryConfig.preventRecursion : false,
                probability: entryConfig.probability !== undefined ? entryConfig.probability : 100,
                useProbability: entryConfig.useProbability !== undefined ? entryConfig.useProbability : true,
                depth: entryConfig.depth !== undefined ? entryConfig.depth : 4,
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

            createdEntries.push(entry);
            debugLog(`[WORLD BOOK]条目"${entryConfig.comment}"创建成功`);
        }

        // 保存世界书
        await saveWorldInfo(worldBookName, worldBookData, true);

        debugLog(`[WORLD BOOK]所有条目创建成功，共创建了 ${createdEntries.length} 个条目`);
        return createdEntries;
    } catch (error) {
        errorLog('[WORLD BOOK]创建条目失败:', error);
        return null;
    }
}

export function getTestData() {
    debugLog("[WORLD BOOK]获取world_info", world_info);
    debugLog("[WORLD BOOK]获取Context", getContext());
}

export async function getCurrentCharBooks() {
    const context = getContext();
    let books = [];
    if (this_chid) {
        const character = characters[this_chid];
        if (character) {
            if (character.data?.extensions?.world) {
                books.push(character.data?.extensions?.world);//角色世界书
            }

            const charLore = world_info?.charLore?.find(book => book.name === character.name);
            if (charLore) {
                books.push(...charLore.extraBooks);//附加世界书
            }

            const chatBook = chat_metadata?.[METADATA_KEY];
            if (chatBook) {
                books.push(chatBook);//聊天世界书
            }
        }
    }
    debugLog("[WORLD BOOK]获取当前角色世界书", books);

    const booksData = await getAllBooksData(books);
    debugLog("[WORLD BOOK]获取当前角色世界书数据", booksData);

    return booksData;
}

async function getAllBooksData(books) {
    let booksData = [];
    for (const book of books) {
        const data = await loadWorldInfo(book); // await 现在有效
        if (data) {
            booksData.push(data);
        }
    }
    return booksData;
}

export async function getCurrentCharBooksEnabledEntries() {
    const booksData = await getCurrentCharBooks();
    let enabledEntries = [];
    for (const book of booksData) {
        // book.entries 是一个对象 { [uid: number]: entry }，需要转换为数组
        if (book.entries && typeof book.entries === 'object') {
            const entriesArray = Object.values(book.entries);
            enabledEntries.push(...entriesArray.filter(entry => !entry.disable));
        }
    }
    return enabledEntries;
}

export async function getCurrentCharBooksModuleEntries() {
    const booksData = await getCurrentCharBooks();
    let enabledEntries = [];
    for (const book of booksData) {
        // book.entries 是一个对象 { [uid: number]: entry }，需要转换为数组
        if (book.entries && typeof book.entries === 'object') {
            const entriesArray = Object.values(book.entries);
            enabledEntries.push(...entriesArray.filter(entry => entry.comment && entry.comment.includes(CONTINUITY_CORE_IDENTIFIER)));
        }
    }
    return enabledEntries;
}
