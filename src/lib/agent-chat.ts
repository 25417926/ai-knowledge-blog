/**
 * Agent 内核：博客端 AI 助手与小镇 NPC 共用的一层。
 *
 * 一次对话要同时处理四件事，它们在这里被编排在一起：
 *   1) 短期记忆 —— 本次会话最近若干轮对话，直接进提示词；
 *   2) 长期记忆 —— 从用户话里抽取的事实，跨会话保留，被召回后进提示词；
 *   3) 好感度   —— 每轮累加分数，分数派生出「陌生/认识/熟悉/亲近」并影响语气；
 *   4) 实时日志 —— 每轮问答全量写入 agent_turns，可回放、可调试。
 *
 * 未配置 LLM 时走 Mock：回复由角色人设 + 好感度 + 召回的记忆拼成，
 * 保证「记得住、态度会变」这两条主线在没有 Key 的机器上也能完整演示。
 */

import { getDb, tx } from './db';
import { getAgentBySlug, getBlogAssistant, type Agent } from './agents';
import { chatCompletion, llmConfigured, type LlmMessage } from './llm';
import { articleOverview, formatContext, retrieve, type Citation } from './retrieve';

export type AffinityStage = 'stranger' | 'acquaintance' | 'familiar' | 'close';

export type AffinityView = {
  score: number;
  stage: AffinityStage;
  label: string;
  delta: number;
  nextStageAt: number | null;
};

export type TalkInput = {
  agentSlug: string;
  message: string;
  sessionKey: string;
  /** 打开检索增强：回答将基于站内文章片段，并带回引用 */
  rag?: boolean;
  /** 只在某一篇文章里检索（文章页的「就本文提问」） */
  about?: string | null;
};

export type TalkResult = {
  reply: string;
  agent: {
    slug: string;
    name: string;
    avatar: string;
    location: string;
    isBlogAssistant: boolean;
  };
  affinity: AffinityView;
  recalled: string[];
  citations: Citation[];
  sessionId: string;
  turnIndex: number;
  turnId: number;
  model: string;
  mock: boolean;
  latencyMs: number;
};

/** 好感度档位。分数只增不减，档位由分数派生，避免出现「关系倒退」的怪异感。 */
const STAGES: { key: AffinityStage; label: string; min: number }[] = [
  { key: 'stranger', label: '陌生', min: -Infinity },
  { key: 'acquaintance', label: '认识', min: 6 },
  { key: 'familiar', label: '熟悉', min: 20 },
  { key: 'close', label: '亲近', min: 45 },
];

const SHORT_TERM_TURNS = 8;
const LONG_TERM_MEMORIES = 5;

function stageOf(score: number): (typeof STAGES)[number] {
  let current = STAGES[0];
  for (const s of STAGES) {
    if (score >= s.min) current = s;
  }
  return current;
}

function nextStageAt(score: number): number | null {
  for (const s of STAGES) {
    if (score < s.min) return s.min;
  }
  return null;
}

function resolveAgent(agentSlug: string): Agent {
  const agent = agentSlug === 'assistant' ? getBlogAssistant() : getAgentBySlug(agentSlug);
  if (!agent) {
    throw new Error(`找不到角色：${agentSlug}`);
  }
  return agent;
}

// ────────────────────────────────────────────── 关系与记忆的读写

type RelationRow = { score: number; stage: string };

function readRelation(agentId: number, userKey: string): RelationRow {
  const row = getDb()
    .prepare(`SELECT score, stage FROM agent_relations WHERE agent_id = ? AND user_key = ?`)
    .get(agentId, userKey) as RelationRow | undefined;
  return row ?? { score: 0, stage: 'stranger' };
}

function writeRelation(agentId: number, userKey: string, score: number, stage: string): void {
  getDb()
    .prepare(
      `INSERT INTO agent_relations (agent_id, user_key, score, stage, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id, user_key)
       DO UPDATE SET score = excluded.score, stage = excluded.stage, updated_at = excluded.updated_at`,
    )
    .run(agentId, userKey, score, stage);
}

