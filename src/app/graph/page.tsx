import type { Metadata } from 'next';
import Link from 'next/link';
import { LinkGraph } from '@/components/LinkGraph';
import { PageHeader } from '@/components/PageHeader';
import { categoryLabel } from '@/lib/categoryLabel';
import { categoryColor } from '@/lib/cover';
import { getGraph } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '关系网',
  description: '全站双链的可视化：节点是文章，连线是笔记里手写的 [[双链]]。孤立文章另有一栏。',
};

export default async function GraphPage() {
  const data = await getGraph();

  const byCategory = new Map<string, number>();
  for (const node of data.nodes) {
    byCategory.set(node.category, (byCategory.get(node.category) ?? 0) + 1);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  // 没有任何连线的文章不会在图里「看得见」（它们是散点），单独列出来才有下一跳
  const isolated = data.nodes.filter((node) => node.degree === 0);

  return (
    <main className="mx-auto max-w-[1150px] px-5 pb-8 pt-12 sm:px-8">
      <PageHeader
        kicker="KNOWLEDGE GRAPH"
        title="关系网"
        description="节点是一篇文章，连线是笔记里手写的 [[双链]]。点节点进文章；悬停只看它自己的连接。"
      >
        <p className="mt-4 font-mono text-[11.5px] tracking-wide text-ink-dim">
          {data.nodes.length} 个节点 · {data.edges.length} 条连线 · {isolated.length} 篇孤立
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {categories.map(([category, count]) => (
            <li key={category} className="flex items-center gap-1.5 text-[12px] text-ink-dim">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: `rgb(${categoryColor(category).from})` }}
              />
              {categoryLabel(category)}
              <span className="text-ink-dim/70">{count}</span>
            </li>
          ))}
        </ul>
      </PageHeader>

      {data.nodes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink-line p-14 text-center">
          <p className="text-[14px] text-ink-text">还没有可画的节点</p>
          <p className="mt-2 text-[12.5px] text-ink-dim">
            文章导入后这里才会出现关系网，先跑一次 <code>npm run setup</code>。
          </p>
        </div>
      ) : (
        <LinkGraph data={data} />
      )}

      {isolated.length > 0 && (
        <section className="mt-8" aria-label="孤立文章">
          <h2 className="font-serif text-[16px] font-semibold text-ink-text">还没接上双链的文章</h2>
          <p className="mt-2 max-w-2xl text-[12.5px] leading-6 text-ink-dim">
            它们在图上是散点。文章页的「相关文章」会按共同标签、同被追问、内容重合补下一跳，
            所以不是死路——但真正连起来得在笔记里补一条 <code>[[双链]]</code>。
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {isolated.map((node) => (
              <li key={node.slug}>
                <Link
                  href={`/posts/${encodeURIComponent(node.slug)}`}
                  className="inline-flex items-center gap-2 rounded-full border border-ink-line px-3 py-1.5 text-[12.5px] text-ink-text transition-colors hover:border-accent/60 hover:text-accent-ink"
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: `rgb(${categoryColor(node.category).from})` }}
                  />
                  {node.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
