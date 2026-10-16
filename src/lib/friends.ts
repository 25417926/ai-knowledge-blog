/**
 * 友链。
 *
 * 与 projects.ts 同理存成 TS 常量而不入数据库：条目少、几乎不改、不需要检索，
 * 放进代码里还能直接拿到类型检查——为它开一张表、一套 CRUD 和一次迁移不划算。
 *
 * 下面是占位条目，把 name / description / href 换成真实友链即可；不需要的整条删掉。
 */

export type FriendSite = {
  slug: string;
  name: string;
  /** 一句话介绍，写成对方会愿意被人看到的样子 */
  description: string;
  href: string;
  /** 对方的标签，渲染成胶囊；留空则不显示这一行 */
  tags?: string[];
};

export const friends: FriendSite[] = [
  {
    slug: 'example-notes',
    name: '示例笔记站',
    description: '把读过的东西写成能复述出来的样子，长文为主，更新很稳。',
    href: 'https://example.com/',
    tags: ['笔记', '长文'],
  },
  {
    slug: 'example-backend',
    name: '示例后端手记',
    description: '线上问题排查与源码阅读，写得很细，事故复盘尤其好看。',
    href: 'https://example.com/backend',
    tags: ['Java', '排查'],
  },
  {
    slug: 'example-agent',
    name: '示例 Agent 观察',
    description: '追 Agent 工程的最新实践，动手多于转述。',
    href: 'https://example.com/agent',
    tags: ['Agent', 'RAG'],
  },
];
