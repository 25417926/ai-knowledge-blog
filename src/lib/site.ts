/**
 * 站点级配置：所有会出现在页面上的个人文案都从这里取。
 *
 * 单独抽出来是为了「改一处、全站生效」——站名、简介、社交链接、上线日期
 * 会散落在导航、首页、页脚、SEO 元数据里，写死在组件里迟早对不上。
 */

export const site = {
  /** SEO 与主题用的正式站名 */
  name: '赛博小镇',
  /** 导航左上角的字标：中间的连接符单独用强调色渲染 */
  wordmark: { prefix: '赛博', connector: 'の', suffix: '小镇' },
  tagline: '一座会说话的知识小镇',
  description: '用 Obsidian Vault 驱动的个人博客：结构化笔记、带出处的 AI 问答。',
  url: 'https://example.com',

  author: {
    name: '阿国',
    avatar: '/avatar.svg',
    bio: '在代码、知识与像素之间穿梭的普通人。正在把 Obsidian 里的笔记重写成别人能读懂的样子。',
    /** 首页资料卡的统计口径说明 */
    statsLabels: { posts: '文章', chatter: '杂谈', moments: '说说' },
  },

  social: [
    { label: 'GitHub', href: 'https://github.com/', icon: 'github' },
    { label: '邮箱', href: 'mailto:hello@example.com', icon: 'mail' },
    { label: 'RSS', href: '/rss.xml', icon: 'rss' },
  ],

  /** 首页状态卡：上线后先显示 CONNECTING…，再切到这里的在线状态 */
  status: {
    label: '在线',
    /** 「当前在做的事」轮播，可自由增删 */
    doing: ['在啃 ThreadLocal 的源码', '给 Agent 内核补记忆槽位', '把笔记改写成别人能读懂的样子'],
  },

  /** 主题卡的氛围文案，按当前主题取 */
  themeNote: {
    dark: '深空模式 · 星星亮着，适合读长文',
    light: '白昼模式 · 光线充足，适合翻代码',
  },

  /** 站点上线日：页脚据此算「已稳定运行」时长 */
  startedAt: '2026-10-13T00:00:00+08:00',

  /** 关于页：都是文案，放手写在配置里，改的时候不用翻组件 */
  about: {
    headline: '把学到的东西，写成别人能读懂的样子',
    paragraphs: [
      '我是阿国，后端工程师，现在主要写 Java 那一套——JVM、并发、Spring Cloud 这些。',
      '几年前开始用 Obsidian 记笔记，记着记着发现一个问题：笔记越攒越多，能复用的却越来越少。文档躺在本地，半年后连自己都懒得翻。',
      '所以有了这个站。同一份 Vault 变成可以正常阅读的博客——笔记不再只是躺在文件夹里的 Markdown，而是能被检索、被引用、被追问的东西。',
      '最近在往 Agent 工程方向转：把 RAG、记忆、工具调用这些拆开揉碎地写下来，顺便做成能用的小东西。',
    ],
    timeline: [
      { year: '2026', title: '开始重构这套知识站', detail: '把 Vault 接上 RAG，做了带出处的 AI 问答' },
      { year: '2025', title: '系统补并发与 JVM', detail: 'JUC、GC、线上问题排查' },
      { year: '2024', title: 'Spring Cloud 全家桶', detail: 'Nacos、网关、链路治理' },
      { year: '2023', title: '第一份后端工作', detail: '从写接口开始' },
    ],
    skills: [
      { group: '语言与运行时', items: ['Java', 'JVM', 'TypeScript', 'Python'] },
      { group: '框架与中间件', items: ['Spring Boot', 'Spring Cloud', 'Nacos', 'MyBatis'] },
      { group: '数据与存储', items: ['MySQL', 'Redis', 'SQLite', '向量检索'] },
      { group: 'AI 与 Agent', items: ['RAG', '提示工程', 'Agent 记忆', '工具调用'] },
    ],
    interests: ['读源码', '机械键盘', '像素游戏', '看技术演讲', '把笔记写成人话'],
  },
  techStack: ['Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'SQLite'],
  /** 背景飘过的弹幕短句，可自由增删 */
  danmaku: [
    '写算法中…',
    'BUG 修复进度 99%',
    '今天也在啃源码',
    '把笔记写成人话',
    '下一站：Agent 工程师',
    '线程池又满了',
    '这段代码我看过三遍',
    '离线可用才是自由',
    '少收藏，多输出',
    '小镇的灯还亮着',
  ],
  /** 左下角桌宠说的话，可自由增删 */
  pet: {
    name: '鱼干',
    greeting: '咕噜——我住在图书馆的角落里。不答题，不发论文，只发呆和等鱼干。',
    lines: [
      '咕噜。',
      '这段代码我看过三遍，还是有 bug。',
      '写不出来就去睡，明天更写不出来。',
      '笔记记了不看，等于没记。',
      '线程池又满了，跟我没关系。',
      '少收藏，多输出。',
      '要不要一起啃源码？我负责睡着。',
      '鱼干呢？',
    ],
  },

  /** 备案信息留空则不渲染 */
  icp: '',
} as const;

export type SocialLink = (typeof site.social)[number];
