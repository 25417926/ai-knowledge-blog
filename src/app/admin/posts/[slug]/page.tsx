'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  AdminError,
  adminCreatePost,
  adminDeletePost,
  adminGetPost,
  adminSummarize,
  adminUpdatePost,
  type AdminPostInput,
} from '@/lib/admin';

const EMPTY: AdminPostInput = {
  title: '',
  summary: '',
  category: '',
  tags: [],
  date: '',
  status: 'published',
  content: '',
};

const FIELD =
  'w-full rounded-xl border border-ink-line bg-ink-soft px-3 py-2 text-[13px] text-ink-text outline-none transition focus:border-accent';

const GHOST =
  'shrink-0 rounded-lg border border-ink-line px-2.5 py-1 text-[11px] text-ink-dim transition hover:text-ink-text disabled:opacity-40';
const GHOST_ACCENT =
  'shrink-0 rounded-lg border border-accent/40 px-2.5 py-1 text-[11px] text-accent-ink transition hover:bg-accent/10 disabled:opacity-40';

function Label({ text, hint }: { text: string; hint?: string }) {
  return (
    <span className="mb-1.5 block text-[11px] text-ink-dim">
      {text}
      {hint && <span className="ml-1.5 opacity-70">{hint}</span>}
    </span>
  );
}

