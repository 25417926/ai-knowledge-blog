/**
 * 检索层：把「一个问题」变成「几段能回答它的原文」。
 *
 * 刻意不引入向量库或分词器：切分块总量在几百条量级，全量扫一遍比任何索引都快，
 * 而中文没有分词器时用「二元组」做关键词匹配，召回过得去且完全确定可复现。
 * 配了 embedding 模型之后，只需在 scoreChunk 里换掉打分方式，调用方不用动。
 *
 * 引用（Citation）是这个模块的核心产物，而不是附带品——
 * 博客端 AI 助手的可信度全靠「每句结论都能点回原文那一段」。
 */

import { getDb } from './db';

export type Citation = {
  chunkId: number;
  postSlug: string;
  postTitle: string;
  category: string;
  /** 该段在原文章里的标题路径，例如「JUC 线程池核心参数 > 核心参数」 */
  heading: string;
  /** 原文片段，直接给读者看 */
  quote: string;
  score: number;
};

type ChunkRow = {
  id: number;
  body: string;
  heading_path: string;
  slug: string;
  title: string;
  category: string;
};

/**
 * 纯虚字。二元组里只要沾上它们就是噪声：
 * 「线程池的核心参数」会切出 `池的`、`的核` 这种词，把真正的 `核心`、`参数` 挤下去。
 */
const PARTICLES = new Set('的了是在和与就都而及或吗呢吧啊着过很也还个之其并'.split(''));

const STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '与', '就', '都', '而', '及', '或', '一个',
  '什么', '怎么', '如何', '哪些', '哪个', '为什么', '这个', '那个', '可以',
]);

/**
 * 切词。中文没有空格，用相邻两字组成的二元组近似词：
 * 「线程池」→ 线程 / 程池，既能召回又能保持精度。
 * 英文与数字按整词切。
 */
export function tokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const tokens: string[] = [];

  for (const match of lowered.matchAll(/[a-z0-9][a-z0-9+#._-]*/g)) {
    tokens.push(match[0]);
  }

  for (const run of lowered.replace(/[^\u4e00-\u9fa5]+/g, ' ').split(' ')) {
    if (run === '') continue;
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i += 1) {
      const pair = run.slice(i, i + 2);
      if (PARTICLES.has(pair[0]) || PARTICLES.has(pair[1])) continue;
      tokens.push(pair);
    }
  }

  return tokens.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function loadChunks(about: string | null): ChunkRow[] {
  const sql = `SELECT c.id AS id, c.body AS body, c.heading_path AS heading_path,
                      p.slug AS slug, p.title AS title, p.category AS category
               FROM chunks c JOIN posts p ON p.id = c.post_id
               ${about ? 'WHERE p.slug = ?' : ''}
               ORDER BY c.id`;
  const stmt = getDb().prepare(sql);
  return (about ? stmt.all(about) : stmt.all()) as ChunkRow[];
}

/** 每个词的「稀有度」：在越多块里出现的词，越不该左右排序。 */
function documentFrequency(rows: ChunkRow[], tokens: string[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const token of tokens) {
    let count = 0;
    for (const row of rows) {
      const haystack = `${row.title} ${row.heading_path} ${row.body}`.toLowerCase();
      if (haystack.includes(token)) count += 1;
    }
    df.set(token, count);
  }
  return df;
}

/**
 * 单块打分。标题命中权重最高——读者问「线程池」，想要的是那篇讲线程池的文章，
 * 而不是某篇顺带提了一句「线程池」的文章。
 */
function scoreChunk(row: ChunkRow, tokens: string[], df: Map<string, number>): number {
  const title = row.title.toLowerCase();
  const heading = row.heading_path.toLowerCase();
  const body = row.body.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    const freq = df.get(token) ?? 0;
    if (freq === 0) continue;
    const idf = Math.log(1 + tokens.length / freq);
    if (title.includes(token)) score += 3.0 * idf;
    else if (heading.includes(token)) score += 1.6 * idf;
    else if (body.includes(token)) score += 1.0 * idf;
  }

  // 同一篇文章的多个块会一起冒头，让靠前的块略微占优，读起来有先后
  return score / Math.sqrt(Math.max(1, tokens.length));
}

export function retrieve(query: string, limit = 4, about: string | null = null): Citation[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const rows = loadChunks(about);
  if (rows.length === 0) return [];

  const df = documentFrequency(rows, tokens);
  const scored = rows
    .map((row) => ({ row, score: scoreChunk(row, tokens, df) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ row, score }) => ({
    chunkId: row.id,
    postSlug: row.slug,
    postTitle: row.title,
    category: row.category,
    heading: row.heading_path,
    quote: row.body.trim(),
    score: Math.round(score * 1000) / 1000,
  }));
}

/**
 * 「这篇文章讲了什么？」这类泛问。
 *
 * 直接拿整句话去检索是检索不到的——「这篇文章讲了什么」这几个字哪篇文章里也没有。
 * 但用户的意图很明确：要这篇的概览。所以改用「文章标题」当查询词：
 * 标题本身就是这篇的主题词，能稳定命中它的各个小节，再按相关度取前几段当概览。
 */
export function articleOverview(slug: string, limit = 3): Citation[] {
  const row = getDb().prepare('SELECT title FROM posts WHERE slug = ?').get(slug) as
    | { title: string }
    | undefined;
  if (!row) return [];
  return retrieve(row.title, limit, slug);
}

/** 把检索结果排成给模型看的一段上下文。每条都带编号，方便要求它标注引用。 */
export function formatContext(citations: Citation[]): string {
  return citations
    .map((c, i) => `[${i + 1}] 出自《${c.postTitle}》的「${c.heading}」：\n${c.quote}`)
    .join('\n\n');
}
