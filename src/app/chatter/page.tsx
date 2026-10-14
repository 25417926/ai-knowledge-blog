import type { Metadata } from 'next';
import Link from 'next/link';
import { ChatterControls } from '@/components/ChatterControls';
import { PageHeader } from '@/components/PageHeader';
import { listChatter, listChatterTags } from '@/lib/chatter';
import { coverVars } from '@/lib/cover';
import { isMood, MOODS } from '@/lib/moods';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '杂谈',
  description: '非正式随笔：写代码之外的事，以及写代码时的心情。',
};

type Search = { q?: string; mood?: string; tag?: string };

export default async function ChatterPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const rawMood = (sp.mood ?? '').trim();
  const mood = isMood(rawMood) ? rawMood : '';
  const tag = (sp.tag ?? '').trim();

  const items = listChatter({ q, mood, tag });
  const tags = listChatterTags();

  return (
    <main className="mx-auto max-w-[1150px] px-5 pb-8 pt-12 sm:px-8">
      <PageHeader
        kicker="RECORDS"
        title="杂谈"
        description="不像文章那么讲究结构。写着写着心情就变了，所以每篇都标了当时的情绪。"
      />

      <ChatterControls tags={tags} count={items.length} />

      <div className="mt-10">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-line p-14 text-center">
            <p className="text-[14px] text-ink-text">没有匹配的杂谈</p>
            <p className="mt-2 text-[12.5px] text-ink-dim">换个关键词或情绪再试。</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, i) => (
              <Link
                key={item.slug}
                href={`/chatter/${encodeURIComponent(item.slug)}`}
                className="card group flex min-h-[210px] flex-col p-5 animate-fade-up"
                style={{ ...coverVars(item.mood), animationDelay: `${Math.min(i, 8) * 50}ms` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`chip ${MOODS[item.mood].chip}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${MOODS[item.mood].dot}`} />
                    {MOODS[item.mood].label}
                  </span>
                  <span className="font-mono text-[11px] text-ink-text/65">
                    {item.publishedAt ?? '未标注'}
                  </span>
                </div>

                <h2 className="mt-3.5 line-clamp-2 text-[16px] font-semibold leading-snug text-ink-text">
                  {item.title}
                </h2>
                <p className="mt-2 line-clamp-3 text-[12.5px] leading-6 text-ink-text/75">
                  {item.excerpt}
                </p>

                <div className="mt-auto flex items-center justify-between pt-4 text-[11px] text-ink-text/65">
                  <span className="truncate">{item.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}</span>
                  <span className="shrink-0 font-mono">{item.wordCount} 字</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
