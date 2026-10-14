'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';

export type TimelineTag = { name: string; slug: string; count: number };

const VIEW_KEY = 'town:timeline-view';

/**
 * 归档页的筛选区。
 *
 * 三件事都写进 URL（`?q=&tag=&view=`），所以是可分享、可后退的；
 * 内容本身仍由服务端按这些参数渲染，这里只负责改地址。
 * 视图偏好额外存一份 localStorage —— 分享出去的链接不该被访问者的旧偏好覆盖，
 * 但自己反复来的时候要记住上次看到哪一屏。
 */
export function TimelineControls({ tags, count }: { tags: TimelineTag[]; count: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentQ = params.get('q') ?? '';
  const activeTag = params.get('tag') ?? '';
  const category = params.get('category') ?? '';
  const view = params.get('view') === 'matrix' ? 'matrix' : 'chain';

  const [q, setQ] = useState(currentQ);

  // 地址栏被外部改动（前进/后退、点了标签）时，输入框要跟着回位
  useEffect(() => {
    setQ(currentQ);
  }, [currentQ]);

  const apply = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `/timeline?${qs}` : '/timeline', { scroll: false }));
    },
    [params, router],
  );

  // 输入防抖：每敲一个字就发一次请求会把服务端打满
  useEffect(() => {
    if (q === currentQ) return;
    const timer = setTimeout(() => apply({ q }), 320);
    return () => clearTimeout(timer);
  }, [q, currentQ, apply]);

  // URL 里没带 view 时，用本地记住的那个；避免每次进来都要手动切
  useEffect(() => {
    if (params.get('view')) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(VIEW_KEY);
    } catch {
      stored = null;
    }
    if (stored === 'matrix' || stored === 'chain') apply({ view: stored });
  }, [params, apply]);

  function pickView(next: 'chain' | 'matrix') {
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* 记不住就记不住，本次切换照常 */
    }
    apply({ view: next === 'matrix' ? 'matrix' : '' });
  }

  const filtered = currentQ !== '' || activeTag !== '' || category !== '';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-dim">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜寻被封存的知识…"
            aria-label="搜索文章"
            className="w-full rounded-full border border-ink-line bg-ink-panel/50 py-2.5 pl-10 pr-4 text-[13.5px] text-ink-text outline-none transition-colors placeholder:text-ink-dim focus:border-accent/60"
          />
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-full border border-ink-line p-1">
          {(['chain', 'matrix'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => pickView(key)}
              aria-pressed={view === key}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors duration-300 ${
                view === key
                  ? 'bg-accent/14 font-semibold text-accent-ink'
                  : 'font-medium text-ink-dim hover:text-ink-text'
              }`}
            >
              {key === 'chain' ? '中枢链路' : '矩阵网格'}
            </button>
          ))}
        </div>
      </div>

      {/* 标签条横向滚动：数量多时不能把页面撑爆 */}
      <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1.5">
        <button
          type="button"
          onClick={() => apply({ tag: '' })}
          className={`chip shrink-0 ${activeTag === '' ? 'chip-active' : ''}`}
        >
          全部档案
        </button>
        {tags.map((tag) => (
          <button
            key={tag.slug}
            type="button"
            onClick={() => apply({ tag: activeTag === tag.slug ? '' : tag.slug })}
            className={`chip shrink-0 ${activeTag === tag.slug ? 'chip-active' : ''}`}
          >
            {tag.name}
            <span className="font-mono opacity-60">{tag.count}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-[12px] text-ink-dim" aria-live="polite">
        <span className={pending ? 'opacity-60' : ''}>
          {filtered ? `筛出 ${count} 篇` : `共 ${count} 篇`}
        </span>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setQ('');
              apply({ q: '', tag: '', category: '' });
            }}
            className="rounded-full border border-ink-line px-3 py-1 text-[11.5px] transition-colors hover:border-accent/60 hover:text-ink-text"
          >
            清除筛选
          </button>
        )}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}
