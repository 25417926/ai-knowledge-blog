"""问答路由：对应 Node 版 src/app/api/blog/ask/route.ts。

POST /api/ask 与 GET /api/ask?limit=40 的返回结构和原版一致，
BlogAssistant.tsx 把 fetch 地址换掉即可直接工作。
POST /api/ask/stream 是同一问答的 SSE 流式版，done 事件载荷与 POST /api/ask 逐字一致。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ...services import agent_chat as svc
from ...services import content as content_svc
from ...database import AsyncSessionLocal, get_session
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


def _sse_frame(event: str, data: Any) -> str:
    # jsonable_encoder：把 pydantic 模型（AffinityView / Citation）转成 camelCase 字典，
    # 与整包路由经 FastAPI 序列化出来的字段逐字一致；by_alias 默认开启
    payload = json.dumps(jsonable_encoder(data), ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


@router.post("/ask/stream")
async def ask_stream(body: AskBody) -> Any:
    """SSE 流式问答。

    事件协议：
    - token：正文增量（模型边生成边推）
    - status：过程提示（如「正在翻书架…」）
    - done：载荷与 POST /api/ask 逐字一致（引用 / 好感度 / trace 全在里面）
    - error：失败原因
    前端在第一个 token 之前遇到传输层失败时，应回落 POST /api/ask 重试。
    """
    queue: asyncio.Queue[dict] = asyncio.Queue()

    async def run() -> None:
        # 自带会话：流式响应的生命周期长过请求依赖，不能用 Depends 注入的那个 session
        async with AsyncSessionLocal() as session:
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
                    emit=queue.put,
                )
                await queue.put({"event": "done", "data": _result_view(result)})
            except ValueError as e:
                await queue.put({"event": "error", "data": {"message": str(e)}})
            except Exception as e:  # noqa: BLE001
                await queue.put({"event": "error", "data": {"message": f"提问失败：{e}"}})

    async def frames() -> AsyncGenerator[str, None]:
        task = asyncio.create_task(run())
        try:
            while True:
                event = await queue.get()
                yield _sse_frame(event["event"], event["data"])
                if event["event"] in ("done", "error"):
                    break
        finally:
            await task  # 客户端中途断开也要等 run() 收尾，避免会话泄漏

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
