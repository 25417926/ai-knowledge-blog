'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ASK_BASE } from '@/lib/api';

/** 出处。pdfUrl 仅收藏文章有：原文 PDF 存档链接，供对照总结交叉验证。quote 是那一段的原文摘录 */
type Source = {
  postSlug: string;
  postTitle: string;
  heading: string;
  quote?: string | null;
  pdfUrl?: string | null;
};

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
  citations: Source[];
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

/** 引文是 Markdown 片段（列表、加粗、行内代码），卡片里要的是人话，不是符号 */
function plainQuote(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 一篇回答的出处按「文章」归拢，不再一段一张卡。
 *
 * 起因是真实的：某轮回答正文只标了 [1][5]，出处却把检索到的 7 段全列了出来，
 * 五分之四是这次答话没用到的东西。段落属于文章，读者要的是「这话出自哪篇、哪一节」，
 * 而不是一份检索流水账。所以卡片=文章，展开=那几段的原文。
 */
type SourceGroup = {
  slug: string;
  title: string;
  pdfUrl: string | null;
  items: { n: number; heading: string; quote: string }[];
};

/** 正文里真正标出来的 [n]（没有标注时返回空集，由调用方退回「全部展示」） */
function citedNumbers(content: string): Set<number> {
  const found = new Set<number>();
  for (const match of content.matchAll(/\[(\d{1,2})\]/g)) found.add(Number(match[1]));
  return found;
}

function groupSources(sources: Source[], keep: Set<number> | null): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  sources.forEach((s, i) => {
    const n = i + 1;
    if (keep && !keep.has(n)) return;
    let group = groups.get(s.postSlug);
    if (!group) {
      group = { slug: s.postSlug, title: s.postTitle, pdfUrl: s.pdfUrl ?? null, items: [] };
      groups.set(s.postSlug, group);
    }
    group.items.push({ n, heading: s.heading, quote: s.quote ? plainQuote(s.quote) : '' });
    if (s.pdfUrl) group.pdfUrl = s.pdfUrl;
  });
  return [...groups.values()];
}

