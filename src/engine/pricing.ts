import type { ModelPricing } from "./types";

/**
 * Published short-context API prices per 1M tokens.
 * Verified 2026-08-19 against OpenAI and Anthropic docs.
 *
 * Codex Sol / Terra / Luna are GPT-5.6 tiers used in Codex and the API.
 * gpt-5.3-codex is the dedicated Codex model.
 */
export const BUILTIN_PRICES_AS_OF = "2026-08-19";

export const BUILTIN_MODELS: ModelPricing[] = [
  {
    id: "gpt-5.6-sol",
    name: "Codex Sol (GPT-5.6)",
    shortName: "Sol",
    provider: "openai",
    family: "Codex",
    inputPerM: 5.0,
    outputPerM: 30.0,
    cachedInputPerM: 0.5,
    cacheWritePerM: 6.25,
    capability: 96,
    timeFactor: 0.85,
    notes: "Flagship Codex tier. Best on hard design-to-code slices.",
  },
  {
    id: "gpt-5.6-terra",
    name: "Codex Terra (GPT-5.6)",
    shortName: "Terra",
    provider: "openai",
    family: "Codex",
    inputPerM: 2.0,
    outputPerM: 12.0,
    cachedInputPerM: 0.2,
    cacheWritePerM: 2.5,
    capability: 90,
    timeFactor: 1.0,
    notes: "Everyday Codex model. Usual baseline for delivery estimates.",
  },
  {
    id: "gpt-5.6-luna",
    name: "Codex Luna (GPT-5.6)",
    shortName: "Luna",
    provider: "openai",
    family: "Codex",
    inputPerM: 0.2,
    outputPerM: 1.2,
    cachedInputPerM: 0.02,
    cacheWritePerM: 0.25,
    capability: 78,
    timeFactor: 1.35,
    notes: "Cheap high-volume Codex tier. More review and rework.",
  },
  {
    id: "gpt-5.3-codex",
    name: "Codex (gpt-5.3-codex)",
    shortName: "5.3 Codex",
    provider: "openai",
    family: "Codex",
    inputPerM: 1.75,
    outputPerM: 14.0,
    cachedInputPerM: 0.175,
    cacheWritePerM: 2.1875,
    capability: 88,
    timeFactor: 1.05,
    notes: "Dedicated Codex model. Strong coding, slightly slower than Terra.",
  },
  {
    id: "claude-opus-5",
    name: "Claude Opus 5",
    shortName: "Opus 5",
    provider: "anthropic",
    family: "Claude",
    inputPerM: 5.0,
    outputPerM: 25.0,
    cachedInputPerM: 0.5,
    cacheWritePerM: 6.25,
    capability: 95,
    timeFactor: 0.9,
    notes: "Frontier Claude. Best when the slice is ambiguous or multi-file.",
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    shortName: "Sonnet 5",
    provider: "anthropic",
    family: "Claude",
    inputPerM: 2.0,
    outputPerM: 10.0,
    cachedInputPerM: 0.2,
    cacheWritePerM: 2.5,
    capability: 90,
    timeFactor: 1.0,
    notes: "Default Claude Code model. $2/$10 is now the standing price.",
  },
  {
    id: "claude-opus-4.8",
    name: "Claude Opus 4.8",
    shortName: "Opus 4.8",
    provider: "anthropic",
    family: "Claude",
    inputPerM: 5.0,
    outputPerM: 25.0,
    cachedInputPerM: 0.5,
    cacheWritePerM: 6.25,
    capability: 93,
    timeFactor: 0.95,
    notes: "Previous Opus generation. Same list price as Opus 5.",
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    shortName: "Sonnet 4.6",
    provider: "anthropic",
    family: "Claude",
    inputPerM: 3.0,
    outputPerM: 15.0,
    cachedInputPerM: 0.3,
    cacheWritePerM: 3.75,
    capability: 87,
    timeFactor: 1.08,
    notes: "Prior Sonnet generation. Still common on older Claude Code sessions.",
  },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5",
    shortName: "Fable 5",
    provider: "anthropic",
    family: "Claude",
    inputPerM: 10.0,
    outputPerM: 50.0,
    cachedInputPerM: 1.0,
    cacheWritePerM: 12.5,
    capability: 97,
    timeFactor: 0.82,
    notes: "Highest Claude tier. Shows up often in local Claude Code logs.",
  },
  {
    id: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    shortName: "Haiku 4.5",
    provider: "anthropic",
    family: "Claude",
    inputPerM: 1.0,
    outputPerM: 5.0,
    cachedInputPerM: 0.1,
    cacheWritePerM: 1.25,
    capability: 76,
    timeFactor: 1.4,
    notes: "Fast and cheap. Use for mechanical edits, not architecture.",
  },
];

export const DEFAULT_SELECTED_MODEL_IDS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.3-codex",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-haiku-4.5",
];

export function allModels(custom: ModelPricing[] = []): ModelPricing[] {
  const overrides = new Map(custom.map((m) => [m.id, m]));
  const merged = BUILTIN_MODELS.map((m) => overrides.get(m.id) ?? m);
  for (const extra of custom) {
    if (!BUILTIN_MODELS.some((m) => m.id === extra.id)) merged.push(extra);
  }
  return merged;
}

export function getModel(id: string, custom: ModelPricing[] = []): ModelPricing | undefined {
  return allModels(custom).find((m) => m.id === id);
}

export function modelTier(model: ModelPricing): "premium" | "standard" | "economy" {
  const avg = (model.inputPerM + model.outputPerM) / 2;
  if (avg >= 12) return "premium";
  if (avg >= 3) return "standard";
  return "economy";
}
