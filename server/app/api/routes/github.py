"""GitHub 贡献热力图：过去一年每天提交几次。

数据取自第三方公开接口 `github-contributions-api.jogruber.de`（无需 Token）。
没直接调 GitHub GraphQL，是因为那要个人 PAT —— 把令牌塞进一个对外站点的后端不划算，
而这里只需要「每天几次」这一列数字。

代价是多了个外部依赖，所以这条路由自己兜住：上游慢/挂了就用缓存里的旧数据（哪怕过期），
一次都没成功过才 503，前端据此把整块卡片藏起来 —— 首页不因为别人家的接口而白屏。
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()
log = logging.getLogger(__name__)

API = "https://github-contributions-api.jogruber.de/v4"
DEFAULT_USERNAME = "25417926"

# 上游一天最多变几次，6 小时足够新鲜；同时也把首页可能吃到的延迟摊平到 6 小时一次
CACHE_TTL = 6 * 3600
TIMEOUT = httpx.Timeout(10.0, connect=5.0)

_cache: dict[str, Any] = {"username": "", "at": 0.0, "payload": None}


def username() -> str:
    """按请求读，不放在模块级：.env 在 app.main 里才 load_dotenv()，早读会拿到空值。"""
    return os.environ.get("GITHUB_USERNAME", "").strip() or DEFAULT_USERNAME


def normalize_contributions(raw: dict, user: str) -> dict[str, Any]:
    """把上游响应收成前端要的形状。

    只留 date/count/level 三个字段；level 是前端查配色的下标，越界会拿到 undefined，
    所以夹到 0–4；没有合法 date 的行直接丢（上游偶尔混进空行）。
    """
    days: list[dict[str, Any]] = []
    for row in raw.get("contributions") or []:
        date = str(row.get("date") or "")
        if len(date) != 10:
            continue
        try:
            count = max(0, int(row.get("count") or 0))
            level = max(0, min(4, int(row.get("level") or 0)))
        except (TypeError, ValueError):
            continue
        days.append({"date": date, "count": count, "level": level})
    days.sort(key=lambda day: day["date"])

    total = (raw.get("total") or {}).get("lastYear")
    # bool 是 int 的子类，得单独排掉；缺字段时按天累加，别让右上角显示成空
    if isinstance(total, bool) or not isinstance(total, int) or total < 0:
        total = sum(day["count"] for day in days)

    return {"username": user, "total": total, "days": days, "updatedAt": None}


@router.get("/github/contributions")
async def github_contributions() -> Any:
    user = username()
    cached = _cache["payload"]
    hit = cached is not None and _cache["username"] == user
    if hit and time.time() - _cache["at"] < CACHE_TTL:
        return cached

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(f"{API}/{user}", params={"y": "last"})
            response.raise_for_status()
            raw = response.json()
    except Exception as exc:  # 上游任何失败都只降级，绝不 500
        log.warning("GitHub 贡献数据拉取失败：%s", exc)
        if hit:
            return cached
        return JSONResponse({"error": "GitHub 贡献数据暂时取不到"}, status_code=503)

    payload = normalize_contributions(raw, user)
    payload["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    _cache.update(username=user, at=time.time(), payload=payload)
    return payload
