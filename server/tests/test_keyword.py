"""分词与重合度：整条检索链的地基。

问答检索和相关文章召回共用 `keyword.py`，分词规则一漂移，同一条查询会
在问答里命中、在相关推荐里不命中——不报错，只是悄悄变差。所以这里锁的是
「词的切法与量级」，不是实现细节。
"""

import math

import pytest

from app.services.keyword import idf_table, overlap, token_set, tokenize


class TestTokenize:
    def test_chinese_bigram(self):
        # 中文没有空格，按相邻两字切：「提示词工程」→ 提示 / 示词 / 词工 / 工程
        assert tokenize("提示词工程") == ["提示", "示词", "词工", "工程"]

    def test_particles_cut_the_run(self):
        # 虚词参与的二元组全部丢弃，所以「和」把整段切成两截，而不是产出「量和」「和检」
        assert tokenize("向量和检索") == ["向量", "检索"]

    def test_english_tokens_keep_technical_forms(self):
        # 英文词保留 . 和 + ，否则 "next.js" 会被切成 "next"，和普通 next 混在一起
        assert tokenize("Next.js 15 + FastAPI") == ["next.js", "15", "fastapi"]

    def test_english_comes_before_chinese(self):
        # 词序：先扫英文词，再扫中文二元组。检索不依赖顺序，但输出要保持稳定可断言
        assert tokenize("用 SQLite 存向量") == ["sqlite", "存向", "向量"]

    def test_single_cjk_char_dropped(self):
        # 单字信息量太低（「猫」这种），只会让分母变大
        assert tokenize("猫") == []

    def test_stopword_bigram_dropped(self):
        assert tokenize("如何") == []

    def test_empty_input(self):
        assert tokenize("") == []
        assert tokenize("   \n\t ") == []

    def test_token_set_drops_duplicates(self):
        # 重合度只关心「有没有」，重复出现不该加分
        assert token_set("检索 检索 检索") == {"检索"}


class TestIdfTable:
    def test_rarer_token_scores_higher(self):
        docs = [{"java", "spring"}, {"java", "spring"}, {"java", "jvm"}]
        idf = idf_table(docs)
        assert idf["java"] < idf["spring"] < idf["jvm"]
        # 公式 log(1 + 文档数 / 含该词的文档数)
        assert idf["java"] == pytest.approx(math.log(2))  # 3/3
        assert idf["spring"] == pytest.approx(math.log(2.5))  # 3/2
        assert idf["jvm"] == pytest.approx(math.log(4))  # 3/1

    def test_all_tokens_appear_once(self):
        idf = idf_table([{"a"}, {"b"}])
        assert idf == {"a": pytest.approx(math.log(3)), "b": pytest.approx(math.log(3))}

    def test_empty_corpus(self):
        assert idf_table([]) == {}


class TestOverlap:
    IDF = {"java": 1.0, "spring": 2.0, "jvm": 3.0}

    def test_disjoint_sets_score_zero(self):
        assert overlap({"java"}, {"jvm"}, self.IDF) == 0.0

    def test_identical_sets_with_flat_idf_score_one(self):
        # 分子是 idf 之和、分母是两个平方和开方之积；idf 齐平时同一组词正好是 1.0
        idf = {"java": 1.0, "spring": 1.0}
        assert overlap({"java", "spring"}, {"java", "spring"}, idf) == pytest.approx(1.0)

    def test_identical_sets_with_uneven_idf_fall_short_of_one(self):
        # 现状口径：idf 不均匀时哪怕词集完全相同也到不了 1.0（(1+2)/sqrt(5*5) = 0.6）。
        # 所以「内容重合」这一档的满分本来就不常见，别拿 1.0 当基准去卡阈值
        assert overlap({"java", "spring"}, {"java", "spring"}, self.IDF) == pytest.approx(0.6)

    def test_symmetric(self):
        a, b = {"java", "spring"}, {"java", "jvm"}
        assert overlap(a, b, self.IDF) == pytest.approx(overlap(b, a, self.IDF))

    def test_bounded_between_zero_and_one(self):
        a, b = {"java", "spring"}, {"java", "jvm"}
        score = overlap(a, b, self.IDF)
        assert 0.0 < score < 1.0

    def test_partial_share_is_less_than_full(self):
        partial = overlap({"java", "spring"}, {"java"}, self.IDF)
        full = overlap({"java", "spring"}, {"java", "spring"}, self.IDF)
        assert partial < full

    def test_unknown_token_does_not_shift_the_scale(self):
        # 查询里出现语料没有的词（idf 缺失）时按 0 处理：既不进分子，也不撑大分母
        assert overlap({"java", "不存在的词"}, {"java"}, self.IDF) == pytest.approx(1.0)

    def test_empty_side(self):
        assert overlap(set(), {"java"}, self.IDF) == 0.0
