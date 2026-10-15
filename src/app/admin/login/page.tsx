'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AdminError, adminLogin } from '@/lib/admin';

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminLogin(password);
      router.replace('/admin/posts');
    } catch (err) {
      setError(err instanceof AdminError ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-3xl border border-ink-line bg-ink-panel/70 p-7 shadow-card backdrop-blur"
    >
      <h1 className="text-[17px] font-medium text-ink-text">后台登录</h1>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-dim">
        口令来自后端 <code className="font-mono">server/.env</code> 的{' '}
        <code className="font-mono">ADMIN_PASSWORD</code>。
      </p>

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        autoComplete="current-password"
        placeholder="口令"
        className="mt-5 w-full rounded-xl border border-ink-line bg-ink-soft px-3.5 py-2.5 text-[13px] text-ink-text outline-none transition focus:border-accent"
      />

      {error && <p className="mt-3 text-[12px] leading-relaxed text-rose-500">{error}</p>}

      <button
        type="submit"
        disabled={busy || !password}
        className="mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-[13px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? '登录中…' : '登录'}
      </button>
    </form>
  );
}
