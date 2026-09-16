import { describe, expect, it } from "vitest";
import { applyMarketQuotes, quotesFromOpenRouter } from "../src/engine/marketRates";
import { BUILTIN_MODELS } from "../src/engine/pricing";

const feed = {
  data: [
    {
      id: "openai/gpt-5.6-sol",
      pricing: { prompt: "0.0000025", completion: "0.000015", input_cache_read: "0.00000025" },
    },
    {
      id: "openai/gpt-5.6-sol:batch",
      pricing: { prompt: "0.00000125", completion: "0.0000075" },
    },
    {
      id: "anthropic/claude-sonnet-5",
      pricing: {
        prompt: "0.000002",
        completion: "0.00001",
        input_cache_read: "0.0000002",
        input_cache_write: "0.0000025",
      },
    },
  ],
};

describe("quotesFromOpenRouter", () => {
  it("converts per-token prices to $/M and skips batch variants", () => {
    const result = quotesFromOpenRouter(feed, ["gpt-5.6-sol", "claude-sonnet-5", "claude-fable-5"]);
    expect(result.source).toBe("OpenRouter");
    expect(result.quotes).toEqual([
      {
        id: "gpt-5.6-sol",
        marketId: "openai/gpt-5.6-sol",
        inputPerM: 2.5,
        outputPerM: 15,
        cachedInputPerM: 0.25,
        cacheWritePerM: undefined,
      },
      {
        id: "claude-sonnet-5",
        marketId: "anthropic/claude-sonnet-5",
        inputPerM: 2,
        outputPerM: 10,
        cachedInputPerM: 0.2,
        cacheWritePerM: 2.5,
      },
    ]);
    expect(result.missingIds).toEqual(["claude-fable-5"]);
  });
});

describe("applyMarketQuotes", () => {
  it("overwrites list prices and leaves capability and time factor alone", () => {
    const sol = BUILTIN_MODELS.find((m) => m.id === "gpt-5.6-sol")!;
    const patched = applyMarketQuotes([], [
      { id: "gpt-5.6-sol", marketId: "openai/gpt-5.6-sol", inputPerM: 2.5, outputPerM: 15, cachedInputPerM: 0.25 },
    ]);
    const next = patched.find((m) => m.id === "gpt-5.6-sol")!;
    expect(next.inputPerM).toBe(2.5);
    expect(next.outputPerM).toBe(15);
    expect(next.cachedInputPerM).toBe(0.25);
    expect(next.capability).toBe(sol.capability);
    expect(next.timeFactor).toBe(sol.timeFactor);
    const terra = patched.find((m) => m.id === "gpt-5.6-terra")!;
    expect(terra.inputPerM).toBe(2);
  });
});
