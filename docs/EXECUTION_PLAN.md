# 执行文档 · AI 个人博客

> 更新于 2026-10-16，数据来自对仓库与数据库的逐项实测（非凭记忆）。
> 状态标记：✅ 已完成 · 🟡 部分完成 / 有条件可用 · ❌ 未开始 · 🗑 已下线
>
> **本文只讲三件事：做到哪了、接下来做什么、欠了什么。**
> 架构、目录结构、启动方式、设计取舍一律以根目录 `README.md` 为唯一出处，本文不复述——
> 同一件事写两份，必然有一份先烂，这正是本文上一版出问题的原因。
> 同目录 `BLOG_REPLICA_PLAN.md` 是「内容站 1:1 复刻」阶段的定档留档，已停更，不作行动依据。

---

## 0. 一句话现状

主干全部交付且可复现：Next.js 阅读端 + FastAPI 数据层 + RAG 问答 + Agent 内核 + 后台写作，
零外部服务依赖、无 Key 也能全流程演示。小镇端已下线。剩下的是增强项与债务清理：
自动摘要与落地导览（重定义后的 5b）、向量检索、收藏管道 HTTP 化、测试。

---

## 1. 快照（2026-10-16 实测）

| 项 | 值 |
|---|---|
| 提交 | `cab4eb3` refactor(pet): 宠物只做陪伴，撤掉问答入口 |
| 远程 | https://github.com/25417926/ai-knowledge-blog（public，分支 `main`） |
| 前端 | `src/` 45 个源文件 / 6156 行（Next.js 15 App Router · React 19 · TS · Tailwind 3.4） |
| 后端 | `server/` 18 个 `.py` / 4143 行（FastAPI · SQLAlchemy · aiosqlite） |
| 数据库 | `data/blog.db`，`server/app/schema.sql` 定义 **17 张表** |
| 内容 | 12 篇笔记 · 131 切分块 · 36 条双链 · 24 个标签 · 8 条说说 · 3 条友链 · 2 篇收藏 · 3 个角色 |
| 问答存量 | 170 轮对话（其中 85 轮提问）· 282 条引用（247 条带出处）· 3 个会话 |
| 测试 | **0 个**（无 `*.test.*` / `*.spec.*`） |

---

## 2. 功能进度

### 2.1 已交付 ✅

| 模块 | 一句话 |
|---|---|
| 工程与构建 | 脚手架、Vault 导入脚本、`.env.example` 全量配置项；零原生依赖 |
| 阅读端 | `/` 卡片墙 · `/timeline` 双视图归档 · `/posts/[slug]` · `/projects` · `/moments` · `/friends` · `/about` |
| Markdown 管线 | remark/rehype + Shiki 双主题零重渲染、目录、行号、复制、灯箱 |
| 主题与氛围 | 暗/亮双主题、氛围背景、开屏、弹幕、PixiJS 桌宠「溟月」 |
| 内容数据层 | `posts` / `chunks` / `links` / `post_tags`，内容只存一份，三种用途复用 |
| RAG 检索 | 中文二元组 + IDF；标题 3.0 / 小节 1.6 / 正文 1.0；`RAG_MIN_SCORE=1.0` 兜底 |
| Agent 内核 | `agents` / `agent_memories` / `agent_relations` / `agent_sessions` / `agent_turns` / `citations` |
| 博客助手「知行」 | 浮动面板、引用卡片、思考链；`/api/ask` 整包 + `/api/ask/stream` SSE |
| 真实模型 | DeepSeek（OpenAI 兼容）+ Function Calling 工具循环（≤3 轮）；无 Key 自动回落 Mock |
| 后台 | `/admin` 口令登录、文章 CRUD、友链 CRUD、保存写回 md 并重建索引、对话日志面板 |
| SEO | `robots` / `sitemap` / `rss` 动态生成；软 404 已修（根级 `loading.tsx` 已移除） |
| 引用锚点 | `chunk_id` → `post_slug + heading_path + quote`（2026-10-16，见 §3） |

