"""向量档：给检索补一条「按相似度召回」的通道，默认关闭。

三条约束来自全站设定，改动前先读：

1. **不引向量库**：向量就是一列 BLOB（float32 平铺），余弦在应用层算。
   本库总共一百多个切分块，全量扫比维护索引省事得多，也可复现。
2. **默认不启用**：`EMBEDDING_PROVIDER=none` 时 `ready()` 为假，检索完全走原来的
   关键词通道，分数逐位不变。没配就退回旧行为，不能因为「新功能」把老路径带坏。
3. **换 provider / 换模型后旧向量不可比**：所以每个 BLOB 自带信封
   （magic + provider 码 + 维度）。读的时候对不上就当没有——宁可少一条召回，
   也不能拿两套空间的向量算余弦，那种错不报错、只静默变蠢。

DeepSeek 没有 /embeddings，所以内置了 `hash`：用 `keyword.tokenize` 的特征做带符号
哈希，落到固定维度。它是**字面近邻**，能抓改写里的字面重合与词序变化，抓不到真正的
同义替换——实测在本语料上没有区分度，只留作链路自检。

真正能用的语义向量来自本机 Ollama（`qwen3-embedding:4b`，2560 维，
`EMBEDDING_PROVIDER=openai` + `http://127.0.0.1:11434/v1`）。但它有个必须处理的性质：
**各向异性**——任意两段不相关的中文余弦也有 0.85~0.93，正确答案与无关答案之间没有缝。
所以检索侧一定要先减掉语料均值（`centroid` / `center`），减完正题 0.3~0.8、闲话 0.10~0.15，
向量通道才有意义。跳过这一步会得到「什么都能召回、闸门全失效」的假效果。
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
import struct
import time
from collections import OrderedDict

import httpx

from .keyword import tokenize

log = logging.getLogger(__name__)

# ── 配置（由 configure() 从环境变量灌入，与 llm 同一套做法）────────────────

PROVIDER_NONE = "none"
PROVIDER_HASH = "hash"
PROVIDER_OPENAI = "openai"
PROVIDERS = (PROVIDER_NONE, PROVIDER_HASH, PROVIDER_OPENAI)

EMBEDDING_PROVIDER = PROVIDER_NONE
EMBEDDING_BASE_URL = ""
EMBEDDING_API_KEY = ""
EMBEDDING_MODEL = ""
EMBEDDING_DIM = 0  # 0 = 由 provider 自己决定（hash 固定 HASH_DIM，openai 取模型返回）
EMBEDDING_TIMEOUT = 20.0

HASH_DIM = 256
_BATCH = 16
_CACHE_MAX = 64

# ── BLOB 信封 ──────────────────────────────────────────
# 10 字节头 + 4*dim 字节体：magic(3) + provider(1) + dim(2) + 模型指纹(4)。
# 为什么不止存 provider 和维度：两个不同模型可能同为 1024 维，光看维度会把它们
# 当成同一个空间，余弦照算不误、结果全错。指纹把「换模型」这件事也变成硬约束。
# provider 用一位数字编码，加新 provider 往后排，已落库的旧向量永远读得出来。

MAGIC = b"EV1"
_CODES = {PROVIDER_HASH: 1, PROVIDER_OPENAI: 2}
_NAMES = {v: k for k, v in _CODES.items()}
_HEADER = struct.Struct("<3sBH4s")  # magic, provider, dim, 模型指纹


class EmbeddingError(RuntimeError):
    """向量档不可用或调用失败。调用方应捕获后退回纯关键词。"""


def model_tag(name: str | None = None) -> bytes:
    """模型名 → 4 字节指纹。维度相同但模型不同的向量靠它区分。"""
    target = (name if name is not None else EMBEDDING_MODEL) or ""
    return hashlib.blake2b(target.encode("utf-8"), digest_size=4).digest()


def configure(
    provider: str = "",
    base_url: str = "",
    api_key: str = "",
    model: str = "",
    dim: int = 0,
) -> None:
    """灌入配置。provider 认不出时退回 none——配置写错不该让检索挂掉。"""
    global EMBEDDING_PROVIDER, EMBEDDING_BASE_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL, EMBEDDING_DIM
    name = (provider or "").strip().lower() or PROVIDER_NONE
    if name not in PROVIDERS:
        log.warning("EMBEDDING_PROVIDER=%s 不认识，按 none 处理（可选：%s）", provider, "/".join(PROVIDERS))
        name = PROVIDER_NONE
    EMBEDDING_PROVIDER = name
    EMBEDDING_BASE_URL = (base_url or "").strip()
    EMBEDDING_API_KEY = (api_key or "").strip()
    EMBEDDING_MODEL = (model or "").strip() or ("hash" if name == PROVIDER_HASH else "")
    EMBEDDING_DIM = max(0, int(dim or 0)) if str(dim or "0").strip().isdigit() else 0
    _CACHE.clear()


def provider_name() -> str:
    return EMBEDDING_PROVIDER


def model_name() -> str:
    return EMBEDDING_MODEL if EMBEDDING_PROVIDER != PROVIDER_NONE else ""


def dim() -> int:
    """当前 provider 的向量维度；openai 在拿到第一次响应前记为 0（未知）。"""
    if EMBEDDING_PROVIDER == PROVIDER_HASH:
        return EMBEDDING_DIM or HASH_DIM
    return EMBEDDING_DIM


def ready() -> bool:
    """向量档是否可用。hash 不需网络；openai 必须同时有地址与模型名。"""
    if EMBEDDING_PROVIDER == PROVIDER_NONE:
        return False
    if EMBEDDING_PROVIDER == PROVIDER_HASH:
        return True
    return bool(EMBEDDING_BASE_URL and EMBEDDING_MODEL)


def describe() -> dict:
    return {
        "provider": EMBEDDING_PROVIDER,
        "model": model_name(),
        "dim": dim(),
        "ready": ready(),
    }


# ── HTTP 客户端 ────────────────────────────────────────


def _is_local(url: str) -> bool:
    host = httpx.URL(url).host or ""
    return host in ("127.0.0.1", "localhost", "::1", "0.0.0.0")


def _client(timeout: float) -> httpx.AsyncClient:
    """本机服务不走系统代理。

    这台机器上 `HTTP_PROXY` 是设着的（`NO_PROXY` 为空），httpx 默认会把
    `127.0.0.1:11434` 也交给代理；代理不认这个端口时返回 502，于是
    「配置全对、模型也在跑」却每次都退回关键词——日志里只有一行 warning，
    这是最难查的一类。远程 embedding 服务仍然走代理，那才是代理该管的事。
    """
    return httpx.AsyncClient(timeout=timeout, trust_env=not _is_local(EMBEDDING_BASE_URL))


# ── 运行状态：给人看的那一层 ────────────────────────────
#
# ready() 只回答「配置对不对」，回答不了「对面还活着」。Ollama 停掉之后 base_url
# 与模型名都还在，ready() 照样是 True，而 embed_query 每次都失败、静默退回关键词——
# 界面什么都不变，只是答案悄悄变差。这正是要补的那一块。
#
# 探测只服务 /api/health 与助手面板，不参与打分：把「能不能用」和「怎么算分」
# 分开，换模型、调阈值时不至于互相牵动。
#
# 30 秒缓存：health 会被页面反复拉，没必要每次都打 Ollama；而 30 秒的滞后，
# 对「排查为什么这两句答得不准」完全够用。

_PROBE_TTL = 30.0
_probe: tuple[float, bool] | None = None


async def probe(timeout: float = 1.5) -> bool | None:
    """真的问一次 `/models`。

    返回 `None` 表示这个 provider 本来就不用网络（none / hash），**不是「未知」**——
    别让界面去猜一个永远为空的状态。
    """
    global _probe
    if EMBEDDING_PROVIDER != PROVIDER_OPENAI:
        return None
    now = time.monotonic()
    if _probe is not None and now - _probe[0] < _PROBE_TTL:
        return _probe[1]

    headers = {"Authorization": f"Bearer {EMBEDDING_API_KEY}"} if EMBEDDING_API_KEY else {}
    url = f"{EMBEDDING_BASE_URL.rstrip('/')}/models"
    try:
        async with _client(timeout) as client:
            res = await client.get(url, headers=headers)
        # 非 2xx 也算不可用：401 是 key 配错，与「没启动」对打分是一样的后果
        alive = res.is_success
    except Exception as exc:  # 连不上 / 超时 / DNS 挂了都归到这里
        log.debug("探测向量服务失败：%s", exc)
        alive = False
    _probe = (now, alive)
    return alive


async def status() -> dict:
    """`describe()` 再加「这一档现在到底有没有在用」，给界面用。

    `mode` 只有两档（hybrid / keyword），`reason` 说明为什么不是混合：
    off 没配、hash 只是字面近邻、unreachable 配了但连不上。界面只需要两档，
    排查却必须知道是哪一种——「没配」和「连不上」的处理方式完全不同。
    """
    alive = await probe()
    if EMBEDDING_PROVIDER == PROVIDER_NONE:
        mode, reason = "keyword", "off"
    elif EMBEDDING_PROVIDER == PROVIDER_HASH:
        mode, reason = "keyword", "hash"
    elif alive:
        mode, reason = "hybrid", ""
    else:
        mode, reason = "keyword", "unreachable"
    return {**describe(), "reachable": alive, "mode": mode, "reason": reason}


# ── 编码 / 解码 ────────────────────────────────────────


def _l2(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec))
    if norm <= 1e-12:
        return vec
    return [v / norm for v in vec]


def pack_vector(vec: list[float], provider: str | None = None, model: str | None = None) -> bytes:
    """把向量连同「哪个 provider、哪个模型、多少维」一起封成 BLOB。"""
    name = provider or EMBEDDING_PROVIDER
    code = _CODES.get(name)
    if code is None:
        raise ValueError(f"provider 无法落库：{name}")
    if not vec:
        raise ValueError("空向量不能落库")
    if len(vec) > 0xFFFF:
        raise ValueError(f"维度过大：{len(vec)}")
    for v in vec:
        if not math.isfinite(v):
            raise ValueError("向量含 NaN/Inf")
    header = _HEADER.pack(MAGIC, code, len(vec), model_tag(model))
    return header + struct.pack(f"<{len(vec)}f", *vec)


def unpack_vector(blob: bytes | None) -> tuple[str, bytes, list[float]] | None:
    """解开 BLOB → (provider, 模型指纹, 向量)。

    信封坏了、版本不认、长度不符一律返回 None（当作没有向量），绝不硬猜。
    """
    if not blob or len(blob) < _HEADER.size:
        return None
    try:
        magic, code, length, tag = _HEADER.unpack_from(blob, 0)
    except struct.error:
        return None
    if magic != MAGIC or length <= 0:
        return None
    name = _NAMES.get(code)
    if name is None:
        return None
    expect = _HEADER.size + 4 * length
    if len(blob) != expect:
        return None
    values = list(struct.unpack_from(f"<{length}f", blob, _HEADER.size))
    return name, tag, values


def centroid(vectors: list[list[float]]) -> list[float] | None:
    """语料均值向量。维度不一致的条目直接跳过（不同 provider 的残留不参与）。

    为什么需要它：真实 embedding（qwen3-embedding 实测）各向异性极强——
    任意两段不相关的中文，余弦也在 0.85~0.93，正确答案 0.93、无关答案 0.92，
    中间没有缝。减掉所有块共享的那个均值方向之后，同样的查询会拉到
    「正确答案 0.6 / 无关 0.1」，区分度才回来。hash 那档的特征本来就在原点附近
    对称（带符号哈希），均值≈0，减不减几乎一样。
    """
    if not vectors:
        return None
    dim = len(vectors[0])
    if not dim:
        return None
    usable = [v for v in vectors if len(v) == dim]
    if not usable:
        return None
    acc = [0.0] * dim
    for vec in usable:
        for i, x in enumerate(vec):
            acc[i] += x
    return [x / len(usable) for x in acc]


def center(vec: list[float] | None, mean: list[float] | None) -> list[float] | None:
    """把向量平移到语料均值、再归一。没有均值或维度不符时原样返回（退化为原空间）。"""
    if not vec or not mean or len(vec) != len(mean):
        return vec
    return _l2([x - m for x, m in zip(vec, mean)])


def cosine(a: list[float] | None, b: list[float] | None) -> float:
    """余弦相似度。维度不等、空向量、零向量一律 0.0 —— 不猜、不补零。"""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na <= 1e-12 or nb <= 1e-12:
        return 0.0
    return max(-1.0, min(1.0, dot / (na * nb)))


# ── provider: hash（本地、确定性、无需网络）────────────


def hash_vector(text: str, dimension: int | None = None) -> list[float]:
    """字面近邻向量：特征取 `keyword.tokenize` 的词，哈希到固定维度后 L2 归一。

    用 blake2b 而非内置 hash()：后者带进程随机盐，重启后同一段文字会得到
    不同向量，已落库的向量就全废了。
    """
    size = dimension or EMBEDDING_DIM or HASH_DIM
    if size <= 0:
        raise ValueError("hash 维度必须为正")
    counts: dict[str, int] = {}
    for token in tokenize(text):
        counts[token] = counts.get(token, 0) + 1
    vec = [0.0] * size
    for token, count in counts.items():
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        # 高 32 位定桶、最低位定符号：两路都来自同一摘要，但互不相关，够用且稳定
        bucket = int.from_bytes(digest[:4], "little") % size
        sign = 1.0 if digest[7] & 1 else -1.0
        vec[bucket] += sign * (1.0 + math.log(count))  # 亚线性 TF，防长文靠重复刷分
    return _l2(vec)


# ── provider: openai 兼容 /embeddings ──────────────────


async def _openai_embed(texts: list[str]) -> list[list[float]]:
    global EMBEDDING_DIM
    url = f"{EMBEDDING_BASE_URL.rstrip('/')}/embeddings"
    headers = {"Content-Type": "application/json"}
    if EMBEDDING_API_KEY:
        headers["Authorization"] = f"Bearer {EMBEDDING_API_KEY}"
    out: list[list[float]] = []
    async with _client(EMBEDDING_TIMEOUT) as client:
        for start in range(0, len(texts), _BATCH):
            chunk = texts[start : start + _BATCH]
            payload = {"model": EMBEDDING_MODEL, "input": chunk}
            last: Exception | None = None
            for attempt in range(2):  # 只重试一次：网络抖动救得回来，配额/模型名错救不回来
                try:
                    res = await client.post(url, headers=headers, json=payload)
                    if res.status_code >= 500 and attempt == 0:
                        last = EmbeddingError(f"embedding 返回 {res.status_code}")
                        continue
                    if res.status_code >= 400:
                        raise EmbeddingError(f"embedding 返回 {res.status_code}：{res.text[:160]}")
                    body = res.json()
                    items = body.get("data") or []
                    if len(items) != len(chunk):
                        raise EmbeddingError(f"返回条数不符：要 {len(chunk)} 条，给 {len(items)} 条")
                    # 服务端不保证顺序，按 index 归位
                    items = sorted(items, key=lambda d: d.get("index", 0))
                    out.extend([list(map(float, it["embedding"])) for it in items])
                    last = None
                    break
                except (httpx.HTTPError, ValueError, KeyError) as exc:
                    last = EmbeddingError(f"embedding 请求失败：{type(exc).__name__}: {exc}")
                    if attempt == 1:
                        raise last from exc
            if last is not None:
                raise last
    # 没显式配 EMBEDDING_DIM 时，用第一次响应的长度定下来：同一进程里后续就能
    # 识别出「库里存的向量跟当前模型不是一套」，而不是算出一堆 0
    if out and not EMBEDDING_DIM:
        EMBEDDING_DIM = len(out[0])
    return out


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """批量取向量，顺序与入参一致。未配置或调用失败都抛 EmbeddingError。"""
    if not texts:
        return []
    if not ready():
        raise EmbeddingError("向量档未启用")
    if EMBEDDING_PROVIDER == PROVIDER_HASH:
        return [hash_vector(t) for t in texts]
    return await _openai_embed(texts)


# ── 查询向量缓存 ───────────────────────────────────────
# 同一句追问、以及「拿标题当查询词」的概览路径会反复问同一段文字，
# 缓存能省掉一次网络往返；键里带 provider+model，切配置即失效。

_CACHE: OrderedDict[str, list[float]] = OrderedDict()


async def embed_query(text: str) -> list[float] | None:
    """取查询向量；不可用或失败返回 None（调用方退回纯关键词）。"""
    if not ready() or not text.strip():
        return None
    key = f"{EMBEDDING_PROVIDER}\x00{EMBEDDING_MODEL}\x00{text}"
    hit = _CACHE.get(key)
    if hit is not None:
        _CACHE.move_to_end(key)
        return hit
    try:
        vec = (await embed_texts([text]))[0]
    except EmbeddingError as exc:
        log.warning("查询向量获取失败，本轮退回关键词检索：%s", exc)
        return None
    _CACHE[key] = vec
    if len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return vec


def clear_cache() -> None:
    _CACHE.clear()


# ── 检索侧的工具：向量是否可比 ─────────────────────────


def usable_for_current(blob: bytes | None) -> list[float] | None:
    """这条切分块的向量能否与「当前配置」的查询向量相算。

    provider、模型指纹、维度三者任一不符就当没有——宁可少召回一次，
    也不能拿两套空间的向量算余弦（那种错不报错，只是悄悄变蠢）。
    """
    parsed = unpack_vector(blob)
    if parsed is None:
        return None
    name, tag, vec = parsed
    if name != EMBEDDING_PROVIDER or tag != model_tag():
        return None
    current = dim()
    if current and len(vec) != current:
        return None
    return vec


_WS = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    """入库与查询两侧共用的一段归一：折叠空白、去首尾。"""
    return _WS.sub(" ", text or "").strip()


def chunk_text(title: str, heading: str, body: str) -> str:
    """一个切分块「送去嵌入」的文本。

    标题和路径在前、正文在后：问句往往复述标题里的说法，而正文才是答案所在；
    两段拼起来，同一个向量既能对上标题级提问，也能对上细节提问。
    入库与评估脚本都从这里取，避免两边各拼一套、算出不可比的向量。
    """
    return normalize_text("\n".join(p for p in (title, heading, body) if p))
