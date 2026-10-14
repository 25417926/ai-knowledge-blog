'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { MOODS, MOOD_KEYS } from '@/lib/moods';

/**
 * 杂谈的筛选区：搜索 + 情绪 + 标签。
 *
 * 与归档页同一套路子——条件全写进 URL，内容由服务端按条件渲染。
 * 情绪用的是主题色以外的固定色（见 lib/chatter.ts），点上去要一眼能分辨。
 */
export function ChatterControls({
  tags,
  count,
}: {
  tags: { name: string; count: number }[];
  count: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const currentQ = params.get('q') ?? '';
  const activeMood = params.get('mood') ?? '';
  const activeTag = params.get('tag') ?? '';

  const [q, setQ] = useState(currentQ);

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
      startTransition(() => router.replace(qs ? `/chatter?${qs}` : '/chatter', { scroll: false }));
    },
    [params, router],
  );

  useEffect(() => {
    if (q === currentQ) return;
    const timer = setTimeout(() => apply({ q }), 320);
    return () => clearTimeout(timer);
  }, [q, currentQ, apply]);

  const filtered = currentQ !== '' || activeMood !== '' || activeTag !== '';

  return (
    <div className="space-y-4">
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim">
          <SearchIcon />
        </span>
        <input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="搜杂谈的标题或正文…"
          aria-label="搜索杂谈"
          className="w-full rounded-full border border-ink-line bg-ink-panel/50 py-2.5 pl-11 pr-4 text-[13.5px] text-ink-text outline-none transition-colors placeholder:text-ink-dim focus:border-accent/60"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => apply({ mood: '' })}
          className={`chip ${activeMood === '' ? 'chip-active' : ''}`}
        >
          全部情绪
        </button>
        {MOOD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => apply({ mood: activeMood === key ? '' : key })}
            className={`chip ${activeMood === key ? MOODS[key].chip : ''}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${MOODS[key].dot}`} />
            {MOODS[key].label}
          </button>
        ))}
      </div>

      <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1.5">
        <button
          type="button"
          onClick={() => apply({ tag: '' })}
          className={`chip shrink-0 ${activeTag === '' ? 'chip-active' : ''}`}
        >
          全部标签
        </button>
        {tags.map((tag) => (
          <button
            key={tag.name}
            type="button"
            onClick={() => apply({ tag: activeTag === tag.name ? '' : tag.name })}
            className={`chip shrink-0 ${activeTag === tag.name ? 'chip-active' : ''}`}
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
              apply({ q: '', mood: '', tag: '' });
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
