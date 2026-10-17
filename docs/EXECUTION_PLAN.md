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
零外部服务依赖、无 Key 也能全流程演示。小镇端已下线，访客进门的落地导览、文章之间的
关系网召回也都补上了（见 §7、§8），纯函数层还有 167 条单测兜底（见 §9）。
向量混合检索的**管线**已搭好并实测（见 §10），但默认关闭——本机没有可用的语义向量
服务（DeepSeek 无 `/embeddings`），内置的 hash 方案实测无区分度，不能当默认。
剩下的是增强项与债务清理：收藏管道 HTTP 化、e2e 回归脚本化、关键词打分公式的三处偏差
（摘要兜底已降入 §12 技术债 7）。

---

## 1. 快照（2026-10-17 实测）

| 项 | 值 |
|---|---|
| 提交 | 本地 HEAD 与 `origin/main` 一致（此前提交已全部推送） |
| 远程 | https://github.com/25417926/ai-knowledge-blog（public，分支 `main`） |
| 前端 | `src/` 47 个源文件 / 6343 行（Next.js 15 App Router · React 19 · TS · Tailwind 3.4） |
| 后端 | `server/` 28 个 `.py` / 5929 行（FastAPI · SQLAlchemy · aiosqlite） |
| 数据库 | `data/blog.db`，`server/app/schema.sql` 定义 **14 张表** |
| 内容 | 12 篇笔记 · 126 切分块 · 36 条双链 · 24 个标签 · 8 条说说 · 3 条友链 · 2 篇收藏 · 3 个角色 |
| 问答存量 | 170 轮对话（其中 85 轮提问）· 282 条引用（247 条带出处）· 3 个会话 |
| 测试 | 后端 **167 条**纯函数单测（pytest，2.2s 全绿，见 §9）；前端 e2e 仍是临时脚本、未纳入仓库 |
| 向量档 | `chunks.embedding` BLOB 已能落库（126 个块实测可写入/幂等跳过）；`EMBEDDING_PROVIDER=none` 是默认值，未启用 |

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
| 关系网召回 | 双链之外的相关文章：共同标签 / 同被一轮问答引用 / 内容重合（2026-10-17，见 §8） |
| 向量档（未启用） | 三 provider 可插拔、BLOB 自带 provider/维度/模型指纹、余弦融合已接入检索；默认 `none`（2026-10-17，见 §10） |
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
- **端到端测试**：后端纯函数 167 条已补（§9、§10）；浏览器侧仍是临时脚本，未进仓库。

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

## 8. 本轮：关系网召回（2026-10-17）

**问题。** 文章之间唯一的边是显式 `[[双链]]`。链接密集的文章下方有「出链 / 反向链接」两块，
但**孤立文章那两块全是空的**——读者顺着读不下去，助手能用的证据也只有关键词检索那一档。

**做法。** 在 `links` 之外算出隐式边，落到文章页新增的「相关文章」区块。三档证据：

| 证据 | 权重 | 为什么算 |
|---|---|---|
| 共同标签 | 3.0 / 个 | 作者自己贴的，最经得起解释 |
| 同被一轮问答引用 | 2.0 / 次（摊薄） | 助手回答过一次就说明这两篇被同时用上了，等于现成的共现证据 |
| 内容重合 | ×20 | 标题 + 摘要 + 切分块的 IDF 加权余弦；没有标签、没有共引时唯一的线索 |
| 同分类 | 0.5 | 弱信号，给同类目但没标签的文章留一条路 |

四个判断：

1. **刻意排除已有显式双链的文章**（两个方向都算）。出链/反链另有面板，「相关文章」补的是那两块
   空着的时候；重复列一遍只会让人以为推荐重复了。P1 原话「跟这篇有关**但没互相链接**的文章」正是此意。
2. **内容重合不在原计划里，是实测加上去的。** 只用「共同标签 + 共同被引用」跑：两篇孤立文章里
   《周刊》能召回 6 篇，而《4. More Control Flow Tools》（英文 Python 文档，只有 `收藏` 一个标签、
   从没被问答引用过）**只有 1 篇**——验收要求 2~3 篇，过不了。没有这一档，孤立文章就是功能的盲区。
