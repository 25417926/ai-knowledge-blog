# 赛博小镇 · AI 个人博客

以 Obsidian Vault 为内容源的个人知识博客：**结构化阅读 + 带出处的 AI 问答**，全站共用一个 Agent 内核。
（曾有一个 Godot 做的 2D 小镇端，已于 2026-10-14 下线，备份 `_town_backup_2026-10-14.zip`
已挪到仓库外的 `D:\porm\workbuddy\archives\`。）

**架构：Next.js 只做前端，Python 做后端**（2026-10-15 起）。数据层、RAG 检索、Agent 内核全部在
`server/`（FastAPI + SQLAlchemy + SQLite），Next 通过 `src/lib/api.ts` 里的 typed fetch 客户端取数。

## 快速开始

```bash
# 1. 后端（Python 3.11+）
cd server && python -m venv .venv
.venv/Scripts/activate        # Windows；macOS/Linux 用 source .venv/bin/activate
pip install -r requirements.txt
python -m scripts.init_db     # 建表 + 角色/说说种子 + 导入示例 Vault
python -m uvicorn app.main:app --reload --port 8000

# 2. 前端（另一个终端）
npm install
npm run dev                   # http://localhost:3000
```

首页是卡片墙：资料卡 + 最新文章轮播 + 状态/主题/说说卡。
顶部导航在「归档 / 项目 / 说说 / 友链 / 关于」之间切换，`/blog` 旧地址仍会 308 跳新地址。

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
python -m scripts.clip <url>            # 抓取 → 笔记体摘抄 → 写 clippings/ 笔记 → 建索引
python -m scripts.clip <url> --paste    # 公众号反爬时：跳过抓取，粘贴全文（第一行当标题）
python -m scripts.clip --list           # 查看已收藏
```

抓取用 trafilatura，失败自动降级粘贴；摘抄按手写笔记的体例压一遍（开头一句导语、
正文按原文脉络分节、要点前加粗关键词、末尾一句 `[!tip]` callout 收尾），未配 LLM 时出节选式 Mock 摘抄。
URL 唯一，重复收藏原地更新。收藏稿落在
`content/sample-vault/clippings/`，与手写笔记同库，立刻可被 AI 助手检索引用。

## 路由

| 路由 | 内容 |
|---|---|
| `/` | 首页：资料卡 + 最新文章轮播 + 主题导览（全站索引入口 + 分类导航）+ 状态/说说 |
| `/timeline` | 归档与探索：搜索 + 主题 + 标签 + 双视图（中枢链路 / 矩阵网格） |
| `/posts/[slug]` | 文章详情：封顶封面、目录、代码高亮、灯箱、上下篇、相关文章、出链/反链 |
| `/projects` | 项目矩阵：搜索 + 技术栈胶囊 + 外链 |
| `/moments` | 说说流：宫格自适应、排序切换、搜索 |
| `/friends` | 友链：卡片墙，数据入库，由 `/admin/friends` 维护 |
| `/about` | 关于：自我介绍、时间线、技能栈、兴趣、联系方式 |
| `/admin` `/admin/posts` `/admin/friends` `/admin/logs` | 后台：口令登录、文章增删改、友链增删改、对话日志（未配 `ADMIN_PASSWORD` 则整块禁用） |
| `/robots.txt` `/sitemap.xml` `/rss.xml` | 由 `app/robots.ts`、`app/sitemap.ts`、`app/rss.xml/route.ts` 生成 |

`/blog` 与 `/blog/:slug` 在 `next.config.mjs` 里做了 308 永久重定向。
放在配置层而不是页面里，是因为页面内重定向要等 `async searchParams` 把流式响应冲出去，
Next 只能退回 `meta refresh`，拿不到真正的 308。

## 目录结构