function readLongMemories(agentId: number, userKey: string): { id: number; content: string }[] {
  return getDb()
    .prepare(
      `SELECT id, content FROM agent_memories
       WHERE agent_id = ? AND user_key = ? AND memory_kind = 'long'
       ORDER BY importance DESC, id DESC LIMIT ?`,
    )
    .all(agentId, userKey, LONG_TERM_MEMORIES) as { id: number; content: string }[];
}

function writeMemory(agentId: number, userKey: string, content: string, turnId: number): void {
  getDb()
    .prepare(
      `INSERT INTO agent_memories (agent_id, user_key, memory_kind, content, importance, source_turn_id)
       VALUES (?, ?, 'long', ?, 0.8, ?)`,
    )
    .run(agentId, userKey, content, turnId);
}

function hasMemory(agentId: number, userKey: string, content: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM agent_memories WHERE agent_id = ? AND user_key = ? AND content = ? LIMIT 1`,
    )
    .get(agentId, userKey, content) as { id: number } | undefined;
  return row !== undefined;
}

function readRecentTurns(sessionId: string): { role: string; content: string }[] {
  const rows = getDb()
    .prepare(`SELECT role, content FROM agent_turns WHERE session_id = ? ORDER BY id DESC LIMIT ?`)
    .all(sessionId, SHORT_TERM_TURNS) as { role: string; content: string }[];
  return rows.reverse();
}

function countTurns(sessionId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM agent_turns WHERE session_id = ? AND role = 'user'`)
    .get(sessionId) as { c: number };
  return Number(row.c);
}

function ensureSession(sessionId: string, agentId: number, userKey: string): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, agent_id, user_key) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_active_at = datetime('now')`,
    )
    .run(sessionId, agentId, userKey);
}

function appendTurn(
  sessionId: string,
  agentId: number,
  role: string,
  content: string,
  affinityDelta: number,
  latencyMs: number,
  model: string,
): number {
  const info = getDb()
    .prepare(
      `INSERT INTO agent_turns (session_id, agent_id, role, content, affinity_delta, latency_ms, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, agentId, role, content, affinityDelta, latencyMs, model);
  return Number(info.lastInsertRowid);
}

// ────────────────────────────────────────────── 打分与抽取

/** 好感度增量：问得越具体、越有礼貌，加得越多；单轮上限 4 分，避免刷分。 */
function affinityDelta(message: string): number {
  let delta = 1;
  if (message.length >= 20) delta += 1;
  if (/[?？]|怎么|为什么|如何|能不能/.test(message)) delta += 1;
  if (/谢谢|感谢|辛苦|厉害|喜欢你|赞/.test(message)) delta += 1;
  return Math.min(delta, 4);
}

/**
 * 从用户话里抽「值得长期记住的事实」。
 *
 * 只认第一人称的陈述句。必须先排除疑问句 —— 否则「我想问个问题：JUC 线程池怎么设？」
 * 会因为「我想」被误判成用户事实，把提问当成记忆存进去，越攒越脏。
 */
function extractFact(message: string): string | null {
  const text = message.trim().replace(/\s+/g, ' ');
  if (text.length < 4 || text.length > 60) return null;
  // 疑问句一律不算事实
  if (/[?？]/.test(text)) return null;
  if (/(吗|呢|吧)[。！!]?$/.test(text)) return null;
  if (/怎么|如何|为什么|是不是|能不能|要不要|该不该|哪些|哪个|多少钱|行不行|好不好/.test(text)) {
    return null;
  }
  if (!/我(叫|是|喜欢|在|正在|想|学|做|从事|住|有|准备|打算)/.test(text)) return null;
  return text;
}

// ────────────────────────────────────────────── 提示词与 Mock

/** 生成一次回复所需的全部上下文。打包成一个对象，免得函数参数越加越长。 */
type ReplyContext = {
  agent: Agent;
  affinity: AffinityView;
  memories: string[];
  recent: { role: string; content: string }[];
  turnIndex: number;
};

