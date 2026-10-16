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

/* ── Obsidian callout ─────────────────────────────────────────── */

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

/** `> [!tip] 标题`；收尾的 +/- 是 Obsidian 的折叠标记，本站不折叠，只吃掉不显示。
 *  只认首行，所以结尾不能用 $ ——mdast 里软换行是 text 里实打实的 \n，$ 会整体匹配失败 */
const CALLOUT_RE = /^\[!([a-zA-Z][\w-]*)\]([+-]?)[ \t]*([^\n]*)/;

/**
 * 各类型的图标与默认标题（没写标题时用）。图标由 CSS 的 ::before 取 --callout-glyph，
 * 类型色取 --callout-rgb，见 globals.css。表里没有的类型落中性色，不会破版。
 */
const CALLOUT_META: Record<string, { glyph: string; label: string }> = {
  note: { glyph: '📝', label: '笔记' },
  info: { glyph: 'ℹ️', label: '说明' },
  tip: { glyph: '💡', label: '提示' },
  hint: { glyph: '💡', label: '提示' },
  abstract: { glyph: '📋', label: '摘要' },
  summary: { glyph: '📄', label: '总结' },
  def: { glyph: '📖', label: '定义' },
  quote: { glyph: '💬', label: '引用' },
  example: { glyph: '📌', label: '示例' },
  success: { glyph: '✅', label: '完成' },
  question: { glyph: '❓', label: '问题' },
  warning: { glyph: '⚠️', label: '注意' },
  caution: { glyph: '⚠️', label: '注意' },
  important: { glyph: '❗', label: '重要' },
  danger: { glyph: '🔥', label: '危险' },
  error: { glyph: '❌', label: '错误' },
  failure: { glyph: '❌', label: '失败' },
  bug: { glyph: '🐞', label: '缺陷' },
  todo: { glyph: '☑️', label: '待办' },
};

/**
 * 吃掉段落的第一行（标记行连标题一起），把换行之后的内容留在原处当正文。
 * 得逐节点走：mdast 里软换行就藏在 text 的 value 里，硬换行才是 break 节点，
 * 「标记 + 加粗标题」还会把行内节点拆开。
 */
function dropFirstLine(children: MdNode[]): void {
  while (children.length) {
    const node = children[0];
    if (node.type === 'text') {
      const nl = (node.value ?? '').indexOf('\n');
      if (nl === -1) {
        children.shift();
        continue;
      }
      node.value = node.value!.slice(nl + 1);
      if (!node.value) children.shift();
      return;
    }
    children.shift(); // break 与行内节点都算首行的一部分
    if (node.type === 'break') return;
  }
}

/** 首行是 `[!type]` 就就地改成 callout，改不动就原样留着 */
function convertCallout(quote: MdNode): void {
  const lead = quote.children?.[0];
  const text = lead?.type === 'paragraph' ? lead.children?.[0] : undefined;
  if (text?.type !== 'text') return;
  const matched = CALLOUT_RE.exec(text.value ?? '');
  if (!matched) return;

  const type = matched[1].toLowerCase();
  // 标题里的 ** 与 ` 若原样带进纯文本会露出符号，剥掉
  const title = matched[3].trim().replace(/[*_`]/g, '');
  dropFirstLine(lead!.children as MdNode[]);
  // 首行被吃光才连段落一起删——段里还剩正文时它就是 callout 的第一段
  if (!lead!.children!.length) quote.children!.shift();

  quote.data = { hName: 'div', hProperties: { className: ['callout', `callout-${type}`] } };
  quote.children!.unshift({
    type: 'paragraph',
    data: { hName: 'p', hProperties: { className: ['callout-title'] } },
    children: [{ type: 'text', value: title || CALLOUT_META[type]?.label || type }],
  });
}

/** remark 插件：遍历全树，把 callout 引用块就地换掉。参数用 unknown 收，免得为此引 mdast 类型 */
function remarkCallout() {
  return (tree: unknown) => {
    const walk = (node: MdNode) => {
      if (node.type === 'blockquote') convertCallout(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree as MdNode);
  };
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
    .use(remarkCallout)
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
