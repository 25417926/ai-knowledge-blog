# 执行文档 · AI 个人博客

> 更新于 2026-10-17，数据来自对仓库与数据库的逐项实测（非凭记忆）。
> 状态标记：✅ 已完成 · 🟡 部分完成 / 有条件可用 · ❌ 未开始 · 🗑 已下线
>
> **本文只讲三件事：做到哪了、接下来做什么、欠了什么。**
> 架构、目录结构、启动方式、设计取舍一律以根目录 `README.md` 为唯一出处，本文不复述——
> 同一件事写两份，必然有一份先烂，这正是本文上一版出问题的原因。
> 同目录 `BLOG_REPLICA_PLAN.md` 是「内容站 1:1 复刻」阶段的定档留档，已停更，不作行动依据。

---

## 0. 一句话现状

主干全部交付且可复现：Next.js 阅读端 + FastAPI 数据层 + RAG 问答 + Agent 内核 + 后台写作，
零外部服务依赖、无 Key 也能全流程演示。小镇端已下线，访客进门的落地导览也已补上（见 §7）。
剩下的是增强项与债务清理：关系网召回、向量检索、收藏管道 HTTP 化、测试
（摘要兜底已降入 §9 技术债 7）。

---

## 1. 快照（2026-10-17 实测）

| 项 | 值 |
|---|---|
| 提交 | 本地 HEAD 与 `origin/main` 一致（此前提交已全部推送） |
| 远程 | https://github.com/25417926/ai-knowledge-blog（public，分支 `main`） |
| 前端 | `src/` 46 个源文件 / 6226 行（Next.js 15 App Router · React 19 · TS · Tailwind 3.4） |
| 后端 | `server/` 18 个 `.py` / 4124 行（FastAPI · SQLAlchemy · aiosqlite） |
| 数据库 | `data/blog.db`，`server/app/schema.sql` 定义 **14 张表** |
| 内容 | 12 篇笔记 · 132 切分块 · 36 条双链 · 24 个标签 · 8 条说说 · 3 条友链 · 2 篇收藏 · 3 个角色 |
| 问答存量 | 170 轮对话（其中 85 轮提问）· 282 条引用（247 条带出处）· 3 个会话 |
| 测试 | **0 个**（无 `*.test.*` / `*.spec.*`） |

---

## 2. 功能进度

### 2.1 已交付 ✅

| 模块 | 一句话 |
|---|---|
| 工程与构建 | 脚手架、Vault 导入脚本、`.env.example` 全量配置项；零原生依赖 |
| 阅读端 | `/` 卡片墙 · `/timeline` 双视图归档 · `/posts/[slug]` · `/projects` · `/moments` · `/friends` · `/about` |
| Markdown 管线 | remark/rehype + Shiki 双主题零重渲染、目录、行号、复制、灯箱、Obsidian callout |
| 主题与氛围 | 暗/亮双主题、氛围背景、开屏、弹幕、PixiJS 桌宠「溟月」 |
| 内容数据层 | `posts` / `chunks` / `links` / `post_tags`，内容只存一份，三种用途复用 |
| RAG 检索 | 中文二元组 + IDF；标题 3.0 / 小节 1.6 / 正文 1.0；`RAG_MIN_SCORE=1.0` 兜底 |
| Agent 内核 | `agents` / `agent_memories` / `agent_relations` / `agent_sessions` / `agent_turns` / `citations` |
| 博客助手「知行」 | 浮动面板、引用卡片、思考链；`/api/ask` 整包 + `/api/ask/stream` SSE |
| 真实模型 | DeepSeek（OpenAI 兼容）+ Function Calling 工具循环（≤3 轮）；无 Key 自动回落 Mock |
| 落地导览 | 首页主题导览（索引入口卡 + 按分类摊开文章直链）· 归档页主题筛选条（2026-10-17，见 §7） |
| 收藏管道 | trafilatura 抓取 → 笔记体摘抄（见 §5）→ PDF 存档 → 写 vault 建索引；CLI 形态 |
| 后台 | `/admin` 口令登录、文章 CRUD、友链 CRUD、保存写回 md 并重建索引、对话日志面板 |
| SEO | `robots` / `sitemap` / `rss` 动态生成；软 404 已修（根级 `loading.tsx` 已移除） |
| 引用锚点 | `chunk_id` → `post_slug + heading_path + quote`（2026-10-16，见 §3） |

### 2.2 已下线 🗑

