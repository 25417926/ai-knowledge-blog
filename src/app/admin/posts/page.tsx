'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminError, adminDeletePost, adminListPosts, type AdminPostListItem } from '@/lib/admin';

function when(value: string) {
  return value ? value.slice(0, 16).replace('T', ' ') : '—';
}

export default function AdminPostsPage() {
  const [items, setItems] = useState<AdminPostListItem[]>([]);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState('');
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback((q: string) => {
    setBusy(true);
    return adminListPosts(q)
      .then((rows) => {
        setItems(rows);
        setError('');
      })
      .catch((err) => setError(err instanceof AdminError ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    load('');
  }, [load]);

  async function remove(slug: string) {
    if (!window.confirm(`确定删除《${slug}》？文件与索引都会一起删掉。`)) return;
    setNotice('');
    setError('');
    try {
      await adminDeletePost(slug);
      setNotice(`已删除 ${slug}（连同它的 md 文件与索引）`);
      await load(pending);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : String(err));
    }
  }

  const drafts = items.filter((p) => p.status !== 'published').length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-medium text-ink-text">文章</h1>
          <p className="mt-1 text-[12px] text-ink-dim">
            共 {items.length} 篇{pending ? `（搜索：${pending}）` : ''} · 其中草稿 {drafts} 篇
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPending(query);
              load(query);
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜标题或 slug"
              className="w-44 rounded-xl border border-ink-line bg-ink-soft px-3 py-2 text-[12px] text-ink-text outline-none transition focus:border-accent"
            />
          </form>
          <Link
            href="/admin/posts/new"
            className="rounded-xl bg-accent px-3.5 py-2 text-[12px] font-medium text-white transition hover:opacity-90"
          >
            新建文章
          </Link>
        </div>
      </header>

      {notice && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2 text-[12px] text-emerald-600 dark:text-emerald-400">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3.5 py-2 text-[12px] text-rose-500">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink-panel/60">
        {busy && <p className="px-4 py-6 text-center text-[12px] text-ink-dim">加载中…</p>}
        {!busy && items.length === 0 && (
          <p className="px-4 py-6 text-center text-[12px] text-ink-dim">没有匹配的文章</p>
        )}
        {!busy &&
          items.map((post) => (
            <div
              key={post.slug}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/posts/${encodeURIComponent(post.slug)}`}
                    className="truncate text-[13px] font-medium text-ink-text transition hover:text-accent-ink"
                  >
                    {post.title}
                  </Link>
                  {post.status !== 'published' && (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      草稿
                    </span>
                  )}
                  {post.sourcePath.startsWith('clippings/') && (
                    <span className="shrink-0 rounded-full bg-ink-line/60 px-2 py-0.5 text-[10px] text-ink-dim">
                      收藏稿
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-ink-dim">
                  {post.category || '未分类'} · {post.wordCount} 字 · {when(post.updatedAt)} 更新
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link
                  href={`/posts/${encodeURIComponent(post.slug)}`}
                  target="_blank"
                  className="text-[12px] text-ink-dim transition hover:text-ink-text"
                >
                  看前台
                </Link>
                <button
                  type="button"
                  onClick={() => remove(post.slug)}
                  className="text-[12px] text-ink-dim transition hover:text-rose-500"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-dim">
        保存会写回 Vault 的 md 文件并立刻重建索引；草稿不进前台列表与详情，也不参与 AI 检索。
      </p>
    </div>
  );
}