function personaLines(ctx: ReplyContext): string[] {
  const { agent, affinity, memories } = ctx;
  return [
    `你是「${agent.name}」，身处一个名为「赛博小镇」的知识小镇。`,
    agent.location ? `你的常驻位置：${agent.location}。` : '',
    agent.persona ? `你的人设：${agent.persona}` : '',
    `你与来访者的关系：${affinity.label}（好感度 ${affinity.score}）。`,
    affinity.stage === 'stranger'
      ? '说话客气而有距离感，先摸清对方来意。'
      : affinity.stage === 'acquaintance'
        ? '语气放松一些，可以主动搭话了。'
        : affinity.stage === 'familiar'
          ? '像熟人一样随意，会开玩笑，也会主动关心。'
          : '像老朋友一样亲近，语气温暖，可以直呼其名。',
    memories.length > 0
      ? `你记得对方的这些事，可在合适时自然提起，不要生硬复述：\n- ${memories.join('\n- ')}`
      : '你目前对对方几乎一无所知。',
  ].filter(Boolean);
}

function buildMessages(ctx: ReplyContext, citations: Citation[], message: string): LlmMessage[] {
  const lines = personaLines(ctx);
  if (citations.length > 0) {
    lines.push(
      '下面是刚检索到的原文片段，回答必须以它们为唯一依据：',
      formatContext(citations),
      '要求：先用一句话给结论，再给依据。引用某段时在句末标出它的编号，例如 [1]。',
      '片段里没有的内容，直接说不确定，不要编造。',
    );
  }
  lines.push('回答保持口语化，控制在 2-4 句，不要用列表和标题。');

  const history: LlmMessage[] = ctx.recent.map((t) => ({
    role: t.role === 'assistant' ? 'assistant' : 'user',
    content: t.content,
  }));

  return [{ role: 'system', content: lines.join('\n') }, ...history, { role: 'user', content: message }];
}