- **Godot 2D 小镇端**（2026-10-14）：代码与素材备份在仓库外 `D:\porm\workbuddy\archives\_town_backup_2026-10-14.zip`。
- **杂谈**（2026-10-16）：前后端 15 个牵连点（表 / 路由 / 页面 / 组件 / `moods.ts` / 导航 /
  sitemap / rss / 首页轮播 / 统计口径）全链路移除，6 篇原文与 `chatter` 表一并删除。
  桌宠单击让位给「唤出助手」，双击摸头仍说原来的闲话（`site.pet.lines`），
  单击话术改由新增的 `site.pet.askLines` 提供。

### 2.3 未开工 ❌

- **向量混合检索**：`chunks.embedding` 字段与 `EMBEDDING_*` 配置项已预留，零代码写它。
- **收藏管道 HTTP 化**：缺 `POST /api/clippings` 与前端「粘贴链接」入口，目前只能跑 CLI。
- **纯图文章**：正文全在截图里的收藏稿，当前不进检索、命中即抛错提示去看原文 PDF。
- **测试**：见 §9。

---

## 3. 本轮：引用锚点修复（2026-10-16）

**症状。** `citations` 表 274 条引用里 260 条 `chunk_id` 为 NULL。界面上不报错——
历史回放的出处卡片静默消失，只有查库才看得见。

**根因。** `import_vault` 每导入一次就把该 post 的 chunks 全删重插（`init_db.py:296`），
`chunks.id` 是自增主键，旧 id 全部消失，外键 `ON DELETE SET NULL` 顺手把回链擦成 NULL。
**只要再跑一次 `init_db` 引用就断一次**——这不是一次性故障，是每次导入都复现的设计缺陷。

**处置。** 锚点换成稳定业务键，不再依赖派生数据的自增主键：

| | 旧 | 新 |
|---|---|---|
| 锚 | `chunk_id`（自增，重导即失效） | `post_slug` + `heading_path` + `quote` |
| 稳定性 | 每次导入必断 | slug 由 `import_vault` upsert，永不漂移 |
| 可读性 | 引用不自包含，必须 join 到 chunks | 自包含：哪篇、哪节、原话是什么 |

引用自此即使文章被改写、切分块被重建、文章被删，仍能完整显示出处。

**迁移。** 见 `server/app/database.py` 的 `_migrate_citations_anchor()`，旧行按两种办法回捞：
chunk 尚存活的直接取 slug/heading；其余用 `quote` 前缀在现有 `chunks.body` 里比对
（`quote` 落库时就是 `body.strip()[:400]`，是精确逆运算，不是模糊匹配）。
回捞不到的保留原样（`post_slug` 为空，前端不渲染），**不删数据**。

实测结果（2026-10-16）：

| | 条数 |
|---|---|
| 迁移前有锚的引用 | 14 / 274 |
| 迁移后带出处的引用 | **239 / 274**（14 条原本存活 + 225 条捞回） |
| 未能回捞 | 35（集中在被重新抓取过的收藏稿——那部分原文本身已替换，捞不回是应该的） |

**验收**：连跑两次 `init_db`（chunks 全量重建，id 从 3072 漂到 3333），
引用条数稳定在 274 / 239 不变——修复前同样操作会把它们全部清成 NULL。
`GET /api/ask`（历史回放）68 轮问答共 239 个出处卡片恢复渲染；
`POST /api/ask` 与 `/api/ask/stream` 的新引用均正确落 `post_slug + heading_path`。

**刻意没做。** 不改 `import_vault` 的「删除重建」策略——chunks 是检索用的派生数据，
重建本身没有错，错的是把它易变的主键当锚。

---

## 4. 本轮：友链改后台维护（2026-10-16）

**为什么改。** 友链原先是 `src/lib/friends.ts` 里的编译期常量——加一个人要改代码、重新构建。
它本来就是会变的数据，不该住在源码里。

**改法。** 入库 + 后台 CRUD，复用文章那套后台外壳：

| 层 | 落点 |
|---|---|
| 表 | `friends`（name / href / description / tags / created_at / updated_at） |
| 公开读 | `GET /api/friends`；前台 `/friends` 改 `force-dynamic` 动态取数 |
| 后台写 | `GET/POST /api/admin/friends`、`PUT/DELETE /api/admin/friends/{id}`，界面 `/admin/friends` |
| 种子 | `content/friends.json`，**只在 `friends` 表为空时灌** |

**两个刻意的选择。**

1. **只写库，不写文件。** 文章必须写回 md（否则下次 `init_db` 把后台改动反向覆盖），
   而友链不进 RAG、不进图谱、没有对应文件，自然没有那条坑。
   种子的「表空才灌」是配套保险：后台删掉的条目不会被下一次 `init_db` 复活。
