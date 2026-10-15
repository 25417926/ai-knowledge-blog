"""Agent 内核：逐函数移植 src/lib/agent-chat.ts。

保留原版的全部行为细节（这是这个项目的灵魂，不是能顺手改的部分）：
- 好感度四档只增不减，单轮 +1~4，上限 4；
- 长期记忆只认第一人称陈述句，先排疑问句再匹配句式；
- 短期记忆 = 直接读最近 8 轮 agent_turns；
- Mock 三分支：NPC 闲聊 / 概览 / RAG 原文直出，且明说「这是节选不是转述」；
- 「这篇讲了什么」走 articleOverview（拿标题当查询词）。
"""

from __future__ import annotations

import json
import math
import random
import re
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import Integer, String, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Agent, AgentMemory, AgentRelation, AgentSession, AgentTurn, Citation, Chunk, Post
from ..schemas import AffinityView, Citation as CitationOut

STAGES: list[dict] = [
    {"key": "stranger", "label": "陌生", "min": -math.inf},
    {"key": "acquaintance", "label": "认识", "min": 6},
    {"key": "familiar", "label": "熟悉", "min": 20},
    {"key": "close", "label": "亲近", "min": 45},
]

SHORT_TERM_TURNS = 8
LONG_TERM_MEMORIES = 5
USER_KEY = "owner"
BLOG_SESSION = "blog"

LLM_BASE_URL = ""
LLM_API_KEY = ""
LLM_MODEL = "gpt-4o-mini"
LLM_TIMEOUT = 20.0

OVERVIEW_RE = re.compile(
    r"(这篇|本文|该文|本篇|这一篇|这篇文章)(都|主要|大概)?(讲|说|写)了?(些|点)?(什么|啥)"
    r"|(主要|大概)(讲|说)的是?什么"
    r"|内容(是|有)什么"
    r"|讲了些什么|概览|总结一下|总结下"
)
FACT_PREFIX_RE = re.compile(r"我(叫|是|喜欢|在|正在|想|学|做|从事|住|有|准备|打算)")
QUESTION_HINT_RE = re.compile(r"怎么|如何|为什么|是不是|能不能|要不要|该不该|哪些|哪个|多少钱|行不行|好不好")
POLITE_RE = re.compile(r"谢谢|感谢|辛苦|厉害|喜欢你|赞")
ASK_HINT_RE = re.compile(r"[?？]|怎么|为什么|如何|什么")


# ────────────────────────────────────────────── 工具


def stage_of(score: int) -> dict:
    current = STAGES[0]
    for s in STAGES:
        if score >= s["min"]:
            current = s
    return current


def next_stage_at(score: int) -> int | None:
    for s in STAGES:
        if score < s["min"]:
            return int(s["min"])
    return None


def affinity_delta(message: str) -> int:
    delta = 1
    if len(message) >= 20:
        delta += 1
    if ASK_HINT_RE.search(message):
        delta += 1
    if POLITE_RE.search(message):
        delta += 1
    return min(delta, 4)


def extract_fact(message: str) -> str | None:
    text = re.sub(r"\s+", " ", message.strip())
    if len(text) < 4 or len(text) > 60:
        return None
    if "?" in text or "？" in text:
        return None
    if re.search(r"(吗|呢|吧)[。！!]?$", text):
        return None
    if QUESTION_HINT_RE.search(text):
        return None
    if not FACT_PREFIX_RE.search(text):
        return None
    return text


def is_overview_ask(message: str) -> bool:
    return bool(OVERVIEW_RE.search(message))


def clip(text: str, max_len: int) -> str:
    return text if len(text) <= max_len else f"{text[:max_len]}…"


def short_heading(heading: str) -> str:
    parts = heading.split(">")
    return clip(parts[-1].strip(), 18)


def pick(items: list, seed: int):
    return items[abs(seed) % len(items)]


# ────────────────────────────────────────────── 检索层（retrieve.ts 移植）


PARTICLES = set("的了是在和与就都而及或吗呢吧啊着过很也还个之其并")
STOPWORDS = {
    "的", "了", "是", "在", "和", "与", "就", "都", "而", "及", "或", "一个",
    "什么", "怎么", "如何", "哪些", "哪个", "为什么", "这个", "那个", "可以",
}


