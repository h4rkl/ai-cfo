import { allModels } from "./pricing";
import type { ModelPricing } from "./types";

/** OpenRouter model ids for each workspace model. First match wins. */
export const MARKET_MODEL_IDS: Record<string, string[]> = {
  "gpt-5.6-sol": ["openai/gpt-5.6-sol"],
  "gpt-5.6-terra": ["openai/gpt-5.6-terra"],
  "gpt-5.6-luna": ["openai/gpt-5.6-luna"],
  "gpt-5.3-codex": ["openai/gpt-5.3-codex"],
  "claude-opus-5": ["anthropic/claude-opus-5"],
  "claude-sonnet-5": ["anthropic/claude-sonnet-5"],
  "claude-opus-4.8": ["anthropic/claude-opus-4.8"],
  "claude-sonnet-4.6": ["anthropic/claude-sonnet-4.6"],
  "claude-fable-5": ["anthropic/claude-fable-5"],
  "claude-haiku-4.5": ["anthropic/claude-haiku-4.5"],
};

export const MARKET_SOURCE = "OpenRouter";
export const MARKET_URL = "https://openrouter.ai/api/v1/models";

export interface MarketQuote {
  id: string;
  marketId: string;
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM?: number;
  cacheWritePerM?: number;
}

export interface MarketRefresh {
  quotes: MarketQuote[];
  missingIds: string[];
  source: string;
  fetchedAt: string;
}

interface OpenRouterModel {
  id?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
}

function perMillion(raw: string | undefined): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw) * 1_000_000;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 10_000) / 10_000;
}

export function quotesFromOpenRouter(payload: unknown, wantedIds: string[]): MarketRefresh {
  const rows = Array.isArray((payload as { data?: unknown }).data)
    ? ((payload as { data: OpenRouterModel[] }).data)
    : [];
  const byId = new Map<string, OpenRouterModel>();
  for (const row of rows) {
    if (!row?.id || row.id.includes(":")) continue;
    byId.set(row.id, row);
  }

  const quotes: MarketQuote[] = [];
  const missingIds: string[] = [];
  for (const id of wantedIds) {
    const aliases = MARKET_MODEL_IDS[id] ?? [];
    const hit = aliases.map((alias) => byId.get(alias)).find(Boolean);
    const inputPerM = perMillion(hit?.pricing?.prompt);
    const outputPerM = perMillion(hit?.pricing?.completion);
    if (!hit || inputPerM == null || outputPerM == null) {
      missingIds.push(id);
      continue;
    }
    quotes.push({
      id,
      marketId: hit.id!,
      inputPerM,
      outputPerM,
      cachedInputPerM: perMillion(hit.pricing?.input_cache_read),
      cacheWritePerM: perMillion(hit.pricing?.input_cache_write),
    });
  }

  return {
    quotes,
    missingIds,
    source: MARKET_SOURCE,
    fetchedAt: new Date().toISOString(),
  };
}

export function applyMarketQuotes(custom: ModelPricing[], quotes: MarketQuote[]): ModelPricing[] {
  const byId = new Map(quotes.map((q) => [q.id, q]));
  return allModels(custom).map((model) => {
    const quote = byId.get(model.id);
    if (!quote) return { ...model };
    return {
      ...model,
      inputPerM: quote.inputPerM,
      outputPerM: quote.outputPerM,
      cachedInputPerM: quote.cachedInputPerM ?? model.cachedInputPerM,
      cacheWritePerM: quote.cacheWritePerM ?? model.cacheWritePerM,
    };
  });
}

function isRefresh(value: unknown): value is MarketRefresh {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as MarketRefresh).quotes) &&
      typeof (value as MarketRefresh).source === "string",
  );
}

export async function fetchMarketRates(wantedIds: string[]): Promise<MarketRefresh> {
  const urls = ["/api/model-prices", MARKET_URL];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        errors.push(`${url} (${response.status})`);
        continue;
      }
      const payload: unknown = await response.json();
      const result = isRefresh(payload) ? payload : quotesFromOpenRouter(payload, wantedIds);
      if (result.quotes.length) {
        return { ...result, fetchedAt: result.fetchedAt || new Date().toISOString() };
      }
      errors.push(`${url} had no matching models`);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not refresh market rates. ${errors[0] ?? ""}`.trim());
}
