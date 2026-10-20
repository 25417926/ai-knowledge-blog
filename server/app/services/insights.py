"""访客意图聚合：把「原始对话日志」压成「他们在找什么」。

日志本身（`/admin/logs`）回答的是「刚刚发生了什么」，回答不了两个更要紧的问题：
**哪几件事被反复问（值得写清楚）、哪些问题问了却答不上（内容缺口在哪）**。
这里只做聚合，不写库、不改库——输入是一批已经落库的提问，输出是几组排好序的视图。

三个刻意的判断：

1. **「零引用」不能直接等于「内容缺口」。** 寒暄（"你好"、"你是谁"）本来就不该有引用，
   混进来会把缺口列表冲成一片废话。所以缺口只收**信息类**意图，寒暄单独归到 `chitchat`。
2. **高频问题先聚类再计数。** "向量怎么接" 与 "怎么接向量" 是同一个问题，按原字符串分组
   会把它拆成两条各 1 次，看起来像「什么都只问一次」。聚类用词集 Jaccard + 同一意图双闸门：
   只看相似度会把「怎么做 X」和「为什么 X」并成一条，而它们是两个不同的缺口。
3. **不引 LLM。** 段位定死在「可解释」上：聚类是词重叠、意图是关键词规则，
   每一条结论都能指着两句话说明为什么归在一起。要更聪明的归组，另开一档再谈。

聚合结果里所有数值都由输入决定，不含当前时间——`window` 的 from/to 也只取数据里的时间戳，
这样同一份日志在任何时候跑都得到同一份输出，可以写死断言。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from .keyword import token_set

# ── 意图规则 ──────────────────────────────────────────
#
# 顺序即优先级，先命中先归类。为什么是这个顺序：
# - 寒暄必须最先挡掉，否则"你好，我想问下 RAG" 会被后面某条规则吃掉；
# - `compare` 先于 `howto`：带"区别/对比"的句子几乎总在问二元关系，
#   而"怎么区分"里的"怎么"只是措辞；
# - `howto` 先于 `overview`：`overview` 的触发词（"是什么"、"讲什么"）太泛，
#   放在前面会把"怎么理解什么是向量"判成概览。

INTENTS: list[tuple[str, str, str]] = [
    ("chitchat", "寒暄闲聊", r"^(你好|您好|hi|hello|哈喽|在吗|在不在|谢谢|多谢|辛苦了|你是谁|你叫什么|早上好|晚上好)"),
    ("compare", "对比取舍", r"区别|差别|差异|对比|相比|哪个好|哪个更|优劣|不同|vs\b|还是"),
    ("why", "原理解释", r"为什么|为何|原因|原理|怎么会|凭什么|导致"),
    ("howto", "怎么做", r"怎么|如何|怎样|步骤|配置|安装|部署|搭建|实现|写法|用法|上手|流程|接入|接上"),
    ("overview", "是什么", r"是什么|什么是|讲什么|讲了什么|概览|介绍|总结|大纲|主要内容|梳理|有什么用"),
    ("where", "找资料", r"哪篇|哪一章|哪一节|哪里|在哪|哪个文件|找一下|有没有|搜一下|出处"),
    ("other", "其他", r""),
]

INTENT_LABEL = {key: label for key, label, _ in INTENTS}
INFORMATIVE = {key for key, _, _ in INTENTS if key != "chitchat"}

COMPILED = [(key, re.compile(pattern, re.IGNORECASE)) for key, _, pattern in INTENTS]

# 句尾语气与标点不参与聚类：`"怎么接向量？"` 与 `"怎么接向量"` 是同一句
_TRAILING = " \t\r\n？?！!。.，,；;：:~～…、"


# ── 输入 ──────────────────────────────────────────────


@dataclass(frozen=True)
class Question:
    """一次提问。`citations` 是这一次回答引到的文章 slug（可能为空）。"""

    turn_id: int
    session_id: str
    text: str
    asked_at: str
    citations: tuple[str, ...] = ()
    latency_ms: int = 0


@dataclass
class Cluster:
    """一组说法不同、问的是同一件事的提问。"""

    intent: str
    ids: list[int] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)
    cited: int = 0
    first_at: str = ""
    last_at: str = ""
    slugs: set[str] = field(default_factory=set)

    @property
    def count(self) -> int:
        return len(self.ids)


# ── 纯函数 ────────────────────────────────────────────


def stamp(value: object) -> str:
    """把 datetime / ISO 串统一成 `YYYY-MM-DD HH:MM:SS`，只用于展示与排序。"""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    text = str(value or "")
    return text[:19].replace("T", " ")


def normalize(text: str) -> str:
    """去掉首尾空白与句末标点，用来判「同一句话」。中间标点不动——它可能改变语义。"""
    return (text or "").strip().strip(_TRAILING)


def classify_intent(text: str) -> str:
    """关键词规则分流。返回 `INTENTS` 里的 key，未命中即 `other`。"""
    clean = normalize(text)
    for key, pattern in COMPILED:
        if pattern.search(clean):
            return key
    return "other"


def similarity(a: str, b: str) -> float:
    """两句提问的词集 Jaccard。都取不出词（纯符号）时按"不同"处理。"""
    left, right = token_set(a), token_set(b)
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def cluster_questions(questions: list[Question], threshold: float = 0.5) -> list[Cluster]:
    """贪心聚类：按提问时间顺序，逐条并入第一个「同意图且足够像」的簇。

    以时间顺序（而不是先按相似度两两贪心）遍历的好处：簇的代表句是**最早**那一次问法，
    读者看到的是"当初怎么问的"，而不是后来某种更啰嗦的改写。
    """
    clusters: list[Cluster] = []
    ordered = sorted(questions, key=lambda q: (q.asked_at, q.turn_id))
    for q in ordered:
        intent = classify_intent(q.text)
        near = None
        for c in clusters:
            if c.intent != intent:
                continue
            if similarity(c.texts[0], q.text) >= threshold:
                near = c
                break
        if near is None:
            clusters.append(
                Cluster(
                    intent=intent,
                    ids=[q.turn_id],
                    texts=[q.text],
                    cited=1 if q.citations else 0,
                    first_at=q.asked_at,
                    last_at=q.asked_at,
                    slugs=set(q.citations),
                )
            )
            continue
        near.ids.append(q.turn_id)
        near.texts.append(q.text)
        near.cited += 1 if q.citations else 0
        near.last_at = max(near.last_at, q.asked_at)
        near.slugs |= set(q.citations)
    return clusters


def representative(cluster: Cluster) -> str:
    """簇的代表问法：出现次数最多的那个说法，平手取最早出现的。"""
    tally: dict[str, int] = {}
    first: dict[str, int] = {}
    for i, text in enumerate(cluster.texts):
        key = normalize(text)
        tally[key] = tally.get(key, 0) + 1
        first.setdefault(key, i)
    return min(tally, key=lambda t: (-tally[t], first[t]))


def _rate(part: int, whole: int) -> float:
    return round(part / whole, 3) if whole else 0.0


def summarize(
    questions: list[Question],
    titles: dict[str, str] | None = None,
    top: int = 8,
    gap_limit: int = 12,
) -> dict:
    """把提问列表压成前端直接能画的结构。空输入返回零值骨架，不抛异常。"""
    titles = titles or {}
    rows = [q for q in questions if normalize(q.text)]
    total = len(rows)

    window = {
        "questions": total,
        "sessions": len({q.session_id for q in rows}),
        "from": min((q.asked_at for q in rows), default=""),
        "to": max((q.asked_at for q in rows), default=""),
    }
    cited = sum(1 for q in rows if q.citations)
    latency = [q.latency_ms for q in rows if q.latency_ms > 0]
    totals = {
        "questions": total,
        "withCitation": cited,
        "zeroCitation": total - cited,
        "citationRate": _rate(cited, total),
        "avgLatencyMs": int(sum(latency) / len(latency)) if latency else 0,
        "avgCitations": round(sum(len(q.citations) for q in rows) / total, 2) if total else 0.0,
    }

    clusters = cluster_questions(rows)

    # 意图分布：只出出现过的意图，保持 INTENTS 的固定顺序（图例不会每次换位置）
    intents = []
    for key, label, _ in INTENTS:
        bucket = [q for q in rows if classify_intent(q.text) == key]
        if not bucket:
            continue
        intents.append(
            {
                "key": key,
                "label": label,
                "count": len(bucket),
                "share": _rate(len(bucket), total),
                "citationRate": _rate(sum(1 for q in bucket if q.citations), len(bucket)),
                "samples": [normalize(q.text) for q in bucket[:3]],
            }
        )

    ranked = sorted(
        (c for c in clusters if c.intent in INFORMATIVE),
        key=lambda c: (c.count, c.last_at),
        reverse=True,
    )
    top_clusters = [
        {
            "question": representative(c),
            "intent": c.intent,
            "intentLabel": INTENT_LABEL[c.intent],
            "count": c.count,
            "citationRate": _rate(c.cited, c.count),
            "lastAskedAt": c.last_at,
            "variants": [
                t
                for t in dict.fromkeys(normalize(x) for x in c.texts)
                if t != representative(c)
            ][:4],
            "posts": [{"slug": s, "title": titles.get(s, s)} for s in sorted(c.slugs)][:4],
        }
        for c in ranked[:top]
    ]

    # 内容缺口：问了、但一条引用都没有的信息类问题。
    #
    # 这里**再聚一次类**，而不是复用上面那批簇：上面那批混着引用成功的问法，
    # 一个簇里可能一半有引用一半没有，缺口该按「没被回答的那几次」重新归组。
    # 寒暄不进缺口（见模块开头第 1 条），也不进上面的高频问题——它们不是内容主题。
    gap_clusters = cluster_questions(
        [q for q in rows if not q.citations and classify_intent(q.text) in INFORMATIVE]
    )
    gap_list = sorted(gap_clusters, key=lambda c: (c.count, c.last_at), reverse=True)
    gaps = [
        {
            "question": representative(c),
            "intent": c.intent,
            "intentLabel": INTENT_LABEL[c.intent],
            "times": c.count,
            "firstAskedAt": c.first_at,
            "lastAskedAt": c.last_at,
            "variants": [
                t
                for t in dict.fromkeys(normalize(x) for x in c.texts)
                if t != representative(c)
            ][:4],
        }
        for c in gap_list[:gap_limit]
    ]

    # 被问到的文章：引用次数与"被几次问答引用"分开数——同一篇被同一次问答引 3 段，
    # 说明的是那一篇讲得深，不代表三个访客都在找它。
    per_post: dict[str, dict] = {}
    for q in rows:
        for slug in set(q.citations):
            row = per_post.setdefault(
                slug, {"slug": slug, "title": titles.get(slug, slug), "citations": 0, "questions": 0}
            )
            row["questions"] += 1
            row["citations"] += sum(1 for s in q.citations if s == slug)
    posts = sorted(per_post.values(), key=lambda p: (p["questions"], p["citations"]), reverse=True)

    return {
        "window": window,
        "totals": totals,
        "intents": intents,
        "clusters": top_clusters,
        "gaps": gaps,
        "posts": posts[:top],
    }
