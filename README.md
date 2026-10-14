# 赛博小镇 · AI 个人博客

以 Obsidian Vault 为内容源的个人知识博客：**结构化阅读 + 带出处的 AI 问答**，全站共用一个 Agent 内核。
（曾有一个 Godot 做的 2D 小镇端，已于 2026-10-14 下线，代码与素材备份在 `_town_backup_2026-10-14.zip`。）

## 快速开始

```bash
npm install
npm run setup     # 建表 + 初始化角色 + 导入示例 Vault
npm run dev       # http://localhost:3000
```

首页是卡片墙：资料卡 + 最新文章/杂谈轮播 + 状态/主题/说说卡。
顶部导航在「归档 / 项目 / 说说 / 杂谈 / 关于」之间切换，`/blog` 旧地址仍会 308 跳新地址。

零外部依赖：不需要 Docker、不需要装数据库、不需要任何 API Key。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 |
| `npm run db:init` | 建表 + 从 `content/town/agents.json` 初始化角色（幂等） |
| `npm run vault:import` | 扫描 Vault 并重建索引（幂等） |
| `npm run setup` | 上面两步串起来 |

导入自己的 Vault：

```bash
VAULT_DIR="/path/to/your/vault" npm run vault:import
```

## 路由

| 路由 | 内容 |
|---|---|
| `/` | 首页卡片墙 |
| `/timeline` | 归档与探索：搜索 + 标签 + 双视图（中枢链路 / 矩阵网格） |
| `/posts/[slug]` | 文章详情：封顶封面、目录、代码高亮、灯箱、上下篇、出链/反链 |
| `/projects` | 项目矩阵：搜索 + 技术栈胶囊 + 外链 |
| `/moments` | 说说流：宫格自适应、排序切换、搜索 |
| `/chatter` `/chatter/[slug]` | 杂谈：情绪枚举 + 标签 + 搜索；详情页 |
| `/about` | 关于：自我介绍、时间线、技能栈、兴趣、联系方式 |
| `/robots.txt` `/sitemap.xml` `/rss.xml` | 由 `app/robots.ts`、`app/sitemap.ts`、`app/rss.xml/route.ts` 生成 |

`/blog` 与 `/blog/:slug` 在 `next.config.mjs` 里做了 308 永久重定向。
放在配置层而不是页面里，是因为页面内重定向要等 `async searchParams` 把流式响应冲出去，
Next 只能退回 `meta refresh`，拿不到真正的 308。

## 目录结构

```
src/
  app/
    page.tsx         首页：卡片网格 + 两组轮播
    timeline/        归档（筛选条件走 URL，便于分享与后退）
    posts/[slug]/    文章详情
    chatter/         杂谈列表 + 详情
    moments/         说说流
    projects/        项目矩阵
    about/           关于
    robots.ts sitemap.ts rss.xml/route.ts
    error.tsx not-found.tsx
    api/
      blog/ask/      博客助手的提问与历史回放
  lib/
    schema.sql       全部 DDL，项目的脊椎
    db.ts            SQLite 连接（node:sqlite 内置模块，单文件 WAL 模式）
    vault.ts         Vault 解析与导入：frontmatter / [[双链]] / 按标题切分
    markdown.ts      Markdown → HTML（remark/rehype + Shiki 代码高亮）+ 目录抽取
    posts.ts         文章、标签、图谱、反向链接查询
    chatter.ts       杂谈查询（情绪枚举见 moods.ts）
    moods.ts         情绪枚举与配色（无数据库依赖，客户端可引用）
    moments.ts       说说查询
    projects.ts      项目清单（编译期常量，不入库）
    cover.ts         分类配色：卡片封面 / 图谱节点共用
    site.ts          站点文案与个人信息的唯一出处
    agents.ts        Agent 查询
    retrieve.ts      RAG 检索层：二元组切词 + IDF 打分，产出带出处的片段
    agent-chat.ts    Agent 内核：记忆 / 好感度 / 实时日志 / 检索增强编排
    llm.ts           OpenAI 兼容适配器；未配置 Key 时回落到 Mock
  components/
    BlogAssistant.tsx   全站浮动的博客助手（带出处卡片）
    CatPet.tsx          像素猫桌宠（可拖动、能聊天、能喂鱼干）
    Carousel.tsx        卡片轮播（首页两组复用）
    Toc.tsx             正文目录（滚动高亮）
    CodeCopy.tsx        代码块的语言标签 / 复制 / 行号
    Lightbox.tsx        图片灯箱（事件委托，文章与说说复用）
    TimelineControls.tsx / ChatterControls.tsx / ProjectsBoard.tsx / MomentsBoard.tsx
    SiteHeader.tsx / SiteFooter.tsx / Splash.tsx / Danmaku.tsx / PageHeader.tsx
    HomeCards.tsx       首页状态卡与主题卡
content/
  sample-vault/      示例 Vault，用来跑通全流程
  chatter/           杂谈原文（Markdown）
  moments.json       说说种子数据
  town/agents.json   角色设定（人格、口吻），博客助手也在这里
scripts/
  db-init.ts         建表 + 角色/杂谈/说说种子
  vault-import.ts    Vault 导入
```

## 设计要点

**内容只存一份。** Markdown 原文进 `posts.content`，按标题切分成 `chunks` 供 RAG 检索，
`[[双链]]` 解析进 `links`。博客阅读、AI 检索、知识图谱三种用途复用同一份数据，不各自维护。

**Agent 内核。** `agents` 系列表（角色 / 记忆 / 好感度 / 会话 / 日志 / 引用）是
全站 AI 助手的地基，博客助手「知行」见 `content/town/agents.json`
里 `meta.blogAssistant = true`。

