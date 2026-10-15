import type { Metadata } from 'next';
import Link from 'next/link';
import { TimelineControls } from '@/components/TimelineControls';
import { coverVars } from '@/lib/cover';
import { listPosts, listTags, type PostListItem } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '归档与探索',
  description: '按时间和标签检索全部文章——可在「中枢链路」时间线与「矩阵网格」之间切换。',
};

type Search = { q?: string; tag?: string; category?: string; view?: string };

/** '2026-10-01' → '2026 年 10 月'；缺日期归到一组，不假装知道时间 */
function monthLabel(publishedAt: string | null): string {
  if (!publishedAt || publishedAt.length < 7) return '未标注日期';
  const [year, month] = publishedAt.split('-');
  return `${year} 年 ${Number(month)} 月`;
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const view = sp.view === 'matrix' ? 'matrix' : 'chain';
  const category = (sp.category ?? '').trim();

  const tags = await listTags();
  // 标签既收 slug 也收名字：旧地址带的是名字，标签条上的链接是 slug，两种都得认
  const rawTag = (sp.tag ?? '').trim();
  const tag = tags.find((item) => item.slug === rawTag || item.name === rawTag)?.slug ?? rawTag;

  const posts = await listPosts({ q, tag, category });

  // 按年月分组，组内保持 listPosts 的倒序；Map 保序，省一次排序
  const groups = new Map<string, PostListItem[]>();
  for (const post of posts) {
    const key = post.publishedAt?.slice(0, 7) ?? 'none';
    const bucket = groups.get(key);
    if (bucket) bucket.push(post);
    else groups.set(key, [post]);
  }

  return (
    <main className="mx-auto max-w-[1150px] px-5 pb-8 pt-12 sm:px-8">
      <header className="mb-8">
        <h1 className="font-serif text-[30px] font-semibold tracking-wide text-ink-text sm:text-[36px]">
          归档与探索
        </h1>
        <p className="mt-3 max-w-2xl text-[13.5px] leading-7 text-ink-dim">
          所有写过的都在这里，按时间倒序排。"中枢链路"看节奏，"矩阵网格"看全貌。
        </p>
      </header>

      <TimelineControls tags={tags} count={posts.length} />

      <div className="mt-10">
        {posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-line p-14 text-center">
            <p className="text-[14px] text-ink-text">没有匹配的档案</p>
            <p className="mt-2 text-[12.5px] text-ink-dim">换个关键词，或者清掉标签筛选再试。</p>
          </div>
        ) : view === 'matrix' ? (
          <MatrixView posts={posts} />
        ) : (
          <ChainView groups={groups} />
        )}
      </div>
    </main>
  );
}

/** 中枢链路：左侧一条竖线串起年月，右侧是这一月写的文章 */
function ChainView({ groups }: { groups: Map<string, PostListItem[]> }) {
  return (
    <div className="space-y-12">
      {[...groups.entries()].map(([key, items]) => (
        <section key={key} className="relative">
          <div className="mb-5 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <h2 className="font-mono text-[13px] tracking-[0.18em] text-ink-text">
              {monthLabel(key === 'none' ? null : `${key}-01`)}
            </h2>
            <span className="h-px flex-1 bg-ink-line" />
            <span className="font-mono text-[11px] text-ink-dim">{items.length} 篇</span>
          </div>

          <ul className="relative space-y-2 pl-6 sm:pl-8">
            {/* 竖线单独画：border-l 在暗色里几乎看不见，用一层显式的细线更稳 */}
            <span aria-hidden className="absolute bottom-3 left-0 top-3 w-px bg-ink-line" />
            {items.map((post) => (
              <li key={post.slug} className="relative">
                {/* 钉在竖线上的节点：偏移量按 pl-6/sm:pl-8 反算，让圆心正好落在线上 */}
                <span className="absolute -left-[28px] top-[26px] h-2 w-2 rounded-full bg-accent ring-2 ring-ink-bg sm:-left-[36px]" />
                <Link
                  href={`/posts/${encodeURIComponent(post.slug)}`}
                  className="group block rounded-2xl px-4 py-4 transition-colors duration-300 hover:bg-ink-panel/60"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-ink-dim">
                    <span className="font-mono tabular-nums">{post.publishedAt ?? '未标注'}</span>
                    <span className="rounded-full border border-ink-line px-2 py-0.5">{post.category}</span>
                    <span className="font-mono opacity-70">{post.wordCount} 字</span>
                  </div>
                  <h3 className="mt-2 text-[16.5px] font-semibold leading-snug text-ink-text transition-colors duration-300 group-hover:text-accent-ink">
                    {post.title}
                  </h3>
                  {post.summary && (
                    <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-ink-dim">{post.summary}</p>
                  )}
                  {post.tags.length > 0 && (
                    <p className="mt-2.5 text-[11.5px] text-ink-dim/80">
                      {post.tags.slice(0, 5).map((t) => `#${t}`).join('  ')}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** 矩阵网格：高密度卡片，一眼扫完整站内容 */
function MatrixView({ posts }: { posts: PostListItem[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((post, i) => (
        <Link
          key={post.slug}
          href={`/posts/${encodeURIComponent(post.slug)}`}
          className="card group flex min-h-[196px] flex-col p-5 animate-fade-up"
          style={{ ...coverVars(post.category), animationDelay: `${Math.min(i, 8) * 50}ms` }}
        >
          <div className="flex items-center justify-between gap-2 text-[11px] text-ink-text/65">
            <span className="font-mono tabular-nums">{post.publishedAt ?? '未标注'}</span>
            <span className="rounded-full border border-ink-text/20 px-2 py-0.5">{post.category}</span>
          </div>

          <h3 className="mt-3.5 line-clamp-2 text-[16px] font-semibold leading-snug text-ink-text">
            {post.title}
          </h3>
          {post.summary && (
            <p className="mt-2 line-clamp-3 text-[12.5px] leading-6 text-ink-text/75">{post.summary}</p>
          )}

          <div className="mt-auto flex items-center justify-between pt-4 text-[11px] text-ink-text/65">
            <span className="truncate">{post.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}</span>
            <span className="shrink-0 font-mono">{post.wordCount} 字</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
