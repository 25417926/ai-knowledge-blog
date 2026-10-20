"""一句话摘要：写作区与收藏管道共用的一套口径。

两档来源，用途不同，不要互相替代：

- **extract**：确定性抽取（纯函数、毫秒级、可单测）。它站在**保存路径**上兜底，
  所以「摘要空着」这件事在写入环节被堵死。这条不是洁癖：摘要参与相关文章打分
  （`content.py` 里 `token_set(title + summary)`），空着会让关系网召回变糊。
- **llm**：调 `chat_completion`，temperature 0.3，**只在作者点按钮时触发**，
  绝不进保存路径。两个理由：保存要快（LLM 一卡就是 2~10 秒）；Mock 模式下写进库的
  占位摘要不会在配好 Key 之后自动更新，那才是真污染数据。

收藏管道那条 `clipping.summarize()` 产的是整篇结构化摘抄（多节 Markdown），
与这里的一句话摘要是两层东西：摘抄进正文，摘要进 frontmatter。
"""

from __future__ import annotations

import re

from .agent_chat import chat_completion, llm_configured

# 摘要要能塞进列表卡片的一行（前端 `truncate`），80 字够放两句短句
SUMMARY_LIMIT = 80
# AI 写摘要偶尔会絮叨，给个比抽取宽松的硬上限
LLM_LIMIT = 120
# 正文太短时调模型不划算，直接抽取
MIN_CHARS = 40
# 摘要只喂首部：长文全文既超 token 又对「概括主题」没额外帮助
MAX_INPUT = 12000
SUMMARY_TIMEOUT = 45.0

_FRONTMATTER_RE = re.compile(r"\A---\r?\n.*?\r?\n---\r?\n", re.S)
_FENCE_RE = re.compile(r"^(?:```|~~~)")
_INLINE_CODE_RE = re.compile(r"`([^`]*)`")
_MD_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_EMPHASIS_RE = re.compile(r"\*\*|__|~~|\*|_")
_SPACE_RE = re.compile(r"[ \t\u00a0]+")
_BULLET_RE = re.compile(r"^(?:[-*+]|\d+[.)])\s+")
_RULE_RE = re.compile(r"^(?:-{3,}|\*{3,}|_{3,})$")
# 收藏笔记的开头是「来源：… · 收藏于 … · 本文由收藏管道自动整理」，抽它毫无意义。
# 判据要求同时命中前缀与 URL，避免误伤「来源：官方博客」这类正常句子。
_META_PREFIX_RE = re.compile(r"^(?:来源|原文|出处|原文链接|收藏于|本文由)")
_URL_RE = re.compile(r"https?://|www\.")
# 段落里混进公式 / 代码行时，整段摘要会带上 `cos(a,b) = (a·b) / (|a| |b|)` 这种东西。
# 判据是「有代码特征」且「中文占比不到一半」——自然语言里偶尔出现的等号不受影响。
_CODE_HINT_RE = re.compile(r"=|=>|\(\)|\{\}|^\s*[a-z_]+\s*\(|\b(?:def|class|import|return|const|func)\b")
_HAN_RE = re.compile(r"[\u4e00-\u9fff]")
# 行里有中文标点就一定是人写的句子——它在任何编程语言里都不是合法语法。
# 这条比其他判据都硬：「命中率 = 15/16，明显变好。」含等号但是正常中文。
_CN_PUNCT_RE = re.compile(r"[，。！？；：、“”（）【】]")
# 判断「这句有没有信息量」时要先把标点去掉再数：`见下文。` 是 4 个字符 3 个字，
# 而 `第一段的内容。` 是 7 个字符 6 个字——按原始长度算会把后者误判成残句。
_PUNCT_RE = re.compile(r"[\s。！？!?；;，,、…：:]+")
MIN_INFORMATIVE = 6
# 中英文句末一起切；分号也算，摘要里留半句没意义
_SENTENCE_RE = re.compile(r"(?<=[。！？!?；;])")
# 模型爱加的前缀，剥掉才不会变成「摘要：本文讲了……」
_PREFIX_RE = re.compile(r"^(?:一句话)?(?:摘要|总结|概括)\s*[:：]\s*")
_QUOTE_WRAP_RE = re.compile(r'^["“”「『\']+|["“”」』\']+$')