/** 原生 details 当折叠：点正文标号时直接改它的 open，不必再往 React 里搬一份状态 */
function openSourceCard(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function SourceCards({
  groups,
  msgId,
  withLabel,
}: {
  groups: SourceGroup[];
  msgId: string;
  withLabel: boolean;
}) {
  if (groups.length === 0) return null;
  return (
    <div className={withLabel ? 'mt-2 space-y-1.5' : 'mt-1.5 space-y-1.5'}>
      {withLabel && <p className="text-[10.5px] tracking-wide text-ink-dim">出处</p>}
      {groups.map((g, gi) => {
        const single = g.items.length === 1;
        return (
          <details
            key={`${g.slug}-${gi}`}
            id={`src-${msgId}-${gi}`}
            className="group rounded-lg border border-ink-line transition-colors open:border-accent/40 open:bg-ink-soft/50"
          >
            <summary className="flex cursor-pointer list-none items-baseline gap-2 px-2.5 py-1.5 text-[12px] [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 truncate">
                <span className="text-ink-text">{g.title}</span>
                <span className="ml-1.5 text-ink-dim">
                  › {single ? lastHeading(g.items[0].heading) : `${g.items.length} 段`}
                </span>
              </span>
              <span className="shrink-0 text-[9px] text-ink-dim transition-transform group-open:rotate-180">
                ▼
              </span>
            </summary>
            <div className="space-y-2 border-t border-ink-line px-2.5 py-2">
              {g.items.map((item) => (
                <div key={item.n}>
                  {/* 单段卡的小节名已经写在标题行上，展开区再写一遍就是重复 */}
                  {!single && (
                    <p className="flex items-baseline gap-1.5 text-[10.5px] text-ink-dim">
                      <span className="font-mono text-accent-ink">{item.n}</span>
                      <span className="min-w-0 flex-1 truncate">{lastHeading(item.heading)}</span>
                    </p>
                  )}
                  {item.quote && (
                    <p
                      className={`line-clamp-3 text-[11.5px] leading-[1.65] text-ink-dim ${
                        single ? '' : 'mt-0.5'
                      }`}
                    >
                      {item.quote}
                    </p>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-3 pt-0.5">
                <Link
                  href={`/posts/${encodeURIComponent(g.slug)}`}
                  className="text-[11px] text-accent-ink hover:underline"
                >
                  读整篇 ↗
                </Link>
                {g.pdfUrl && (
                  <a
                    href={g.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-accent-ink hover:underline"
                  >
                    原文 PDF ↗
                  </a>
                )}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

/**
 * 回答正文：把 [n] 渲染成可点的标号，点了就地展开对应那篇的出处卡片。
 * 标号仍是等宽的浅色小块，不抢正文的视觉重量——它是注解，不是内容。
 */
function AnswerText({
  content,
  streaming,
  resolve,
}: {
  content: string;
  streaming: boolean;
  resolve: (n: number) => string | null;
}) {
  return (
    <p className="whitespace-pre-wrap rounded-2xl border border-ink-line bg-ink-soft px-3.5 py-2.5 text-[13px] leading-6 text-ink-text">
      {content.split(/(\[\d{1,2}\])/g).map((part, i) => {
        const match = /^\[(\d{1,2})\]$/.exec(part);
        const target = match ? resolve(Number(match[1])) : null;
        if (!match || !target) return <span key={i}>{part}</span>;
        return (
          <button
            key={i}
            type="button"
            onClick={() => openSourceCard(target)}
            title="看这一段出处"
            className="mx-px rounded bg-accent/10 px-1 align-baseline font-mono text-[10.5px] leading-none text-accent-ink transition-colors hover:bg-accent/25"
          >
            {match[1]}
          </button>
        );
      })}
      {streaming && <span className="ml-0.5 inline-block animate-pulse text-accent">▍</span>}
    </p>
  );
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
/**
 * 桌宠点一下时派发这个事件来开面板。
 * 助手没有自己的浮动按钮了——入口只剩桌宠一个，agent 与会话因此天然唯一。
 */
export const OPEN_ASSISTANT_EVENT = 'blog-assistant:open';

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
    const openPanel = () => setOpen(true);
    window.addEventListener(OPEN_ASSISTANT_EVENT, openPanel);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, openPanel);
  }, []);

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

            {messages.map((m) => {
              if (m.role === 'user') {
                return (
                  <div key={m.id} className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl bg-accent px-3.5 py-2.5 text-[13px] leading-6 text-white">
                      {m.content}
                    </p>
                  </div>
                );
              }
              // 正文标了 [n] 就只认可这些：没标的多半是检索顺带命中，收进折叠行
              const cited = citedNumbers(m.content);
              const keep = cited.size > 0 ? cited : null;
              const primary = groupSources(m.sources, keep);
              const secondary = keep
                ? groupSources(
                    m.sources,
                    new Set(m.sources.map((_, i) => i + 1).filter((n) => !keep.has(n))),
                  )
                : [];
              const extra = secondary.reduce((sum, g) => sum + g.items.length, 0);
              // 标号 → 卡片：同一篇里的几个 n 都指向同一张卡
              const cardOf = new Map<number, string>();
              primary.forEach((g, gi) => g.items.forEach((it) => cardOf.set(it.n, `src-${m.id}-${gi}`)));
              return (
                <div key={m.id} className="block">
                  <StepTrail
                    steps={m.steps}
                    sourceCount={primary.length}
                    streaming={m.streaming === true}
                    open={stepsOpen === m.id}
                    onToggle={() => setStepsOpen((v) => (v === m.id ? null : m.id))}
                  />
                  {(m.content !== '' || !m.streaming) && (
                    <AnswerText
                      content={m.content}
                      streaming={m.streaming === true}
                      resolve={(n) => cardOf.get(n) ?? null}
                    />
                  )}
                  <SourceCards groups={primary} msgId={m.id} withLabel />
                  {secondary.length > 0 && (
                    <details className="mt-2 rounded-lg border border-dashed border-ink-line" data-fold="rest">
                      <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[10.5px] text-ink-dim [&::-webkit-details-marker]:hidden">
                        另有 {secondary.length} 篇 {extra} 段检索命中（本答未引用）
                      </summary>
                      <div className="px-1.5">
                        <SourceCards groups={secondary} msgId={`${m.id}-x`} withLabel={false} />
                      </div>
                    </details>
                  )}
                </div>
              );
            })}

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
