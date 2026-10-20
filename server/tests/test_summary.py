"""摘要抽取的纯函数：不连库、不连网、不读配置。

这一组守的是「保存兜底」的质量底线 —— 摘要留空时由 `extract_summary` 补一句，
它一旦抽错（把代码块里的 `# 注释` 当正文、把图片 alt 当句子），错的会直接写进
frontmatter，并顺着 `token_set(title + summary)` 污染相关文章打分。
"""

from app.services.summary import (
    clean_inline,
    extract_summary,
    pick_sentences,
    tidy_llm_summary,
)


class TestScanBoundaries:
    def test_frontmatter_is_not_content(self):
        text = "---\ntitle: 标题\nsummary: 旧摘要\n---\n\n正文第一句。正文第二句。"
        assert extract_summary("标题", text).startswith("正文第一句。")

    def test_fenced_code_block_is_skipped(self):
        # 围栏里的 `# 注释` 与 `- 参数` 都长得像正文，必须整块跳过
        text = "```bash\n# 启动服务\nuvicorn app.main:app --port 8000\n```\n\n这才是真正的开头。"
        assert extract_summary("标题", text) == "这才是真正的开头。"

    def test_tilde_fence_also_skipped(self):
        text = "~~~python\nprint('hi')\n~~~\n\n围栏之后的正文。"
        assert extract_summary("标题", text) == "围栏之后的正文。"

    def test_heading_and_image_are_skipped(self):
        text = "## 小节\n\n![架构图](https://x/y.png)\n\n图后面才是正文。"
        assert extract_summary("标题", text) == "图后面才是正文。"

    def test_table_rows_are_skipped(self):
        text = "| 项 | 值 |\n| --- | --- |\n| a | 1 |\n\n表格后面是正文。"
        assert extract_summary("标题", text) == "表格后面是正文。"

    def test_paragraph_broken_by_heading_keeps_first_part(self):
        text = "第一段的内容。\n\n## 下一节\n\n第二段的内容。"
        assert extract_summary("标题", text) == "第一段的内容。"

    def test_clipping_meta_line_is_skipped(self):
        # 收藏笔记开头就是这行元信息；抽它会得到一条 URL，是这条管道最丢人的失败
        text = (
            "# 某篇文章\n\n"
            "> 来源：https://mp.weixin.qq.com/s/abc · 收藏于 2026-10-20 · 本文由收藏管道自动整理\n\n"
            "> 这篇讲清了收藏管道怎么接进写作区。\n\n## 一、小节"
        )
        assert extract_summary("某篇文章", text) == "这篇讲清了收藏管道怎么接进写作区。"

    def test_normal_line_starting_with_source_is_kept(self):
        # 只有「来源」前缀 + URL 才是元信息，别把正常句子一起吃掉
        text = "来源：官方博客的一篇说明，讲了为什么这样设计。"
        assert extract_summary("标题", text).startswith("来源：官方博客")

    def test_formula_line_is_not_content(self):
        text = "两个向量的夹角余弦：\ncos(a,b) = (a·b) / (|a| |b|)\n\n它只看方向不看长度。"
        assert extract_summary("标题", text) == "它只看方向不看长度。"

    def test_chinese_sentence_with_equals_is_kept(self):
        # 中文占一半以上的行不算代码，否则会误伤「命中率 = 15/16」这种句子
        text = "命中率提升到 15/16，MRR 从 0.54 涨到 0.91 = 明显变好。"
        assert "命中率提升到" in extract_summary("标题", text)


class TestPrefixesAndInline:
    def test_quote_prefix_stripped(self):
        # 收藏笔记的导语就是 `> ` 起行，剥前缀而不是丢掉整行
        text = "> 这篇讲清了向量检索的阈值怎么标定。\n\n## 一、小节"
        assert extract_summary("标题", text) == "这篇讲清了向量检索的阈值怎么标定。"

    def test_bullet_prefix_stripped(self):
        text = "- 第一条要点：先减均值再算余弦。\n- 第二条。"
        assert extract_summary("标题", text).startswith("第一条要点：先减均值再算余弦。")

    def test_inline_markup_removed(self):
        text = "用 `BLOB` 存向量，**不引向量库**，见 [文档](https://example.com)。"
        out = extract_summary("标题", text)
        assert "`" not in out and "**" not in out and "](" not in out
        assert "BLOB" in out and "文档" in out

    def test_inline_formula_dropped_but_identifier_kept(self):
        # 行内代码分两类：`BLOB` 是术语要留，公式丢了才不影响阅读
        text = "两个向量的夹角余弦：`cos(a,b) = (a·b) / (|a| |b|)`。\n\n它只看方向不看长度。"
        assert extract_summary("标题", text) == "它只看方向不看长度。"
        assert "BLOB" in extract_summary("标题", "用 `BLOB` 存向量。")

    def test_clean_inline_keeps_code_text(self):
        assert clean_inline("跑 `pytest -q` 就行") == "跑 pytest -q 就行"

    def test_clean_inline_collapses_spaces(self):
        assert clean_inline("a    b\tc") == "a b c"


class TestSentencePicking:
    def test_joins_second_sentence_when_room(self):
        out = pick_sentences("第一句很短。第二句也不长。", limit=40)
        assert out == "第一句很短。第二句也不长。"

    def test_stops_before_exceeding_limit(self):
        out = pick_sentences("甲" * 20 + "。" + "乙" * 20 + "。", limit=30)
        assert out == "甲" * 20 + "。"

    def test_single_long_sentence_truncated_with_ellipsis(self):
        out = pick_sentences("很" * 100, limit=20)
        assert len(out) == 20 and out.endswith("…")

    def test_empty_text(self):
        assert pick_sentences("", limit=20) == ""

    def test_english_period_is_not_a_sentence_end(self):
        # 英文句点不切：`v1.2` 被切成 `v1.` 会很难看
        assert "v1.2" in pick_sentences("升级到 v1.2 版本之后再说别的", limit=40)


class TestFallbacks:
    def test_empty_content_falls_back_to_title(self):
        assert extract_summary("只有标题的文章", "") == "只有标题的文章"

    def test_heading_only_article_uses_heading(self):
        # 纯提纲（只有标题没有段落）时，第一个小节名比文章标题更有信息量
        assert extract_summary("文章标题", "## 检索阈值怎么标定\n\n## 另一节") == "检索阈值怎么标定"

    def test_too_short_sentence_falls_back_to_heading(self):
        assert extract_summary("文章标题", "见下文。\n\n## 真正的主题") == "真正的主题"

    def test_missing_title_and_content(self):
        assert extract_summary("", "") == ""

    def test_limit_is_respected(self):
        out = extract_summary("标题", "很" * 200 + "。", limit=30)
        assert len(out) <= 30


class TestTidyLlmOutput:
    def test_strips_prefix(self):
        assert tidy_llm_summary("摘要：这篇文章讲了阈值标定。") == "这篇文章讲了阈值标定。"

    def test_strips_wrapping_quotes(self):
        assert tidy_llm_summary("「一句话说明」") == "一句话说明"

    def test_takes_first_non_empty_line(self):
        assert tidy_llm_summary("\n\n第一行是摘要。\n第二行是解释。") == "第一行是摘要。"

    def test_removes_markdown(self):
        assert tidy_llm_summary("**加粗的**摘要") == "加粗的摘要"

    def test_empty_output(self):
        assert tidy_llm_summary("   \n\n  ") == ""

    def test_truncates_long_output(self):
        out = tidy_llm_summary("长" * 200, limit=40)
        assert len(out) == 40 and out.endswith("…")
