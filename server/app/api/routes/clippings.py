"""收藏管道接口：原文 PDF 存档下载。

按 URL 命中（clippings 表的唯一约束）：链接是谁的就是谁的存档，前端不用传 id。
同源相对路径 /api/clippings/pdf?url=... 由 Next 的 rewrites 代理到后端，
收藏笔记的「原文 PDF」区和助手出处卡片的「对照原文 PDF」都直接链它。
"""

from __future__ import annotations

import io
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_session
from ...models import Clipping

router = APIRouter()


@router.get("/clippings/pdf")
async def clipping_pdf(
    url: str = Query(..., description="收藏时记录的文章链接"),
    session: AsyncSession = Depends(get_session),
) -> Any:
    row = (
        await session.execute(select(Clipping).where(Clipping.url == url))
    ).scalar_one_or_none()
    if row is None or not row.pdf:
        return JSONResponse({"error": "这个链接没有 PDF 存档"}, status_code=404)
    filename = f"{row.title or 'clipping'}.pdf"
    return StreamingResponse(
        io.BytesIO(row.pdf),
        media_type="application/pdf",
        # inline：浏览器内嵌打开；filename* 带 UTF-8 编码，中文标题不乱码
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}"},
    )
