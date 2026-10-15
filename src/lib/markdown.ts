import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import rehypeShiki from '@shikijs/rehype';
import type { BuiltinLanguage } from 'shiki';

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

/**
 * 双链目标归一化。原在 posts.ts，数据层迁去 Python 后 markdown 渲染留在前端，
 * 这个纯函数随之搬到这里 —— 必须与 server 端 to_slug 保持同一套规则，
 * 否则 [[标题]] 会在前端解析出不同的 key，指向已存在的文章也会变成「待创建」。
 */
function normalizeKey(input: string): string {
  return input
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/**
 * 把 Obsidian [[双链]] 转成标准 Markdown 链接。
 * 能解析的指向 /posts/<slug>；解析不到的退化为锚点，由样式标为"待创建"。
 */
export function linkifyWikilinks(markdown: string, linkIndex: Map<string, string>): string {
  return markdown.replace(WIKILINK_RE, (_full, rawTarget: string, rawAlias?: string) => {
    const target = rawTarget.trim();
    const label = (rawAlias ?? rawTarget).trim();
    const slug = linkIndex.get(normalizeKey(target));
    if (slug) return `[${label}](/posts/${encodeURIComponent(slug)})`;
    return `[${label}](#unresolved-${encodeURIComponent(normalizeKey(target))})`;
  });
}

/**
 * 代码块要跟着贴用的语法，但不必把 shiki 的全量语法包都塞进产物，
 * 这里列出本站实际会用到的集合（未收录在名单里的语言由 fallbackLanguage 兜底成纯文本，
 * 不会报错，只是不染色）。'text' 不是内置语法，它是 shiki 的特殊语言，只做兜底用。
 */
const CODE_LANGS: BuiltinLanguage[] = [
  'java', 'bash', 'shell', 'sql', 'typescript', 'javascript', 'tsx', 'jsx',
  'json', 'yaml', 'toml', 'ini', 'properties', 'python', 'xml', 'html',
  'css', 'scss', 'markdown', 'diff', 'groovy', 'kotlin', 'go', 'rust',
  'c', 'cpp', 'dockerfile',
];

/**
 * Markdown → HTML。
 *
 * 是 async 的，因为 Shiki 的 rehype 插件是异步的——所以调用方必须 await，
 * 不能再像以前那样 processSync。
 *
 * 代码配色走「双主题」：插件只往每个 token 上写 --shiki-light / --shiki-dark
 * 两个 CSS 变量（defaultColor: false），具体显示哪套由 .dark 选择器决定（见 globals.css）。
 * 这样切主题不用重渲染，也不会闪现。
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeShiki, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
      // 保留 language-* 类名，代码块头部的语言标签直接读它，不用再猜
      addLanguageClass: true,
      defaultLanguage: 'text',
      fallbackLanguage: 'text',
      langs: CODE_LANGS,
    })
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

export type Heading = { id: string; text: string; level: 2 | 3 };

const HEADING_RE = /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/g;
const ID_ATTR_RE = /\bid="([^"]*)"/;

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ',
};

function decodeEntities(input: string): string {
  return input.replace(/&[a-zA-Z#0-9x]+;/g, (m) => ENTITIES[m] ?? m);
}

/**
 * 从渲染好的 HTML 里抓出 h2/h3 做目录。
 *
 * 刻意不重新推导一遍 slug：锚点 id 是 rehype-slug 生成的，中文、重复标题、
 * 标点这些边角它都处理过了，这里再算一次只会算出对不上的 id。
 */
export function extractHeadings(html: string): Heading[] {
  const headings: Heading[] = [];
  for (const match of html.matchAll(HEADING_RE)) {
    const [, level, attrs, inner] = match;
    const id = ID_ATTR_RE.exec(attrs)?.[1];
    if (!id) continue;
    const text = decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    headings.push({ id, text, level: Number(level) as 2 | 3 });
  }
  return headings;
}

/** 用于列表页的纯文本摘要，长度不够时从正文截取 */
export function toPlainText(markdown: string, limit = 120): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b ?? a)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
