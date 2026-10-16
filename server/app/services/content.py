"""内容查询服务：逐函数移植 src/lib/posts.ts、moments.ts。

SQL 与原版保持一致（同样的过滤、同样的排序、同样的 LIKE 语义），
差别只在 node:sqlite 的命名参数 @x 换成 SQLAlchemy 的 :x。
"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import Integer, String, and_, case, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..models import Chunk, Friend, Link, Moment as MomentRow, Post, PostTag, Tag
from ..schemas import (
    CategoryRow,
    FriendItem,
    LinkRef,
    Moment,
    PostDetail,
    PostListItem,
    TagRow,
)

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")


def to_slug(value: str) -> str:
    """与 posts.ts normalizeKey / vault.ts toSlug 同一套规则，双链解析才对得上。"""
    text = value.strip()
    text = re.sub(r"\.md$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[\s/\\]+", "-", text)
    text = re.sub(r"[^\w\-\u4e00-\u9fa5]", "", text, flags=re.UNICODE)
    text = re.sub(r"-{2,}", "-", text)
    return text.strip("-").lower()


def _json_str_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(v) for v in parsed if v]


# ── 文章 ──────────────────────────────────────────────


async def list_posts(
    session: AsyncSession,
    q: str = "",
    tag: str = "",
    category: str = "",
) -> list[PostListItem]:
    q = (q or "").strip()
    tag = (tag or "").strip()
    category = (category or "").strip()

    # 条件过滤：Node 版用 SQLite 的 @x='' OR ... 短路，Python 侧等价做法是动态拼条件
    stmt = select(Post).where(Post.status == "published")
    if q:
        stmt = stmt.where(
            or_(
                Post.title.like(f"%{q}%"),
                Post.summary.like(f"%{q}%"),
                Post.content.like(f"%{q}%"),
            )
        )
    if tag:
        stmt = stmt.where(
            Post.id.in_(
                select(PostTag.post_id)
                .join(Tag, Tag.id == PostTag.tag_id)
                .where(Tag.slug == tag)
            )
        )
    if category:
        stmt = stmt.where(Post.category == category)
    stmt = stmt.order_by(
        func.coalesce(Post.published_at, Post.created_at).desc(), Post.id.desc()
    )
    posts = (await session.execute(stmt)).scalars().all()
    return await _attach_tags(session, posts)


async def _attach_tags(session: AsyncSession, posts: list[Post]) -> list[PostListItem]:
    if not posts:
        return []
    ids = [p.id for p in posts]
    tag_rows = (
        await session.execute(
            select(PostTag.post_id, Tag.name)
            .join(Tag, Tag.id == PostTag.tag_id)
            .where(PostTag.post_id.in_(ids))
            .order_by(Tag.name)
        )
    ).all()
    by_post: dict[int, list[str]] = {}
    for post_id, name in tag_rows:
        by_post.setdefault(post_id, []).append(name)
    return [
        PostListItem(
            id=p.id,
            slug=p.slug,
            title=p.title,
            summary=p.summary,
            category=p.category,
            word_count=p.word_count,
            published_at=p.published_at,
            tags=by_post.get(p.id, []),
        )
        for p in posts
    ]


async def list_tags(session: AsyncSession) -> list[TagRow]:
    """只统计已发布文章的标签（Node 版靠 LEFT JOIN + status 过滤达到同样效果）。"""
    stmt = (
        select(
            Tag.id,
            Tag.name,
            Tag.slug,
            func.count(PostTag.post_id).label("count"),
        )
        .join(PostTag, PostTag.tag_id == Tag.id, isouter=True)
        .join(Post, (Post.id == PostTag.post_id) & (Post.status == "published"), isouter=True)
        .group_by(Tag.id)
        .having(func.count(PostTag.post_id) > 0)
        .order_by(func.count(PostTag.post_id).desc(), Tag.name)
    )
    rows = (await session.execute(stmt)).all()
    return [TagRow(id=r.id, name=r.name, slug=r.slug, count=r.count) for r in rows]


async def list_categories(session: AsyncSession) -> list[CategoryRow]:
    stmt = (
        select(Post.category, func.count().label("count"))
        .where(Post.status == "published")
        .group_by(Post.category)
        .order_by(func.count().desc(), Post.category)
    )
    rows = (await session.execute(stmt)).all()
    return [CategoryRow(category=r.category, count=r.count) for r in rows]


async def get_post(session: AsyncSession, slug: str) -> PostDetail | None:
    post = (
        await session.execute(
            select(Post).where(Post.slug == slug, Post.status == "published")
        )
    ).scalar_one_or_none()
    if post is None:
        return None
    [item] = await _attach_tags(session, [post])
    return PostDetail(
        **item.model_dump(),
        content=post.content,
        source_path=post.source_path,
        updated_at=post.updated_at,
    )


async def all_slugs(session: AsyncSession) -> list[str]:
    rows = (
        await session.execute(select(Post.slug).where(Post.status == "published"))
    ).scalars().all()
    return list(rows)


async def link_index(session: AsyncSession) -> dict[str, str]:
    rows = (
        await session.execute(
            select(Post.slug, Post.title).where(Post.status == "published")
        )
    ).all()
    index: dict[str, str] = {}
    for slug, title in rows:
        index[to_slug(slug)] = slug
        index[to_slug(title)] = slug
    return index


async def graph(session: AsyncSession) -> dict[str, Any]:
    nodes = (
        await session.execute(
            select(Post.id, Post.slug, Post.title, Post.category).where(
                Post.status == "published"
            )
        )
    ).all()
    # 两次 JOIN posts 必须起别名，否则 slug 列二义性（Node 版 SQL 靠 s. / t. 前缀区分）
    src = aliased(Post)
    dst = aliased(Post)
    edges = (
        await session.execute(
            select(src.slug.label("source"), dst.slug.label("target"))
            .select_from(Link)
            .join(src, src.id == Link.source_post_id)
            .join(dst, dst.id == Link.target_post_id)
            .where(dst.status == "published")
        )
    ).all()
    degree: dict[str, int] = {}
    for e in edges:
        degree[e.source] = degree.get(e.source, 0) + 1
        degree[e.target] = degree.get(e.target, 0) + 1
    return {
        "nodes": [
            {
                "id": n.slug,
                "slug": n.slug,
                "title": n.title,
                "category": n.category,
                "degree": degree.get(n.slug, 0),
            }
            for n in nodes
        ],
        "edges": [{"source": e.source, "target": e.target} for e in edges],
    }


async def backlinks(session: AsyncSession, slug: str) -> list[LinkRef]:
    target_id = (
        await session.execute(select(Post.id).where(Post.slug == slug))
    ).scalar_one_or_none()
    if target_id is None:
        return []
    stmt = (
        select(Post.slug, Post.title)
        .select_from(Link)
        .join(Post, Post.id == Link.source_post_id)
        .where(Link.target_post_id == target_id, Post.status == "published")
        .group_by(Post.id)
        .order_by(Post.title)
    )
    return [LinkRef(slug=r.slug, title=r.title) for r in (await session.execute(stmt)).all()]


async def outgoing_links(session: AsyncSession, slug: str) -> list[LinkRef]:
    source_id = (
        await session.execute(select(Post.id).where(Post.slug == slug))
    ).scalar_one_or_none()
    if source_id is None:
        return []
    stmt = (
        select(Post.slug, Post.title)
        .select_from(Link)
        .join(Post, Post.id == Link.target_post_id)
        .where(Link.source_post_id == source_id, Post.status == "published")
        .group_by(Post.id)
        .order_by(Post.title)
    )
    return [LinkRef(slug=r.slug, title=r.title) for r in (await session.execute(stmt)).all()]


# ── 友链 ──────────────────────────────────────────────


async def list_friends(session: AsyncSession) -> list[FriendItem]:
    """按录入顺序返回，前台就是后台里看到的那个次序。"""
    rows = (await session.execute(select(Friend).order_by(Friend.id))).scalars().all()
    return [FriendItem.model_validate(r) for r in rows]


# ── 说说 ──────────────────────────────────────────────


async def list_moments(session: AsyncSession, q: str = "", order: str = "desc") -> list[Moment]:
    q = (q or "").strip()
    stmt = select(MomentRow)
    if q:
        stmt = stmt.where(
            or_(MomentRow.content.like(f"%{q}%"), MomentRow.location.like(f"%{q}%"))
        )
    order_col = func.coalesce(MomentRow.published_at, MomentRow.created_at)
    if order == "asc":
        stmt = stmt.order_by(order_col.asc(), MomentRow.id.asc())
    else:
        stmt = stmt.order_by(order_col.desc(), MomentRow.id.desc())
    rows = (await session.execute(stmt)).scalars().all()
    return [
        Moment(
            id=r.id,
            content=r.content,
            images=_json_str_list(r.images),
            location=r.location,
            reaction_count=r.reaction_count,
            published_at=r.published_at,
        )
        for r in rows
    ]
