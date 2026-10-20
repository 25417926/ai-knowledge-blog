'use client';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { categoryColor, type CoverColors } from '@/lib/cover';
import type { GraphData } from '@/lib/api';
import {
  GRAPH_H,
  GRAPH_W,
  layoutGraph,
  neighboursOf,
  nodeRadius,
  shortTitle,
  undirectedEdges,
} from '@/lib/graph';

/**
 * 双链关系图：静态 SVG 管首屏与兜底，three.js 画布管交互（见 LinkGraphGL）。
 *
 * 两层用同一份 `layoutGraph()` 坐标，所以画布挂上来的那一帧节点不动，只是从
 * 「平面的点」变成「会呼吸、能拖、悬停点亮邻居的点」。
 *
 * 不加载画布的三种情况，都是故意的：服务端/无 JS（SVG 直接就是完整的一张图）、
 * 浏览器没有 WebGL2、用户开了「减弱动效」——最后一个不该被强行播放动画。
 */

export function LinkGraph({ data }: { data: GraphData }) {
  const router = useRouter();
  const [active, setActive] = useState<string | null>(null);
  const [Live, setLive] = useState<ComponentType<{ data: GraphData }> | null>(null);

  const pos = useMemo(() => layoutGraph(data), [data]);
  const links = useMemo(() => undirectedEdges(data), [data]);
  const neighbours = useMemo(() => neighboursOf(links), [links]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2')) return;
    let alive = true;
    import('./LinkGraphGL')
      .then((mod) => {
        if (alive) setLive(() => mod.LinkGraphGL);
      })
      .catch(() => {
        /* 画布起不来就继续用 SVG，不值得让整页报错 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const dimmed = (slug: string) =>
    active !== null && active !== slug && !(neighbours.get(active)?.has(slug) ?? false);

  return (
    <div className="card relative overflow-hidden rounded-2xl border border-ink-line">
      {/* 移动端不缩放图：680 单位压到 350px 上，标签会变成 5px 的噪点。
          改成容器内横向滚动 + 最小宽度，滑动比「看不清」好。 */}
      <div className="relative z-10 overflow-x-auto">
        <div className="relative aspect-[680/460] w-full min-w-[600px]">
          {/* 画布挂上后 SVG 保留在下面淡出（它定义了盒子的高度），
              data-graph-node 同时移交给画布的标签层，避免 e2e 数出两份 */}
          <svg
            viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
            className={`absolute inset-0 h-full w-full transition-opacity duration-200 ${
              Live ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
            role="img"
            aria-hidden={Live ? true : undefined}
            aria-label={Live ? undefined : `全站双链关系图：${data.nodes.length} 个节点，${data.edges.length} 条连线`}
          >
            {/* 连线先画，节点压在上面 */}
            <g stroke="rgb(var(--ink-line))" strokeWidth="1">
              {links.map(([a, b]) => {
                const pa = pos.get(a);
                const pb = pos.get(b);
                if (!pa || !pb) return null;
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
              const r = nodeRadius(node.degree);
              const colors = categoryColor(node.category);
              return (
                <g
                  key={node.slug}
                  data-graph-node={Live ? undefined : node.slug}
                  data-degree={Live ? undefined : node.degree}
                  role={Live ? undefined : 'link'}
                  tabIndex={Live ? -1 : 0}
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
                  {/* 画布挂上后文字的出处只留一处：两层同时画字会在淡出的 300ms 里叠影 */}
                  {!Live && (
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
                  )}
                </g>
              );
            })}
          </svg>

          {Live && <Live data={data} />}
        </div>
      </div>
      <p className="relative z-10 px-4 pb-3 text-center text-[11px] text-ink-dim sm:hidden">
        图比屏幕宽，左右滑动看全
      </p>
    </div>
  );
}

function rgb(colors: CoverColors): string {
  return `rgb(${colors.from})`;
}