def _strip_frontmatter(text: str) -> str:
    return _FRONTMATTER_RE.sub("", text, count=1)


def _strip_prefix(line: str) -> str:
    """剥掉引用 / 列表前缀，但保留内容——收藏笔记的导语就是以 `> ` 起行的。"""
    out = line
    for _ in range(3):
        if out.startswith(">"):
            out = out[1:].strip()
            continue
        stripped = _BULLET_RE.sub("", out)
        if stripped != out:
            out = stripped
            continue
        break
    return out.strip()


def _is_decorative(line: str) -> bool:
    """图片、表格、裸 HTML、分隔线：不是正文，但会把段落切成两半。"""
    return (
        line.startswith("![")
        or line.startswith("|")
        or line.startswith("<")
        or bool(_RULE_RE.match(line))
        or (bool(_META_PREFIX_RE.match(line)) and bool(_URL_RE.search(line)))
    )


def _looks_like_code(line: str) -> bool:
    if not _CODE_HINT_RE.search(line):
        return False
    if _CN_PUNCT_RE.search(line):
        return False
    han = len(_HAN_RE.findall(line))
    return han < len(line) * 0.5


def _inline_code_text(match: re.Match) -> str:
    """行内代码里的内容按用途分开处理。

    `BLOB`、`pytest -q` 这类标识符要留着（是术语），而 `cos(a,b) = (a·b) / (|a| |b|)`
    这种公式留在摘要里就是噪音——读者在列表卡片上看到一串符号，等于没摘要。
    """
    body = match.group(1)
    return "" if _looks_like_code(body) else body


def clean_inline(text: str) -> str:
    """Markdown 行内标记 → 纯文本。摘要会进 frontmatter 与卡片，带标记既难看又会污染分词。"""
    out = _INLINE_CODE_RE.sub(_inline_code_text, text)
    out = _MD_IMAGE_RE.sub("", out)
    out = _MD_LINK_RE.sub(r"\1", out)
    out = _HTML_TAG_RE.sub("", out)
    out = _EMPHASIS_RE.sub("", out)
    out = out.replace("\\", "")
    return _SPACE_RE.sub(" ", out).strip()


def _scan(text: str) -> tuple[list[str], str]:
    """扫出正文段落与第一个标题。

    围栏代码块必须整段跳过：里面有 `# 注释`、`- 参数`、长行，全都会被误认成正文
    （`split_chunks` 当初就栽在这上面，那里也用了状态机）。
    """
    blocks: list[str] = []
    current: list[str] = []
    heading = ""
    in_fence = False

    def flush() -> None:
        nonlocal current
        if current:
            blocks.append(" ".join(current))
            current = []

    for raw in _strip_frontmatter(text).split("\n"):
        line = raw.strip()
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            flush()
            continue
        if in_fence:
            continue
        if not line:
            flush()
            continue
        if line.startswith("#"):
            flush()
            if not heading:
                heading = clean_inline(line.lstrip("#").strip())
            continue
        # 先剥前缀再看是不是装饰/代码：收藏笔记的元信息行是 `> 来源：https://…`，
        # 带着引用符号判断会漏掉。
        stripped = _strip_prefix(line)
        if not stripped:
            continue
        if _is_decorative(stripped) or _looks_like_code(stripped):
            flush()
            continue
        current.append(stripped)
    flush()
    return blocks, heading


def pick_sentences(text: str, limit: int = SUMMARY_LIMIT) -> str:
    """按句贪心拼到 limit；第一句就超长则硬截断加省略号。

    只取第一句常常太短（「本文介绍 JVM 的内存模型。」），所以继续拼第二、第三句，
    停在不超限为止——列表卡片上信息量刚好是一两句话。
    """
    parts = [p.strip() for p in _SENTENCE_RE.split(text) if p.strip()]
    if not parts:
        return ""
    out = ""
    for part in parts:
        if not out:
            if len(part) > limit:
                return part[: max(1, limit - 1)] + "…"
            out = part
            continue
        if len(out) + len(part) > limit:
            break
        out += part
    return out


