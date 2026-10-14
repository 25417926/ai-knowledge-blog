import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  title: '关于',
  description: site.author.bio,
};

/** 关于页：自我介绍、时间线、技能栈、兴趣、联系方式 */
export default function AboutPage() {
  const { about, author, social } = site;

  return (
    <main className="mx-auto max-w-[1150px] px-5 pb-8 pt-12 sm:px-8">
      <PageHeader kicker="ABOUT ME" title="关于" description={about.headline} />

      <div className="grid gap-5 lg:grid-cols-12">
        {/* 名片 */}
        <aside className="lg:col-span-4">
          <div className="card sticky top-24 flex flex-col p-6">
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={author.avatar}
                alt={author.name}
                width={64}
                height={64}
                className="h-16 w-16 rounded-2xl border border-ink-line object-cover"
              />
              <div className="min-w-0">
                <p className="text-[17px] font-semibold text-ink-text">{author.name}</p>
                <p className="text-[12px] text-ink-dim">{site.tagline}</p>
              </div>
            </div>

            <dl className="mt-6 space-y-3 border-t border-ink-line pt-5 text-[12.5px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-dim">邮箱</dt>
                <dd className="truncate font-mono text-ink-text">hello@example.com</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-dim">城市</dt>
                <dd className="text-ink-text">中国 · 杭州</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-dim">状态</dt>
                <dd className="flex items-center gap-1.5 text-ink-text">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-twinkle" />
                  {site.status.label}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex items-center gap-2 pt-1">
              {social.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="rounded-full border border-ink-line px-3 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent/60 hover:text-accent-ink"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </aside>

        <div className="space-y-5 lg:col-span-8">
          <section className="card p-6 sm:p-7">
            <h2 className="font-mono text-[10.5px] tracking-[0.3em] text-ink-dim">WHO I AM</h2>
            <div className="mt-4 space-y-4">
              {about.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 12)} className="text-[14px] leading-8 text-ink-text/90">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>

          <section className="card p-6 sm:p-7">
            <h2 className="font-mono text-[10.5px] tracking-[0.3em] text-ink-dim">TIMELINE</h2>
            <ol className="mt-5 border-l border-ink-line pl-6">
              {about.timeline.map((entry) => (
                <li key={`${entry.year}-${entry.title}`} className="relative pb-6 last:pb-0">
                  <span className="absolute -left-[27px] top-1.5 h-2 w-2 rounded-full border border-ink-bg bg-accent" />
                  <p className="font-mono text-[11.5px] tracking-widest text-accent-ink">{entry.year}</p>
                  <p className="mt-1.5 text-[14.5px] font-semibold text-ink-text">{entry.title}</p>
                  <p className="mt-1 text-[12.5px] leading-6 text-ink-dim">{entry.detail}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="card p-6 sm:p-7">
            <h2 className="font-mono text-[10.5px] tracking-[0.3em] text-ink-dim">SKILLS</h2>
            <div className="mt-5 space-y-4">
              {about.skills.map((group) => (
                <div key={group.group}>
                  <p className="text-[12px] text-ink-dim">{group.group}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {group.items.map((item) => (
                      <span key={item} className="chip">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-6 sm:p-7">
            <h2 className="font-mono text-[10.5px] tracking-[0.3em] text-ink-dim">ELSEWHERE</h2>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {about.interests.map((item) => (
                <span key={item} className="chip">
                  {item}
                </span>
              ))}
            </div>
            <p className="mt-6 text-[12.5px] leading-6 text-ink-dim">
              想看写的东西，可以直接去{' '}
              <Link href="/timeline" className="text-accent-ink underline decoration-dotted">
                归档
              </Link>
              ；想问我点什么，右下角的助手知道这座站里所有内容。
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
