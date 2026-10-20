import type { GraphData } from '@/lib/api';

/**
 * 关系网的纯计算：去重边、确定性力导布局、半径、标题截断。
 *
 * 只有一份算法是硬要求：静态 SVG（首屏 / 无 WebGL / 减弱动效）与 three.js 画布
 * （交互层）两层交叉淡入，节点坐标必须逐像素重合，否则切换那一帧会整体跳一下。
 */

export const GRAPH_W = 680;
export const GRAPH_H = 460;
const PAD = 44;

export type Point = { x: number; y: number };

/** 去重无向边：a→b 与 b→a 只画一条，否则重叠处颜色发黑 */
export function undirectedEdges(data: GraphData): [string, string][] {
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

/** 邻接表：悬停时「自己 + 邻居」保持明亮，其余淡出 */
export function neighboursOf(links: [string, string][]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [a, b] of links) {
    if (!map.has(a)) map.set(a, new Set());
    if (!map.has(b)) map.set(b, new Set());
    map.get(a)!.add(b);
    map.get(b)!.add(a);
  }
  return map;
}

/** 半径按双链条数递增，上限 18：孤立文章是小点，枢纽是大点 */
export function nodeRadius(degree: number): number {
  return Math.min(18, 7 + degree * 1.9);
}

/** 标题在图上只能占一行：按视觉宽度截断（中文算 2、ASCII 算 1），
 *  不能按字符数切——「memberclub 双引擎」按 9 个字切会变成「memberclu…」 */
export function shortTitle(title: string): string {
  const LIMIT = 20;
  let width = 0;
  let out = '';
  for (const ch of title) {
    const w = /[\x00-\xff]/.test(ch) ? 1 : 2;
    if (width + w > LIMIT) return `${out.trimEnd()}…`;
    width += w;
    out += ch;
  }
  return out;
}

/**
 * 确定性力导：初始位置按分类排在一圈上，然后跑固定 220 轮斥力 + 弹簧 + 向心。
 * 没有随机数、没有 tick——两层的坐标必须在渲染前就算死。
 */
export function layoutGraph(data: GraphData): Map<string, Point> {
  const nodes = [...data.nodes].sort(
    (a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug),
  );
  const pos = new Map<string, Point>();
  const n = nodes.length;
  nodes.forEach((node, i) => {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    pos.set(node.slug, {
      x: GRAPH_W / 2 + Math.cos(angle) * 150,
      y: GRAPH_H / 2 + Math.sin(angle) * 105,
    });
  });
  if (n < 2) {
    if (n === 1) pos.set(nodes[0].slug, { x: GRAPH_W / 2, y: GRAPH_H / 2 });
    return pos;
  }

  const links = undirectedEdges(data).filter(([a, b]) => pos.has(a) && pos.has(b));
  const REST = 92;
  const index = new Map(nodes.map((node, i) => [node.slug, i]));

  for (let iter = 0; iter < 220; iter += 1) {
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);

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
      const stepX = fx[i] + (GRAPH_W / 2 - p.x) * 0.014;
      const stepY = fy[i] + (GRAPH_H / 2 - p.y) * 0.02;
      p.x = Math.min(GRAPH_W - PAD, Math.max(PAD, p.x + Math.max(-14, Math.min(14, stepX))));
      p.y = Math.min(GRAPH_H - PAD, Math.max(PAD, p.y + Math.max(-14, Math.min(14, stepY))));
    });
  }
  return pos;
}
