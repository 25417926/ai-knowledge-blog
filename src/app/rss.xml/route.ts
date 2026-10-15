import { listChatter, listPosts } from '@/lib/api';
import { site } from '@/lib/site';

export const dynamic = 'force-dynamic';

const ENTITIES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
};

function escapeXml(input: string): string {
  return input.replace(/[<>&'"]/g, (char) => ENTITIES[char]);
}

type FeedItem = { title: string; link: string; date: string | null; summary: string };

/**
 * RSS 2.0。
 *
 * 手拼字符串就够了——只有一二十条，引一个 feed 库反而多一层依赖。
 * 文章与杂谈混在同一个源里，按时间合并；两类内容对订阅者来说是同一件事：站上又写了点东西。
 */
export async function GET() {
  const items: FeedItem[] = [
    ...(await listPosts()).map((post) => ({
      title: post.title,
      link: `${site.url}/posts/${encodeURIComponent(post.slug)}`,
      date: post.publishedAt,
      summary: post.summary,
    })),
    ...(await listChatter()).map((item) => ({
      title: item.title,
      link: `${site.url}/chatter/${encodeURIComponent(item.slug)}`,
      date: item.publishedAt,
      summary: item.excerpt,
    })),
  ]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, 30);

  const body = items
    .map((item) => {
      const pubDate = item.date
        ? `<pubDate>${new Date(`${item.date}T00:00:00+08:00`).toUTCString()}</pubDate>`
        : '';
      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${item.link}</link>
      <guid isPermaLink="true">${item.link}</guid>
      ${pubDate}
      <description>${escapeXml(item.summary)}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.name)}</title>
    <link>${site.url}</link>
    <description>${escapeXml(site.description)}</description>
    <language>zh-CN</language>
    <atom:link href="${site.url}/rss.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${body}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
}