function pick<T>(list: T[], seed: number): T {
  return list[Math.abs(seed) % list.length];
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 小节名可能很长（「A > B > C」），只留最后一节，读起来才像话 */
function shortHeading(heading: string): string {
  const parts = heading.split('>');
  return clip(parts[parts.length - 1].trim(), 18);
}

/**
 * NPC 的 Mock 回复：拼装「开场 + 记忆回指 + 正文 + 位置」，让记忆与好感度是「看得见」的。
 * 它不假装自己懂文章内容 —— 那属于博客端 RAG 的职责，不该由 NPC 冒充。
 */
function mockReply(ctx: ReplyContext, message: string): string {
  const { agent, affinity, memories } = ctx;
  const openers: Record<AffinityStage, string[]> = {
    stranger: [`你好。我是${agent.name}。`, `我是${agent.name}。有什么指教？`],
    acquaintance: ['又是你。', '你来了，坐。'],
    familiar: ['你来了。', '哟，是你。'],
    close: ['你可算来了。', '我正想着你呢。'],
  };
  const answer = /[?？]|怎么|为什么|如何|什么/.test(message)
    ? '这个问题一时说不清，我先记下，等我想明白了在图书馆慢慢跟你讲。'
    : '嗯，我听着呢，你继续。';

  const parts = [pick(openers[affinity.stage], ctx.turnIndex + message.length)];
  const fact = memories[0];
  if (fact && ctx.turnIndex > 1) {
    parts.push(`你提过「${clip(fact, 18)}」，我记着。`);
  }
  parts.push(answer);
  if (affinity.stage === 'stranger') {
    parts.push('我们才刚认识，我话不多，别介意。');
  } else if (affinity.stage === 'close') {
    parts.push('有事随时找我，我一直在。');
  }
  return parts.join('');
}

/**
 * 判断这是不是「要概览」而不是「要答案」。
 *
 * 「这篇文章讲了什么」如果当成检索词，哪篇文章里都不会有这几个字，必然空手而归。
 * 认出来之后改走 articleOverview：拿标题去检索，把这篇的开头几节端出来。
 */
function isOverviewAsk(message: string): boolean {
  // 指代词写成枚举而不是 (这|本|该)(篇|文)(章)?——「这篇文章」是四个字，那样拆不对
  return /(这篇|本文|该文|本篇|这一篇|这篇文章)(都|主要|大概)?(讲|说|写)了?(些|点)?(什么|啥)|(主要|大概)(讲|说)的是?什么|内容(是|有)什么|讲了些什么|概览|总结一下|总结下/.test(
    message,
  );
}

/**
 * 概览的 Mock 回复：把这篇的开头几段按顺序摆出来。
 * 与「最贴近的是…」区分开——那不是概览该有的说法。
 */
function mockOverviewReply(citations: Citation[]): string {
  const top = citations[0];
  const rest = citations.slice(1);
  const lines = [`《${top.postTitle}》从这里讲起：`, '', top.quote];
  if (rest.length > 0) {
    lines.push('', `接着是「${rest.map((c) => shortHeading(c.heading)).join('」「')}」。`);
  }
  lines.push('', '（还没接入语言模型，所以先给你开头，而不是我的转述。）');
  return lines.join('\n');
}

/**
 * 博客助手的 Mock 回复：把检索到的那一段原文直接端出来。
 *
 * 这里刻意不做「假装理解了再转述」——没有模型时，最诚实的回答就是给原文，
 * 并且把「这是节选而非总结」讲清楚。可信度比流畅度重要。
 */
function mockRagReply(citations: Citation[], message: string): string {
  if (citations.length === 0) {
    return `我把图书馆的书架翻了一遍，没有找到和「${clip(message, 14)}」直接相关的内容。换一个更具体的说法试试，或者从《知识地图总览》开始逛。`;
  }
  const top = citations[0];
  const others = citations.slice(1);
  // 其余命中可能都在同一篇里，那就不该说成「另外还有几处」让人以为是别的文章
  const otherPosts = [...new Set(others.map((c) => c.postTitle))].filter((t) => t !== top.postTitle);
  const tail =
    others.length === 0
      ? '目前就这一段最相关。'
      : otherPosts.length > 0
        ? `另外还有 ${others.length} 处相关，其中牵涉《${otherPosts.join('》《')}》。`
        : `同一篇里还有 ${others.length} 处相关段落。`;

  return [
    `最贴近的是《${top.postTitle}》里「${shortHeading(top.heading)}」这一段：`,
    '',
    top.quote,
    '',
    tail,
    '（还没接入语言模型，所以直接给你原文节选，而不是我的转述。）',
  ].join('\n');
}

// ────────────────────────────────────────────── 对外入口

type ReplyPlan = { reply: string; model: string; mock: boolean };

async function generateReply(
  ctx: ReplyContext,
  input: TalkInput,
  citations: Citation[],
  overview: boolean,
): Promise<ReplyPlan> {
  if (!llmConfigured()) {
    const reply = !input.rag
      ? mockReply(ctx, input.message)
      : overview && citations.length > 0
        ? mockOverviewReply(citations)
        : mockRagReply(citations, input.message);
    return { reply, model: 'mock-town', mock: true };
  }
  const { content, model } = await chatCompletion(buildMessages(ctx, citations, input.message));
  return { reply: content, model, mock: false };
}

/** 引用落库，让「这条结论来自哪一段」在事后依然可查（§问答溯源） */
function saveCitations(turnId: number, citations: Citation[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO citations (turn_id, chunk_id, quote, score) VALUES (?, ?, ?, ?)`,
  );
  for (const c of citations) {
    stmt.run(turnId, c.chunkId, c.quote.slice(0, 400), c.score);
  }
}

export async function talk(input: TalkInput): Promise<TalkResult> {
  const agent = resolveAgent(input.agentSlug);
  const userKey = 'owner';
  const sessionId = `${agent.slug}:${input.sessionKey}`;
  const message = input.message.trim().slice(0, 500);
  if (message === '') {
    throw new Error('消息不能为空');
  }

  ensureSession(sessionId, agent.id, userKey);
  const relation = readRelation(agent.id, userKey);
  const memories = readLongMemories(agent.id, userKey);
  const recent = readRecentTurns(sessionId);
  const stage = stageOf(relation.score);
  const affinity: AffinityView = {
    score: relation.score,
    stage: stage.key,
    label: stage.label,
    delta: 0,
    nextStageAt: nextStageAt(relation.score),
  };

  // 开检索增强时先取回原文片段：回答的依据必须是站内真实内容，不是模型的记忆。
  // 「这篇讲了什么」这类泛问一个词都命中不了，改走标题检索取概览。
  const about = input.about ?? null;
  const overview = input.rag === true && about !== null && isOverviewAsk(message);
  let citations: Citation[] = [];
  if (input.rag === true) {
    citations = overview && about !== null ? articleOverview(about, 3) : retrieve(message, 4, about);
  }

  const ctx: ReplyContext = {
    agent,
    affinity,
    memories: memories.map((m) => m.content),
    recent,
    turnIndex: countTurns(sessionId) + 1,
  };

  const startedAt = Date.now();
  const plan = await generateReply(ctx, input, citations, overview);
  const latencyMs = Date.now() - startedAt;

  const delta = affinityDelta(message);
  const finalScore = relation.score + delta;
  const after = stageOf(finalScore);

  const userTurnId = appendTurn(sessionId, agent.id, 'user', message, 0, 0, '');
  const assistantTurnId = appendTurn(
    sessionId,
    agent.id,
    'assistant',
    plan.reply,
    delta,
    latencyMs,
    plan.model,
  );
  if (citations.length > 0) {
    saveCitations(assistantTurnId, citations);
  }

  const fact = extractFact(message);
  if (fact && !hasMemory(agent.id, userKey, fact)) {
    writeMemory(agent.id, userKey, fact, userTurnId);
  }

  tx(getDb(), () => {
    writeRelation(agent.id, userKey, finalScore, after.key);
  });

  return {
    reply: plan.reply,
    agent: {
      slug: agent.slug,
      name: agent.name,
      avatar: agent.avatar,
      location: agent.location,
      isBlogAssistant: agent.meta.blogAssistant === true,
    },
    affinity: {
      score: finalScore,
      stage: after.key,
      label: after.label,
      delta,
      nextStageAt: nextStageAt(finalScore),
    },
    recalled: memories.map((m) => m.content),
    citations,
    sessionId,
    turnIndex: ctx.turnIndex,
    turnId: assistantTurnId,
    model: plan.model,
    mock: plan.mock,
    latencyMs,
  };
}

/** 某几轮问答各自引用了哪些原文片段。回放历史时，出处也要跟着回来。 */
function readCitations(turnIds: number[]): Map<number, { postSlug: string; postTitle: string; heading: string }[]> {
  const byTurn = new Map<number, { postSlug: string; postTitle: string; heading: string }[]>();
  if (turnIds.length === 0) return byTurn;
  const placeholders = turnIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT ct.turn_id AS turnId, p.slug AS postSlug, p.title AS postTitle, c.heading_path AS heading
       FROM citations ct
       JOIN chunks c ON c.id = ct.chunk_id
       JOIN posts p ON p.id = c.post_id
       WHERE ct.turn_id IN (${placeholders})
       ORDER BY ct.id`,
    )
    .all(...turnIds) as { turnId: number; postSlug: string; postTitle: string; heading: string }[];
  for (const row of rows) {
    const list = byTurn.get(row.turnId) ?? [];
    list.push({ postSlug: row.postSlug, postTitle: row.postTitle, heading: row.heading });
    byTurn.set(row.turnId, list);
  }
  return byTurn;
}

/** 读某次会话的对话日志（§15.5 实时日志的回放入口） */
export function readLog(sessionKey: string, agentSlug: string, limit = 50) {
  const agent = resolveAgent(agentSlug);
  const sessionId = `${agent.slug}:${sessionKey}`;
  // 取最近的 limit 条再翻回正序：否则会话一长，看到的永远是开头那几条
  const turns = getDb()
    .prepare(
      `SELECT * FROM (
         SELECT id, role, content, affinity_delta AS affinityDelta, latency_ms AS latencyMs, model, created_at AS createdAt
         FROM agent_turns WHERE session_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`,
    )
    .all(sessionId, limit) as { id: number }[];
  const citations = readCitations(turns.map((t) => t.id));

  return {
    sessionId,
    agentSlug: agent.slug,
    agentName: agent.name,
    turns: turns.map((turn) => ({ ...turn, sources: citations.get(turn.id) ?? [] })),
    affinity: (() => {
      const r = readRelation(agent.id, 'owner');
      const s = stageOf(r.score);
      return { score: r.score, stage: s.key, label: s.label };
    })(),
    memories: readLongMemories(agent.id, 'owner'),
  };
}
