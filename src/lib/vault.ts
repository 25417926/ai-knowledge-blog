import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { DatabaseSync } from 'node:sqlite';
import { tx } from './db.ts';

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
const CHUNK_SOFT_LIMIT = 800;

export type ParsedNote = {
  slug: string;
  aliases: string[];
  title: string;
  summary: string;
  category: string;
  tags: string[];
  content: string;
  sourcePath: string;
  wordCount: number;
  publishedAt: string | null;
  links: string[];
  chunks: { headingPath: string; body: string }[];
};

function toSlug(input: string): string {
  return input
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,，]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

export function extractWikilinks(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(WIKILINK_RE)) {
    found.add(match[1].trim());
  }
  return [...found];
}

function splitChunks(markdown: string): { headingPath: string; body: string }[] {
  const lines = markdown.split(/\r?\n/);
  const sections: { headingPath: string; lines: string[] }[] = [];
  let stack: { level: number; text: string }[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) {
      sections.push({
        headingPath: stack.map((h) => h.text).join(' > '),
        lines: body.split(/\n{2,}/),
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      stack = stack.filter((h) => h.level < level);
      stack.push({ level, text: heading[2].trim() });
      continue;
    }
    buffer.push(line);
  }
  flush();

  const chunks: { headingPath: string; body: string }[] = [];
  for (const section of sections) {
    let current = '';
    for (const paragraph of section.lines) {
      if (current && current.length + paragraph.length > CHUNK_SOFT_LIMIT) {
        chunks.push({ headingPath: section.headingPath, body: current.trim() });
        current = '';
      }
      current += (current ? '\n\n' : '') + paragraph;
    }
    if (current.trim()) {
      chunks.push({ headingPath: section.headingPath, body: current.trim() });
    }
  }
  return chunks;
}

/**
 * frontmatter 的 date 会被 gray-matter 解析成 Date 对象，直接 String() 会得到
 * 「Mon Sep 28 2026 08:00:00 GMT+0800 (中国标准时间)」这种无法排序、无法本地化的串。
 * 统一归一化成 YYYY-MM-DD；已是该格式的直接取前 10 位，避免时区回退一天。
 */
function normalizeDate(value: unknown): string | null {
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

export function parseNote(absPath: string, rootDir: string): ParsedNote {
  const raw = fs.readFileSync(absPath, 'utf8');
  const { data, content } = matter(raw);
  const relPath = path.relative(rootDir, absPath).split(path.sep).join('/');
  const basename = path.basename(absPath, '.md');
  const slug = toSlug(typeof data.slug === 'string' && data.slug ? data.slug : basename);
  const title = typeof data.title === 'string' && data.title ? data.title : basename;

  const folder = path.dirname(relPath);
  const category =
    (typeof data.category === 'string' && data.category) ||
    (folder && folder !== '.' ? folder.split('/')[0] : '未分类');

  const publishedAt = normalizeDate(data.date);

  return {
    slug,
    aliases: [...new Set([slug, toSlug(basename), title])],
    title,
    summary: typeof data.summary === 'string' ? data.summary : '',
    category,
    tags: asStringArray(data.tags),
    content,
    sourcePath: relPath,
    wordCount: content.replace(/\s/g, '').length,
    publishedAt,
    links: extractWikilinks(content),
    chunks: splitChunks(content),
  };
}

export function collectNotes(rootDir: string): ParsedNote[] {
  const notes: ParsedNote[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        notes.push(parseNote(abs, rootDir));
      }
    }
  };
  walk(rootDir);
  return notes.sort((a, b) => a.slug.localeCompare(b.slug));
}

export type ImportStats = {
  posts: number;
  tags: number;
  links: number;
  resolvedLinks: number;
  chunks: number;
};

export function importNotes(db: DatabaseSync, notes: ParsedNote[]): ImportStats {
  const stats: ImportStats = { posts: 0, tags: 0, links: 0, resolvedLinks: 0, chunks: 0 };

  const upsertPost = db.prepare(`
    INSERT INTO posts (slug, title, summary, category, content, status, source_path, word_count, published_at, updated_at)
    VALUES (@slug, @title, @summary, @category, @content, 'published', @source_path, @word_count, @published_at, datetime('now'))
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      category = excluded.category,
      content = excluded.content,
      source_path = excluded.source_path,
      word_count = excluded.word_count,
      published_at = excluded.published_at,
      updated_at = datetime('now')
  `);
  const findPost = db.prepare('SELECT id FROM posts WHERE slug = ?');
  const upsertTag = db.prepare('INSERT INTO tags (name, slug) VALUES (?, ?) ON CONFLICT(slug) DO NOTHING');
  const findTag = db.prepare('SELECT id FROM tags WHERE slug = ?');
  const linkTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');
  const clearTags = db.prepare('DELETE FROM post_tags WHERE post_id = ?');
  const clearLinks = db.prepare('DELETE FROM links WHERE source_post_id = ?');
  const clearChunks = db.prepare('DELETE FROM chunks WHERE post_id = ?');
  const insertLink = db.prepare('INSERT INTO links (source_post_id, target_slug) VALUES (?, ?)');
  const insertChunk = db.prepare('INSERT INTO chunks (post_id, ord, heading_path, body) VALUES (?, ?, ?, ?)');
  const resolveLink = db.prepare('UPDATE links SET target_post_id = ? WHERE source_post_id = ? AND target_slug = ?');

  const slugToId = new Map<string, number>();
  const aliasToId = new Map<string, number>();

  tx(db, () => {
    for (const note of notes) {
      upsertPost.run({
        slug: note.slug,
        title: note.title,
        summary: note.summary,
        category: note.category,
        content: note.content,
        source_path: note.sourcePath,
        word_count: note.wordCount,
        published_at: note.publishedAt,
      });
      const row = findPost.get(note.slug) as { id: number };
      slugToId.set(note.slug, row.id);
      for (const alias of note.aliases) {
        if (!aliasToId.has(alias)) aliasToId.set(alias, row.id);
      }

      clearTags.run(row.id);
      for (const tagName of note.tags) {
        const tagSlug = toSlug(tagName);
        if (!tagSlug) continue;
        upsertTag.run(tagName, tagSlug);
        const tag = findTag.get(tagSlug) as { id: number };
        linkTag.run(row.id, tag.id);
      }

      clearLinks.run(row.id);
      for (const target of note.links) {
        insertLink.run(row.id, target);
        stats.links += 1;
      }

      clearChunks.run(row.id);
      note.chunks.forEach((chunk, index) => {
        insertChunk.run(row.id, index, chunk.headingPath, chunk.body);
        stats.chunks += 1;
      });

      stats.posts += 1;
    }

    for (const note of notes) {
      const sourceId = slugToId.get(note.slug);
      if (sourceId === undefined) continue;
      for (const target of note.links) {
        const targetId = aliasToId.get(target) ?? aliasToId.get(toSlug(target));
        if (targetId === undefined) continue;
        resolveLink.run(targetId, sourceId, target);
        stats.resolvedLinks += 1;
      }
    }
    stats.tags = (db.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number }).c;
  });

  return stats;
}
