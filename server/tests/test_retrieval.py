"""检索的两个纯函数：命中打分 `_score_chunk` 与切块 `split_chunks`。

这两处一旦改动，问答的命中顺序就会变，而 `RAG_MIN_SCORE` 那套阈值是按现有
打分口径标定出来的（闲话约 0.57、真实提问 1.5~3.8）。所以下面的用例分两类：

- 契约：改坏了必然失败的（标题权重最高、未入库的词不得分……）；
- 现状锁定：照搬旧实现留下的口径，P2 改检索时必须连阈值一起重标——用例会
  红，提醒去看一眼，而不是偷偷变差。

整个过程不连库、不发请求。
"""

import math

import pytest

from app.services.agent_chat import RAG_MIN_SCORE, _score_chunk, citations_within_gate
from scripts.init_db import CHUNK_SOFT_LIMIT, split_chunks

LOG2 = math.log(2)


def row(title: str = "", heading: str = "", body: str = "") -> dict:
    return {"title": title, "heading_path": heading, "body": body}


class TestScoreChunk:
    def test_title_beats_heading_beats_body(self):
        # 同样命中一次，权重 3.0 / 1.6 / 1.0，除以 sqrt(1)，idf = log(2)
        df = {"java": 1}
        title = _score_chunk(row(title="Java 入门"), ["java"], df)
        heading = _score_chunk(row(heading="Java > 入门"), ["java"], df)
        body = _score_chunk(row(body="Java 入门"), ["java"], df)
        assert title > heading > body > 0
        assert title == pytest.approx(3.0 * LOG2)
        assert heading == pytest.approx(1.6 * LOG2)
        assert body == pytest.approx(1.0 * LOG2)

    def test_position_precedence_is_exclusive(self):
        # 一个词同时出现在标题和正文里，只按最高那一档算一次，不叠加
        df = {"java": 1}
        both = _score_chunk(row(title="Java", body="Java"), ["java"], df)
        assert both == pytest.approx(3.0 * LOG2)

    def test_token_absent_from_corpus_scores_nothing(self):
        # df == 0 表示整个库都没这个词，不能因为字面出现就得分
        assert _score_chunk(row(title="java"), ["kotlin"], {"kotlin": 0}) == 0.0
        assert _score_chunk(row(title="java"), ["kotlin"], {}) == 0.0

    def test_multiple_matched_tokens_add_up(self):
        tokens = ["java", "spring"]
        df = {"java": 2, "spring": 2}  # idf 各为 log(1 + 2/2) = log(2)
        score = _score_chunk(row(title="java spring"), tokens, df)
        assert score == pytest.approx(2 * 3.0 * LOG2 / math.sqrt(2))

    def test_matching_is_case_insensitive(self):
        df = {"java": 1}
        assert _score_chunk(row(title="JAVA 实战"), ["java"], df) == pytest.approx(3.0 * LOG2)

    def test_empty_tokens_and_empty_row(self):
        assert _score_chunk(row(title="java"), [], {}) == 0.0
        assert _score_chunk(row(), ["java"], {"java": 1}) == 0.0

    def test_substring_match_characterisation(self):
        """现状锁定：命中判定是子串，不是分词边界。

        "java" 会命中 "javascript"，"ai" 会命中 "training"。放进去会让召回变宽、
        精度变低——这是 P2 换检索策略时该一起处理的已知偏差。
        """
        assert _score_chunk(row(title="JavaScript 引擎"), ["java"], {"java": 1}) > 0
        assert _score_chunk(row(body="training data"), ["ai"], {"ai": 1}) > 0

    def test_idf_uses_query_length_as_corpus_size_characterisation(self):
        """现状锁定：idf 里的「文档总数」用的是 len(tokens)，不是切分块总数。

        后果是查询里塞进越多没命中的词，命中词的 idf 反而越大（log(1 + 4/1) > log(1 + 1/1)），
        部分抵消了分母 sqrt(len) 的稀释。P2 若把这里换成真实块总数，命中分数会整体下移，
        RAG_MIN_SCORE 必须重新标定，不能只改公式。
        """
        one = _score_chunk(row(title="java"), ["java"], {"java": 1})
        four = _score_chunk(
            row(title="java"), ["java", "x1", "x2", "x3"], {"java": 1, "x1": 0, "x2": 0, "x3": 0}
        )
        assert one == pytest.approx(3.0 * LOG2)
        assert four == pytest.approx(3.0 * math.log(5) / 2)
        assert four > one


