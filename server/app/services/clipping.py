"""收藏管道（服务层）：抓取 → 摘抄 → 原文 PDF → 写笔记 → 入库 → 重建索引。

两个入口共用这一份实现，不各写一套：
  CLI  `python -m scripts.clip <url>`（`scripts/clip.py` 只做参数解析与打印）
  Web  `POST /api/admin/clippings`（后台 /admin/clippings 的「贴链接」表单）

五段流水线（收集段的去重任 clippings 表的 URL 唯一约束）：
  抓取：httpx 带浏览器 UA 拉 HTML，trafilatura 抽正文；失败或正文过短
        （公众号反爬的典型表现）时由调用方降级为粘贴模式——库函数不读 stdin，
        粘贴内容从参数进来，Web 侧才能把文本直接传下来；
  摘抄：按手写笔记的体例压一遍——开头一句导语，正文按原文脉络分节、
        节内要点前加粗关键词，末尾收一句总结；无 LLM Key 时出节选式
        Mock 摘抄，并明说「这是节选不是转述」；
  存档：原文渲染成 PDF 存 clippings.pdf 列，笔记里只留摘抄 + 下载链接。
        原文全文有 PDF 这一份就够，再贴一遍正文等于同一份内容存两份；
        PDF 生成失败时才退回把原文贴进笔记；
  入库：写 content/sample-vault/clippings/ 下的 Obsidian 格式笔记。文件名带
        clip- 前缀——手写笔记是裸标题，撞名时覆盖的会是收藏稿，不会动到自己的笔记；
  索引：复用 scripts.init_db.import_vault。原文不进笔记，但也不能从检索里消失——
        另存一份去图的「检索用原文」到 clippings.index_text，import_vault 按
        source_path 取回来补成「原文存档 >」下的 chunk，问细节照样检索得到。

**同步活都丢进线程**（`asyncio.to_thread`）：httpx 抓取与 reportlab 造 PDF 都是阻塞调用，
直接跑在事件循环里，一张图片多的文章能把整个后端卡住十几秒——后台同时还有别的请求。
"""

from __future__ import annotations

import asyncio
import io
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
from xml.sax.saxutils import escape

import frontmatter
import httpx
import trafilatura
from PIL import Image
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    Image as PDFImage,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
)
from sqlalchemy import select, text
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from scripts.init_db import PROJECT_ROOT, import_vault, to_slug

from ..models import Clipping
from .agent_chat import chat_completion, llm_configured

# 公众号对非浏览器 UA 直接返回验证页，UA 不像人就什么都抓不到
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
VAULT_DIR = PROJECT_ROOT / "content" / "sample-vault"
CLIPPINGS_DIR = VAULT_DIR / "clippings"
MIN_TEXT = 200  # 正文低于此长度视为抓取失败，走粘贴降级
MIN_INDEX_CHARS = 200  # 检索用原文低于此长度：图片为主的文章，检索基本只能命中标题
MAX_URL = 2048
# 摘抄是长输出任务：8000 字输入 + 结构化输出，用闲聊那档 20s 超时会卡在边界上
LLM_SUMMARY_TIMEOUT = 90.0

SUMMARY_PROMPT = """请把下面的文章压成一篇中文摘抄，严格照下面的体例输出 Markdown：

1. 开头是一个引用块（以「> 」起行），内容就是导语本身——说清这篇讲了什么、覆盖哪几块，不超过 60 字。注意「导语」两个字只是这段的说明，不要写进输出。
2. 接着 2~4 个二级标题小节，形如「## 一、小节名」。小节名按原文自己的脉络起，不要套「是什么 / 核心观点 / 对我的启发」这类固定模板。
3. 每个小节 2~5 条要点，每条以「- 」起行，先用 ** 加粗一个关键词，再用一句话说明。只留关键概念与结论，例子和铺陈压掉。
4. 末尾用 Obsidian callout 收一句总结：第一行是「> [!tip] 一句话总结」（方括号里的类型名照抄，不要改），第二行是「> 」接那句总结本身。

只输出上述内容，体例之外一个字都不要多写。只依据原文概括，不要引入原文没有的信息；原文没有观点就少写，不要编造。

文章标题：{title}
文章正文：
{text}"""