def tokenize(text: str) -> list[str]:
    lowered = text.lower()
    tokens: list[str] = []
    tokens.extend(re.findall(r"[a-z0-9][a-z0-9+#._-]*", lowered))
    for run in re.split(r"[^一-鿿]+", lowered):
        if not run:
            continue
        if len(run) == 1:
            tokens.append(run)
            continue
        for i in range(len(run) - 1):
            pair = run[i : i + 2]
            if pair[0] in PARTICLES or pair[1] in PARTICLES:
                continue
            tokens.append(pair)
    return [t for t in tokens if len(t) > 1 and t not in STOPWORDS]


async def _load_chunks(session: AsyncSession, about: str | None) -> list[dict]:
    stmt = (
        select(
            Chunk.id,
            Chunk.body,
            Chunk.heading_path,
            Post.slug,
            Post.title,
            Post.category,
        )
        .join(Post, Post.id == Chunk.post_id)
        .order_by(Chunk.id)
    )
    if about:
        stmt = stmt.where(Post.slug == about)
    return [
        {
            "id": r.id,
            "body": r.body,
            "heading_path": r.heading_path,
            "slug": r.slug,
            "title": r.title,
            "category": r.category,
        }
        for r in (await session.execute(stmt)).all()
    ]


def _score_chunk(row: dict, tokens: list[str], df: dict[str, int]) -> float:
    title = row["title"].lower()
    heading = row["heading_path"].lower()
    body = row["body"].lower()
    score = 0.0
    for token in tokens:
        freq = df.get(token, 0)
        if freq == 0:
            continue
        idf = math.log(1 + len(tokens) / freq)
        if token in title:
            score += 3.0 * idf
        elif token in heading:
            score += 1.6 * idf
        elif token in body:
            score += 1.0 * idf
    return score / math.sqrt(max(1, len(tokens)))


async def retrieve(
    session: AsyncSession, query: str, limit: int = 4, about: str | None = None
) -> list[dict]:
    tokens = tokenize(query)
    if not tokens:
        return []
    rows = await _load_chunks(session, about)
    if not rows:
        return []
    df: dict[str, int] = {}
    for token in tokens:
        df[token] = sum(
            1
            for r in rows
            if token in f"{r['title']} {r['heading_path']} {r['body']}".lower()
        )
    scored = [
        (row, _score_chunk(row, tokens, df)) for row in rows
    ]
    scored = [(r, s) for r, s in scored if s > 0]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [
        {
            "chunk_id": r["id"],
            "post_slug": r["slug"],
            "post_title": r["title"],
            "category": r["category"],
            "heading": r["heading_path"],
            "quote": r["body"].strip(),
            "score": round(s, 3),
        }
        for r, s in scored[:limit]
    ]


async def article_overview(session: AsyncSession, slug: str, limit: int = 3) -> list[dict]:
    title = (
        await session.execute(select(Post.title).where(Post.slug == slug))
    ).scalar_one_or_none()
    if not title:
        return []
    return await retrieve(session, title, limit, slug)


def format_context(citations: list[dict]) -> str:
    return "\n\n".join(
        f"[{i + 1}] 出自《{c['post_title']}》的「{c['heading']}」：\n{c['quote']}"
        for i, c in enumerate(citations)
    )


# ────────────────────────────────────────────── LLM 适配器（llm.ts 移植）


def llm_configured() -> bool:
    return bool(LLM_BASE_URL and LLM_API_KEY)


def configure_llm(base_url: str, api_key: str, model: str) -> None:
    global LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
    LLM_BASE_URL = base_url.strip()
    LLM_API_KEY = api_key.strip()
    LLM_MODEL = model.strip() or "gpt-4o-mini"


async def chat_completion(messages: list[dict]) -> tuple[str, str]:
    if not llm_configured():
        raise RuntimeError("LLM 未配置：缺少 LLM_BASE_URL 或 LLM_API_KEY")
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        res = await client.post(
            f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {LLM_API_KEY}",
            },
            json={"model": LLM_MODEL, "messages": messages, "temperature": 0.8},
        )
    if res.status_code >= 400:
        raise RuntimeError(f"LLM 返回 {res.status_code}：{res.text[:200]}")
    data = res.json()
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
    if not content:
        raise RuntimeError("LLM 返回内容为空")
    return content, LLM_MODEL


# ────────────────────────────────────────────── 记忆与关系的读写


async def _resolve_agent(session: AsyncSession, slug: str) -> Agent:
    if slug == "assistant":
        row = (
            await session.execute(select(Agent).order_by(Agent.id))
        ).scalars().first()
        candidates = (
            await session.execute(select(Agent).order_by(Agent.id))
        ).scalars().all()
        agent = next(
            (a for a in candidates if "blogAssistant" in a.meta and json.loads(a.meta or "{}").get("blogAssistant")),
            None,
        ) or row
    else:
        agent = (
            await session.execute(select(Agent).where(Agent.slug == slug))
        ).scalar_one_or_none()
    if agent is None:
        raise ValueError(f"找不到角色：{slug}")
    return agent


