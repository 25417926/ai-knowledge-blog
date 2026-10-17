import Link from 'next/link';
import { coverVars } from '@/lib/cover';
import { categoryLabel } from '@/lib/categoryLabel';
import type { CategoryRow, PostListItem } from '@/lib/api';

/**
 * 首页的「主题导览」。
 *
 * 首页原本只有一墙卡片：最新文章轮播 + 说说照片。访客进门知道「有什么新东西」，
 * 但不知道「这里在讲什么、我该从哪读」。这块就是补那一半——
 * 按分类把站内内容摊开，并且给全站索引那篇笔记一个独立的主入口。
 *
 * 数据全部来自已渲染的 posts，不额外查库：文章量小，一次 listPosts 全量分组够用。
 */

/** 承载全站索引的那篇笔记所属分类——它本身就是导航，单独做主入口，不进主题网格 */
const MOC_CATEGORY = '知识地图';

/** 每个主题最多铺几篇标题；再多只给一个计数出口，不把卡片撑高 */
const MAX_TITLES = 4;

export function TopicGuide({
  categories,
  posts,
}: {
  categories: CategoryRow[];
  posts: PostListItem[];
}) {
  const moc = posts.find((post) => post.category === MOC_CATEGORY) ?? null;

  const topics = categories
    .filter((row) => row.category !== MOC_CATEGORY)
    .map((row) => ({ ...row, items: posts.filter((post) => post.category === row.category) }))
    .filter((row) => row.items.length > 0);

  // 内容为空（刚建站、还没导库）时整块不出现，不留一个空壳
  if (!moc && topics.length === 0) return null;

  return (
    <section className="mt-10" aria-label="主题导览">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[10.5px] tracking-[0.3em] text-ink-dim">TOPIC GUIDE</span>
          <h2 className="text-[15.5px] font-semibold tracking-wide text-ink-text">不知从哪读？按主题进</h2>
        </div>
        <Link
          href="/timeline"
          className="shrink-0 text-[12px] text-ink-dim transition-colors hover:text-accent-ink"
        >
          全部归档 →
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        {moc && <MocCard post={moc} />}

        <div className={moc ? 'lg:col-span-8' : 'lg:col-span-12'}>
          <div className="grid gap-4 sm:grid-cols-2">
            {topics.map((topic) => (
              <TopicCard key={topic.category} category={topic.category} count={topic.count} items={topic.items} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** 全站索引的主入口：单独一张竖卡，和主题卡区分开 */
function MocCard({ post }: { post: PostListItem }) {
  return (
    <section className="lg:col-span-4" aria-label="全站索引">
      <Link
        href={`/posts/${encodeURIComponent(post.slug)}`}
        className="card group flex h-full flex-col p-6"
        style={coverVars(post.category)}
      >
        <span className="font-mono text-[10.5px] tracking-[0.3em] text-ink-text/70">START HERE</span>

        <h3 className="mt-3 font-serif text-[21px] font-semibold leading-snug tracking-wide text-ink-text">
          {post.title}
        </h3>

        {post.summary && (
          <p className="mt-3 text-[13px] leading-6 text-ink-text/80">{post.summary}</p>
        )}

        {post.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {post.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-ink-text/25 px-2.5 py-0.5 text-[11px] text-ink-text/75"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <p className="mt-4 text-[12px] leading-6 text-ink-text/70">
          三条主线各成体系，进去顺着双链往下读就行。
        </p>

        <span className="mt-auto pt-6 text-[12.5px] font-medium text-ink-text transition-colors group-hover:text-accent-ink">
          打开全站索引 →
        </span>
      </Link>
    </section>
  );
}

/** 一个主题：分类名 + 篇数 + 该主题下最直接的几篇文章 */
function TopicCard({
  category,
  count,
  items,
}: {
  category: string;
  count: number;
  items: PostListItem[];
}) {
  const shown = items.slice(0, MAX_TITLES);
  const rest = count - shown.length;
  const label = categoryLabel(category);

  return (
    <section className="card flex flex-col p-5" style={coverVars(category)} aria-label={`主题 ${label}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-ink-text">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-ink-text/70" />
          <span className="truncate">{label}</span>
        </h3>
        <span className="shrink-0 font-mono text-[11px] text-ink-text/70">{count} 篇</span>
      </div>

      <ul className="mt-3.5 space-y-2">
        {shown.map((post) => (
          <li key={post.slug} className="flex gap-2">
            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-text/45" />
            <Link
              href={`/posts/${encodeURIComponent(post.slug)}`}
              className="line-clamp-1 text-[13px] leading-6 text-ink-text/85 transition-colors hover:text-accent-ink"
              title={post.title}
            >
              {post.title}
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center gap-3 pt-4 text-[11.5px]">
        <Link
          href={`/timeline?category=${encodeURIComponent(category)}`}
          className="font-medium text-ink-text/75 transition-colors hover:text-accent-ink"
        >
          进入主题 →
        </Link>
        {rest > 0 && <span className="font-mono text-ink-text/55">还有 {rest} 篇</span>}
      </div>
    </section>
  );
}
