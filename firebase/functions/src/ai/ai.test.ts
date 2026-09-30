import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { costUsd, DEFAULTS, sanitizeAiConfig } from './config.js';
import { historyTurns, MAX_ROUNDS, runAgent } from './agent.js';
import type { ModelClient } from './model.js';
import { Refs, toolStatus, type ToolContext } from './tools.js';
import { friendlyModelError } from './ask.js';

describe('sanitizeAiConfig', () => {
  it('defaults to off, Claude Sonnet 5.5, 30 a day, $20 a month', () => {
    expect(sanitizeAiConfig(undefined)).toEqual({ enabled: false, model: 'claude-sonnet-5-5', dailyLimit: 30, monthlyBudgetUsd: 20 });
    expect(DEFAULTS.model).toBe('claude-sonnet-5-5');
  });

  it('keeps valid values and clamps or drops the rest', () => {
    expect(sanitizeAiConfig({ enabled: true, model: 'claude-opus-5-5', dailyLimit: 5, monthlyBudgetUsd: 100 })).toEqual({ enabled: true, model: 'claude-opus-5-5', dailyLimit: 5, monthlyBudgetUsd: 100 });
    expect(sanitizeAiConfig({ enabled: 'yes', model: 'gpt', dailyLimit: 9999, monthlyBudgetUsd: -3 })).toEqual({ enabled: false, model: 'claude-sonnet-5-5', dailyLimit: 500, monthlyBudgetUsd: 0 });
  });
});

describe('costUsd', () => {
  it('prices input, output and cache reads/writes per model', () => {
    // Sonnet 5.5: $2 in, $10 out per million.
    expect(costUsd('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 })).toBeCloseTo(3);
    expect(costUsd('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(0.2 + 2.5);
    expect(costUsd('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
  });
});

describe('historyTurns', () => {
  it('starts with a question, merges repeats and ends with an answer', () => {
    expect(
      historyTurns([
        { role: 'assistant', text: 'stray answer' },
        { role: 'user', text: 'q1' },
        { role: 'user', text: 'q1 again' },
        { role: 'assistant', text: 'a1' },
        { role: 'user', text: 'unanswered' },
      ]),
    ).toEqual([
      { role: 'user', content: 'q1\n\nq1 again' },
      { role: 'assistant', content: 'a1' },
    ]);
  });
});

describe('Refs', () => {
  it('numbers each message once and lists only cited ones', () => {
    const refs = new Refs();
    const a = refs.add({ channelId: 'c', messageId: 'm1', threadParentId: null, label: '#general · Ada' });
    const b = refs.add({ channelId: 'c', messageId: 'm2', threadParentId: 'm1', label: '#general · Tom' });
    expect(refs.add({ channelId: 'c', messageId: 'm1', threadParentId: null, label: 'again' })).toBe(a);
    expect(refs.cited(`It shipped [${b}]. Also [${b}] and [99].`).map((s) => s.messageId)).toEqual(['m2']);
  });
});

describe('toolStatus', () => {
  it('describes what Flackbot is doing', () => {
    expect(toolStatus('search_messages', { query: 'pricing' })).toBe('Searching for “pricing”');
    expect(toolStatus('read_channel', { channel: 'general' })).toBe('Reading #general');
  });
});

describe('friendlyModelError', () => {
  it('points admins at Model Garden when the model is not enabled', () => {
    expect(friendlyModelError(Object.assign(new Error('Permission denied'), { status: 403 }))).toMatch(/Model Garden/);
    expect(friendlyModelError(Object.assign(new Error('slow down'), { status: 429 }))).toMatch(/too many/);
    const quota = 'Quota exceeded for aiplatform.googleapis.com/global_online_prediction_requests_per_base_model with base model: anthropic-claude-sonnet.';
    expect(friendlyModelError(Object.assign(new Error(quota), { status: 429 }))).toMatch(/quota for Claude is too low/);
  });
});

// A scripted model: returns the given turns in order and records what it was sent.
function scripted(turns: Anthropic.ContentBlock[][]): ModelClient & { sent: Anthropic.MessageStreamParams[] } {
  const sent: Anthropic.MessageStreamParams[] = [];
  return {
    sent,
    async turn(params, onText) {
      sent.push(structuredClone(params));
      const content = turns[Math.min(sent.length - 1, turns.length - 1)];
      for (const b of content) if (b.type === 'text') onText(b.text);
      const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
      return { id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Message;
    },
  };
}
const tool = (name: string, id = 't1') => ({ type: 'tool_use', id, name, input: {} }) as unknown as Anthropic.ContentBlock;
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as Anthropic.ContentBlock;
const ctx = { uid: 'u', refs: new Refs(), users: new Map(), channels: new Map() } as ToolContext;

describe('runAgent', () => {
  it('runs tool calls, sends every result back in one turn, and returns the answer', async () => {
    const client = scripted([[tool('unknown_a', 'a'), tool('unknown_b', 'b')], [text('All done.')]]);
    const progress: string[] = [];
    const r = await runAgent({ client, model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'hi' }], tools: ctx, onProgress: (p) => progress.push(p.status) });
    expect(r).toMatchObject({ text: 'All done.', stop: 'done' });
    expect(r.usage).toMatchObject({ input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 100 });
    const second = client.sent[1].messages;
    expect(second[1].role).toBe('assistant');
    expect(second[2]).toMatchObject({ role: 'user', content: [{ tool_use_id: 'a', is_error: true }, { tool_use_id: 'b', is_error: true }] });
    expect(progress).toContain('Working');
    // Stable, cacheable prefix; cheap effort; the default model.
    expect(client.sent[0]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'low' }, system: [{ cache_control: { type: 'ephemeral' } }] });
  });

  it(`stops after ${MAX_ROUNDS} tool rounds`, async () => {
    const client = scripted([[tool('loop')]]);
    const r = await runAgent({ client, model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'hi' }], tools: ctx, onProgress: () => undefined });
    expect(r.stop).toBe('rounds');
    expect(client.sent).toHaveLength(MAX_ROUNDS);
  });
});
