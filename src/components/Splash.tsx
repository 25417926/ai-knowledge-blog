'use client';

import { useEffect, useState } from 'react';
import { site } from '@/lib/site';

const KEY = 'cyber-town:splash';

type Phase = 'show' | 'leave' | 'gone';

/**
 * 首次访问开屏。
 *
 * 两条硬性要求，缺一不可：
 *   1) 同一会话只播一次 —— 用 sessionStorage 记录，刷新不清除，关标签页才重置；
 *   2) 任何异常都不能永久遮住内容 —— 除了正常结束，还挂了一条 3 秒兜底定时器。
 *
 * 覆盖层由服务端一并渲染，避免「先闪一下正文再盖住」；
 * 同一会话内再次进入时，靠 layout 里的内联脚本提前把 data-splash 标成 seen，CSS 直接隐藏，
 * 这样连第一帧都不会闪。
 */
export function Splash() {
  const [phase, setPhase] = useState<Phase>('show');

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(KEY) === '1';
    } catch {
      seen = false;
    }
    if (seen) {
      setPhase('gone');
      return;
    }
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* 隐私模式下写不进去也无所谓，最多每次刷新都播一遍 */
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hold = reduce ? 260 : 1150;
    const leave = setTimeout(() => {
      setPhase((p) => (p === 'show' ? 'leave' : p));
      setTimeout(() => setPhase('gone'), reduce ? 120 : 520);
    }, hold);
    // 兜底：动画若因任何原因没走完，3 秒后强制放行
    const bail = setTimeout(() => setPhase('gone'), reduce ? 800 : 3000);

    return () => {
      clearTimeout(leave);
      clearTimeout(bail);
    };
  }, []);

  if (phase === 'gone') return null;

  return (
    <div
      aria-hidden
      className={`splash fixed inset-0 z-[100] grid place-items-center bg-ink-bg transition-opacity duration-500 ${
        phase === 'leave' ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex flex-col items-center">
        <p className="font-serif text-[26px] font-semibold tracking-wide text-ink-text sm:text-[32px]">
          {site.wordmark.prefix}
          <span className="mx-1 text-accent-ink">{site.wordmark.connector}</span>
          {site.wordmark.suffix}
        </p>
        <p className="mt-3 text-[12px] tracking-[0.3em] text-ink-dim">{site.tagline}</p>

        <span className="relative mt-7 block h-[2px] w-40 overflow-hidden rounded-full bg-ink-line">
          <span className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-accent animate-shine" />
        </span>
      </div>
    </div>
  );
}
