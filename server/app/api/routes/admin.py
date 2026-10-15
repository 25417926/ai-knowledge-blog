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

import hashlib
import hmac
import os
import time
from datetime import date
from pathlib import Path
from typing import Any

import frontmatter
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models import Post, PostTag, Tag
from ...services import agent_chat as svc
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


def _build_markdown(body: PostBody, title: str, day: str) -> str:
    """按 Vault 现有笔记的 frontmatter 风格组装文件内容。"""
    meta = {
        "title": title,
        "category": _safe_folder(body.category),
        "tags": [t.strip() for t in body.tags if t.strip()],
        "date": day,
        "summary": body.summary.strip(),
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

    path = _target_path(body, slug, existing)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_build_markdown(body, title, day), encoding="utf-8")

    # 重建索引：复用 vault 导入器，切分 / 双链 / 标签一次到位。
    # 全量重导也是**正确**选择——新文章的反向链接要靠「所有笔记一起解析」才能接上。
    stats = await import_vault(session, VAULT_DIR)
    if status != "published":
        await session.execute(
            Post.__table__.update().where(Post.slug == slug).values(status=status)
        )
        await session.commit()
    return {
        "ok": True,
        "slug": slug,
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


# ── 对话日志 ──────────────────────────────────────────


@router.get("/admin/logs", dependencies=[Depends(require_admin)])
async def admin_logs(
    limit: int = 60, session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    """直接复用阅读面板那份 read_log，字段与前端历史回放逐字一致。"""
    return await svc.read_log(session, SESSION_KEY, ASSISTANT_SLUG, max(1, min(limit, 200)))
