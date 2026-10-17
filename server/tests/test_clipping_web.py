"""收藏管道 Web 化新增的纯函数：链接校验与粘贴降级。

这两处是后台表单唯一的输入面——链接不校验会让管道去请求任意协议，
粘贴解析错了则是「贴了全文却说要粘贴全文」。都不连库、不发请求。
"""

import pytest

from app.services.clipping import (
    MAX_URL,
    ClipError,
    article_from_paste,
    assert_http_url,
    paste_title_fallback,
)

BODY = "第一段正文，讲清楚这篇文章在说什么。" * 3


class TestAssertHttpUrl:
    def test_accepts_http_and_https(self):
        assert assert_http_url("https://example.com/a") == "https://example.com/a"
        assert assert_http_url("http://example.com/a") == "http://example.com/a"

    def test_strips_whitespace(self):
        # 从浏览器地址栏复制常常带首尾空格
        assert assert_http_url("  https://example.com/a \n") == "https://example.com/a"

    @pytest.mark.parametrize(
        "raw",
        ["", "   ", "example.com/a", "ftp://example.com", "javascript:alert(1)", "file:///c:/x"],
    )
    def test_rejects_non_http(self, raw):
        with pytest.raises(ClipError):
            assert_http_url(raw)

    def test_rejects_overlong(self):
        with pytest.raises(ClipError):
            assert_http_url("https://example.com/" + "a" * MAX_URL)

    def test_error_message_is_user_facing(self):
        # 消息会原样显示在后台表单里，不能是空的或英文栈信息
        with pytest.raises(ClipError) as err:
            assert_http_url("")
        assert "链接" in str(err.value)


class TestArticleFromPaste:
    def test_uses_first_line_as_title(self):
        article = article_from_paste("", f"一篇好文章\n\n{BODY}")
        assert article is not None
        assert article["title"] == "一篇好文章"
        assert BODY in article["text"]

    def test_explicit_title_keeps_every_line(self):
        # 表单里填了标题，就不能再吃掉正文第一行
        article = article_from_paste("指定标题", f"第一行也是正文\n\n{BODY}")
        assert article is not None
        assert article["title"] == "指定标题"
        assert "第一行也是正文" in article["text"]

    def test_strips_markdown_heading_from_title(self):
        article = article_from_paste("", f"# 标题带井号\n\n{BODY}")
        assert article is not None
        assert article["title"] == "标题带井号"

    def test_blank_lines_do_not_count_as_content(self):
        article = article_from_paste("", f"只有标题\n\n\n\n   \n")
        assert article is None

    def test_rejects_single_line(self):
        # 只粘了个标题就当全文，会写出一篇空笔记
        assert article_from_paste("", "只有一行") is None

    def test_rejects_too_short_body(self):
        assert article_from_paste("标题", "太短了") is None

    def test_empty_input(self):
        assert article_from_paste("", "") is None


class TestPasteTitleFallback:
    def test_uses_last_path_segment(self):
        assert paste_title_fallback("https://mp.weixin.qq.com/s/AbCdEf") == "AbCdEf"

    def test_falls_back_to_host_when_no_path(self):
        assert paste_title_fallback("https://example.com/") == "example.com"

    def test_never_empty(self):
        assert paste_title_fallback("https://") == "未命名收藏"
