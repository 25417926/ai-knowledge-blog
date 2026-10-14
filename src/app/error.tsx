'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * 全局错误边界。
 *
 * 只在真正抛错时出现，因此这里不做花活：说清「是这一页坏了、别的还能用」，
 * 给一个 retry（重渲染当前段）和一条回首页的退路。错误详情打到控制台，
 * 不往界面上抛堆栈——那是给开发者看的，不该吓到访客。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[route error]', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-6xl flex-col items-center justify-center px-5 py-24 text-center sm:px-8">
      <p className="font-mono text-[13px] tracking-[0.4em] text-accent-ink">SOMETHING BROKE</p>
      <h1 className="mt-5 font-serif text-[32px] font-semibold leading-tight text-ink-text sm:text-[40px]">
        这一页没渲染出来
      </h1>
      <p className="mt-4 max-w-md text-[14.5px] leading-7 text-ink-dim">
        别的内容还在。可以先重试一次；如果反复失败，回首页换个入口再进来。
      </p>
      {error.digest && (
        <p className="mt-3 font-mono text-[11.5px] text-ink-dim/70">trace: {error.digest}</p>
      )}

      <div className="mt-9 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-accent/60 bg-accent/12 px-5 py-2 text-[13.5px] font-medium text-accent-ink transition-colors hover:bg-accent/20"
        >
          重试一次
        </button>
        <Link
          href="/"
          className="rounded-full border border-ink-line px-5 py-2 text-[13.5px] font-medium text-ink-dim transition-colors hover:border-accent/50 hover:text-ink-text"
        >
          回首页
        </Link>
      </div>
    </main>
  );
}
