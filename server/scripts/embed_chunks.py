"""给切分块补向量（幂等）。

**为什么不塞进 import_vault 自动跑**：导入必须能离线完成（没网也能把站建起来），
而向量要么要网络、要么要多跑一遍。所以拆成一条独立命令，
`python -m scripts.init_db --embed` 就是「导入 + 补向量」的合体写法。

用法（在 server 目录下）：

    python -m scripts.embed_chunks            # 只补缺的（NULL 或与当前 provider/维度不符）
    python -m scripts.embed_chunks --rebuild  # 全量重算（换了模型或维度之后）
    python -m scripts.embed_chunks --stats    # 只看现状，不写库
    python -m scripts.embed_chunks --provider hash   # 临时用本地字面近邻，不动 .env

只处理已发布文章：草稿不进检索，算了也没人用。
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time

from dotenv import load_dotenv

from app.database import AsyncSessionLocal, dispose_engine
from app.services import embedding
from app.services import embedding_job

BATCH = embedding_job.BATCH


def configure_from_env(provider: str | None = None, model: str | None = None) -> None:
    embedding.configure(
        provider or os.environ.get("EMBEDDING_PROVIDER", ""),
        os.environ.get("EMBEDDING_BASE_URL", ""),
        os.environ.get("EMBEDDING_API_KEY", ""),
        model or os.environ.get("EMBEDDING_MODEL", ""),
        os.environ.get("EMBEDDING_DIM", ""),
    )


async def run(rebuild: bool, stats_only: bool) -> int:
    info = embedding.describe()
    print(f"provider={info['provider']} model={info['model'] or '-'} dim={info['dim'] or '未定'}")
    if not info["ready"]:
        print("向量档未启用（EMBEDDING_PROVIDER=none 或配置不全），无从补向量。")
        print("试跑本地字面近邻：python -m scripts.embed_chunks --provider hash")
        return 1

    started = time.time()
    async with AsyncSessionLocal() as session:
        todo, fresh = await embedding_job.plan(session, rebuild)
        if not fresh and not todo:
            print("没有已发布的切分块，先跑 python -m scripts.init_db")
            await dispose_engine()
            return 1
        print(f"已发布切分块 {fresh + len(todo) if not rebuild else len(todo)} 个："
              f"可用向量 {fresh} 个，待补 {len(todo)} 个")
        if stats_only or not todo:
            if stats_only:
                print("（--stats：只看不写）")
            await dispose_engine()
            return 0

        def progress(done: int, total: int) -> None:
            print(f"\r  已写入 {done}/{total}", end="", flush=True)

        try:
            written, vector_dim = await embedding_job.fill(session, todo, on_progress=progress)
        except embedding.EmbeddingError as exc:
            print(f"\n批次失败：{exc}")
            print("已写入的部分保留（幂等，改好配置重跑即可续上）")
            await dispose_engine()
            return 1

    await dispose_engine()
    cost = time.time() - started
    print(f"\r完成：写入 {written} 个向量（维度 {vector_dim or '-'}），耗时 {cost:.1f}s")
    if rebuild:
        print("全量重算完毕。旧向量已被覆盖，且与当前 provider 对齐。")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="给切分块补向量（幂等）")
    parser.add_argument("--rebuild", action="store_true", help="全量重算，忽略已有向量")
    parser.add_argument("--stats", action="store_true", help="只看现状，不写库")
    parser.add_argument("--provider", default="", help="临时覆盖 EMBEDDING_PROVIDER（none/hash/openai）")
    parser.add_argument("--model", default="", help="临时覆盖 EMBEDDING_MODEL")
    args = parser.parse_args()

    load_dotenv()
    configure_from_env(args.provider or None, args.model or None)
    return asyncio.run(run(args.rebuild, args.stats))


if __name__ == "__main__":
    sys.exit(main())
