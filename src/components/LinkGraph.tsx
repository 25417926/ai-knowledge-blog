'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { categoryColor, type CoverColors } from '@/lib/cover';
import type { GraphData } from '@/lib/api';

/**
 * 双链关系图。
 *
 * 布局是**确定性**力导：初始位置按分类排在一圈上，然后跑固定 220 轮斥力 + 弹簧 +
 * 向心。没有随机数、没有 tick、不引入任何图形库——服务端预渲染与客户端 hydrate
 * 必须算出同一组坐标，否则会有一帧跳位；而 12 个节点的力导在渲染期跑一次就够。
 *
 * 交互只做两件事：悬停高亮相邻节点与连线（其余淡出），点击进文章。
 */

const W = 680;
const H = 460;
const PAD = 44;

type Point = { x: number; y: number };

/** 去重无向边：a→b 与 b→a 只画一条线，否则重叠处颜色发黑 */
function undirected(data: GraphData): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const edge of data.edges) {
    const key = [edge.source, edge.target].sort().join('\u0000');
    if (seen.has(key) || edge.source === edge.target) continue;
    seen.add(key);
    out.push([edge.source, edge.target]);
  }
  return out;
}

function layout(data: GraphData): Map<string, Point> {
  const nodes = [...data.nodes].sort(
    (a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug),
  );
  const pos = new Map<string, Point>();
  const n = nodes.length;
  nodes.forEach((node, i) => {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    pos.set(node.slug, {
      x: W / 2 + Math.cos(angle) * 150,
      y: H / 2 + Math.sin(angle) * 105,
    });
  });
  if (n < 2) {
    if (n === 1) pos.set(nodes[0].slug, { x: W / 2, y: H / 2 });
    return pos;
  }

  const links = undirected(data).filter(([a, b]) => pos.has(a) && pos.has(b));
  const REST = 92;

  for (let iter = 0; iter < 220; iter += 1) {
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    const index = new Map(nodes.map((node, i) => [node.slug, i]));

    for (let i = 0; i < n; i += 1) {
      const pi = pos.get(nodes[i].slug)!;
      for (let j = i + 1; j < n; j += 1) {
        const pj = pos.get(nodes[j].slug)!;
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const d = Math.hypot(dx, dy) || 0.01;
        // 斥力随距离平方衰减：近处推开，远处几乎不作用，避免全图摊成一张网
        const power = 7600 / (d * d);
        const ux = (dx / d) * power;
        const uy = (dy / d) * power;
        fx[i] += ux;
        fy[i] += uy;
        fx[j] -= ux;
        fy[j] -= uy;
      }
    }

    for (const [a, b] of links) {
      const ia = index.get(a)!;
      const ib = index.get(b)!;
      const pa = pos.get(a)!;
      const pb = pos.get(b)!;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const pull = (d - REST) * 0.02;
      const ux = (dx / d) * pull;
      const uy = (dy / d) * pull;
      fx[ia] += ux;
      fy[ia] += uy;
      fx[ib] -= ux;
      fy[ib] -= uy;
    }

    nodes.forEach((node, i) => {
      const p = pos.get(node.slug)!;
      // 向心：没有连线的孤立节点不能飘出画布
      const stepX = fx[i] + (W / 2 - p.x) * 0.014;
      const stepY = fy[i] + (H / 2 - p.y) * 0.02;
      p.x = Math.min(W - PAD, Math.max(PAD, p.x + Math.max(-14, Math.min(14, stepX))));
      p.y = Math.min(H - PAD, Math.max(PAD, p.y + Math.max(-14, Math.min(14, stepY))));
    });
  }
  return pos;
}

/** 标题在图上只能占一行：超过 9 个字截断，完整标题进 title 与 aria-label */
function shortTitle(title: string): string {
  return title.length > 9 ? `${title.slice(0, 9)}…` : title;
}

function rgb(colors: CoverColors): string {
  return `rgb(${colors.from})`;
}

export function LinkGraph({ data }: { data: GraphData }) {
  const router = useRouter();
  const [active, setActive] = useState<string | null>(null);

  const pos = useMemo(() => layout(data), [data]);
  const links = useMemo(() => undirected(data), [data]);
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [a, b] of links) {
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    }
    return map;
  }, [links]);

  const dimmed = (slug: string) =>
    active !== null && active !== slug && !(neighbours.get(active)?.has(slug) ?? false);

  return (
    <div className="card relative overflow-hidden rounded-2xl border border-ink-line">
      {/* 移动端不缩放图：680 单位压到 350px 上，标签会变成 5px 的噪点。
          改成容器内横向滚动 + 最小宽度，滑动比「看不清」好。 */}
      <div className="relative z-10 overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto min-w-[600px] w-full"
          role="img"
          aria-label={`全站双链关系图：${data.nodes.length} 个节点，${data.edges.length} 条连线`}
        >
        {/* 连线先画，节点压在上面 */}
        <g stroke="rgb(var(--ink-line))" strokeWidth="1">
          {links.map(([a, b]) => {
            const pa = pos.get(a)!;
            const pb = pos.get(b)!;
            const lit = active !== null && (active === a || active === b);
            return (
              <line
                key={`${a}-${b}`}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                opacity={active === null ? 0.85 : lit ? 1 : 0.15}
                stroke={lit ? 'rgb(var(--accent))' : undefined}
                strokeWidth={lit ? 1.6 : 1}
              />
            );
          })}
        </g>

        {data.nodes.map((node) => {
          const p = pos.get(node.slug);
          if (!p) return null;
          const r = Math.min(18, 7 + node.degree * 1.9);
          const colors = categoryColor(node.category);
          return (
            <g
              key={node.slug}
              data-graph-node={node.slug}
              data-degree={node.degree}
              role="link"
              tabIndex={0}
              aria-label={`${node.title}（${node.degree} 条双链）`}
              className="cursor-pointer outline-none"
              opacity={dimmed(node.slug) ? 0.2 : 1}
              onMouseEnter={() => setActive(node.slug)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(node.slug)}
              onBlur={() => setActive(null)}
              onClick={() => router.push(`/posts/${encodeURIComponent(node.slug)}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  router.push(`/posts/${encodeURIComponent(node.slug)}`);
                }
              }}
            >
              <title>{`${node.title} · ${node.degree} 条双链`}</title>
              <circle cx={p.x} cy={p.y} r={r + 5} fill={rgb(colors)} opacity={0.16} />
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                fill={rgb(colors)}
                stroke={active === node.slug ? 'rgb(var(--accent))' : 'rgb(var(--ink-bg))'}
                strokeWidth={active === node.slug ? 2 : 1.5}
              />
              <text
                x={p.x}
                y={p.y + r + 13}
                textAnchor="middle"
                fontSize="10.5"
                fill="rgb(var(--ink-text))"
                opacity={0.82}
                style={{ pointerEvents: 'none' }}
              >
                {shortTitle(node.title)}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      <p className="relative z-10 px-4 pb-3 text-center text-[11px] text-ink-dim sm:hidden">
        图比屏幕宽，左右滑动看全
      </p>
    </div>
  );
}
