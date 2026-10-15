"""初始化数据库：建表 + 角色/杂谈/说说种子 + Vault 导入。

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
    Chatter,
    Link,
    Moment,
    Post,
    PostTag,
    Tag,
    Chunk,
)
from sqlalchemy import select  # noqa: E402
from sqlalchemy.dialects.sqlite import insert  # noqa: E402

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")
CHUNK_SOFT_LIMIT = 800
MOODS = {"calm", "happy", "thinking", "tired", "emo"}


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

    for line in lines:
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


async def seed_chatter(session) -> int:
    directory = PROJECT_ROOT / "content" / "chatter"
    if not directory.exists():
        print("  · 未找到 content/chatter，跳过杂谈初始化")
        return 0
    files = sorted(p for p in directory.iterdir() if p.suffix.lower() == ".md")
    for path in files:
        post = frontmatter.loads(path.read_text(encoding="utf-8"))
        data, content = post.metadata, post.content
        slug = data.get("slug") or path.stem
        title = data.get("title") or path.stem
        mood = data.get("mood") or "calm"
        if mood not in MOODS:
            mood = "calm"
        tags = json.dumps(as_string_list(data.get("tags")), ensure_ascii=False)
        excerpt = data.get("excerpt") or re.sub(r"[#>*`\-\n]", " ", content).strip()[:80]
        stmt = (
            insert(Chatter)
            .values(
                slug=slug,
                title=title,
                excerpt=excerpt,
                content=content,
                mood=mood,
                tags=tags,
                cover=data.get("cover", ""),
                published_at=to_date(data.get("date")),
            )
            .on_conflict_do_update(
                index_elements=[Chatter.slug],
                set_={
                    "title": title,
                    "excerpt": excerpt,
                    "content": content,
                    "mood": mood,
                    "tags": tags,
                    "cover": data.get("cover", ""),
                    "published_at": to_date(data.get("date")),
                },
            )
        )
        await session.execute(stmt)
    await session.commit()
    return len(files)


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


async def import_vault(session, vault_dir: Path) -> dict:
    notes = collect_notes(vault_dir)
    stats = {"posts": 0, "tags": 0, "links": 0, "resolvedLinks": 0, "chunks": 0}

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
                    "updated_at": "datetime('now')",
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
        for index, chunk in enumerate(note["chunks"]):
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


async def main() -> None:
    print("▸ 初始化数据库")
    print(f"  路径：{DB_PATH}")
    await init_schema()
    print("  ✓ 建表完成")

    async with AsyncSessionLocal() as session:
        print(f"  ✓ 角色初始化完成，共 {await seed_agents(session)} 个 agent")
        print(f"  ✓ 杂谈初始化完成，共 {await seed_chatter(session)} 篇")
        print(f"  ✓ 说说初始化完成，新增 {await seed_moments(session)} 条")

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


if __name__ == "__main__":
    asyncio.run(main())
