"""微信收藏 → 知识库管道（CLI 版）。

用户动作只有两步：浏览器打开文章 → 复制链接。剩下的交给这条管道：

    python -m scripts.clip <url>            # 抓取 → 总结 → 入库 → 建索引
    python -m scripts.clip <url> --paste    # 公众号反爬：跳过抓取，粘贴全文
    python -m scripts.clip --list           # 看看已经收藏了什么

四段流水线（收集段的去重任 clippings 表的 URL 唯一约束）：
  抓取：httpx 带浏览器 UA 拉 HTML，trafilatura 抽正文；失败或正文过短
        （公众号反爬的典型表现）自动降级为粘贴模式；
  总结：三段式（是什么 / 核心观点 / 对我的启发）；无 LLM Key 时出节选式
        Mock 总结，并明说「这是节选不是转述」；
  入库：写 content/sample-vault/clippings/ 下的 Obsidian 格式笔记。
        文件名带 clip- 前缀——手写笔记是裸标题，撞名时覆盖的会是收藏稿，
        不会动到自己的笔记。原文同时渲染成 PDF 存档进 clippings.pdf 列，
        笔记里列出「总结自哪些文档」并给同源下载链接；
  索引：直接复用 scripts.init_db.import_vault，零改动，收藏即进 RAG。
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path
from urllib.parse import quote

SERVER_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = SERVER_DIR.parent
sys.path.insert(0, str(SERVER_DIR))

import frontmatter  # noqa: E402
import httpx  # noqa: E402
import trafilatura  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from PIL import Image  # noqa: E402
from reportlab.lib.colors import HexColor  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.pdfbase import pdfmetrics  # noqa: E402
from reportlab.pdfbase.cidfonts import UnicodeCIDFont  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    Image as PDFImage,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
)
from sqlalchemy import select, text  # noqa: E402
from sqlalchemy.dialects.sqlite import insert  # noqa: E402
from xml.sax.saxutils import escape  # noqa: E402

load_dotenv(SERVER_DIR / ".env")

from app.database import AsyncSessionLocal, init_schema  # noqa: E402
from app.models import Clipping  # noqa: E402
from app.services.agent_chat import chat_completion, configure_llm, llm_configured  # noqa: E402
from scripts.init_db import import_vault, to_slug  # noqa: E402

# 公众号对非浏览器 UA 直接返回验证页，UA 不像人就什么都抓不到
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
VAULT_DIR = PROJECT_ROOT / "content" / "sample-vault"
CLIPPINGS_DIR = VAULT_DIR / "clippings"
MIN_TEXT = 200  # 正文低于此长度视为抓取失败，走粘贴降级

SUMMARY_PROMPT = """请基于下面的文章全文写三段式中文摘要，严格按以下结构输出 Markdown，不要输出结构之外的任何内容：

### 是什么
一句话说明这篇文章讲什么，不超过 50 字。

### 核心观点
列出 3~5 个关键论点或知识点，每点一行，以 - 开头。

### 对我的启发
这篇文章对一个正在学习 AI / Java 技术栈的开发者有什么可借鉴之处，1~2 句。

要求：只依据原文概括，不要引入原文没有的信息；原文没有明显观点就少写，不要编造。