```
src/                       前端（Next.js App Router）
  app/
    page.tsx         首页：卡片网格 + 最新文章轮播
    timeline/        归档（筛选条件走 URL，便于分享与后退）
    posts/[slug]/    文章详情
    moments/         说说流
    projects/        项目矩阵
    friends/         友链
    about/           关于
    admin/           后台：layout 是认证闸门 + 侧栏，posts 列表/编辑器，friends 友链管理，logs 日志面板
    robots.ts sitemap.ts rss.xml/route.ts
    error.tsx not-found.tsx
  lib/
    api.ts           唯一的数据出口：typed fetch 客户端，字段与后端 camelCase 契约对齐
    admin.ts         后台的 fetch 客户端（改走同源 /api 代理，见「后台」一节）
    markdown.ts      Markdown → HTML（remark/rehype + Shiki 代码高亮）+ 目录抽取
    projects.ts      项目清单（编译期常量，不入库）
    cover.ts         分类配色：卡片封面 / 图谱节点 / 友链首字母块共用
    categoryLabel.ts 分类显示名（英文 slug 分类如 clippings 换成中文，只影响显示）
    site.ts          站点文案与个人信息的唯一出处
  components/
    BlogAssistant.tsx   博客助手面板（带出处卡片、思考链；由桌宠派发事件唤出）
    MingyuePet.tsx      鲸鱼娘桌宠「溟月」：PixiJS 帧动画 + 状态机，同时是助手唯一入口
    Carousel.tsx        卡片轮播（首页复用）
    TopicGuide.tsx      首页主题导览：全站索引主入口 + 按分类摊开各主题的文章
    Toc.tsx             正文目录（滚动高亮）
    CodeCopy.tsx        代码块的语言标签 / 复制 / 行号
    Lightbox.tsx        图片灯箱（事件委托，文章与说说复用）
    TimelineControls.tsx / ProjectsBoard.tsx / MomentsBoard.tsx
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
      content.py      文章 / 说说 / 图谱查询（Node 版 lib 的逐函数移植）
      agent_chat.py   Agent 内核 + RAG 检索 + LLM 适配 + Mock 三分支
    api/routes/
      content.py      内容查询接口
      ask.py          博客助手问答（整包 + SSE 流式双路由）与会话回放
      admin.py        后台接口：口令登录 + 文章 CRUD + 友链 CRUD + 对话日志（全部要过 require_admin）
  scripts/
    init_db.py       建表 + 种子 + Vault 导入（幂等）
    clip.py          微信收藏管道：抓取 → 摘抄 → 入库 → 建索引
  requirements.txt
content/
  sample-vault/      示例 Vault，用来跑通全流程（clippings/ 是收藏管道的自动入库目录）
  moments.json       说说种子数据
  friends.json       友链种子数据（仅在 friends 表为空时灌，之后归后台管）
  town/agents.json   角色设定（人格、口吻），博客助手也在这里
```

## 设计要点

**内容只存一份。** Markdown 原文进 `posts.content`，按标题切分成 `chunks` 供 RAG 检索，
`[[双链]]` 解析进 `links`。博客阅读、AI 检索、知识图谱三种用途复用同一份数据，不各自维护。

**首页要回答「这里在讲什么、我该从哪读」。** 原先首页是一墙卡片：最新文章轮播 + 说说照片，
能看出「有什么新东西」，看不出「我该从哪进」。现在补了一块**主题导览**（`TopicGuide.tsx`）——
左边是把《知识地图总览》那篇笔记提上来的 START HERE 主入口卡，右边按分类各摊一张主题卡，
卡里直接铺该主题的文章标题，所以从首页到任一篇笔记都是一步。
分类来自接口（`listCategories()`），不写死在前端；但「知识地图」这一类要单独挑出来做主入口，
因为它是索引本身而不是一个内容主题 —— 它若混在主题网格里，就成了「一篇讲目录的文章」。
归档页同时补了主题筛选条，`?category=` 与 `?tag=` 平级：都是可见、可点、可分享的维度，
`clippings` 这类英文分类名在界面上换成中文（`categoryLabel.ts`，只影响显示，URL 与库里都不动）。

**双链之外还有一档关系：相关文章。** `[[双链]]` 是作者手写的边，一篇都没链到的**孤立文章**
在文章页的「出链 / 反向链接」两块里全是空的，读者到那里就走不下去了。文章页因此多了
**相关文章**区块（`RelatedPosts.tsx` + `GET /api/posts/{slug}/related`）：后端按
「共同标签 / 同被一轮问答引用 / 内容重合」算出**本文没链接到**的近邻，并把召回的**理由**
一起带回来——写着「共同标签 #Java」的推荐才有人信，一排没来由的卡片只会被当成广告。
这一档只服务文章页；`/api/graph` 仍以 `links` 为唯一边源（没有图谱页之前，
不往接口里塞没人读的字段）。