async def _read_relation(session: AsyncSession, agent_id: int) -> AgentRelation | None:
    return (
        await session.execute(
            select(AgentRelation).where(
                AgentRelation.agent_id == agent_id,
                AgentRelation.user_key == USER_KEY,
            )
        )
    ).scalar_one_or_none()


async def _write_relation(session: AsyncSession, agent_id: int, score: int, stage: str) -> None:
    rel = await _read_relation(session, agent_id)
    if rel is None:
        session.add(AgentRelation(agent_id=agent_id, user_key=USER_KEY, score=score, stage=stage))
    else:
        rel.score = score
        rel.stage = stage
        rel.updated_at = func.datetime("now")


async def _read_long_memories(session: AsyncSession, agent_id: int) -> list[AgentMemory]:
    return list(
        (
            await session.execute(
                select(AgentMemory)
                .where(
                    AgentMemory.agent_id == agent_id,
                    AgentMemory.user_key == USER_KEY,
                    AgentMemory.memory_kind == "long",
                )
                .order_by(AgentMemory.importance.desc(), AgentMemory.id.desc())
                .limit(LONG_TERM_MEMORIES)
            )
        ).scalars().all()
    )


async def _read_recent_turns(session: AsyncSession, session_id: str) -> list[dict]:
    rows = list(
        (
            await session.execute(
                select(AgentTurn)
                .where(AgentTurn.session_id == session_id)
                .order_by(AgentTurn.id.desc())
                .limit(SHORT_TERM_TURNS)
            )
        ).scalars().all()
    )
    rows.reverse()
    return [{"role": r.role, "content": r.content} for r in rows]


async def _count_user_turns(session: AsyncSession, session_id: str) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(AgentTurn)
            .where(AgentTurn.session_id == session_id, AgentTurn.role == "user")
        )
    ).scalar_one()


# ────────────────────────────────────────────── 提示词与 Mock


@dataclass
class ReplyContext:
    agent: Agent
    affinity: AffinityView
    memories: list[str]
    recent: list[dict]
    turn_index: int


def persona_lines(ctx: ReplyContext) -> list[str]:
    agent = ctx.agent
    lines = [
        f"你是「{agent.name}」，身处一个名为「赛博小镇」的知识小镇。",
        f"你的常驻位置：{agent.location}。" if agent.location else "",
        f"你的人设：{agent.persona}" if agent.persona else "",
        f"你与来访者的关系：{ctx.affinity.label}（好感度 {ctx.affinity.score}）。",
        {
            "stranger": "说话客气而有距离感，先摸清对方来意。",
            "acquaintance": "语气放松一些，可以主动搭话了。",
            "familiar": "像熟人一样随意，会开玩笑，也会主动关心。",
            "close": "像老朋友一样亲近，语气温暖，可以直呼其名。",
        }[ctx.affinity.stage],
        (
            f"你记得对方的这些事，可在合适时自然提起，不要生硬复述：\n- " + "\n- ".join(ctx.memories)
            if ctx.memories
            else "你目前对对方几乎一无所知。"
        ),
    ]
    return [line for line in lines if line]


def build_messages(ctx: ReplyContext, citations: list[dict], message: str) -> list[dict]:
    lines = persona_lines(ctx)
    if citations:
        lines += [
            "下面是刚检索到的原文片段，回答必须以它们为唯一依据：",
            format_context(citations),
            "要求：先用一句话给结论，再给依据。引用某段时在句末标出它的编号，例如 [1]。",
            "片段里没有的内容，直接说不确定，不要编造。",
        ]
    lines.append("回答保持口语化，控制在 2-4 句，不要用列表和标题。")
    history = [
        {"role": "assistant" if t["role"] == "assistant" else "user", "content": t["content"]}
        for t in ctx.recent
    ]
    return [{"role": "system", "content": "\n".join(lines)}, *history, {"role": "user", "content": message}]


