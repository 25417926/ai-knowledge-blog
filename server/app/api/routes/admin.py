"""后台管理路由：口令登录 + 文章 CRUD + 对话日志。

认证用单人口令（`ADMIN_PASSWORD`）：校验通过后签一个带到期时间的 token 写进
httpOnly cookie，不引 JWT 库——标准库 `hmac` + `compare_digest` 就够，且零依赖。
没配 `ADMIN_PASSWORD` 时后台整体禁用（503），不会出现"空口令可登录"的口子。

**文章保存的落点是 Vault 的 .md 文件，不是只写数据库。**
`scripts.init_db.import_vault` 只做 upsert、从不删（读代码确认），
若只写库，下次谁再跑一次 `init_db`，文件里的旧内容就会把后台的改动覆盖掉。
所以这里保持「文件是唯一资产」：先写文件，再调 `import_vault` 重建索引
（切分 / 双链解析 / 标签一律复用那一份实现，不另写一套）。
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import frontmatter
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models import AgentSession, AgentTurn, Citation, Clipping, Friend, Post, PostTag, Tag
from ...services import agent_chat as svc
from ...services import clipping as clip_svc
from ...services import embedding_job
from ...services import insights as insights_svc
from ...services import summary as summary_svc
from ...services.content import list_friends
from scripts.init_db import PROJECT_ROOT, import_vault, to_slug

from .ask import ASSISTANT_SLUG, SESSION_KEY

router = APIRouter()

VAULT_DIR = PROJECT_ROOT / "content" / "sample-vault"
SESSION_COOKIE = "admin_session"
SESSION_TTL = 7 * 24 * 3600  # 一周
STATUSES = {"published", "draft"}


# ── 认证 ──────────────────────────────────────────────


def _admin_password() -> str:
    return os.environ.get("ADMIN_PASSWORD", "").strip()


def _secret() -> bytes:
    """签名密钥。没配 SESSION_SECRET 就由口令派生——改口令即让所有旧会话失效。"""
    raw = os.environ.get("SESSION_SECRET", "").strip() or _admin_password()
    return hashlib.sha256(f"blog-admin::{raw}".encode()).digest()


def _issue_token() -> str:
    exp = str(int(time.time()) + SESSION_TTL)
    sig = hmac.new(_secret(), exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def _token_valid(token: str) -> bool:
    exp, _, sig = token.partition(".")
    if not exp.isdigit() or not sig or int(exp) < time.time():
        return False
    expect = hmac.new(_secret(), exp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expect)


def _authenticated(request: Request) -> bool:
    return bool(_admin_password()) and _token_valid(request.cookies.get(SESSION_COOKIE, ""))


def require_admin(request: Request) -> None:
    """守卫：写操作与后台读接口都要过这一关。"""
    if not _admin_password():
        raise HTTPException(status_code=503, detail="后端未配置 ADMIN_PASSWORD，后台已禁用")
    if not _authenticated(request):
        raise HTTPException(status_code=401, detail="未登录或会话已过期")


class LoginBody(BaseModel):
    password: str = ""


@router.post("/admin/login")
async def admin_login(body: LoginBody, response: Response) -> dict[str, Any]:
    password = _admin_password()
    if not password:
        raise HTTPException(status_code=503, detail="后端未配置 ADMIN_PASSWORD，后台已禁用")
    if not hmac.compare_digest(body.password, password):
        raise HTTPException(status_code=401, detail="口令不正确")
    response.set_cookie(
        SESSION_COOKIE,
        _issue_token(),
        max_age=SESSION_TTL,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return {"ok": True, "expiresIn": SESSION_TTL}


@router.post("/admin/logout")
async def admin_logout(response: Response) -> dict[str, Any]:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/admin/me")
async def admin_me(request: Request) -> dict[str, Any]:
    """前端闸门问的就是这个：没登录就把人送去登录页。"""
    return {"enabled": bool(_admin_password()), "authenticated": _authenticated(request)}


# ── 文章 ──────────────────────────────────────────────


class PostBody(BaseModel):
    title: str = ""
    summary: str = ""
    category: str = ""
    tags: list[str] = []
    date: str = ""
    status: str = "published"
    content: str = ""


def _safe_folder(category: str) -> str:
    """分类要当目录名用，剥掉路径分隔符，免得跑出 Vault 之外。"""
    cleaned = category.replace("/", "").replace("\\", "").strip().strip(".")
    return cleaned


def _post_view(post: Post, tags: list[str]) -> dict[str, Any]:
    return {
        "id": post.id,
        "slug": post.slug,
        "title": post.title,
        "summary": post.summary,
        "category": post.category,
        "tags": tags,
        "status": post.status,
        "content": post.content,
        "sourcePath": post.source_path,
        "wordCount": post.word_count,
        "publishedAt": post.published_at,
        "updatedAt": post.updated_at,
    }


async def _load_post(session: AsyncSession, slug: str) -> Post:
    post = (
        await session.execute(select(Post).where(Post.slug == slug))
    ).scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail=f"文章不存在：{slug}")
    return post


async def _tags_of(session: AsyncSession, post_id: int) -> list[str]:
    rows = (
        await session.execute(
            select(Tag.name)
            .join(PostTag, PostTag.tag_id == Tag.id)
            .where(PostTag.post_id == post_id)
        )
    ).scalars().all()
    return list(rows)


def _build_markdown(body: PostBody, title: str, day: str, summary: str | None = None) -> str:
    """按 Vault 现有笔记的 frontmatter 风格组装文件内容。

    `summary` 单独传是因为摘要在保存前可能被兜底改写过（见 `_save`），
    而 `body` 是请求体的原样，不该为了一次兜底去改写它。
    """
    meta = {
        "title": title,
        "category": _safe_folder(body.category),
        "tags": [t.strip() for t in body.tags if t.strip()],
        "date": day,
        "summary": (body.summary if summary is None else summary).strip(),
    }
    return frontmatter.dumps(frontmatter.Post(content=body.content, **meta)) + "\n"


def _target_path(body: PostBody, slug: str, existing: Post | None) -> Path:
    """老文章改在它原来的文件里（不搬家）；新文章按分类建目录。"""
    if existing is not None and existing.source_path:
        return VAULT_DIR / existing.source_path
    folder = _safe_folder(body.category)
    return VAULT_DIR / folder / f"{slug}.md" if folder else VAULT_DIR / f"{slug}.md"


async def _save(body: PostBody, slug: str, existing: Post | None, session: AsyncSession) -> dict:
    title = body.title.strip() or (existing.title if existing else "")
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    status = body.status if body.status in STATUSES else "published"
    day = body.date.strip() or (existing.published_at if existing else "") or date.today().isoformat()

    # 摘要留空不再等于「往 frontmatter 塞一个空串」：确定性抽取兜一句。
    # 这里刻意不走 LLM——保存要快（模型一卡 2~10 秒），而且 Mock 摘要一旦入库
    # 不会在配好 Key 之后自动更新。想让模型写，是编辑器里那个按钮的事。
    summary = body.summary.strip() or summary_svc.extract_summary(title, body.content)

    path = _target_path(body, slug, existing)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_build_markdown(body, title, day, summary), encoding="utf-8")

    # 重建索引：复用 vault 导入器，切分 / 双链 / 标签一次到位。
    # 全量重导也是**正确**选择——新文章的反向链接要靠「所有笔记一起解析」才能接上。
    stats = await import_vault(session, VAULT_DIR)
    # 上面这一步会把该文章的块删了重插：内容没改的块已继承旧向量，剩下没向量的
    # （新写的段落、新文章）在这里补。失败不影响保存本身。
    await embedding_job.fill_missing(session)
    if status != "published":
        await session.execute(
            Post.__table__.update().where(Post.slug == slug).values(status=status)
        )
        await session.commit()
    return {
        "ok": True,
        "slug": slug,
        "summary": summary,
        "summaryGenerated": not body.summary.strip(),
        "sourcePath": path.relative_to(VAULT_DIR).as_posix(),
        "status": status,
        "stats": stats,
    }


@router.get("/admin/posts", dependencies=[Depends(require_admin)])
async def admin_list_posts(
    q: str = "",
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    stmt = select(Post)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Post.title.like(like), Post.slug.like(like)))
    rows = (
        await session.execute(stmt.order_by(Post.updated_at.desc(), Post.id.desc()))
    ).scalars().all()
    return [_post_view(p, await _tags_of(session, p.id)) for p in rows]


@router.get("/admin/posts/{slug}", dependencies=[Depends(require_admin)])
async def admin_get_post(
    slug: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    post = await _load_post(session, slug)
    return _post_view(post, await _tags_of(session, post.id))


@router.post("/admin/posts", dependencies=[Depends(require_admin)])
async def admin_create_post(
    body: PostBody, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    slug = to_slug(body.title)
    if not slug:
        raise HTTPException(status_code=400, detail="标题里没有可用的字，换一个")
    dup = (await session.execute(select(Post.id).where(Post.slug == slug))).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(status_code=409, detail=f"已存在同 slug 的文章（{slug}），换个标题")
    return await _save(body, slug, None, session)


@router.put("/admin/posts/{slug}", dependencies=[Depends(require_admin)])
async def admin_update_post(
    slug: str, body: PostBody, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    post = await _load_post(session, slug)
    return await _save(body, slug, post, session)


@router.delete("/admin/posts/{slug}", dependencies=[Depends(require_admin)])
async def admin_delete_post(
    slug: str, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    post = await _load_post(session, slug)
    if post.source_path:
        (VAULT_DIR / post.source_path).unlink(missing_ok=True)
    # chunks / links / post_tags 由外键 ON DELETE CASCADE 收拾
    await session.execute(delete(Post).where(Post.id == post.id))
    # 顺手清掉不再被任何文章引用的标签，免得公开页蹦出 count=0 的标签
    await session.execute(delete(Tag).where(Tag.id.not_in(select(PostTag.tag_id))))
    await session.commit()
    return {"ok": True, "slug": slug}


# ── 摘要 ──────────────────────────────────────────────
#
# 纯计算端点：不写库、不碰文件。作者在编辑器里反复点也不产生副作用，
# 满意了再随文章一起 PUT 保存。收藏管道那条摘抄（整篇 Markdown）走的是
# clipping.summarize()，与这里的一句话摘要是两层东西，别混。


class SummaryBody(BaseModel):
    title: str = ""
    content: str = ""
    current: str = ""  # 作者已写的摘要；非空表示「优化」而不是「生成」
    mode: str = "extract"  # extract | ai


@router.post("/admin/summary", dependencies=[Depends(require_admin)])
async def admin_summary(body: SummaryBody) -> dict[str, Any]:
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="正文为空，没有可总结的内容")
    try:
        return await summary_svc.make_summary(
            body.title.strip(),
            content,
            "ai" if body.mode == "ai" else "extract",
            body.current.strip(),
        )
    except Exception as err:  # 模型超时/额度/网络：让作者看见原因，而不是静默降级
        raise HTTPException(status_code=502, detail=f"AI 摘要生成失败：{err}") from err


# ── 友链 ──────────────────────────────────────────────
#
# 与文章不同，友链没有对应的 md 文件，改完只写库 —— 它是纯展示数据，
# 不参与 RAG 与图谱，也就没有「文件覆盖数据库」那条坑。
# 种子（content/friends.json）只在表为空时灌，所以这里删掉的条目不会被 init_db 复活。


class FriendBody(BaseModel):
    name: str = ""
    href: str = ""
    description: str = ""
    tags: list[str] = []


def _friend_values(body: FriendBody) -> dict[str, Any]:
    """校验并摊平输入。href 只放行 http(s)：它最终会渲染成 <a href>，
    放行 javascript: 之类等于在页面上开一个注入口子。"""
    name = body.name.strip()
    href = body.href.strip()
    if not name:
        raise HTTPException(status_code=400, detail="站点名不能为空")
    if not href:
        raise HTTPException(status_code=400, detail="链接不能为空")
    if not href.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="链接要以 http:// 或 https:// 开头")
    return {
        "name": name,
        "href": href,
        "description": body.description.strip(),
        "tags": json.dumps([t.strip() for t in body.tags if t.strip()], ensure_ascii=False),
        "updated_at": func.now(),
    }


async def _assert_href_free(session: AsyncSession, href: str, exclude_id: int | None) -> None:
    stmt = select(Friend.id).where(Friend.href == href)
    if exclude_id is not None:
        stmt = stmt.where(Friend.id != exclude_id)
    if (await session.execute(stmt)).scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail=f"链接 {href} 已经在友链里了")


@router.get("/admin/friends", dependencies=[Depends(require_admin)])
async def admin_list_friends(session: AsyncSession = Depends(get_session)) -> Any:
    return await list_friends(session)


@router.post("/admin/friends", dependencies=[Depends(require_admin)])
async def admin_create_friend(
    body: FriendBody, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    values = _friend_values(body)
    await _assert_href_free(session, values["href"], None)
    session.add(Friend(**values))
    await session.commit()
    return {"ok": True}


@router.put("/admin/friends/{friend_id}", dependencies=[Depends(require_admin)])
async def admin_update_friend(
    friend_id: int, body: FriendBody, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    exists = (
        await session.execute(select(Friend.id).where(Friend.id == friend_id))
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=404, detail="这条友链已经不在了")
    values = _friend_values(body)
    await _assert_href_free(session, values["href"], friend_id)
    await session.execute(update(Friend).where(Friend.id == friend_id).values(**values))
    await session.commit()
    return {"ok": True}


@router.delete("/admin/friends/{friend_id}", dependencies=[Depends(require_admin)])
async def admin_delete_friend(
    friend_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    result = await session.execute(delete(Friend).where(Friend.id == friend_id))
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="这条友链已经不在了")
    return {"ok": True}


# ── 对话日志 ──────────────────────────────────────────


@router.get("/admin/logs", dependencies=[Depends(require_admin)])
async def admin_logs(
    limit: int = 60, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """直接复用阅读面板那份 read_log，字段与前端历史回放逐字一致。"""
    return await svc.read_log(session, SESSION_KEY, ASSISTANT_SLUG, max(1, min(limit, 200)))


# ── 访客意图 ──────────────────────────────────────────
#
# 只读聚合，不改任何一张表。取数逻辑全在这里，聚合逻辑全在 services/insights.py
# （纯函数，有单测）。这条边界是有意的：SQL 会变，判断标准不该跟着变。
#
# 一个问题算不算「有引用」，看的是**它那一条回答**引了几篇 —— 所以必须把
# user 轮和紧随其后的 assistant 轮配成对。库里只有 id 顺序可用（没有 parent_turn_id），
# 因此按 id 升序扫一遍、用「同一会话里上一轮提问」配对，别绕开这段去写 JOIN。


def _pairs(rows: list[Any]) -> list[tuple[Any, Any | None]]:
    """把按 id 升序的 turn 行配成 (提问, 回答)。没有回答的提问返回 None。"""
    pairs: list[tuple[Any, Any | None]] = []
    pending: dict[str, Any] = {}
    for row in rows:
        if row.role == "user":
            # 同一会话连续两次提问（上一轮生成失败）时，后者覆盖前者：
            # 前一次没有回答，留着只会凭空多一条"零引用缺口"。
            pending[row.session_id] = row
            continue
        ask = pending.pop(row.session_id, None)
        if ask is not None:
            pairs.append((ask, row))
    for row in pending.values():
        pairs.append((row, None))
    return pairs


@router.get("/admin/insights", dependencies=[Depends(require_admin)])
async def admin_insights(
    days: int = 0, top: int = 8, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """访客意图：高频问题 / 零引用缺口 / 按意图分组 / 被问最多的文章。

    `days=0` 表示全部历史；SQLite 的 `datetime('now')` 存的是 UTC，所以窗口也按 UTC 截。

    **只统计博客助手入口的会话**：同一个 agent 名下还可能有 NPC 闲聊会话（历史遗留的
    `librarian:town` 就是自报家门那种），把它们算进访客意图会让「内容缺口」里冒出
    「我叫阿国」这类根本不该被回答的句子。判定用会话 key（`<slug>:<key>` 的后半段），
    与 `ask.py` 的 `SESSION_KEY` 对齐；**一条都对不上时退回全部会话**——
    宁可数据略脏，也不要因为 key 改名而悄悄变成一页空白。
    """
    agent = await svc._resolve_agent(session, ASSISTANT_SLUG)
    agent_id = agent.id
    entry_key = f"{agent.slug}:{SESSION_KEY}"
    all_sessions = {
        row[0]
        for row in (
            await session.execute(select(AgentSession.id).where(AgentSession.agent_id == agent_id))
        ).all()
    }
    allowed = {entry_key} if entry_key in all_sessions else all_sessions

    cutoff = _window_start(days) if days > 0 else ""
    rows = (
        await session.execute(
            select(
                AgentTurn.id,
                AgentTurn.session_id,
                AgentTurn.role,
                AgentTurn.content,
                AgentTurn.created_at,
                AgentTurn.latency_ms,
            )
            .where(AgentTurn.agent_id == agent_id, AgentTurn.session_id.in_(allowed or {""}))
            .order_by(AgentTurn.id)
        )
    ).all()

    cited: dict[int, list[str]] = {}
    for turn_id, slug in (
        await session.execute(
            select(Citation.turn_id, Citation.post_slug)
            .join(AgentTurn, AgentTurn.id == Citation.turn_id)
            .where(AgentTurn.agent_id == agent_id)
        )
    ).all():
        if slug:
            cited.setdefault(turn_id, []).append(slug)

    questions: list[insights_svc.Question] = []
    for ask, answer in _pairs(rows):
        asked_at = insights_svc.stamp(ask.created_at)
        if days > 0 and asked_at < cutoff:
            continue
        questions.append(
            insights_svc.Question(
                turn_id=ask.id,
                session_id=ask.session_id,
                text=ask.content,
                asked_at=asked_at,
                citations=tuple(cited.get(answer.id, ()) if answer is not None else ()),
                latency_ms=int(getattr(answer, "latency_ms", 0) or 0) if answer is not None else 0,
            )
        )

    slugs = {slug for q in questions for slug in q.citations}
    titles = (
        dict(
            (
                await session.execute(
                    select(Post.slug, Post.title).where(Post.slug.in_(slugs))
                )
            ).all()
        )
        if slugs
        else {}
    )
    return insights_svc.summarize(questions, titles=titles, top=max(1, min(top, 20)))


def _window_start(days: int) -> str:
    """`现在 - days` 的 UTC 字符串（与 `_stamp` 同格式，可直接比）。"""
    moment = datetime.now(timezone.utc) - timedelta(days=days)
    return moment.strftime("%Y-%m-%d %H:%M:%S")


# ── 收藏 ──────────────────────────────────────────────
#
# 管道本体在 services/clipping.py（与 scripts/clip.py 共用）。这里只做三件事：
# 校验输入、串行化、把结果摊平成前端认得的字段。
#
# **必须串行**：两条并发会同时写 vault、同时跑 import_vault，笔记文件名还可能撞在
# 一起。用一把进程内的锁挡住，第二条直接 409 让人等——比排队到超时诚实。


CLIP_LOCK = asyncio.Lock()


class ClipBody(BaseModel):
    url: str = ""
    paste: str = ""
    title: str = ""


def _clip_log(label: str, detail: str) -> None:
    """把管道进度打进后端控制台：卡住时先看这里，别猜。"""
    print(f"  [clip] {label}{f' · {detail}' if detail else ''}")


def _clipping_view(row: Clipping, slug: str) -> dict[str, Any]:
    return {
        "id": row.id,
        "url": row.url,
        "title": row.title,
        "origin": row.origin,
        "wordCount": row.word_count,
        "createdAt": row.created_at.strftime("%Y-%m-%d") if row.created_at else "",
        "sourcePath": row.source_path,
        "slug": slug,
        "hasPdf": bool(row.pdf),
        "indexable": bool(row.index_text),
    }


@router.get("/admin/clippings", dependencies=[Depends(require_admin)])
async def admin_list_clippings(session: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    rows = await clip_svc.list_clippings(session)
    # 笔记被手动删掉时 post 就没了，前端据此把「查看文章」置灰而不是点出 404
    alive = set((await session.execute(select(Post.slug))).scalars().all())
    views: list[dict[str, Any]] = []
    for row in rows:
        slug = to_slug(Path(row.source_path).stem) if row.source_path else ""
        view = _clipping_view(row, slug)
        view["postExists"] = bool(slug) and slug in alive
        views.append(view)
    return views


@router.post("/admin/clippings", dependencies=[Depends(require_admin)])
async def admin_create_clipping(
    body: ClipBody, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """贴个链接就收藏。抓不到正文时前端会引导改成粘贴全文再提交。"""
    if CLIP_LOCK.locked():
        raise HTTPException(status_code=409, detail="上一条收藏还在处理，等它跑完再提交")
    async with CLIP_LOCK:
        try:
            return await clip_svc.run_clip(
                body.url, session=session, paste_text=body.paste, title=body.title, log=_clip_log
            )
        except clip_svc.ClipError as err:
            raise HTTPException(status_code=422, detail=str(err))


@router.delete("/admin/clippings/{clipping_id}", dependencies=[Depends(require_admin)])
async def admin_delete_clipping(
    clipping_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    row = (
        await session.execute(select(Clipping).where(Clipping.id == clipping_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="这条收藏已经不在了")
    return await clip_svc.remove_clipping(session, row)
