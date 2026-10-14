import { getDb } from './db';

/**
 * 说说：类朋友圈的短动态。
 *
 * 图片只存路径数组，宫格布局由前端按数量推导（1/2/3/4/6/9），
 * 不在这里决定「几宫格」——那是展示层的事。
 */

export type Moment = {
  id: number;
  content: string;
  images: string[];
  location: string;
  reactionCount: number;
  publishedAt: string | null;
};

type Row = {
  id: number;
  content: string;
  images: string;
  location: string;
  reaction_count: number;
  published_at: string | null;
};

function toMoment(row: Row): Moment {
  let images: string[] = [];
  try {
    const parsed = JSON.parse(row.images) as unknown;
    if (Array.isArray(parsed)) images = parsed.map((i) => String(i)).filter(Boolean);
  } catch {
    images = [];
  }
  return {
    id: row.id,
    content: row.content,
    images,
    location: row.location,
    reactionCount: row.reaction_count,
    publishedAt: row.published_at,
  };
}

export function listMoments(opts: { q?: string; order?: 'desc' | 'asc' } = {}): Moment[] {
  const q = (opts.q ?? '').trim();
  const direction = opts.order === 'asc' ? 'ASC' : 'DESC';
  const rows = getDb()
    .prepare(
      `SELECT id, content, images, location, reaction_count, published_at
       FROM moments
       WHERE (@q = '' OR content LIKE @like OR location LIKE @like)
       ORDER BY COALESCE(published_at, created_at) ${direction}, id ${direction}`,
    )
    .all({ q, like: `%${q}%` }) as Row[];
  return rows.map(toMoment);
}

export function countMoments(): number {
  return (getDb().prepare(`SELECT COUNT(*) AS c FROM moments`).get() as { c: number }).c;
}
