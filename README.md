# 赛博小镇 · AI 个人博客

以 Obsidian Vault 为内容源的个人知识博客：**结构化阅读 + 带出处的 AI 问答**，全站共用一个 Agent 内核。

笔记仍是普通的 Markdown——`[[双链]]`、`> [!tip]` callout、frontmatter 标签全都照旧，
后台保存时替你写回 Vault 并重建索引。落在网站上的部分解决三件事：

- **自动总结**：每篇文章有一句可读的摘要，参与关系网召回，也是卡片与列表的抬头。
- **关系网查引用**：双链之外还有「相关文章」，按共同标签 / 同被一轮问答引用 / 内容重合
  算出近邻，并**把理由一起带回来**——孤立文章也有下一跳。
- **定位访客意图**：首页主题导览给出「这里在讲什么、该从哪读」；每次提问都落库，
  后台「访客意图」把日志压成高频问题、意图分布与**内容缺口**（问了却没出处的那几句）。

## 架构

**Next.js 只做前端，Python 做后端。** 数据层、RAG 检索、Agent 内核全部在 `server/`
（FastAPI + SQLAlchemy + SQLite），Next 通过 `src/lib/api.ts` 里的 typed fetch 客户端取数，
字段靠 Pydantic 别名与前端逐字对齐。

零外部服务依赖：不需要 Docker、不需要数据库服务器、不需要任何 API Key。

- **默认不需要任何常驻进程**：向量档现在是 `none`，检索只走关键词通道。
  曾经用本机 Ollama + `qwen3-embedding:4b` 跑过语义召回（hit@4 11/16 → 15/16、
  MRR 0.536 → 0.906），但要额外养一个服务、且系统代理会把 `127.0.0.1:11434` 也叼走
  导致静默降级，已从默认配置里摘掉。代码、阈值与 BLOB 向量都还在，想开回来照
  `server/.env.example` 填 `EMBEDDING_*` 即可（换模型必须重跑 `embed_chunks --rebuild`）。
  配了但连不上时，助手面板底部会写明「仅关键词检索 · 语义模型连不上」——降级不无声，
  没配的时候则不显示这一行。
- **唯一的外部数据源是首页 GitHub 热力图**（`GITHUB_USERNAME`）：后端代理第三方接口并缓存 6 小时，
  连不上就用旧缓存，一次都没成功过就整块不渲染——首页不会因为别人家的接口而白屏。
- **不配 LLM 也能跑通全部主线**：回答由「原文节选 + 出处」拼成（Mock 模式），
  配了就换真实模型跑 Function Calling。

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

两个进程各自可热重载；前端未启动时后端仍可独立调试（`http://127.0.0.1:8000/docs` 有完整 API 文档）。

导入自己的 Vault：

