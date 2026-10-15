'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminError, adminLogs, type AdminLog } from '@/lib/admin';

function stamp(value: string) {
  return value ? value.slice(0, 19).replace('T', ' ') : '—';
}

export default function AdminLogsPage() {
  const [log, setLog] = useState<AdminLog | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setBusy(true);
    return adminLogs(60)
      .then((data) => {
        setLog(data);
        setError('');
      })
      .catch((err) => setError(err instanceof AdminError ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const turns = log?.turns ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-medium text-ink-text">对话日志</h1>
          <p className="mt-1 text-[12px] text-ink-dim">
            {turns.length} 轮留痕
            {log ? ` · 与「${log.agentName}」的好感度 ${log.affinity.label}（${log.affinity.score}）` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-xl border border-ink-line px-3.5 py-2 text-[12px] text-ink-text transition hover:border-accent"
        >
          刷新
        </button>
      </header>

      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3.5 py-2 text-[12px] text-rose-500">
          {error}
        </p>
      )}

      {busy && !log && <p className="py-8 text-center text-[12px] text-ink-dim">加载中…</p>}

      {log && log.memories.length > 0 && (
        <section className="rounded-2xl border border-ink-line bg-ink-panel/60 p-4">
          <h2 className="text-[12px] font-medium text-ink-text">长期记忆（{log.memories.length}）</h2>
          <ul className="mt-2 space-y-1">
            {log.memories.map((m) => (
              <li key={m.id} className="text-[12px] leading-relaxed text-ink-dim">
                · {m.content}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-3">
        {!busy && turns.length === 0 && (
          <p className="py-8 text-center text-[12px] text-ink-dim">还没有对话记录</p>
        )}
        {turns.map((turn) => {
          const mine = turn.role === 'user';
          return (
            <article
              key={turn.id}
              className={`rounded-2xl border p-4 ${
                mine ? 'border-ink-line bg-ink-soft/70' : 'border-ink-line bg-ink-panel/60'
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-dim">
                <span className={mine ? 'text-ink-text' : 'font-medium text-accent-ink'}>
                  {mine ? '访客' : log?.agentName}
                </span>
                <span>{stamp(turn.createdAt)}</span>
                {!mine && turn.model && <span className="font-mono">{turn.model}</span>}
                {!mine && turn.latencyMs > 0 && <span>{turn.latencyMs} ms</span>}
                {turn.affinityDelta > 0 && <span>好感 +{turn.affinityDelta}</span>}
              </div>

              <p className="whitespace-pre-wrap text-[12.5px] leading-[1.75] text-ink-text">
                {turn.content}
              </p>

              {turn.toolTrace.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {turn.toolTrace.map((step, i) => (
                    <span
                      key={`${turn.id}-${i}`}
                      className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent-ink"
                    >
                      {step.label ?? step.tool}
                      {typeof step.hits === 'number' ? ` · ${step.hits} 条` : ''}
                    </span>
                  ))}
                </div>
              )}

              {turn.sources.length > 0 && (
                <div className="mt-2.5 space-y-1 border-t border-ink-line pt-2.5">
                  {turn.sources.map((source, i) => (
                    <div key={`${turn.id}-src-${i}`} className="flex flex-wrap items-baseline gap-2 text-[11px]">
                      <Link
                        href={`/posts/${encodeURIComponent(source.postSlug)}`}
                        className="text-ink-dim transition hover:text-accent-ink"
                      >
                        《{source.postTitle}》
                      </Link>
                      <span className="text-ink-dim opacity-70">{source.heading || '正文'}</span>
                      {source.pdfUrl && (
                        <a href={source.pdfUrl} className="text-accent-ink hover:underline">
                          对照原文 PDF ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
