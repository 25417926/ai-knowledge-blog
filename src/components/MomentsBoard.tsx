'use client';

import { useMemo, useState } from 'react';
import { Lightbox } from '@/components/Lightbox';
import type { Moment } from '@/lib/moments';

/** 宫格数按图片数量自适应：1 张横构图、2/4 张两列、其余三列 */
function gridClass(count: number): string {
  if (count === 1) return 'grid-cols-1';
  if (count === 2 || count === 4) return 'grid-cols-2';
  return 'grid-cols-3';
}

/**
 * 说说流。
 *
 * 排序与搜索都放在客户端：动态条数不多，一次全给到前端最省事，
 * 切换排序时不用等服务端重渲染，「倒序/正序」这种开关体感最重要。
 */
export function MomentsBoard({ moments }: { moments: Moment[] }) {
  const [q, setQ] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);
  const keyword = q.trim().toLowerCase();

  const visible = useMemo(() => {
    const matched = keyword
      ? moments.filter((moment) =>
          `${moment.content} ${moment.location}`.toLowerCase().includes(keyword),
        )
      : moments;
    // 后端已经是倒序，正序就地翻转即可，不必再排一次
    return newestFirst ? matched : [...matched].reverse();
  }, [moments, keyword, newestFirst]);

  return (
    <>
      {/* 图片点开大图，复用文章页那个灯箱 */}
      <Lightbox selector=".moments-stream" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim">
            <SearchIcon />
          </span>
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜动态内容或地点…"
            aria-label="搜索说说"
            className="w-full rounded-full border border-ink-line bg-ink-panel/50 py-2.5 pl-11 pr-4 text-[13.5px] text-ink-text outline-none transition-colors placeholder:text-ink-dim focus:border-accent/60"
          />
        </div>

        <button
          type="button"
          onClick={() => setNewestFirst((value) => !value)}
          aria-pressed={!newestFirst}
          className="shrink-0 rounded-full border border-ink-line px-4 py-2.5 text-[12.5px] text-ink-dim transition-colors hover:border-accent/60 hover:text-ink-text"
        >
          {newestFirst ? '最新在前 ↓' : '最早在前 ↑'}
        </button>
      </div>

      <p className="mt-4 text-[12px] text-ink-dim" aria-live="polite">
        共 {visible.length} 条动态
      </p>

      {visible.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-ink-line p-14 text-center">
          <p className="text-[14px] text-ink-text">没有匹配的动态</p>
          <p className="mt-2 text-[12.5px] text-ink-dim">换个关键词试试。</p>
        </div>
      ) : (
        <ul className="moments-stream mt-8 space-y-6">
          {visible.map((moment) => (
            <li key={moment.id}>
              <article className="card p-5 sm:p-6">
                <div className="flex items-center gap-3 text-[11.5px] text-ink-dim">
                  <span className="font-mono tabular-nums">{moment.publishedAt ?? '未标注'}</span>
                  {moment.location && (
                    <span className="flex items-center gap-1">
                      <PinIcon />
                      {moment.location}
                    </span>
                  )}
                </div>

                {moment.content && (
                  <p className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-ink-text">
                    {moment.content}
                  </p>
                )}

                {moment.images.length > 0 && (
                  // 缩略图按朋友圈的比例封顶，别让一张图占满整屏——正文才是主角
                  <div className={`mt-4 grid max-w-[26rem] gap-1.5 ${gridClass(moment.images.length)}`}>
                    {moment.images.map((src) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={src}
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className={`w-full rounded-lg border border-ink-line object-cover ${
                          moment.images.length === 1 ? 'aspect-[4/3]' : 'aspect-square'
                        }`}
                      />
                    ))}
                  </div>
                )}

                {moment.reactionCount > 0 && (
                  <p className="mt-4 flex items-center gap-1.5 text-[12px] text-ink-dim">
                    <HeartIcon />
                    <span className="font-mono">{moment.reactionCount}</span>
                  </p>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </>
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

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
      <path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.5 12 20 12 20z" />
    </svg>
  );
}
