"""内容查询服务：逐函数移植 src/lib/posts.ts、moments.ts。

SQL 与原版保持一致（同样的过滤、同样的排序、同样的 LIKE 语义），
差别只在 node:sqlite 的命名参数 @x 换成 SQLAlchemy 的 :x。
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..models import Citation, Chunk, Friend, Link, Moment as MomentRow, Post, PostTag, Tag
from ..schemas import (
    CategoryRow,
    FriendItem,
    LinkRef,
    Moment,
    PostDetail,
    PostListItem,
    RelatedPost,
    TagRow,
)
from .keyword import idf_table, overlap, token_set

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


# ── 相关文章（关系网召回的隐式边） ─────────────────────
# 显式 [[双链]] 之外的第二档关系。权重是排序口径，不是标定出来的概率：
# 共同标签最经得起解释，给得最重；内容重合只在标签与共引都空着时才起作用（孤立文章）。

RELATED_LIMIT = 6
W_SHARED_TAG = 3.0
W_CO_CITATION = 2.0
W_SAME_CATEGORY = 0.5
# 重合度是 0~0.12 量级的小数（本库实测），乘到与「一个共同标签」同量级才排得动
CONTENT_SCALE = 20.0
# 只拦「一点关系都没有」，弱关联交给排序淘汰
RELATED_MIN_SCORE = 0.05
# 证据（标签 / 共引 / 同类目）不足这么多条时，用「只有内容重合」的补齐——宁可标注「主题相近」，
# 也别让孤立文章的相关文章区空着或只剩一条
RELATED_FILL_MIN = 3


async def related_posts(
    session: AsyncSession, slug: str, limit: int = RELATED_LIMIT
) -> list[RelatedPost]:
    """本文没链接到、但关系最近的几篇文章。

    刻意**排除已有显式双链的文章**（两个方向都算）：出链/反链在文章页另有面板，
    这一块补的是那两块空着的时候——孤立文章最需要它。

    三档证据，都落到同一个分数里：
    ① 共同标签；② 同被一轮问答引用过（问答本身就搜过这些片段，等于一份现成的共现证据）；
    ③ 内容重合（标题 + 摘要 + 切分块的 IDF 加权余弦），无标签、无共引时唯一的线索。

    前两档（含同类目）算「说得清为什么」，直接给；第三档算凑数，只在证据不足
    `RELATED_FILL_MIN` 条时补进来，且永远排在证据之后。
    """
    target = (
        await session.execute(
            select(Post).where(Post.slug == slug, Post.status == "published")
        )
    ).scalar_one_or_none()
    if target is None:
        return []

    posts = (
        await session.execute(
            select(Post.id, Post.slug, Post.title, Post.summary, Post.category).where(
                Post.status == "published"
            )
        )
    ).all()
    candidates = [p for p in posts if p.id != target.id]
    if not candidates:
        return []

    # 已有显式双链的（出链 + 反链）不进这一块；目标未解析的 link 行 target_post_id 为 NULL，滤掉
    linked_ids: set[int] = set()
    for stmt in (
        select(Link.target_post_id).where(Link.source_post_id == target.id),
        select(Link.source_post_id).where(Link.target_post_id == target.id),
    ):
        linked_ids |= {i for i in (await session.execute(stmt)).scalars().all() if i}

    tags_by_post: dict[int, set[str]] = defaultdict(set)
    for post_id, name in (
        await session.execute(
            select(PostTag.post_id, Tag.name).join(Tag, Tag.id == PostTag.tag_id)
        )
    ).all():
        tags_by_post[post_id].add(name)

    # 同被一轮问答引用过：一轮里引 2 篇 = 强证据；答泛问时一轮引 7 篇，那 7 篇之间任意两篇
    # 都算不上强证据（否则一次概览回答就把它们连成团），故按「该轮被引篇数 - 1」摊薄。
    # co_citations 记轮次数（给界面看「同被 N 轮问答引用」），score 用摊薄后的权重（给排序用）。
    turn_posts: dict[int, set[str]] = defaultdict(set)
    for turn_id, cited_slug in (
        await session.execute(
            select(Citation.turn_id, Citation.post_slug).where(Citation.post_slug != "")
        )
    ).all():
        turn_posts[turn_id].add(cited_slug)

    co_weight: dict[str, float] = defaultdict(float)
    co_turns: dict[str, int] = defaultdict(int)
    for cited_slugs in turn_posts.values():
        if len(cited_slugs) < 2 or slug not in cited_slugs:
            continue
        share = 1.0 / (len(cited_slugs) - 1)
        for other in cited_slugs:
            if other == slug:
                continue
            co_weight[other] += share
            co_turns[other] += 1

    tokens_by_post: dict[int, set[str]] = {
        p.id: token_set(f"{p.title} {p.summary or ''}") for p in posts
    }
    for post_id, heading, body in (
        await session.execute(
            select(Chunk.post_id, Chunk.heading_path, Chunk.body)
            .join(Post, Post.id == Chunk.post_id)
            .where(Post.status == "published")
        )
    ).all():
        tokens_by_post[post_id] |= token_set(f"{heading} {body}")
    idf = idf_table(list(tokens_by_post.values()))

    target_tokens = tokens_by_post.get(target.id, set())
    target_tags = tags_by_post.get(target.id, set())

    # 分两档：说得清「为什么相关」的（共同标签 / 共引 / 同类目）直接给；
    # 只有内容重合的算凑数，仅在证据不足 3 条时补进来，且永远排在证据之后。
    evidenced: list[RelatedPost] = []
    content_only: list[RelatedPost] = []
    for p in candidates:
        if p.id in linked_ids:
            continue
        shared = sorted(target_tags & tags_by_post.get(p.id, set()))
        co = co_turns.get(p.slug, 0)
        same_category = p.category == target.category
        sim = overlap(target_tokens, tokens_by_post.get(p.id, set()), idf)
        score = (
            W_SHARED_TAG * len(shared)
            + W_CO_CITATION * co_weight.get(p.slug, 0.0)
            + (W_SAME_CATEGORY if same_category else 0.0)
            + CONTENT_SCALE * sim
        )
        if score < RELATED_MIN_SCORE:
            continue
        item = RelatedPost(
            slug=p.slug,
            title=p.title,
            summary=p.summary or "",
            category=p.category,
            score=round(score, 3),
            shared_tags=shared,
            co_citations=co,
            content_overlap=round(sim, 4),
        )
        (evidenced if (shared or co or same_category) else content_only).append(item)

    evidenced.sort(key=lambda item: (-item.score, item.title))
    content_only.sort(key=lambda item: (-item.score, item.title))
    if len(evidenced) < RELATED_FILL_MIN:
        evidenced += content_only[: RELATED_FILL_MIN - len(evidenced)]
    return evidenced[:limit]


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
