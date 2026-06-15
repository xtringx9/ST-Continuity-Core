import fs from 'fs/promises';
import path from 'path';

// 1. 插件注册信息
export const info = {
    id: 'continuity-core',
    name: 'Continuity Core',
    description: '核心服务器支持插件，提供独立文件存储功能'
};

/**
 * 🛡️ 核心路径计算与安全检查函数
 * @param {string} userHandle - 用户目录名 (例如 "default-user" 或 "my-profile")
 * @param {string} relativePath - 相对路径 (例如 "chat1/data.json")
 * @returns {string} - 安全的绝对路径
 */
function getSafePath(userHandle, relativePath) {
    // 1. 处理默认用户：如果前端没传或传空，默认为 'default-user'
    const safeUserHandle = userHandle || 'default-user';

    // 2. 安全检查：禁止 userHandle 包含路径分隔符 (防止 ../ 攻击)
    if (safeUserHandle.includes('..') || safeUserHandle.includes('/') || safeUserHandle.includes('\\')) {
        throw new Error("非法用户路径：UserHandle 不能包含路径跳转符号");
    }

    // 3. 动态构建该用户的插件数据根目录
    // 路径: SillyTavern/data/{userHandle}/continuity-core/
    const userBaseDir = path.join(process.cwd(), 'data', safeUserHandle, 'continuity-core');

    // 4. 如果只想要根目录 (用于 mkdir 或 list)
    if (!relativePath) return userBaseDir;

    // 5. 构建完整目标路径
    const targetPath = path.resolve(userBaseDir, relativePath);

    // 6. 最终沙盒检查：确保目标路径确实在用户的 base 目录下
    if (!targetPath.startsWith(userBaseDir)) {
        throw new Error("非法路径访问：禁止越权访问其他目录！");
    }

    return targetPath;
}