class ClipError(Exception):
    """收藏失败，消息直接给用户看（抓不到正文、内容太短、链接不合法）。"""


# ────────────────────────────────────────────── 抓取 / 粘贴


def assert_http_url(url: str) -> str:
    """只放行 http(s)：这条管道会拿着这个地址去发请求，别的一律不认。"""
    cleaned = (url or "").strip()
    if not cleaned:
        raise ClipError("请先填文章链接")
    if len(cleaned) > MAX_URL:
        raise ClipError("链接太长了，检查一下是不是粘多了")
    if not cleaned.lower().startswith(("http://", "https://")):
        raise ClipError("链接要以 http:// 或 https:// 开头")
    return cleaned


def fetch_article(url: str) -> dict | None:
    """拉 HTML 并抽取正文，失败返回 None（调用方负责降级）。

    正文取 markdown 而不是纯文本：标题、代码块、图片链接都得留住，笔记渲染
    与 PDF 存档都靠它。元数据另用 json 输出取（一次调用只能要一种格式）。
    """
    try:
        with httpx.Client(follow_redirects=True, timeout=20) as client:
            res = client.get(url, headers={"User-Agent": BROWSER_UA})
            res.raise_for_status()
            html = res.text
    except httpx.HTTPError:
        return None
    meta_raw = trafilatura.extract(
        html, url=url, output_format="json", with_metadata=True, include_comments=False
    )
    body = trafilatura.extract(
        html,
        url=url,
        output_format="markdown",
        with_metadata=False,
        include_images=True,
        include_comments=False,
    )
    if not meta_raw or not body or len(body.strip()) < MIN_TEXT:
        return None
    return {"title": (json.loads(meta_raw).get("title") or "").strip(), "text": body.strip()}


def article_from_paste(title: str, pasted: str) -> dict | None:
    """粘贴降级：正文从表单里来，不读 stdin。

    没给标题时把第一行当标题（与 CLI 的老习惯一致）；给了标题就整段都是正文。
    正文太短说明粘错了（只粘了个标题、或复制被站点截断），返回 None 让上层报错。
    """
    lines = [line.strip() for line in (pasted or "").split("\n") if line.strip()]
    head = (title or "").strip().lstrip("#").strip()
    if head:
        body_lines = lines
    elif len(lines) >= 2:
        head, body_lines = lines[0].lstrip("#").strip(), lines[1:]
    else:
        return None
    body = "\n\n".join(body_lines)
    if len(lines) < 2 or _count_chars(body) < 40:
        return None
    return {"title": head, "text": body}


def _tidy_markdown(text: str, title: str = "") -> str:
    """规整抓来 / 粘来的正文：压掉多余空行，把正文标题整体降一级。

    降级是为了让原文章节落在笔记的 `## 原文` 之下——否则它们与笔记自己的小节
    平级，目录里会混成一片。正文自带的文章大标题（与笔记的 # 标题重复）直接
    丢掉；代码块里的 # 是注释不能碰，所以得跟着围栏走。
    """
    out: list[str] = []
    fenced = False
    dropped = False
    for raw in re.sub(r"\n{3,}", "\n\n", text.strip()).split("\n"):
        line = raw.rstrip()
        heading = HEADING_RE.match(line)
        if line.startswith("```"):
            fenced = not fenced
        elif heading and not fenced:
            level = len(heading.group(1))
            label = heading.group(2).strip().rstrip("¶").strip()
            if level == 1 and not dropped and _same_as_title(label, title):
                dropped = True
                continue
            line = f"{'#' * min(level + 1, 6)} {label}"
        out.append(line)
    return "\n".join(out).strip()


def _same_as_title(label: str, title: str) -> bool:
    """正文大标题常带 ¶ 之类的装饰符，去掉符号后按包含关系认。"""

    def clean(value: str) -> str:
        return re.sub(r"[\s¶#*_]+", "", value)

    return bool(clean(label)) and clean(label) in clean(title)


def _count_chars(text: str) -> int:
    """正文字数：先剔掉 markdown 语法噪声再数，免得图片 URL 把字数撑虚。"""
    text = INLINE_IMAGE_RE.sub("", text)
    text = INLINE_LINK_RE.sub(r"\1", text)
    return len(re.sub(r"[\s#>*`|\[\]()!\-]", "", text))