**后台保存写回文件，而不是只写数据库。** `/admin` 里保存文章时，先把内容写成
`content/sample-vault/<分类>/<标题>.md`（frontmatter 沿用现有笔记风格），再调
`scripts.init_db.import_vault` 重建索引——切分、双链解析、标签一律复用那一份实现，
不另写一套。不能只写库的原因：`import_vault` 只做 upsert、从不删，若后台只改数据库，
下次谁再跑一次 `init_db`，文件里的旧内容就会把改动覆盖掉。全量重导同时也是**正确**做法——
新文章的反向链接要靠「所有笔记一起解析」才接得上。删除 = 删文件 + 删行
（`chunks` / `links` / `post_tags` 走外键级联），并清掉不再被引用的标签。
换言之，后台替你在维护 Obsidian 仓库。

**友链是上面这条规则的例外，因为它没有文件。** `/admin/friends` 改完只写 `friends` 表：
友链是纯展示数据，不进 RAG 也不进图谱，所以「文件覆盖数据库」的坑不存在。
种子 `content/friends.json` 只在表为空时灌一次——后台删掉的条目不会被 `init_db` 复活，
之后一切以数据库为准。

**后台的登录态走同源代理，不直连后端。** 口令校验通过后签一个带到期时间的 token
写进 httpOnly cookie（标准库 `hmac`，不引 JWT）；前端不用 `lib/api.ts` 那套绝对地址，
而是走 `/api/admin/*` 同源相对路径，由 `next.config.mjs` 现成的 rewrites 转给后端。
原因是 cookie 落在哪个主机上很要命：直连 `127.0.0.1:8000` 的话，你从 `localhost:3000`
打开页面就成了跨站请求，SameSite=Lax 的 cookie 不会带上，表现为「刚登录完又被弹回登录页」。
没配 `ADMIN_PASSWORD` 时后台整体返回 503（而不是"空口令可登录"）；草稿不进前台列表、
详情与 AI 检索——`status='draft'` 在公开查询和 `_load_chunks` 里都被挡在外面。

**Agent 内核。** `agents` 系列表（角色 / 记忆 / 好感度 / 会话 / 日志 / 引用）是
全站 AI 助手的地基，博客助手「知行」见 `content/town/agents.json`
里 `meta.blogAssistant = true`。内核完整迁到了 `server/app/services/agent_chat.py`，
四个行为细节被刻意保留：好感度只增不减（单轮 +1~4）、短期记忆直接读最近 8 轮
`agent_turns`、Mock 三分支且明说「这是节选不是转述」。

**问答入口只有一个：桌宠「溟月」。** 左下角那只鲸鱼娘点一下就唤出助手面板（走一个
`blog-assistant:open` 自定义事件，`BlogAssistant` 监听后展开），助手自己不再挂右下角的浮动按钮。
这不只是为了不重复：两者曾经各自调 `/api/ask` 里的同一个 agent 和同一个会话（`blog`），
于是从宠物那边问的话会算进知行的上下文、记忆与好感度里，两边并发提问还会互相顶掉轮次。
入口并成一个之后，这种分叉在物理上就不可能发生了 —— 但**桌宠本身仍然不碰问答**，
它只负责派发一个事件，agent 与会话从头到尾只有一套。

**桌宠是帧动画状态机，不是切表情。** 渲染走 PixiJS（`pixi.js` 只在 `useEffect` 里动态
import，首屏包不含它），状态表 `CLIPS` 定义每个动作的帧序列与节奏：
待机随机眨眼、悬停换姿态、单击换表情并说一句邀请（顺手叫出助手）、双击摸头听它说句闲话、
按住拖走播小碎步、松手重力落地弹跳回待机，挂机冷却满了会自动演一遍煮饭剧情
（蹲锅边 → 捧钵吃 → 定格满足）。指针事件挂在容器上、位置由 React 管 ——
没有采用「全屏透明 canvas 接管鼠标」那套，那会把整页的点击与文字选择一起吞掉。
素材与导出规格见「桌宠素材」一节。

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

