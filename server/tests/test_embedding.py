"""向量档：信封、余弦、融合、以及只在配了供应商时才走的那条 HTTP 路径。

为什么这些值得测：
- **信封**是「换模型后静默算错」的唯一防线。两个 1024 维模型算出的向量会被当成
  同一个空间，余弦照算、结果全错、不报错——只能靠测试盯住。
- **融合公式**决定「阈值口径有没有变」。没有向量时必须逐位等于原关键词分，
  这条一旦破掉，RAG_MIN_SCORE=1.0 那套实测标定就白做了。
- **/embeddings 的响应处理**在本机永远跑不到（DeepSeek 没有这个端点），
  但它恰恰是配了真模型后唯一在跑的东西，所以用桩把顺序、条数、重试都钉住。
"""

from __future__ import annotations

import math

import pytest

from app.services import embedding
from app.services.agent_chat import _fuse


@pytest.fixture(autouse=True)
def _restore_config():
    """每个用例前后都把全局配置复位：这些是模块级状态，串味了会互相骗。"""
    embedding.configure("none")
    embedding.clear_cache()
    yield
    embedding.configure("none")
    embedding.clear_cache()


# ── 信封 ───────────────────────────────────────────────


class TestEnvelope:
    def test_roundtrip_keeps_values_provider_and_model(self):
        embedding.configure("hash", model="hash")
        vec = embedding.hash_vector("向量检索与余弦相似度")
        name, tag, back = embedding.unpack_vector(embedding.pack_vector(vec))
        assert name == "hash"
        assert tag == embedding.model_tag("hash")
        assert back == pytest.approx(vec)

    def test_header_is_ten_bytes(self):
        blob = embedding.pack_vector([0.1, 0.2], provider="hash", model="m")
        assert len(blob) == 10 + 4 * 2

    def test_model_fingerprint_separates_same_dim_models(self):
        # 同为 1024 维的两个模型不能混算——指纹是唯一能发现这件事的东西
        a = embedding.pack_vector([1.0] * 4, provider="openai", model="bge-m3")
        b = embedding.pack_vector([1.0] * 4, provider="openai", model="text-embedding-3-small")
        assert embedding.unpack_vector(a)[1] != embedding.unpack_vector(b)[1]

    @pytest.mark.parametrize(
        "vec",
        [[], [float("nan")], [float("inf")]],
    )
    def test_pack_rejects_unusable_values(self, vec):
        with pytest.raises(ValueError):
            embedding.pack_vector(vec, provider="hash", model="m")

    def test_pack_rejects_unknown_provider(self):
        with pytest.raises(ValueError):
            embedding.pack_vector([0.1], provider="somebody", model="m")

    @pytest.mark.parametrize(
        "blob",
        [
            None,
            b"",
            b"EV",  # 短于头部
            b"XX1\x01\x04\x00" + b"\x00" * 16,  # magic 不对
            b"EV1\x7f\x04\x00abcd" + b"\x00" * 16,  # provider 码不认
            b"EV1\x01\x04\x00abcd" + b"\x00" * 4,  # 长度与声明不符
        ],
    )
    def test_unpack_returns_none_instead_of_guessing(self, blob):
        # 宁可「当作没有向量」，也不能硬猜一个出来——猜错就是静默算错
        assert embedding.unpack_vector(blob) is None