```bash
cd server && VAULT_DIR="/path/to/your/vault" python -m scripts.init_db
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动前端开发服务器（:3000） |
| `npm run build` | 前端生产构建 |
| `npm run server` | 启动 Python 后端（:8000，热重载） |
| `npm run server:init` | 建表 + 种子 + 导入 Vault（幂等，可反复跑） |
| `cd server && python -m pytest` | 后端纯函数单测（不连库不发请求，数秒跑完；先装 `requirements-dev.txt`） |
| `cd server && python -m scripts.embed_chunks` | 补向量（幂等）；`--rebuild` 全量重算，`--stats` 只看现状 |
| `cd server && python -m scripts.eval_retrieval` | 检索评估：关键词 vs 混合的位次 / hit@4 / MRR |
| `npm run e2e` | 三条冒烟：首页三区块 / 软 404 / 未登录后台跳登录（需前后端都在跑，用系统 Edge） |

微信收藏 → 知识库（收件箱管道：浏览器打开文章 → 复制链接，其余全自动）。
两个入口同一份实现（`server/app/services/clipping.py`）：CLI 是 `python -m scripts.clip <url>`
（`--paste` 粘贴全文，公众号反爬时用；`--list` 查看已收藏），或者后台 `/admin/clippings`
贴链接点「收藏」。收藏稿落在 `content/sample-vault/clippings/`，与手写笔记同库，立刻可被检索引用。

## 路由

| 路由 | 内容 |
|---|---|
| `/` | 首页：资料卡 + 最新文章轮播 + 主题导览（全站索引入口 + 分类导航）+ GitHub 热力图 |
| `/timeline` | 归档与探索：搜索 + 主题 + 标签 + 双视图（中枢链路 / 矩阵网格） |
| `/posts/[slug]` | 文章详情：封顶封面、目录、代码高亮、灯箱、上下篇、相关文章、出链/反链 |
| `/projects` | 项目矩阵：搜索 + 技术栈胶囊 + 外链 |
| `/moments` | 说说流：宫格自适应、排序切换、搜索 |
| `/friends` | 友链：卡片墙，数据入库，由 `/admin/friends` 维护 |
| `/about` | 关于：自我介绍、时间线、技能栈、兴趣、联系方式 |
| `/admin` `/admin/posts` `/admin/friends` `/admin/logs` `/admin/insights` `/admin/clippings` | 后台：口令登录、文章增删改（含摘要生成）、友链增删改、收藏、对话日志、访客意图（未配 `ADMIN_PASSWORD` 则整块禁用） |
| `/robots.txt` `/sitemap.xml` `/rss.xml` | 由 `app/robots.ts`、`app/sitemap.ts`、`app/rss.xml/route.ts` 生成 |

## 项目结构

```
src/                       前端（Next.js App Router）
  app/
    page.tsx         首页：资料卡 + 最新文章轮播 + 主题导览 + GitHub 热力图
    timeline/        归档（筛选条件走 URL，便于分享与后退）
    posts/[slug]/    文章详情
    moments/         说说流
    projects/        项目矩阵
    friends/         友链
    about/           关于
    admin/           后台：layout 是认证闸门 + 侧栏，posts 列表/编辑器，friends 友链管理，
                     logs 日志面板，insights 访客意图（高频问题 / 缺口 / 意图分布）
    robots.ts sitemap.ts rss.xml/route.ts
    error.tsx not-found.tsx
  lib/
    api.ts           唯一的数据出口：typed fetch 客户端，字段与后端 camelCase 契约对齐
    admin.ts         后台的 fetch 客户端（同源 /api 代理）
    markdown.ts      Markdown → HTML（remark/rehype + Shiki 代码高亮）+ 目录抽取
    projects.ts      项目清单（编译期常量，不入库）
    cover.ts         分类配色：卡片封面 / 图谱节点 / 友链首字母块共用
    categoryLabel.ts 分类显示名（英文 slug 分类如 clippings 换成中文，只影响显示）
    site.ts          站点文案与个人信息的唯一出处
  components/
    BlogAssistant.tsx   博客助手面板（带出处卡片、思考链；由桌宠派发事件唤出）
    MingyuePet.tsx      鲸鱼娘桌宠「溟月」：PixiJS 帧动画 + 状态机，同时是助手唯一入口（首访挂引导气泡）
    Carousel.tsx        卡片轮播（首页复用）
    TopicGuide.tsx      首页主题导览：全站索引主入口 + 按分类摊开各主题的文章
    GitHubHeatmap.tsx   首页 GitHub 贡献热力图：SVG 网格 + 悬停提示，数据来自后端代理
    Toc.tsx             正文目录（滚动高亮）
    CodeCopy.tsx        代码块的语言标签 / 复制 / 行号
    Lightbox.tsx        图片灯箱（事件委托，文章与说说复用）
    RelatedPosts.tsx    文章页「相关文章」：双链之外的隐式近邻，卡片上带召回理由
    TimelineControls.tsx / ProjectsBoard.tsx / MomentsBoard.tsx
    SiteHeader.tsx / SiteFooter.tsx / Danmaku.tsx / PageHeader.tsx
    AmbientBackdrop.tsx / ThemeToggle.tsx
