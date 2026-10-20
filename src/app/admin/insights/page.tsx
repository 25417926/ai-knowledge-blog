'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminError, adminInsights, type AdminInsights } from '@/lib/admin';

const WINDOWS = [
  { label: '全部', days: 0 },
  { label: '近 30 天', days: 30 },
  { label: '近 7 天', days: 7 },
];

function stamp(value: string) {
  return value ? value.slice(0, 16) : '—';
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

/** 引用率着色：0 引用是最要紧的信号，用玫瑰色，别让它混在一堆灰字里。 */
function rateClass(value: number) {
  if (value <= 0) return 'text-rose-500';
  if (value < 0.6) return 'text-ink-dim';
  return 'text-accent-ink';
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink-line bg-ink-panel/60 p-4">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-[13px] font-medium text-ink-text">{title}</h2>
        {hint && <span className="text-[11px] text-ink-dim">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

export default function AdminInsightsPage() {
  const [days, setDays] = useState(0);
  const [data, setData] = useState<AdminInsights | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setBusy(true);
    return adminInsights(days)
      .then((res) => {
        setData(res);
        setError('');
      })
      .catch((err) => setError(err instanceof AdminError ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data?.totals;
  const range = data?.window;
  const empty = !busy && data !== null && (data.window.questions ?? 0) === 0;
  const maxShare = Math.max(...(data?.intents.map((i) => i.share) ?? [0]), 0.01);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-medium text-ink-text">访客意图</h1>
          <p className="mt-1 text-[12px] text-ink-dim">
            {range && range.questions > 0
              ? `${range.questions} 次提问 · ${range.sessions} 个会话 · ${stamp(range.from)} → ${stamp(range.to)}`
              : '还没有访客提问'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-xl border border-ink-line">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                type="button"
                onClick={() => setDays(w.days)}
                className={`px-3 py-2 text-[12px] transition ${
                  days === w.days
                    ? 'bg-accent/10 text-accent-ink'
                    : 'text-ink-dim hover:text-ink-text'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="rounded-xl border border-ink-line px-3.5 py-2 text-[12px] text-ink-text transition hover:border-accent disabled:opacity-40"
          >
            刷新
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3.5 py-2 text-[12px] text-rose-500">
          {error}
        </p>
      )}

      {busy && !data && <p className="py-8 text-center text-[12px] text-ink-dim">加载中…</p>}

      {empty && (
        <p className="rounded-2xl border border-ink-line bg-ink-panel/60 px-4 py-10 text-center text-[12px] text-ink-dim">
          这个窗口里还没有提问。去前台问一句，回到这里刷新就能看到它归到了哪个意图。
        </p>
      )}

      {totals && totals.questions > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: '提问', value: String(totals.questions), hint: `${range?.sessions ?? 0} 个会话` },
              {
                label: '有引用',
                value: pct(totals.citationRate),
                hint: `${totals.withCitation} / ${totals.questions} 次答上了`,
              },
              {
                label: '零引用',
                value: String(totals.zeroCitation),
                hint: '含寒暄，缺口清单已排除',
              },
              {
                label: '平均响应',
                value: totals.avgLatencyMs ? `${(totals.avgLatencyMs / 1000).toFixed(1)}s` : '—',
                hint: `平均 ${totals.avgCitations} 段引用`,
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-2xl border border-ink-line bg-ink-panel/60 px-4 py-3"
              >
                <p className="text-[11px] text-ink-dim">{card.label}</p>
                <p className="mt-1 text-[20px] font-medium text-ink-text">{card.value}</p>
                <p className="mt-0.5 text-[10px] text-ink-dim opacity-80">{card.hint}</p>
              </div>
            ))}
          </div>

          <Section title="意图分布" hint="按提问措辞分流，一句话只归一类">
            <ul className="space-y-2">
              {data.intents.map((intent) => (
                <li
                  key={intent.key}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
                  title={intent.samples.join(' / ')}
                >
                  <span className="w-[68px] shrink-0 text-[12px] text-ink-text">{intent.label}</span>
                  {/* 窄屏时条形独占一行：390px 下 68+92+54 已经把宽度吃光了 */}
                  <span className="order-last h-2 w-full overflow-hidden rounded-full bg-ink-soft sm:order-none sm:w-auto sm:flex-1">
                    <span
                      className="block h-full rounded-full bg-accent/60"
                      style={{ width: `${Math.max(4, (intent.share / maxShare) * 100)}%` }}
                    />
                  </span>
                  <span className="w-[88px] shrink-0 text-right text-[11px] text-ink-dim">
                    {intent.count} 次 · {pct(intent.share)}
                  </span>
                  <span
                    className={`w-[50px] shrink-0 text-right text-[11px] ${rateClass(intent.citationRate)}`}
                    title="这一类问题里有引用的比例"
                  >
                    {pct(intent.citationRate)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="被问最多的问题" hint="说法不同的同一件事已经并成一条">
            {data.clusters.length === 0 ? (
              <p className="py-2 text-[12px] text-ink-dim">没有内容类问题（只有寒暄）</p>
            ) : (
              <ul className="space-y-2.5">
                {data.clusters.map((item, i) => (
                  <li
                    key={`${item.question}-${i}`}
                    className="rounded-xl border border-ink-line bg-ink-soft/60 px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className="text-[13px] text-ink-text">{item.question}</span>
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent-ink">
                        × {item.count}
                      </span>
                      <span className="text-[10px] text-ink-dim">{item.intentLabel}</span>
                      <span className={`text-[10px] ${rateClass(item.citationRate)}`}>
                        引用率 {pct(item.citationRate)}
                      </span>
                      <span className="ml-auto text-[10px] text-ink-dim">
                        最近 {stamp(item.lastAskedAt)}
                      </span>
                    </div>

                    {item.variants.length > 0 && (
                      <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-ink-dim">
                        也问成：{item.variants.join(' / ')}
                      </p>
                    )}

                    {item.posts.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {item.posts.map((post) => (
                          <Link
                            key={post.slug}
                            href={`/posts/${encodeURIComponent(post.slug)}`}
                            className="rounded-full border border-ink-line px-2 py-0.5 text-[10px] text-ink-dim transition hover:border-accent hover:text-accent-ink"
                          >
                            《{post.title}》
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="内容缺口"
            hint="问了、但一段原文都没引到的信息类问题（寒暄不计）"
          >
            {data.gaps.length === 0 ? (
              <p className="py-2 text-[12px] text-ink-dim">
                没有缺口：这个窗口里的信息类提问都找到了出处。
              </p>
            ) : (
              <ul className="divide-y divide-ink-line">
                {data.gaps.map((gap, i) => (
                  <li
                    key={`${gap.question}-${i}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="text-[12.5px] text-ink-text">{gap.question}</span>
                    <span className="text-[10px] text-ink-dim">{gap.intentLabel}</span>
                    {gap.times > 1 && (
                      <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-500">
                        问了 {gap.times} 次
                      </span>
                    )}
                    {gap.variants.length > 0 && (
                      <span className="text-[10px] text-ink-dim opacity-80">
                        也问成 {gap.variants[0]}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-3 text-[10px] text-ink-dim">
                      <span>{stamp(gap.lastAskedAt)}</span>
                      <Link
                        href={`/admin/posts/new?title=${encodeURIComponent(gap.question)}`}
                        className="rounded-lg border border-accent/40 px-2 py-0.5 text-accent-ink transition hover:bg-accent/10"
                      >
                        为它写一篇
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="被问到的文章" hint="按「被几次问答引用」排，不是引用段数">
            {data.posts.length === 0 ? (
              <p className="py-2 text-[12px] text-ink-dim">还没有引用记录</p>
            ) : (
              <ol className="space-y-1.5">
                {data.posts.map((post, i) => (
                  <li key={post.slug} className="flex items-baseline gap-3">
                    <span className="w-5 shrink-0 text-right text-[11px] text-ink-dim opacity-70">
                      {i + 1}
                    </span>
                    <Link
                      href={`/posts/${encodeURIComponent(post.slug)}`}
                      className="truncate text-[12px] text-ink-text transition hover:text-accent-ink"
                    >
                      {post.title}
                    </Link>
                    <span className="ml-auto shrink-0 text-[10px] text-ink-dim">
                      {post.questions} 次问答 · {post.citations} 段
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <p className="text-[10.5px] leading-relaxed text-ink-dim opacity-70">
            聚合口径：同一件事的说法按「词重叠 ≥ 0.5 且意图相同」并为一条，所以「向量怎么接」与
            「怎么接向量」算一次，「怎么做 X」与「为什么 X」算两次；零引用只收信息类问题，
            寒暄（你好 / 谢谢）不进缺口清单。
          </p>
        </>
      )}
    </div>
  );
}
