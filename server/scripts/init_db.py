"""初始化数据库：建表 + 角色/说说种子 + Vault 导入。

对应 Node 版 scripts/db-init.ts 与 scripts/vault-import.ts，一条命令做完两件事：

    python -m scripts.init_db

幂等：重复跑只会更新，不会堆重复数据（说说按内容判重，与 Node 版一致）。
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = SERVER_DIR.parent
sys.path.insert(0, str(SERVER_DIR))

import frontmatter  # noqa: E402

from app.database import DB_PATH, init_schema, AsyncSessionLocal  # noqa: E402
from app.models import (  # noqa: E402
    Agent,
    Clipping,
    Friend,
    Link,
    Moment,
    Post,
    PostTag,
    Tag,
    Chunk,
)
from sqlalchemy import select, text  # noqa: E402
from sqlalchemy.dialects.sqlite import insert  # noqa: E402

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")
CHUNK_SOFT_LIMIT = 800
CLIP_INDEX_SECTION = "原文存档"  # 收藏稿原文 chunk 的段落前缀，与笔记里的总结区分开


def to_slug(value: str) -> str:
    text = value.strip()
    text = re.sub(r"\.md$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[\s/\\]+", "-", text)
    text = re.sub(r"[^\w\-\u4e00-\u9fa5]", "", text, flags=re.UNICODE)
    text = re.sub(r"-{2,}", "-", text)
    return text.strip("-").lower()


def to_date(value: object) -> str | None:
    """frontmatter 的 date 归一成 YYYY-MM-DD，避免 Date 对象参与排序。"""
    if value is None or value == "":
        return None
    if isinstance(value, str):
        iso = re.match(r"^(\d{4}-\d{2}-\d{2})", value)
        if iso:
            return iso.group(1)
    from datetime import date, datetime

    parsed = value if isinstance(value, (datetime, date)) else datetime(str(value))
    if parsed.year == 1:
        return None
    return f"{parsed.year:04d}-{parsed.month:02d}-{parsed.day:02d}"


def as_string_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return [v.strip() for v in re.split(r"[,，]", value) if v.strip()]
    return []


# ── Vault 解析（vault.ts 移植） ──────────────────────────


def split_chunks(markdown: str) -> list[dict]:
    lines = markdown.split("\n")
    sections: list[dict] = []
    stack: list[dict] = []
    buffer: list[str] = []

    def flush() -> None:
        body = "\n".join(buffer).strip()
        if body:
            sections.append(
                {
                    "headingPath": " > ".join(h["text"] for h in stack),
                    "lines": re.split(r"\n{2,}", body),
                }
            )
        buffer.clear()

    fence = ""  # 当前处在 ``` / ~~~ 围栏里时记着围栏字符，出围栏前不认标题
    for line in lines:
        marker = re.match(r"^\s{0,3}(```+|~~~+)", line)
        if marker:
            char = marker.group(1)[0]
            fence = "" if fence == char else (fence or char)
            buffer.append(line)
            continue
        if fence:
            buffer.append(line)
            continue
        heading = re.match(r"^(#{1,3})\s+(.+?)\s*$", line)
        if heading:
            flush()
            level = len(heading.group(1))
            stack = [h for h in stack if h["level"] < level]
            stack.append({"level": level, "text": heading.group(2).strip()})
            continue
        buffer.append(line)
    flush()

    chunks: list[dict] = []
    for section in sections:
        current = ""
        for paragraph in section["lines"]:
            if current and len(current) + len(paragraph) > CHUNK_SOFT_LIMIT:
                chunks.append({"headingPath": section["headingPath"], "body": current.strip()})
                current = ""
            current += (f"\n\n{paragraph}" if current else paragraph)
        if current.strip():
            chunks.append({"headingPath": section["headingPath"], "body": current.strip()})
    return chunks


def parse_note(abs_path: Path, root_dir: Path) -> dict:
    raw = abs_path.read_text(encoding="utf-8")
    post = frontmatter.loads(raw)
    data, content = post.metadata, post.content
    rel_path = abs_path.relative_to(root_dir).as_posix()
    basename = abs_path.stem
    slug = to_slug(data.get("slug") or basename)
    title = data.get("title") or basename

    folder = abs_path.parent.relative_to(root_dir).as_posix()
    folder = "" if folder == "." else folder
    category = data.get("category") or (folder.split("/")[0] if folder else "未分类")

    return {
        "slug": slug,
        "aliases": list(dict.fromkeys([slug, to_slug(basename), title])),
        "title": title,
        "summary": data.get("summary", ""),
        "category": category,
        "tags": as_string_list(data.get("tags")),
        "content": content,
        "sourcePath": rel_path,
        "wordCount": len(re.sub(r"\s", "", content)),
        "publishedAt": to_date(data.get("date")),
        "links": [m.group(1).strip() for m in WIKILINK_RE.finditer(content)],
        "chunks": split_chunks(content),
    }


def collect_notes(root_dir: Path) -> list[dict]:
    notes = [
        parse_note(p, root_dir)
        for p in sorted(root_dir.rglob("*.md"))
        if not any(part.startswith(".") for part in p.relative_to(root_dir).parts)
    ]
    return sorted(notes, key=lambda n: n["slug"])


# ── 导入逻辑 ──────────────────────────


async def seed_agents(session) -> int:
    file = PROJECT_ROOT / "content" / "town" / "agents.json"
    if not file.exists():
        print("  · 未找到 content/town/agents.json，跳过角色初始化")
        return 0
    data = json.loads(file.read_text(encoding="utf-8"))
    agents = data["agents"] if isinstance(data, dict) else data
    for a in agents:
        stmt = (
            insert(Agent)
            .values(
                kind=a.get("kind", "npc"),
                slug=a["slug"],
                name=a["name"],
                persona=a.get("persona", ""),
                avatar=a.get("avatar", ""),
                location=a.get("location", ""),
                meta=json.dumps(a.get("meta", {}), ensure_ascii=False),
            )
            .on_conflict_do_update(
                index_elements=[Agent.slug],
                set_={
                    "kind": a.get("kind", "npc"),
                    "name": a["name"],
                    "persona": a.get("persona", ""),
                    "avatar": a.get("avatar", ""),
                    "location": a.get("location", ""),
                    "meta": json.dumps(a.get("meta", {}), ensure_ascii=False),
                },
            )
        )
        await session.execute(stmt)
    await session.commit()
    return len(agents)


async def seed_moments(session) -> int:
    file = PROJECT_ROOT / "content" / "moments.json"
    if not file.exists():
        print("  · 未找到 content/moments.json，跳过说说初始化")
        return 0
    items = json.loads(file.read_text(encoding="utf-8"))
    inserted = 0
    for item in items:
        exists = (
            await session.execute(select(Moment.id).where(Moment.content == item["content"]))
        ).scalar_one_or_none()
        if exists is not None:
            continue
        session.add(
            Moment(
                content=item["content"],
                images=json.dumps(item.get("images", []), ensure_ascii=False),
                location=item.get("location", ""),
                reaction_count=item.get("reactionCount", 0),
                published_at=to_date(item.get("publishedAt")),
            )
        )
        inserted += 1
    await session.commit()
    return inserted


async def seed_friends(session) -> int:
    """友链种子。

    **只在表为空时灌**：友链上线后就归后台 /admin/friends 管，
    若像说说那样「按内容去重补充」，在后台删掉的条目会被下一次 init_db 变回来。
    """
    file = PROJECT_ROOT / "content" / "friends.json"
    if not file.exists():
        print("  · 未找到 content/friends.json，跳过友链初始化")
        return 0
    existing = (await session.execute(select(Friend.id).limit(1))).scalar_one_or_none()
    if existing is not None:
        return 0
    items = json.loads(file.read_text(encoding="utf-8"))
    for item in items:
        session.add(
            Friend(
                name=item["name"],
                href=item["href"],
                description=item.get("description", ""),
                tags=json.dumps(item.get("tags", []), ensure_ascii=False),
            )
        )
    await session.commit()
    return len(items)


async def import_vault(session, vault_dir: Path) -> dict:
    notes = collect_notes(vault_dir)
    stats = {"posts": 0, "tags": 0, "links": 0, "resolvedLinks": 0, "chunks": 0}

    # 收藏稿的原文不写在笔记里（见 scripts/clip.py），只落在 clippings.index_text。
    # 这里按 source_path 取回来补成 chunk：问原文细节检索得到，笔记与页面仍是总结。
    clip_index = {
        row.source_path: row.index_text
        for row in (
            await session.execute(select(Clipping.source_path, Clipping.index_text))
        ).all()
        if row.index_text
    }

    for note in notes:
        stmt = (
            insert(Post)
            .values(
                slug=note["slug"],
                title=note["title"],
                summary=note["summary"],
                category=note["category"],
                content=note["content"],
                status="published",
                source_path=note["sourcePath"],
                word_count=note["wordCount"],
                published_at=note["publishedAt"],
            )
            .on_conflict_do_update(
                index_elements=[Post.slug],
                set_={
                    "title": note["title"],
                    "summary": note["summary"],
                    "category": note["category"],
                    "content": note["content"],
                    "source_path": note["sourcePath"],
                    "word_count": note["wordCount"],
                    "published_at": note["publishedAt"],
                    # text() 包一下：裸字符串会被当绑定参数，DateTime 列直接拒收
                    "updated_at": text("datetime('now')"),
                },
            )
        )
        await session.execute(stmt)
        post_id = (
            await session.execute(select(Post.id).where(Post.slug == note["slug"]))
        ).scalar_one()
        stats["posts"] += 1

        # 标签：先清后建，与 Node 版 clearTags + linkTag 等价
        await session.execute(PostTag.__table__.delete().where(PostTag.post_id == post_id))
        for tag_name in note["tags"]:
            tag_slug = to_slug(tag_name)
            if not tag_slug:
                continue
            await session.execute(
                insert(Tag).values(name=tag_name, slug=tag_slug).on_conflict_do_nothing()
            )
            tag_id = (
                await session.execute(select(Tag.id).where(Tag.slug == tag_slug))
            ).scalar_one()
            await session.execute(
                insert(PostTag).values(post_id=post_id, tag_id=tag_id).on_conflict_do_nothing()
            )

        await session.execute(Link.__table__.delete().where(Link.source_post_id == post_id))
        for target in note["links"]:
            await session.execute(
                insert(Link).values(source_post_id=post_id, target_slug=target)
            )
            stats["links"] += 1

        await session.execute(Chunk.__table__.delete().where(Chunk.post_id == post_id))
        chunks = list(note["chunks"])
        origin = clip_index.get(note["sourcePath"])
        if origin:
            # 原文 chunk 接在笔记 chunk 之后，heading 挂上「原文存档 >」便于出处卡片辨认
            chunks += [
                {
                    "headingPath": (
                        f"{CLIP_INDEX_SECTION} > {c['headingPath']}"
                        if c["headingPath"]
                        else CLIP_INDEX_SECTION
                    ),
                    "body": c["body"],
                }
                for c in split_chunks(origin)
            ]
        for index, chunk in enumerate(chunks):
            await session.execute(
                insert(Chunk).values(
                    post_id=post_id,
                    ord=index,
                    heading_path=chunk["headingPath"],
                    body=chunk["body"],
                )
            )
            stats["chunks"] += 1

    # 双链解析：slug / 标题 / 别名都算命中
    alias_to_id: dict[str, int] = {}
    for note in notes:
        post_id = (
            await session.execute(select(Post.id).where(Post.slug == note["slug"]))
        ).scalar_one()
        for alias in note["aliases"]:
            alias_to_id.setdefault(alias, post_id)
    for note in notes:
        source_id = (
            await session.execute(select(Post.id).where(Post.slug == note["slug"]))
        ).scalar_one()
        for target in note["links"]:
            target_id = alias_to_id.get(target) or alias_to_id.get(to_slug(target))
            if target_id is None:
                continue
            await session.execute(
                Link.__table__.update()
                .where(Link.source_post_id == source_id, Link.target_slug == target)
                .values(target_post_id=target_id)
            )
            stats["resolvedLinks"] += 1

    await session.commit()
    stats["tags"] = (
        await session.execute(select(Tag.id))
    ).scalars().all().__len__()
    return stats


async def main(embed: bool = False) -> None:
    print("▸ 初始化数据库")
    print(f"  路径：{DB_PATH}")
    await init_schema()
    print("  ✓ 建表完成")

    async with AsyncSessionLocal() as session:
        print(f"  ✓ 角色初始化完成，共 {await seed_agents(session)} 个 agent")
        print(f"  ✓ 说说初始化完成，新增 {await seed_moments(session)} 条")
        print(f"  ✓ 友链初始化完成，新增 {await seed_friends(session)} 条")

        vault_dir = PROJECT_ROOT / "content" / "sample-vault"
        if not vault_dir.exists():
            print("  · 未找到 content/sample-vault，跳过 Vault 导入")
            return
        print(f"▸ 导入 Obsidian Vault\n  目录：{vault_dir}")
        stats = await import_vault(session, vault_dir)
        print(
            f"  ✓ 文章 {stats['posts']} 篇 · 标签 {stats['tags']} 个 · "
            f"切分块 {stats['chunks']} 个 · 双链 {stats['links']} 条"
            f"（可解析 {stats['resolvedLinks']} 条）"
        )
        if stats["links"] > stats["resolvedLinks"]:
            print(f"  ! 有 {stats['links'] - stats['resolvedLinks']} 条双链指向不存在的笔记")

    if embed:
        # 导入会重建切分块，向量跟着一起没了 —— 所以补向量只能放在导入之后。
        # 不开 --embed 时只提示一句：导入要能离线跑完，向量是可选的后置步骤。
        from . import embed_chunks

        embed_chunks.configure_from_env()
        print("▸ 补向量")
        await embed_chunks.run(rebuild=False, stats_only=False)
    else:
        print("  · 向量档未处理（需要时跑 python -m scripts.embed_chunks，或加 --embed）")


if __name__ == "__main__":
    asyncio.run(main("--embed" in sys.argv[1:]))
