import { getDb } from './db';

export type PostListItem = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  category: string;
  wordCount: number;
  publishedAt: string | null;
  tags: string[];
};

export type PostDetail = PostListItem & {
  content: string;
  sourcePath: string;
  updatedAt: string;
};

export type TagRow = { id: number; name: string; slug: string; count: number };

type PostRow = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  category: string;
  word_count: number;
  published_at: string | null;
};

function attachTags(rows: PostRow[]): PostListItem[] {
  if (rows.length === 0) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const tagRows = db
    .prepare(
      `SELECT pt.post_id AS postId, t.name AS name
       FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
       WHERE pt.post_id IN (${placeholders})
       ORDER BY t.name`,
    )
    .all(...ids) as { postId: number; name: string }[];

  const byPost = new Map<number, string[]>();
  for (const t of tagRows) {
    const list = byPost.get(t.postId) ?? [];
    list.push(t.name);
    byPost.set(t.postId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    category: r.category,
    wordCount: r.word_count,
    publishedAt: r.published_at,
    tags: byPost.get(r.id) ?? [],
  }));
}

export function listPosts(opts: { q?: string; tag?: string; category?: string } = {}): PostListItem[] {
  const db = getDb();
  const q = (opts.q ?? '').trim();
  const tag = (opts.tag ?? '').trim();
  const category = (opts.category ?? '').trim();

  const rows = db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.summary, p.category, p.word_count, p.published_at
       FROM posts p
       WHERE p.status = 'published'
         AND (@q = '' OR p.title LIKE @like OR p.summary LIKE @like OR p.content LIKE @like)
         AND (@tag = '' OR EXISTS (
              SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
              WHERE pt.post_id = p.id AND t.slug = @tag))
         AND (@category = '' OR p.category = @category)
       ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC`,
    )
    .all({ q, like: `%${q}%`, tag, category }) as PostRow[];

  return attachTags(rows);
}

export function listTags(): TagRow[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.name, t.slug, COUNT(pt.post_id) AS count
       FROM tags t
       LEFT JOIN post_tags pt ON pt.tag_id = t.id
       LEFT JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
       GROUP BY t.id
       HAVING count > 0
       ORDER BY count DESC, t.name`,
    )
    .all() as TagRow[];

  // node:sqlite 返回的行是 null 原型对象，这种对象不能跨到客户端组件（序列化会报错），
  // 所以这里显式转成普通对象再交出去
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, count: row.count }));
}

export function listCategories(): { category: string; count: number }[] {
  return getDb()
    .prepare(
      `SELECT category, COUNT(*) AS count FROM posts
       WHERE status = 'published' GROUP BY category ORDER BY count DESC, category`,
    )
    .all() as { category: string; count: number }[];
}

export function getPostBySlug(slug: string): PostDetail | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, slug, title, summary, category, content, source_path, word_count, published_at, updated_at
       FROM posts WHERE slug = ? AND status = 'published'`,
    )
    .get(slug) as
    | (PostRow & { content: string; source_path: string; updated_at: string })
    | undefined;
  if (!row) return null;
  const [item] = attachTags([row]);
  return {
    ...item,
    content: row.content,
    sourcePath: row.source_path,
    updatedAt: row.updated_at,
  };
}

export function getAllSlugs(): string[] {
  return (getDb().prepare(`SELECT slug FROM posts WHERE status = 'published'`).all() as { slug: string }[]).map(
    (r) => r.slug,
  );
}

/** 双链解析表：标题 / slug 归一化后都指向真实 slug */
export function getLinkIndex(): Map<string, string> {
  const rows = getDb().prepare(`SELECT slug, title FROM posts WHERE status = 'published'`).all() as {
    slug: string;
    title: string;
  }[];
  const index = new Map<string, string>();
  for (const row of rows) {
    index.set(normalizeKey(row.slug), row.slug);
    index.set(normalizeKey(row.title), row.slug);
  }
  return index;
}

export function normalizeKey(input: string): string {
  return input
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export type GraphData = {
  nodes: { id: string; slug: string; title: string; category: string; degree: number }[];
  edges: { source: string; target: string }[];
};

/** 2D 脉络图与小镇街区共用的一份图数据 */
export function getGraph(): GraphData {
  const db = getDb();
  const nodes = db
    .prepare(`SELECT id, slug, title, category FROM posts WHERE status = 'published'`)
    .all() as { id: number; slug: string; title: string; category: string }[];
  const edges = db
    .prepare(
      `SELECT s.slug AS source, t.slug AS target
       FROM links l
       JOIN posts s ON s.id = l.source_post_id
       JOIN posts t ON t.id = l.target_post_id
       WHERE t.status = 'published'`,
    )
    .all() as { source: string; target: string }[];

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  return {
    nodes: nodes.map((n) => ({
      id: n.slug,
      slug: n.slug,
      title: n.title,
      category: n.category,
      degree: degree.get(n.slug) ?? 0,
    })),
    edges,
  };
}

export type LinkRef = { slug: string; title: string };

/** 反向链接：哪些文章引用了当前文章 */
export function getBacklinks(slug: string): LinkRef[] {
  return getDb()
    .prepare(
      `SELECT p.slug, p.title
       FROM links l
       JOIN posts p ON p.id = l.source_post_id
       WHERE l.target_post_id = (SELECT id FROM posts WHERE slug = ?)
         AND p.status = 'published'
       GROUP BY p.id
       ORDER BY p.title`,
    )
    .all(slug) as LinkRef[];
}

/** 出链：当前文章引用了哪些文章 */
export function getOutgoingLinks(slug: string): LinkRef[] {
  return getDb()
    .prepare(
      `SELECT t.slug, t.title
       FROM links l
       JOIN posts t ON t.id = l.target_post_id
       WHERE l.source_post_id = (SELECT id FROM posts WHERE slug = ?)
         AND t.status = 'published'
       GROUP BY t.id
       ORDER BY t.title`,
    )
    .all(slug) as LinkRef[];
}