def extract_summary(title: str, content: str, limit: int = SUMMARY_LIMIT) -> str:
    """确定性摘要：首个正文段落的前一至两句。

    纯函数：不读配置、不连网、不看时间，所以能单测、能在保存路径上零成本跑。
    """
    blocks, heading = _scan(content or "")
    for block in blocks:
        summary = pick_sentences(clean_inline(block), limit)
        # 以冒号收尾的是引导句（「两个向量的夹角余弦：」），后面跟着代码或列表，
        # 单独截出来既不是完整句子也没信息量，宁可继续往下找。
        # 行内公式被丢掉后会留下「余弦：。」这种残迹，所以先清尾句号再判。
        if summary.rstrip("。.!！?？").endswith(("：", ":")):
            continue
        # 残句（「见下文。」）不如退到小节名，那里至少有主题词
        if len(_PUNCT_RE.sub("", summary)) >= MIN_INFORMATIVE:
            return summary
    return heading or (title or "").strip()


async def llm_summary(title: str, content: str, current: str = "") -> tuple[str, str]:
    """调用模型写 / 改摘要，返回 (摘要, 模型名)。

    `current` 非空走「优化」：作者自己写的那句是主，模型只许改表达，不许换重点。
    """
    system = "你是中文技术博客的编辑，擅长把一篇长文压成一句能放在列表页上的摘要。"
    if current:
        prompt = (
            "下面是作者为这篇文章亲手写的一句话摘要。请**优化它的表达**，"
            "保留作者原本想强调的重点与语气，不要换成你自己的概括角度。\n\n"
            "要求：一句话，40~70 字，中文；直接给结果，不要解释、不要引号、不要 Markdown。\n\n"
            f"文章标题：{title or '（无标题）'}\n"
            f"作者原摘要：{current}\n"
            f"文章正文：\n{content[:MAX_INPUT]}"
        )
    else:
        prompt = (
            "为下面这篇文章写一句话摘要，它会显示在博客列表页与相关文章卡片上。\n\n"
            "要求：一句话，40~70 字，中文；直接说文章讲了什么、解决了什么问题，"
            "不要以「本文」「这篇文章」开头；只依据正文，不编造正文没有的信息；"
            "不要 Markdown 标记，不要换行，不要解释。\n\n"
            f"文章标题：{title or '（无标题）'}\n"
            f"文章正文：\n{content[:MAX_INPUT]}"
        )
    text, model = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        temperature=0.3,
        timeout=SUMMARY_TIMEOUT,
    )
    return tidy_llm_summary(text), model


def tidy_llm_summary(text: str, limit: int = LLM_LIMIT) -> str:
    """模型输出的收口：一行、去前缀、去包裹引号、去 Markdown、限长。"""
    for raw in (text or "").split("\n"):
        line = raw.strip()
        if not line:
            continue
        line = _PREFIX_RE.sub("", line)
        line = clean_inline(line)
        line = _QUOTE_WRAP_RE.sub("", line).strip()
        if not line:
            continue
        return line if len(line) <= limit else line[: limit - 1] + "…"
    return ""


async def make_summary(
    title: str, content: str, mode: str = "extract", current: str = ""
) -> dict:
    """统一入口：返回 {summary, source, note?, model?}，source ∈ extract/mock/llm。

    `mock` 不是失败——它是「没配 Key 但你仍然拿到一句能用的摘要」，与聊天侧的
    Mock 口径一致；前端据此写清来源，别让人以为模型写了。
    """
    fallback = extract_summary(title, content)
    if mode != "ai":
        return {"summary": fallback, "source": "extract"}
    if not llm_configured():
        return {
            "summary": fallback,
            "source": "mock",
            "note": "未配置 LLM，已用正文首段抽取代替",
        }
    if len((content or "").strip()) < MIN_CHARS:
        return {
            "summary": fallback,
            "source": "extract",
            "note": "正文太短，AI 总结收益不大，已用抽取",
        }
    text, model = await llm_summary(title, content, current)
    if not text:
        return {
            "summary": fallback,
            "source": "extract",
            "note": "模型返回空内容，已用抽取",
        }
    return {"summary": text, "source": "llm", "model": model}
