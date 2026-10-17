"""检索评估：同一批查询，跑「纯关键词」与「关键词 + 向量」，并排看差别。

存在的意义很具体——融合权重（VEC_WEIGHT / VEC_FLOOR）和「默认要不要开向量档」
都不能凭感觉定。改一次权重就跑一遍，看 hit@4 与 MRR 是涨还是跌；
跌了就说明这路信号在当前语料上是噪声，该关掉而不是调参。

用法（在 server 目录下，先把向量补齐）：

    python -m scripts.embed_chunks --provider hash
    python -m scripts.eval_retrieval --provider hash
    python -m scripts.eval_retrieval --provider hash --topk 4 --verbose

查询集分两类，缺一不可：
- **原词**：提问基本复述原文，关键词通道本来就该中——用来确认向量没把它带坏；
- **改写**：换了说法，关键词容易漏——这才是向量该补的地方。
只测原词会得出「向量没用」，只测改写会得出「向量万能」，两种都不诚实。
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

from dotenv import load_dotenv

from app.database import AsyncSessionLocal, dispose_engine
from app.models import Chunk, Post
from app.services import agent_chat, embedding
from sqlalchemy import select

# (查询, 期望命中的 slug 之一, 类型)
#
# 改写类是量出来的、不是编的：先逐条跑关键词通道，只留下「漏」与「排第 2~4」的问法。
# 与原文共享大量词组的问法在这里没有意义——关键词本来就中，测了只会得出「向量没用」。
QUERY_SET: list[tuple[str, set[str], str]] = [
    # ── 原词：关键词通道的主场，向量不许把答案挤下去
    ("JUC 线程池核心参数", {"juc-线程池核心参数"}, "原词"),
    ("JVM 内存结构与垃圾回收", {"jvm-内存结构与垃圾回收"}, "原词"),
    ("Nacos 配置中心 DataId 是什么", {"nacos-服务注册与配置中心"}, "原词"),
    ("Spring Cloud 五类治理能力", {"spring-cloud-服务治理全景"}, "原词"),
    ("余弦相似度的公式", {"向量检索与余弦相似度"}, "原词"),
    ("for 循环的 else 子句什么时候执行", {"clip-4-more-control-flow-tools"}, "原词"),
    # ── 改写：几乎不与原文共用词组，关键词通道实测漏或排后
    ("池子满了之后新来的活儿交给谁", {"juc-线程池核心参数"}, "改写"),
    ("队伍无限长会出什么事", {"java-并发编程知识地图", "juc-线程池核心参数"}, "改写"),
    ("接口被瞬时流量打爆怎么保护", {"spring-cloud-服务治理全景"}, "改写"),
    ("公司内部资料怎么让模型用上", {"rag-检索增强生成基础"}, "改写"),
    ("两段文字像不像用什么量", {"向量检索与余弦相似度"}, "改写"),
    ("活着的对象怎么判定", {"jvm-内存结构与垃圾回收"}, "改写"),
    ("怎么把一个不靠谱的模型做成能上线的系统", {"agent-工程师能力模型"}, "改写"),
    ("一条请求从进门到落地都经过哪些环节", {"spring-cloud-服务治理全景"}, "改写"),
    ("多个服务实例地址变了怎么办", {"nacos-服务注册与配置中心"}, "改写"),
    ("别人问起并发，我该从哪几条线回答", {"java-并发编程知识地图"}, "改写"),
]


def configure_from_env(provider: str) -> None:
    embedding.configure(
        provider,
        os.environ.get("EMBEDDING_BASE_URL", ""),
        os.environ.get("EMBEDDING_API_KEY", ""),
        os.environ.get("EMBEDDING_MODEL", ""),
        os.environ.get("EMBEDDING_DIM", ""),
    )


async def run_one(query: str, topk: int) -> list[dict]:
    async with AsyncSessionLocal() as session:
        return await agent_chat.retrieve(session, query, topk)


async def vector_coverage() -> int:
    stmt = (
        select(Chunk.embedding)
        .join(Post, Post.id == Chunk.post_id)
        .where(Post.status == "published")
    )
    async with AsyncSessionLocal() as session:
        blobs = (await session.execute(stmt)).scalars().all()
    return sum(1 for b in blobs if embedding.usable_for_current(b) is not None)


async def evaluate(provider: str, topk: int, verbose: bool) -> int:
    configure_from_env("none")
    baseline: dict[str, list[dict]] = {}
    for query, _, _ in QUERY_SET:
        baseline[query] = await run_one(query, topk)

    configure_from_env(provider)
    info = embedding.describe()
    if not info["ready"]:
        print(f"向量档未启用：provider={info['provider']}")
        await dispose_engine()
        return 1
    covered = await vector_coverage()
    hybrid: dict[str, list[dict]] = {}
    for query, _, _ in QUERY_SET:
        hybrid[query] = await run_one(query, topk)

    def rank(rows: list[dict], expected: set[str]) -> int:
        """返回第一条命中期望文章的位次（1 起），没中就 0。"""
        for i, row in enumerate(rows, start=1):
            if row["post_slug"] in expected:
                return i
        return 0

    print(
        f"provider={info['provider']} model={info['model']} dim={info['dim'] or '-'} "
        f"可用向量 {covered} 条 · 查询 {len(QUERY_SET)} 条 · top{topk}\n"
    )
    header = f"{'查询':<26}{'类型':<5}{'关键词':>8}{'混合':>8}  变化"
    print(header)
    print("-" * (len(header) + 12))

    stats = {"kw_hit": 0, "hy_hit": 0, "kw_mrr": 0.0, "hy_mrr": 0.0}
    for query, expected, kind in QUERY_SET:
        kr = rank(baseline[query], expected)
        hr = rank(hybrid[query], expected)
        stats["kw_hit"] += 1 if kr else 0
        stats["hy_hit"] += 1 if hr else 0
        stats["kw_mrr"] += 1 / kr if kr else 0.0
        stats["hy_mrr"] += 1 / hr if hr else 0.0
        delta = "=" if kr == hr else (f"↑ 第{kr or '—'}→第{hr}" if (hr and (not kr or hr < kr)) else f"↓ 第{kr}→第{hr or '未中'}")
        print(f"{query[:24]:<26}{kind:<5}{kr or '未中':>8}{hr or '未中':>8}  {delta}")
        if verbose:
            for tag, rows in (("kw", baseline[query]), ("hy", hybrid[query])):
                for i, row in enumerate(rows, start=1):
                    mark = "*" if row["post_slug"] in expected else " "
                    print(
                        f"    {tag} {i}. {mark}{row['score']:>6.3f} "
                        f"(kw {row['kw_score']:>5.2f} / vec {row['vec_score']:>5.3f}) "
                        f"{row['post_slug'][:34]}"
                    )

    n = len(QUERY_SET)
    print("-" * (len(header) + 12))
    print(f"{'命中率':<34}关键词 {stats['kw_hit']}/{n}   混合 {stats['hy_hit']}/{n}")
    print(f"{'MRR':<35}关键词 {stats['kw_mrr'] / n:.3f}   混合 {stats['hy_mrr'] / n:.3f}")

    # 分开报：向量该救的是改写，不是原词
    for kind in ("原词", "改写"):
        rows = [(q, e) for q, e, k in QUERY_SET if k == kind]
        kh = sum(1 for q, e in rows if rank(baseline[q], e))
        hh = sum(1 for q, e in rows if rank(hybrid[q], e))
        print(f"  · {kind}（{len(rows)} 条）：关键词 {kh}  混合 {hh}")

    await dispose_engine()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="检索评估：关键词 vs 混合")
    parser.add_argument("--provider", default="", help="对比用的 provider（默认取 .env）")
    parser.add_argument("--topk", type=int, default=4)
    parser.add_argument("--verbose", action="store_true", help="逐条打印候选与分数")
    args = parser.parse_args()
    load_dotenv()
    provider = args.provider or os.environ.get("EMBEDDING_PROVIDER", "") or "hash"
    return asyncio.run(evaluate(provider, args.topk, args.verbose))


if __name__ == "__main__":
    sys.exit(main())
