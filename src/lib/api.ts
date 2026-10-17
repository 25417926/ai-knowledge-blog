/**
 * Python 后端的 typed fetch 客户端。
 *
 * 架构变更（2026-10-15）：Next.js 只做前端，数据层整体搬到 server/（FastAPI + SQLAlchemy）。
 * 这里所有函数都走 HTTP，返回值与原来 Node 侧 lib 函数逐字对齐 ——
 * 页面把 import 从 '@/lib/posts' 换成 '@/lib/api' 即可，渲染逻辑零改动。
 *
 * baseURL 解析顺序：NEXT_PUBLIC_API_BASE_URL → API_BASE_URL → http://127.0.0.1:8000
 */

const RAW_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://127.0.0.1:8000';

export const API_BASE = RAW_BASE.replace(/\/+$/, '');

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
export type CategoryRow = { category: string; count: number };
export type LinkRef = { slug: string; title: string };

export type GraphData = {
  nodes: { id: string; slug: string; title: string; category: string; degree: number }[];
  edges: { source: string; target: string }[];
};

/** 相关文章：显式双链之外召回出来的近邻，带上召回理由（后端 related_posts 算好） */
export type RelatedPost = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  score: number;
  sharedTags: string[];
  coCitations: number;
  contentOverlap: number;
};

export type Moment = {
  id: number;
  content: string;
  images: string[];
  location: string;
  reactionCount: number;
  publishedAt: string | null;
};

/** 后端未启动或返回非 2xx 时抛出，页面按「数据不可用」处理 */
export class ApiError extends Error {
  constructor(
    public readonly path: string,
    public readonly status: number,
    detail: string,
  ) {
    super(`接口 ${path} 返回 ${status}：${detail}`);
    this.name = 'ApiError';
  }
}

async function get<T>(path: string, revalidate = 0): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    // 文章详情等需要每次拿最新内容；列表页同样走 no-store，与原先 force-dynamic 行为一致
    cache: 'no-store',
    next: { revalidate },
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new ApiError(path, res.status, detail);
  }
  return (await res.json()) as T;
}

export type FriendItem = {
  id: number;
  name: string;
  href: string;
  description: string;
  tags: string[];
};

// ── 文章 ──────────────────────────────────────────────

export async function listPosts(opts: { q?: string; tag?: string; category?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.tag) params.set('tag', opts.tag);
  if (opts.category) params.set('category', opts.category);
  const query = params.toString();
  return get<PostListItem[]>(`/api/posts${query ? `?${query}` : ''}`);
}

export async function listTags() {
  return get<TagRow[]>('/api/tags');
}

export async function listCategories() {
  return get<CategoryRow[]>('/api/categories');
}

export async function getPostBySlug(slug: string) {
  const post = await get<PostDetail | null>(`/api/posts/${encodeURIComponent(slug)}`);
  return post;
}

export async function getAllSlugs() {
  return get<string[]>('/api/posts/slugs');
}

export async function getLinkIndex() {
  const index = await get<Record<string, string>>('/api/link-index');
  return new Map(Object.entries(index));
}

export async function getGraph() {
  return get<GraphData>('/api/graph');
}

export async function getBacklinks(slug: string) {
  return get<LinkRef[]>(`/api/posts/${encodeURIComponent(slug)}/backlinks`);
}

export async function getOutgoingLinks(slug: string) {
  return get<LinkRef[]>(`/api/posts/${encodeURIComponent(slug)}/outgoing`);
}

/** 双链之外的相关文章；孤立文章（出链/反链全空）靠它才有下一跳 */
export async function getRelatedPosts(slug: string) {
  return get<RelatedPost[]>(`/api/posts/${encodeURIComponent(slug)}/related`);
}

// ── 说说 ──────────────────────────────────────────────

export async function listMoments(opts: { q?: string; order?: 'desc' | 'asc' } = {}) {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.order) params.set('order', opts.order);
  const query = params.toString();
  return get<Moment[]>(`/api/moments${query ? `?${query}` : ''}`);
}

// ── 友链 ──────────────────────────────────────────────

export async function listFriends() {
  return get<FriendItem[]>('/api/friends');
}

// ── 博客助手（客户端直连 Python 端） ──────────────────

export const ASK_BASE = `${API_BASE}/api/ask`;
