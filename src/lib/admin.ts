/**
 * 后台（/admin）的 typed fetch 客户端。
 *
 * 与 src/lib/api.ts 只差一处、但很关键：这里走**同源相对路径** `/api/admin/*`。
 * 登录态是 httpOnly cookie，若直连 http://127.0.0.1:8000，cookie 就落在那个主机上；
 * 而页面常常是从 localhost:3000 打开的 —— 两者不同站，SameSite=Lax 的 cookie 不会带上，
 * 表现就是「刚登录完又被弹回登录页」。走 next.config.mjs 里现成的 /api 代理，
 * cookie 落在当前站点上，用哪个地址打开都一致。
 */

export const ADMIN_BASE = '/api/admin';

export class AdminError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AdminError';
  }
}

export type AdminPostListItem = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  status: 'published' | 'draft';
  wordCount: number;
  publishedAt: string | null;
  updatedAt: string;
  sourcePath: string;
};

export type AdminPost = AdminPostListItem & { content: string };

export type AdminPostInput = {
  title: string;
  summary: string;
  category: string;
  tags: string[];
  date: string;
  status: 'published' | 'draft';
  content: string;
};

export type AdminMe = { enabled: boolean; authenticated: boolean };

export type AdminLogSource = {
  postSlug: string;
  postTitle: string;
  heading: string;
  pdfUrl: string | null;
};

export type AdminLogTurn = {
  id: number;
  role: string;
  content: string;
  affinityDelta: number;
  latencyMs: number;
  model: string;
  createdAt: string;
  sources: AdminLogSource[];
  toolTrace: { tool?: string; label?: string; hits?: number; ms?: number }[];
};

export type AdminLog = {
  sessionId: string;
  agentSlug: string;
  agentName: string;
  turns: AdminLogTurn[];
  affinity: { score: number; stage: string; label: string };
  memories: { id: number; content: string }[];
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    let detail = `请求失败（HTTP ${res.status}）`;
    try {
      const data = await res.json();
      if (typeof data?.detail === 'string') detail = data.detail;
    } catch {
      // 响应不是 JSON（例如后端没起），沿用状态码文案
    }
    throw new AdminError(res.status, detail);
  }
  return (await res.json()) as T;
}

// ── 认证 ──────────────────────────────────────────────

export const adminMe = () => request<AdminMe>('/me');

export const adminLogin = (password: string) =>
  request<{ ok: boolean }>('/login', { method: 'POST', body: JSON.stringify({ password }) });

export const adminLogout = () => request<{ ok: boolean }>('/logout', { method: 'POST' });

// ── 文章 ──────────────────────────────────────────────

export const adminListPosts = (q = '') =>
  request<AdminPostListItem[]>(`/posts${q ? `?q=${encodeURIComponent(q)}` : ''}`);

export const adminGetPost = (slug: string) =>
  request<AdminPost>(`/posts/${encodeURIComponent(slug)}`);

export const adminCreatePost = (input: AdminPostInput) =>
  request<{ ok: boolean; slug: string; sourcePath: string }>('/posts', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const adminUpdatePost = (slug: string, input: AdminPostInput) =>
  request<{ ok: boolean; slug: string; sourcePath: string }>(
    `/posts/${encodeURIComponent(slug)}`,
    { method: 'PUT', body: JSON.stringify(input) },
  );

export const adminDeletePost = (slug: string) =>
  request<{ ok: boolean }>(`/posts/${encodeURIComponent(slug)}`, { method: 'DELETE' });

// ── 摘要 ──────────────────────────────────────────────

/** `extract` 是纯抽取（毫秒级）；`llm` 是模型写的；`mock` 是没配 LLM 时的抽取兜底。 */
export type SummarySource = 'extract' | 'llm' | 'mock';

export type SummaryResult = {
  summary: string;
  source: SummarySource;
  note?: string;
  model?: string;
};

/**
 * 生成 / 优化一句话摘要。纯计算接口：不落库、不写文件，满意了再随文章一起保存。
 * `current` 非空时后端走「优化」而不是「生成」。
 */
export const adminSummarize = (input: {
  title: string;
  content: string;
  current?: string;
  mode: 'extract' | 'ai';
}) => request<SummaryResult>('/summary', { method: 'POST', body: JSON.stringify(input) });

// ── 友链 ──────────────────────────────────────────────

export type AdminFriend = {
  id: number;
  name: string;
  href: string;
  description: string;
  tags: string[];
};

export type AdminFriendInput = Omit<AdminFriend, 'id'>;

export const adminListFriends = () => request<AdminFriend[]>('/friends');

export const adminCreateFriend = (input: AdminFriendInput) =>
  request<{ ok: boolean }>('/friends', { method: 'POST', body: JSON.stringify(input) });

export const adminUpdateFriend = (id: number, input: AdminFriendInput) =>
  request<{ ok: boolean }>(`/friends/${id}`, { method: 'PUT', body: JSON.stringify(input) });

export const adminDeleteFriend = (id: number) =>
  request<{ ok: boolean }>(`/friends/${id}`, { method: 'DELETE' });

// ── 日志 ──────────────────────────────────────────────

export const adminLogs = (limit = 60) => request<AdminLog>(`/logs?limit=${limit}`);

// ── 收藏 ──────────────────────────────────────────────

export type AdminClipping = {
  id: number;
  url: string;
  title: string;
  origin: string;
  wordCount: number;
  createdAt: string;
  sourcePath: string;
  slug: string;
  hasPdf: boolean;
  indexable: boolean;
  postExists: boolean;
};

export type ClipStep = { label: string; detail: string };

/** 一次收藏的结果。字段与后端 run_clip 的返回逐字对应，别各改各的。 */
export type ClipResult = {
  ok: boolean;
  id: number;
  url: string;
  title: string;
  slug: string;
  sourcePath: string;
  origin: string;
  updated: boolean;
  chars: number;
  summarySource: string;
  pdfBytes: number;
  indexable: boolean;
  steps: ClipStep[];
  stats: { posts: number; chunks: number };
};

export const adminListClippings = () => request<AdminClipping[]>('/clippings');

export const adminCreateClipping = (input: { url: string; paste?: string; title?: string }) =>
  request<ClipResult>('/clippings', { method: 'POST', body: JSON.stringify(input) });

export const adminDeleteClipping = (id: number) =>
  request<{ ok: boolean; slug: string; removedFile: boolean }>(`/clippings/${id}`, {
    method: 'DELETE',
  });
