-- AI 个人博客 · 数据层 DDL
-- 设计原则：内容（posts/chunks）是唯一资产；agents 系列对博客助手与小镇 NPC 共用。

PRAGMA foreign_keys = ON;

-- ========== 内容层 ==========

CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,
  title         TEXT    NOT NULL,
  summary       TEXT    NOT NULL DEFAULT '',
  category      TEXT    NOT NULL DEFAULT '',
  content       TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'published',
  source_path   TEXT    NOT NULL DEFAULT '',
  word_count    INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

-- Obsidian [[双链]] 解析结果：同时驱动 2D 脉络图与小镇街区布局
CREATE TABLE IF NOT EXISTS links (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source_post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  target_slug    TEXT    NOT NULL,
  target_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_post_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_post_id);

-- RAG 检索单元，也是 Wiki 溯源的落点
CREATE TABLE IF NOT EXISTS chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  ord          INTEGER NOT NULL DEFAULT 0,
  heading_path TEXT    NOT NULL DEFAULT '',
  body         TEXT    NOT NULL,
  embedding    BLOB
);

CREATE INDEX IF NOT EXISTS idx_chunks_post ON chunks(post_id, ord);

-- ========== Wiki 溯源层 ==========

CREATE TABLE IF NOT EXISTS wiki_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT    NOT NULL UNIQUE,
  title          TEXT    NOT NULL,
  body           TEXT    NOT NULL,
  auto_generated INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_sources (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  wiki_id  INTEGER NOT NULL REFERENCES wiki_entries(id) ON DELETE CASCADE,
  chunk_id INTEGER REFERENCES chunks(id) ON DELETE SET NULL,
  quote    TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_wiki_sources_wiki ON wiki_sources(wiki_id);

-- ========== Agent 内核：博客助手与小镇 NPC 共用 ==========
-- kind: 'assistant' 博客端助手 | 'npc' 小镇角色
-- 图书馆 NPC 就是博客助手，用 meta.blogAssistant = true 标记同一实体

CREATE TABLE IF NOT EXISTS agents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'npc',
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  persona    TEXT NOT NULL DEFAULT '',
  avatar     TEXT NOT NULL DEFAULT '',
  location   TEXT NOT NULL DEFAULT '',
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 短期记忆（对话窗口摘要）与长期记忆（事实沉淀）同表，用 memory_kind 区分
CREATE TABLE IF NOT EXISTS agent_memories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_key        TEXT    NOT NULL DEFAULT 'owner',
  memory_kind     TEXT    NOT NULL DEFAULT 'short',
  content         TEXT    NOT NULL,
  importance      REAL    NOT NULL DEFAULT 0.5,
  source_turn_id  INTEGER,
  embedding       BLOB,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_id, user_key, memory_kind);

-- 好感度：score 累加，stage 由 score 派生（陌生/认识/熟悉/亲近）
CREATE TABLE IF NOT EXISTS agent_relations (
  agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_key   TEXT    NOT NULL DEFAULT 'owner',
  score      INTEGER NOT NULL DEFAULT 0,
  stage      TEXT    NOT NULL DEFAULT 'stranger',
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, user_key)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id             TEXT    PRIMARY KEY,
  agent_id       INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_key       TEXT    NOT NULL DEFAULT 'owner',
  started_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 实时日志：所有对话轮次全量留痕，调试与分析都读这张表
CREATE TABLE IF NOT EXISTS agent_turns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT    NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  agent_id       INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role           TEXT    NOT NULL,
  content        TEXT    NOT NULL,
  affinity_delta INTEGER NOT NULL DEFAULT 0,
  latency_ms     INTEGER NOT NULL DEFAULT 0,
  model          TEXT    NOT NULL DEFAULT '',
  tool_trace     TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON agent_turns(session_id, id);
CREATE INDEX IF NOT EXISTS idx_turns_agent ON agent_turns(agent_id, created_at DESC);

-- 单条结论到原文段落的可追溯引用
-- 锚用业务键（post_slug + heading_path）而非 chunks.id：chunks 是检索用的派生数据，
-- import_vault 每次导入都整体重建，自增主键会漂，锚在它上面的引用会成批断掉。
-- quote 逐字留档原文片段，使引用自包含——文章被改写也仍能显示「哪篇、哪节、原话」。
CREATE TABLE IF NOT EXISTS citations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  turn_id      INTEGER NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
  post_slug    TEXT    NOT NULL DEFAULT '',
  heading_path TEXT    NOT NULL DEFAULT '',
  quote        TEXT    NOT NULL DEFAULT '',
  score        REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_citations_turn ON citations(turn_id);
CREATE INDEX IF NOT EXISTS idx_citations_post ON citations(post_slug);

-- ========== 收藏管道层 ==========
-- 微信/浏览器收藏 → 知识库的收件箱。URL 唯一：重复收藏同一链接只更新不新增。
-- origin: web（trafilatura 抓取）| paste（公众号反爬，浏览器复制全文粘贴）

CREATE TABLE IF NOT EXISTS clippings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL DEFAULT '',
  source_path TEXT    NOT NULL DEFAULT '',
  origin      TEXT    NOT NULL DEFAULT 'web',
  word_count  INTEGER NOT NULL DEFAULT 0,
  pdf         BLOB,                                  -- 收藏时的原文存档（reportlab 生成，按 URL 命中）
  index_text  TEXT    NOT NULL DEFAULT '',           -- 检索用原文纯文本（已去图，只进 chunk，不进笔记）
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clippings_created ON clippings(created_at DESC);

-- ========== 友链层 ==========
-- 互相看得上眼的站点。条目少但会变（换链接、加人），所以入库由后台维护，
-- 而不是像 projects 那样写死在源码常量里；tags 存 JSON 数组。

CREATE TABLE IF NOT EXISTS friends (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  href        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  tags        TEXT    NOT NULL DEFAULT '[]',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ========== 说说层 ==========
-- 短动态：一段话 + 0..9 张图 + 可选地点。images 同样存 JSON 数组。

CREATE TABLE IF NOT EXISTS moments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  content        TEXT    NOT NULL,
  images         TEXT    NOT NULL DEFAULT '[]',
  location       TEXT    NOT NULL DEFAULT '',
  reaction_count INTEGER NOT NULL DEFAULT 0,
  published_at   TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_moments_pub ON moments(published_at DESC, id DESC);

-- ========== 配置 ==========

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