// 2. 初始化
export function init(router) {
    console.log("🚀 [Continuity-Core] 服务器插件已加载 (多用户支持版)！");

    // ==========================================
    // 📥 接口 1: 保存文件 (Save)
    // 前端传参：{ userHandle: "default-user", filePath: "chat/1.json", content: ... }
    // ==========================================
    router.post('/save', async (req, res) => {
        try {
            const { userHandle, filePath, content } = req.body;
            if (!filePath || content === undefined) return res.status(400).json({ error: "缺少参数" });

            // 获取绝对路径 (自动处理用户目录)
            const absolutePath = getSafePath(userHandle, filePath);
            const dirName = path.dirname(absolutePath);

            // 确保文件夹存在
            await fs.mkdir(dirName, { recursive: true });

            const dataToWrite = typeof content === 'object' ? JSON.stringify(content, null, 2) : content;
            await fs.writeFile(absolutePath, dataToWrite, 'utf-8');

            // console.log(`[Save] User: ${userHandle || 'default'} | File: ${filePath}`);
            res.json({ success: true });
        } catch (err) {
            console.error("[Save Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📖 接口 2: 读取文件 (Read)
    // 前端传参：{ userHandle: "default-user", filePath: "chat/1.json" }
    // ==========================================
    router.post('/read', async (req, res) => {
        try {
            const { userHandle, filePath } = req.body;
            if (!filePath) return res.status(400).json({ error: "缺少路径参数" });

            const absolutePath = getSafePath(userHandle, filePath);

            try {
                await fs.access(absolutePath);
            } catch {
                return res.json({ success: false, message: "文件不存在", data: null });
            }

            const rawData = await fs.readFile(absolutePath, 'utf-8');
            let parsedData;
            try { parsedData = JSON.parse(rawData); } catch { parsedData = rawData; }

            res.json({ success: true, data: parsedData });
        } catch (err) {
            console.error("[Read Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📋 接口 3: 列出目录 (List)
    // ==========================================
    router.post('/list', async (req, res) => {
        try {
            const { userHandle, dirPath } = req.body;
            // 获取该用户下的目录路径
            const absolutePath = getSafePath(userHandle, dirPath || "");

            // 如果目录不存在，先创建它，避免报错
            try {
                await fs.access(absolutePath);
            } catch {
                await fs.mkdir(absolutePath, { recursive: true });
                return res.json({ success: true, files: [] });
            }

            const files = await fs.readdir(absolutePath);
            res.json({ success: true, files: files });
        } catch (err) {
            res.json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 🗑️ 接口 4: 删除文件 (Delete)
    // ==========================================
    router.post('/delete', async (req, res) => {
        try {
            const { userHandle, filePath } = req.body;
            if (!filePath) return res.status(400).json({ error: "缺少路径参数" });

            const absolutePath = getSafePath(userHandle, filePath);
            await fs.unlink(absolutePath);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📦 接口 5: 确保目录存在 (EnsureDir)
    // ==========================================
    router.post('/ensureDir', async (req, res) => {
        try {
            const { userHandle, dirPath } = req.body;
            if (!dirPath) return res.status(400).json({ error: "缺少路径参数" });

            const absolutePath = getSafePath(userHandle, dirPath);
            await fs.mkdir(absolutePath, { recursive: true });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📝 接口 6: 追加消息行 (AppendMessage)
    // 向 JSONL batch 文件追加一行
    // ==========================================
    router.post('/appendMessage', async (req, res) => {
        try {
            const { userHandle, filePath, data } = req.body;
            if (!filePath || !data) return res.status(400).json({ error: "缺少参数" });

            const absolutePath = getSafePath(userHandle, filePath);
            const dirName = path.dirname(absolutePath);
            await fs.mkdir(dirName, { recursive: true });

            const line = JSON.stringify(data) + '\n';
            await fs.appendFile(absolutePath, line, 'utf-8');
            res.json({ success: true });
        } catch (err) {
            console.error("[AppendMessage Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📖 接口 7: 读取指定楼层 (ReadMessage)
    // 从 JSONL batch 文件中读取指定 mesId 的行
    // ==========================================
    router.post('/readMessage', async (req, res) => {
        try {
            const { userHandle, filePath, mesId } = req.body;
            if (!filePath || mesId === undefined) return res.status(400).json({ error: "缺少参数" });

            const absolutePath = getSafePath(userHandle, filePath);

            try {
                await fs.access(absolutePath);
            } catch {
                return res.json({ success: true, data: null });
            }

            const content = await fs.readFile(absolutePath, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim());

            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.mesId === mesId) {
                        return res.json({ success: true, data: parsed });
                    }
                } catch { /* 跳过解析失败的行 */ }
            }

            res.json({ success: true, data: null });
        } catch (err) {
            console.error("[ReadMessage Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // ✏️ 接口 8: 更新指定楼层 (WriteMessage)
    // 替换 JSONL batch 文件中指定 mesId 的行
    // ==========================================
    router.post('/writeMessage', async (req, res) => {
        try {
            const { userHandle, filePath, mesId, data } = req.body;
            if (!filePath || mesId === undefined || !data) return res.status(400).json({ error: "缺少参数" });

            const absolutePath = getSafePath(userHandle, filePath);
            const dirName = path.dirname(absolutePath);
            await fs.mkdir(dirName, { recursive: true });

            let lines = [];
            try {
                const content = await fs.readFile(absolutePath, 'utf-8');
                lines = content.split('\n').filter(l => l.trim());
            } catch { /* 文件不存在，创建新文件 */ }

            let found = false;
            const newLine = JSON.stringify({ mesId, ...data });

            for (let i = 0; i < lines.length; i++) {
                try {
                    const parsed = JSON.parse(lines[i]);
                    if (parsed.mesId === mesId) {
                        lines[i] = newLine;
                        found = true;
                        break;
                    }
                } catch { /* 跳过 */ }
            }

            if (!found) {
                lines.push(newLine);
            }

            await fs.writeFile(absolutePath, lines.join('\n') + '\n', 'utf-8');
            res.json({ success: true });
        } catch (err) {
            console.error("[WriteMessage Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📖 接口 9: 批量读取楼层 (ReadMessages)
    // 从 JSONL batch 文件中读取指定范围的楼层
    // ==========================================
    router.post('/readMessages', async (req, res) => {
        try {
            const { userHandle, filePaths, fromMesId, toMesId } = req.body;
            if (!filePaths || !Array.isArray(filePaths)) return res.status(400).json({ error: "缺少参数" });

            const results = [];

            for (const filePath of filePaths) {
                const absolutePath = getSafePath(userHandle, filePath);

                try {
                    await fs.access(absolutePath);
                } catch {
                    continue;
                }

                const content = await fs.readFile(absolutePath, 'utf-8');
                const lines = content.split('\n').filter(l => l.trim());

                for (const line of lines) {
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.mesId !== undefined) {
                            if (fromMesId !== undefined && parsed.mesId < fromMesId) continue;
                            if (toMesId !== undefined && parsed.mesId > toMesId) continue;
                            results.push(parsed);
                        }
                    } catch { /* 跳过 */ }
                }
            }

            // 按 mesId 排序
            results.sort((a, b) => a.mesId - b.mesId);
            res.json({ success: true, data: results });
        } catch (err) {
            console.error("[ReadMessages Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📸 接口 10: 读取快照 (ReadSnapshot)
    // 从 JSON 快照 batch 文件中读取 ≤ mesId 的最近快照
    // ==========================================
    router.post('/readSnapshot', async (req, res) => {
        try {
            const { userHandle, filePath, mesId } = req.body;
            if (!filePath || mesId === undefined) return res.status(400).json({ error: "缺少参数" });

            const absolutePath = getSafePath(userHandle, filePath);

            try {
                await fs.access(absolutePath);
            } catch {
                return res.json({ success: true, data: null });
            }

            const rawData = await fs.readFile(absolutePath, 'utf-8');
            const snapshots = JSON.parse(rawData);

            // 找 ≤ mesId 的最大 key
            const keys = Object.keys(snapshots).map(Number).sort((a, b) => a - b);
            let bestKey = null;
            for (const key of keys) {
                if (key <= mesId) bestKey = key;
                else break;
            }

            if (bestKey !== null) {
                res.json({ success: true, data: { mesId: bestKey, ...snapshots[bestKey] } });
            } else {
                res.json({ success: true, data: null });
            }
        } catch (err) {
            console.error("[ReadSnapshot Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📸 接口 11: 写入快照 (WriteSnapshot)
    // 向 JSON 快照 batch 文件写入指定 mesId 的快照
    // ==========================================
    router.post('/writeSnapshot', async (req, res) => {
        try {
            const { userHandle, filePath, mesId, data } = req.body;
            if (!filePath || mesId === undefined || !data) return res.status(400).json({ error: "缺少参数" });

            const absolutePath = getSafePath(userHandle, filePath);
            const dirName = path.dirname(absolutePath);
            await fs.mkdir(dirName, { recursive: true });

            let snapshots = {};
            try {
                const rawData = await fs.readFile(absolutePath, 'utf-8');
                snapshots = JSON.parse(rawData);
            } catch { /* 文件不存在，创建新的 */ }

            snapshots[String(mesId)] = data;

            await fs.writeFile(absolutePath, JSON.stringify(snapshots, null, 2), 'utf-8');
            res.json({ success: true });
        } catch (err) {
            console.error("[WriteSnapshot Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📋 接口 12: 读取 meta.json (ReadMeta)
    // ==========================================
    router.post('/readMeta', async (req, res) => {
        try {
            const { userHandle, filePath } = req.body;
            if (!filePath) return res.status(400).json({ error: "缺少路径参数" });

            const absolutePath = getSafePath(userHandle, filePath);

            try {
                await fs.access(absolutePath);
            } catch {
                return res.json({ success: true, data: null });
            }

            const rawData = await fs.readFile(absolutePath, 'utf-8');
            res.json({ success: true, data: JSON.parse(rawData) });
        } catch (err) {
            console.error("[ReadMeta Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📋 接口 13: 写入 meta.json (WriteMeta)
    // ==========================================
    router.post('/writeMeta', async (req, res) => {
        try {
            const { userHandle, filePath, data } = req.body;
            if (!filePath || !data) return res.status(400).json({ error: "缺少参数" });

            const absolutePath = getSafePath(userHandle, filePath);
            const dirName = path.dirname(absolutePath);
            await fs.mkdir(dirName, { recursive: true });

            await fs.writeFile(absolutePath, JSON.stringify(data, null, 2), 'utf-8');
            res.json({ success: true });
        } catch (err) {
            console.error("[WriteMeta Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📦 接口 14: 迁移聊天目录 (MoveChat)
    // ==========================================
    router.post('/moveChat', async (req, res) => {
        try {
            const { userHandle, oldDirPath, newDirPath } = req.body;
            if (!oldDirPath || !newDirPath) return res.status(400).json({ error: "缺少路径参数" });

            const oldAbsolutePath = getSafePath(userHandle, oldDirPath);
            const newAbsolutePath = getSafePath(userHandle, newDirPath);

            // 确保旧目录存在
            try {
                await fs.access(oldAbsolutePath);
            } catch {
                return res.json({ success: false, message: "源目录不存在" });
            }

            // 确保新目录的父目录存在
            const newParentDir = path.dirname(newAbsolutePath);
            await fs.mkdir(newParentDir, { recursive: true });

            await fs.rename(oldAbsolutePath, newAbsolutePath);
            res.json({ success: true });
        } catch (err) {
            console.error("[MoveChat Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 🗑️ 接口 15: 删除聊天目录 (DeleteChat)
    // ==========================================
    router.post('/deleteChat', async (req, res) => {
        try {
            const { userHandle, dirPath } = req.body;
            if (!dirPath) return res.status(400).json({ error: "缺少路径参数" });

            const absolutePath = getSafePath(userHandle, dirPath);

            try {
                await fs.access(absolutePath);
            } catch {
                return res.json({ success: true, message: "目录不存在" });
            }

            await fs.rm(absolutePath, { recursive: true, force: true });
            res.json({ success: true });
        } catch (err) {
            console.error("[DeleteChat Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==========================================
    // 📋 接口 16: 列出角色下所有聊天 (ListChats)
    // ==========================================
    router.post('/listChats', async (req, res) => {
        try {
            const { userHandle, charName } = req.body;
            if (!charName) return res.status(400).json({ error: "缺少角色名参数" });

            const safeCharName = charName.replace(/\./g, '_');
            const absolutePath = getSafePath(userHandle, `chats/${safeCharName}`);

            try {
                await fs.access(absolutePath);
            } catch {
                return res.json({ success: true, chats: [] });
            }

            const entries = await fs.readdir(absolutePath, { withFileTypes: true });
            const chats = entries.filter(e => e.isDirectory()).map(e => e.name);
            res.json({ success: true, chats });
        } catch (err) {
            console.error("[ListChats Error]", err);
            res.status(500).json({ success: false, error: err.message });
        }
    });
}

export function exit() { }