文章标题：{title}
文章正文：
{text}"""


# ────────────────────────────────────────────── 抓取 / 粘贴


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
    except httpx.HTTPError as err:
        print(f"  × 请求失败：{err}")
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


def paste_article() -> dict | None:
    """交互式粘贴：第一行当标题，其余当正文，Ctrl+Z 回车结束。"""
    print("  请从浏览器全选复制文章正文，粘贴到下面（第一行作为标题）。")
    print("  输入完成后按 Ctrl+Z（Windows）/ Ctrl+D（macOS）回车结束：")
    lines = [line.strip() for line in sys.stdin.read().split("\n") if line.strip()]
    if len(lines) < 2:
        print("  × 内容太短，已取消")
        return None
    return {"title": lines[0].lstrip("# ").strip(), "text": "\n\n".join(lines[1:])}


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
    """无 LLM Key 的节选式总结：明说不是转述，与 Mock 聊天的口径一致。"""
    picks = "\n".join(f"> {_trim(p)}" for p in _lead_paragraphs(text)) or "> （原文为空）"
    return (
        "> ⚠️ 未配置 LLM，以下是原文开头节选，不是转述。"
        "在 server/.env 配好 LLM_API_KEY 后重新收藏即可生成三段式总结。\n\n"
        f"### 是什么\n{title}\n\n"
        f"### 核心观点\n{picks}\n\n"
        "### 对我的启发\n（配置 LLM 后生成）"
    )


async def summarize(title: str, text: str) -> tuple[str, str]:
    """三段式总结。返回 (Markdown, 来源标签：llm/mock/error)。"""
    if not llm_configured():
        return mock_summary(title, text), "mock"
    try:
        content, _model = await chat_completion(
            [
                {
                    "role": "system",
                    "content": "你是一个严谨的知识管理助手，擅长把长文压缩成可检索的结构化摘要。",
                },
                {
                    "role": "user",
                    "content": SUMMARY_PROMPT.format(title=title, text=text[:8000]),
                },
            ],
            temperature=0.3,
        )
        return content, "llm"
    except Exception as err:  # 总结失败不该丢原文：照常入库，摘要位留痕
        return f"（总结失败：{err}。原文全文已保存，可手动补摘要。）", "error"


def one_liner(summary_md: str, title: str) -> str:
    """从「是什么」小节取一句话当 frontmatter summary；取不到就用标题。"""
    match = re.search(r"###\s*是什么\s*\n+(.+)", summary_md)
    line = match.group(1).strip() if match else ""
    return _trim(line, 80) if line else title


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
    images = 0
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
            images += 1
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
    if images:
        print(f"  · 正文 {images} 张图片，正在下载嵌入")
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
            "本文的 AI 总结自以下文档；PDF 是收藏时留存的原文存档，原链接失效也能看：\n\n"
            f"- 《{title}》· {chars} 字 · [打开原文 PDF](/api/clippings/pdf?url={quote(url)})\n\n"
        )
    else:
        pdf_section = "## 原文 PDF\n\n（PDF 存档生成失败，仅保留下方原文文本。）\n\n"
    note = frontmatter.Post(
        content=(
            f"# {title}\n\n"
            f"> 来源：[{url}]({url}) · 收藏于 {date.today().isoformat()} · "
            "本文由收藏管道自动整理\n\n"
            f"## 三段式总结\n\n{summary_md}\n\n"
            f"{pdf_section}"
            f"## 原文\n\n{text}\n"
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
    url: str, title: str, rel_path: str, origin: str, words: int, pdf: bytes | None = None
) -> None:
    """落 clippings 表：URL 唯一，重复收藏同一链接只更新不新增。

    pdf 为 None（本次生成失败）时保留库里的旧存档，不把好数据冲掉。
    """
    updates: dict = {
        "title": title,
        "source_path": rel_path.as_posix(),
        "origin": origin,
        "word_count": words,
        "updated_at": text("datetime('now')"),
    }
    values = {
        "url": url,
        "title": title,
        "source_path": rel_path.as_posix(),
        "origin": origin,
        "word_count": words,
    }
    if pdf is not None:
        values["pdf"] = pdf
        updates["pdf"] = pdf
    stmt = (
        insert(Clipping)
        .values(**values)
        .on_conflict_do_update(index_elements=[Clipping.url], set_=updates)
    )
    async with AsyncSessionLocal() as session:
        await session.execute(stmt)
        await session.commit()


async def find_clipping(url: str) -> Clipping | None:
    async with AsyncSessionLocal() as session:
        return (
            await session.execute(select(Clipping).where(Clipping.url == url))
        ).scalar_one_or_none()


# ────────────────────────────────────────────── 主流程


def _day(value: datetime) -> str:
    """ORM 读回来的 created_at 是 datetime 对象，统一格式化成 YYYY-MM-DD。"""
    return value.strftime("%Y-%m-%d")


async def collect(url: str, paste: bool) -> tuple[dict, str] | None:
    """抓取（失败降级粘贴）。返回 (文章, 来源标签) 或 None。"""
    article, origin = None, "web"
    if not paste:
        print(f"▸ 抓取 {url}")
        article = fetch_article(url)
        if article is None:
            print("  × 抓取失败或正文过短（公众号反爬的典型表现），切换为粘贴模式")
    if article is None:
        article = paste_article()
        origin = "paste"
    if article is None or not article.get("title"):
        return None
    article["text"] = _tidy_markdown(article["text"], article["title"])
    return article, origin


async def clip(url: str, paste: bool) -> None:
    existing = await find_clipping(url)
    if existing:
        print(f"  · 这个链接之前收藏过（{_day(existing.created_at)}），将原地更新")

    collected = await collect(url, paste)
    if collected is None:
        print("× 没有拿到文章内容，取消收藏")
        return
    article, origin = collected
    chars = _count_chars(article["text"])
    print(f"  ✓ 《{article['title']}》· {chars} 字")

    print("▸ 生成三段式总结")
    summary_md, tag = await summarize(article["title"], article["text"])
    print(f"  ✓ 总结完成（{tag}）")

    print("▸ 生成原文 PDF 存档")
    try:
        pdf = build_pdf(article["title"], url, article["text"])
        print(f"  ✓ PDF {len(pdf) // 1024} KB，随笔记一起入库")
    except Exception as err:  # PDF 是增强不是前提：失败了照常收藏
        pdf = None
        print(f"  × PDF 生成失败（{err}），笔记不带存档链接")

    print("▸ 写入 Obsidian 笔记")
    rel = write_note(
        url,
        article["title"],
        summary_md,
        article["text"],
        source_path=existing.source_path if existing else "",
        pdf_ready=pdf is not None,
    )
    await record_clipping(url, article["title"], rel, origin, chars, pdf)
    print(f"  ✓ {rel.as_posix()}")

    print("▸ 建索引（复用 vault 导入）")
    async with AsyncSessionLocal() as session:
        stats = await import_vault(session, VAULT_DIR)
    print(f"  ✓ 全库文章 {stats['posts']} 篇 · 切分块 {stats['chunks']} 个，收藏已可被检索")


async def list_clippings() -> None:
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(select(Clipping).order_by(Clipping.created_at.desc()))
        ).scalars().all()
    if not rows:
        print("还没有收藏任何文章")
        return
    for row in rows:
        print(f"  [{_day(row.created_at)}] {row.title}  ({row.origin})\n      {row.url}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="clip", description="微信收藏 → 知识库管道：抓取、总结、入库、建索引一条龙"
    )
    parser.add_argument("url", nargs="?", help="文章链接（公众号/网页均可）")
    parser.add_argument("--paste", action="store_true", help="跳过抓取，直接粘贴全文")
    parser.add_argument("--list", action="store_true", help="列出已收藏的文章")
    return parser.parse_args(argv)


async def main() -> None:
    args = parse_args()
    configure_llm(
        os.environ.get("LLM_BASE_URL", ""),
        os.environ.get("LLM_API_KEY", ""),
        os.environ.get("LLM_MODEL", ""),
    )
    await init_schema()

    if args.list:
        await list_clippings()
        return
    if not args.url:
        print("用法：python -m scripts.clip <url> [--paste]，或 --list 查看已收藏")
        return
    await clip(args.url, args.paste)


if __name__ == "__main__":
    asyncio.run(main())