3. **共引按「该轮被引篇数 - 1」摊薄。** 一轮引 2 篇是强证据；答泛问时一轮引 3 篇（当前库仅 1 例），
   那 3 篇两两之间都要打折，否则一次概览回答就能把它们连成团。`co_citations` 仍记轮次数
   （界面上写「同被 N 轮问答引用」），只有排序用摊薄后的权重。
4. **内容重合算「凑数」档**：仅在看得清理由的不足 3 条时补进来，且永远排在证据之后。
   《4. More Control Flow Tools》因此拿到 3 篇（1 篇真证据 + 2 篇内容相近），而不是把 6 个位置填满噪声。

**分词抽成了公共模块。** `services/keyword.py` 收 `PARTICLES` / `STOPWORDS` / `tokenize` 与
`idf_table` / `overlap`，`agent_chat.retrieve` 改为 import 它——分词是「同一个词在两处必须切得一样」
的东西，留两份实现必然漂移（问答里命中、相关推荐里不命中，不报错只是变差）。
**打分公式没有合并**：检索是「查询 vs 切分块」（标题 3.0 / 小节 1.6 / 正文 1.0 加权），
相关推荐是「文档 vs 文档」（对称），问的不是同一件事。

**图谱这次没动。** 原计划写「供图谱与相关文章用」，但 `/api/graph` 与前端 `getGraph()`
至今零调用（没有图谱页面），往里塞隐式边等于新增一个没人读的字段。隐式边先只走「相关文章」
这一个出口，将来真做图谱页再从这儿取。

**验收**：

| | |
|---|---|
| 接口 | `related-api-verify.js` **41 项全过**：camelCase 契约、召回条数、score 单调不增、与出链/反链零重复、不存在的 slug 返回 `[]` |
| 实测召回 | 孤立《4. More Control Flow Tools》3 篇（首条理由「共同标签 #收藏」）· 孤立《周刊》6 篇（5 条共引）·《RAG 基础》3 篇 · 链接密集的文章不再重复双链面板 |
| 浏览器 | `related-e2e.js` **16/16**：区块在、卡片数与 `data-related-count` 一致、点卡片一步落到对应文章且标题一致、浅色主题标题 lum 0.09、控制台零错误 |
| 构建 | `next build` 通过（18 条路由全产出） |

**一处只有截图才看得出的问题**：浅色主题第一版截图整个版面发白——是开屏弹幕浮层盖着，
不是配色错。截图脚本因此先往 `sessionStorage` 写 `cyber-town:splash=1` 再加载
（`data-splash` 才会是 `seen`），否则目检看到的永远是浮层。

**验收用例依赖一篇测试稿**：孤立文章这条用例用的是
`content/sample-vault/clippings/clip-4-more-control-flow-tools.md`——它正是 README
「清理测试稿」待办里那篇。真删了它，孤立文章就只剩《周刊》，`related-api-verify.js`
里那条用例要相应改（脚本会以 404 直接失败，不会静默放过）。

---

## 9. 本轮：补纯函数测试（2026-10-17）

**为什么是现在。** P2 要动 `_score_chunk`，而 `RAG_MIN_SCORE = 1.0` 是照着现有打分口径标定出来的
（经验值：闲话 0.57、真实提问 1.5~3.8）。没有测试，改一次公式就等于把阈值凭感觉重调一遍，
且坏掉时不会报错，只会「答案开始引错文章」。所以先补网，再动刀。

**补了什么。** `server/tests/` 5 个文件 / **127 条**，1.9 秒跑完，**不连库、不发网络请求、不需要 Key**：

| 文件 | 覆盖 | 为什么它值得测 |
|---|---|---|
| `test_keyword.py` | `tokenize` / `idf_table` / `overlap` | 问答与相关推荐共用一份分词，漂移只会静默变差 |
| `test_retrieval.py` | `_score_chunk` · `split_chunks` | P2 的靶子；切块变了，检索就变了 |
| `test_agent_tools.py` | 阶段/好感度/事实抽取/意图判断/文本裁剪/工具参数归一 | 决定「记不记得住用户说过的话」「问概览会不会去检索」 |
| `test_content_pure.py` | `to_slug` / `_json_str_list` | `to_slug` 是跨语言双份实现，规则一漂移就「链接点了没反应」 |
| `test_clip_note.py` | `one_liner` / `mock_summary` | 摘抄首行导语取错，列表里全是标题复读 |

