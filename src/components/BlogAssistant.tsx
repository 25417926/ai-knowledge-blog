'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ASK_BASE } from '@/lib/api';

/** 出处。pdfUrl 仅收藏文章有：原文 PDF 存档链接，供对照总结交叉验证 */
type Source = { postSlug: string; postTitle: string; heading: string; pdfUrl?: string | null };

/** 工具调用的一步（「检索“线程池 核心参数” → 命中 4 篇」）。历史数据可能缺 label，兜底用 tool 名 */
type Step = { tool: string; label: string; hits: number; ms: number };

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  mock: boolean;
  /** 流式进行中：正文还在增量到达，末尾显示光标 */
  streaming?: boolean;
  /** 思考链：这一轮调用过哪些工具、各命中几条。空数组 = 没有工具调用（Mock 与闲聊路径） */
  steps: Step[];
};

type AskResponse = {
  reply: string;
  citations: { postSlug: string; postTitle: string; heading: string; pdfUrl?: string | null }[];
  turnId: number;
  model: string;
  mock: boolean;
  toolTrace?: Step[];
};

type HistoryResponse = {
  turns: {
    id: number;
    role: string;
    content: string;
    sources: Source[];
    toolTrace?: { tool: string; label?: string; hits: number; ms: number }[];
  }[];
  suggestions?: string[];
};

/** 小节名可能很长（「A > B > C」），卡片上只留最后一节 */
function lastHeading(heading: string): string {
  const parts = heading.split('>');
  return parts[parts.length - 1].trim();
}

/**
 * 思考链条目：流式进行中逐步列出每次工具调用；结束后折叠成一行摘要，可再展开。
 *
 * 它展示的是「确实发生过的事」——每次检索的用词、命中几条、花了多少毫秒，
 * 全部来自后端 tool_trace（本来就要落库的），不是表演出来的思考过程。
 * 没有工具调用的消息（Mock 与闲聊路径）整个区域不渲染。
 */
function StepTrail({
  steps,
  sourceCount,
  streaming,
  open,
  onToggle,
}: {
  steps: Step[];
  sourceCount: number;
  streaming: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  if (steps.length === 0) return null;
  const searches = steps.filter(
    (s) => s.tool === 'search_posts' || s.tool === 'get_article_overview',
  ).length;

  const rows = steps.map((s, i) => (
    <p
      key={`${s.tool}-${i}`}
      className="flex items-baseline gap-1.5 text-[11.5px] leading-5 text-ink-dim"
    >
      <span className="font-mono text-[10.5px] text-accent-ink">{i + 1}</span>
      <span className="min-w-0 flex-1">{s.label}</span>
      <span className="shrink-0">
        {s.hits > 0 ? `命中 ${s.hits} 条` : '无新增'} · {s.ms}ms
      </span>
    </p>
  ));

  if (streaming) {
    return (
      <div className="mb-2 space-y-1 rounded-2xl border border-dashed border-ink-line px-3 py-2">
        {rows}
      </div>
    );
  }
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left text-[11.5px] text-ink-dim transition-colors hover:text-ink-text"
      >
        <span className={open ? '' : 'rotate-180'}>&#9662;</span>
        <span>
          {searches > 0 ? `检索 ${searches} 次` : `操作 ${steps.length} 步`}
          {sourceCount > 0 ? ` · 引用 ${sourceCount} 篇` : ''}
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded-lg border border-ink-line px-2.5 py-2">{rows}</div>
      )}
    </div>
  );
}

/**
 * 读 SSE 流：按空行分帧，逐帧回调 (event, data)。
 * EventSource 不支持 POST，所以流式问答只能用 fetch + 手撕帧。
 */
