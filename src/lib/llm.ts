/**
 * LLM 适配器：只负责「真的去调模型」这一件事。
 *
 * 刻意不做通用 Mock —— 一个有性格的假回复需要知道角色人设、好感度、记忆，
 * 那些上下文在 agent-chat 里。把 Mock 放那儿比塞一个通用模板更合理。
 *
 * 协议走 OpenAI 兼容格式，改 baseURL 即可切 DeepSeek / 通义 / 智谱 / Ollama。
 */

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmReply = { content: string; model: string };

const BASE_URL = (process.env.LLM_BASE_URL ?? '').trim();
const API_KEY = (process.env.LLM_API_KEY ?? '').trim();
const MODEL = (process.env.LLM_MODEL ?? '').trim() || 'gpt-4o-mini';

export function llmConfigured(): boolean {
  return BASE_URL !== '' && API_KEY !== '';
}

export async function chatCompletion(
  messages: LlmMessage[],
  timeoutMs = 20000,
): Promise<LlmReply> {
  if (!llmConfigured()) {
    throw new Error('LLM 未配置：缺少 LLM_BASE_URL 或 LLM_API_KEY');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.8 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`LLM 返回 ${res.status}：${detail}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('LLM 返回内容为空');
    }
    return { content, model: MODEL };
  } finally {
    clearTimeout(timer);
  }
}