def _index_text(text: str) -> str:
    """检索用的原文：图片一律不索引，只留文字；几乎没有文字的返回空串。

    图片 URL 又长又占地方（实测周刊 414 期 44 张图，去掉后正文少 3600 字符），
    对检索更是纯噪声；“alt 有字就留下 alt”只是防个别站点真写了说明，
    实测 trafilatura 抽出来的 alt 基本是空的。

    返回空串表示「这篇没有可检索的正文」（图片为主、正文全在截图里的文章）：
    宁可让检索侧明确报异常，也不要塞占位文字假装有内容。这类文章怎么处理还没定，
    先如实标记出来 —— 图本身在 PDF 存档里，人点得开。
    """
    kept = INLINE_IMAGE_RE.sub(lambda m: m.group(1).strip(), text)
    kept = re.sub(r"\n{3,}", "\n\n", kept).strip()
    return kept if _count_chars(kept) >= MIN_INDEX_CHARS else ""


# ────────────────────────────────────────────── 总结


def _trim(text: str, limit: int = 110) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else f"{text[:limit]}……"


def _lead_paragraphs(text: str, count: int = 2) -> list[str]:
    """摘要用的开头段落：跳过标题 / 图片 / 代码围栏 / 表格这些不是正文的块。"""
    out: list[str] = []
    for para in re.split(r"\n{2,}", text):
        para = para.strip()
        if not para or para.startswith(("#", "!", "```", "|")):
            continue
        out.append(para)
        if len(out) >= count:
            break
    return out


def mock_summary(title: str, text: str) -> str:
    """无 LLM Key 的节选式摘抄：明说不是转述，与 Mock 聊天的口径一致。"""
    picks = "\n".join(f"- {_trim(p)}" for p in _lead_paragraphs(text)) or "- （原文为空）"
    return (
        f"> {title}\n\n"
        "> ⚠️ 未配置 LLM，以下为原文开头节选，不是转述。"
        "在 server/.env 配好 LLM_API_KEY 后重新收藏即可生成笔记体摘抄。\n\n"
        f"## 一、原文开头节选\n\n{picks}\n\n"
        "> （配置 LLM 后生成）"
    )


async def summarize(title: str, text: str) -> tuple[str, str]:
    """笔记体摘抄。返回 (Markdown, 来源标签：llm/mock/error)。"""
    if not llm_configured():
        return mock_summary(title, text), "mock"
    try:
        content, _model = await chat_completion(
            [
                {
                    "role": "system",
                    "content": "你是一个严谨的知识管理助手，擅长把长文压成一篇可检索的结构化摘抄。",
                },
                {
                    "role": "user",
                    "content": SUMMARY_PROMPT.format(title=title, text=text[:8000]),
                },
            ],
            temperature=0.3,
            timeout=LLM_SUMMARY_TIMEOUT,
        )
        return content, "llm"
    except Exception as err:  # 总结失败不该丢原文：照常入库，摘要位留痕
        return f"（总结失败：{err}。原文全文已保存，可手动补摘要。）", "error"


def one_liner(summary_md: str, title: str) -> str:
    """取摘抄开头的导语当 frontmatter summary；开头不是引用块（如总结失败）就退回标题。"""
    for raw in summary_md.split("\n"):
        line = raw.strip()
        if not line:
            continue
        return _trim(line.lstrip(">").strip(), 80) if line.startswith(">") else title
    return title


# ────────────────────────────────────────────── 原文 PDF 存档

PDF_FONT = "STSong-Light"  # reportlab 内置 CID 中文字体，不依赖任何字体文件
BODY_WIDTH = A4[0] - 40 * mm  # 与 SimpleDocTemplate 左右边距一致，图片按它缩放
BODY_HEIGHT = A4[1] - 40 * mm  # 一页的可用高度，图片最多只能占九成
IMAGE_PX = 760  # 嵌图前缩到这个像素宽：铺满正文约 105 DPI，够看且体积可控
CODE_COLS = 100  # 代码折行阈值（半角算 1、全角算 2）；8.5pt 下约 425pt，留足余量