def mock_reply(ctx: ReplyContext, message: str) -> str:
    openers = {
        "stranger": [f"你好。我是{ctx.agent.name}。", f"我是{ctx.agent.name}。有什么指教？"],
        "acquaintance": ["又是你。", "你来了，坐。"],
        "familiar": ["你来了。", "哟，是你。"],
        "close": ["你可算来了。", "我正想着你呢。"],
    }
    answer = (
        "这个问题一时说不清，我先记下，等我想明白了在图书馆慢慢跟你讲。"
        if ASK_HINT_RE.search(message)
        else "嗯，我听着呢，你继续。"
    )
    parts = [pick(openers[ctx.affinity.stage], ctx.turn_index + len(message))]
    if ctx.memories and ctx.turn_index > 1:
        parts.append(f"你提过「{clip(ctx.memories[0], 18)}」，我记着。")
    parts.append(answer)
    if ctx.affinity.stage == "stranger":
        parts.append("我们才刚认识，我话不多，别介意。")
    elif ctx.affinity.stage == "close":
        parts.append("有事随时找我，我一直在。")
    return "".join(parts)


def mock_overview_reply(citations: list[dict]) -> str:
    top = citations[0]
    rest = citations[1:]
    lines = [f"《{top['post_title']}》从这里讲起：", "", top["quote"]]
    if rest:
        lines += ["", f"接着是「{'」「'.join(short_heading(c['heading']) for c in rest)}」。"]
    lines += ["", "（还没接入语言模型，所以先给你开头，而不是我的转述。）"]
    return "\n".join(lines)


def mock_rag_reply(citations: list[dict], message: str) -> str:
    if not citations:
        return (
            f"我把图书馆的书架翻了一遍，没有找到和「{clip(message, 14)}」直接相关的内容。"
            "换一个更具体的说法试试，或者从《知识地图总览》开始逛。"
        )
    top = citations[0]
    others = citations[1:]
    other_posts = {c["post_title"] for c in others} - {top["post_title"]}
    if not others:
        tail = "目前就这一段最相关。"
    elif other_posts:
        tail = f"另外还有 {len(others)} 处相关，其中牵涉《{'》《'.join(other_posts)}》。"
    else:
        tail = f"同一篇里还有 {len(others)} 处相关段落。"
    return (
        f"最贴近的是《{top['post_title']}》里「{short_heading(top['heading'])}」这一段：\n\n"
        f"{top['quote']}\n\n{tail}\n（还没接入语言模型，所以直接给你原文节选，而不是我的转述。）"
    )


# ────────────────────────────────────────────── 对外入口


@dataclass
class TalkInput:
    agent_slug: str
    message: str
    session_key: str
    rag: bool = False
    about: str | None = None


@dataclass
class TalkResult:
    reply: str
    agent: dict
    affinity: AffinityView
    recalled: list[str]
    citations: list[dict]
    session_id: str
    turn_index: int
    turn_id: int
    model: str
    mock: bool
    latency_ms: int


async def _generate_reply(
    ctx: ReplyContext, input: TalkInput, citations: list[dict], overview: bool
) -> tuple[str, str, bool]:
    if not llm_configured():
        if not input.rag:
            return mock_reply(ctx, input.message), "mock-town", True
        if overview and citations:
            return mock_overview_reply(citations), "mock-town", True
        return mock_rag_reply(citations, input.message), "mock-town", True
    content, model = await chat_completion(build_messages(ctx, citations, input.message))
    return content, model, False


