# 赛博小镇 · AI 个人博客

以 Obsidian Vault 为内容源的个人知识博客：**结构化阅读 + 带出处的 AI 问答**，全站共用一个 Agent 内核。
（曾有一个 Godot 做的 2D 小镇端，已于 2026-10-14 下线，代码与素材备份在 `_town_backup_2026-10-14.zip`。）

**架构：Next.js 只做前端，Python 做后端**（2026-10-15 起）。数据层、RAG 检索、Agent 内核全部在
`server/`（FastAPI + SQLAlchemy + SQLite），Next 通过 `src/lib/api.ts` 里的 typed fetch 客户端取数。

## 快速开始

```bash
# 1. 后端（Python 3.11+）
cd server && python -m venv .venv
.venv/Scripts/activate        # Windows；macOS/Linux 用 source .venv/bin/activate
pip install -r requirements.txt
python -m scripts.init_db     # 建表 + 角色/杂谈/说说种子 + 导入示例 Vault
python -m uvicorn app.main:app --reload --port 8000

# 2. 前端（另一个终端）
npm install
npm run dev                   # http://localhost:3000
```

首页是卡片墙：资料卡 + 最新文章/杂谈轮播 + 状态/主题/说说卡。
顶部导航在「归档 / 项目 / 说说 / 杂谈 / 关于」之间切换，`/blog` 旧地址仍会 308 跳新地址。

零外部服务依赖：不需要 Docker、不需要装数据库服务器、不需要任何 API Key。
两个进程各自可热重载；前端未启动时后端仍可独立调试（`http://127.0.0.1:8000/docs` 有完整 API 文档）。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动前端开发服务器（:3000） |
| `npm run build` | 前端生产构建 |
| `npm run server` | 启动 Python 后端（:8000，热重载） |
| `npm run server:init` | 建表 + 种子 + 导入 Vault（幂等，可反复跑） |

导入自己的 Vault：

```bash
cd server && VAULT_DIR="/path/to/your/vault" python -m scripts.init_db
```

微信收藏 → 知识库（收件箱管道：浏览器打开文章 → 复制链接，其余全自动）：

```bash
cd server
python -m scripts.clip <url>            # 抓取 → 三段式总结 → 写 clippings/ 笔记 → 建索引
python -m scripts.clip <url> --paste    # 公众号反爬时：跳过抓取，粘贴全文（第一行当标题）
python -m scripts.clip --list           # 查看已收藏
```

抓取用 trafilatura，失败自动降级粘贴；总结为三段式（是什么 / 核心观点 / 对我的启发），
未配 LLM 时出节选式 Mock 总结。URL 唯一，重复收藏原地更新。收藏稿落在
`content/sample-vault/clippings/`，与手写笔记同库，立刻可被 AI 助手检索引用。

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
src/                       前端（Next.js App Router）
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
  lib/
    api.ts           唯一的数据出口：typed fetch 客户端，字段与后端 camelCase 契约对齐
    markdown.ts      Markdown → HTML（remark/rehype + Shiki 代码高亮）+ 目录抽取
    moods.ts         情绪枚举与配色（无依赖，客户端可引用）
    projects.ts      项目清单（编译期常量，不入库）
    cover.ts         分类配色：卡片封面 / 图谱节点共用
    site.ts          站点文案与个人信息的唯一出处
  components/
    BlogAssistant.tsx   全站浮动的博客助手（带出处卡片，直连后端 /api/ask）
    Pet.tsx             鲸鱼娘桌宠（可拖动、能聊天、能喂鱼干、没人理会打盹）
    Carousel.tsx        卡片轮播（首页两组复用）
    Toc.tsx             正文目录（滚动高亮）
    CodeCopy.tsx        代码块的语言标签 / 复制 / 行号
    Lightbox.tsx        图片灯箱（事件委托，文章与说说复用）
    TimelineControls.tsx / ChatterControls.tsx / ProjectsBoard.tsx / MomentsBoard.tsx
    SiteHeader.tsx / SiteFooter.tsx / Splash.tsx / Danmaku.tsx / PageHeader.tsx
    HomeCards.tsx       首页状态卡与主题卡
