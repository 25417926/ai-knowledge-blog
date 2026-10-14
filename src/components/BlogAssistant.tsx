'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type Source = { postSlug: string; postTitle: string; heading: string };

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  mock: boolean;
};

type AskResponse = {
  reply: string;
  citations: { postSlug: string; postTitle: string; heading: string }[];
  turnId: number;
  model: string;
  mock: boolean;
};

type HistoryResponse = {
  turns: { id: number; role: string; content: string; sources: Source[] }[];
  suggestions?: string[];
};

/** 小节名可能很长（「A > B > C」），卡片上只留最后一节 */
function lastHeading(heading: string): string {
  const parts = heading.split('>');
  return parts[parts.length - 1].trim();
}

/**
 * 博客端的 AI 助手。
 *
 * 它不是一个「什么都能聊」的聊天框，而是一个**只答站内内容**的读者工具：
 * 每个回答都必须带出处，出处可以点回原文那一段。所以「没有检索到」时它直接说不确定，
 * 而不是编一段听起来合理的话——这正是一个知识站该有的诚实。
 *
 * 挂在 layout 上，全站可用；在文章页会自动多一个「只搜本文」的开关。
 */
export function BlogAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoped, setScoped] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  // 只有文章详情页才谈得上「只搜本文」
  const articleSlug = (() => {
    const match = /^\/blog\/(.+)$/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : null;
  })();
  const scopeToArticle = articleSlug !== null && scoped;

  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    // 只接最近两轮：够表达「我记得你刚才问过」，又不至于一打开就是满屏旧问答和出处卡片
    fetch('/api/blog/ask?limit=4')
      .then((res) => res.json())
      .then((data: HistoryResponse) => {
        setMessages(
          (data.turns ?? []).map((t) => ({
            id: `h${t.id}`,
            role: t.role === 'assistant' ? 'assistant' : 'user',
            content: t.content,
            sources: t.sources ?? [],
            mock: false,
          })),
        );
        setSuggestions(data.suggestions ?? []);
      })
      .catch(() => {
        /* 第一次打开没有历史是正常的 */
      });
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const ask = useCallback(
    async (question: string, pinToArticle?: string) => {
      const message = question.trim();
      if (message === '' || busy) return;
      setBusy(true);
      setError(null);
      setDraft('');
      setMessages((prev) => [
        ...prev,
        { id: `u${Date.now()}`, role: 'user', content: message, sources: [], mock: false },
      ]);
      // 「这篇文章讲了什么」必须锁定当前这篇：即使开关切到「搜索全部」，问的也仍是这篇
      const about = pinToArticle ?? (scopeToArticle ? articleSlug : null);
      try {
        const res = await fetch('/api/blog/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, about }),
        });
        const payload = (await res.json()) as unknown;
        if (!res.ok) {
          throw new Error((payload as { error?: string }).error ?? '提问失败');
        }
        const data = payload as AskResponse;
        setMessages((prev) => [
          ...prev,
          {
            id: `a${data.turnId}`,
            role: 'assistant',
            content: data.reply,
            sources: data.citations,
            mock: data.mock,
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : '提问失败');
      } finally {
        setBusy(false);
      }
    },
    [articleSlug, busy, scopeToArticle],
  );

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="glass fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full border border-ink-line px-4 py-3 text-[13px] font-medium text-ink-text shadow-lg transition-colors hover:border-accent/60"
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] text-white">
            知
          </span>
          问 AI 助手
        </button>
      )}

      {open && (
        <section
          aria-label="博客助手"
          className="glass fixed bottom-6 right-6 z-40 flex h-[min(74vh,640px)] w-[min(94vw,412px)] flex-col overflow-hidden rounded-2xl border border-ink-line shadow-2xl"
        >
          <header className="flex items-center gap-3 border-b border-ink-line px-5 py-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent/40 bg-accent/12 text-[13px] font-semibold text-accent-ink">
              知
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-semibold text-ink-text">知行 · 博客助手</h2>
              <p className="truncate text-[11.5px] text-ink-dim">
                只答站内文章，每句结论都带出处
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="收起助手"
              className="rounded-lg px-2 py-1 text-[16px] leading-none text-ink-dim transition-colors hover:bg-ink-soft hover:text-ink-text"
            >
              ×
            </button>
          </header>

          {articleSlug && (
            <div className="mx-5 mt-3 flex shrink-0 flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setScoped((v) => !v)}
                className={`rounded-full border px-3 py-1 text-[11.5px] transition-colors ${
                  scoped
                    ? 'border-accent bg-accent/12 text-accent-ink'
                    : 'border-ink-line text-ink-dim hover:text-ink-text'
                }`}
              >
                {scoped ? '✓ 只搜当前这篇' : '搜索全部文章'}
              </button>
              <button
                type="button"
                onClick={() => void ask('这篇文章讲了什么？', articleSlug || undefined)}
                disabled={busy}
                className="rounded-full border border-ink-line px-3 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-accent/60 hover:text-ink-text disabled:opacity-40"
              >
                这篇文章讲了什么？
              </button>
            </div>
          )}

          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {messages.length === 0 && (
              <p className="text-[13px] leading-6 text-ink-dim">
                问点站内的问题试试。我会去文章里找，找到就贴原文给你，找不到就直说。
              </p>
            )}

            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'block'}>
                {m.role === 'user' ? (
                  <p className="max-w-[85%] rounded-2xl bg-accent px-3.5 py-2.5 text-[13px] leading-6 text-white">
                    {m.content}
                  </p>
                ) : (
                  <div>
                    <p className="whitespace-pre-wrap rounded-2xl border border-ink-line bg-ink-soft px-3.5 py-2.5 text-[13px] leading-6 text-ink-text">
                      {m.content}
                    </p>
                    {m.sources.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[10.5px] tracking-wide text-ink-dim">出处</p>
                        {m.sources.map((s, i) => (
                          <Link
                            key={`${s.postSlug}-${i}`}
                            href={`/posts/${encodeURIComponent(s.postSlug)}`}
                            className="flex items-baseline gap-2 rounded-lg border border-ink-line px-2.5 py-1.5 text-[12px] transition-colors hover:border-accent/60"
                          >
                            <span className="font-mono text-[10.5px] text-accent-ink">{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="text-ink-text">{s.postTitle}</span>
                              <span className="ml-1.5 text-ink-dim">› {lastHeading(s.heading)}</span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {busy && <p className="text-[12.5px] text-ink-dim">正在翻书架…</p>}
          </div>

          {/* 推荐问题常驻在输入框上方：已经聊过几轮之后，随手一点继续追问比空着更好用 */}
          {suggestions.length > 0 && (
            <ul className="flex gap-1.5 overflow-x-auto border-t border-ink-line px-5 py-2.5">
              {suggestions.map((s) => (
                <li key={s} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => void ask(s)}
                    disabled={busy}
                    className="rounded-full border border-ink-line px-2.5 py-1 text-[11.5px] text-ink-dim transition-colors hover:border-accent/60 hover:text-ink-text disabled:opacity-40"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="px-5 py-3.5">
            {error && <p className="mb-2 text-[12px] text-rose-400">{error}</p>}
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask(draft);
                  }
                }}
                rows={2}
                placeholder="问点什么…（Enter 发送）"
                className="min-h-[40px] flex-1 resize-none rounded-xl border border-ink-line bg-ink-soft px-3 py-2 text-[13px] leading-6 text-ink-text outline-none transition-colors placeholder:text-ink-dim/70 focus:border-accent/60"
              />
              <button
                type="button"
                onClick={() => void ask(draft)}
                disabled={busy || draft.trim() === ''}
                className="h-[40px] shrink-0 rounded-xl bg-accent px-4 text-[13px] font-medium text-white transition-opacity disabled:opacity-40"
              >
                发送
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
