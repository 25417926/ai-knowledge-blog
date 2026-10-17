"""给缺向量的切分块补上（幂等）：CLI 与两个索引重建入口共用同一份实现。

为什么需要「重建之后自动补」：`import_vault` 每次都会把该文章的 chunk 删掉重插。
未改动的块已经由 `import_vault` 按「标题路径 + 正文」把旧向量继承回去，但
**新增/改过的块一定没有向量**。少了这一步，向量通道的覆盖率会随着编辑慢慢变低，
而且不报错——只是召回悄悄变差，谁也不会发现。

调用方拿到的永远是「尽力而为」：向量档没开或服务不可用就返回 0，不影响导入本身。
"""

from __future__ import annotations

import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Chunk, Post
from . import embedding

log = logging.getLogger(__name__)

BATCH = 32


async def load_rows(session: AsyncSession) -> list:
    """已发布的切分块（带正文与现有向量）。草稿不进检索，算了也没人用。"""
    stmt = (
        select(
            Chunk.id,
            Chunk.heading_path,
            Chunk.body,
            Chunk.embedding,
            Post.title,
        )
        .join(Post, Post.id == Chunk.post_id)
        .where(Post.status == "published")
        .order_by(Chunk.id)
    )
    return list((await session.execute(stmt)).all())


async def plan(session: AsyncSession, rebuild: bool = False) -> tuple[list, int]:
    """返回 (待补的块, 已有可用向量的块数)。"""
    rows = await load_rows(session)
    fresh = {r.id for r in rows if embedding.usable_for_current(r.embedding) is not None}
    todo = rows if rebuild else [r for r in rows if r.id not in fresh]
    return todo, len(fresh)


async def fill(session: AsyncSession, rows: list, on_progress=None) -> tuple[int, int]:
    """按批算向量并写库，返回 (写入条数, 维度)。

    某一批失败就抛 `EmbeddingError`：已写入的部分已提交（幂等，改好配置重跑会续上）。
    """
    written = 0
    vector_dim = 0
    for start in range(0, len(rows), BATCH):
        batch = rows[start : start + BATCH]
        texts = [
            embedding.chunk_text(r.title, r.heading_path or "", r.body or "") for r in batch
        ]
        vectors = await embedding.embed_texts(texts)
        for r, vec in zip(batch, vectors):
            await session.execute(
                update(Chunk).where(Chunk.id == r.id).values(embedding=embedding.pack_vector(vec))
            )
        await session.commit()
        written += len(batch)
        vector_dim = len(vectors[0]) if vectors else vector_dim
        if on_progress:
            on_progress(min(start + BATCH, len(rows)), len(rows))
    return written, vector_dim


async def fill_missing(session: AsyncSession) -> int:
    """重建索引之后调用：把这次新产生的、没有向量的块补齐。

    失败只记日志、返回 0——向量是检索的加分项，不该让一次保存文章或一次收藏失败。
    """
    if not embedding.ready():
        return 0
    try:
        todo, _ = await plan(session)
        if not todo:
            return 0
        written, _ = await fill(session, todo)
    except embedding.EmbeddingError as exc:
        await session.rollback()
        log.warning("补向量失败（不影响导入，下次重建索引会重试）：%s", exc)
        return 0
    log.info("索引重建后补了 %d 个块向量", written)
    return written
