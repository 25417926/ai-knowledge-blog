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
        for statement in ddl.split(";"):
            if statement.strip():
                await conn.execute(text(statement))


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI 依赖：每个请求一个 session，结束后关闭。"""
    async with AsyncSessionLocal() as session:
        yield session


async def dispose_engine() -> None:
    await engine.dispose()