**双链是图谱的唯一边源。** 2D 脉络图从 `links` 派生，不额外维护关系数据
（文章页的「相关文章」是另一档、按需现算的隐式边，见上文，不进图谱）。
前端 `markdown.ts` 与后端 `content.py` 各有一份 slug 归一化（`normalizeKey` / `to_slug`），
规则必须一致，否则 `[[标题]]` 会在前端解析出不同的 key，指向已存在文章也显示「待创建」。

**故意没有 `app/loading.tsx`。** 根级 `loading.tsx` 会给整棵树套一层 Suspense，
于是 `/posts/[slug]` 这类动态详情页会在 `notFound()` 判定之前
就把 `200` 冲出去——不存在的 slug 会渲染出「文章不存在」的页面，但 HTTP 状态码仍是 200，
也就是**软 404**，搜索引擎会把它当正常页面收录。这两个详情页都是 `force-dynamic`，
必须让 404 在首字节之前定下来，所以根级加载骨架被移除。
代价很小：没有 `loading.tsx` 时 Next 会在导航期间保留上一页，本地毫秒级渲染下体验反而更稳。
若将来想给某个**没有动态子路由**的列表页加回骨架（如 `/timeline`、`/moments`），
放到该目录下的 `loading.tsx` 即可，**不要再放回根级**。

**服务端与客户端的边界是硬约束，不是风格问题。** Node 时代这条约束来自
`node:sqlite` 的 null 原型对象；拆分之后它变成了「前端组件不允许 import 任何会发 HTTP 的
业务模块」——所有取数走 `src/lib/api.ts`，纯常量（`projects.ts` / `site.ts`）
另存无依赖模块，客户端组件才能安全引用。

**Obsidian callout 是渲染管线里唯一一处「改结构」的 markdown 扩展。** `> [!tip] 标题`
这类块在 mdast 阶段就被换成 `div.callout.callout-<type>`（外加一个 `.callout-title`），
图标与类型色全由 CSS 变量派生（见 `globals.css`），所以不引图标库、也不需要在服务端
认识这套语法。没写标题时补中文默认名（如 `[!info]` → 「说明」），表里没有的类型落中性色，
不破版。`[[双链]]` 那种是纯文本替换，不涉及节点树。

**代码高亮走 Shiki 双主题。** `@shikijs/rehype` 只往每个 token 写 `--shiki-light` /
`--shiki-dark` 两个 CSS 变量（`defaultColor: false`），显示哪套由 `.dark` 选择器决定——
切主题不需要重渲染，也不会闪。语言标签、复制按钮、行号由 `CodeCopy.tsx` 在客户端补，
用 CSS 计数器做行号，不改动 Shiki 的输出结构。

## 桌宠素材

原始素材是 22 张 1024×1024 的透明 PNG（8 个动作组：`idle` 1 / `blink` 2 / `click` 3 /
`hover` 3 / `lifted` 1 / `walk` 2 / `cook_rice` 8 / `pet_head` 2，合计 20.7MB），
放在 `public/pets/mingyue/<动作组>/` 的是导出后的 WebP，共 0.86MB。导出规则：

1. 按 `alpha > 8` 求内容 bbox，裁掉四周空白，再各留 4px 内边距
2. 等比缩放到高度 384（跨帧、跨动作组角色大小一致）
3. **同组按该组最宽帧左右对称补透明**，组内所有帧尺寸完全相同
4. 存 WebP（`quality=88`，带 alpha）

第 2、3 步是为了运行时不抖：容器按「底边中点」定位，高度不统一角色会忽大忽小，
宽度不统一容器每帧改尺寸、画面会左右晃。裁切还有个必要副作用——裁完之后
「图片底边中点」就是「内容底边中点」，精灵按这里对齐地面，站立帧的脚就落在同一条线上。

