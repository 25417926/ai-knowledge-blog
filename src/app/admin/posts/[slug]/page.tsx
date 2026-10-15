'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  AdminError,
  adminCreatePost,
  adminDeletePost,
  adminGetPost,
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

  // 新建成功后要跳到真实 slug，那次跳转会把组件重挂、state 清空，
  // 所以回执另挂一份在 URL 上带过来。抹参数用浏览器原生 API：
  // 走 router 会再重挂一次，刚拿到的回执又没了。
  useEffect(() => {
    const flags = new URLSearchParams(window.location.search);
    if (!flags.has('saved')) return;
    setNotice('已保存到 Vault，索引已重建');
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  useEffect(() => {
    if (isNew) {
      setForm(EMPTY);
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
      setNotice(`已保存到 ${result.sourcePath}，索引已重建`);
      if (isNew) router.replace(`/admin/posts/${encodeURIComponent(result.slug)}?saved=1`);
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
          <Label text="摘要" hint="列表页与卡片上的一行简介" />
          <input
            value={form.summary}
            onChange={(e) => patch({ summary: e.target.value })}
            className={FIELD}
          />
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
