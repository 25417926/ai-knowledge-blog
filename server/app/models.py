"""SQLAlchemy 模型：与 src/lib/schema.sql 逐表对应，字段名保持与前端 TS 类型一致的 camelCase 别名。

刻意不引入 Alembic：库只有十几张表、由导入脚本创建，版本迁移交给 server/scripts/init_db.py。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _camel(name: str) -> str:
    """snake_case → camelCase，让 ORM 属性与前端类型对齐，序列化时不用逐个改名。"""
    head, *rest = name.split("_")
    return head + "".join(word.capitalize() for word in rest)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")


# ── 内容层 ──────────────────────────────────────────────


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str] = mapped_column(String, default="")
    category: Mapped[str] = mapped_column(String, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, default="published")
    source_path: Mapped[str] = mapped_column(String, default="")
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")

    tags: Mapped[list[Tag]] = relationship(secondary="post_tags", order_by="Tag.name")
    chunks: Mapped[list[Chunk]] = relationship(
        back_populates="post", cascade="all, delete-orphan", order_by="Chunk.ord"
    )


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)


class PostTag(Base):
    __tablename__ = "post_tags"

    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)


class Link(Base):
    __tablename__ = "links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"))
    target_slug: Mapped[str] = mapped_column(String, nullable=False)
    target_post_id: Mapped[int | None] = mapped_column(ForeignKey("posts.id", ondelete="SET NULL"))


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"))
    ord: Mapped[int] = mapped_column(Integer, default=0)
    heading_path: Mapped[str] = mapped_column(String, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[bytes | None] = mapped_column("embedding", String(length=1048576))

    post: Mapped[Post] = relationship(back_populates="chunks")


# ── Wiki 溯源层（schema 已建，代码尚未启用） ──────────────


class WikiEntry(Base):
    __tablename__ = "wiki_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    auto_generated: Mapped[bool] = mapped_column(Boolean, default=True)


class WikiSource(Base):
    __tablename__ = "wiki_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wiki_id: Mapped[int] = mapped_column(ForeignKey("wiki_entries.id", ondelete="CASCADE"))
    chunk_id: Mapped[int | None] = mapped_column(ForeignKey("chunks.id", ondelete="SET NULL"))
    quote: Mapped[str] = mapped_column(Text, default="")


# ── Agent 内核：博客助手与小镇 NPC 共用 ──────────────────


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String, default="npc")
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    persona: Mapped[str] = mapped_column(Text, default="")
    avatar: Mapped[str] = mapped_column(String, default="")
    location: Mapped[str] = mapped_column(String, default="")
    meta: Mapped[str] = mapped_column(Text, default="{}")


class AgentMemory(Base):
    __tablename__ = "agent_memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    user_key: Mapped[str] = mapped_column(String, default="owner")
    memory_kind: Mapped[str] = mapped_column(String, default="short")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    source_turn_id: Mapped[int | None] = mapped_column(BigInteger)


class AgentRelation(Base):
    __tablename__ = "agent_relations"
    __table_args__ = (UniqueConstraint("agent_id", "user_key"),)

    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True)
    user_key: Mapped[str] = mapped_column(String, default="owner", primary_key=True)
    score: Mapped[int] = mapped_column(Integer, default=0)
    stage: Mapped[str] = mapped_column(String, default="stranger")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")


class AgentSession(Base):
    __tablename__ = "agent_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    user_key: Mapped[str] = mapped_column(String, default="owner")
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")
    last_active_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")


class AgentTurn(Base):
    __tablename__ = "agent_turns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("agent_sessions.id", ondelete="CASCADE"))
    agent_id: Mapped[int] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    affinity_delta: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    model: Mapped[str] = mapped_column(String, default="")
    tool_trace: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")


class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    turn_id: Mapped[int] = mapped_column(ForeignKey("agent_turns.id", ondelete="CASCADE"))
    # 锚是文章 slug + 小节路径，不是 chunks.id：chunks 每次导入都重建，主键会漂
    post_slug: Mapped[str] = mapped_column(String, default="")
    heading_path: Mapped[str] = mapped_column(Text, default="")
    quote: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[float] = mapped_column(Float, default=0)


# ── 收藏管道层 ──────────────────────────────────────────


class Clipping(Base):
    __tablename__ = "clippings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    url: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String, default="")
    source_path: Mapped[str] = mapped_column(String, default="")
    origin: Mapped[str] = mapped_column(String, default="web")
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    pdf: Mapped[bytes | None] = mapped_column(LargeBinary)
    index_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")


# ── 说说层 ──────────────────────────────────────────────


class Moment(Base):
    __tablename__ = "moments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    images: Mapped[str] = mapped_column(Text, default="[]")
    location: Mapped[str] = mapped_column(String, default="")
    reaction_count: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")


# ── 友链层 ──────────────────────────────────────────────


class Friend(Base):
    __tablename__ = "friends"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    href: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default="datetime('now')")


# ── 配置 ──────────────────────────────────────────────


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
