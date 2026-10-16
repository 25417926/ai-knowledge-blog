import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '页面不存在',
  robots: { index: false, follow: false },
};

const WAYS = [
  { href: '/', label: '回首页', hint: '资料卡、最新文章与说说' },
  { href: '/timeline', label: '看归档', hint: '按时间与标签检索全部内容' },
];

/** 404：走进一条不在图上的街 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-6xl flex-col items-center justify-center px-5 py-24 text-center sm:px-8">
      <p className="font-mono text-[13px] tracking-[0.4em] text-accent-ink">ERROR 404</p>
      <h1 className="mt-5 font-serif text-[34px] font-semibold leading-tight text-ink-text sm:text-[44px]">
        这条街没有这栋楼
      </h1>
      <p className="mt-4 max-w-md text-[14.5px] leading-7 text-ink-dim">
        你要找的页面可能已经搬走、改名，或者从来没修过。下面几条路是通的。
      </p>

      <div className="mt-10 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        {WAYS.map((way) => (
          <Link key={way.href} href={way.href} className="card group px-5 py-6 text-left">
            <span className="block text-[14.5px] font-semibold text-ink-text transition-colors group-hover:text-accent-ink">
              {way.label}
            </span>
            <span className="mt-1.5 block text-[12px] leading-5 text-ink-dim">{way.hint}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
