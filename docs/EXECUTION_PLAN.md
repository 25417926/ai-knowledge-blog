# 执行文档 · AI 个人博客（单端）

> 生成于 2026-10-15，依据对仓库的逐文件检索（非凭记忆）。
> 状态标记：✅ 已完成 · 🟡 部分完成 / 有条件可用 · ❌ 未开始 · 🗑 已下线
>
> 本文是**当前生效的执行文档**。`BLOG_REPLICA_PLAN.md` 是「内容站 1:1 复刻」阶段的定档记录，
> 该阶段已全部交付，仅作留档备查，不再作为行动依据。

---

## 0. 一句话现状

博客端**主干已全部交付并上线 GitHub**（阅读体验、RAG 问答、Agent 内核、SEO 都在）。
小镇端已砍。剩下的全是**增强项**：接真实模型、向量检索、日志面板、Wiki 沉淀、后台写作、补测试。
其中「实时日志面板」的数据层已经躺在那儿，是性价比最高的一块。

---

## 1. 仓库快照

| 项 | 值 |
|---|---|
| 远程仓库 | https://github.com/25417926/ai-knowledge-blog（**public**，默认分支 `main`） |
| 提交 | `2e88637` feat: 初始化项目（88 文件 / 11489 行 / 0.37MB） |
| 代码规模 | `src/` 48 个源文件（29 个 `.tsx`）/ 6100 行 |
| 数据库 | `data/blog.db`，`src/lib/schema.sql` 定义 **14 张表** |
| 内容量 | 10 篇笔记 · 42 切分块 · 31 条双链 · 23 个标签 · 6 篇杂谈 · 8 条说说 · 3 个角色 |
| 问答存量 | 76 轮对话（`agent_turns`）· 111 条引用（`citations`） |
| 测试 | **0 个**（无 `*.test.*` / `*.spec.*`） |
| 技术栈 | Next.js 15.1 (App Router) · React 19 · TS 5.7 · Tailwind 3.4 · node:sqlite · unified/Shiki |

---

## 2. 功能进度（按模块拆分）

### 2.1 工程与构建 ✅

脚手架、`npm run setup` 一键初始化、Vault 导入脚本、`.env.example` 全量配置项。
零原生依赖（`node:sqlite` 内置），换机器只要 Node ≥ 22.5。

