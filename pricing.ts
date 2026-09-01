/**
 * packages/demo/pricing.ts — vendored model pricing registry
 *
 * This package ships as a standalone open-source repo (mirrored to
 * Thsky-21/demo by scripts/mirror-demo.ts) and must build with nothing
 * outside its own directory — same rule packages/nextjs already follows.
 * cli.ts and engine.ts used to reach out to ../../lib/agent-pricing and
 * ../../lib/prices, which only exists inside the monorepo; a checkout of
 * just this package could never build.
 *
 * This file is therefore a VENDORED COPY of lib/prices.ts + lib/agent-pricing.ts,
 * combined into one file. It is not re-exported from there and can drift, so:
 *
 *   1. When the production registry (lib/prices.ts) changes, copy the change
 *      here too.
 *   2. tests/demo-pricing-parity.test.ts (monorepo-only, not mirrored) pins
 *      this file's exported values against lib/agent-pricing.ts / lib/prices.ts
 *      so a drift fails CI instead of shipping a demo that quotes the wrong
 *      price.
 */

// ─── Registry (vendored from lib/prices.ts) ───────────────────────────────────

/** Format: [input_per_1k_tokens, output_per_1k_tokens] in USD. */
export const MODEL_PRICES: Record<string, [number, number]> = {
  // ── OpenAI ──────────────────────────────────────────────────────────────
  "gpt-4o":                    [0.002500,  0.010000],
  "gpt-4o-mini":               [0.000150,  0.000600],
  "gpt-4-turbo":               [0.010000,  0.030000],
  "gpt-4":                     [0.030000,  0.060000],
  "gpt-3.5-turbo":             [0.000500,  0.001500],
  "o1":                        [0.015000,  0.060000],
  "o1-mini":                   [0.003000,  0.012000],
  "o1-pro":                    [0.150000,  0.600000],
  "o3":                        [0.010000,  0.040000],
  "o3-mini":                   [0.001100,  0.004400],
  "o4-mini":                   [0.001100,  0.004400],

  // ── Anthropic ───────────────────────────────────────────────────────────
  "claude-opus-4-6":                [0.015000,  0.075000],
  "claude-sonnet-4-6":             [0.003000,  0.015000],
  "claude-3-5-sonnet":             [0.003000,  0.015000],
  "claude-3-5-sonnet-20241022":    [0.003000,  0.015000],
  "claude-3-5-haiku":              [0.000800,  0.004000],
  "claude-haiku-4-5-20251001":     [0.000800,  0.004000],
  "claude-3-opus":                 [0.015000,  0.075000],
  "claude-3-sonnet":               [0.003000,  0.015000],
  "claude-3-haiku":                [0.000250,  0.001250],

  // ── Google ──────────────────────────────────────────────────────────────
  "gemini-1-5-pro":            [0.001250,  0.005000],
  "gemini-1-5-flash":          [0.000075,  0.000300],
  "gemini-2-0-flash":          [0.000100,  0.000400],
  "gemini-2-0-pro":            [0.002500,  0.010000],
  "gemini-2-5-pro":            [0.001250,  0.010000],
  "gemini-2-5-flash":          [0.000150,  0.000600],

  // ── Meta / Open source via API providers ────────────────────────────────
  "llama-3-1-70b":             [0.000590,  0.000790],
  "llama-3-1-8b":              [0.000180,  0.000180],
  "llama-3-3-70b":             [0.000590,  0.000790],
  "mixtral-8x7b":              [0.000240,  0.000240],

  // ── Mistral ─────────────────────────────────────────────────────────────
  "mistral-large":             [0.002000,  0.006000],
  "mistral-small":             [0.000200,  0.000600],
  "codestral":                 [0.000200,  0.000600],
};

/**
 * Conservative fallback for unrecognised models — the per-column FLOOR of
 * every published rate in MODEL_PRICES, computed from the registry so it
 * can't drift out of sync with it.
 */
export const DEFAULT_PRICE: [number, number] = (() => {
  let minIn = Infinity;
  let minOut = Infinity;
  for (const [inP, outP] of Object.values(MODEL_PRICES)) {
    if (inP < minIn) minIn = inP;
    if (outP < minOut) minOut = outP;
  }
  return [minIn, minOut];
})();

/** Whether a model's price is known exactly (true) or resolved via the floor fallback (false). */
export function isKnownModel(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICES, model);
}

/** How a step's cost was priced. "estimated" = unknown model, floor fallback used. */
export type PricingSource = "known" | "estimated";

/** Calculate cost for a model + token counts, rounded to 6dp. */
export function calculateCost(
  model:        string,
  inputTokens:  number,
  outputTokens: number
): number {
  const prices = MODEL_PRICES[model];
  const [inP, outP] = prices ?? DEFAULT_PRICE;
  const raw = (inputTokens / 1000) * inP + (outputTokens / 1000) * outP;
  return Math.round(raw * 1_000_000) / 1_000_000;
}

// ─── Microdollar conversions (vendored from lib/agent-pricing.ts) ─────────────

// 1 microdollar = 0.000001 USD (1e-6). $1 budget = 1_000_000 microdollars.
export const MICRODOLLARS_PER_USD = 1_000_000;

export function costToMicrodollars(usd: number): number {
  return Math.round(usd * MICRODOLLARS_PER_USD);
}

export function microdollarsToUsd(microdollars: number): number {
  return microdollars / MICRODOLLARS_PER_USD;
}

export function calculateCostMicrodollars(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  return costToMicrodollars(calculateCost(model, inputTokens, outputTokens));
}
