// Ask Flackbot settings (config/ai, set by admins) and what answers cost. Pure helpers here;
// the Firestore reads live in ask.ts.

export const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5'] as const;
export type AiModel = (typeof MODELS)[number];
export const DEFAULT_MODEL: AiModel = 'claude-sonnet-5-5';

export interface AiConfig {
  enabled: boolean;
  model: AiModel;
  /** Questions per person per day. */
  dailyLimit: number;
  /** Flackbot pauses for the rest of the month once this is reached (0 = no cap). */
  monthlyBudgetUsd: number;
}

export const DEFAULTS: AiConfig = { enabled: false, model: DEFAULT_MODEL, dailyLimit: 30, monthlyBudgetUsd: 20 };

export function sanitizeAiConfig(raw: unknown): AiConfig {
  const d = (raw ?? {}) as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : dflt);
  return {
    enabled: d.enabled === true,
    model: MODELS.includes(d.model as AiModel) ? (d.model as AiModel) : DEFAULT_MODEL,
    dailyLimit: int(d.dailyLimit, 1, 500, DEFAULTS.dailyLimit),
    monthlyBudgetUsd: int(d.monthlyBudgetUsd, 0, 10_000, DEFAULTS.monthlyBudgetUsd),
  };
}

/** US$ per million tokens (Vertex AI matches Anthropic's list prices for these models). */
const PRICES: Record<AiModel, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Cost of one response: cache reads bill at 10% of input, cache writes at 125%. */
export function costUsd(model: AiModel, u: Usage): number {
  const p = PRICES[model];
  const input = u.input_tokens * p.input + (u.cache_read_input_tokens ?? 0) * p.input * 0.1 + (u.cache_creation_input_tokens ?? 0) * p.input * 1.25;
  return (input + u.output_tokens * p.output) / 1_000_000;
}

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