async def talk(session: AsyncSession, input: TalkInput) -> TalkResult:
    agent = await _resolve_agent(session, input.agent_slug)
    session_id = f"{agent.slug}:{input.session_key}"
    message = input.message.strip()[:500]
    if not message:
        raise ValueError("消息不能为空")

    existing = (
        await session.execute(select(AgentSession).where(AgentSession.id == session_id))
    ).scalar_one_or_none()
    if existing is None:
        session.add(AgentSession(id=session_id, agent_id=agent.id, user_key=USER_KEY))
    else:
        existing.last_active_at = func.datetime("now")

    rel = await _read_relation(session, agent.id)
    score = rel.score if rel else 0
    stage = stage_of(score)
    memories = await _read_long_memories(session, agent.id)
    recent = await _read_recent_turns(session, session_id)
    affinity = AffinityView(
        score=score,
        stage=stage["key"],
        label=stage["label"],
        delta=0,
        next_stage_at=next_stage_at(score),
    )

    about = input.about
    overview = input.rag and about is not None and is_overview_ask(message)
    citations: list[dict] = []
    if input.rag:
        citations = (
            await article_overview(session, about, 3)
            if overview and about
            else await retrieve(session, message, 4, about)
        )

    ctx = ReplyContext(
        agent=agent,
        affinity=affinity,
        memories=[m.content for m in memories],
        recent=recent,
        turn_index=(await _count_user_turns(session, session_id)) + 1,
    )

    started = time.monotonic()
    reply, model, is_mock = await _generate_reply(ctx, input, citations, overview)
    latency_ms = int((time.monotonic() - started) * 1000)

    delta = affinity_delta(message)
    final_score = score + delta
    after = stage_of(final_score)

    user_turn = AgentTurn(
        session_id=session_id, agent_id=agent.id, role="user", content=message,
        affinity_delta=0, latency_ms=0, model="",
    )
    session.add(user_turn)
    await session.flush()

    assistant_turn = AgentTurn(
        session_id=session_id, agent_id=agent.id, role="assistant", content=reply,
        affinity_delta=delta, latency_ms=latency_ms, model=model,
    )
    session.add(assistant_turn)
    await session.flush()

    for c in citations:
        session.add(
            Citation(
                turn_id=assistant_turn.id,
                chunk_id=c["chunk_id"],
                quote=c["quote"][:400],
                score=c["score"],
            )
        )

    fact = extract_fact(message)
    if fact:
        exists = (
            await session.execute(
                select(AgentMemory.id).where(
                    AgentMemory.agent_id == agent.id,
                    AgentMemory.user_key == USER_KEY,
                    AgentMemory.content == fact,
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            session.add(
                AgentMemory(
                    agent_id=agent.id,
                    user_key=USER_KEY,
                    memory_kind="long",
                    content=fact,
                    importance=0.8,
                    source_turn_id=user_turn.id,
                )
            )

    await _write_relation(session, agent.id, final_score, after["key"])
    await session.commit()

    meta = json.loads(agent.meta or "{}")
    return TalkResult(
        reply=reply,
        agent={
            "slug": agent.slug,
            "name": agent.name,
            "avatar": agent.avatar,
            "location": agent.location,
            "isBlogAssistant": bool(meta.get("blogAssistant")),
        },
        affinity=AffinityView(
            score=final_score,
            stage=after["key"],
            label=after["label"],
            delta=delta,
            next_stage_at=next_stage_at(final_score),
        ),
        recalled=[m.content for m in memories],
        citations=citations,
        session_id=session_id,
        turn_index=ctx.turn_index,
        turn_id=assistant_turn.id,
        model=model,
        mock=is_mock,
        latency_ms=latency_ms,
    )


async def read_log(session: AsyncSession, session_key: str, agent_slug: str, limit: int = 50) -> dict:
    agent = await _resolve_agent(session, agent_slug)
    session_id = f"{agent.slug}:{session_key}"
    turns = list(
        (
            await session.execute(
                select(AgentTurn)
                .where(AgentTurn.session_id == session_id)
                .order_by(AgentTurn.id.desc())
                .limit(limit)
            )
        ).scalars().all()
    )
    turns.reverse()

    by_turn: dict[int, list[dict]] = {}
    if turns:
        ids = [t.id for t in turns]
        rows = (
            await session.execute(
                select(Citation.turn_id, Post.slug, Post.title, Chunk.heading_path)
                .join(Chunk, Chunk.id == Citation.chunk_id)
                .join(Post, Post.id == Chunk.post_id)
                .where(Citation.turn_id.in_(ids))
                .order_by(Citation.id)
            )
        ).all()
        for turn_id, slug, title, heading in rows:
            by_turn.setdefault(turn_id, []).append(
                {"postSlug": slug, "postTitle": title, "heading": heading}
            )

    rel = await _read_relation(session, agent.id)
    score = rel.score if rel else 0
    stage = stage_of(score)
    memories = await _read_long_memories(session, agent.id)
    return {
        "sessionId": session_id,
        "agentSlug": agent.slug,
        "agentName": agent.name,
        "turns": [
            {
                "id": t.id,
                "role": t.role,
                "content": t.content,
                "affinityDelta": t.affinity_delta,
                "latencyMs": t.latency_ms,
                "model": t.model,
                "createdAt": t.created_at,
                "sources": by_turn.get(t.id, []),
            }
            for t in turns
        ],
        "affinity": {"score": score, "stage": stage["key"], "label": stage["label"]},
        "memories": [{"id": m.id, "content": m.content} for m in memories],
    }


def citations_out(citations: list[dict]) -> list[CitationOut]:
    return [
        CitationOut(
            chunk_id=c["chunk_id"],
            post_slug=c["post_slug"],
            post_title=c["post_title"],
            category=c["category"],
            heading=c["heading"],
            quote=c["quote"],
            score=c["score"],
        )
        for c in citations
    ]
