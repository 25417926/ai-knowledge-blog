"""收藏管道的笔记体约定：frontmatter `summary` 取哪一行。

摘抄正文的第一句导语就是文章列表里显示的那句摘要，取错了整个列表都会变成标题复读
（总结失败时正文是纯文本，没有 `>` 开头，必须退回标题）。
"""

from app.services.clipping import mock_summary, one_liner

TITLE = "一篇被收藏的原文"


class TestOneLiner:
    def test_takes_leading_quote(self):
        assert one_liner("> 结构化阅读是这套博客的地基\n\n## 一、分层", TITLE) == "结构化阅读是这套博客的地基"

    def test_skips_blank_lines(self):
        assert one_liner("\n\n> 导语在空行之后\n", TITLE) == "导语在空行之后"

    def test_falls_back_to_title_without_quote(self):
        # 总结失败时正文是「（总结失败：…）」这种纯文本，摘要位不能被它占掉
        assert one_liner("（总结失败：超时）", TITLE) == TITLE
        assert one_liner("", TITLE) == TITLE

    def test_only_first_line_is_used(self):
        assert one_liner("> 第一句\n> 第二句", TITLE) == "第一句"

    def test_long_lead_is_truncated(self):
        out = one_liner("> " + "长" * 100, TITLE)
        assert out.endswith("……")
        assert len(out) == 82  # 80 字 + 省略号

    def test_whitespace_is_collapsed(self):
        assert one_liner(">   两边留了   很多空白  ", TITLE) == "两边留了 很多空白"


class TestMockSummary:
    def test_declares_itself_as_excerpt(self):
        # Mock 摘抄必须明说「不是转述」，否则会被当成 AI 生成的内容引用
        text = mock_summary(TITLE, "第一段正文。\n\n第二段正文。")
        assert "未配置 LLM" in text
        assert "不是转述" in text

    def test_keeps_lead_paragraphs(self):
        text = mock_summary(TITLE, "第一段正文。\n\n第二段正文。")
        assert "第一段正文" in text
        assert "第二段正文" in text

    def test_empty_source_still_renders(self):
        assert "原文为空" in mock_summary(TITLE, "")
