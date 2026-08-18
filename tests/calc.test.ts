import { describe, expect, it } from "vitest";
import { compareWorkflow, contractorLane, effectiveRework, tokenCostUsd } from "../src/engine/calc";
import { defaultState, makeWorkflow } from "../src/engine/defaults";
import { estimateTokens, importUsageFromCsv } from "../src/engine/estimate";
import { BUILTIN_MODELS } from "../src/engine/pricing";
import { reportMarkdown } from "../src/engine/report";

const terra = BUILTIN_MODELS.find((m) => m.id === "gpt-5.6-terra")!;
const sol = BUILTIN_MODELS.find((m) => m.id === "gpt-5.6-sol")!;

describe("tokenCostUsd", () => {
  it("prices uncached + cached + output at published rates", () => {
    const cost = tokenCostUsd(terra, 1_000_000, 1_000_000, 400_000);
    expect(cost.uncached).toBeCloseTo(1.2, 8); // 600k * $2 / 1M
    expect(cost.cached).toBeCloseTo(0.08, 8); // 400k * $0.20 / 1M
    expect(cost.output).toBeCloseTo(12, 8);
    expect(cost.total).toBeCloseTo(13.28, 8);
  });

  it("Sol is more expensive than Terra on the same tokens", () => {
    const a = tokenCostUsd(sol, 800_000, 200_000, 0);
    const b = tokenCostUsd(terra, 800_000, 200_000, 0);
    expect(a.total).toBeGreaterThan(b.total);
  });
});

describe("contractorLane", () => {
  it("uses senior default rates on the landing-page preset", () => {
    const state = defaultState();
    const lane = contractorLane(state.workflows[0], state.rates);
    expect(state.rates.designHourly).toBe(150);
    expect(state.rates.codeHourly).toBe(200);
    expect(lane.totalCost).toBe(16 * 150 + 24 * 200);
    expect(lane.calendarDays).toBe(10);
  });
});

describe("effectiveRework", () => {
  it("leaves Terra/Sonnet-class models at the stated rate", () => {
    expect(effectiveRework(0.2, 90)).toBeCloseTo(0.2);
  });

  it("punishes weaker models with more rework", () => {
    expect(effectiveRework(0.2, 75)).toBeGreaterThan(0.2);
  });
});

describe("compareWorkflow", () => {
  it("picks an AI path over contractors on the default landing page", () => {
    const state = defaultState();
    const result = compareWorkflow(state, state.workflows[0]);
    expect(result.winner.kind).toBe("model");
    expect(result.winner.totalCost).toBeLessThan(result.contractor.totalCost);
    expect(result.winner.cfoScore).toBeGreaterThanOrEqual(result.lanes.at(-1)!.cfoScore);
    expect(result.briefing).toContain(result.winner.label);
  });

  it("subscription billing zeroes token cost and still allocates seats", () => {
    const state = defaultState();
    const wf = makeWorkflow({
      billingMode: "subscription",
      selectedModelIds: ["gpt-5.6-terra"],
    });
    const result = compareWorkflow(state, wf);
    expect(result.lanes[0].tokenCost).toBe(0);
    expect(result.lanes[0].seatCost).toBeCloseTo(state.seats.codexMonthly / state.seats.workflowsPerMonth);
  });

  it("uses an imported invoice as model spend in import mode", () => {
    const state = defaultState();
    const wf = makeWorkflow({
      inputMode: "import",
      billingMode: "api",
      selectedModelIds: ["claude-sonnet-5"],
      actuals: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        invoiceUsd: 88,
        source: "import",
        note: "test",
      },
    });
    const result = compareWorkflow(state, wf);
    expect(result.lanes[0].tokenCost).toBe(88);
  });
});

describe("estimateTokens", () => {
  it("prefers hour-based agentic volume over loc for a full slice", () => {
    const tokens = estimateTokens(
      makeWorkflow({
        tokenMode: "estimate",
        designHoursWithAi: 8,
        codeHoursWithAi: 18,
        loc: 100,
        cacheHitRate: 0.4,
      }),
    );
    expect(tokens.inputTokens).toBeGreaterThan(18 * 100_000);
    expect(tokens.cachedInputTokens).toBe(Math.round(tokens.inputTokens * 0.4));
  });
});

describe("csv import", () => {
  it("sums costs-style columns", () => {
    const csv = `commit_hash,tokens_input,tokens_output,cost
a,1000,200,0.12
b,4000,800,0.40`;
    const imported = importUsageFromCsv(csv);
    expect(imported.inputTokens).toBe(5000);
    expect(imported.outputTokens).toBe(1000);
    expect(imported.invoiceUsd).toBeCloseTo(0.52);
    expect(imported.rows).toBe(2);
  });
});

describe("report", () => {
  it("names the winner and the contractor baseline", () => {
    const state = defaultState();
    const comparison = compareWorkflow(state, state.workflows[0]);
    const md = reportMarkdown(state.workflows[0], comparison, state);
    expect(md).toContain(comparison.winner.label);
    expect(md).toContain("Contractor baseline");
    expect(md).toMatch(/\$150\/h/);
  });
});