已知两处素材本身的瑕疵（未修，改素材要重跑生图）：
- `hover` 三帧之间内容水平中心差 12% 帧宽，循环播放会轻微左右晃
- `pet_head` 里那只手是从画面左边缘切进来的，手臂有一截平口

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
- [x] 阶段 5a：后台写作与登录 · 对话日志面板 —— `/admin` 口令登录、文章增删改
      （保存即写回 Vault 并重建索引、草稿不进前台与检索）、对话日志时间线
- [x] 阶段 5c：桌宠重做 —— 换成 PixiJS 帧动画状态机（待机呼吸/眨眼、悬停、点击表情+气泡、
      双击摸头、拖走小碎步、松手重力落地弹跳、挂机煮饭剧情），素材 20.7MB → 0.86MB WebP
- [x] 阶段 7：砍杂谈 · 加友链 · 助手入口并到桌宠 —— 杂谈前后端连同 6 篇原文一起下线；
      新增 `/friends`；助手撤掉右下角浮动按钮，
      改由桌宠单击派发 `blog-assistant:open` 唤出，agent 与会话依旧唯一
- [x] 友链改成后台维护 —— `friends` 表 + `/admin/friends` 增删改（原先写死在 `src/lib/friends.ts`），
      前台 `/friends` 改动态取数；种子 `content/friends.json` 仅在表空时灌
- [x] 阶段 5b：落地导览 —— 原「Wiki 自动沉淀」方案作废（`wiki_entries` / `wiki_sources`
      两张零引用的表已随 2026-10-17 的死重清理删除）。实际做法：首页加「主题导览」区块，
      把《知识地图总览》提为 START HERE 主入口卡（`listCategories()` 终于接上），
      其余分类各摊成一张主题卡，卡里直接铺该主题的文章标题；
      归档页补主题筛选条，`?category=` 成了和标签平级的可见维度
- [x] 关系网召回 —— 双链之外补上「相关文章」（文章页区块 + `GET /api/posts/{slug}/related`）：
      共同标签 / 同被一轮问答引用 / 内容重合三档证据，排除已经互相链接的文章，
      召回理由随卡片一起显示；孤立文章因此在文章页有了下一跳。
      分词抽成 `server/app/services/keyword.py`，问答检索与相关推荐共用一份

## 待办（TODO）

手边就能开工、方案已经想清楚的事；方向性的长线计划见下方「路线图」。

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

- [ ] **桌宠素材二次对齐** —— `hover` 三帧水平中心差 12% 帧宽（44.9% → 56.9%），
      循环播放会轻微左右晃；`pet_head` 的手臂被左边缘切出平口。
      两者都要重跑生图或做像素级重排，不是代码能补的
- [ ] 桌宠改名只需改 `src/lib/site.ts` 一处（`pet.name`，气泡与 aria-label 都跟着走）

## 路线图（按依赖顺序）

1. **向量检索。** 导入 Vault 时可选生成 embedding 写入 `chunks.embedding`，
   与现有关键词检索做混合排序（关键词保精度、向量保召回）。
2. **沉淀闭环。** 把问答日志里高频但站内没有的内容，提示补写成新笔记，
   形成「问 → 答 → 补文档」的正循环。
3. **编辑器增强。** 正文现在是纯 textarea；补 Markdown 实时预览、代码块插入、
   图片上传，就彻底不用再手工改文件了。

## 说明

`server/.env.example` 列出了后端全部可配置项。不配置 LLM 时系统运行在 Mock 模式，
AI 回答由「原文节选 + 出处」拼成，用于完整演示与调试——没有 API Key 也能跑通全部主线。
前端取数地址默认 `http://127.0.0.1:8000`，部署时用 `NEXT_PUBLIC_API_BASE_URL` 覆盖。

后台上线方式是给 `server/.env` 加一行 `ADMIN_PASSWORD=你的口令`（改口令会让已签发的会话立刻失效），
然后重启后端，开 `http://localhost:3000/admin`。留空则 `/admin` 整块禁用，前台不受影响。

## Windows 上的构建提示

`next build` 会批量清理 `.next` 目录，可能被沙箱的删除守卫拦下，构建前带上
`CODEBUDDY_SAFE_DELETE_ENABLED=0`。另外 `@next/swc-win32-x64-msvc` 的 DLL 初始化警告
是无害降级（回落 WASM），不影响产物。
