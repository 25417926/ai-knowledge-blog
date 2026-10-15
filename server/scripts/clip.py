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
from reportlab.lib.colors import HexColor  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.pdfbase import pdfmetrics  # noqa: E402
from reportlab.pdfbase.cidfonts import UnicodeCIDFont  # noqa: E402
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer  # noqa: E402
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
    """拉 HTML 并抽取正文，失败返回 None（调用方负责降级）。"""
    try:
        with httpx.Client(follow_redirects=True, timeout=20) as client:
            res = client.get(url, headers={"User-Agent": BROWSER_UA})
            res.raise_for_status()
            html = res.text
    except httpx.HTTPError as err:
        print(f"  × 请求失败：{err}")
        return None
    data = trafilatura.extract(
        html, url=url, output_format="json", with_metadata=True, include_comments=False
    )
    if not data:
        return None
    parsed = json.loads(data)
    text = (parsed.get("text") or "").strip()
    if len(text) < MIN_TEXT:
        return None
    return {"title": (parsed.get("title") or "").strip(), "text": text}


def paste_article() -> dict | None:
    """交互式粘贴：第一行当标题，其余当正文，Ctrl+Z 回车结束。"""
    print("  请从浏览器全选复制文章正文，粘贴到下面（第一行作为标题）。")
    print("  输入完成后按 Ctrl+Z（Windows）/ Ctrl+D（macOS）回车结束：")
    lines = [line.strip() for line in sys.stdin.read().split("\n") if line.strip()]
    if len(lines) < 2:
        print("  × 内容太短，已取消")
        return None
    return {"title": lines[0].lstrip("# ").strip(), "text": "\n\n".join(lines[1:])}


# ────────────────────────────────────────────── 总结


def _trim(text: str, limit: int = 110) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else f"{text[:limit]}……"


def mock_summary(title: str, text: str) -> str:
    """无 LLM Key 的节选式总结：明说不是转述，与 Mock 聊天的口径一致。"""
    paras = [p for p in re.split(r"\n{2,}", text) if p.strip()]
    picks = "\n".join(f"> {_trim(p)}" for p in paras[:2]) or "> （原文为空）"
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


def build_pdf(title: str, url: str, text: str) -> bytes:
    """把原文渲染成 PDF 存档字节。

    只存文字：图片与网页样式会丢，但可检索、可对照的文字全部保留——
    存档的目的是防链接失效、供总结交叉验证，不是复刻网页。
    """
    pdfmetrics.registerFont(UnicodeCIDFont(PDF_FONT))
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
    styles = {
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
    }
    story = [
        Paragraph(escape(title), styles["title"]),
        Paragraph(f"来源：{escape(url)}", styles["meta"]),
        Paragraph(
            f"收藏存档 · {date.today().isoformat()} · 由「微信收藏」管道自动生成",
            styles["meta"],
        ),
        Spacer(1, 14),
    ]
    for para in re.split(r"\n{2,}", text):
        cleaned = " ".join(line.strip() for line in para.split("\n") if line.strip())
        if cleaned:
            story.append(Paragraph(escape(cleaned), styles["body"]))
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
    chars = len(re.sub(r"\s", "", text))
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
    chars = len(re.sub(r"\s", "", article["text"]))
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
    await record_clipping(url, article["title"], rel, origin, len(article["text"]), pdf)
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
