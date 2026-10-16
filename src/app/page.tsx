import Link from 'next/link';
import { Carousel, type CarouselItem } from '@/components/Carousel';
import { StatusCard, ThemeCard } from '@/components/HomeCards';
import { coverVars } from '@/lib/cover';
import { listMoments, listPosts } from '@/lib/api';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';

const CAROUSEL_SIZE = 5;

export default async function HomePage() {
  const [posts, moments] = await Promise.all([listPosts(), listMoments()]);

  // 轮播里的日期取到「日」即可——首页不需要精确到秒，那是归档页的事
  const postItems: CarouselItem[] = posts.slice(0, CAROUSEL_SIZE).map((post) => ({
    key: post.slug,
    href: `/posts/${encodeURIComponent(post.slug)}`,
    kicker: 'LATEST INSIGHT',
    date: post.publishedAt ?? '未标注日期',
    title: post.title,
    summary: post.summary,
    cover: coverVars(post.category),
  }));

  const photos = moments
    .flatMap((moment) => moment.images)
    .slice(0, 6);

  const stats = [
    { label: site.author.statsLabels.posts, value: posts.length },
    { label: site.author.statsLabels.moments, value: moments.length },
  ];

  return (
    <main className="mx-auto max-w-[1150px] px-5 pb-8 pt-10 sm:px-8">
      {/* 首页是一墙卡片，没有显眼的主标题——但 SEO 与读屏都需要一个 h1 */}
      <h1 className="sr-only">
        {site.name} · {site.tagline}
      </h1>

      {/* ── 第一排：资料卡 + 最新文章轮播 ───────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="lg:col-span-4" aria-label="博主资料">
          <div className="card flex h-full flex-col p-6">
            <div className="flex items-center gap-4">
              <span className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={site.author.avatar}
                  alt={site.author.name}
                  width={56}
                  height={56}
                  className="h-14 w-14 rounded-2xl border border-ink-line object-cover"
                />
                <span className="pointer-events-none absolute -inset-1.5 rounded-[1.25rem] ring-1 ring-inset ring-accent/25" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[17px] font-semibold text-ink-text">
                  {site.author.name}
                </span>
                <span className="block truncate text-[12px] text-ink-dim">{site.tagline}</span>
              </span>
            </div>

            <p className="mt-5 text-[13px] leading-6 text-ink-dim">{site.author.bio}</p>

            <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-ink-line pt-5">
              {stats.map((item) => (
                <div key={item.label}>
                  <dd className="font-mono text-[22px] font-semibold leading-none text-ink-text">
                    {item.value}
                  </dd>
                  <dt className="mt-1.5 text-[11.5px] text-ink-dim">{item.label}</dt>
                </div>
              ))}
            </dl>

            <div className="mt-auto flex items-center gap-2 pt-6">
              {site.social.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  aria-label={link.label}
                  title={link.label}
                  className="grid h-9 w-9 place-items-center rounded-full border border-ink-line text-ink-dim transition-colors duration-300 hover:border-accent/60 hover:text-accent-ink"
                >
                  <SocialIcon name={link.icon} />
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="flex flex-col lg:col-span-8" aria-label="最新文章">
          <SectionHead title="最新文章" href="/timeline" linkText="全部归档" />
          {postItems.length > 0 ? (
            <Carousel items={postItems} label="最新文章轮播" fill />
          ) : (
            <EmptyHint text="还没有文章，先运行 npm run setup 导入示例 Vault。" />
          )}
        </section>
      </div>

      {/* ── 第二排：状态 / 主题 / 说说 ─────────────────────── */}
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <StatusCard />
        <ThemeCard />

        <section className="card flex flex-col p-6" aria-label="说说精选">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-[10.5px] tracking-[0.3em] text-ink-dim">MOMENTS</p>
            <Link href="/moments" className="text-[11.5px] text-ink-dim transition-colors hover:text-accent-ink">
              全部说说 →
            </Link>
          </div>

          {photos.length > 0 ? (
            <div className="mt-4 grid grid-cols-3 gap-1.5">
              {photos.map((src) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={src}
                  src={src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full rounded-lg border border-ink-line object-cover"
                />
              ))}
            </div>
          ) : (
            <p className="mt-4 text-[12.5px] text-ink-dim">还没有带图的说说。</p>
          )}

          <p className="mt-auto pt-4 text-[12px] text-ink-dim">
            共 <span className="font-mono text-ink-text">{moments.length}</span> 条动态
          </p>
        </section>
      </div>
    </main>
  );
}

function SectionHead({ title, href, linkText }: { title: string; href: string; linkText: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="text-[15.5px] font-semibold tracking-wide text-ink-text">{title}</h2>
      <Link href={href} className="shrink-0 text-[12px] text-ink-dim transition-colors hover:text-accent-ink">
        {linkText} →
      </Link>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-line p-10 text-center text-[13px] text-ink-dim">
      {text}
    </div>
  );
}

function SocialIcon({ name }: { name: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (name === 'github') {
    return (
      <svg {...common} aria-hidden>
        <path d="M9 19c-4 1.3-4-2.2-6-2.7m12 5v-3.6a3 3 0 0 0-.8-2.3c2.7-.3 5.5-1.3 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.7 11.7 0 0 0-6.2 0C6.3 2.9 5.3 3.2 5.3 3.2a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.9 9.6c0 4.6 2.8 5.7 5.5 6a3 3 0 0 0-.8 2.3V21" />
      </svg>
    );
  }
  if (name === 'rss') {
    return (
      <svg {...common} aria-hidden>
        <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
        <circle cx="5" cy="19" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  );
}
