// 一次性工具：从 Simple Icons CDN 拉取品牌图标 SVG 落盘，
// 生成 src/features/phone/apps/brand-icons.js（白色剪影，供皮肤图标盒使用）。
// 用法：node scripts/fetch-brand-icons.mjs
// 注意：仅运行时内嵌，无任何远程依赖；更新图标时重跑一次即可。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'features', 'phone', 'apps', 'brand-icons.js');

// slug → 输出 key；颜色染成白色（图案统一白，底色由皮肤 iconBg 提供）
const ICONS = [
    { slug: 'wechat', key: 'wechat' },
    { slug: 'qq', key: 'qq' },
    { slug: 'line', key: 'line' },
];

const HEADER = `// 品牌图标（本地内嵌，无远程引用）
// 来源：Simple Icons（https://simpleicons.org）CC0 / 品牌官方剪影，染白后作为图标图案。
// 更新方法：node scripts/fetch-brand-icons.mjs
// 注意：图案统一白色，配合皮肤 iconBg 底色使用。

export const BRAND_ICONS = {
`;

async function main() {
    const entries = [];
    for (const { slug, key } of ICONS) {
        const url = `https://cdn.simpleicons.org/${slug}/ffffff`;
        console.log('拉取', url);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${slug}`);
        const svg = (await res.text()).trim();
        const compact = svg.replace(/\s+/g, ' ').replace(/> </g, '><');
        entries.push(`    ${key}: '${compact}'`);
        console.log(`  ✓ ${slug} (${svg.length} 字符)`);
    }
    const body = HEADER + entries.join(',\n') + ',\n};\n';
    writeFileSync(OUT, body, 'utf8');
    console.log('已写入', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });