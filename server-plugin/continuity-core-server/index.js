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
}

export function exit() { }