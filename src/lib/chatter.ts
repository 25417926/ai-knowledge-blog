import { getDb } from './db';
import { isMood, type Mood } from './moods';

export type { Mood };

/**
 * 杂谈：非正式随笔。
 *
 * 与 posts 的关键差别是「情绪」——它不是分类，而是写的时候的状态，
 * 所以用固定枚举而不是自由标签，界面上才能稳定地给出颜色和文案。
 * 枚举本身放在 ./moods（无数据库依赖），客户端组件才能安全引用。
 */

export type ChatterItem = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  mood: Mood;
  tags: string[];
  cover: string;
  publishedAt: string | null;
  wordCount: number;
};

export type ChatterDetail = ChatterItem & { content: string };

type Row = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  mood: string;
  tags: string;
  cover: string;
  published_at: string | null;
};

function toItem(row: Row): ChatterDetail {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags) as unknown;
    if (Array.isArray(parsed)) tags = parsed.map((t) => String(t));
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    mood: isMood(row.mood) ? row.mood : 'calm',
    tags,
    cover: row.cover,
    publishedAt: row.published_at,
    wordCount: row.content.replace(/\s/g, '').length,
  };
}

export function listChatter(opts: { q?: string; tag?: string; mood?: string } = {}): ChatterItem[] {
  const q = (opts.q ?? '').trim();
  const tag = (opts.tag ?? '').trim();
  const mood = (opts.mood ?? '').trim();

  const rows = getDb()
    .prepare(
      `SELECT id, slug, title, excerpt, content, mood, tags, cover, published_at
       FROM chatter
       WHERE (@q = '' OR title LIKE @like OR excerpt LIKE @like OR content LIKE @like)
         AND (@mood = '' OR mood = @mood)
         AND (@tag = '' OR tags LIKE @tagLike)
       ORDER BY COALESCE(published_at, created_at) DESC, id DESC`,
    )
    .all({ q, like: `%${q}%`, mood, tag, tagLike: `%"${tag}"%` }) as Row[];

  return rows.map(toItem);
}

export function getChatter(slug: string): ChatterDetail | null {
  const row = getDb()
    .prepare(
      `SELECT id, slug, title, excerpt, content, mood, tags, cover, published_at
       FROM chatter WHERE slug = ?`,
    )
    .get(slug) as Row | undefined;
  return row ? toItem(row) : null;
}

/** 标签及数量：从所有杂谈的 JSON 标签里聚合出来，供标签条渲染 */
export function listChatterTags(): { name: string; count: number }[] {
  const rows = getDb().prepare(`SELECT tags FROM chatter`).all() as { tags: string }[];
  const counter = new Map<string, number>();
  for (const row of rows) {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(row.tags) as unknown;
      if (Array.isArray(parsed)) tags = parsed.map((t) => String(t));
    } catch {
      tags = [];
    }
    for (const tag of tags) counter.set(tag, (counter.get(tag) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function countChatter(): number {
  return (getDb().prepare(`SELECT COUNT(*) AS c FROM chatter`).get() as { c: number }).c;
}