IMAGE_LINE_RE = re.compile(r"^!\[([^\]]*)\]\(([^)\s]+)\)$")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
BULLET_RE = re.compile(r"^(?:[-*+]|\d+[.)])\s+")
INLINE_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
INLINE_LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)\s]+)\)")
INLINE_CODE_RE = re.compile(r"`([^`]+)`")
STRONG_RE = re.compile(r"(\*\*|__)(.+?)\1")
EM_RE = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
# 下划线斜体要求两侧不是单词字符，否则 snake_case_name 会被当成斜体拆开
UNDERSCORE_EM_RE = re.compile(r"(?<![\w])_([^_\n]+)_(?![\w])")
INLINE_ESCAPE_RE = re.compile(r"\\([\\`*_{}\[\]()#+\-.!>~|])")
# CID 字体里 U+2019 是全角宽（11pt），夹在西文字母之间会把 isn’t 撑成 isn’ t
CURLY_APOSTROPHE_RE = re.compile(r"(?<=[A-Za-z])[\u2018\u2019](?=[A-Za-z])")

_STYLES: dict = {}


def _pdf_styles() -> dict:
    """PDF 段落样式。构造一次缓存起来，省得每个 helper 都多传一个 styles 参数。"""
    if _STYLES:
        return _STYLES
    # 样式依赖这个字体，注册就放一起，任何入口进来都不会漏
    pdfmetrics.registerFont(UnicodeCIDFont(PDF_FONT))
    _STYLES.update(
        {
            "title": ParagraphStyle("title", fontName=PDF_FONT, fontSize=17, leading=25, spaceAfter=10),
            "meta": ParagraphStyle(
                "meta",
                fontName=PDF_FONT,
                fontSize=9.5,
                leading=15,
                textColor=HexColor("#666666"),
                spaceAfter=3,
            ),
            "body": ParagraphStyle(
                "body", fontName=PDF_FONT, fontSize=11, leading=18, spaceAfter=7, firstLineIndent=22
            ),
            "bullet": ParagraphStyle(
                "bullet", fontName=PDF_FONT, fontSize=11, leading=18, spaceAfter=5,
                leftIndent=24, firstLineIndent=-12,
            ),
            "quote": ParagraphStyle(
                "quote", fontName=PDF_FONT, fontSize=10.5, leading=17, spaceAfter=7,
                leftIndent=18, textColor=HexColor("#555555"),
            ),
            "h1": ParagraphStyle(
                "h1", fontName=PDF_FONT, fontSize=15, leading=22, spaceBefore=12, spaceAfter=7
            ),
            "h2": ParagraphStyle(
                "h2", fontName=PDF_FONT, fontSize=13, leading=20, spaceBefore=10, spaceAfter=6
            ),
            "h3": ParagraphStyle(
                "h3", fontName=PDF_FONT, fontSize=11.5, leading=18, spaceBefore=8, spaceAfter=5
            ),
            "code": ParagraphStyle("code", fontName=PDF_FONT, fontSize=8.5, leading=12.5),
            "cell": ParagraphStyle("cell", fontName=PDF_FONT, fontSize=9.5, leading=14),
            "caption": ParagraphStyle(
                "caption", fontName=PDF_FONT, fontSize=9, leading=14,
                textColor=HexColor("#666666"), spaceAfter=8,
            ),
        }
    )
    return _STYLES


def _inline_xml(text: str) -> str:
    """markdown 行内标记 → reportlab 的 XML 片段（先转义再替换，顺序不能反）。

    CID 字体没有粗斜体字形，**粗体**/_斜体_ 只剥标记不加样式：PDF 是存档，
    字面正确比视觉强调重要。链接转成可点击的 <a>。
    """
    text = escape(text)
    text = INLINE_IMAGE_RE.sub(
        lambda m: f"［图片：{m.group(1)}］" if m.group(1) else "［图片］", text
    )
    text = INLINE_LINK_RE.sub(
        lambda m: f'<a href="{m.group(2)}">{m.group(1) or m.group(2)}</a>', text
    )
    text = INLINE_CODE_RE.sub(lambda m: m.group(1), text)
    text = STRONG_RE.sub(lambda m: m.group(2), text)
    text = EM_RE.sub(lambda m: m.group(1), text)
    text = UNDERSCORE_EM_RE.sub(lambda m: m.group(1), text)
    # 转义反斜杠（\[ \] \* 这些）留到最后还原，否则会被上面的标记正则先吃掉
    return CURLY_APOSTROPHE_RE.sub("'", INLINE_ESCAPE_RE.sub(r"\1", text))


