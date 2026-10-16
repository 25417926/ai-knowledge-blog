"""Pydantic 响应模型：字段名与前端 TS 类型逐字对齐，Next 侧 fetch 后无需再改名。

命名即契约 —— 前端 posts.ts 的 PostListItem.wordCount / publishedAt / sourcePath
在这里就是 word_count / published_at / source_path 的序列化输出。
"""

from __future__ import annotations

from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, field_validator

T = TypeVar("T")


def to_camel(name: str) -> str:
    """word_count → wordCount。数据库是 snake_case，前端契约是 camelCase，在这一层对齐。"""
    head, *rest = name.split("_")
    return head + "".join(word.capitalize() for word in rest)


class ORMModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=to_camel,
    )


# ── 内容层 ──────────────────────────────────────────────


class PostListItem(ORMModel):
    id: int
    slug: str
    title: str
    summary: str
    category: str
    word_count: int
    published_at: str | None
    tags: list[str]


class PostDetail(PostListItem):
    content: str
    source_path: str
    updated_at: datetime


class TagRow(ORMModel):
    id: int
    name: str
    slug: str
    count: int


class CategoryRow(ORMModel):
    category: str
    count: int


class LinkRef(ORMModel):
    slug: str
    title: str


class GraphData(ORMModel):
    nodes: list[dict]
    edges: list[dict]


# ── 友链 ────────────────────────────────────────────────


class FriendItem(ORMModel):
    id: int
    name: str
    href: str
    description: str
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def _parse_tags(cls, v: object) -> object:
        """tags 在库里是 JSON 字符串，出库时摊成数组；脏数据一律当空。"""
        if isinstance(v, str):
            import json

            try:
                parsed = json.loads(v)
                return [str(t) for t in parsed if t] if isinstance(parsed, list) else []
            except Exception:
                return []
        return v


# ── 说说 ────────────────────────────────────────────────


class Moment(ORMModel):
    id: int
    content: str
    images: list[str]
    location: str
    reaction_count: int
    published_at: str | None

    @field_validator("images", mode="before")
    @classmethod
    def _parse_images(cls, v: object) -> object:
        if isinstance(v, str):
            import json

            try:
                parsed = json.loads(v)
                return [str(i) for i in parsed if i] if isinstance(parsed, list) else []
            except Exception:
                return []
        return v


# ── Agent 内核 ──────────────────────────────────────────


class AgentView(ORMModel):
    id: int
    kind: str
    slug: str
    name: str
    persona: str
    avatar: str
    location: str
    meta: dict


class AffinityView(ORMModel):
    score: int
    stage: str
    label: str
    delta: int
    next_stage_at: int | None


class Citation(ORMModel):
    post_slug: str
    post_title: str
    category: str
    heading: str
    quote: str
    score: float
    # 收藏文章专有：原文 PDF 存档链接，供「对照原文」交叉验证；非收藏文章为 None
    pdf_url: str | None = None


class TalkResult(ORMModel):
    reply: str
    agent: dict
    affinity: AffinityView
    recalled: list[str]
    citations: list[Citation]
    session_id: str
    turn_index: int
    turn_id: int
    model: str
    mock: bool
    latency_ms: int


class TurnLog(ORMModel):
    id: int
    role: str
    content: str
    affinity_delta: int
    latency_ms: int
    model: str
    created_at: datetime
    sources: list[dict] = []


class ReadLogResult(ORMModel):
    session_id: str
    agent_slug: str
    agent_name: str
    turns: list[TurnLog]
    affinity: dict
    memories: list[dict]


class AskResponse(ORMModel):
    """POST /api/ask 的返回。talk 结果 + 供 UI 的附加字段。"""

    reply: str
    agent: dict
    affinity: AffinityView
    recalled: list[str]
    citations: list[Citation]
    session_id: str
    turn_index: int
    turn_id: int
    model: str
    mock: bool
    latency_ms: int


# ── 通用 ──────────────────────────────────────────────


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int


class ErrorBody(BaseModel):
    error: str