export default function AdminEditorPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  // useParams 给的是路由里**未解码**的那一段（中文 slug 会拿到 %E5%88%A0…），
  // 先解回来，之后统一用 encodeURIComponent 拼请求，否则会双重编码成 404。
  const slug = decodeURIComponent(params.slug);
  const isNew = slug === 'new';

  const [form, setForm] = useState<AdminPostInput>(EMPTY);
  const [tagText, setTagText] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [busy, setBusy] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // 摘要按钮的运行态：'' 空闲 / 'extract' 抽取中 / 'ai' 模型生成中
  const [generating, setGenerating] = useState<'' | 'extract' | 'ai'>('');
  const [summaryNote, setSummaryNote] = useState('');

  // 新建成功后要跳到真实 slug，那次跳转会把组件重挂、state 清空，
  // 所以回执另挂一份在 URL 上带过来。抹参数用浏览器原生 API：
  // 走 router 会再重挂一次，刚拿到的回执又没了。
  // 依赖 slug：新建保存后是 `router.replace` 到同一路由段的另一个参数，**组件不会重挂**，
  // 空依赖的 effect 不会重跑 —— 表现就是回执既不显示、URL 上的 `?saved=1` 也清不掉。
  useEffect(() => {
    const flags = new URLSearchParams(window.location.search);
    if (!flags.has('saved')) return;
    // 「摘要是自动来的」也挂在 URL 上带过来，这里一起说清
    setNotice(
      flags.get('summary') === 'auto'
        ? '已保存到 Vault，摘要留空已自动抽取，索引已重建'
        : '已保存到 Vault，索引已重建',
    );
    window.history.replaceState(null, '', window.location.pathname);
  }, [slug]);

  useEffect(() => {
    if (isNew) {
      // 「访客意图」的缺口清单点「为它写一篇」时会带一个 `?title=`：
      // 带过来的就是访客的原话，正好当标题；正文留空，缺的那一段要人来写。
      const preset = new URLSearchParams(window.location.search).get('title') ?? '';
      setForm({ ...EMPTY, title: preset });
      setTagText('');
      setSourcePath('');
      setBusy(false);
      return;
    }    let alive = true;
    setBusy(true);
    adminGetPost(slug)
      .then((post) => {
        if (!alive) return;
        setForm({
          title: post.title,
          summary: post.summary,
          category: post.category,
          tags: post.tags,
          date: post.publishedAt ?? '',
          status: post.status,
          content: post.content,
        });
        setTagText(post.tags.join(', '));
        setSourcePath(post.sourcePath);
        setError('');
      })
      .catch((err) => {
        if (alive) setError(err instanceof AdminError ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [slug, isNew]);

  const patch = (part: Partial<AdminPostInput>) => setForm((prev) => ({ ...prev, ...part }));

  const chars = form.content.replace(/\s/g, '').length;
  const fromClipping = sourcePath.startsWith('clippings/');

  /**
   * 生成摘要。两档分工：
   * - 抽取：纯函数、毫秒级，与「留空保存」走的是同一份实现，所以按钮看到的结果＝保存后的结果；
   * - AI：走模型；正文里已有摘要时是「优化」——保住作者原本想强调的重点，只改表达。
   */
  async function gen(mode: 'extract' | 'ai') {
    if (!form.content.trim() || generating) return;
    const hadSummary = Boolean(form.summary.trim());
    setGenerating(mode);
    setError('');
    setSummaryNote('');
    try {
      const res = await adminSummarize({
        title: form.title,
        content: form.content,
        current: form.summary,
        mode,
      });
      patch({ summary: res.summary });
      setSummaryNote(
        res.source === 'llm'
          ? `模型已${hadSummary ? '优化' : '生成'}，可继续手改`
          : (res.note ?? '已从正文首段抽取'),
      );
    } catch (err) {
      setError(err instanceof AdminError ? err.message : String(err));
    } finally {
      setGenerating('');
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    setError('');
    const payload: AdminPostInput = {
      ...form,
      tags: tagText
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
    };
    try {
      const result = isNew
        ? await adminCreatePost(payload)
        : await adminUpdatePost(slug, payload);
      setSourcePath(result.sourcePath);
      // 摘要留空时后端兜了一句并写进 frontmatter —— 回填输入框，否则界面上看着还是空的，
      // 下次再保存又会重新抽一遍（内容虽一样，但作者会以为「没生效」）
      if (result.summaryGenerated && result.summary) {
        patch({ summary: result.summary });
        setSummaryNote('摘要留空，保存时已自动从正文抽取并写入');
      }
      setNotice(`已保存到 ${result.sourcePath}，索引已重建`);
      if (isNew) {
        const auto = result.summaryGenerated ? '&summary=auto' : '';
        router.replace(`/admin/posts/${encodeURIComponent(result.slug)}?saved=1${auto}`);
      }
    } catch (err) {
      setError(err instanceof AdminError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`确定删除《${form.title}》？文件与索引都会一起删掉。`)) return;
    try {
      await adminDeletePost(slug);
      router.replace('/admin/posts');
    } catch (err) {
      setError(err instanceof AdminError ? err.message : String(err));
    }
  }

  if (busy) {
    return <p className="py-10 text-center text-[12px] text-ink-dim">加载中…</p>;
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-medium text-ink-text">{isNew ? '新建文章' : '编辑文章'}</h1>
          <p className="mt-1 text-[12px] text-ink-dim">
            {isNew ? '保存后自动落到 Vault 并重建索引' : `${slug}${sourcePath ? ` · ${sourcePath}` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/posts" className="text-[12px] text-ink-dim transition hover:text-ink-text">
            返回列表
          </Link>
          {!isNew && (
            <button
              type="button"
              onClick={remove}
              className="text-[12px] text-ink-dim transition hover:text-rose-500"
            >
              删除
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-accent px-4 py-2 text-[12px] font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </header>

      {sourcePath.startsWith('clippings/') && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2 text-[12px] leading-relaxed text-amber-600 dark:text-amber-400">
          这是收藏管道的自动产物，重跑 <code className="font-mono">scripts.clip</code> 会覆盖这里的改动。
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2 text-[12px] text-emerald-600 dark:text-emerald-400">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3.5 py-2 text-[12px] text-rose-500">
          {error}
        </p>
      )}

      <div className="space-y-4 rounded-2xl border border-ink-line bg-ink-panel/60 p-4">
        <div>
          <Label text="标题" hint="新建时用作文件名与 slug，之后不再变" />
          <input
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
            className={FIELD}
            placeholder="一篇文章的标题"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label text="分类" hint="新建时决定所在目录" />
            <input
              value={form.category}
              onChange={(e) => patch({ category: e.target.value })}
              className={FIELD}
              placeholder="Java"
            />
          </div>
          <div>
            <Label text="日期" />
            <input
              type="date"
              value={form.date}
              onChange={(e) => patch({ date: e.target.value })}
              className={FIELD}
            />
          </div>
          <div>
            <Label text="状态" />
            <select
              value={form.status}
              onChange={(e) => patch({ status: e.target.value as AdminPostInput['status'] })}
              className={FIELD}
            >
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
            </select>
          </div>
        </div>
        <div>
          <Label text="标签" hint="逗号分隔" />
          <input
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            className={FIELD}
            placeholder="Java, JVM, 性能调优"
          />
        </div>
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-ink-dim">
              摘要
              <span className="ml-1.5 opacity-70">留空保存会自动从正文抽取</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => gen('extract')}
                disabled={Boolean(generating) || !form.content.trim()}
                className={GHOST}
                title="从正文首段抽一到两句，不走模型"
              >
                {generating === 'extract' ? '抽取中…' : '从正文抽取'}
              </button>
              <button
                type="button"
                onClick={() => gen('ai')}
                disabled={Boolean(generating) || !form.content.trim()}
                className={GHOST_ACCENT}
                title={form.summary.trim() ? '让模型改进这句摘要的表达' : '让模型读正文写一句摘要'}
              >
                {generating === 'ai' ? '生成中…' : form.summary.trim() ? 'AI 优化' : 'AI 生成'}
              </button>
            </div>
          </div>
          <input
            value={form.summary}
            onChange={(e) => {
              patch({ summary: e.target.value });
              setSummaryNote('');
            }}
            className={FIELD}
            placeholder="一句话说清这篇讲了什么"
          />
          {summaryNote ? (
            <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">{summaryNote}</p>
          ) : (
            fromClipping && (
              <p className="mt-1 text-[11px] text-ink-dim">
                这句来自收藏时 AI 摘抄的导语。可以直接改，也可以点「AI 优化」让它重写。
              </p>
            )
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-ink-line bg-ink-panel/60 p-4">
        <div className="mb-1.5 flex items-center justify-between">
          <Label text="正文" hint="Markdown，不含 frontmatter" />
          <span className="text-[11px] text-ink-dim">{chars} 字</span>
        </div>
        <textarea
          value={form.content}
          onChange={(e) => patch({ content: e.target.value })}
          rows={22}
          spellCheck={false}
          className="w-full resize-y rounded-xl border border-ink-line bg-ink-soft px-3 py-2.5 font-mono text-[12.5px] leading-[1.7] text-ink-text outline-none transition focus:border-accent"
          placeholder={'## 小节标题\n\n正文段落，[[双链]] 也会被解析。'}
        />
      </div>
    </form>
  );
}