### 2.2 已下线 🗑

- **Godot 2D 小镇端**（2026-10-14）：代码与素材备份在项目根 `_town_backup_2026-10-14.zip`。
- **杂谈**（2026-10-16）：前后端 15 个牵连点（表 / 路由 / 页面 / 组件 / `moods.ts` / 导航 /
  sitemap / rss / 首页轮播 / 统计口径）全链路移除，6 篇原文与 `chatter` 表一并删除。
  桌宠单击让位给「唤出助手」，双击摸头仍说原来的闲话（`site.pet.lines`），
  单击话术改由新增的 `site.pet.askLines` 提供。

### 2.3 未开工 ❌

- **向量混合检索**：`chunks.embedding` 字段与 `EMBEDDING_*` 配置项已预留，零代码写它。
- **收藏管道 HTTP 化**：缺 `POST /api/clippings` 与前端「粘贴链接」入口，目前只能跑 CLI。
- **纯图文章**：正文全在截图里的收藏稿，当前不进检索、命中即抛错提示去看原文 PDF。
- **测试**：见 §6。

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

## 5. 待办（按依赖顺序）

### P1 · 自动摘要 —— 「会自动总结」的正解

| | |
|---|---|
| **目标** | 未标注 summary 的笔记自动生成摘要，写回 frontmatter |
| **动作** | 复用 `scripts/clip.py` 已有的三段式提示词（是什么 / 核心观点 / 对我的启发）对空 summary 的 post 批量生成，写回 md 再跑 `import_vault` 重建 |
| **改动面** | 复用收藏管道，不新建模块、不新建表 |
| **验收** | 12 篇笔记 summary 全非空；`/` 卡片墙与 `/timeline` 的摘要不再空缺 |
| **注意** | 这是「阶段 5b」重定义后的形态——**不是**新建 `wiki_entries` 那一层 |

### P2 · 落地导览 —— 访客进门知道从哪读

| | |
|---|---|
| **目标** | 把「AI 快速定位访客想了解什么」的反面补齐：进站不再只有卡片墙 |
| **动作** | 把库里那篇《知识地图总览》提升为主题的入口页；`src/lib/api.ts` 已导出但零调用的 `listCategories()` 接上，做分类导航 |
| **改动面** | 首页 + 归档页；不新增检索功能 |
| **验收** | 从首页两步内能到达任一篇笔记，且能看出这篇文章属于哪个主题 |
| **前置** | 无 |

### P3 · 关系网召回补一档 —— 现有只有显式双链

| | |
|---|---|
| **目标** | 能回答「跟这篇有关但没互相链接的文章」 |
| **动作** | 在 `links`（显式 `[[双链]]`）之外增加「共同标签 + 共同被引用」的隐式边，供图谱与「相关文章」用 |
| **改动面** | 后端图谱查询 + `/posts/[slug]` 相关文章区 |
| **验收** | 孤立文章（无双链）也能被推荐出 2–3 篇相邻文章 |
| **前置** | 建议 P2 之后（入口先通，再谈召回） |

### P4 · 向量混合检索 —— 关键词保精度、向量保召回

| | |
|---|---|
| **目标** | 关键词 + embedding 混合排序 |
| **动作** | 导入时调 embedding API 写入 `chunks.embedding` BLOB；`_score_chunk` 增加余弦项与 IDF 加权融合 |
| **改动面** | `server/scripts/init_db.py` · `server/app/services/agent_chat.py` |
| **验收** | 无 Key 时仍走纯关键词不报错；限定单篇提问的命中率不低于当前 |
| **铁律** | 应用层算余弦，**不引向量库**（pgvector / Docker 一律不碰） |

### P5 · 收藏管道 HTTP 化

