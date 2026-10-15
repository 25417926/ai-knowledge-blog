import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CodeCopy } from '@/components/CodeCopy';
import { Lightbox } from '@/components/Lightbox';
import { Toc } from '@/components/Toc';
import { getChatter, listChatter } from '@/lib/api';
import { coverVars } from '@/lib/cover';
import { extractHeadings, renderMarkdown } from '@/lib/markdown';
import { MOODS } from '@/lib/moods';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const item = await getChatter(decodeURIComponent(slug));
  if (!item) return { title: '杂谈不存在' };
  return {
    title: item.title,
    description: item.excerpt,
    alternates: { canonical: `/chatter/${encodeURIComponent(item.slug)}` },
    openGraph: {
      type: 'article',
      title: item.title,
      description: item.excerpt,
      publishedTime: item.publishedAt ?? undefined,
    },
  };
}

export default async function ChatterDetailPage({ params }: Props) {
  const { slug } = await params;
  const item = await getChatter(decodeURIComponent(slug));
  if (!item) notFound();

  const html = await renderMarkdown(item.content);
  const headings = extractHeadings(html);

  const all = await listChatter();
  const index = all.findIndex((entry) => entry.slug === item.slug);
  const newer = index > 0 ? all[index - 1] : null;
  const older = index >= 0 && index < all.length - 1 ? all[index + 1] : null;

  const mood = MOODS[item.mood];

  return (
    <main className="mx-auto max-w-[1150px] px-5 pb-8 pt-8 sm:px-8">
      <article className="animate-fade-up">
        <div
          className="relative h-[150px] overflow-hidden rounded-2xl border border-ink-line sm:h-[186px]"
          style={{
            ...coverVars(item.mood),
            backgroundImage:
              'radial-gradient(125% 95% at 6% -25%, rgb(var(--cover-a) / 0.72) 0%, transparent 60%), radial-gradient(95% 80% at 104% -12%, rgb(var(--cover-b) / 0.52) 0%, transparent 56%)',
          }}
        >
          <Link
            href="/chatter"
            className="glass absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-ink-line px-3.5 py-1.5 text-[12.5px] text-ink-text transition-colors hover:border-accent/60"
          >
            <span aria-hidden>←</span> 返回杂谈
          </Link>
          <span className="glass absolute bottom-4 left-4 flex items-center gap-1.5 rounded-full border border-ink-line px-3 py-1 text-[11.5px] text-ink-text">
            <span className={`h-1.5 w-1.5 rounded-full ${mood.dot}`} />
            {mood.label}
          </span>
          <span className="glass absolute bottom-4 right-4 rounded-full border border-ink-line px-3 py-1 font-mono text-[11.5px] text-ink-text">
            {item.wordCount} 字
          </span>
        </div>

        <header className="mx-auto mt-8 max-w-3xl">
          <h1 className="font-serif text-[28px] font-bold leading-[1.32] tracking-wide text-ink-text sm:text-[33px]">
            {item.title}
          </h1>
          {item.excerpt && (
            <p className="mt-4 font-serif text-[15.5px] leading-8 text-ink-dim">{item.excerpt}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11.5px] text-ink-dim">
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-accent" />
              {item.publishedAt ?? '未标注日期'}
            </span>
          </div>
          {item.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {item.tags.map((tag) => (
                <Link key={tag} href={`/chatter?tag=${encodeURIComponent(tag)}`} className="chip">
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </header>

        <div className="mx-auto mt-10 grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_216px]">
          <div className="min-w-0">
            <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
            <CodeCopy key={item.slug} />
            <Lightbox />

            <nav className="mt-16 grid gap-3 border-t border-ink-line pt-8 sm:grid-cols-2" aria-label="上下篇">
              <AdjacentLink direction="older" item={older} />
              <AdjacentLink direction="newer" item={newer} />
            </nav>
          </div>

          <aside className="order-first lg:order-none">
            <Toc items={headings} />
          </aside>
        </div>
      </article>
    </main>
  );
}

function AdjacentLink({
  direction,
  item,
}: {
  direction: 'older' | 'newer';
  item: { slug: string; title: string } | null;
}) {
  const isOlder = direction === 'older';
  if (!item) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-line px-5 py-4 text-[12.5px] text-ink-dim">
        {isOlder ? '已经是最早的一篇' : '已经是最新的一篇'}
      </div>
    );
  }
  return (
    <Link
      href={`/chatter/${encodeURIComponent(item.slug)}`}
      className={`card group flex flex-col px-5 py-4 ${isOlder ? '' : 'sm:text-right'}`}
    >
      <span className="font-mono text-[11px] text-ink-text/60">{isOlder ? '← 更早' : '更新 →'}</span>
      <span className="mt-2 line-clamp-2 text-[14px] font-semibold leading-6 text-ink-text">
        {item.title}
      </span>
    </Link>
  );
}
