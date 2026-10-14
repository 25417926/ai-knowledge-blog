import path from 'node:path';
import fs from 'node:fs';
import { openDb, initSchema } from '../src/lib/db.ts';
import { collectNotes, importNotes } from '../src/lib/vault.ts';

const vaultDir = path.resolve(process.cwd(), process.env.VAULT_DIR ?? 'content/sample-vault');

console.log('▸ 导入 Obsidian Vault');
console.log(`  目录：${vaultDir}`);

if (!fs.existsSync(vaultDir)) {
  console.error('  ✗ 目录不存在');
  process.exit(1);
}

const notes = collectNotes(vaultDir);
console.log(`  · 扫描到 ${notes.length} 篇笔记`);

const db = openDb();
initSchema(db);
const stats = importNotes(db, notes);
db.close();

console.log(`  ✓ 文章 ${stats.posts} 篇 · 标签 ${stats.tags} 个 · 切分块 ${stats.chunks} 个`);
console.log(`  ✓ 双链 ${stats.links} 条，其中可解析 ${stats.resolvedLinks} 条`);
if (stats.links > stats.resolvedLinks) {
  console.log(`  ! 有 ${stats.links - stats.resolvedLinks} 条双链指向不存在的笔记（会显示为待创建）`);
}
console.log('  提示：运行 npm run dev 查看站点');
