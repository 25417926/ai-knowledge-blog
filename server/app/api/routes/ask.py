"""问答路由：对应 Node 版 src/app/api/blog/ask/route.ts。

POST /api/ask 与 GET /api/ask?limit=40 的返回结构和原版一致，
BlogAssistant.tsx 把 fetch 地址换掉即可直接工作。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ...services import agent_chat as svc
from ...services import content as content_svc
from ...database import get_session
from ...schemas import AffinityView, Citation

router = APIRouter()

SESSION_KEY = "blog"
ASSISTANT_SLUG = "assistant"


class AskBody(BaseModel):
    message: str = ""
    about: str | None = None


def _result_view(result: svc.TalkResult) -> dict:
    return {
        "reply": result.reply,
        "agent": result.agent,
        "affinity": result.affinity,
        "recalled": result.recalled,
        "citations": svc.citations_out(result.citations),
        "sessionId": result.session_id,
        "turnIndex": result.turn_index,
        "turnId": result.turn_id,
        "model": result.model,
        "mock": result.mock,
        "latencyMs": result.latency_ms,
        "toolTrace": result.tool_trace,
    }


@router.post("/ask")
async def ask(body: AskBody, session: AsyncSession = Depends(get_session)) -> Any:
    try:
        result = await svc.talk(
            session,
            svc.TalkInput(
                agent_slug=ASSISTANT_SLUG,
                message=body.message,
                session_key=SESSION_KEY,
                rag=True,
                about=body.about,
            ),
        )
        return _result_view(result)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"error": f"提问失败：{e}"}


@router.get("/ask")
async def ask_log(
    limit: int = Query(40, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
) -> Any:
    try:
        log = await svc.read_log(session, SESSION_KEY, ASSISTANT_SLUG, limit)
        graph = await content_svc.graph(session)
        suggestions = [
            f"《{n['title']}》讲了什么？"
            for n in sorted(graph["nodes"], key=lambda n: -n["degree"])[:3]
        ]
        return {**log, "suggestions": suggestions}
    except ValueError as e:
        return {"error": str(e)}