server/                   后端（FastAPI + SQLAlchemy）
  app/
    main.py           FastAPI 入口：CORS、lifespan 建表、路由注册
    database.py       引擎与会话：sqlite+aiosqlite，WAL + 外键在 connect 级挂 PRAGMA
    schema.sql        全部 DDL（与数据同源，建表只认这一份）
    models.py         ORM 模型：14 张表，字段与前端类型逐字对齐
    schemas.py        Pydantic 响应模型：snake_case → camelCase 别名生成
    services/
      content.py      文章 / 说说 / 图谱查询
      agent_chat.py   Agent 内核 + RAG 检索 + LLM 适配 + Mock 三分支
      keyword.py      分词与 IDF 重合度：问答检索与相关文章召回共用同一份规则
      embedding.py    向量档：none/hash/openai 三 provider、BLOB 信封、去均值、余弦与查询缓存
      embedding_job.py 补向量：CLI 与两个索引重建入口共用（best-effort，失败不影响导入）
      clipping.py     收藏管道：抓取 / 摘抄 / PDF 存档 / 写笔记 / 入库建索引（CLI 与后台共用）
      summary.py      一句话摘要：确定性抽取（保存兜底）+ 模型生成/优化（编辑器按钮），两档分离
      insights.py     访客意图聚合：意图分流 / 问题聚类 / 内容缺口，纯函数（后台 insights 页的数据源）
    api/routes/
      content.py      内容查询接口
      ask.py          博客助手问答（整包 + SSE 流式双路由）与会话回放
      clippings.py    收藏的公开出口：原文 PDF 存档下载（按 URL 命中）
      github.py       GitHub 贡献热力图：代理第三方接口 + 6 小时缓存，失败降级不拖垮首页
      admin.py        后台接口：口令登录 + 文章 CRUD + 友链 CRUD + 收藏 + 对话日志（全部要过 require_admin）
  scripts/
    init_db.py       建表 + 种子 + Vault 导入（幂等；`--embed` 顺带补向量）
    clip.py          微信收藏管道的 CLI 外壳（流程见 services/clipping.py）
    embed_chunks.py  给切分块补向量（幂等、`--rebuild`、`--stats`）
    eval_retrieval.py 检索评估：关键词 vs 混合，并排看位次 / hit@4 / MRR
  tests/             纯函数单测（pytest，不连库不发请求）
  pytest.ini         pythonpath = .，从 server/ 直接 python -m pytest
  requirements.txt
  requirements-dev.txt   只多一个 pytest
content/
  sample-vault/      示例 Vault，用来跑通全流程（clippings/ 是收藏管道的自动入库目录）
  moments.json       说说种子数据
  friends.json       友链种子数据（仅在 friends 表为空时灌，之后归后台管）
  town/agents.json   角色设定（人格、口吻），博客助手也在这里
e2e/
  smoke.mjs          三条冒烟：首页三区块 / 软 404 / 未登录后台跳登录
                     （不碰 LLM；浏览器用系统 Edge，不下载 Chromium）
docs/
  DESIGN.md          设计与实现说明：架构取舍、检索标定、素材规格、配置与构建注意事项
  EXECUTION_PLAN.md  进展 / 验收 / 待办（任务级清单的唯一出处）
public/
  pets/mingyue/      桌宠帧序列（8 个动作组的 WebP，导出规格见 DESIGN.md）
```

## 后续发展

方向性的三件事，按依赖顺序：

1. **要不要把语义召回装回来。** 现在默认 `none`，纯关键词。`qwen3-embedding:4b` 曾把
   hit@4 从 11/16 拉到 15/16、MRR 0.536 → 0.906，代价是一个常驻进程和一层运维风险
   （代理吞本机端口那类问题会表现为「静默降级」）。决定开回来时流程是固定的：
   `embed_chunks --rebuild` → `eval_retrieval` 看 MRR → 扫 `VEC_FLOOR` / `VEC_WEIGHT`
   （用闲话提问确认闸门没被撑破）→ 才改 `.env`。**别跳过重标**：0.15 / 10.0 是按
   那个模型的去均值量级量出来的，不是通用值。要动 `_score_chunk`，
   `RAG_MIN_SCORE = 1.0` 也必须一起重标。
2. **沉淀闭环。** 「访客意图」已经能把「问了却没出处」的问题列出来，并一键带到编辑器
   （标题预填访客原话）；下一步是把「问 → 答 → 补文档」接成自动的：
   补完之后回看那条缺口是否消失。
3. **编辑器增强。** 正文现在仍是纯 textarea；补 Markdown 实时预览、代码块插入、
   图片上传，就彻底不用再手工改文件。

三条当前行为不是终态的已知缺口：

- **纯图文章**（公众号正文全在截图里）去图后不足 200 字即不进检索，命中时提示去看原文 PDF。
  候选方向：OCR 抽字 / 视觉模型描述图片 / 干脆不索引。
- **前端只有三条冒烟**：`npm run e2e` 盯住「首页三区块 / 软 404 / 后台跳登录」——这三条是
  整体崩掉最丢人的路径，不是覆盖率。助手问答、编辑器这类交互仍靠临时脚本，没有固化。
- **桌宠素材对齐**：`hover` 三帧水平中心差 12% 帧宽、`pet_head` 的手臂被左边缘切出平口，
  都要重跑生图，代码补不了。

任务级清单（谁欠谁、验收标准）见 `docs/EXECUTION_PLAN.md`；设计取舍与实现细节见 `docs/DESIGN.md`。