2. **`href` 只放行 `http(s)://`。** 它最终渲染成 `<a href>`，放行 `javascript:` 等于开一个注入口子。
   重复链接返回 409，不为此加数据库唯一约束。

**验收**：连跑两次 `init_db`，第二次友链新增 0 条（种子不复活）；
`POST` / `PUT` / `DELETE /api/admin/friends` 全程可用，`/friends` 与后台列表同步刷新；
生产构建通过，`/admin/friends` 静态预渲染、`/friends` 转为动态。

---

## 5. 本轮：收藏摘抄改笔记体例 + callout 渲染（2026-10-16）

**为什么改。** 收藏稿原先套的是「是什么 / 核心观点 / 对我的启发」三段式——那是报告体，
与手写笔记的骨架（`>` 导语 → `## 一、` 分节 → `- **关键词**：说明` → 收尾 callout）不是一路，
混在同一个 vault 里一眼能看出哪篇是机器写的。

**处置。**

| 层 | 落点 |
|---|---|
| 摘抄体例 | `scripts/clip.py`：`SUMMARY_PROMPT` 重写为笔记体；`one_liner()` 改为「只认首行 `>` 当导语，否则退回标题」；笔记正文去掉 `## 三段式总结` 外壳 |
| callout 渲染 | `src/lib/markdown.ts` 新增 `remarkCallout`：mdast 阶段把 `> [!type] 标题` 换成 `div.callout.callout-<type>` + `.callout-title`；**颜色与图标全走 CSS 变量**，19 个类型，不引图标库 |
| 样式 | `src/app/globals.css`：`.callout-*` 的 `--callout-rgb` / `--callout-glyph`，标题色 `color-mix(类型色 62%, 正文色)`——浅色不发飘、深色不刺眼 |
| 问答口径 | `agent_chat.py` 两处 system prompt：出自收藏的片段以「原文存档」为准 |

**验收**：离线 11/11（把 `markdown.ts` 单文件编成 CJS 直调 `renderMarkdown`，覆盖无标题 / 行内加粗
标题 / 未知类型 / 嵌套 / 列表内 / 折叠标记，以及「普通引用块不受影响」）；浏览器 15/15（真实页面
无 `[!tip]` 残留，19 个类型的图标与底色都在，双主题按亮度验可读性）。两篇收藏已用真实 LLM 重跑。

**踩到的两个坑**（都不报错，只出错）：① callout 正则结尾**不能写 `$`**——mdast 里软换行是 text 节点
value 里实打实的 `\n`，`(.*)$` 整体匹配失败且静默；② **先清理段落、再判断是否删段落**，顺序写反会
因为 `length === 0` 成立而顺手删掉下一个子节点，正文整段被吞。

---

## 6. 本轮：清死重（2026-10-17）

体检出来的六项死重一次清完，全是「删了不影响任何功能」的东西：

