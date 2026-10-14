'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 正文图片灯箱。
 *
 * 用事件委托挂在正文容器上，而不是给每张图加 onClick —— 正文是
 * dangerouslySetInnerHTML 注入的，逐图绑定还得额外扫描一遍 DOM，
 * 而且以后加图也得重新绑。
 */
export function Lightbox({ selector = '.md-body' }: { selector?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.querySelector(selector);
    if (!root) return;

    const onClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.tagName !== 'IMG') return;
      const img = target as HTMLImageElement;
      event.preventDefault();
      restoreFocus.current = document.activeElement as HTMLElement | null;
      setSrc(img.currentSrc || img.src);
    };

    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [selector]);

  useEffect(() => {
    if (!src) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  function close() {
    setSrc(null);
    restoreFocus.current?.focus?.();
  }

  if (!src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={close}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-10"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded-xl border border-white/15 object-contain shadow-2xl"
      />
      <button
        type="button"
        onClick={close}
        aria-label="关闭预览"
        autoFocus
        className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/25 text-white/85 transition-colors hover:bg-white/15"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
