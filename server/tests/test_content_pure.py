"""内容层的纯函数：slug 归一与 JSON 列解析。

`to_slug` 是**跨语言的双份实现**（后端这里 ↔ 前端 `src/lib/markdown.ts:normalizeKey`），
`[[双链]]` 能不能解析成链接、图谱有没有边，全靠两边算出同一个字符串。规则一漂移，
表现是「链接点了没反应」，不会报错——所以下面这组用例的期望值是用 node 跑前端实现
逐条取回来的，两边都对得上才算数。
"""

import pytest

from app.services.content import _json_str_list, to_slug

# (输入, 前端 normalizeKey 与后端 to_slug 必须共同返回的值)
SLUG_CASES = [
    ("Java 基础", "java-基础"),
    ("Spring/Cloud 实战", "spring-cloud-实战"),
    ("4. More Control Flow Tools.md", "4-more-control-flow-tools"),
    (" - 测试 - ", "测试"),
    ("AI，你好", "ai你好"),
    ("a_b-c", "a_b-c"),
    ("UPPER Case", "upper-case"),
    ("foo\\bar", "foo-bar"),
    ("__proto__", "__proto__"),
    ("周刊#1", "周刊1"),
    ("Hello.World", "helloworld"),
]


class TestToSlug:
    @pytest.mark.parametrize("raw, expected", SLUG_CASES)
    def test_matches_frontend_normalize_key(self, raw, expected):
        assert to_slug(raw) == expected

    def test_md_suffix_is_case_insensitive(self):
        assert to_slug("笔记.MD") == to_slug("笔记")

    def test_idempotent(self):
        # 链接索引里的 key 已经是 slug，再归一一次必须原样返回，否则二次查表就丢
        for raw, expected in SLUG_CASES:
            assert to_slug(expected) == expected

    def test_whitespace_slashes_become_single_dash(self):
        # 连续的分隔符折叠成一个 -，不能出现 a--b
        assert to_slug("a  /  b") == "a-b"

    def test_chinese_is_preserved(self):
        assert to_slug("知识地图总览") == "知识地图总览"

    def test_empty_and_punctuation_only(self):
        assert to_slug("") == ""
        assert to_slug("!!!") == ""


class TestJsonStrList:
    def test_parses_string_array(self):
        assert _json_str_list('["java","spring"]') == ["java", "spring"]

    def test_none_and_empty(self):
        assert _json_str_list(None) == []
        assert _json_str_list("") == []

    def test_broken_json_is_empty(self):
        # 标签列的坏数据不该让整个列表接口 500
        assert _json_str_list("{不是数组") == []
        assert _json_str_list("[1,2") == []

    def test_non_list_is_empty(self):
        assert _json_str_list('{"a": 1}') == []
        assert _json_str_list('"java"') == []

    def test_values_are_stringified_and_falsy_dropped(self):
        assert _json_str_list('[1, null, "x", ""]') == ["1", "x"]