| | |
|---|---|
| **目标** | 在浏览器里贴链接就能收藏，不用开终端 |
| **动作** | 补 `POST /api/clippings`（复用 `scripts/clip.py` 的抓取+总结流程），前端加粘贴入口 |
| **改动面** | 后端新增一条路由 + 后台或独立页面加一个表单 |
| **验收** | 贴一个 URL 进去，文章出现在 vault 里且立刻可被助手引用 |

### P6 · 补齐测试 —— 收益被严重低估

| 优先级 | 对象 | 理由 |
|---|---|---|
| 1 | `_score_chunk` 打分函数 | 纯函数最好测；P4 改它之前必须有网兜住 |
| 2 | 软 404 回归 | `/posts/<不存在>` 必须 404。这个 bug 咬过一次，值得一条 e2e 永久看守 |
| 3 | 双链解析 / 切分（`content.py`） | 改了会静默影响图谱与检索 |
| 4 | 好感度与记忆（`agent_chat.py`） | `score` 只增不减、`stage` 派生逻辑易错 |

**验收**：`pytest` 全绿；e2e 可用 `playwright-core` + `channel: 'msedge'`（系统 Edge，不下载 Chromium）。

---

## 6. 技术债

| # | 项 | 现状 | 处置建议 |
|---|---|---|---|
| 1 | `settings` 表 | 全仓零引用，只有 `models.py` 一个空壳类 | 删（本次未动，等你点头） |
| 2 | `wiki_entries` / `wiki_sources` | 零引用；且 `wiki_sources.chunk_id` 会跟着重导一起断（本轮刚拆掉同款锚） | 删表；「自动沉淀」改用 P1 + P2 的形态 |
| 3 | `Pet.tsx` | 307 行，零引用（上一版桌宠，回退窗口已过） | 删，连 `public/pets/*.webp` 6 张旧素材 |
| 4 | `NVIDIA Corporation/umdlogs/` | 显卡驱动留下的空目录，非项目内容 | 删 |
| 5 | `_town_backup_2026-10-14.zip` | 小镇备份，已被 `.gitignore` 排除但仍占工作区 | 挪到仓库外的备份处 |
| 6 | 无 `.gitattributes` | Windows 上提交刷 `LF→CRLF` 警告 | 加一个统一 LF，或接受现状 |
| 7 | 零测试 | 见 P6 | — |
| 8 | 内容量小 | 12 篇 / 131 块，检索演示效果有限 | 用 `VAULT_DIR=/path python -m scripts.init_db` 导真实 Vault |
| 9 | `content/town/agents.json` | 路径带 `town`，但里面住的是博客助手 | 功能无碍，改名会牵动后端与 README，暂不动 |
| 10 | 站点品牌仍叫「赛博小镇」 | 功能已无小镇 | 保留是刻意决策，想改名说一声 |
| 11 | 仓库是 public | 笔记与站点文案对外可见 | 想转私有：`gh repo edit --visibility private --accept-visibility-change-consequences` |
| 12 | 本机构建/预览坑 | 必须用全路径 node，`npx` 不可用；`next build` 要加 `CODEBUDDY_SAFE_DELETE_ENABLED=0` | 已记入项目记忆，照做即可 |

---

## 7. 验收基线

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
- [ ] `/api/posts` `/api/tags` `/api/categories` `/api/graph` `/api/moments` `/api/friends` 全部 200；`/api/chatter` **404**
- [ ] 后台 `/admin/friends` 能增删改，改完 `/friends` 立刻同步（友链只写库，不需要重建索引）
- [ ] `/api/ask` 返回 `citations`，每条带 `postSlug` / `postTitle` / `heading`
- [ ] `/sitemap.xml` 含 `friends`、不含 `chatter`
- [ ] **重跑一次 `python -m scripts.init_db`，`citations.post_slug` 非空条数不变**（引用不再随导入断链）
- [ ] 浏览器实测：导航六项、桌宠在、点桌宠能唤出助手面板、控制台 0 错误
- [ ] 推送后用 `git ls-remote origin refs/heads/main` 比对本地 HEAD（不信退出码）