class TestCosine:
    def test_identical_direction_is_one(self):
        assert embedding.cosine([1.0, 2.0], [2.0, 4.0]) == pytest.approx(1.0)

    def test_orthogonal_is_zero(self):
        assert embedding.cosine([1.0, 0.0], [0.0, 1.0]) == 0.0

    def test_opposite_is_minus_one(self):
        assert embedding.cosine([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)

    def test_dimension_mismatch_is_zero_not_error(self):
        # 不同模型的向量撞在一起时，宁可当「不相似」，不要抛异常把整轮问答带崩
        assert embedding.cosine([1.0, 0.0], [1.0, 0.0, 0.0]) == 0.0

    def test_zero_vector_is_zero(self):
        assert embedding.cosine([0.0, 0.0], [1.0, 1.0]) == 0.0

    def test_none_is_zero(self):
        assert embedding.cosine(None, [1.0]) == 0.0


# ── hash provider ──────────────────────────────────────


class TestHashVector:
    def test_deterministic_within_process(self):
        assert embedding.hash_vector("JUC 线程池核心参数") == embedding.hash_vector("JUC 线程池核心参数")

    def test_unit_length(self):
        vec = embedding.hash_vector("向量检索与余弦相似度")
        assert math.sqrt(sum(v * v for v in vec)) == pytest.approx(1.0)

    def test_dim_respected(self):
        assert len(embedding.hash_vector("任何文字", 64)) == 64

    def test_related_beats_unrelated(self):
        base = embedding.hash_vector("向量检索")
        near = embedding.hash_vector("向量检索与余弦相似度")
        far = embedding.hash_vector("今天天气不错我想喝咖啡")
        assert embedding.cosine(base, near) > embedding.cosine(base, far)

    def test_single_char_input_is_empty_like_the_keyword_channel(self):
        # keyword.tokenize 会过滤掉单字，所以「好」这种输入在关键词通道里也是空的。
        # 两条通道在这一点上必须一致：否则向量档会为一句关键词都匹配不到的
        # 话凭空召回一堆东西。
        assert not any(v != 0 for v in embedding.hash_vector("好"))


# ── 与当前配置是否可比 ─────────────────────────────────


class TestUsableForCurrent:
    def test_provider_mismatch_is_invisible(self):
        blob = embedding.pack_vector([1.0, 0.0], provider="openai", model="m")
        embedding.configure("hash", model="hash")
        assert embedding.usable_for_current(blob) is None

    def test_model_mismatch_is_invisible(self):
        # 这里必须让维度检查失效（openai 未配 EMBEDDING_DIM 时 dim()=0，跳过长度校验），
        # 否则用例会被维度检查顺手兜住，指纹那一行删了也是绿的——骗自己。
        blob = embedding.pack_vector([1.0, 0.0], provider="openai", model="old")
        embedding.configure("openai", base_url="http://x/v1", model="new")
        assert embedding.usable_for_current(blob) is None

    def test_dim_mismatch_is_invisible(self):
        blob = embedding.pack_vector([1.0, 0.0], provider="hash", model="hash")
        embedding.configure("hash", model="hash", dim=8)
        assert embedding.usable_for_current(blob) is None

    def test_matching_config_returns_vector(self):
        embedding.configure("hash", model="hash")
        vec = embedding.hash_vector("随便一段文字")
        assert embedding.usable_for_current(embedding.pack_vector(vec)) == pytest.approx(vec)


# ── 融合公式 ───────────────────────────────────────────


class TestFuse:
    """相似度进来的是「减过语料均值」的余弦：闲话 0.10~0.15、正题 0.3~0.8。

    2026-10-17 换成真实 embedding 后重标：原始余弦对什么都在 0.86~0.94，
    `cos=0.5 单独凑够 1.0` 那套标定在原空间里成立、在去均值空间里不成立。
    """

    def test_without_vector_score_is_untouched(self):
        # 这条是老路径不变量：没有向量时，分数必须逐位等于原来的关键词分
        assert _fuse(1.37, 0.0) == 1.37
        assert _fuse(1.37, None) == 1.37

    def test_below_floor_adds_nothing(self):
        from app.services.agent_chat import VEC_FLOOR

        assert _fuse(0.4, VEC_FLOOR) == 0.4
        assert _fuse(0.4, 0.0) == 0.4

    def test_smalltalk_top_score_cannot_clear_the_gate(self):
        from app.services.agent_chat import RAG_MIN_SCORE

        # 实测闲话提问在语料上最高 0.149（去均值后）。这种「像但不对」的分数
        # 必须一分不加，否则闸门就形同不存在——这是本轮改动最要紧的一条。
        assert _fuse(0.0, 0.149) < RAG_MIN_SCORE

    def test_clear_match_clears_the_gate_alone(self):
        from app.services.agent_chat import RAG_MIN_SCORE

        # 正题的典型分（0.3）单靠向量就该过闸
        assert _fuse(0.0, 0.30) >= RAG_MIN_SCORE

    def test_monotonic_in_similarity(self):
        from app.services.agent_chat import VEC_FLOOR

        scores = [_fuse(0.2, c) for c in (VEC_FLOOR, VEC_FLOOR + 0.05, 0.4, 0.6, 0.8)]
        assert scores == sorted(scores)


# ── 去均值（各向异性修正）───────────────────────────────
# 真实 embedding 的所有向量都带一个很大的公共分量，余弦因此挤在 0.85 以上，
# 什么组合都「挺像」。减掉语料均值之后才分得开——下面两条是这个修正的正反面。


class TestCentroid:
    def test_mean_of_symmetric_set_is_near_zero(self):
        mean = embedding.centroid([[1.0, 0.0], [-1.0, 0.0], [0.0, 2.0], [0.0, -2.0]])
        assert mean == pytest.approx([0.0, 0.0])

    def test_skips_vectors_with_other_dim(self):
        mean = embedding.centroid([[2.0, 4.0], [4.0, 8.0], [9.0, 9.0, 9.0]])
        assert mean == pytest.approx([3.0, 6.0])

    def test_empty_or_all_mismatched_is_none(self):
        assert embedding.centroid([]) is None
        assert embedding.centroid([[], []]) is None

    def test_centering_removes_the_shared_component(self):
        # 四条向量都带一个巨大的公共分量：原始余弦 0.993（"什么都挺像"），
        # 减掉语料均值（正好等于公共分量）之后只剩各自的方向，余弦归零。
        common = [5.0] * 6
        a = [c + d for c, d in zip(common, [1, 0, 0, 0, 0, 0])]
        b = [c + d for c, d in zip(common, [0, 1, 0, 0, 0, 0])]
        a2 = [c + d for c, d in zip(common, [-1, 0, 0, 0, 0, 0])]
        b2 = [c + d for c, d in zip(common, [0, -1, 0, 0, 0, 0])]
        raw = embedding.cosine(a, b)
        mean = embedding.centroid([a, b, a2, b2])
        centered = embedding.cosine(embedding.center(a, mean), embedding.center(b, mean))
        assert raw > 0.99
        assert centered == pytest.approx(0.0, abs=1e-9)

    def test_center_without_mean_is_identity(self):
        vec = [0.3, 0.4]
        assert embedding.center(vec, None) == vec

    def test_center_normalizes(self):
        out = embedding.center([3.0, 0.0], [0.0, 0.0])
        assert out == pytest.approx([1.0, 0.0])


# ── embed_texts / 缓存 ─────────────────────────────────


class TestEmbedTexts:
    def test_not_configured_raises(self):
        with pytest.raises(embedding.EmbeddingError):
            import asyncio

            asyncio.run(embedding.embed_texts(["随便"]))

    def test_hash_provider_batches_all_inputs(self):
        import asyncio

        embedding.configure("hash", model="hash")
        vecs = asyncio.run(embedding.embed_texts(["一", "二", "三"]))
        assert len(vecs) == 3
        assert all(len(v) == embedding.HASH_DIM for v in vecs)

    def test_query_vector_is_cached(self):
        import asyncio

        embedding.configure("hash", model="hash")
        first = asyncio.run(embedding.embed_query("同一句话"))
        calls = 0

        original = embedding.embed_texts

        async def counting(texts):
            nonlocal calls
            calls += 1
            return await original(texts)

        embedding.embed_texts = counting
        try:
            second = asyncio.run(embedding.embed_query("同一句话"))
        finally:
            embedding.embed_texts = original
        assert calls == 0, "缓存命中不该再请求一次"
        assert first == second

    def test_unconfigured_query_returns_none(self):
        import asyncio

        assert asyncio.run(embedding.embed_query("随便")) is None


class TestOpenAICompatible:
    """/embeddings 的响应处理：本机跑不到，但配了真模型后就全靠它。"""

    @staticmethod
    def _client_stub(payload, status=200, seen=None):
        class Resp:
            def __init__(self):
                self.status_code = status
                self.text = str(payload)

            def json(self):
                return payload

        class Client:
            def __init__(self, *a, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, url, headers=None, json=None):  # noqa: A002
                if seen is not None:
                    seen.append(json)
                return Resp()

        return Client

    def test_order_follows_index_not_response_order(self, monkeypatch):
        payload = {
            "data": [
                {"index": 1, "embedding": [0.0, 1.0]},
                {"index": 0, "embedding": [1.0, 0.0]},
            ]
        }
        monkeypatch.setattr(embedding.httpx, "AsyncClient", self._client_stub(payload))
        embedding.configure("openai", base_url="http://x/v1", model="m")
        import asyncio

        vecs = asyncio.run(embedding.embed_texts(["甲", "乙"]))
        # 服务端不保证顺序，按 index 归位后第一条才对应「甲」
        assert vecs == [[1.0, 0.0], [0.0, 1.0]]

    def test_count_mismatch_is_an_error(self, monkeypatch):
        payload = {"data": [{"index": 0, "embedding": [1.0]}]}
        monkeypatch.setattr(embedding.httpx, "AsyncClient", self._client_stub(payload))
        embedding.configure("openai", base_url="http://x/v1", model="m")
        import asyncio

        with pytest.raises(embedding.EmbeddingError):
            asyncio.run(embedding.embed_texts(["甲", "乙"]))

    def test_4xx_is_not_retried(self, monkeypatch):
        seen = []
        monkeypatch.setattr(
            embedding.httpx,
            "AsyncClient",
            self._client_stub({"error": "bad model"}, status=404, seen=seen),
        )
        embedding.configure("openai", base_url="http://x/v1", model="m")
        import asyncio

        with pytest.raises(embedding.EmbeddingError):
            asyncio.run(embedding.embed_texts(["甲"]))
        assert len(seen) == 1, "模型名/配额这类错误重试也没用，不该白打两次"

    def test_dim_learned_from_first_response(self, monkeypatch):
        payload = {"data": [{"index": 0, "embedding": [0.3, 0.4, 0.5]}]}
        monkeypatch.setattr(embedding.httpx, "AsyncClient", self._client_stub(payload))
        embedding.configure("openai", base_url="http://x/v1", model="m")
        import asyncio

        # 没显式配 EMBEDDING_DIM：拿到响应后就能定下维度，
        # 之后才认得出「库里存的向量跟当前模型不是一套」
        asyncio.run(embedding.embed_texts(["甲"]))
        assert embedding.dim() == 3