server/                   后端（FastAPI + SQLAlchemy）
  app/
    main.py           FastAPI 入口：CORS、lifespan 建表、路由注册
    database.py       引擎与会话：sqlite+aiosqlite，WAL + 外键在 connect 级挂 PRAGMA
    schema.sql        全部 DDL（与数据同源，建表只认这一份）
    models.py         ORM 模型：14 张表，字段与前端类型逐字对齐
    schemas.py        Pydantic 响应模型：snake_case → camelCase 别名生成
    services/
      content.py      文章 / 杂谈 / 说说 / 图谱查询（Node 版 lib 的逐函数移植）
      agent_chat.py   Agent 内核 + RAG 检索 + LLM 适配 + Mock 三分支
    api/routes/
      content.py      内容查询接口
      ask.py          博客助手问答（整包 + SSE 流式双路由）与会话回放
  scripts/
    init_db.py       建表 + 种子 + Vault 导入（幂等）
    clip.py          微信收藏管道：抓取 → 总结 → 入库 → 建索引
  requirements.txt
content/
  sample-vault/      示例 Vault，用来跑通全流程（clippings/ 是收藏管道的自动入库目录）
  chatter/           杂谈原文（Markdown）
  moments.json       说说种子数据
  town/agents.json   角色设定（人格、口吻），博客助手也在这里