配套：`server/pytest.ini`（`pythonpath = .`，从 `server/` 跑 `python -m pytest`）、
`server/requirements-dev.txt`（只多一个 pytest，运行依赖不动）。

**用例分两类，这是刻意的。** 一类是契约（标题权重高于正文、未入库的词不得分、幂等、边界闭区间）；
另一类是**现状锁定**（characterisation）——照搬旧实现留下的口径，改了就该红，逼人先看一眼再动：

- `_score_chunk` 的 idf 里「文档总数」用的是 `len(tokens)`，不是切分块总数。所以查询里塞进没命中的词，
  命中词的 idf 反而变大（`log(1+4/1) > log(1+1/1)`），部分抵消分母 `sqrt(len)` 的稀释。
- 命中判定是**子串**，`java` 会命中 `javascript`、`ai` 会命中 `training`。召回宽、精度低。

这两条都已写进 docstring：P2 若改成真实块总数，命中分会整体下移，**`RAG_MIN_SCORE` 必须一起重标**。

**变异检查：证明测试真的会红。** 只跑绿不算数，故意改坏三处再跑——

| 改坏 | 结果 |
|---|---|
| `_score_chunk` 标题权重 3.0 → 2.0 | 红（`test_title_beats_heading_beats_body` 等） |
| `tokenize` 去掉虚词过滤 | 红（`test_particles_cut_the_run`） |
| `split_chunks` 去掉围栏保护 | 红（`test_fenced_code_keeps_hash_lines_in_body`） |

三处改完都按字节还原（文本模式写回会做行尾翻译，本工作区是 CRLF，md5 必须与改动前一致）。

**写测试时撞出来的三个真问题。**

