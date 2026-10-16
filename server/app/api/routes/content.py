"""内容查询路由：文章 / 归档 / 说说 / 图谱。

每个接口的返回结构与 Node 版 lib 函数逐字对齐，前端换成 fetch 之后零适配。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ...services import content as svc
from ...database import get_session
from ...schemas import (
    CategoryRow,
    FriendItem,
    GraphData,
    LinkRef,
    Moment,
    PostDetail,
    PostListItem,
    TagRow,
)

router = APIRouter()


@router.get("/posts", response_model=list[PostListItem])
async def posts_list(
    q: str = Query("", description="关键词，匹配标题/摘要/正文"),
    tag: str = Query("", description="标签 slug"),
    category: str = Query("", description="分类"),
    session: AsyncSession = Depends(get_session),
) -> Any:
    return await svc.list_posts(session, q=q, tag=tag, category=category)


@router.get("/posts/slugs", response_model=list[str])
async def posts_slugs(session: AsyncSession = Depends(get_session)) -> Any:
    """供前端 generateStaticParams 用。"""
    return await svc.all_slugs(session)


@router.get("/posts/{slug}", response_model=PostDetail | None)
async def post_detail(slug: str, session: AsyncSession = Depends(get_session)) -> Any:
    return await svc.get_post(session, slug)


@router.get("/tags", response_model=list[TagRow])
async def tags_list(session: AsyncSession = Depends(get_session)) -> Any:
    return await svc.list_tags(session)


@router.get("/categories", response_model=list[CategoryRow])
async def categories_list(session: AsyncSession = Depends(get_session)) -> Any:
    return await svc.list_categories(session)


@router.get("/graph", response_model=GraphData)
async def graph_data(session: AsyncSession = Depends(get_session)) -> Any:
    return await svc.graph(session)


@router.get("/posts/{slug}/backlinks", response_model=list[LinkRef])
async def post_backlinks(slug: str, session: AsyncSession = Depends(get_session)) -> Any:
    return await svc.backlinks(session, slug)


@router.get("/posts/{slug}/outgoing", response_model=list[LinkRef])
async def post_outgoing(slug: str, session: AsyncSession = Depends(get_session)) -> Any:
    return await svc.outgoing_links(session, slug)


@router.get("/link-index", response_model=dict[str, str])
async def link_index(session: AsyncSession = Depends(get_session)) -> Any:
    """双链解析表：[[标题]]/[[slug]] → 真实 slug，供前端渲染 wikilink。"""
    return await svc.link_index(session)


# ── 友链 ──────────────────────────────────────────────


@router.get("/friends", response_model=list[FriendItem])
async def friends_list(session: AsyncSession = Depends(get_session)) -> Any:
    return await svc.list_friends(session)


# ── 说说 ──────────────────────────────────────────────


@router.get("/moments", response_model=list[Moment])
async def moments_list(
    q: str = Query(""),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    session: AsyncSession = Depends(get_session),
) -> Any:
    return await svc.list_moments(session, q=q, order=order)
