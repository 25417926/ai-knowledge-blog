import { NextResponse, type NextRequest } from 'next/server';
import { readLog, talk } from '@/lib/agent-chat';
import { getGraph } from '@/lib/posts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 博客助手的固定标识 */
const ASSISTANT_SLUG = 'assistant';
const SESSION_KEY = 'blog';

/**
 * 问博客助手。
 *
 * 走 agent-chat 内核（记忆、好感度、日志都在那边），
 * 差别只在打开 rag：回答必须建立在检索到的原文片段上，并把出处一并带回。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { message?: string; about?: string | null };
    const result = await talk({
      agentSlug: ASSISTANT_SLUG,
      message: body.message ?? '',
      sessionKey: SESSION_KEY,
      rag: true,
      about: body.about ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '提问失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * 回放这次会话：让助手「记得你问过什么」，而不是每次打开都从零开始。
 * 顺带给出几个「一定能问到东西」的示例问题——挑被引用最多的文章，
 * 这样推荐永远跟着内容走，不用在代码里写死清单。
 */
export async function GET(req: NextRequest) {
  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 40);
  try {
    const suggestions = [...getGraph().nodes]
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 3)
      .map((n) => `《${n.title}》讲了什么？`);
    return NextResponse.json({ ...readLog(SESSION_KEY, ASSISTANT_SLUG, limit), suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取会话失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
