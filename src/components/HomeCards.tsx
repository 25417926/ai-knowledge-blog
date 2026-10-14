'use client';

import { useEffect, useState } from 'react';
import { site } from '@/lib/site';

type Theme = 'light' | 'dark';

/**
 * 状态卡：首帧统一渲染「CONNECTING…」，挂载后再切到在线态。
 * 首帧必须与服务端一致，否则 hydration 会报不一致——所以在线判断只能放在 effect 里。
 */
export function StatusCard() {
  const [online, setOnline] = useState(false);
  const [doing, setDoing] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setOnline(true), 1100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (site.status.doing.length <= 1) return;
    const timer = setInterval(() => setDoing((i) => (i + 1) % site.status.doing.length), 3800);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="card flex flex-col p-6">
      <p className="font-mono text-[10.5px] tracking-[0.34em] text-ink-dim">
        {online ? 'STATUS' : 'CONNECTING…'}
      </p>

      <div className="mt-3.5 flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full animate-twinkle ${online ? 'bg-emerald-400' : 'bg-amber-400'}`}
        />
        <span className="text-[14.5px] font-semibold text-ink-text">
          {online ? site.status.label : '正在连接'}
        </span>
      </div>

      <p className="mt-auto pt-6 text-[12.5px] leading-6 text-ink-dim">
        <span className="mr-1 opacity-70">当前：</span>
        {site.status.doing[doing]}
      </p>
    </div>
  );
}

/** 季节：按月粗分，够用了——精确到节气没有意义，这里只是氛围件 */
function seasonOf(month: number): 'spring' | 'summer' | 'autumn' | 'winter' {
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}

const SEASON_LABEL = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' } as const;

/** 主题卡：季节 + 星光 + 当前模式，整卡可点，点击即切换明暗 */
export function ThemeCard() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [season, setSeason] = useState<keyof typeof SEASON_LABEL | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    setSeason(seasonOf(new Date().getMonth()));
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('town-theme', next);
    } catch {
      /* 隐私模式下写不进去也无妨，本次切换照常生效 */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`当前${theme === 'dark' ? '深色' : '浅色'}主题，点击切换`}
      className="card group flex flex-col items-start p-6 text-left"
    >
      <span className="flex w-full items-center gap-2.5">
        <span className="text-accent-ink">{season ? <SeasonIcon kind={season} /> : <StarIcon />}</span>
        <span className="text-ink-dim transition-transform duration-500 group-hover:rotate-90">
          <StarIcon />
        </span>
        <span className="ml-auto font-mono text-[10.5px] tracking-[0.28em] text-ink-dim">THEME</span>
      </span>

      <span className="mt-4 block text-[15px] font-semibold text-ink-text">
        {season ? `${SEASON_LABEL[season]}季` : '—'} · {theme === 'dark' ? '深空模式' : '白昼模式'}
      </span>

      <span className="mt-auto block pt-4 text-[12.5px] leading-6 text-ink-dim">
        {site.themeNote[theme]}
      </span>
    </button>
  );
}

function SeasonIcon({ kind }: { kind: 'spring' | 'summer' | 'autumn' | 'winter' }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'winter') {
    return (
      <svg {...common} aria-hidden>
        <path d="M12 2v20M4 6l16 12M20 6L4 18M12 6l3-2.5M12 6L9 3.5M12 18l3 2.5M12 18l-3 2.5" />
      </svg>
    );
  }
  if (kind === 'summer') {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
      </svg>
    );
  }
  if (kind === 'autumn') {
    return (
      <svg {...common} aria-hidden>
        <path d="M12 21V9M12 9c0-3 2-5 5-5 0 3-2 5-5 5zM12 13c0-2.6-1.8-4.4-4.4-4.4 0 2.6 1.8 4.4 4.4 4.4z" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <path d="M12 21V11M12 11c-3 0-5-2-5-5 3 0 5 2 5 5zM12 14c2.4 0 4.2-1.8 4.2-4.2C13.8 9.8 12 11.6 12 14z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5L4.5 11 10 9z" />
    </svg>
  );
}
