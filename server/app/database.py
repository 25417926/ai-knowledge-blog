"""数据库连接与建表。

- 数据文件在项目根 data/blog.db，与前端共享同一个库；
- 建表执行 server/app/schema.sql —— 数据层归 Python 之后，DDL 的唯一出处就在这里；
- 没有 db.transaction()，用 session 上下文 + commit/rollback 兜底。
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

SERVER_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = SERVER_DIR.parent

DB_PATH = os.environ.get("DB_PATH") or str(PROJECT_ROOT / "data" / "blog.db")
SCHEMA_PATH = SERVER_DIR / "app" / "schema.sql"

DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False, future=True)


@event.listens_for(engine.sync_engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):  # noqa: ANN001
    """WAL + 外键约束，与 Node 侧保持一致（连接级 PRAGMA，必须挂在 connect 上）。"""
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode = WAL")
    cur.execute("PRAGMA foreign_keys = ON")
    cur.close()


AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_schema() -> None:
    """执行共享 DDL 建表。幂等，可反复调用。"""
    ddl = SCHEMA_PATH.read_text(encoding="utf-8")
    async with engine.begin() as conn:
        # 迁移必须在 DDL 之前：schema.sql 里建在新增列上的索引，对旧库会先于补列执行而报错
        await _migrate_columns(conn)
        await _migrate_citations_anchor(conn)
        await _drop_legacy_tables(conn)
        for statement in ddl.split(";"):
            if statement.strip():
                await conn.execute(text(statement))


async def _migrate_citations_anchor(conn) -> None:
    """citations 的锚从易变的 chunks.id 换成稳定业务键 post_slug + heading_path。

    import_vault 每次导入都把该 post 的 chunks 全删重插，chunks.id 随即失效
    （外键 ON DELETE SET NULL 把回链擦成 NULL）。已断的旧行按两种办法回捞：
    1. chunk 尚存活的，直接取它的 slug / heading；
    2. 其余用 quote 前缀在现有 chunks.body 里比对 —— quote 落库时就是 body.strip()[:400]。
    两者都捞不回来的保留原样（post_slug 为空，前端不渲染），不删数据。
    """
    cols = {r[1] for r in (await conn.execute(text("PRAGMA table_info(citations)"))).fetchall()}
    if not cols or "chunk_id" not in cols:
        return  # 新库或已迁过

    await conn.execute(text("ALTER TABLE citations ADD COLUMN post_slug TEXT NOT NULL DEFAULT ''"))
    await conn.execute(text("ALTER TABLE citations ADD COLUMN heading_path TEXT NOT NULL DEFAULT ''"))

    await conn.execute(
        text(
            """
            UPDATE citations SET
              post_slug = COALESCE((SELECT p.slug FROM chunks c JOIN posts p ON p.id = c.post_id
                                    WHERE c.id = citations.chunk_id), ''),
              heading_path = COALESCE((SELECT c.heading_path FROM chunks c
                                       WHERE c.id = citations.chunk_id), '')
            WHERE chunk_id IS NOT NULL
            """
        )
    )

    # 太短的 quote 不足以定位段落（大量短句会互相撞），宁可判为捞不回
    broken = (
        await conn.execute(
            text("SELECT id, quote FROM citations WHERE post_slug = '' AND length(quote) >= 20")
        )
    ).fetchall()
    if broken:
        chunks = [
            (body.strip(), slug, heading)
            for body, slug, heading in (
                await conn.execute(
                    text(
                        "SELECT c.body, p.slug, c.heading_path FROM chunks c "
                        "JOIN posts p ON p.id = c.post_id"
                    )
                )
            ).fetchall()
        ]
        for cid, quote in broken:
            for body, slug, heading in chunks:
                if body[: len(quote)] == quote:
                    await conn.execute(
                        text(
                            "UPDATE citations SET post_slug = :slug, heading_path = :heading "
                            "WHERE id = :cid"
                        ),
                        {"slug": slug, "heading": heading, "cid": cid},
                    )
                    break

    await conn.execute(text("DROP INDEX IF EXISTS idx_citations_chunk"))
    await conn.execute(text("ALTER TABLE citations DROP COLUMN chunk_id"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_citations_post ON citations(post_slug)"))


async def _migrate_columns(conn) -> None:
    """CREATE TABLE IF NOT EXISTS 不会给旧库补列，新增列在这里轻量 ALTER。

    每个条目 = (表名, 列名, ALTER 语句)。目前有 agent_turns.tool_trace
    （Function Calling 的调用 trace）、clippings.pdf（收藏的原文 PDF 存档）
    与 clippings.index_text（检索用原文，见 scripts/clip.py）。
    """
    migrations = [
        (
            "agent_turns",
            "tool_trace",
            "ALTER TABLE agent_turns ADD COLUMN tool_trace TEXT NOT NULL DEFAULT ''",
        ),
        ("clippings", "pdf", "ALTER TABLE clippings ADD COLUMN pdf BLOB"),
        (
            "clippings",
            "index_text",
            "ALTER TABLE clippings ADD COLUMN index_text TEXT NOT NULL DEFAULT ''",
        ),
    ]
    for table, column, ddl in migrations:
        rows = (await conn.execute(text(f"PRAGMA table_info({table})"))).fetchall()
        if rows and column not in {r[1] for r in rows}:
            await conn.execute(text(ddl))


async def _drop_legacy_tables(conn) -> None:
    """删掉零引用的死重表。

    `settings` 从未被任何代码读写；`wiki_entries` / `wiki_sources` 是旧「Wiki 自动沉淀」
    方案的遗留，已改用摘要兜底 + 落地导览，schema.sql 里的 DDL 一并移除。
    只删物理表，先子表后父表，避免外键残留。幂等，可反复调用。
    """
    for table in ("wiki_sources", "wiki_entries", "settings"):
        await conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI 依赖：每个请求一个 session，结束后关闭。"""
    async with AsyncSessionLocal() as session:
        yield session


async def dispose_engine() -> None:
    await engine.dispose()
