'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

export type CarouselItem = {
  key: string;
  href: string;
  /** 左上角小标：LATEST INSIGHT / RECORDS 之类 */
  kicker: string;
  date: string;
  title: string;
  summary: string;
  /** 分类配色 CSS 变量，交给 .card::before 画渐变封面 */
  cover: Record<string, string>;
};

/** 停留时长：太短读不完摘要，太长显得卡住 */
const DWELL_MS = 5200;

/**
 * 卡片轮播。
 *
 * 三处细节是刻意的：
 *   1) 所有卡片叠在同一个网格单元里（col/row start 1），容器高度由最高那张撑开，
 *      切换时页面不跳动，也不用给容器写死高度；
 *   2) 悬停、离开视口、标签页失焦三种情况都停表——后台标签页里空转没有意义；
 *   3) 非当前卡片 aria-hidden 且移出 tab 序列，键盘用户不会被藏起来的链接绊住。
 */
export function Carousel({
  items,
  label,
  fill = false,
}: {
  items: CarouselItem[];
  label: string;
  /** 撑满父容器高度。首页左右两列高度不一致时用它对齐，否则矮的那侧会留一大块空白。 */
  fill?: boolean;
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const count = items.length;

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setActive(((next % count) + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (count <= 1 || paused || !visible) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % count), DWELL_MS);
    return () => clearInterval(timer);
  }, [count, paused, visible]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.15,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (count === 0) return null;

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription="轮播"
      aria-label={label}
      className={fill ? 'flex flex-1 flex-col' : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className={fill ? 'grid flex-1' : 'grid'}>
        {items.map((item, i) => {
          const on = i === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              tabIndex={on ? 0 : -1}
              aria-hidden={!on}
              className={`card col-start-1 row-start-1 flex min-h-[238px] flex-col p-6 transition-opacity duration-700 sm:p-7 ${
                fill ? 'h-full' : ''
              } ${on ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
              style={item.cover}
            >
              <span className="font-mono text-[10.5px] tracking-[0.34em] text-ink-text/65">
                {item.kicker}
              </span>

              {/* my-auto 而不是 mt-auto：卡片被拉高时（首页两列高度对齐）内容居中，
                  否则标题上方会留一大块空白 */}
              <span className="my-auto block">
                <span className="block font-mono text-[11px] tabular-nums text-ink-text/65">
                  {item.date}
                </span>
                <h3 className="mt-2.5 text-[19px] font-semibold leading-snug text-ink-text">{item.title}</h3>
                {item.summary && (
                  <p className="mt-2.5 line-clamp-2 text-[13px] leading-6 text-ink-text/75">{item.summary}</p>
                )}
              </span>
            </Link>
          );
        })}
      </div>

      {/* 短条指示器：够细，不抢卡片；数量就是轮播张数 */}
      <div className="mt-3 flex items-center gap-1.5">
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            onClick={() => go(i)}
            aria-label={`第 ${i + 1} 张：${item.title}`}
            aria-current={i === active}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i === active ? 'bg-accent' : 'bg-ink-line hover:bg-ink-dim/60'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
