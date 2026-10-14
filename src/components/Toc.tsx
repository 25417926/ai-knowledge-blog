'use client';

import { useEffect, useState } from 'react';

export type TocItem = { id: string; text: string; level: 2 | 3 };

/**
 * 正文目录。
 *
 * 标题与锚点 id 直接从已渲染的 HTML 里抓（见 lib/markdown.ts 的 extractHeadings），
 * 不再二次推导 slug —— rehype-slug 的规则对中文、重复标题的处理细节不少，
 * 重算一遍迟早会对不上，索性以最终 HTML 为准。
 *
 * 当前所在小节用 IntersectionObserver 判定，桌面上吸顶、移动端收进折叠面板。
 */
export function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? '');

  useEffect(() => {
    if (items.length === 0) return;
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // 同时可见多个时取最靠上的那个，否则高亮会在两节之间乱跳
        const first = items.find((item) => visible.has(item.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-88px 0px -68% 0px', threshold: 0 },
    );

    headings.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  if (items.length < 2) return null;

  function jump(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 让地址栏跟上，方便直接把小节链接发给别人
    history.replaceState(null, '', `#${id}`);
  }

  const list = (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id} style={{ paddingLeft: item.level === 3 ? '0.85rem' : undefined }}>
          <button
            type="button"
            onClick={() => jump(item.id)}
            aria-current={active === item.id ? 'location' : undefined}
            className={`block w-full border-l-2 py-0.5 pl-3 text-left text-[12.5px] leading-5 transition-colors duration-300 ${
              active === item.id
                ? 'border-accent font-medium text-accent-ink'
                : 'border-ink-line text-ink-dim hover:border-accent/50 hover:text-ink-text'
            }`}
          >
            {item.text}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {/* 桌面：右侧吸顶 */}
      <nav aria-label="目录" className="hidden lg:block">
        <div className="sticky top-24">
          <p className="mb-3 font-mono text-[10.5px] tracking-[0.3em] text-ink-dim">TABLE OF CONTENTS</p>
          {list}
        </div>
      </nav>

      {/* 移动：折叠 */}
      <details className="card mb-8 lg:hidden">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink-text">
          目录 · {items.length} 节
        </summary>
        <div className="px-4 pb-4">{list}</div>
      </details>
    </>
  );
}
