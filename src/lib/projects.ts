/**
 * 项目清单。
 *
 * 存成 TS 常量而不是数据库表：项目条目少、几乎不改、也不需要检索，
 * 放进代码里还能直接拿到类型检查，比多一张表划算。
 */

export type Project = {
  slug: string;
  name: string;
  description: string;
  /** 技术栈，渲染成胶囊标签 */
  tech: string[];
  repo?: string;
  demo?: string;
  /** 置顶的排在最前 */
  featured?: boolean;
  status: 'active' | 'wip' | 'archived';
};

export const projects: Project[] = [
  {
    slug: 'cyber-town',
    name: '赛博小镇',
    description:
      '你正在看的这个站。同一份 Obsidian Vault 同时驱动博客阅读、带出处的 AI 问答，和一座用 Godot 做的可漫游 2D 小镇。',
    tech: ['Next.js', 'TypeScript', 'SQLite', 'Godot', 'RAG'],
    repo: 'https://github.com/',
    featured: true,
    status: 'active',
  },
  {
    slug: 'vault-pipeline',
    name: 'Vault 内容管线',
    description:
      '把 Obsidian 笔记解析成结构化内容的工具：frontmatter、[[双链]]、按标题自动切分成检索块，全程幂等可重跑。',
    tech: ['Node.js', 'gray-matter', 'SQLite'],
    repo: 'https://github.com/',
    status: 'active',
  },
  {
    slug: 'agent-kernel',
    name: 'Agent 内核',
    description:
      '博客助手和小镇 NPC 共用的一层：短期/长期记忆、好感度档位、实时日志与引用溯源，同一套表两边都跑。',
    tech: ['TypeScript', 'SQLite', 'OpenAI 兼容'],
    repo: 'https://github.com/',
    status: 'active',
  },
  {
    slug: 'bigram-rag',
    name: '二元组 RAG',
    description:
      '不引向量库的中文检索：二元组切词 + IDF 打分，几百个块全量扫描比建索引更快，且结果完全可复现。',
    tech: ['TypeScript'],
    repo: 'https://github.com/',
    status: 'active',
  },
  {
    slug: 'godot-town',
    name: 'Godot 小镇地图',
    description:
      '2D 像素小镇场景：WASD 移动、NPC 交互、从后端拉世界数据。导出 Web 包用 iframe 内嵌，靠 postMessage 通信。',
    tech: ['Godot 4.5', 'GDScript'],
    status: 'wip',
  },
  {
    slug: 'old-blog',
    name: '旧版博客',
    description: '上一代的 Hexo 博客，已经被现在这个站完全替代，留作纪念。',
    tech: ['Hexo', 'Node.js'],
    status: 'archived',
  },
];

export const STATUS_LABEL: Record<Project['status'], string> = {
  active: '维护中',
  wip: '开发中',
  archived: '已归档',
};