async function readSSE(
  res: Response,
  onEvent: (name: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let split = buffer.indexOf('\n\n');
    while (split >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let name = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length > 0) {
        onEvent(name, JSON.parse(dataLines.join('\n')) as Record<string, unknown>);
      }
      split = buffer.indexOf('\n\n');
    }
  }
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
  /** 流式过程提示（「正在翻书架…」）；首个 token 到达后让位给正文 */
  const [statusText, setStatusText] = useState<string | null>(null);
  const [hasTokens, setHasTokens] = useState(false);
  /** 这一轮已经有过工具调用：步骤条接管「正在做什么」，底部占位行退场 */
  const [hasSteps, setHasSteps] = useState(false);
  /** 哪条消息的思考链条目是展开的（同一时间只展开一条，null = 全部折叠） */
  const [stepsOpen, setStepsOpen] = useState<string | null>(null);
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
    fetch(`${ASK_BASE}?limit=4`)
      .then((res) => res.json())
      .then((data: HistoryResponse) => {
        setMessages(
          (data.turns ?? []).map((t) => ({
            id: `h${t.id}`,
            role: t.role === 'assistant' ? 'assistant' : 'user',
            content: t.content,
            sources: t.sources ?? [],
            mock: false,
            // 改造前落库的 trace 没有 label 字段，兜底显示工具名
            steps: (t.toolTrace ?? []).map((s) => ({
              tool: s.tool,
              label: s.label ?? s.tool,
              hits: s.hits,
              ms: s.ms,
            })),
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

  /** 整包路径：流式不可用时的回落，也是改造前行为的完整保留 */
  const askViaJson = useCallback(async (bubbleId: string, message: string, about: string | null) => {
    const res = await fetch(ASK_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, about }),
    });
    const payload = (await res.json()) as unknown;
    if (!res.ok) {
      throw new Error((payload as { error?: string }).error ?? '提问失败');
    }
    const data = payload as AskResponse;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === bubbleId
          ? {
              ...m,
              content: data.reply,
              sources: data.citations,
              mock: data.mock,
              streaming: false,
              steps: data.toolTrace ?? [],
            }
          : m,
      ),
    );
  }, []);

  /**
   * SSE 流式路径。返回 false 表示该回落整包路：
   * 传输层失败（端点不存在 / 断网），或服务端在产出任何 token 之前就报错。
   * 已经流了一半再断网则保留现场，补一句中断提示——内容比报错更值钱。
   */
  const askViaStream = useCallback(async (bubbleId: string, message: string, about: string | null) => {
    let res: Response;
    try {
      res = await fetch(`${ASK_BASE}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, about }),
      });
    } catch {
      return false;
    }
    if (!res.ok || !res.body) return false;

    let received = false;
    let failure: string | null = null;
    const append = (text: string) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === bubbleId ? { ...m, content: m.content + text } : m)),
      );
    const settle = (extra = '') =>
      setMessages((prev) =>
        prev.map((m) =>
          m.id === bubbleId ? { ...m, content: m.content + extra, streaming: false } : m,
        ),
      );

    const onEvent = (name: string, data: Record<string, unknown>) => {
      if (name === 'token') {
        if (!received) {
          received = true;
          setHasTokens(true);
        }
        append(String(data.text ?? ''));
      } else if (name === 'status') {
        setStatusText(String(data.text ?? ''));
      } else if (name === 'step') {
        // 工具执行完一步：步骤条接住，过程提示撤走（下一轮检索前 status 会再来）
        const step: Step = {
          tool: String(data.tool ?? ''),
          label: String(data.label ?? data.tool ?? ''),
          hits: Number(data.hits ?? 0),
          ms: Number(data.ms ?? 0),
        };
        setStatusText(null);
        setMessages((prev) =>
          prev.map((m) => (m.id === bubbleId ? { ...m, steps: [...m.steps, step] } : m)),
        );
      } else if (name === 'done') {
        const d = data as unknown as AskResponse;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === bubbleId
              ? { ...m, content: d.reply, sources: d.citations ?? [], mock: d.mock, streaming: false }
              : m,
          ),
        );
      } else if (name === 'error') {
        failure = String(data.message ?? '提问失败');
      }
    };

    try {
      await readSSE(res, onEvent);
    } catch {
      if (!received) return false;
      settle('\n\n（输出中断，以上是部分内容）');
      return true;
    }

    if (failure && !received) return false; // 开播即失败：回落整包路，让错误信息照常展示
    settle(failure ? `\n\n（输出中断：${failure}）` : '');
    return true;
  }, []);

  const ask = useCallback(
    async (question: string, pinToArticle?: string) => {
      const message = question.trim();
      if (message === '' || busy) return;
      setBusy(true);
      setError(null);
      setDraft('');
      setStatusText(null);
      setHasTokens(false);
      setHasSteps(false);
      setMessages((prev) => [
        ...prev,
        { id: `u${Date.now()}`, role: 'user', content: message, sources: [], mock: false, steps: [] },
      ]);
      // 「这篇文章讲了什么」必须锁定当前这篇：即使开关切到「搜索全部」，问的也仍是这篇
      const about = pinToArticle ?? (scopeToArticle ? articleSlug : null);
      // 先放一个流式中的空气泡：token 直接往里追加，done 事件再用最终载荷整体替换
      const bubbleId = `s${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: bubbleId,
          role: 'assistant',
          content: '',
          sources: [],
          mock: false,
          streaming: true,
          steps: [],
        },
      ]);
      try {
        const streamed = await askViaStream(bubbleId, message, about);
        if (!streamed) await askViaJson(bubbleId, message, about);
      } catch (err) {
        setError(err instanceof Error ? err.message : '提问失败');
        // 整包路也失败了：撤掉那个没等到内容的空气泡
        setMessages((prev) => prev.filter((m) => !(m.id === bubbleId && m.content === '')));
      } finally {
        setBusy(false);
        setStatusText(null);
        setHasTokens(false);
      }
    },
    [articleSlug, askViaJson, askViaStream, busy, scopeToArticle],
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
                    <StepTrail
                      steps={m.steps}
                      sourceCount={m.sources.length}
                      streaming={m.streaming === true}
                      open={stepsOpen === m.id}
                      onToggle={() => setStepsOpen((v) => (v === m.id ? null : m.id))}
                    />
                    {(m.content !== '' || !m.streaming) && (
                      <p className="whitespace-pre-wrap rounded-2xl border border-ink-line bg-ink-soft px-3.5 py-2.5 text-[13px] leading-6 text-ink-text">
                        {m.content}
                        {m.streaming && (
                          <span className="ml-0.5 inline-block animate-pulse text-accent">▍</span>
                        )}
                      </p>
                    )}
                    {m.sources.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[10.5px] tracking-wide text-ink-dim">出处</p>
                        {m.sources.map((s, i) => (
                          <div
                            key={`${s.postSlug}-${i}`}
                            className="rounded-lg border border-ink-line px-2.5 py-1.5 text-[12px] transition-colors hover:border-accent/60"
                          >
                            <Link
                              href={`/posts/${encodeURIComponent(s.postSlug)}`}
                              className="flex items-baseline gap-2"
                            >
                              <span className="font-mono text-[10.5px] text-accent-ink">{i + 1}</span>
                              <span className="min-w-0 flex-1">
                                <span className="text-ink-text">{s.postTitle}</span>
                                <span className="ml-1.5 text-ink-dim">› {lastHeading(s.heading)}</span>
                              </span>
                            </Link>
                            {s.pdfUrl && (
                              <a
                                href={s.pdfUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-block text-[10.5px] text-accent-ink hover:underline"
                              >
                                对照原文 PDF ↗
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

          {/* 首个 token 到达、或步骤条接管后，过程提示让位 */}
          {busy && !hasTokens && !hasSteps && (
            <p className="text-[12.5px] text-ink-dim">{statusText ?? '正在翻书架…'}</p>
          )}
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
