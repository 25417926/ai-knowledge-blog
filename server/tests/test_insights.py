"""访客意图聚合的纯函数：不连库、不连网、不读配置。

这组守的是**判断标准**，不是 SQL：哪两句话算同一个问题、哪些问题算内容缺口、
"你好" 会不会污染缺口列表。聚合是给人看的，错得很隐蔽——把同一件事拆成两条各 1 次，
看起来就是"什么都没人问"；把寒暄放进缺口，列表里就全是废话。这些都只能靠定死用例来守。
"""

from app.services.insights import (
    INTENT_LABEL,
    Question,
    classify_intent,
    cluster_questions,
    normalize,
    representative,
    similarity,
    summarize,
)


def q(tid: int, text: str, at: str, cites: tuple[str, ...] = (), ms: int = 0, session: str = "s1"):
    return Question(turn_id=tid, session_id=session, text=text, asked_at=at, citations=cites, latency_ms=ms)


class TestNormalize:
    def test_strips_trailing_punctuation(self):
        assert normalize("怎么接向量？") == "怎么接向量"
        assert normalize("怎么接向量！！") == "怎么接向量"
        assert normalize("怎么接向量。") == "怎么接向量"

    def test_keeps_inner_punctuation(self):
        # 中间的问号/逗号可能改变语义，不动
        assert normalize("工程化, 还是平台化") == "工程化, 还是平台化"

    def test_blank_becomes_empty(self):
        assert normalize("   \n ") == ""


class TestClassifyIntent:
    def test_greeting_wins_over_later_keywords(self):
        # 寒暄必须最先挡掉，否则"我想问下"会被别的规则吃掉
        assert classify_intent("你好，我想问下向量检索怎么接") == "chitchat"
        assert classify_intent("谢谢") == "chitchat"

    def test_compare(self):
        assert classify_intent("双链和图谱的区别") == "compare"
        assert classify_intent("关键词检索与向量检索哪个好") == "compare"

    def test_why(self):
        assert classify_intent("为什么要减均值") == "why"

    def test_howto(self):
        assert classify_intent("向量检索怎么接") == "howto"
        assert classify_intent("部署流程") == "howto"

    def test_overview(self):
        assert classify_intent("RAG 是什么") == "overview"
        assert classify_intent("这篇讲了什么") == "overview"

    def test_where(self):
        assert classify_intent("讲热力图的是哪篇") == "where"

    def test_other_fallback(self):
        assert classify_intent("本地模型") == "other"

    def test_every_key_has_a_label(self):
        for text in ["你好", "区别", "为什么", "怎么", "是什么", "哪篇", "本地模型"]:
            key = classify_intent(text)
            assert INTENT_LABEL[key]


class TestSimilarity:
    def test_reordered_question_is_similar(self):
        # 只要过得了聚类闸门（0.5）就算同一句：这里是 2/3 左右，正好压线之上
        assert similarity("向量检索怎么接", "怎么接向量检索") >= 0.6

    def test_different_topics_are_not(self):
        assert similarity("向量检索怎么接", "友链怎么加") < 0.3

    def test_empty_token_set_is_zero(self):
        assert similarity("？？？", "向量检索") == 0.0


class TestCluster:
    def test_paraphrases_merge(self):
        clusters = cluster_questions(
            [
                q(1, "向量检索怎么接", "2026-10-19 10:00:00"),
                q(2, "怎么接向量检索？", "2026-10-19 10:05:00"),
            ]
        )
        assert len(clusters) == 1
        assert clusters[0].count == 2

    def test_same_topic_different_intent_stays_apart(self):
        # "怎么做 X" 与 "为什么 X" 是两个缺口，相似度再高也不能并
        clusters = cluster_questions(
            [
                q(1, "向量检索怎么接", "2026-10-19 10:00:00"),
                q(2, "向量检索为什么要减均值", "2026-10-19 10:05:00"),
            ]
        )
        assert len(clusters) == 2
        assert {c.intent for c in clusters} == {"howto", "why"}

    def test_cluster_tracks_cited_and_last_time(self):
        clusters = cluster_questions(
            [
                q(1, "向量检索怎么接", "2026-10-19 10:00:00"),
                q(2, "怎么接向量检索", "2026-10-20 09:00:00", ("local-embedding",)),
            ]
        )
        assert clusters[0].cited == 1
        assert clusters[0].last_at == "2026-10-20 09:00:00"
        assert clusters[0].slugs == {"local-embedding"}

    def test_order_follows_time_not_input_order(self):
        clusters = cluster_questions(
            [
                q(2, "怎么接向量检索", "2026-10-19 12:00:00"),
                q(1, "向量检索怎么接", "2026-10-19 10:00:00"),
            ]
        )
        # 代表句取最早那一次问法，所以先来的那条要排在 texts[0]
        assert clusters[0].texts[0] == "向量检索怎么接"


