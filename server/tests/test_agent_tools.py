"""问答内核里的纯函数：好感度、事实抽取、意图判断、文本裁剪、工具参数归一。

这些函数不碰库也不发请求，但直接决定「记不记得住用户说过的话」「问概览时会不会
去检索」——都是行为级契约，不是内部细节。
"""

import pytest

from app.services.agent_chat import (
    _normalize_tool_calls,
    _parse_tool_args,
    affinity_delta,
    clip,
    extract_fact,
    is_overview_ask,
    next_stage_at,
    no_hit_message,
    pick,
    short_heading,
    stage_of,
    valid_tool_fact,
)


class TestStage:
    @pytest.mark.parametrize(
        "score, key",
        [
            (0, "stranger"),
            (5, "stranger"),
            (6, "acquaintance"),  # 门槛是「达到即进入」
            (19, "acquaintance"),
            (20, "familiar"),
            (44, "familiar"),
            (45, "close"),
            (1000, "close"),
        ],
    )
    def test_stage_boundaries(self, score, key):
        assert stage_of(score)["key"] == key

    def test_stage_never_goes_backwards(self):
        # 好感度只增不减，阶段也必须单调
        keys = [stage_of(s)["key"] for s in range(0, 60)]
        assert keys == sorted(keys, key=["stranger", "acquaintance", "familiar", "close"].index)

    @pytest.mark.parametrize(
        "score, expected",
        [(0, 6), (5, 6), (6, 20), (19, 20), (20, 45), (44, 45), (45, None), (999, None)],
    )
    def test_next_stage_at(self, score, expected):
        assert next_stage_at(score) == expected


class TestAffinityDelta:
    def test_bare_message_gets_one(self):
        assert affinity_delta("在吗") == 1

    def test_long_message_gets_two(self):
        assert affinity_delta("我" * 20) == 2
        assert affinity_delta("我" * 19) == 1

    def test_question_gets_a_bonus(self):
        assert affinity_delta("为什么？") == 2
        assert affinity_delta("怎么用") == 2

    def test_polite_gets_a_bonus(self):
        assert affinity_delta("谢谢") == 2

    def test_capped_at_four(self):
        # 四项全中本来是 1+3，但单轮最多涨 4——涨太快会让「亲近」失去分量
        full = "谢谢，我真的很想知道这个功能到底为什么会这样？"
        assert affinity_delta(full) == 4

    def test_never_below_one(self):
        for message in ["", "?", "谢谢", "嗯"]:
            assert affinity_delta(message) >= 1


class TestExtractFact:
    @pytest.mark.parametrize(
        "message",
        ["我叫小王", "我是产品经理", "我喜欢用 Python 写爬虫", "我在深圳", "我正在学 Agent"],
    )
    def test_self_intro_is_kept(self, message):
        assert extract_fact(message) == message

    @pytest.mark.parametrize(
        "message",
        [
            "今天天气不错",  # 没有「我 + 动词」，记下来就是噪声
            "我叫小王吗",  # 疑问句
            "我叫小王？",
            "我想学哪些内容",  # 带疑问词
            "我是",  # 太短
        ],
    )
    def test_noise_is_dropped(self, message):
        assert extract_fact(message) is None

    def test_too_long_is_dropped(self):
        assert extract_fact("我叫" + "很" * 60) is None

    def test_whitespace_is_collapsed(self):
        assert extract_fact("  我叫   小王  ") == "我叫 小王"


class TestValidToolFact:
    """工具路径比正则路径宽松：模型已经判断过才调用，这里只挡明显的疑问句和异常长度。"""

    @pytest.mark.parametrize(
        "text",
        ["俺叫小王", "我干了三年 Java", "我的项目叫掌柜问数"],
    )
    def test_loose_acceptance(self, text):
        assert valid_tool_fact(text) is True

    @pytest.mark.parametrize("text", ["我叫什么？", "我在学 Agent 吗", "我在学 Agent 吧。", "我"] ,)
    def test_rejects_questions_and_stubs(self, text):
        assert valid_tool_fact(text) is False

    def test_rejects_overlong(self):
        assert valid_tool_fact("我" + "很" * 60) is False


class TestOverviewIntent:
    @pytest.mark.parametrize(
        "message",
        [
            "这篇讲了什么",
            "本文主要讲了些什么",
            "概览一下",
            "帮我总结一下",
        ],
    )
    def test_overview_asks(self, message):
        # 注意口径：正则认「讲了些什么 / 讲了点什么 / 讲了什么」，不认「讲了哪些」。
        # Mock 模式靠它分流，改它等于改 Mock 的行为，别为了一个说法去动
        assert is_overview_ask(message) is True

    @pytest.mark.parametrize("message", ["Java 垃圾回收怎么调", "这是什么技术", "你好"])
    def test_normal_asks_are_not_overview(self, message):
        assert is_overview_ask(message) is False


class TestTextHelpers:
    def test_clip_keeps_short_text(self):
        assert clip("短句", 10) == "短句"

    def test_clip_appends_ellipsis_once(self):
        out = clip("一二三四五六七八九十", 4)
        assert out == "一二三四…"
        assert len(out) == 5

    def test_short_heading_takes_last_segment(self):
        assert short_heading("父级 > 子级 > 三级标题") == "三级标题"

    def test_short_heading_truncates(self):
        out = short_heading("父级 > " + "很长的标题" * 5)
        assert out.endswith("…")
        assert len(out) == 19  # 18 字 + 省略号

    def test_pick_wraps_and_handles_negative_seed(self):
        items = ["a", "b", "c"]
        assert pick(items, 0) == "a"
        assert pick(items, 4) == "b"
        assert pick(items, -1) == "b"  # abs(-1) % 3

    def test_no_hit_message_quotes_the_query_and_offers_a_way_out(self):
        message = no_hit_message("一个非常非常非常长的检索问题啊")
        assert "一个非常非常非常长的检索问题…" in message  # 14 字截断后再加省略号
        assert "知识地图总览" in message


class TestToolCallNormalisation:
    def test_json_string_arguments_are_parsed(self):
        assert _parse_tool_args('{"slug": "java-基础"}') == {"slug": "java-基础"}

    def test_broken_json_becomes_empty_dict(self):
        # 解析失败按空参数处理，让工具侧把缺参的错误回填给模型，比整轮失败稳
        assert _parse_tool_args("{不是 json") == {}
        assert _parse_tool_args("") == {}
        assert _parse_tool_args(None) == {}
        assert _parse_tool_args(["a"]) == {}
        assert _parse_tool_args({"slug": "x"}) == {"slug": "x"}

    def test_normalize_openai_shape(self):
        raw = [
            {"id": "call_1", "function": {"name": "search_posts", "arguments": '{"q": "GC"}'}},
        ]
        assert _normalize_tool_calls(raw) == [{"id": "call_1", "name": "search_posts", "args": {"q": "GC"}}]

    def test_missing_fields_degrade_to_empty_strings(self):
        assert _normalize_tool_calls([{}]) == [{"id": "", "name": "", "args": {}}]

    def test_arguments_already_dict(self):
        # 部分兼容端点直接回对象而不是字符串
        raw = [{"id": "c", "function": {"name": "get_article_overview", "arguments": {"slug": "x"}}}]
        assert _normalize_tool_calls(raw)[0]["args"] == {"slug": "x"}
