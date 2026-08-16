// taskRegistry.js
// 全局 AI 生成任务状态注册表（阶段 1）。
//
// 解决：
//   - 菜单重建后按钮状态丢失（从注册表恢复 LOADING/SUCCESS/ERROR/pending）
//   - 重复点击生成两次 / 叠多个调试面板（running 时防重）
//   - 小 Cc 按钮显示该楼层 running 任务数
//   - 大 Cc（EntryButton）显示全局 running 任务数
//   - 生成中点击按钮可打开「生成中」调试面板
//
// 生命周期：running 任务跨聊天保留（不随 CHAT_CHANGED 清空），
// 但按 chatKey 归属；小 Cc 恢复按钮态时校验 chatKey 匹配当前聊天，避免串。
// SUCCESS/ERROR 状态在 RESET_DELAY 后由 UI 清除。

const TASK_UPDATE_EVENT = 'ccore-task-updated';

/** @type {Map<string, {status:'running'|'success'|'error', chatKey:string, mesId:number, generatorName:string, startedAt:number, debugData?:object, abort?:Function}>} */
const tasks = new Map();

/** 当前活跃聊天 key（由外部在 CHAT_CHANGED / 生成时设置，格式与 moduleAiGenerator._getChatKey 一致） */
let currentChatKey = '';

function _key(chatKey, mesId, generatorName) {
    return `${chatKey}::${mesId}::${generatorName}`;
}

/** 通知 UI 刷新（计数/按钮态） */
function _emit() {
    window.dispatchEvent(new CustomEvent(TASK_UPDATE_EVENT));
}

export const taskRegistry = {
    TASK_UPDATE_EVENT,

    /**
     * 标记任务开始（running）。
     * @param {object} opts
     * @param {string} opts.chatKey 生成所属聊天标识（保存校验用）
     * @param {number} opts.mesId
     * @param {string} opts.generatorName
     */
    start({ chatKey, mesId, generatorName }) {
        const key = _key(chatKey, mesId, generatorName);
        tasks.set(key, { status: 'running', chatKey, mesId, generatorName, startedAt: Date.now() });
        _emit();
        return key;
    },

    /**
     * 更新任务状态（成功/失败），可附 debugData（供「生成中打开面板」用）。
     */
    finish(key, status, debugData = null) {
        const task = tasks.get(key);
        if (!task) return;
        task.status = status;
        if (debugData) task.debugData = debugData;
        _emit();
    },

    /**
     * 记录任务的 debugData（生成中实时更新用）。
     */
    setDebugData(key, debugData) {
        const task = tasks.get(key);
        if (!task) return;
        task.debugData = debugData;
        _emit();
    },

    /**
     * 注入任务的中止函数（生成请求发出后由 aiCaller 提供）。
     */
    setAbort(key, abortFn) {
        const task = tasks.get(key);
        if (!task) return;
        task.abort = abortFn;
    },

    /**
     * 中止指定任务（调 abortController.abort）。
     * @returns {boolean} 是否找到并触发了中止
     */
    abortTask(key) {
        const task = tasks.get(key);
        if (!task || typeof task.abort !== 'function') return false;
        try { task.abort(); } catch (e) { /* 忽略中止异常 */ }
        task.status = 'error';
        _emit();
        return true;
    },

    /**
     * 取指定聊天+楼层+generator 的任务（含 running 及短暂保留的 success/error）。
     * @returns {object|null}
     */
    get(chatKey, mesId, generatorName) {
        return tasks.get(_key(chatKey, mesId, generatorName)) || null;
    },

    /**
     * 设置当前活跃聊天 key（格式与 moduleAiGenerator._getChatKey 一致）。
     * 由外部在 CHAT_CHANGED / 生成时调用；小 Cc 楼层计数/按钮态恢复据此过滤，避免跨聊天串。
     * @param {string} chatKey
     */
    setCurrentChatKey(chatKey) {
        currentChatKey = chatKey;
    },

    /**
     * 该楼层 running 任务数（当前聊天归属）。
     */
    getRunningCountForMes(mesId) {
        let count = 0;
        for (const t of tasks.values()) {
            if (t.status === 'running' && t.mesId === mesId && t.chatKey === currentChatKey) count++;
        }
        return count;
    },

    /**
     * 全局 running 任务数（大 Cc 用）。
     */
    getTotalRunningCount() {
        let count = 0;
        for (const t of tasks.values()) {
            if (t.status === 'running') count++;
        }
        return count;
    },

    /**
     * 遍历所有任务（UI 恢复按钮态用）。
     * @param {(task:object)=>void} cb
     */
    forEach(cb) {
        for (const t of tasks.values()) cb(t);
    },

    /**
     * 移除任务（抛弃/保存后）。
     */
    remove(key) {
        tasks.delete(key);
        _emit();
    },

    /**
     * 清理指定聊天的所有任务（切聊天时可选调用；默认保留 running）。
     */
    clearChat(chatKey) {
        for (const [k, t] of tasks) {
            if (t.chatKey === chatKey) tasks.delete(k);
        }
        _emit();
    },
};