```

## 设计要点

**内容只存一份。** Markdown 原文进 `posts.content`，按标题切分成 `chunks` 供 RAG 检索，
`[[双链]]` 解析进 `links`。博客阅读、AI 检索、知识图谱三种用途复用同一份数据，不各自维护。

**Agent 内核。** `agents` 系列表（角色 / 记忆 / 好感度 / 会话 / 日志 / 引用）是
全站 AI 助手的地基，博客助手「知行」见 `content/town/agents.json`
里 `meta.blogAssistant = true`。内核完整迁到了 `server/app/services/agent_chat.py`，
四个行为细节被刻意保留：好感度只增不减（单轮 +1~4）、短期记忆直接读最近 8 轮
`agent_turns`、Mock 三分支且明说「这是节选不是转述」。

**意图识别归模型，不归正则。** 配置了 LLM 时，助手跑 Function Calling 循环
（`agent_chat.py` 的 `_run_tool_agent`）：模型自己决定调 `search_posts` /
`get_article_overview` / `remember_fact` 中的哪个、换词重查几次（上限 3 轮）。
工具返回的片段带连续编号 `[n]`，回答里的编号与 `citations` 落库顺序逐字对齐；
「只搜本文」是工具层硬约束，模型传别的 slug 也会被拉回当前篇。
未配置 LLM 时回落 Mock 路径，仍用正则分流（`OVERVIEW_RE` 等）——两路并存，
Mock 行为与改造前完全一致。每次工具调用记录在 `agent_turns.tool_trace`
（JSON：工具名 / 参数 / 命中数 / 耗时），`GET /api/ask` 的 `toolTrace` 字段可读。
检索分数低于 `RAG_MIN_SCORE`（实测校准值 1.0）视为没命中：不再换词重试，
也不烧最后一次 LLM 调用，直接诚实收尾；端点若忽视 `tools` 参数，
自动降级为「先检索后生成」并套用同一阈值。

**前后端边界靠契约，不靠约定。** 前端唯一的数据出口是 `src/lib/api.ts`，
页面只 import 它；后端用 Pydantic 的 `alias_generator` 把 snake_case 输出成 camelCase，
两边字段名逐字一致，序列化/反序列化都不需要适配层。后端接口文档在 `/docs`（Swagger UI），
改契约先改这里再改前端。

**流式是同一份契约的另一种送达方式。** `POST /api/ask/stream` 与整包路由共用同一个
`talk()`，区别只在生成时多传一个 `emit` 回调：token 增量与 status 过程提示实时推走，
落库内容和 done 事件载荷与整包路由逐字一致（`jsonable_encoder` 保证 camelCase 不变）。
事件协议四种：`token` / `status` / `done` / `error`。EventSource 只支持 GET，
所以前端用 fetch + ReadableStream 手撕帧；传输层失败或开播即失败时自动回落整包路由，
观感与行为都退回改造前。Mock 模式没有真流式，按 2~4 字一片模拟打字机——只影响观感，
落库内容不变。

**零原生依赖。** 后端 SQLite 走 `sqlite+aiosqlite`（纯 Python 驱动），不需要编译
`better-sqlite3`、不需要 Visual Studio 构建工具。前端 Next.js 常规依赖。
换任何机器只要 Node ≥ 22.5 + Python ≥ 3.11 即可跑起来。

**向量不上数据库。** 几万条以内向量，内存里算余弦比上向量库更快且零运维成本，
向量以 BLOB 存在 `chunks.embedding`。当前阶段检索先用「中文二元组 + IDF」实现——
`chunks` 总量在几百条量级，全量扫一遍比建索引快，且结果确定可复现；
将来接入 embedding 时只需替换 `server/app/services/agent_chat.py` 里的 `_score_chunk`，
调用方不动。

**每句结论都必须能点回原文。** 博客助手的回答建立在检索到的片段之上，
引用（`citations` 表）随该轮问答一起落库；面板上每个数字角标都能点回原文章节。
检索不到时它直接说不确定，而不是编一段听起来合理的话——这是知识站该有的诚实。

**过程也必须可审计。** 助手每一轮调过哪些工具、检索词是什么、命中几条、花了多少毫秒，
全部记在 `agent_turns.tool_trace`；流式问答时通过 step 事件实时画成步骤条，
结束后折叠成一行摘要，历史消息从落库数据回放同一条。展示的是「确实发生过的事」——
Mock 与闲聊路径没有工具调用，就什么都不画，不表演一段假的思考过程。

**双链是图谱的唯一边源。** 2D 脉络图从 `links` 派生，不额外维护关系数据。
前端 `markdown.ts` 与后端 `content.py` 各有一份 slug 归一化（`normalizeKey` / `to_slug`），
规则必须一致，否则 `[[标题]]` 会在前端解析出不同的 key，指向已存在文章也显示「待创建」。

**故意没有 `app/loading.tsx`。** 根级 `loading.tsx` 会给整棵树套一层 Suspense，
于是 `/posts/[slug]`、`/chatter/[slug]` 这类动态详情页会在 `notFound()` 判定之前
就把 `200` 冲出去——不存在的 slug 会渲染出「文章不存在」的页面，但 HTTP 状态码仍是 200，
也就是**软 404**，搜索引擎会把它当正常页面收录。这两个详情页都是 `force-dynamic`，
必须让 404 在首字节之前定下来，所以根级加载骨架被移除。
代价很小：没有 `loading.tsx` 时 Next 会在导航期间保留上一页，本地毫秒级渲染下体验反而更稳。
若将来想给某个**没有动态子路由**的列表页加回骨架（如 `/timeline`、`/moments`），
放到该目录下的 `loading.tsx` 即可，**不要再放回根级**。

**服务端与客户端的边界是硬约束，不是风格问题。** Node 时代这条约束来自
`node:sqlite` 的 null 原型对象；拆分之后它变成了「前端组件不允许 import 任何会发 HTTP 的
业务模块」——所有取数走 `src/lib/api.ts`，纯常量（`moods.ts` / `projects.ts` / `site.ts`）
另存无依赖模块，客户端组件才能安全引用。

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
      鲸鱼娘桌宠、SEO（robots / sitemap / RSS / JSON-LD）
- [x] 阶段 4：Godot 2D 小镇（已上线后于 2026-10-14 整体下线，备份见文首说明）
- [x] 阶段 6：前后端拆分 —— 数据层 / RAG / Agent 内核迁至 FastAPI，Next 只做前端
      （typed fetch 客户端 + camelCase 契约 + Swagger 文档，Node 侧数据层全删）
- [x] 阶段 6b：Function Calling 改造 —— 意图识别从正则挪到模型（工具循环 ≤3 轮、
      引用连续编号、about 硬约束、tool_trace 落库、阈值兜底、无 tools 端点降级），
      Mock 路径行为不变
- [x] 阶段 6c：SSE 流式输出 —— `POST /api/ask/stream` 逐字推送（token / status / done /
      error 四事件，done 载荷与整包路由逐字一致），Mock 模式打字机式分片，
      流式不可用时前端自动回落整包路径
- [x] 阶段 6d：思考链展示 —— 工具调用过程实时可见（step 事件 + 步骤条，结束折叠为
      「检索 N 次 · 引用 M 篇」可展开），历史消息从 tool_trace 回放同一步骤条
- [ ] 阶段 5：后台写作与登录 · Wiki 自动沉淀与出处回链 · 实时日志面板

## 待办（TODO）

手边就能开工、方案已经想清楚的事；方向性的长线计划见下方「路线图」。

- [ ] **把已收藏的两篇总结重跑成真三段式** —— 库里现在还是 Mock 节选。
      配好模型（见「路线图」1）后按原 URL 重跑 `clip` 即可原地替换，
      不用先删笔记，URL 唯一约束会接管更新
- [ ] **收藏管道 HTTP 化** —— 现在只有 CLI（`python -m scripts.clip <url>`）。
      目标补 `POST /api/clippings`（`server/app/api/routes/clippings.py` 目前只有 `GET /clippings/pdf`）
      并在前端给一个「粘贴链接」入口，省掉开终端这一步
- [ ] **清理测试稿** —— `content/sample-vault/clippings/clip-4-more-control-flow-tools.md`
      是验证 PDF 版式时的 Python 教程稿。确认后按三步删除：删文件 →
      `DELETE FROM posts WHERE slug LIKE 'clip-4%'` → 重跑 `init_db`

### 待定（等方案，先不动）

- [ ] **纯图文章怎么处理** —— 公众号常有正文全在截图里的文章，去图后不足 200 字即不进检索，
      命中它时 `retrieve` 直接抛异常、前端提示去看原文 PDF。这是**当前行为不是终态**：
      候选方案有 OCR 抽字 / 视觉模型描述图片 / 干脆不索引，定下来再做
- [ ] **PDF 内嵌图的压缩参数** —— 现在 760px 宽、JPEG q70，嫌存档占地方可以再压

### 小项

- [ ] 桌宠名「鱼干」（鲸鱼也说得通）。要换只改 `src/lib/site.ts` 一处

## 路线图（按依赖顺序）

1. **接入真实语言模型。** 在 `server/.env` 填 `LLM_BASE_URL` 与 `LLM_API_KEY`（两者都需要），
   即可从 Mock 切到真实回答；协议是 OpenAI 兼容格式，换 baseURL 就能接 DeepSeek / 通义 / 智谱 / Ollama。
   切到真实模型后，Function Calling 循环自动生效（见「设计原则」），无需改业务代码。
2. **向量检索。** 导入 Vault 时可选生成 embedding 写入 `chunks.embedding`，
   与现有关键词检索做混合排序（关键词保精度、向量保召回）。
3. **沉淀闭环。** 把问答日志里高频但站内没有的内容，提示补写成新笔记，
   形成「问 → 答 → 补文档」的正循环。
4. **后台与写作。** 登录 + 在线写作 + 代码块插入，省掉「改 Markdown 再跑导入」这一步。

## 说明

`server/.env.example` 列出了后端全部可配置项，均为可选。不配置 LLM 时系统运行在 Mock 模式，
AI 回答由「原文节选 + 出处」拼成，用于完整演示与调试——没有 API Key 也能跑通全部主线。
前端取数地址默认 `http://127.0.0.1:8000`，部署时用 `NEXT_PUBLIC_API_BASE_URL` 覆盖。

## Windows 上的构建提示

`next build` 会批量清理 `.next` 目录，可能被沙箱的删除守卫拦下，构建前带上
`CODEBUDDY_SAFE_DELETE_ENABLED=0`。另外 `@next/swc-win32-x64-msvc` 的 DLL 初始化警告
是无害降级（回落 WASM），不影响产物。
