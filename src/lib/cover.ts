/**
 * 分类配色：给每个分类分配一组恒定的渐变色。
 *
 * 一套颜色三处复用——博客卡片封面、图谱节点、小镇街区地面。
 * 因此「Java 街是靛蓝、Agent 街是青色」在双端是同一个事实，不需要各维护一份。
 * 返回空格分隔的 RGB 通道串，便于在 CSS 里用 rgb(var(--x) / <alpha>) 调透明度。
 */

export type CoverColors = { from: string; to: string };

/** 8 组冷色系配色，与站点靛紫基调一致 */
const PALETTE: CoverColors[] = [
  { from: '99 102 241', to: '56 189 248' }, // 靛蓝 → 天蓝
  { from: '139 92 246', to: '236 72 153' }, // 紫罗兰 → 品红
  { from: '14 165 233', to: '45 212 191' }, // 天蓝 → 青绿
  { from: '16 185 129', to: '132 204 22' }, // 翡翠 → 黄绿
  { from: '217 70 239', to: '129 140 248' }, // 品红 → 靛蓝
  { from: '245 158 11', to: '244 63 94' }, // 琥珀 → 玫红
  { from: '59 130 246', to: '139 92 246' }, // 蓝 → 紫
  { from: '6 182 212', to: '99 102 241' }, // 青色 → 靛蓝
];

/** 稳定哈希：同一分类在任何机器、任何运行时刻都得到同一配色 */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function categoryColor(category: string): CoverColors {
  if (!category) return PALETTE[0];
  return PALETTE[hash(category) % PALETTE.length];
}

/** 交给 CSS 的自定义属性，配合 globals.css 里的 .card::before 使用 */
export function coverVars(category: string): Record<string, string> {
  const { from, to } = categoryColor(category);
  return { '--cover-a': from, '--cover-b': to };
}