1. **切块 bug（已修）。** 围栏代码块里的 `# 安装依赖` 被当成一级标题：代码块被劈成两半、
   注释行从正文里消失（检索也就搜不到那一行），`heading_path` 变成 `Strategy:  Create a new collection`
   这种注释行。现库实测有 **4 个块围栏不配对**，全在那篇 Python 文档的收藏稿里。
   修法是给 `split_chunks` 加围栏状态机（```` ``` ```` / `~~~` 进出，围栏内不认标题）。
   重建索引后 **132 → 126 块**（少的是被劈开又合回去的），断裂块 **0**，`citations` 仍是 282 条
   ——引用表存的是 `post_slug + heading_path`，不挂 chunk id，所以重建不伤引用。
2. **`overlap`「完全重合 = 1.0」只在 idf 齐平时成立。** 分子是 idf 之和、分母是两个平方和开方之积，
   同一组词在 idf 不均匀时只有 0.6。所以「内容重合」这一档的满分本来就不常见——
   给相关文章调阈值时别拿 1.0 当基准。
3. **`is_overview_ask` 不认「本文主要讲了哪些」**（正则收 `讲了些什么/讲了点什么/讲了什么`）。
   这是 Mock 模式的分流口径，动了等于改 Mock 行为，所以只在测试里标注，不改。

**验收**：`python -m pytest` → **127 passed in 1.9s**；变异 3/3 变红且文件按字节还原；
索引重建后问答冒烟 `POST /api/ask` 返回 200、引用 4 条、heading 正常（`4. More Control Flow Tools > 一、条件与循环基础`）。

---

## 10. 本轮：向量混合检索（2026-10-17）

**目标**：关键词保精度、向量保召回。**结论先说：管线建好了、实测过了，默认关闭。**
原因是这一轮把「能不能真提召回」量了一遍，答案是「现在的向量来源不能」。

### 10.1 做了什么

| 层 | 内容 |
|---|---|
| 向量服务 | 新 `server/app/services/embedding.py`：provider = `none`（默认）/`hash`（本地字面近邻）/`openai`（任何 OpenAI 兼容 `/embeddings`） |
| 存储 | 向量存 `chunks.embedding` BLOB，**应用层算余弦**，不引向量库。每个 BLOB 自带 10 字节信封：magic(3) + provider(1) + 维度(2) + **模型指纹(4)** |
| 检索 | `retrieve()` 命中分 = 关键词分 + `4.0 × max(0, cos − 0.25)`；`score` 仍是排序分，另返回 `kw_score` / `vec_score` 便于排查 |
| 运维 | 新 `scripts/embed_chunks.py`（幂等补向量、`--rebuild`、`--stats`）+ `init_db --embed` |
| 评估 | 新 `scripts/eval_retrieval.py`：16 条固定查询，并排输出关键词 / 混合的位次、hit@4、MRR |
| 测试 | `tests/test_embedding.py` 40 条（信封、余弦、融合、`/embeddings` 响应处理） |

**信封为什么要存模型指纹**：两个不同模型可能同为 1024 维，光看维度会把它们当成同一个
空间，余弦照算不误、结果全错、还不报错。指纹把「换模型」也变成硬约束——对不上就当没有
向量（宁可少召回一次，也别静默算错）。

**融合公式为什么这么配**：`cos = 0.5` 恰好加满 `RAG_MIN_SCORE = 1.0`，低于地板一分不加。
于是**老路径的分数逐位不变**，那套照着「真实提问 1.5~3.8 / 闲话 0.57」标定的阈值一个字没动，
`best_score()` 的闸门、Mock 分支、工具调用全都不用改。

### 10.2 实测：为什么默认关闭

**① 本机没有语义向量可用。** DeepSeek 的 `/embeddings` 三个候选模型名全 404；
本机 Ollama 有 `qwen3:4b` / `gemma3:4b`，但都是对话模型，且拉取新模型要联网（当时超时）。

**② 内置 hash 方案没有区分度。** 它用 `keyword.tokenize` 的特征做带符号哈希，本质是
「没有 IDF、没有长度归一的字面重合」。实测 8 条查询里，正确文章的位次：

| 查询 | 正确块位次 | 该篇最高 cos |
|---|---|---|
| 池子满了之后新来的活儿交给谁 | 55 | 0.048 |
| 一条请求从进门到落地都经过哪些环节 | 87 | −0.025 |
| 两段文字像不像用什么量 | 21 | 0.071 |
| JUC 线程池核心参数（原词） | 1 | 0.659 |

原词能到 0.66，改写只剩 0.05 量级——和无关文本分不开。而且一篇英文 Python 文档经常
在中文提问里排第一（哈希撞桶）。**当默认就是拿噪声冒充召回**，所以 `none` 是默认值，
`hash` 只作「管路能不能跑通」的自检（`--provider hash`）。

**③ 顺带量出的真问题：关键词通道没有块长度归一。** 长文（《周刊》）靠字面面积大通吃，
这是那 5 条改写查询漏掉的直接原因。加上块长度归一后：

| 指标 | 现状 | 加长度归一 |
|---|---|---|
| hit@4（同口径探针） | 10/16 | **11/16** |
| MRR | 0.501 | **0.624** |
| 门槛 1.0 下过闸 / 闲话误放 | 10/16 · 0/13 | 需降到 0.5：10/16 · **1/13** |

排序变好、闸门变差。闸门决定「答不答」，只凭一半证据不能动——**本轮不改打分公式**，
把它连同 tf、idf 的偏差记入 §12 技术债 8，等有语义向量一起重标。

### 10.3 只有动手才知道的两件事

1. **LLM 路径会自己改写查询**。评估里「池子满了之后新来的活儿交给谁」在检索层是 0 命中，
   但同一句话走 `/api/ask` 能返回 4 条正确引用——因为模型把问题改写成「线程池 拒绝策略」
   再调 `search_posts`。所以检索层的缺口在配了模型的路径上被掩盖了，暴露得最彻底的是
   Mock 模式。这也意味着：向量档真正该服务的是「没有模型帮忙改写」的场景。
2. **不用 Milvus**（用户问过）：它只是存/查向量的容器，不产生语义能力；126 个块在应用层
   全量算余弦 <1ms；标准部署要 Docker + etcd + MinIO，与「零外部服务依赖」冲突。
   `milvus-lite` 是唯一不碰 Docker 的路子，但仍要 embedding 供应商，且 Python 3.13 轮子
   不保证有。真到数据过万、配了语义模型那天，换后端只动 `embedding.py` 一个模块。

### 10.4 验收

- `pytest` → **167 passed in 2.2s**；`tests/test_embedding.py` 40 条；变异 **5/5 变红**
  （删指纹校验 / 放宽信封长度 / 调权重 / 去地板 / 不按 index 归位），源码按字节还原
- `GET /api/health` → `{"embedding":{"provider":"none","model":"","dim":0,"ready":false}}`
- 默认路径实测：`POST /api/ask` 200、引用 4 条、分数与改动前一致（关键词通道逐位不变）
- `EMBEDDING_PROVIDER=hash` 起第二个实例：health 报 `hash/256`，检索分数含向量加分
  （原词 4.149→5.786），链路不崩
- 幂等：`embed_chunks` 连跑两次，第二次「待补 0 个」

---

## 11. 待办（按依赖顺序）

### P3 · 收藏管道 HTTP 化

| | |
|---|---|
| **目标** | 在浏览器里贴链接就能收藏，不用开终端 |
| **动作** | 补 `POST /api/clippings`（复用 `scripts/clip.py` 的抓取+总结流程），前端加粘贴入口 |
| **改动面** | 后端新增一条路由 + 后台或独立页面加一个表单 |
| **验收** | 贴一个 URL 进去，文章出现在 vault 里且立刻可被助手引用 |

### P4 · 补齐测试 —— 后端纯函数已完成，剩下浏览器侧

2026-10-17 已完成第 1、3、4 项（`_score_chunk` / 切分与双链 / 好感度与记忆，共 127 条，见 §9），
向量档另有 40 条（§10）；合计 167 条。剩下第 2 项与浏览器侧：

| # | 对象 | 现状 | 理由 |
|---|---|---|---|
| 1 | 软 404 回归 | ✅ 已写入验收基线，但没有脚本看守 | `/posts/<不存在>` 必须 404。这个 bug 咬过一次，值得一条 e2e 永久看守 |
| 2 | e2e 脚本入库 | 脚本散在 `~/.workbuddy/binaries/node/workspace/` | 现有 4 个（文章页 / callout / 导览 / 相关文章）每次验收都要手跑，挪进仓库才能复现 |
| 3 | `related_posts` 与 `retrieve` 的集成测试 | 未做 | 纯函数已锁，但「信号加权后排序是否合理」只能在真库上验；需要一个临时 SQLite 夹具 |

**验收**：`pytest` 全绿（当前 167 passed）；e2e 可用 `playwright-core` + `channel: 'msedge'`（系统 Edge，不下载 Chromium）。

---

## 12. 技术债

| # | 项 | 现状 | 处置建议 |
|---|---|---|---|
| 1 | 测试覆盖不全 | 后端纯函数 **167 条**已绿（§9、§10）；缺口在浏览器侧与集成测试 | 见 P4 剩余三项 |
| 2 | 内容量小 | 12 篇 / 126 块，检索演示效果有限 | 用 `VAULT_DIR=/path python -m scripts.init_db` 导真实 Vault（导完顺手做第 7 条） |
| 3 | `content/town/agents.json` | 路径带 `town`，但里面住的是博客助手 | 功能无碍，改名会牵动后端与 README，暂不动 |
| 4 | 站点品牌仍叫「赛博小镇」 | 功能已无小镇 | 保留是刻意决策，想改名说一声 |
| 5 | 仓库是 public | 笔记与站点文案对外可见 | 想转私有：`gh repo edit --visibility private --accept-visibility-change-consequences` |
| 6 | 本机构建/预览坑 | 必须用全路径 node，`npx` 不可用；`next build` 要加 `CODEBUDDY_SAFE_DELETE_ENABLED=0` | 已记入项目记忆，照做即可 |
| 7 | 摘要兜底（原 P1「自动摘要」） | **工具未建**：全仓没有 summary 生成入口，`clip.py` 的摘抄只服务「新收藏的文章」。现有 12 篇的 summary **全是手写的、库里为空 0 条**，故降级——原验收标准「12 篇 summary 全非空」已被现状满足 | 只在新增笔记 / 导真实 Vault 时才需要。届时就着 `init_db` 加一个 `--fill-summary`：扫 `summary` 为空的 post，复用 `clip.py` 的摘抄提示词（§5 的笔记体）生成首行导语写回 frontmatter，再重建索引；不新建模块、不新建表 |
| 8 | `_score_chunk` 的三处偏差 | ① **无块长度归一** → 长文（《周刊》）靠面积大通吃；② **不看 tf**，出现一次与出现十次同分；③ idf 分母是「查询词数」而不是块总数，塞无用词反而让命中词权重变大 | 三处要一起改（单独的维度会让阈值失效）。改完必须连 `RAG_MIN_SCORE` 一起重标：实测加长度归一后 hit@4 10→11、MRR 0.501→0.624，但闸门要降到 0.5 才保住 10/16 过闸（闲话误放 0→1/13）。建议与 #9 一起做 |
| 9 | 向量档有管线、缺引擎 | `/embeddings` 通路、信封、融合、评估、测试都齐了（§10），但本机没有语义向量供应商，内置 hash 无区分度（正确块排到第 55/87 位），故默认 `EMBEDDING_PROVIDER=none` | 拿到 embedding 端点（OpenAI / 硅基流动 `bge-m3` / 本地 Ollama `/v1`）后：`.env` 填 `EMBEDDING_PROVIDER=openai` + base/model → `python -m scripts.embed_chunks --rebuild` → `python -m scripts.eval_retrieval --provider openai` 看 MRR 是否真涨；涨了再考虑把 `VEC_FLOOR` 按该模型的 cos 量级重标 |

---

## 13. 验收基线

```bash
# 后端（另开终端）
cd server && python -m scripts.init_db && python -m uvicorn app.main:app --reload --port 8000

