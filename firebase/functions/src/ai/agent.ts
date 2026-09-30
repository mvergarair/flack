import type Anthropic from '@anthropic-ai/sdk';
import type { AiModel, Usage } from './config.js';
import type { ModelClient } from './model.js';
import { SYSTEM } from './prompt.js';
import { TOOLS, runTool, toolStatus, type ToolContext } from './tools.js';

export const MAX_ROUNDS = 6;

export interface AgentResult {
  text: string;
  usage: Usage;
  /** 'refusal' when the model declined; 'rounds' when it ran out of tool rounds. */
  stop: 'done' | 'refusal' | 'rounds' | 'max_tokens';
}

export interface AgentInput {
  client: ModelClient;
  model: AiModel;
  /** Earlier turns of this conversation, then the new question (last, role user). */
  messages: Anthropic.MessageParam[];
  tools: ToolContext;
  /** Progress for the live draft: a status line, and the answer text so far. */
  onProgress: (p: { status: string; text: string }) => void;
}

/**
 * The tool loop: ask, run the tools Claude calls (as the asker), feed the results back, until
 * it answers or runs out of rounds. The system prompt and tools never change, so they're
 * cached across questions.
 */
export async function runAgent({ client, model, messages: history, tools, onProgress }: AgentInput): Promise<AgentResult> {
  const messages = [...history];
  const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const add = (u: Anthropic.Usage) => {
    usage.input_tokens += u.input_tokens;
    usage.output_tokens += u.output_tokens;
    usage.cache_read_input_tokens! += u.cache_read_input_tokens ?? 0;
    usage.cache_creation_input_tokens! += u.cache_creation_input_tokens ?? 0;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let text = '';
    const message = await client.turn(
      {
        model,
        max_tokens: 16_000,
        // Chat answers: low effort is fast and cheap, and plenty for look-ups.
        output_config: { effort: 'low' },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages,
      },
      (delta) => {
        text += delta;
        onProgress({ status: 'Writing', text });
      },
    );
    add(message.usage);

    if (message.stop_reason === 'refusal') return { text: '', usage, stop: 'refusal' };
    const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const answer = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!calls.length) return { text: answer, usage, stop: message.stop_reason === 'max_tokens' ? 'max_tokens' : 'done' };
    // A tool call cut off at max_tokens may be truncated: don't run it.
    if (message.stop_reason === 'max_tokens') return { text: answer, usage, stop: 'max_tokens' };

    // The whole assistant turn goes back unchanged (including any thinking blocks).
    messages.push({ role: 'assistant', content: message.content });
    onProgress({ status: toolStatus(calls[0].name, (calls[0].input ?? {}) as Record<string, unknown>), text: '' });
    const results = await Promise.all(
      calls.map(async (call) => {
        const r = await runTool(tools, call.name, (call.input ?? {}) as Record<string, unknown>);
        return { type: 'tool_result' as const, tool_use_id: call.id, content: r.text, ...(r.error ? { is_error: true } : {}) };
      }),
    );
    // All results in one user message, so Claude keeps making parallel calls.
    messages.push({ role: 'user', content: results });
  }
  return { text: '', usage, stop: 'rounds' };
}

/** Turns stored questions and answers into alternating user/assistant turns (user first). */
export function historyTurns(items: { role: 'user' | 'assistant'; text: string }[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const it of items) {
    if (!it.text.trim()) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === it.role) prev.content = `${prev.content as string}\n\n${it.text}`;
    else out.push({ role: it.role, content: it.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  // The new question follows, so the history must end with an answer.
  if (out.length && out[out.length - 1].role === 'user') out.pop();
  return out;
}
