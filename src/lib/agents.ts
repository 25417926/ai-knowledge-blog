import { getDb } from './db';

export type Agent = {
  id: number;
  kind: string;
  slug: string;
  name: string;
  persona: string;
  avatar: string;
  location: string;
  meta: Record<string, unknown>;
};

type AgentRow = {
  id: number;
  kind: string;
  slug: string;
  name: string;
  persona: string;
  avatar: string;
  location: string;
  meta: string;
};

function toAgent(row: AgentRow): Agent {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.meta) as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return { ...row, meta };
}

export function listAgents(): Agent[] {
  const rows = getDb()
    .prepare(`SELECT id, kind, slug, name, persona, avatar, location, meta FROM agents ORDER BY id`)
    .all() as AgentRow[];
  return rows.map(toAgent);
}

export function getAgentBySlug(slug: string): Agent | null {
  const row = getDb()
    .prepare(`SELECT id, kind, slug, name, persona, avatar, location, meta FROM agents WHERE slug = ?`)
    .get(slug) as AgentRow | undefined;
  return row ? toAgent(row) : null;
}

/** 博客端 AI 助手就是图书馆 NPC，通过这个函数拿到同一个 agent */
export function getBlogAssistant(): Agent | null {
  const rows = listAgents();
  return rows.find((a) => a.meta.blogAssistant === true) ?? rows[0] ?? null;
}