class TestRepresentative:
    def test_most_frequent_wins(self):
        clusters = cluster_questions(
            [
                q(1, "向量检索怎么接", "2026-10-19 10:00:00"),
                q(2, "怎么接向量检索", "2026-10-19 10:01:00"),
                q(3, "怎么接向量检索", "2026-10-19 10:02:00"),
            ]
        )
        assert representative(clusters[0]) == "怎么接向量检索"

    def test_tie_goes_to_earliest(self):
        clusters = cluster_questions(
            [
                q(1, "向量检索怎么接", "2026-10-19 10:00:00"),
                q(2, "怎么接向量检索", "2026-10-19 10:01:00"),
            ]
        )
        assert representative(clusters[0]) == "向量检索怎么接"


class TestSummarize:
    def test_empty_input_returns_zero_skeleton(self):
        out = summarize([])
        assert out["totals"]["questions"] == 0
        assert out["totals"]["citationRate"] == 0.0
        assert out["clusters"] == [] and out["gaps"] == [] and out["posts"] == []
        assert out["window"]["from"] == ""

    def test_totals_and_sessions(self):
        out = summarize(
            [
                q(1, "向量怎么接", "2026-10-19 10:00:00", ("a",), 100, "s1"),
                q(2, "友链怎么加", "2026-10-19 11:00:00", (), 300, "s2"),
            ]
        )
        assert out["totals"]["questions"] == 2
        assert out["totals"]["withCitation"] == 1
        assert out["totals"]["zeroCitation"] == 1
        assert out["totals"]["citationRate"] == 0.5
        assert out["totals"]["avgLatencyMs"] == 200
        assert out["window"]["sessions"] == 2

    def test_window_bounds_from_data(self):
        out = summarize(
            [q(1, "向量怎么接", "2026-10-19 10:00:00"), q(2, "友链怎么加", "2026-10-20 11:00:00")]
        )
        assert out["window"]["from"] == "2026-10-19 10:00:00"
        assert out["window"]["to"] == "2026-10-20 11:00:00"

    def test_blank_questions_are_ignored(self):
        out = summarize([q(1, "   ", "2026-10-19 10:00:00"), q(2, "向量怎么接", "2026-10-19 10:01:00")])
        assert out["totals"]["questions"] == 1

    def test_intent_order_is_fixed(self):
        out = summarize(
            [
                q(1, "向量怎么接", "2026-10-19 10:00:00"),
                q(2, "你好", "2026-10-19 10:01:00"),
            ]
        )
        assert [i["key"] for i in out["intents"]] == ["chitchat", "howto"]

    def test_intents_skip_empty_buckets(self):
        out = summarize([q(1, "向量怎么接", "2026-10-19 10:00:00")])
        assert [i["key"] for i in out["intents"]] == ["howto"]

    def test_chitchat_is_not_a_content_gap(self):
        # 寒暄本来就不该有引用，塞进缺口列表会让它整页都是废话
        out = summarize([q(1, "你好", "2026-10-19 10:00:00"), q(2, "在吗", "2026-10-19 10:01:00")])
        assert out["gaps"] == []
        assert out["totals"]["zeroCitation"] == 2  # 但总数照实统计，不粉饰

    def test_chitchat_not_in_top_questions(self):
        out = summarize([q(1, "你好", "2026-10-19 10:00:00")])
        assert out["clusters"] == []

    def test_gap_counts_repeats(self):
        out = summarize(
            [
                q(1, "公司资料怎么给模型用", "2026-10-19 10:00:00"),
                q(2, "公司资料怎么给模型用", "2026-10-19 12:00:00"),
            ]
        )
        assert len(out["gaps"]) == 1
        assert out["gaps"][0]["times"] == 2
        assert out["gaps"][0]["firstAskedAt"] == "2026-10-19 10:00:00"
        assert out["gaps"][0]["lastAskedAt"] == "2026-10-19 12:00:00"

    def test_gap_merges_paraphrases(self):
        out = summarize(
            [
                q(1, "公司内部资料怎么让模型用上", "2026-10-19 10:00:00"),
                q(2, "公司内部资料怎么给模型用", "2026-10-19 11:00:00"),
            ]
        )
        assert len(out["gaps"]) == 1
        assert out["gaps"][0]["times"] == 2
        assert out["gaps"][0]["variants"] == ["公司内部资料怎么给模型用"]

    def test_gap_ignores_answered_questions(self):
        out = summarize([q(1, "向量检索怎么接", "2026-10-19 10:00:00", ("local-embedding",))])
        assert out["gaps"] == []

    def test_gap_limit(self):
        topics = ["向量检索怎么接", "友链怎么加", "定时任务怎么配", "热力图怎么画", "收藏管道怎么写"]
        rows = [q(i, t, f"2026-10-19 10:0{i}:00") for i, t in enumerate(topics, start=1)]
        out = summarize(rows, gap_limit=2)
        assert len(out["gaps"]) == 2

    def test_clusters_sorted_by_count_then_recency(self):
        rows = [
            q(1, "向量检索怎么接", "2026-10-19 10:00:00"),
            q(2, "怎么接向量检索", "2026-10-19 10:01:00"),
            q(3, "友链怎么加", "2026-10-19 11:00:00"),
        ]
        out = summarize(rows)
        assert out["clusters"][0]["count"] == 2
        assert out["clusters"][1]["count"] == 1

    def test_cluster_posts_carry_titles(self):
        out = summarize(
            [q(1, "向量检索怎么接", "2026-10-19 10:00:00", ("local-embedding",))],
            titles={"local-embedding": "本地向量检索"},
        )
        assert out["clusters"][0]["posts"] == [{"slug": "local-embedding", "title": "本地向量检索"}]

    def test_unknown_post_title_falls_back_to_slug(self):
        out = summarize([q(1, "向量检索怎么接", "2026-10-19 10:00:00", ("gone",))])
        assert out["clusters"][0]["posts"][0]["title"] == "gone"

    def test_posts_ranked_by_questions_before_citations(self):
        # 同一篇被一次问答引 3 段，不该压过被三次问答各引 1 段的文章
        out = summarize(
            [
                q(1, "向量怎么接", "2026-10-19 10:00:00", ("a", "a", "a")),
                q(2, "友链怎么加", "2026-10-19 10:01:00", ("b",)),
                q(3, "友链怎么做", "2026-10-19 10:02:00", ("b",)),
            ]
        )
        assert [p["slug"] for p in out["posts"]] == ["b", "a"]
        assert out["posts"][0]["questions"] == 2
        assert out["posts"][1]["citations"] == 3

    def test_top_limit(self):
        topics = ["向量检索怎么接", "友链怎么加", "定时任务怎么配", "热力图怎么画", "收藏管道怎么写"]
        rows = [q(i, t, f"2026-10-19 10:0{i}:00") for i, t in enumerate(topics, start=1)]
        assert len(summarize(rows, top=2)["clusters"]) == 2

    def test_output_is_json_safe(self):
        import json

        out = summarize([q(1, "向量怎么接", "2026-10-19 10:00:00", ("a",))], titles={"a": "A"})
        json.dumps(out, ensure_ascii=False)
