'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { site } from '@/lib/site';

const NAV = [
  { href: '/', label: '首页' },
  { href: '/timeline', label: '归档' },
  { href: '/graph', label: '图谱' },
  { href: '/projects', label: '项目' },
  { href: '/moments', label: '说说' },
  { href: '/friends', label: '友链' },
  { href: '/about', label: '关于' },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 顶部导航。
 *
 * 桌面端一排导航；移动端整排收起，改成右侧中部一枚竖向三点胶囊——
 * 那个位置单手可及，也不会跟顶部状态栏打架。胶囊支持点击，也支持向左拖拽唤出。
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dragX, setDragX] = useState(0);
  const dragStart = useRef<number | null>(null);

  // 路由变化后收起抽屉，否则点完菜单它还挂着
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onPointerDown = (e: React.PointerEvent) => {
    dragStart.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    setDragX(Math.min(0, e.clientX - dragStart.current));
  };
  const onPointerUp = () => {
    if (dragX < -36) setOpen(true);
    dragStart.current = null;
    setDragX(0);
  };

  return (
    <>
      <header className="glass sticky top-0 z-30 border-b border-ink-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-8">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label={`${site.name} 首页`}>
            <span className="relative grid h-8 w-8 place-items-center rounded-xl border border-ink-line bg-accent/10">
              <span className="h-2 w-2 rounded-full bg-accent transition-transform duration-500 group-hover:scale-150" />
              <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-accent/20" />
            </span>
            <span className="font-serif text-[16px] font-semibold tracking-wide text-ink-text">
              {site.wordmark.prefix}
              <span className="mx-0.5 text-accent-ink">{site.wordmark.connector}</span>
              {site.wordmark.suffix}
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-0.5 md:flex">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative rounded-full px-3 py-1.5 text-[13px] transition-colors duration-300 ${
                    active
                      ? 'font-semibold text-accent-ink'
                      : 'font-medium text-ink-dim hover:bg-ink-panel hover:text-ink-text'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span className="absolute inset-x-0 -bottom-0.5 mx-auto h-1 w-1 rounded-full bg-accent animate-twinkle" />
                  )}
                </Link>
              );
            })}
            <span className="ml-2">
              <ThemeToggle />
            </span>
          </nav>

          <span className="ml-auto md:hidden">
            <ThemeToggle />
          </span>
        </div>
      </header>

      {/* 移动端入口：竖向三点胶囊，可点击或向左拖拽 */}
      <button
        type="button"
        aria-label="打开菜单"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ transform: `translateY(-50%) translateX(${dragX}px)` }}
        className="glass fixed right-0 top-1/2 z-40 flex h-16 w-7 flex-col items-center justify-center gap-1.5 rounded-l-full border border-r-0 border-ink-line md:hidden"
      >
        <span className="h-1 w-1 rounded-full bg-ink-dim" />
        <span className="h-1 w-1 rounded-full bg-ink-dim" />
        <span className="h-1 w-1 rounded-full bg-ink-dim" />
      </button>

      {/* 抽屉 */}
      <div
        className={`fixed inset-0 z-50 md:hidden ${open ? '' : 'pointer-events-none'}`}
        aria-hidden={!open}
      >
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          aria-label="关闭菜单"
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/45 backdrop-blur-sm transition-opacity duration-300 ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <nav
          aria-label="站点导航"
          className={`glass absolute inset-y-0 right-0 flex w-[74%] max-w-[300px] flex-col border-l border-ink-line px-6 py-8 transition-transform duration-300 ease-out ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <p className="font-serif text-[15px] font-semibold tracking-wide text-ink-text">
            {site.wordmark.prefix}
            <span className="mx-0.5 text-accent-ink">{site.wordmark.connector}</span>
            {site.wordmark.suffix}
          </p>
          <ul className="mt-8 space-y-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    tabIndex={open ? 0 : -1}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 text-[15px] transition-colors ${
                      active
                        ? 'bg-accent/12 font-semibold text-accent-ink'
                        : 'font-medium text-ink-dim hover:bg-ink-panel hover:text-ink-text'
                    }`}
                  >
                    {item.label}
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-auto pt-8 text-[11.5px] leading-5 text-ink-dim">{site.tagline}</p>
        </nav>
      </div>
    </>
  );
}