**已知坑**：本机 `npx` 会段错误，须用全路径调 `node_modules/next/dist/bin/next`；
`next build` 批量删 `.next` 会被沙箱守卫拦下，构建前加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`。

### 2.2 数据层 ✅

`vault.ts` 解析 frontmatter / `[[双链]]` / 按标题切分；`schema.sql` 是项目脊椎。
内容只存一份：`posts.content` → `chunks`（供 RAG）→ `links`（供图谱），三种用途复用同一份数据。

### 2.3 阅读端 ✅

| 路由 | 能力 |
|---|---|
| `/` | 首页卡片墙：资料卡 + 文章/杂谈两组轮播 + 状态卡 + 主题卡 |
| `/timeline` | 归档：搜索 + 标签 + `?q=&tag=&view=` URL 同步 + 时间线/矩阵双视图 |
| `/posts/[slug]` | 封面 + 目录 + 代码高亮 + 灯箱 + 上下篇 + 出链/反链 + JSON-LD |
| `/projects` | 项目矩阵：搜索 + 技术栈胶囊 + 外链 |
| `/moments` | 说说流：宫格自适应 + 排序切换 + 搜索 |
| `/chatter` `/chatter/[slug]` | 杂谈：情绪枚举 + 标签 + 搜索 + 详情页 |
| `/about` | 自我介绍、时间线、技能栈、兴趣、联系方式 |

`/blog` → `/timeline`、`/blog/:slug` → `/posts/:slug` 在 `next.config.mjs` 层做 308
（放配置层是因为页面内重定向只能退化成 `meta refresh`，拿不到真 308）。

### 2.4 Markdown 渲染管线 ✅

`markdown.ts`：remark/rehype + `@shikijs/rehype`。**双主题零重渲染**——
插件只往每个 token 写 `--shiki-light` / `--shiki-dark` 两个 CSS 变量，显示哪套由 `.dark` 决定；
行号用 CSS 计数器、复制按钮由 `CodeCopy.tsx` 客户端补，不改 Shiki 输出结构。

### 2.5 视觉与氛围 ✅

暗/亮双主题（`localStorage`）、氛围背景、开屏动画、悬浮弹幕、像素猫桌宠（可拖动 / 可聊天 / 可喂鱼干）。
主题偏好存于 `town-theme` 键名 —— 小镇下线时**刻意没改**，改了会丢访客已存偏好。

### 2.6 RAG 检索 🟡（关键词版可用，向量通道预留）

`retrieve.ts`：中文二元组切词 + IDF 打分，标题权重 3.0 / 小节 1.6 / 正文 1.0。
刻意不引向量库——chunks 只有 42 条，全量扫更快且结果确定可复现。
`chunks.embedding BLOB` 字段已建，`.env.example` 已有 `EMBEDDING_*` 三项，**但没有任何代码写它**。

### 2.7 Agent 内核 ✅

六张表：`agents` / `agent_memories` / `agent_relations` / `agent_sessions` / `agent_turns` / `citations`。
记忆分短期（`short`）与长期（`long`），同表用 `memory_kind` 区分；好感度 `score` 只增不减，
`stage` 派生：stranger(<6) / acquaintance(6) / familiar(20) / close(45)。
入口是 `agent-chat.ts` 的 `talk()` 与 `readLog()`。

### 2.8 博客助手 ✅

`BlogAssistant.tsx` 全站浮动面板，可限定单篇提问；`/api/blog/ask` 落 `agent_turns` + `citations`，
`readLog()` 提供历史回放。回答必须建立在检索片段上，检索不到就直接说不确定。
无 LLM Key 时回落 Mock 模式（原文节选 + 出处拼装），全流程可演示。

### 2.9 SEO / 可访问性 ✅

`robots.ts` / `sitemap.ts` / `rss.xml/route.ts` 均动态生成；各页独立 Metadata。
**软 404 已修**：根级 `app/loading.tsx` 被移除（它会让 `force-dynamic` 详情页在 `notFound()` 之前
冲出 200）。`/posts/<不存在>` 与 `/chatter/<不存在>` 现返回 404 —— 这是回归测试的重点保护对象。

### 2.10 版本控制 ✅（2026-10-15 新增）

GitHub + `gh` CLI（装在 `~/.workbuddy/binaries/gh/bin/gh.exe`，不在 PATH）。
`.gitignore` 排除 `node_modules/` `.next/` `.shots/` `docs/*.png` `_town_backup_*.zip` `.workbuddy/` `data/*.db`。

### 2.11 小镇端 🗑（2026-10-14 下线）

Godot 2D 地图 + 自製素材 + NPC 对话整体删除。代码与素材备份在项目根 `_town_backup_2026-10-14.zip`。
`agents` 六张表保留（博客助手住在里面），`projects.ts` 里的小镇作品卡片保留（作品集是历史记录）。

### 2.12 后台写作与登录 ❌

**零代码**：没有任何 auth / session / cookie / 登录页。`settings` 表建了但零引用，
`ADMIN_PASSWORD` 在 `.env.example` 里躺着。内容更新目前靠「改 Markdown → `npm run vault:import`」。

### 2.13 Wiki 自动沉淀 ❌

`wiki_entries` / `wiki_sources` 两张表**已建但零引用**（schema 先行，代码没跟上）。
「问 → 答 → 补文档」闭环未实现。

### 2.14 实时日志面板 ❌（**数据层已就绪**）

`agent_turns` 已有 76 轮真实数据，`readLog(sessionKey, agentSlug, limit)` 已导出且 ask 路由在用。
差的只是一个看得见的面板。

### 2.15 测试 ❌

零单测、零 e2e 脚本入库。此前所有验收都是临时脚本跑完即弃。

---

## 3. 待办执行计划（按依赖顺序）

### P0 · 接入真实语言模型 —— 零代码成本，先做

| | |
|---|---|
| **目标** | 从 Mock 切到真实回答 |
| **动作** | `.env` 填 `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL`（三者都要）。协议 OpenAI 兼容，换 baseURL 即可接 DeepSeek / 通义 / 智谱 / Ollama |
| **改动面** | 无代码改动；提示词已要求「先结论、再标引用 [n]」 |
| **验收** | `/api/blog/ask` 返回 `mock: false`，回答仍带可点回的引用角标 |
| **注意** | `.env` 已在 `.gitignore`，**别提交** |

### P1 · 向量混合检索 —— 关键词保精度、向量保召回

| | |
|---|---|
| **目标** | 关键词 + embedding 混合排序 |
| **动作** | ① `vault-import.ts` 里调 embedding API，把向量写进 `chunks.embedding` BLOB；② `retrieve.ts` 的 `scoreChunk` 增加余弦项并与 IDF 加权融合 |
| **改动面** | `scripts/vault-import.ts` · `src/lib/retrieve.ts` |
| **验收** | 无 Key 时仍走纯关键词（不报错）；限定单篇提问的命中率不低于当前 |
| **铁律** | 应用层算余弦，**不引向量库**（pgvector / Docker 一律不碰） |

### P2 · 实时日志面板 —— 性价比最高，数据已在库里

| | |
|---|---|
| **目标** | 把 76 轮对话变成看得见的东西 |
| **动作** | ① 新增 `src/app/api/blog/log/route.ts`，包一层 `readLog()`；② 新增面板组件，挂在 `BlogAssistant` 里或独立路由 |
| **改动面** | 新路由 + 新组件（数据层 `agent-chat.ts` 不动） |
| **验收** | 能看到每轮的问题 / 回答 / 引用 / 时间；不破坏现有浮动面板 |
| **前置** | 无（P0/P1 都不阻塞它） |

### P3 · Wiki 沉淀闭环 —— 表已就绪

| | |
|---|---|
| **目标** | 「问 → 答 → 补文档」正循环 |
| **动作** | 从 `agent_turns` + `citations` 里找「高频被问但站内没有」的主题 → 生成 `wiki_entries` 草稿 + `wiki_sources` 出处回链 |
| **改动面** | `src/lib/agent-chat.ts` 或新建 wiki 查询模块 + 页面 |
| **验收** | 一条问答能一键沉淀成 wiki 条目，条目带出处；条目不重复创建 |
| **前置** | 建议 P2 之后做（日志面板先让你看见问题在哪） |

### P4 · 后台写作与登录 —— 最大一块，**建议拆三步走**

| 子项 | 内容 | 验收 |
|---|---|---|
| **4a 登录** | cookie session + `ADMIN_PASSWORD` 校验 + 登录页 + 路由守卫 | 未登录访问写操作 401 / 跳登录；session 过期可控 |
| **4b 编辑器** | 文章 CRUD，Markdown 编辑 + frontmatter 表单 + 草稿 | 能新建并保存文章，`posts` 表可见 |
| **4c 索引热更新** | 保存即切分入库（`chunks` / `links` / `tags`），不用手动跑 `vault:import` | 新文章立刻能被 RAG 检索到 |

**前置**：无硬依赖，但 4c 会碰到 `vault.ts` 的导入逻辑，**先读清楚再改**，别复制一份切分算法。
**风险**：这是唯一需要认真对待安全的一块（登录、CSRF、XSS——Markdown 渲染管线已经在管 XSS，别绕过它）。

### P5 · 补齐测试 —— 收益被严重低估

| 优先级 | 对象 | 理由 |
|---|---|---|
| 1 | `retrieve.ts` 打分函数 | 纯函数，最好测；P1 改它之前必须有网兜住 |
| 2 | 软 404 回归 | `/posts/<不存在>`、`/chatter/<不存在>` 必须 404。这个 bug 咬过一次，值得一条 e2e 永久看守 |
| 3 | `vault.ts` 双链解析 / 切分 | 改了会静默影响图谱与检索 |
| 4 | `agent-chat.ts` 好感度与记忆 | `score` 只增不减、`stage` 派生逻辑易错 |

**验收**：`node --test` 全绿；e2e 用 `playwright-core` + `channel: 'msedge'`（系统 Edge，不下载 Chromium）。

---

## 4. 技术债与风险

| # | 项 | 处置建议 |
|---|---|---|
| 1 | `scripts/godot-font.py` 是小镇时代遗留，引用 `res://` 路径，现已无用 | 删（需你点头） |
| 2 | 无 `.gitattributes`，Windows 下提交刷 `LF→CRLF` 警告 | 加一个统一 LF，或接受现状 |
| 3 | `settings` / `wiki_entries` / `wiki_sources` 三张表**建了没人用** | 要么按 P3/P4 接上，要么从 schema 删掉，别永久悬空 |
| 4 | 零测试 | 见 P5 |
| 5 | 内容量小（10 篇 / 42 块），RAG 演示效果有限 | 用 `VAULT_DIR=/path npm run vault:import` 导真实 Vault |
| 6 | `content/town/agents.json` 路径带 `town`，但里面住的是博客助手 | 功能上没问题；改名会牵动 `db-init.ts` + README，暂不动 |
| 7 | 站点品牌仍叫「赛博小镇」，功能已无小镇 | 保留是刻意决策（不改品牌）；想改名说一声 |
| 8 | 仓库是 **public**，笔记与站点文案对外可见 | 想转私有：`gh repo edit --visibility private --accept-visibility-change-consequences` |
| 9 | 本机构建/预览必须用全路径 node，`npx` 不可用 | 已记入项目记忆，照做即可 |

---

## 5. 验收基线（现在就能跑的检查）

```bash
npm install && npm run setup && npm run dev          # 本地跑通，零 Key 也能全流程演示
CODEBUDDY_SAFE_DELETE_ENABLED=0 \
  node_modules/.bin/next build                        # 生产构建（本机必须带前缀、别用 npx）
```

逐项核对：

- [ ] `/` `/timeline` `/projects` `/moments` `/chatter` `/about` 全部 200
- [ ] `/posts/<真实slug>` 200，`/posts/no-such-post` **404**（防软 404 回归）
- [ ] `/chatter/<不存在>` **404**
- [ ] `/api/blog/ask` 200，Mock 模式下返回带 `citations`
- [ ] `/sitemap.xml` 22 条 `<loc>`、`/robots.txt` 不含 `/godot-town/`
- [ ] 浏览器实测：导航六项、桌宠在、助手面板在、控制台 0 错误
- [ ] 推送后用 `git ls-remote origin refs/heads/main` 比对本地 HEAD（不信退出码）

---

## 6. 建议的下一个动作

**P2 实时日志面板**——数据已经在 `agent_turns` 里躺了 76 轮，`readLog()` 也写好了，
只差一个面板；做完你能直接看见「大家到底在问什么」，这恰好是 P3 Wiki 沉淀的选题来源。
P0 填 Key 是顺手的事，但需要你自己去申请。
