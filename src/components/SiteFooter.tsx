'use client';

import { useEffect, useState } from 'react';
import { site } from '@/lib/site';

const START = new Date(site.startedAt).getTime();

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 页脚状态条：实时时钟 + 站点运行时长 + 技术栈。
 *
 * 时钟必须等挂载后再渲染——服务端算出来的时间到了浏览器早就过期了，
 * 直接 SSR 会导致 hydration 不一致。所以首帧只留占位。
 */
export function SiteFooter() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const uptime = (() => {
    if (!now) return '—';
    const ms = Math.max(0, now.getTime() - START);
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    return `${days} 天 ${hours} 小时`;
  })();

  return (
    <footer className="mx-auto mt-20 max-w-6xl px-5 pb-10 sm:px-8">
      <div className="glass flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-ink-line px-5 py-4 text-[11.5px] text-ink-dim">
        <span className="font-mono tabular-nums text-ink-text">
          {now ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` : '--:--:--'}
        </span>

        <span className="hidden sm:inline">
          已稳定运行 <span className="font-mono text-ink-text">{uptime}</span>
        </span>

        <span className="hidden items-center gap-2 md:flex">
          {site.techStack.map((tech) => (
            <span key={tech} className="font-mono opacity-80">
              {tech}
            </span>
          ))}
        </span>

        <span className="ml-auto flex items-center gap-4">
          {site.icp && <span>{site.icp}</span>}
          <span>
            © {now ? now.getFullYear() : ''} {site.author.name}
          </span>
        </span>
      </div>
    </footer>
  );
}