class TestSplitChunks:
    def test_heading_path_nests_and_resets(self):
        md = "# 一\n\n甲\n\n## 二\n\n乙\n\n## 三\n\n丙\n\n# 四\n\n丁\n"
        chunks = split_chunks(md)
        assert [c["headingPath"] for c in chunks] == ["一", "一 > 二", "一 > 三", "四"]
        assert [c["body"] for c in chunks] == ["甲", "乙", "丙", "丁"]

    def test_paragraph_is_the_smallest_unit(self):
        # 段内不切：一个段落即使很长也整体进一个 chunk（按空行切，不按句号切）
        chunk = split_chunks("# 一\n\n第一段\n\n第二段\n")[0]
        assert chunk["body"] == "第一段\n\n第二段"

    def test_long_section_splits_on_paragraph_boundary(self):
        para = "甲" * 100
        chunks = split_chunks("# 一\n\n" + "\n\n".join([para] * 8))
        assert len(chunks) == 2
        # 6 个段落合并后 712 字，再加第 7 个就超过 800 的软上限
        assert chunks[0]["body"].count("甲") == 700
        assert chunks[1]["body"].count("甲") == 100
        assert len(chunks[0]["body"]) < CHUNK_SOFT_LIMIT + len(para)

    def test_heading_without_body_makes_no_chunk(self):
        assert split_chunks("# 只有标题\n") == []
        assert split_chunks("") == []

    def test_level4_heading_stays_in_body(self):
        # 只认 1~3 级标题，`####` 当正文（Obsidian 里它也确实是正文层级以下的小标题）
        chunks = split_chunks("# 一\n\n#### 细节\n\n正文\n")
        assert len(chunks) == 1
        assert chunks[0]["headingPath"] == "一"
        assert "#### 细节" in chunks[0]["body"]

    def test_fenced_code_keeps_hash_lines_in_body(self):
        """围栏代码块里的 `# 安装依赖` 是注释，不是一级标题。

        修之前它会被当标题切走：headingPath 变成「安装依赖」，代码块被劈成两半，
        注释行从正文里消失（检索也就搜不到这一行了）。
        """
        md = "# 一\n\n```bash\n# 安装依赖\npip install x\n```\n\n收尾段落。\n"
        chunks = split_chunks(md)
        assert len(chunks) == 1
        assert chunks[0]["headingPath"] == "一"
        assert "# 安装依赖" in chunks[0]["body"]
        assert "pip install x" in chunks[0]["body"]
        assert chunks[0]["body"].endswith("收尾段落。")

    def test_tilde_fence_also_protects(self):
        md = "# 一\n\n~~~python\n# 注释\nprint(1)\n~~~\n"
        chunks = split_chunks(md)
        assert len(chunks) == 1
        assert "# 注释" in chunks[0]["body"]

    def test_heading_after_closing_fence_is_a_heading_again(self):
        # 出围栏后必须恢复标题识别，否则一篇里的后续小节会全糊成一个 chunk
        md = "# 一\n\n```\ncode\n```\n\n## 二\n\n乙\n"
        assert [c["headingPath"] for c in split_chunks(md)] == ["一", "一 > 二"]

    def test_backtick_fence_with_language_tag(self):
        md = "# 一\n\n```js\n# not a heading\n```\n"
        assert len(split_chunks(md)) == 1


class TestCitationGate:
    """「检索到了」不等于「答得出」。

    这层闸门是撞出来的：闲聊问「今天天气怎么样」，模型调了检索工具，`box.citations`
    攒下 4 条段落（0.388~0.777），正文写着「没有找到相关内容」，界面却在下面列了 4 篇出处。
    读者的结论只能是出处是装饰品。

    整组丢而不是逐条过滤，是因为引用序号按 `register` 的追加顺序发，正文的 [n] 按它对；
    中间抽一条会让后面的标号整体错位，点开的是另一段原文。所以这里也钉住「不逐条过滤」。
    """

    @staticmethod
    def _rows(*scores: float) -> list[dict]:
        return [{"score": s, "chunk_id": i} for i, s in enumerate(scores)]

    def test_empty_stays_empty(self):
        assert citations_within_gate([]) == []

    def test_all_below_gate_are_dropped(self):
        # 实测闲聊那 4 条就在这一段区间里
        assert citations_within_gate(self._rows(0.777, 0.388, 0.388, 0.388)) == []

    def test_single_weak_hit_is_dropped(self):
        assert citations_within_gate(self._rows(0.57)) == []

    def test_exactly_on_the_gate_survives(self):
        # 边界是 >=：分数恰好等于阈值算命中，别写成 > 让标定值失效
        assert len(citations_within_gate(self._rows(RAG_MIN_SCORE))) == 1

    def test_one_strong_hit_keeps_the_whole_group(self):
        # 不逐条过滤：宁可多带几条同篇的低分段落，也不能让正文 [n] 错位
        rows = self._rows(2.1, 0.4, 0.3)
        assert citations_within_gate(rows) == rows
