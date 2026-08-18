import { estimateTokens } from "./estimate";
import { getModel } from "./pricing";
import type {
  AppState,
  Comparison,
  EstimateAssumptions,
  LaneResult,
  ModelPricing,
  Rates,
  Seats,
  Workflow,
} from "./types";

const HOURS_PER_DAY = 8;

export function money(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function gradeFromScore(score: number): LaneResult["grade"] {
  if (score >= 86) return "A";
  if (score >= 72) return "B";
  if (score >= 58) return "C";
  if (score >= 42) return "D";
  return "F";
}

export function tokenCostUsd(
  model: ModelPricing,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
  cacheWriteTokens = 0,
): { total: number; uncached: number; cached: number; output: number; cacheWrite: number } {
  const cached = Math.min(Math.max(cachedInputTokens, 0), Math.max(inputTokens, 0));
  const writes = Math.max(cacheWriteTokens, 0);
  const uncached = Math.max(inputTokens - cached - writes, 0);
  const uncachedCost = (uncached * model.inputPerM) / 1_000_000;
  const cachedCost = (cached * model.cachedInputPerM) / 1_000_000;
  const writeCost = (writes * model.cacheWritePerM) / 1_000_000;
  const outputCost = (Math.max(outputTokens, 0) * model.outputPerM) / 1_000_000;
  return {
    total: uncachedCost + cachedCost + writeCost + outputCost,
    uncached: uncachedCost,
    cached: cachedCost,
    cacheWrite: writeCost,
    output: outputCost,
  };
}

export function allocatedSeatCost(
  model: ModelPricing,
  seats: Seats,
  billingMode: Workflow["billingMode"],
): number {
  if (billingMode === "api") return 0;
  const n = Math.max(seats.workflowsPerMonth, 1);
  if (model.provider === "openai") return seats.codexMonthly / n;
  if (model.provider === "anthropic") return seats.claudeMonthly / n;
  return 0;
}

/**
 * Lower-capability models cost more in human rework.
 * Terra/Sonnet (90) sit at the user's stated rework rate.
 */
export function effectiveRework(baseRate: number, capability: number): number {
  const cap = Math.max(capability, 1);
  return Math.max(0, baseRate * (90 / cap));
}

export function contractorLane(workflow: Workflow, rates: Rates): LaneResult {
  const designCost = workflow.designHoursContractor * rates.designHourly;
  const codeCost = workflow.codeHoursContractor * rates.codeHourly;
  const hoursHuman = workflow.designHoursContractor + workflow.codeHoursContractor;
  const totalCost = designCost + codeCost;
  const calendarDays =
    workflow.calendarDaysContractor || Math.max(hoursHuman / HOURS_PER_DAY, 0.25);

  return {
    id: "contractor",
    label: "Contractors",
    kind: "contractor",
    tokenCost: 0,
    humanCost: totalCost,
    seatCost: 0,
    invoiceOverride: 0,
    totalCost: money(totalCost),
    calendarDays,
    hoursHuman,
    savingsVsContractor: 0,
    roi: 0,
    daysSaved: 0,
    timeValue: 0,
    netValue: 0,
    effectiveHourly: hoursHuman > 0 ? money(totalCost / hoursHuman) : 0,
    costScore: 0,
    speedScore: 0,
    qualityScore: 92,
    cfoScore: 0,
    grade: "C",
    breakdown: {
      designCost: money(designCost),
      codeCost: money(codeCost),
      reviewCost: 0,
      reworkCost: 0,
      uncachedInputCost: 0,
      cachedInputCost: 0,
      outputCost: 0,
    },
  };
}

export function modelLane(
  workflow: Workflow,
  rates: Rates,
  seats: Seats,
  model: ModelPricing,
  assumptions: EstimateAssumptions,
  contractor: LaneResult,
): LaneResult {
  const tokens = tokensForLane(workflow, assumptions);
  const tokensUsd = tokenCostUsd(
    model,
    tokens.inputTokens,
    tokens.outputTokens,
    tokens.cachedInputTokens,
    tokens.cacheWriteTokens,
  );

  const rework = effectiveRework(workflow.reworkRate, model.capability);
  const designHrs = workflow.designHoursWithAi * (1 + rework);
  const codeHrs = workflow.codeHoursWithAi * (1 + rework);
  const reviewHrs = workflow.reviewHours * (1 + rework * 0.5);

  const designCost = designHrs * rates.designHourly;
  const codeCost = codeHrs * rates.codeHourly;
  const reviewCost = reviewHrs * rates.reviewHourly;
  const humanCost = designCost + codeCost + reviewCost;
  const reworkCost = humanCost - (
    workflow.designHoursWithAi * rates.designHourly +
    workflow.codeHoursWithAi * rates.codeHourly +
    workflow.reviewHours * rates.reviewHourly
  );

  const seatCost = allocatedSeatCost(model, seats, workflow.billingMode);
  const useInvoice =
    workflow.inputMode === "actuals" || workflow.inputMode === "import";
  const invoiceOverride = useInvoice ? Math.max(workflow.actuals.invoiceUsd, 0) : 0;
  const recordedTokens =
    workflow.actuals.inputTokens +
    workflow.actuals.outputTokens +
    workflow.actuals.cachedInputTokens;

  let tokenCost = tokensUsd.total;
  if (workflow.billingMode === "subscription") tokenCost = 0;
  else if (useInvoice && invoiceOverride > 0 && recordedTokens === 0) tokenCost = invoiceOverride;

  const totalCost = tokenCost + humanCost + seatCost;
  const hoursHuman = designHrs + codeHrs + reviewHrs;

  const baseDays =
    workflow.calendarDaysWithAi || Math.max(hoursHuman / HOURS_PER_DAY, 0.15);
  const calendarDays = Math.max(baseDays * model.timeFactor, 0.1);

  const daysSaved = contractor.calendarDays - calendarDays;
  const timeValue = daysSaved * rates.opportunityPerDay;
  const savings = contractor.totalCost - totalCost;
  const netValue = savings + timeValue;
  const roi = totalCost > 0 ? netValue / totalCost : 0;

  const costScore = scoreCost(totalCost, contractor.totalCost);
  const speedScore = scoreSpeed(calendarDays, contractor.calendarDays);
  const qualityScore = clamp(
    model.capability * (1 - Math.min(rework, 0.6)),
    0,
    100,
  );
  const cfoScore = 0.4 * costScore + 0.35 * speedScore + 0.25 * qualityScore;

  return {
    id: model.id,
    label: model.shortName,
    kind: "model",
    modelId: model.id,
    provider: model.provider,
    tokenCost: money(tokenCost),
    humanCost: money(humanCost),
    seatCost: money(seatCost),
    invoiceOverride: money(invoiceOverride),
    totalCost: money(totalCost),
    calendarDays: round1(calendarDays),
    hoursHuman: round2(hoursHuman),
    savingsVsContractor: money(savings),
    roi: round1(roi),
    daysSaved: round1(daysSaved),
    timeValue: money(timeValue),
    netValue: money(netValue),
    effectiveHourly: hoursHuman > 0 ? money(totalCost / hoursHuman) : 0,
    costScore: round1(costScore),
    speedScore: round1(speedScore),
    qualityScore: round1(qualityScore),
    cfoScore: round1(cfoScore),
    grade: gradeFromScore(cfoScore),
    breakdown: {
      designCost: money(designCost),
      codeCost: money(codeCost),
      reviewCost: money(reviewCost),
      reworkCost: money(reworkCost),
      uncachedInputCost: money(tokensUsd.uncached),
      cachedInputCost: money(tokensUsd.cached),
      outputCost: money(tokensUsd.output),
    },
  };
}

export function compareWorkflow(state: AppState, workflow: Workflow): Comparison {
  const contractor = contractorLane(workflow, state.rates);
  const lanes = workflow.selectedModelIds
    .map((id) => getModel(id, state.customModels))
    .filter((m): m is ModelPricing => Boolean(m))
    .map((model) =>
      modelLane(workflow, state.rates, state.seats, model, state.estimate, contractor),
    )
    .sort((a, b) => b.cfoScore - a.cfoScore || a.totalCost - b.totalCost);

  const winner = lanes[0] ?? contractor;
  return {
    contractor,
    lanes,
    winner,
    briefing: writeBriefing(workflow, contractor, lanes, winner),
  };
}

export function tokensForLane(workflow: Workflow, assumptions: EstimateAssumptions) {
  if (workflow.inputMode === "actuals" || workflow.inputMode === "import") {
    const a = workflow.actuals;
    const hasTokens = a.inputTokens + a.outputTokens > 0;
    if (hasTokens) {
      return {
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        cachedInputTokens: a.cachedInputTokens,
        cacheWriteTokens: a.cacheWriteTokens ?? 0,
      };
    }
  }
  return { ...estimateTokens(workflow, assumptions), cacheWriteTokens: 0 };
}

function scoreCost(total: number, contractorTotal: number): number {
  if (contractorTotal <= 0) return 50;
  const ratio = total / contractorTotal;
  // 1% of contractor cost → 100; equal cost → 40; 2x contractor → 0
  return clamp(100 - ratio * 60, 0, 100);
}

function scoreSpeed(days: number, contractorDays: number): number {
  if (contractorDays <= 0) return 50;
  const ratio = days / contractorDays;
  return clamp(100 - ratio * 70, 0, 100);
}

function writeBriefing(
  workflow: Workflow,
  contractor: LaneResult,
  lanes: LaneResult[],
  winner: LaneResult,
): string {
  if (lanes.length === 0) {
    return "Select at least one model to compare against contractors.";
  }

  const runnerUp = lanes.find((l) => l.id !== winner.id);
  const cheapest = [...lanes].sort((a, b) => a.totalCost - b.totalCost)[0];
  const fastest = [...lanes].sort((a, b) => a.calendarDays - b.calendarDays)[0];

  const parts: string[] = [];
  parts.push(
    `For ${workflow.name}, ${winner.label} is the sweet spot: $${fmt(winner.totalCost)} and ${winner.calendarDays} days versus $${fmt(contractor.totalCost)} and ${contractor.calendarDays} days with contractors.`,
  );

  if (winner.savingsVsContractor > 0) {
    parts.push(
      `That is ${winner.roi.toFixed(1)}× net of time value, saving $${fmt(winner.savingsVsContractor)} in cash and ${winner.daysSaved} calendar days.`,
    );
  } else {
    parts.push(
      `Cash savings are thin or negative ($${fmt(winner.savingsVsContractor)}). The case, if any, is speed: ${winner.daysSaved} days.`,
    );
  }

  parts.push(
    `Human time still dominates the AI path: $${fmt(winner.humanCost)} in design, code, and review versus $${fmt(winner.tokenCost)} in model spend${winner.seatCost ? ` plus $${fmt(winner.seatCost)} of allocated seats` : ""}.`,
  );

  if (cheapest && cheapest.id !== winner.id) {
    parts.push(
      `${cheapest.label} is cheaper ($${fmt(cheapest.totalCost)}) but scores ${cheapest.cfoScore} vs ${winner.cfoScore} because it is slower or needs more rework.`,
    );
  }
  if (fastest && fastest.id !== winner.id) {
    const extra = fastest.totalCost - winner.totalCost;
    parts.push(
      `${fastest.label} finishes ${round1(winner.calendarDays - fastest.calendarDays)} days sooner for $${fmt(extra)} more. Pay that only if the date is the constraint.`,
    );
  }
  if (runnerUp && runnerUp.id !== cheapest?.id && runnerUp.id !== fastest?.id) {
    parts.push(`${runnerUp.label} is the next-best score at ${runnerUp.cfoScore}.`);
  }

  return parts.join(" ");
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
