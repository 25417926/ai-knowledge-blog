'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminError,
  adminCreateClipping,
  adminDeleteClipping,
  adminListClippings,
  type AdminClipping,
  type ClipResult,
} from '@/lib/admin';

const EMPTY_FORM = { url: '', title: '', paste: '' };

const ORIGIN_LABEL: Record<string, string> = {
  web: '网页抓取',
  paste: '粘贴全文',
};

const SUMMARY_LABEL: Record<string, string> = {
  llm: '模型摘抄',
  mock: '节选（未配 LLM）',
  error: '摘抄失败，原文已存',
};

const pdfHref = (url: string) => `/api/clippings/pdf?url=${encodeURIComponent(url)}`;

/**
 * 收藏后台：贴链接 → 抓正文 → 摘抄 → PDF 存档 → 写笔记 → 重建索引。
 *
 * 流程本体在后端 services/clipping.py，与 `python -m scripts.clip` 是同一份实现；
 * 这里只负责输入、进度与结果展示。抓不到正文（公众号反爬）时后端返 422，
 * 页面自动展开「粘贴全文」，这是这条管道唯一的降级口子。
 */
export default function AdminClippingsPage() {
  const [items, setItems] = useState<AdminClipping[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showPaste, setShowPaste] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ClipResult | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return adminListClippings()
      .then((rows) => {
        setItems(rows);
        setError('');
      })
      .catch((err) => setError(err instanceof AdminError ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(payload: { url: string; paste?: string; title?: string }) {
    setRunning(true);
    setNotice('');
    setError('');
    setResult(null);
    try {
      const res = await adminCreateClipping(payload);
      setResult(res);
      setNotice(res.updated ? `已原地更新《${res.title}》` : `已收藏《${res.title}》`);
      setForm(EMPTY_FORM);
      setShowPaste(false);
      await load();
    } catch (err) {
      const message = err instanceof AdminError ? err.message : String(err);
      setError(message);
      // 抓不到正文是这条管道最常见的一次失败，直接把粘贴框摊开
      if (err instanceof AdminError && err.status === 422) setShowPaste(true);
    } finally {
      setRunning(false);
    }
  }

  async function remove(item: AdminClipping) {
    if (!window.confirm(`删除《${item.title}》的收藏？笔记文件与它的索引会一起删掉。`)) return;
    setNotice('');
    setError('');
    try {
      await adminDeleteClipping(item.id);
      setNotice(`已删除《${item.title}》`);
      if (result?.url === item.url) setResult(null);
      await load();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-medium text-ink-text">收藏</h1>
          <p className="mt-1 text-[12px] text-ink-dim">
            共 {items.length} 条 · 贴链接就入库，摘抄与原文 PDF 一起生成，收藏完立刻能被助手引用
          </p>
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit({ url: form.url, paste: form.paste, title: form.title });
        }}
        className="space-y-3 rounded-2xl border border-ink-line bg-ink-panel/60 p-4"
      >
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-ink-dim">文章链接</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://mp.weixin.qq.com/s/..."
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-ink-line bg-ink-soft px-3 py-2 text-[12.5px] text-ink-text outline-none transition focus:border-accent"
            />
            <button
              type="submit"
              disabled={running || !form.url.trim()}
              className="shrink-0 rounded-xl bg-accent px-4 py-2 text-[12px] font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {running ? '处理中…' : '收藏'}
            </button>
          </div>
        </label>

        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          className="text-[11.5px] text-ink-dim transition hover:text-ink-text"
        >
          {showPaste ? '收起粘贴区' : '抓不到正文？粘贴全文（公众号常见）'}
        </button>

        {showPaste && (
          <div className="space-y-3 rounded-xl border border-ink-line/70 bg-ink-soft/40 p-3">
            <p className="text-[11px] leading-relaxed text-ink-dim">
              从浏览器全选复制正文粘进来。第一行当标题；填了下面的标题就整段都是正文。
              粘贴模式会跳过抓取，其余流程完全一样。
            </p>
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-ink-dim">标题（可留空，留空则取第一行）</span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="留空就用正文第一行"
                className="w-full rounded-xl border border-ink-line bg-ink-panel px-3 py-2 text-[12.5px] text-ink-text outline-none transition focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-ink-dim">正文</span>
              <textarea
                value={form.paste}
                onChange={(e) => setForm({ ...form, paste: e.target.value })}
                rows={8}
                placeholder="把文章正文粘到这里，至少两行、40 字以上"
                className="w-full resize-y rounded-xl border border-ink-line bg-ink-panel px-3 py-2 text-[12px] leading-relaxed text-ink-text outline-none transition focus:border-accent"
              />
            </label>
            <button
              type="button"
              disabled={running || !form.url.trim() || !form.paste.trim()}
              onClick={() => submit({ url: form.url, paste: form.paste, title: form.title })}
              className="rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-2 text-[12px] font-medium text-accent-ink transition hover:bg-accent/15 disabled:opacity-50"
            >
              用粘贴的全文收藏
            </button>
          </div>
        )}

        {running && (
          <p className="rounded-xl border border-ink-line bg-ink-soft/50 px-3.5 py-2 text-[11.5px] leading-relaxed text-ink-dim">
            正在跑管道：抓取 → 摘抄 → 生成原文 PDF → 写入笔记 → 重建索引。
            图片多的文章要十几秒，别关页面。
          </p>
        )}
      </form>

      {notice && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2 text-[12px] text-emerald-600 dark:text-emerald-400">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3.5 py-2 text-[12px] leading-relaxed text-rose-500">
          {error}
        </p>
      )}

      {result && <ResultCard result={result} />}

      <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink-panel/60">
        {loading && <p className="px-4 py-6 text-center text-[12px] text-ink-dim">加载中…</p>}
        {!loading && items.length === 0 && (
          <p className="px-4 py-6 text-center text-[12px] text-ink-dim">还没有收藏，贴个链接试试</p>
        )}
        {!loading &&
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {item.postExists ? (
                    <Link
                      href={`/posts/${encodeURIComponent(item.slug)}`}
                      className="truncate text-[13px] font-medium text-ink-text transition hover:text-accent-ink"
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <span className="truncate text-[13px] font-medium text-ink-text">{item.title}</span>
                  )}
                  <span className="shrink-0 rounded-full bg-ink-line/60 px-2 py-0.5 text-[10px] text-ink-dim">
                    {ORIGIN_LABEL[item.origin] ?? item.origin}
                  </span>
                  {!item.indexable && (
                    <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      图片为主 · 不进检索
                    </span>
                  )}
                  {!item.postExists && (
                    <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-500">
                      笔记已丢
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-ink-dim">
                  {item.createdAt} · {item.wordCount} 字 · {item.sourcePath || '没有笔记文件'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] text-ink-dim transition hover:text-ink-text"
                >
                  原文
                </a>
                {item.hasPdf && (
                  <a
                    href={pdfHref(item.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-ink-dim transition hover:text-ink-text"
                  >
                    PDF
                  </a>
                )}
                {item.postExists && item.slug && (
                  <Link
                    href={`/admin/posts/${encodeURIComponent(item.slug)}`}
                    className="text-[12px] text-ink-dim transition hover:text-ink-text"
                  >
                    编辑
                  </Link>
                )}
                <button
                  type="button"
                  disabled={running}
                  onClick={() => submit({ url: item.url })}
                  className="text-[12px] text-ink-dim transition hover:text-ink-text disabled:opacity-50"
                >
                  重新收藏
                </button>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="text-[12px] text-ink-dim transition hover:text-rose-500"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-dim">
        收藏会写一篇 Obsidian 笔记到 <code>content/sample-vault/clippings/</code>，再全量重建索引——
        和命令行 <code>python -m scripts.clip</code> 走的是同一份代码。
        「删除」同时删笔记文件与它的索引，不会留下搜得到但打不开的文章。
      </p>
    </div>
  );
}

/** 一次收藏的明细：五段流水线各自发生了什么，失败/降级一眼能看见。 */
function ResultCard({ result }: { result: ClipResult }) {
  return (
    <div className="space-y-3 rounded-2xl border border-ink-line bg-ink-panel/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
          已完成
        </span>
        <h2 className="text-[13px] font-medium text-ink-text">{result.title}</h2>
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-dim">
        {result.chars} 字 · {SUMMARY_LABEL[result.summarySource] ?? result.summarySource} ·{' '}
        {result.pdfBytes > 0 ? `原文 PDF ${Math.round(result.pdfBytes / 1024)} KB` : '没有 PDF 存档'} ·{' '}
        {result.indexable ? `已进检索（全库 ${result.stats.posts} 篇 / ${result.stats.chunks} 块）` : '原文没字，未进检索'}
      </p>
      <ol className="space-y-1">
        {result.steps.map((step, i) => (
          <li key={`${step.label}-${i}`} className="flex gap-2 text-[11.5px] leading-relaxed">
            <span className="shrink-0 text-emerald-600 dark:text-emerald-400">✓</span>
            <span className="text-ink-text">{step.label}</span>
            {step.detail && <span className="min-w-0 text-ink-dim">{step.detail}</span>}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3 pt-0.5">
        {result.slug && (
          <Link
            href={`/posts/${encodeURIComponent(result.slug)}`}
            className="text-[12px] font-medium text-accent-ink transition hover:opacity-80"
          >
            查看文章 →
          </Link>
        )}
        {result.slug && (
          <Link
            href={`/admin/posts/${encodeURIComponent(result.slug)}`}
            className="text-[12px] text-ink-dim transition hover:text-ink-text"
          >
            去写作区调整摘要 / 正文 →
          </Link>
        )}
        {result.pdfBytes > 0 && (
          <a
            href={pdfHref(result.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-ink-dim transition hover:text-ink-text"
          >
            打开原文 PDF ↗
          </a>
        )}
      </div>
    </div>
  );
}