# 单元测试（纯函数，1~2 秒；只多装 pytest，见 requirements-dev.txt）
cd server && pip install -r requirements-dev.txt && python -m pytest

# 前端
npm install && npm run dev

# 生产构建（本机必须带前缀、别用 npx）
CODEBUDDY_SAFE_DELETE_ENABLED=0 \
  "C:/Users/guo/.workbuddy/binaries/node/versions/22.22.2-2/node.exe" node_modules/next/dist/bin/next build
```

逐项核对：

- [ ] `/` `/timeline` `/projects` `/moments` `/friends` `/about` 全部 200
- [ ] `cd server && python -m pytest` → **167 passed**（改任何检索/切块/好感度逻辑都先跑这条）
- [ ] `/posts/<真实slug>` 200；`/posts/no-such-post` **404**（防软 404 回归）
- [ ] 收藏稿里的 `> [!tip] 一句话总结` 渲染成 callout 卡片，页面无 `[!tip]` 字面残留；暗/亮主题标题都看得清
- [ ] `/api/posts` `/api/tags` `/api/categories` `/api/graph` `/api/moments` `/api/friends` 全部 200；`/api/chatter` **404**
- [ ] 后台 `/admin/friends` 能增删改，改完 `/friends` 立刻同步（友链只写库，不需要重建索引）
- [ ] `/api/ask` 返回 `citations`，每条带 `postSlug` / `postTitle` / `heading`
- [ ] `/sitemap.xml` 含 `friends`、不含 `chatter`
- [ ] **重跑一次 `python -m scripts.init_db`，`citations.post_slug` 非空条数不变**（引用不再随导入断链）
- [ ] 首页「主题导览」在：START HERE 卡指向 `/posts/知识地图总览`；主题卡里的文章标题**一步**可到文章页
- [ ] `/timeline?category=Java` 只出 Java 的 3 篇，页头写明当前主题；`/timeline` 主题条「全部主题」回到 12 篇
- [ ] `/api/posts/{slug}/related` 返回 camelCase 数组：孤立文章≥2 篇、每篇带 `sharedTags`/`coCitations`；与出链/反链零重复；不存在的 slug 返回 `[]`
- [ ] 文章页「相关文章」区块在，卡片理由可读（「共同标签 #x」/「同被 N 轮问答引用」/「主题相近」），点卡片一步落到对应文章
- [ ] `GET /api/health` → `embedding.provider = none`（未配 provider 时不允许 `ready: true`）
- [ ] 问一句中文，`/api/ask` 的 `citations[].score` 与开向量档之前**逐位相同**（没有向量时老路径不许变）
- [ ] 若启用向量档：`python -m scripts.embed_chunks --stats` 报「待补 0 个」，且连跑两次结果一致（幂等）
- [ ] 若启用向量档：`python -m scripts.eval_retrieval --provider <p>` 的「原词」一类不许有回退
- [ ] 浏览器实测：导航六项、桌宠在、点桌宠能唤出助手面板、控制台 0 错误
- [ ] 推送后用 `git ls-remote origin refs/heads/main` 比对本地 HEAD（不信退出码）
