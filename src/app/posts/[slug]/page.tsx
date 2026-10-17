import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CodeCopy } from '@/components/CodeCopy';
import { Lightbox } from '@/components/Lightbox';
import { RelatedPosts } from '@/components/RelatedPosts';
import { Toc } from '@/components/Toc';
import { coverVars } from '@/lib/cover';
import { extractHeadings, linkifyWikilinks, renderMarkdown } from '@/lib/markdown';
import {
  getBacklinks,
  getLinkIndex,
  getOutgoingLinks,
  getPostBySlug,
  getRelatedPosts,
  listPosts,
} from '@/lib/api';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

/** 封面用与卡片同一套分类配色，但铺满整幅——不是 .card，得自己拼那几层径向渐变 */
const COVER_BACKGROUND = [
  'radial-gradient(125% 95% at 6% -25%, rgb(var(--cover-a) / 0.72) 0%, transparent 60%)',
  'radial-gradient(95% 80% at 104% -12%, rgb(var(--cover-b) / 0.52) 0%, transparent 56%)',
  'radial-gradient(70% 60% at 78% 108%, rgb(var(--cover-a) / 0.3) 0%, transparent 62%)',
].join(',');

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(decodeURIComponent(slug));
  if (!post) return { title: '文章不存在' };

  const path = `/posts/${encodeURIComponent(post.slug)}`;
  return {
    title: post.title,
    description: post.summary,
    alternates: { canonical: path },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.summary,
      url: path,
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.updatedAt,
      tags: post.tags,
    },
  };
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPostBySlug(decodeURIComponent(slug));
  if (!post) notFound();

  const linkIndex = await getLinkIndex();
  const html = await renderMarkdown(linkifyWikilinks(post.content, linkIndex));
  const headings = extractHeadings(html);

  const [backlinks, outgoing, related] = await Promise.all([
    getBacklinks(post.slug),
    getOutgoingLinks(post.slug),
    getRelatedPosts(post.slug),
  ]);

  // 上下篇从完整列表里就地找，不额外查库：文章量很小，一次 listPosts 够用
  const all = await listPosts();
  const index = all.findIndex((item) => item.slug === post.slug);
  const newer = index > 0 ? all[index - 1] : null;
  const older = index >= 0 && index < all.length - 1 ? all[index + 1] : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.summary,
    datePublished: post.publishedAt ?? undefined,
    dateModified: post.updatedAt,
    author: { '@type': 'Person', name: site.author.name },
    publisher: { '@type': 'Organization', name: site.name },
    mainEntityOfPage: `${site.url}/posts/${encodeURIComponent(post.slug)}`,
  };

  return (
    <main className="mx-auto max-w-[1150px] px-5 pb-8 pt-8 sm:px-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <article className="animate-fade-up">
        {/* 封面 + 返回 */}
        <div
          className="relative h-[168px] overflow-hidden rounded-2xl border border-ink-line sm:h-[212px]"
          style={{ ...coverVars(post.category), backgroundImage: COVER_BACKGROUND }}
        >
          <Link
            href="/timeline"
            className="glass absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-ink-line px-3.5 py-1.5 text-[12.5px] text-ink-text transition-colors hover:border-accent/60"
          >
            <span aria-hidden>←</span> 返回归档
          </Link>
          <span className="glass absolute bottom-4 left-4 rounded-full border border-ink-line px-3 py-1 text-[11.5px] text-ink-text">
            {post.category}
          </span>
          <span className="glass absolute bottom-4 right-4 rounded-full border border-ink-line px-3 py-1 font-mono text-[11.5px] text-ink-text">
            {post.wordCount} 字
          </span>
        </div>

        <header className="mx-auto mt-8 max-w-3xl">
          <h1 className="font-serif text-[30px] font-bold leading-[1.3] tracking-wide text-ink-text sm:text-[36px]">
            {post.title}
          </h1>
          {post.summary && (
            <p className="mt-4 font-serif text-[15.5px] leading-8 text-ink-dim">{post.summary}</p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11.5px] text-ink-dim">
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-accent" />
              {post.publishedAt ?? '未标注日期'}
            </span>
            <span className="truncate opacity-70" title={post.sourcePath}>
              源文件 {post.sourcePath}
            </span>
          </div>

          {post.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {post.tags.map((tag) => (
                <Link key={tag} href={`/timeline?tag=${encodeURIComponent(tag)}`} className="chip">
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </header>

        <div className="mx-auto mt-10 grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_216px]">
          <div className="min-w-0">
            <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
            <CodeCopy key={post.slug} />
            <Lightbox />

            <nav className="mt-16 grid gap-3 border-t border-ink-line pt-8 sm:grid-cols-2" aria-label="上下篇">
              <AdjacentLink direction="older" post={older} />
              <AdjacentLink direction="newer" post={newer} />
            </nav>

            <RelatedPosts items={related} category={post.category} />

            <footer className="mt-12 grid gap-4 sm:grid-cols-2">
              <LinkPanel title="出链" hint="本文引用了" empty="未引用其他笔记" items={outgoing} />
              <LinkPanel title="反向链接" hint="引用了本文" empty="还没有笔记引用它" items={backlinks} />
            </footer>
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
  post,
}: {
  direction: 'older' | 'newer';
  post: { slug: string; title: string; category: string } | null;
}) {
  const isOlder = direction === 'older';
  if (!post) {
    return (
      <div className="rounded-2xl border border-dashed border-ink-line px-5 py-4 text-[12.5px] text-ink-dim">
        {isOlder ? '已经是最早的一篇' : '已经是最新的一篇'}
      </div>
    );
  }
  return (
    <Link
      href={`/posts/${encodeURIComponent(post.slug)}`}
      className={`card group flex flex-col px-5 py-4 ${isOlder ? '' : 'sm:text-right'}`}
    >
      <span className="font-mono text-[11px] text-ink-text/60">{isOlder ? '← 更早' : '更新 →'}</span>
      <span className="mt-2 line-clamp-2 text-[14px] font-semibold leading-6 text-ink-text">
        {post.title}
      </span>
    </Link>
  );
}

function LinkPanel({
  title,
  hint,
  empty,
  items,
}: {
  title: string;
  hint: string;
  empty: string;
  items: { slug: string; title: string }[];
}) {
  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13.5px] font-semibold text-ink-text">{title}</h2>
        <span className="font-mono text-[11.5px] text-ink-dim">
          {hint} {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-ink-dim">{empty}</p>
      ) : (
        <ul className="mt-3.5 space-y-2">
          {items.map((item) => (
            <li key={item.slug} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent/70" />
              <Link
                href={`/posts/${encodeURIComponent(item.slug)}`}
                className="text-[13px] leading-6 text-ink-text/85 transition-colors hover:text-accent-ink"
              >
                {item.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
