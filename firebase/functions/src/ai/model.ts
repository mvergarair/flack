import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { isEmulator, projectId } from '../lib/admin.js';

/** One model turn, streamed: text deltas go to `onText`, the complete message is returned. */
export interface ModelClient {
  turn(params: Anthropic.MessageStreamParams, onText: (delta: string) => void): Promise<Anthropic.Message>;
}

/**
 * Claude on Vertex AI in this install's own Google Cloud project: no API key, billed with the
 * rest of Firebase. Authenticates as the functions' service account (roles/aiplatform.user,
 * granted by scripts/prod-setup.sh). FLACK_AI_REGION overrides the global endpoint.
 */
function vertex(): ModelClient {
  const client = new AnthropicVertex({ projectId, region: process.env.FLACK_AI_REGION || 'global', maxRetries: 2 });
  return {
    async turn(params, onText) {
      const stream = client.messages.stream(params);
      stream.on('text', onText);
      return stream.finalMessage();
    },
  };
}

let cached: ModelClient | null = null;
export function modelClient(): ModelClient {
  if (!cached) cached = isEmulator || process.env.FLACKBOT_AI_FAKE === '1' ? fakeModel() : vertex();
  return cached;
}

/**
 * The emulator's stand-in for Claude, so tests exercise the whole loop (tools, permissions,
 * citations, streaming) without a network call. It searches for the question's words once,
 * then answers by quoting what it found.
 */
export function fakeModel(): ModelClient {
  const usage = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const message = (content: Anthropic.ContentBlock[], stop: Anthropic.StopReason): Anthropic.Message =>
    ({ id: 'msg_fake', type: 'message', role: 'assistant', model: String(''), content, stop_reason: stop, stop_sequence: null, usage }) as unknown as Anthropic.Message;

  return {
    async turn(params, onText) {
      const last = params.messages[params.messages.length - 1];
      const blocks = Array.isArray(last.content) ? last.content : [{ type: 'text' as const, text: last.content }];
      const result = blocks.find((b): b is Anthropic.ToolResultBlockParam => b.type === 'tool_result');
      if (!result) {
        const question = blocks.filter((b): b is Anthropic.TextBlockParam => b.type === 'text').map((b) => b.text).pop() ?? '';
        if (/\bno tools\b/i.test(question)) {
          const text = 'Hello from the fake model.';
          onText(text);
          return message([{ type: 'text', text, citations: null } as Anthropic.TextBlock], 'end_turn');
        }
        const query = question.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 3).slice(-2).join(' ');
        return message([{ type: 'tool_use', id: 'toolu_fake', name: 'search_messages', input: { query } } as Anthropic.ToolUseBlock], 'tool_use');
      }
      const raw = typeof result.content === 'string' ? result.content : '';
      let found: { ref: number; text: string }[] = [];
      try {
        found = (JSON.parse(raw) as { results?: { ref: number; text: string }[] }).results ?? [];
      } catch {
        // an error result
      }
      const text = found.length ? `I found ${found.length}: ${found.map((f) => `“${f.text}” [${f.ref}]`).join('; ')}` : "I couldn't find anything about that.";
      for (const part of text.match(/.{1,12}/gs) ?? []) onText(part);
      return message([{ type: 'text', text, citations: null } as Anthropic.TextBlock], 'end_turn');
    },
  };
}