| # | 项 | 处置 |
|---|---|---|
| 1 | `settings` 表 | 全仓零读写，只有 `models.py` 一个空壳类 → DDL、ORM、物理表全删 |
| 2 | `wiki_entries` / `wiki_sources` | 旧「Wiki 自动沉淀」遗留，零引用 → 同上；「自动沉淀」改用落地导览 + 摘要兜底 |
| 3 | `Pet.tsx`（307 行）+ `public/pets/*.webp` 6 张 | 上一版桌宠，零引用，回退窗口已过 → 删；`public/pets/mingyue/` 22 帧保留 |
| 4 | `NVIDIA Corporation/umdlogs/` | 显卡驱动留的空目录（0 文件、未跟踪） → 删 |
| 5 | `_town_backup_2026-10-14.zip`（22.9MB） | 小镇备份，已在 `.gitignore` 但占工作区 → 挪到仓库外 `D:\porm\workbuddy\archives\` |
| 6 | 无 `.gitattributes` | 本机 `core.autocrlf=true`，每次 `git add` 都刷 CRLF 警告 → 加 `* text=auto eol=lf` |

**旧库的物理表怎么删的。** `schema.sql` 只管「建」，删表得自己来：`database.py` 新增
`_drop_legacy_tables()`，在 `init_schema()` 里按「先子表、后父表」`DROP TABLE IF EXISTS` 三张表，
幂等可反复跑。DDL 的唯一出处仍是 `schema.sql`（现在是 14 张表），迁移只负责把旧库对齐到它。

**验收**：重跑 `init_db` 一遍，表数 17 → 14、三张表消失，同时 `citations` 仍是 282 条
（247 条带出处）—— 与本轮无关的数据一条没动；`next build` 通过，`public/pets` 只剩 `mingyue/`。

**顺带修的一处**：`models.py` 的模块 docstring 还写着「与 `src/lib/schema.sql` 逐表对应」，
那个路径在数据层搬到 Python 之后就不存在了，一并改成 `server/app/schema.sql`。

---

## 7. 本轮：落地导览（2026-10-17）

**问题。** 首页原本只有「最新文章轮播 + 说说照片 + 状态卡」：能看出「有什么新东西」，
看不出「这里在讲什么、我该从哪读」——「AI 快速定位访客想了解什么」的反面一直空着。

**做法。** 两块，都不新增检索能力：

| 位置 | 改动 |
|---|---|
| `src/components/TopicGuide.tsx`（新） | 首页「主题导览」区块：左边是把《知识地图总览》提上来的 START HERE 主入口卡，右边按分类各一张主题卡，卡里直接铺该主题的文章标题（最多 4 条 + 「还有 N 篇」），底部「进入主题 →」跳归档 |
| `src/app/page.tsx` | 接上 `listCategories()`（此前已导出但零调用），在轮播与状态卡之间插入导览区 |
| `src/components/TimelineControls.tsx` | 新增主题筛选条，与标签条并列；两条都补了小标（「主题」/「标签」） |
| `src/app/timeline/page.tsx` | 把分类传进筛选区；`?category=` 生效时页头说明当前主题并给回首页导览的出口 |
| `src/lib/categoryLabel.ts`（新） | 分类显示名：`clippings` → 「收藏摘抄」。**只影响显示**，URL 与库里的值一律不动 |

三个判断：

1. **「知识地图」这一类要挑出来单独做主入口。** 它是索引本身，不是一个内容主题；
   混在网格里就变成「一篇讲目录的文章」，跟旁边那张 Java 卡不是一个层级。
2. **主题卡里直接铺文章标题**，不只给一个「3 篇」的数字——这样首页到任一篇笔记是**一步**，
   而不是「首页 → 归档 → 文章」两步。验收条款就是照这个写的。
3. **英文分类名只在界面上换中文**，URL 保持原值：`?category=clippings` 依然有效，
   库里与接口里也全是原值，只多了一层显示映射。

**验收**：`next build` 通过（18 条路由全产出）；浏览器 28/28 —— 导览区块与 TOPIC GUIDE 小标在、
主入口卡指向 `/posts/知识地图总览`、主题卡 4 张且 `clippings` 显示为「收藏摘抄」、
点主题卡里的标题一步落到文章页且标题一致、点索引卡一步进索引页、
归档页主题条筛出 Java 3 篇、页头说明当前主题、「全部主题」回到 12 篇、
浅色主题下标题色可读（lum 0.09）、控制台零错误。

**一处只有截图才看得出的问题**：主入口卡被 grid 拉伸到与右侧网格等高，内容只占上半、
下半是空白。补了句「三条主线各成体系，进去顺着双链往下读就行」把读法说明白，
顺带收窄留白——纯 DOM 断言对这类问题是全绿的。

---

## 8. 待办（按依赖顺序）

### P1 · 关系网召回补一档 —— 现有只有显式双链

| | |
|---|---|
| **目标** | 能回答「跟这篇有关但没互相链接的文章」 |
| **动作** | 在 `links`（显式 `[[双链]]`）之外增加「共同标签 + 共同被引用」的隐式边，供图谱与「相关文章」用 |
| **改动面** | 后端图谱查询 + `/posts/[slug]` 相关文章区 |
| **验收** | 孤立文章（无双链）也能被推荐出 2–3 篇相邻文章 |
| **前置** | 无（入口已通，见 §7） |

### P2 · 向量混合检索 —— 关键词保精度、向量保召回

| | |
|---|---|
| **目标** | 关键词 + embedding 混合排序 |
| **动作** | 导入时调 embedding API 写入 `chunks.embedding` BLOB；`_score_chunk` 增加余弦项与 IDF 加权融合 |
| **改动面** | `server/scripts/init_db.py` · `server/app/services/agent_chat.py` |
| **验收** | 无 Key 时仍走纯关键词不报错；限定单篇提问的命中率不低于当前 |
| **铁律** | 应用层算余弦，**不引向量库**（pgvector / Docker 一律不碰） |

### P3 · 收藏管道 HTTP 化

| | |
|---|---|
| **目标** | 在浏览器里贴链接就能收藏，不用开终端 |
| **动作** | 补 `POST /api/clippings`（复用 `scripts/clip.py` 的抓取+总结流程），前端加粘贴入口 |
| **改动面** | 后端新增一条路由 + 后台或独立页面加一个表单 |
| **验收** | 贴一个 URL 进去，文章出现在 vault 里且立刻可被助手引用 |

### P4 · 补齐测试 —— 收益被严重低估

| 优先级 | 对象 | 理由 |
|---|---|---|
| 1 | `_score_chunk` 打分函数 | 纯函数最好测；P2 改它之前必须有网兜住 |
| 2 | 软 404 回归 | `/posts/<不存在>` 必须 404。这个 bug 咬过一次，值得一条 e2e 永久看守 |
| 3 | 双链解析 / 切分（`content.py`） | 改了会静默影响图谱与检索 |
| 4 | 好感度与记忆（`agent_chat.py`） | `score` 只增不减、`stage` 派生逻辑易错 |

**验收**：`pytest` 全绿；e2e 可用 `playwright-core` + `channel: 'msedge'`（系统 Edge，不下载 Chromium）。

---

## 9. 技术债

| # | 项 | 现状 | 处置建议 |
|---|---|---|---|
| 1 | 零测试 | 见 P4 | — |
| 2 | 内容量小 | 12 篇 / 132 块，检索演示效果有限 | 用 `VAULT_DIR=/path python -m scripts.init_db` 导真实 Vault（导完顺手做第 7 条） |
| 3 | `content/town/agents.json` | 路径带 `town`，但里面住的是博客助手 | 功能无碍，改名会牵动后端与 README，暂不动 |
| 4 | 站点品牌仍叫「赛博小镇」 | 功能已无小镇 | 保留是刻意决策，想改名说一声 |
| 5 | 仓库是 public | 笔记与站点文案对外可见 | 想转私有：`gh repo edit --visibility private --accept-visibility-change-consequences` |
| 6 | 本机构建/预览坑 | 必须用全路径 node，`npx` 不可用；`next build` 要加 `CODEBUDDY_SAFE_DELETE_ENABLED=0` | 已记入项目记忆，照做即可 |
| 7 | 摘要兜底（原 P1「自动摘要」） | **工具未建**：全仓没有 summary 生成入口，`clip.py` 的摘抄只服务「新收藏的文章」。现有 12 篇的 summary **全是手写的、库里为空 0 条**，故降级——原验收标准「12 篇 summary 全非空」已被现状满足 | 只在新增笔记 / 导真实 Vault 时才需要。届时就着 `init_db` 加一个 `--fill-summary`：扫 `summary` 为空的 post，复用 `clip.py` 的摘抄提示词（§5 的笔记体）生成首行导语写回 frontmatter，再重建索引；不新建模块、不新建表 |

---

## 10. 验收基线

```bash
# 后端（另开终端）
cd server && python -m scripts.init_db && python -m uvicorn app.main:app --reload --port 8000

