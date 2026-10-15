"""FastAPI 入口。

路由前缀 /api，字段 camelCase —— Next 前端把 baseURL 从同源改成 http://127.0.0.1:8000
之后，现有的 fetch('/api/...') 调用与响应解析一行都不用改。
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import dispose_engine, get_session, init_schema
from .api.routes import ask, content
from .services.agent_chat import configure_llm

load_dotenv()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_llm(
        os.environ.get("LLM_BASE_URL", ""),
        os.environ.get("LLM_API_KEY", ""),
        os.environ.get("LLM_MODEL", ""),
    )
    await init_schema()
    yield
    await dispose_engine()


app = FastAPI(
    title="AI 知识博客 · 后端",
    version="1.0.0",
    description="Next.js 前端 + FastAPI 后端拆分后的 Python 服务：内容查询、RAG 问答、Agent 内核。",
    lifespan=lifespan,
)

# 本地单人工具：本机任意端口都放行（dev 3000 / next start 预览 3400 / 别的都行），
# 远端来源仍然挡掉。确需收紧时用 CORS_ORIGINS 指定白名单（与正则叠加生效）
CORS_ORIGINS = [o for o in os.environ.get("CORS_ORIGINS", "").split(",") if o]
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(content.router, prefix="/api", tags=["content"])
app.include_router(ask.router, prefix="/api", tags=["ask"])


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}
