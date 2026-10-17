"""微信收藏 → 知识库管道（CLI 入口）。

流程本体在 `app/services/clipping.py`（后台 `POST /api/admin/clippings` 用的是同一份），
这里只负责参数解析、读标准输入与打印进度：

    python -m scripts.clip <url>            # 抓取 → 总结 → 入库 → 建索引
    python -m scripts.clip <url> --paste    # 公众号反爬：跳过抓取，粘贴全文
    python -m scripts.clip --list           # 看看已经收藏了什么
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(SERVER_DIR / ".env")

from app.database import AsyncSessionLocal, init_schema  # noqa: E402
from app.services import clipping as svc  # noqa: E402
from app.services.agent_chat import configure_llm  # noqa: E402


def _read_paste() -> str:
    """交互式粘贴：第一行当标题，其余当正文，Ctrl+Z 回车结束。"""
    print("  请从浏览器全选复制文章正文，粘贴到下面（第一行作为标题）。")
    print("  输入完成后按 Ctrl+Z（Windows）/ Ctrl+D（macOS）回车结束：")
    return sys.stdin.read()


def _log(label: str, detail: str) -> None:
    print(f"  · {label}{f'：{detail}' if detail else ''}")


async def list_clippings() -> None:
    async with AsyncSessionLocal() as session:
        rows = await svc.list_clippings(session)
    if not rows:
        print("还没有收藏任何文章")
        return
    for row in rows:
        day = row.created_at.strftime("%Y-%m-%d") if row.created_at else ""
        print(f"  [{day}] {row.title}  ({row.origin})\n      {row.url}")


async def clip(url: str, paste: bool) -> None:
    text = _read_paste() if paste else ""
    async with AsyncSessionLocal() as session:
        try:
            result = await svc.run_clip(url, session=session, paste_text=text, log=_log)
        except svc.ClipError as err:
            print(f"× {err}")
            return
    print(
        f"✓ 已收藏《{result['title']}》→ {result['sourcePath']}"
        f"（{result['stats']['posts']} 篇 / {result['stats']['chunks']} 块，可被检索）"
    )


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
