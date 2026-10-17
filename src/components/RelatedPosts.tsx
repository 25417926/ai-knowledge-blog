import Link from 'next/link';
import { coverVars } from '@/lib/cover';
import { categoryLabel } from '@/lib/categoryLabel';
import type { RelatedPost } from '@/lib/api';

/**
 * 文章页的「相关文章」。
 *
 * 出链 / 反向链接两块只认显式 `[[双链]]`，孤立文章在那里通篇是空的——这块补的正是那种情况：
 * 后端按「共同标签 / 同被一轮问答引用 / 内容重合」把**本文没链接到**的近邻捞出来
 * （见 `server/app/services/content.py` 的 `related_posts`）。
 *
 * 关键是把召回的理由一起显示出来：读者看到一排没来由的推荐只会当广告，
 * 写着「共同标签 #Java」才说得通。理由由后端算，前端只负责翻译成人话。
 */

/** 每张卡最多摊几条理由：再多也改不了结论，只把卡片撑高 */
const MAX_REASONS = 3;

export function RelatedPosts({
  items,
  category,
}: {
  items: RelatedPost[];
  /** 本文分类：仅用于把「同类目」这条理由写具体 */
  category: string;
}) {
  // 没有近邻就整块不出现，不留空壳
  if (items.length === 0) return null;

  return (
    <section className="mt-12" aria-label="相关文章" data-related-count={items.length}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[10.5px] tracking-[0.3em] text-ink-dim">RELATED</span>
          <h2 className="text-[15.5px] font-semibold tracking-wide text-ink-text">相关文章</h2>
        </div>
        <span className="text-[11.5px] text-ink-dim">本文没链到，按关系网召回</span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <Link
            key={item.slug}
            href={`/posts/${encodeURIComponent(item.slug)}`}
            className="card group flex flex-col p-5"
            style={coverVars(item.category)}
            data-related-slug={item.slug}
          >
            <span className="font-mono text-[10.5px] tracking-[0.24em] text-ink-text/60">
              {categoryLabel(item.category)}
            </span>

            <span className="mt-2 line-clamp-2 font-serif text-[15px] font-semibold leading-6 text-ink-text transition-colors group-hover:text-accent-ink">
              {item.title}
            </span>

            {item.summary && (
              <span className="mt-2 line-clamp-2 text-[12.5px] leading-6 text-ink-dim">
                {item.summary}
              </span>
            )}

            <span className="mt-3.5 flex flex-wrap gap-1.5">
              {reasonsOf(item, category).map((reason) => (
                <span
                  key={reason}
                  className="rounded-full border border-ink-text/20 px-2.5 py-0.5 text-[11px] text-ink-text/70"
                >
                  {reason}
                </span>
              ))}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** 把后端的证据翻成看得懂的一句话；实在没有可说的就退到「主题相近」 */
function reasonsOf(item: RelatedPost, category: string): string[] {
  const reasons = item.sharedTags.map((tag) => `共同标签 #${tag}`);
  if (item.coCitations > 0) reasons.push(`同被 ${item.coCitations} 轮问答引用`);
  if (reasons.length === 0) {
    reasons.push(item.category === category ? `同属 ${categoryLabel(category)}` : '主题相近');
  }
  return reasons.slice(0, MAX_REASONS);
}
