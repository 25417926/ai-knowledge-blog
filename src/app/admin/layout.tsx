'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AdminError, adminLogout, adminMe } from '@/lib/admin';

const NAV = [
  { href: '/admin/posts', label: '文章' },
  { href: '/admin/clippings', label: '收藏' },
  { href: '/admin/friends', label: '友链' },
  { href: '/admin/logs', label: '对话日志' },
  { href: '/admin/insights', label: '访客意图' },
];

type Gate = 'checking' | 'ok' | 'login' | 'disabled' | 'down';

/** 后台外壳：左边导航，右边内容；进来先过认证闸门。 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/admin/login';
  const [gate, setGate] = useState<Gate>('checking');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLogin) return;
    let alive = true;
    adminMe()
      .then((me) => {
        if (!alive) return;
        if (!me.enabled) setGate('disabled');
        else if (!me.authenticated) {
          setGate('login');
          router.replace('/admin/login');
        } else setGate('ok');
      })
      .catch((err) => {
        if (!alive) return;
        setGate('down');
        setError(err instanceof AdminError ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
    // pathname 入依赖：登录成功后跳走要重新过闸
  }, [isLogin, pathname, router]);

  const logout = useCallback(async () => {
    await adminLogout().catch(() => undefined);
    router.replace('/admin/login');
  }, [router]);

  if (isLogin) {
    return <div className="mx-auto w-full max-w-md px-6 py-20">{children}</div>;
  }

  if (gate === 'checking' || gate === 'login') {
    return <Notice title="正在校验登录态…" body="没反应的话直接去 /admin/login。" />;
  }
  if (gate === 'disabled') {
    return (
      <Notice
        title="后台未启用"
        body="后端没读到 ADMIN_PASSWORD。在 server/.env 里补一行 ADMIN_PASSWORD=你的口令，然后重启后端。"
      />
    );
  }
  if (gate === 'down') {
    return <Notice title="连不上后端" body={`${error}。确认 :8000 在跑。`} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row">
      <aside className="lg:w-44 lg:shrink-0">
        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-accent-ink">
            后台
          </span>
          <button
            type="button"
            onClick={logout}
            className="text-[12px] text-ink-dim transition hover:text-ink-text"
          >
            退出
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-xl px-3 py-2 text-[13px] transition ${
                  active
                    ? 'bg-accent/12 font-medium text-accent-ink'
                    : 'text-ink-dim hover:bg-ink-panel hover:text-ink-text'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/"
            className="shrink-0 rounded-xl px-3 py-2 text-[13px] text-ink-dim transition hover:bg-ink-panel hover:text-ink-text"
          >
            ← 回前台
          </Link>
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-24 text-center">
      <h1 className="text-[15px] font-medium text-ink-text">{title}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{body}</p>
    </div>
  );
}
