import type { MetadataRoute } from 'next';
import { listPosts } from '@/lib/api';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';

/** 日期只取到「天」：sitemap 的 lastmod 到秒没有意义，还会让每次构建都产生 diff */
function day(value: string | null | undefined): string | undefined {
  return value ? value.slice(0, 10) : undefined;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = site.url;

  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/timeline`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/moments`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/friends`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/projects`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/about`, changeFrequency: 'monthly', priority: 0.5 },
  ];

  const posts: MetadataRoute.Sitemap = (await listPosts()).map((post) => ({
    url: `${base}/posts/${encodeURIComponent(post.slug)}`,
    lastModified: day(post.publishedAt),
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  // 说说没有独立详情页，只在列表页聚合，所以不进 sitemap
  return [...pages, ...posts];
}
