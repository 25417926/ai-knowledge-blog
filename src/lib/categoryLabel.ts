/**
 * 分类的显示名。
 *
 * 分类名直接来自笔记 frontmatter，手写的那些本来就是中文，原样显示即可；
 * 只有收藏管道写死的 `clippings` 是英文 slug，在导览卡和筛选条上会显得突兀，
 * 所以在这里给人看的场合换一个中文名。
 *
 * 只影响显示：URL 参数（`?category=clippings`）、接口返回值、数据库里的值都不变。
 */
const LABELS: Record<string, string> = {
  clippings: '收藏摘抄',
};

export function categoryLabel(category: string): string {
  return LABELS[category] ?? category;
}
