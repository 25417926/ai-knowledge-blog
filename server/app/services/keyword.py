"""中文二元组 + 英文词的分词，以及「文档 vs 文档」重合度。

问答检索（`agent_chat.retrieve`）与相关文章召回（`content.related_posts`）**共用这里的分词**。
分词规则一旦漂移，同一条查询会在问答里命中、在相关推荐里不命中——不报错，只是悄悄变差，
所以只留一份实现。

打分公式则各留各的，因为它们问的不是同一件事：
检索是「查询 vs 切分块」（标题 3.0 / 小节 1.6 / 正文 1.0 加权），
相关推荐是「文档 vs 文档」（对称，两个方向算出来必须一样）。
"""

from __future__ import annotations

import math
import re

PARTICLES = set("的了是在和与就都而及或吗呢吧啊着过很也还个之其并")
STOPWORDS = {
    "的", "了", "是", "在", "和", "与", "就", "都", "而", "及", "或", "一个",
    "什么", "怎么", "如何", "哪些", "哪个", "为什么", "这个", "那个", "可以",
}


def tokenize(text: str) -> list[str]:
    lowered = text.lower()
    tokens: list[str] = []
    tokens.extend(re.findall(r"[a-z0-9][a-z0-9+#._-]*", lowered))
    for run in re.split(r"[^一-鿿]+", lowered):
        if not run:
            continue
        if len(run) == 1:
            tokens.append(run)
            continue
        for i in range(len(run) - 1):
            pair = run[i : i + 2]
            if pair[0] in PARTICLES or pair[1] in PARTICLES:
                continue
            tokens.append(pair)
    return [t for t in tokens if len(t) > 1 and t not in STOPWORDS]


def token_set(text: str) -> set[str]:
    """词集：算重合度只关心「有没有」，重复出现不再加分。"""
    return set(tokenize(text))


def idf_table(docs: list[set[str]]) -> dict[str, float]:
    """token → log(1 + 文档数 / 含该词的文档数)。出现得越少越有区分度。"""
    total = len(docs)
    freq: dict[str, int] = {}
    for tokens in docs:
        for token in tokens:
            freq[token] = freq.get(token, 0) + 1
    return {t: math.log(1 + total / n) for t, n in freq.items()}


def overlap(a: set[str], b: set[str], idf: dict[str, float]) -> float:
    """两个词集的 IDF 加权余弦重合度，0 = 一个共同词都没有。

    对称（`overlap(a, b) == overlap(b, a)`），取值天然落在 [0, 1]：
    同量级才能和「共同标签」这类计数信号放进同一个分数里。
    """
    shared = a & b
    if not shared:
        return 0.0
    norm_a = math.sqrt(sum(idf.get(t, 0.0) ** 2 for t in a))
    norm_b = math.sqrt(sum(idf.get(t, 0.0) ** 2 for t in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return sum(idf.get(t, 0.0) for t in shared) / (norm_a * norm_b)