# 前端
npm install && npm run dev

# 生产构建（本机必须带前缀、别用 npx）
CODEBUDDY_SAFE_DELETE_ENABLED=0 \
  "C:/Users/guo/.workbuddy/binaries/node/versions/22.22.2-2/node.exe" node_modules/next/dist/bin/next build
```

逐项核对：

- [ ] `/` `/timeline` `/projects` `/moments` `/friends` `/about` 全部 200
- [ ] `/posts/<真实slug>` 200；`/posts/no-such-post` **404**（防软 404 回归）
- [ ] 收藏稿里的 `> [!tip] 一句话总结` 渲染成 callout 卡片，页面无 `[!tip]` 字面残留；暗/亮主题标题都看得清
- [ ] `/api/posts` `/api/tags` `/api/categories` `/api/graph` `/api/moments` `/api/friends` 全部 200；`/api/chatter` **404**
- [ ] 后台 `/admin/friends` 能增删改，改完 `/friends` 立刻同步（友链只写库，不需要重建索引）
- [ ] `/api/ask` 返回 `citations`，每条带 `postSlug` / `postTitle` / `heading`
- [ ] `/sitemap.xml` 含 `friends`、不含 `chatter`
- [ ] **重跑一次 `python -m scripts.init_db`，`citations.post_slug` 非空条数不变**（引用不再随导入断链）
- [ ] 首页「主题导览」在：START HERE 卡指向 `/posts/知识地图总览`；主题卡里的文章标题**一步**可到文章页
- [ ] `/timeline?category=Java` 只出 Java 的 3 篇，页头写明当前主题；`/timeline` 主题条「全部主题」回到 12 篇
- [ ] 浏览器实测：导航六项、桌宠在、点桌宠能唤出助手面板、控制台 0 错误
- [ ] 推送后用 `git ls-remote origin refs/heads/main` 比对本地 HEAD（不信退出码）