**零原生依赖。** 数据库用 Node 内置的 `node:sqlite`，不需要编译 `better-sqlite3`、
不需要 Visual Studio 构建工具、不需要 Python 环境。换任何机器只要 Node ≥ 22.5 即可跑起来。
启动时会有一条 `ExperimentalWarning`，属正常现象。

**向量不上数据库。** 几万条以内向量，内存里算余弦比上向量库更快且零运维成本，
向量以 BLOB 存在 `chunks.embedding`。当前阶段检索先用「中文二元组 + IDF」实现——
`chunks` 总量在几百条量级，全量扫一遍比建索引快，且结果确定可复现；
将来接入 embedding 时只需替换 `retrieve.ts` 里的打分函数，调用方不动。

**每句结论都必须能点回原文。** 博客助手的回答建立在检索到的片段之上，
引用（`citations` 表）随该轮问答一起落库；面板上每个数字角标都能点回原文章节。
检索不到时它直接说不确定，而不是编一段听起来合理的话——这是知识站该有的诚实。

**双链是图谱的唯一边源。** 2D 脉络图从 `links` 派生，不额外维护关系数据。

**故意没有 `app/loading.tsx`。** 根级 `loading.tsx` 会给整棵树套一层 Suspense，
于是 `/posts/[slug]`、`/chatter/[slug]` 这类动态详情页会在 `notFound()` 判定之前
就把 `200` 冲出去——不存在的 slug 会渲染出「文章不存在」的页面，但 HTTP 状态码仍是 200，
也就是**软 404**，搜索引擎会把它当正常页面收录。这两个详情页都是 `force-dynamic`，
必须让 404 在首字节之前定下来，所以根级加载骨架被移除。
代价很小：没有 `loading.tsx` 时 Next 会在导航期间保留上一页，本地毫秒级渲染下体验反而更稳。
若将来想给某个**没有动态子路由**的列表页加回骨架（如 `/timeline`、`/moments`），
放到该目录下的 `loading.tsx` 即可，**不要再放回根级**。

**服务端与客户端的边界是硬约束，不是风格问题。** `node:sqlite` 返回的行是 **null 原型对象**，
直接传给客户端组件会序列化失败；同时任何从客户端组件指向 `db.ts` 的 import 链都会把
`node:fs` 拉进浏览器包并编译失败。因此：给客户端的数据一律显式转成普通对象
（如 `listTags()`），纯常量另存无依赖模块（如 `moods.ts`）。

**代码高亮走 Shiki 双主题。** `@shikijs/rehype` 只往每个 token 写 `--shiki-light` /
`--shiki-dark` 两个 CSS 变量（`defaultColor: false`），显示哪套由 `.dark` 选择器决定——
切主题不需要重渲染，也不会闪。语言标签、复制按钮、行号由 `CodeCopy.tsx` 在客户端补，
用 CSS 计数器做行号，不改动 Shiki 的输出结构。

## 当前进度

- [x] 阶段 1：工程脚手架 · SQLite 建表 · Vault 导入器 · 示例 Vault
- [x] 阶段 2a：博客端列表与详情（双链跳转、出链、反向链接）
- [x] 阶段 2b：全站视觉体系（暗/亮双主题、氛围背景、封面图、开屏、弹幕）
- [x] 阶段 3a：RAG 检索与「带出处的博客助手」（全站浮动面板，可限定单篇提问）
- [x] 阶段 3b：Agent 内核（短期/长期记忆、好感度、实时日志）
- [x] 阶段 3c：内容站主干复刻 —— 首页卡片墙、归档双视图、文章详情增强
      （Shiki 代码高亮 / 目录 / 灯箱 / 上下篇）、项目 / 说说 / 杂谈 / 关于四个路由、
      像素猫桌宠、SEO（robots / sitemap / RSS / JSON-LD）
- [x] 阶段 4：Godot 2D 小镇（已上线后于 2026-10-14 整体下线，备份见文首说明）
- [ ] 阶段 5：后台写作与登录 · Wiki 自动沉淀与出处回链 · 实时日志面板

## 路线图（按依赖顺序）

1. **接入真实语言模型。** 在 `.env` 填 `LLM_BASE_URL` 与 `LLM_API_KEY`（两者都需要），
   即可从 Mock 切到真实回答；协议是 OpenAI 兼容格式，换 baseURL 就能接 DeepSeek / 通义 / 智谱 / Ollama。
   提示词里已经要求模型「先给结论、再标引用 [n]」，无需改业务代码。
2. **向量检索。** 导入 Vault 时可选生成 embedding 写入 `chunks.embedding`，
   与现有关键词检索做混合排序（关键词保精度、向量保召回）。
3. **沉淀闭环。** 把问答日志里高频但站内没有的内容，提示补写成新笔记，
   形成「问 → 答 → 补文档」的正循环。
4. **后台与写作。** 登录 + 在线写作 + 代码块插入，省掉「改 Markdown 再跑导入」这一步。

## 说明

`.env.example` 列出了全部可配置项，均为可选。不配置任何一项时系统运行在 Mock 模式，
AI 回答由「原文节选 + 出处」拼成，用于完整演示与调试——没有 API Key 也能跑通全部主线。

## Windows 上的构建提示

`next build` 会批量清理 `.next` 目录，可能被沙箱的删除守卫拦下，构建前带上
`CODEBUDDY_SAFE_DELETE_ENABLED=0`。另外 `@next/swc-win32-x64-msvc` 的 DLL 初始化警告
是无害降级（回落 WASM），不影响产物。
