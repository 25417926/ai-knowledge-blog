'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AdminError,
  adminCreateFriend,
  adminDeleteFriend,
  adminListFriends,
  adminUpdateFriend,
  type AdminFriend,
  type AdminFriendInput,
} from '@/lib/admin';

const EMPTY = { name: '', href: '', description: '', tags: '' };

function hostOf(href: string) {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

/** 标签在表单里就是一行逗号分隔的文本，省掉一组动态输入框 */
function parseTags(raw: string) {
  return raw
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] text-ink-dim">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-ink-line bg-ink-soft px-3 py-2 text-[12.5px] text-ink-text outline-none transition focus:border-accent"
      />
    </label>
  );
}

export default function AdminFriendsPage() {
  const [items, setItems] = useState<AdminFriend[]>([]);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setBusy(true);
    return adminListFriends()
      .then((rows) => {
        setItems(rows);
        setError('');
      })
      .catch((err) => setError(err instanceof AdminError ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const openNew = () => {
    setEditing('new');
    setForm(EMPTY);
    setNotice('');
    setError('');
  };

  const openEdit = (friend: AdminFriend) => {
    setEditing(friend.id);
    setNotice('');
    setError('');
    setForm({
      name: friend.name,
      href: friend.href,
      description: friend.description,
      tags: friend.tags.join(', '),
    });
  };

  async function save() {
    setSaving(true);
    setNotice('');
    setError('');
    const input: AdminFriendInput = {
      name: form.name,
      href: form.href,
      description: form.description,
      tags: parseTags(form.tags),
    };
    try {
      if (editing === 'new') {
        await adminCreateFriend(input);
        setNotice(`已添加 ${input.name}`);
      } else if (typeof editing === 'number') {
        await adminUpdateFriend(editing, input);
        setNotice(`已更新 ${input.name}`);
      }
      close();
      await load();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(friend: AdminFriend) {
    if (!window.confirm(`确定删除「${friend.name}」？`)) return;
    setNotice('');
    setError('');
    try {
      await adminDeleteFriend(friend.id);
      setNotice(`已删除 ${friend.name}`);
      if (editing === friend.id) close();
      await load();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-medium text-ink-text">友链</h1>
          <p className="mt-1 text-[12px] text-ink-dim">共 {items.length} 条 · 这里的顺序就是前台显示的顺序</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="rounded-xl bg-accent px-3.5 py-2 text-[12px] font-medium text-white transition hover:opacity-90"
        >
          添加友链
        </button>
      </header>

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

      {editing !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-3 rounded-2xl border border-ink-line bg-ink-panel/60 p-4"
        >
          <h2 className="text-[13px] font-medium text-ink-text">
            {editing === 'new' ? '添加友链' : '编辑友链'}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="站点名"
              value={form.name}
              placeholder="对方的站叫什么"
              onChange={(v) => setForm({ ...form, name: v })}
            />
            <Field
              label="链接"
              value={form.href}
              placeholder="https://"
              onChange={(v) => setForm({ ...form, href: v })}
            />
          </div>
          <Field
            label="一句话介绍"
            value={form.description}
            placeholder="写成对方会愿意被人看到的样子"
            onChange={(v) => setForm({ ...form, description: v })}
          />
          <Field
            label="标签（逗号分隔，可留空）"
            value={form.tags}
            placeholder="Java, 排查"
            onChange={(v) => setForm({ ...form, tags: v })}
          />
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-accent px-3.5 py-2 text-[12px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-xl border border-ink-line px-3.5 py-2 text-[12px] text-ink-dim transition hover:text-ink-text"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink-panel/60">
        {busy && <p className="px-4 py-6 text-center text-[12px] text-ink-dim">加载中…</p>}
        {!busy && items.length === 0 && (
          <p className="px-4 py-6 text-center text-[12px] text-ink-dim">还没有友链</p>
        )}
        {!busy &&
          items.map((friend) => (
            <div
              key={friend.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-line px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={friend.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-[13px] font-medium text-ink-text transition hover:text-accent-ink"
                  >
                    {friend.name}
                  </a>
                  {friend.tags.map((tag) => (
                    <span
                      key={tag}
                      className="shrink-0 rounded-full bg-ink-line/60 px-2 py-0.5 text-[10px] text-ink-dim"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-ink-dim">
                  {hostOf(friend.href)} · {friend.description || '没有介绍'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => openEdit(friend)}
                  className="text-[12px] text-ink-dim transition hover:text-ink-text"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => remove(friend)}
                  className="text-[12px] text-ink-dim transition hover:text-rose-500"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-dim">
        友链只存数据库，改完立刻在 /friends 生效，不需要重建索引，也不影响文章检索。
      </p>
    </div>
  );
}
