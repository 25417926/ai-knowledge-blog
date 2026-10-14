import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { openDb, initSchema, tx, dbPath } from '../src/lib/db.ts';

type AgentSeed = {
  slug: string;
  kind?: string;
  name: string;
  persona?: string;
  avatar?: string;
  location?: string;
  meta?: Record<string, unknown>;
};

function seedAgents() {
  const file = path.join(process.cwd(), 'content', 'town', 'agents.json');
  if (!fs.existsSync(file)) {
    console.log('  · 未找到 content/town/agents.json，跳过角色初始化');
    return 0;
  }
  const db = openDb();
  const { agents } = JSON.parse(fs.readFileSync(file, 'utf8')) as { agents: AgentSeed[] };
  const stmt = db.prepare(`
    INSERT INTO agents (kind, slug, name, persona, avatar, location, meta)
    VALUES (@kind, @slug, @name, @persona, @avatar, @location, @meta)
    ON CONFLICT(slug) DO UPDATE SET
      kind = excluded.kind,
      name = excluded.name,
      persona = excluded.persona,
      avatar = excluded.avatar,
      location = excluded.location,
      meta = excluded.meta
  `);
  tx(db, () => {
    for (const agent of agents) {
      stmt.run({
        kind: agent.kind ?? 'npc',
        slug: agent.slug,
        name: agent.name,
        persona: agent.persona ?? '',
        avatar: agent.avatar ?? '',
        location: agent.location ?? '',
        meta: JSON.stringify(agent.meta ?? {}),
      });
    }
  });
  db.close();
  return agents.length;
}

/** frontmatter 的 date 统一收敛成 YYYY-MM-DD，避免 gray-matter 解析成 Date 后排序错乱 */
function toDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
  }
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,，]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function seedChatter(): number {
  const dir = path.join(process.cwd(), 'content', 'chatter');
  if (!fs.existsSync(dir)) {
    console.log('  · 未找到 content/chatter，跳过杂谈初始化');
    return 0;
  }
  const db = openDb();
  const stmt = db.prepare(`
    INSERT INTO chatter (slug, title, excerpt, content, mood, tags, cover, published_at)
    VALUES (@slug, @title, @excerpt, @content, @mood, @tags, @cover, @published_at)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      excerpt = excluded.excerpt,
      content = excluded.content,
      mood = excluded.mood,
      tags = excluded.tags,
      cover = excluded.cover,
      published_at = excluded.published_at
  `);
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
  tx(db, () => {
    for (const file of files) {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const { data, content } = matter(raw);
      const basename = path.basename(file, '.md');
      stmt.run({
        slug: typeof data.slug === 'string' && data.slug ? data.slug : basename,
        title: typeof data.title === 'string' && data.title ? data.title : basename,
        excerpt: typeof data.excerpt === 'string' ? data.excerpt : content.replace(/[#>*`\-\n]/g, ' ').trim().slice(0, 80),
        content,
        mood: typeof data.mood === 'string' && data.mood ? data.mood : 'calm',
        tags: JSON.stringify(toStringList(data.tags)),
        cover: typeof data.cover === 'string' ? data.cover : '',
        published_at: toDate(data.date),
      });
    }
  });
  db.close();
  return files.length;
}

function seedMoments(): number {
  const file = path.join(process.cwd(), 'content', 'moments.json');
  if (!fs.existsSync(file)) {
    console.log('  · 未找到 content/moments.json，跳过说说初始化');
    return 0;
  }
  type MomentSeed = {
    content: string;
    images?: string[];
    location?: string;
    publishedAt?: string;
    reactionCount?: number;
  };
  const db = openDb();
  const list = JSON.parse(fs.readFileSync(file, 'utf8')) as MomentSeed[];
  // 说说没有天然主键，用「内容」判重，避免反复初始化时堆出一堆重复动态
  const exists = db.prepare(`SELECT id FROM moments WHERE content = ?`);
  const insert = db.prepare(
    `INSERT INTO moments (content, images, location, reaction_count, published_at)
     VALUES (@content, @images, @location, @reaction_count, @published_at)`,
  );
  let inserted = 0;
  tx(db, () => {
    for (const moment of list) {
      if (exists.get(moment.content)) continue;
      insert.run({
        content: moment.content,
        images: JSON.stringify(moment.images ?? []),
        location: moment.location ?? '',
        reaction_count: moment.reactionCount ?? 0,
        published_at: toDate(moment.publishedAt),
      });
      inserted += 1;
    }
  });
  db.close();
  return inserted;
}

console.log('▸ 初始化数据库');
console.log(`  路径：${dbPath}`);
const db = openDb();
initSchema(db);
const tableCount = (
  db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).get() as {
    c: number;
  }
).c;
db.close();

const agentCount = seedAgents();
const chatterCount = seedChatter();
const momentCount = seedMoments();

console.log(`  ✓ 建表完成，共 ${tableCount} 张表`);
console.log(`  ✓ 角色初始化完成，共 ${agentCount} 个 agent`);
console.log(`  ✓ 杂谈初始化完成，共 ${chatterCount} 篇`);
console.log(`  ✓ 说说初始化完成，新增 ${momentCount} 条`);
console.log('  提示：下一步运行 npm run vault:import 导入内容');