def _display_width(line: str) -> int:
    """等宽字体下的显示宽度：CJK 全角算 2，其余算 1。"""
    return sum(2 if ord(ch) > 0x2E7F else 1 for ch in line)


def _wrap_code(code: str, limit: int = CODE_COLS) -> str:
    """按显示宽度硬折行——Preformatted 不自动折行，长行会直接溢出页面。"""
    out: list[str] = []
    for line in code.split("\n"):
        rest = line.rstrip()
        while _display_width(rest) > limit:
            cut, width = 0, 0
            for ch in rest:
                width += 2 if ord(ch) > 0x2E7F else 1
                if width > limit:
                    break
                cut += 1
            out.append(rest[:cut])
            rest = rest[cut:]
        out.append(rest)
    return "\n".join(out)


def _code_block(code: str):
    """代码块：灰底方框 + 等宽字体（CID 字体的 ASCII 本身就是等宽）。"""
    block = Preformatted(_wrap_code(code.rstrip("\n")), _pdf_styles()["code"])
    return Table(
        [[block]],
        colWidths=[BODY_WIDTH],
        style=[
            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#F6F7F9")),
            ("BOX", (0, 0), (-1, -1), 0.4, HexColor("#DDE1E6")),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ],
    )


def _to_jpeg(raw: bytes) -> bytes | None:
    """统一转 JPEG。reportlab 对 JPEG 走 DCTDecode 直通，其它格式会被解成位图再
    用 Flate 重压，体积差好几倍。透明贴白底（JPEG 没有 alpha 通道）。"""
    try:
        im = Image.open(io.BytesIO(raw))
        if "A" in im.getbands():
            rgba = im.convert("RGBA")
            flat = Image.new("RGB", rgba.size, (255, 255, 255))
            flat.paste(rgba, mask=rgba.split()[-1])
            im = flat
        else:
            im = im.convert("RGB")
    except Exception:
        return None
    if im.width > IMAGE_PX:
        im = im.resize((IMAGE_PX, round(im.height * IMAGE_PX / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=70, optimize=True)
    return buf.getvalue()


def _pdf_image(alt: str, src: str, client: httpx.Client, referer: str):
    """下载图片并嵌入。失败降级成文字占位——存档不能因为一张图抓不到就中断。"""
    try:
        res = client.get(src, headers={"Referer": referer})
        res.raise_for_status()
        jpeg = _to_jpeg(res.content)
    except Exception:
        jpeg = None
    if jpeg is None:
        label = f"［图片未存档：{alt}］" if alt else "［图片未存档］"
        return Paragraph(escape(label), _pdf_styles()["caption"])
    img = PDFImage(io.BytesIO(jpeg))
    # 宽高都要卡：竖图只按宽度缩放会高过整页，reportlab 直接甩 too large
    scale = min(1.0, BODY_WIDTH / img.imageWidth, BODY_HEIGHT * 0.9 / img.imageHeight)
    img.drawWidth = img.imageWidth * scale
    img.drawHeight = img.imageHeight * scale
    img.hAlign = "CENTER"
    img.spaceAfter = 8
    return img


def _take_fence(lines: list[str], start: int) -> tuple[list[str], int]:
    """取一段 ``` 代码块，返回 (代码行, 下一行下标)。"""
    body: list[str] = []
    i = start + 1
    while i < len(lines) and not lines[i].startswith("```"):
        body.append(lines[i])
        i += 1
    return body, min(i + 1, len(lines))


def _take_table(lines: list[str], start: int) -> tuple[list[list[str]], int]:
    """取一段 | a | b | 表格，丢掉 |---|---| 分隔行（它不是数据）。"""
    rows: list[list[str]] = []
    i = start
    while i < len(lines) and lines[i].lstrip().startswith("|"):
        cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
        if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
            rows.append(cells)
        i += 1
    return rows, i


def _take_paragraph(lines: list[str], start: int) -> tuple[str, int]:
    """取一个自然段（连续非空行），软换行合并成一行。"""
    buf: list[str] = []
    i = start
    while i < len(lines) and lines[i].strip():
        buf.append(lines[i].strip())
        i += 1
    return " ".join(buf), i


def _table_flowable(rows: list[list[str]]):
    cols = max(len(r) for r in rows)
    cells = [[Paragraph(_inline_xml(c), _pdf_styles()["cell"]) for c in r + [""] * (cols - len(r))]
             for r in rows]
    return Table(
        cells,
        colWidths=[BODY_WIDTH / cols] * cols,
        style=[
            ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#DDE1E6")),
            ("BACKGROUND", (0, 0), (-1, 0), HexColor("#F6F7F9")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ],
    )


def _pdf_flowables(md: str, client: httpx.Client, referer: str) -> list:
    """markdown 正文 → flowable 列表，保持原文顺序。"""
    out: list = []
    lines = md.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("```"):
            code, i = _take_fence(lines, i)
            out.append(_code_block("\n".join(code)))
            continue
        image = IMAGE_LINE_RE.match(line.strip())
        if image:
            out.append(_pdf_image(image.group(1), image.group(2), client, referer))
            i += 1
            continue
        if line.lstrip().startswith("|"):
            rows, i = _take_table(lines, i)
            if rows:
                out.append(_table_flowable(rows))
            continue
        heading = HEADING_RE.match(line)
        if heading:
            level = min(len(heading.group(1)), 3)
            out.append(Paragraph(_inline_xml(heading.group(2)), _pdf_styles()[f"h{level}"]))
            i += 1
            continue
        text, i = _take_paragraph(lines, i)
        if text.startswith(">"):
            out.append(Paragraph(_inline_xml(text.lstrip("> ").strip()), _pdf_styles()["quote"]))
        elif BULLET_RE.match(text):
            out.append(Paragraph(_inline_xml(text), _pdf_styles()["bullet"]))
        else:
            out.append(Paragraph(_inline_xml(text), _pdf_styles()["body"]))
    return out


def build_pdf(title: str, url: str, text: str) -> bytes:
    """把原文渲染成 PDF 存档字节。

    保留标题层级、代码块、图片与表格；图片抓不到就降级成文字占位——
    存档的目的是防链接失效、供总结交叉验证，不是复刻网页样式。
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=title,
        author="微信收藏管道",
    )
    story = [
        Paragraph(escape(title), _pdf_styles()["title"]),
        Paragraph(f"来源：{escape(url)}", _pdf_styles()["meta"]),
        Paragraph(
            f"收藏存档 · {date.today().isoformat()} · 由「微信收藏」管道自动生成",
            _pdf_styles()["meta"],
        ),
        Spacer(1, 14),
    ]
    # 图片要现场下载，图片密集的文章会慢十几秒；串行够用，不值得为此上并发
    with httpx.Client(follow_redirects=True, timeout=25, headers={"User-Agent": BROWSER_UA}) as client:
        story += _pdf_flowables(text, client, url)
    doc.build(story)
    return buf.getvalue()


# ────────────────────────────────────────────── 入库


def write_note(
    url: str, title: str, summary_md: str, text: str, source_path: str = "", pdf_ready: bool = True
) -> Path:
    """写 Obsidian 格式收藏笔记。source_path 非空表示重复收藏，原地更新。"""
    CLIPPINGS_DIR.mkdir(parents=True, exist_ok=True)
    rel = source_path or f"clippings/clip-{to_slug(title) or to_slug(url)}.md"
    path = VAULT_DIR / rel
    chars = _count_chars(text)
    if pdf_ready:
        # 同源相对链接：Next 侧把 /api 代理到后端，博客里点开就是 PDF
        pdf_section = (
            "## 原文 PDF\n\n"
            "本文的 AI 摘抄自以下文档；PDF 是收藏时留存的原文全文，原链接失效也能看：\n\n"
            f"- 《{title}》· {chars} 字 · [打开原文 PDF](/api/clippings/pdf?url={quote(url)})\n\n"
        )
        # 原文只留 PDF 这一份：笔记里再贴一遍，读的时候同一篇内容要读两遍
        original_section = ""
    else:
        pdf_section = "## 原文 PDF\n\n（存档生成失败，原文全文见下方。）\n\n"
        # 存档没成，原文就是唯一副本，必须留在笔记里
        original_section = f"## 原文\n\n{text}\n"
    note = frontmatter.Post(
        content=(
            f"# {title}\n\n"
            f"> 来源：[{url}]({url}) · 收藏于 {date.today().isoformat()} · "
            "本文由收藏管道自动整理\n\n"
            f"{summary_md}\n\n"
            f"{pdf_section}"
            f"{original_section}"
        ),
        title=title,
        category="clippings",
        tags=["收藏"],
        date=date.today().isoformat(),
        summary=one_liner(summary_md, title),
        source=url,
    )
    path.write_text(frontmatter.dumps(note), encoding="utf-8")
    return Path(rel)


async def record_clipping(
    session: AsyncSession,
    url: str,
    title: str,
    rel_path: str,
    origin: str,
    words: int,
    pdf: bytes | None = None,
    index_body: str = "",
) -> None:
    """落 clippings 表：URL 唯一，重复收藏同一链接只更新不新增。

    pdf 为 None（本次生成失败）时保留库里的旧存档，不把好数据冲掉。
    index_body 是检索用原文（已去图）：笔记里没有原文，它才是 RAG 的唯一来源，
    由 init_db.import_vault 补成 chunk；为空同样保留库里的旧值。
    """
    updates: dict = {
        "title": title,
        "source_path": rel_path,
        "origin": origin,
        "word_count": words,
        # text() 包一下：裸字符串会被当绑定参数，DateTime 列直接拒收
        "updated_at": text("datetime('now')"),
    }
    values = {
        "url": url,
        "title": title,
        "source_path": rel_path,
        "origin": origin,
        "word_count": words,
    }
    if pdf is not None:
        values["pdf"] = pdf
        updates["pdf"] = pdf
    if index_body:
        values["index_text"] = index_body
        updates["index_text"] = index_body
    stmt = (
        insert(Clipping)
        .values(**values)
        .on_conflict_do_update(index_elements=[Clipping.url], set_=updates)
    )
    await session.execute(stmt)
    await session.commit()


async def find_clipping(session: AsyncSession, url: str) -> Clipping | None:
    return (
        await session.execute(select(Clipping).where(Clipping.url == url))
    ).scalar_one_or_none()


async def list_clippings(session: AsyncSession) -> list[Clipping]:
    """后台列表用：新的在前。"""
    return list(
        (
            await session.execute(select(Clipping).order_by(Clipping.created_at.desc()))
        ).scalars().all()
    )


async def remove_clipping(session: AsyncSession, clipping: Clipping) -> dict:
    """删收藏：文件 → clippings 行 → 由它导入的 post（连带 chunks/links/post_tags）。

    只删 clippings 行是不够的：import_vault 只 upsert 从不删，Post 会留在库里
    继续被检索到、继续出现在 /timeline。所以按 source_path 算出 slug 一起删掉。
    """
    from sqlalchemy import delete

    from ..models import Post, PostTag, Tag

    removed_file = False
    slug = ""
    if clipping.source_path:
        path = VAULT_DIR / clipping.source_path
        removed_file = path.exists()
        path.unlink(missing_ok=True)
        slug = to_slug(Path(clipping.source_path).stem)
    await session.execute(delete(Clipping).where(Clipping.id == clipping.id))
    if slug:
        post = (
            await session.execute(select(Post).where(Post.slug == slug))
        ).scalar_one_or_none()
        if post is not None:
            await session.execute(delete(Post).where(Post.id == post.id))
            await session.execute(delete(Tag).where(Tag.id.not_in(select(PostTag.tag_id))))
    await session.commit()
    return {"ok": True, "slug": slug, "removedFile": removed_file}


# ────────────────────────────────────────────── 主流程


def _day(value: datetime) -> str:
    """ORM 读回来的 created_at 是 datetime 对象，统一格式化成 YYYY-MM-DD。"""
    return value.strftime("%Y-%m-%d")


async def run_clip(
    url: str,
    *,
    session: AsyncSession,
    paste_text: str = "",
    title: str = "",
    log: Callable[[str, str], None] | None = None,
) -> dict[str, Any]:
    """跑完整条管道，返回可序列化的结果（与前端类型逐字对应）。

    log(步骤, 细节) 用来把进度打给 CLI / 后端日志；失败抛 ClipError，消息可直接展示。
    同步的抓取与 PDF 生成放到线程里跑，别卡住事件循环。
    """
    steps: list[dict[str, str]] = []

    def step(label: str, detail: str = "") -> None:
        steps.append({"label": label, "detail": detail})
        if log is not None:
            log(label, detail)

    cleaned = assert_http_url(url)
    existing = await find_clipping(session, cleaned)
    updated = existing is not None
    if updated:
        step("重复收藏", f"这个链接 {_day(existing.created_at)} 收藏过，原地更新")

    if paste_text.strip():
        article = article_from_paste(title, paste_text)
        if article is None:
            raise ClipError("粘贴的正文太短了：至少要有两行、40 字以上，把全文贴进来")
        origin = "paste"
        step("使用粘贴正文", f"{_count_chars(article['text'])} 字")
    else:
        step("抓取正文", cleaned)
        article = await asyncio.to_thread(fetch_article, cleaned)
        origin = "web"
        if article is None:
            raise ClipError(
                "抓不到正文：公众号等站点的反爬会返回验证页。把全文复制粘贴到「正文」里再试一次。"
            )
    if not article.get("title"):
        article["title"] = paste_title_fallback(cleaned)
    article["text"] = _tidy_markdown(article["text"], article["title"])
    chars = _count_chars(article["text"])
    step("正文就绪", f"《{article['title']}》· {chars} 字")

    summary_md, summary_source = await summarize(article["title"], article["text"])
    step(
        "生成摘抄",
        {
            "llm": "模型按笔记体例生成",
            "mock": "未配 LLM，输出原文节选（明确标注不是转述）",
            "error": "模型调用失败，原文照常入库，摘要位留痕",
        }.get(summary_source, summary_source),
    )

    pdf: bytes | None
    try:
        pdf = await asyncio.to_thread(build_pdf, article["title"], cleaned, article["text"])
        step("生成原文 PDF", f"{len(pdf) // 1024} KB")
    except Exception as err:  # PDF 是增强不是前提：失败了照常收藏
        pdf = None
        step("生成原文 PDF", f"失败（{err}），原文改为贴进笔记")

    rel = write_note(
        cleaned,
        article["title"],
        summary_md,
        article["text"],
        source_path=existing.source_path if existing else "",
        pdf_ready=pdf is not None,
    )
    # 原文只进索引不进笔记：笔记里是给人读的总结，检索要的是原文的字
    index_body = _index_text(article["text"])
    await record_clipping(
        session, cleaned, article["title"], rel.as_posix(), origin, chars, pdf, index_body
    )
    step("写入笔记", rel.as_posix())

    stats = await import_vault(session, VAULT_DIR)
    step("重建索引", f"{stats['posts']} 篇 · {stats['chunks']} 块")
    if index_body:
        step("检索用原文", f"{len(index_body)} 字符（已去图，只在索引里）")

    row = await find_clipping(session, cleaned)
    return {
        "ok": True,
        "id": row.id if row is not None else 0,
        "url": cleaned,
        "title": article["title"],
        "slug": to_slug(Path(rel).stem),
        "sourcePath": rel.as_posix(),
        "origin": origin,
        "updated": updated,
        "chars": chars,
        "summarySource": summary_source,
        "pdfBytes": len(pdf) if pdf else 0,
        "indexable": bool(index_body),
        "steps": steps,
        "stats": stats,
    }


def paste_title_fallback(url: str) -> str:
    """抓不到标题时的兜底：用域名 + 路径尾段，总比空标题强。"""
    stripped = re.sub(r"^https?://", "", url).rstrip("/")
    tail = stripped.split("/")[-1] or stripped
    return tail[:60] or "未命名收藏"
