export type Provider = "openai" | "anthropic" | "custom";

export type BillingMode = "api" | "subscription" | "both";

export type TokenMode = "estimate" | "manual";

export type InputMode = "forecast" | "actuals" | "import";

export interface ModelPricing {
  id: string;
  name: string;
  shortName: string;
  provider: Provider;
  family: string;
  inputPerM: number;
  outputPerM: number;
  cachedInputPerM: number;
  cacheWritePerM: number;
  /** Relative delivery quality for design + code work, 0–100. */
  capability: number;
  /** Calendar days vs the workflow's AI baseline. 1 = baseline. */
  timeFactor: number;
  notes: string;
}

export interface Rates {
  designHourly: number;
  codeHourly: number;
  reviewHourly: number;
  /** Value of shipping one calendar day earlier. */
  opportunityPerDay: number;
}

export interface Seats {
  claudeMonthly: number;
  codexMonthly: number;
  /** How many comparable deliveries the seats cover this month. */
  workflowsPerMonth: number;
}

export interface UsageActuals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  invoiceUsd: number;
  source: "manual" | "import" | "local";
  note: string;
}

export interface Workflow {
  id: string;
  name: string;
  notes: string;
  inputMode: InputMode;
  designHoursContractor: number;
  codeHoursContractor: number;
  calendarDaysContractor: number;
  designHoursWithAi: number;
  codeHoursWithAi: number;
  reviewHours: number;
  calendarDaysWithAi: number;
  /** Extra fraction of human AI-time spent on rework. */
  reworkRate: number;
  loc: number;
  tokenMode: TokenMode;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheHitRate: number;
  billingMode: BillingMode;
  selectedModelIds: string[];
  actuals: UsageActuals;
}

export interface LaneBreakdown {
  designCost: number;
  codeCost: number;
  reviewCost: number;
  reworkCost: number;
  uncachedInputCost: number;
  cachedInputCost: number;
  outputCost: number;
}

export interface LaneResult {
  id: string;
  label: string;
  kind: "contractor" | "model";
  modelId?: string;
  provider?: Provider;
  tokenCost: number;
  humanCost: number;
  seatCost: number;
  invoiceOverride: number;
  totalCost: number;
  calendarDays: number;
  hoursHuman: number;
  savingsVsContractor: number;
  roi: number;
  daysSaved: number;
  timeValue: number;
  netValue: number;
  effectiveHourly: number;
  costScore: number;
  speedScore: number;
  qualityScore: number;
  cfoScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: LaneBreakdown;
}

export interface Comparison {
  contractor: LaneResult;
  lanes: LaneResult[];
  winner: LaneResult;
  briefing: string;
}

export interface EstimateAssumptions {
  /** Agentic coding tokens consumed per human-with-AI hour. */
  codingInputPerHour: number;
  codingOutputPerHour: number;
  designInputPerHour: number;
  designOutputPerHour: number;
  /** Tokens of agent context per line of delivered code. */
  tokensPerLocInput: number;
  tokensPerLocOutput: number;
}

export interface AppState {
  rates: Rates;
  seats: Seats;
  estimate: EstimateAssumptions;
  workflows: Workflow[];
  activeWorkflowId: string;
  customModels: ModelPricing[];
  pricesRefreshedAt: string | null;
  pricesSource: string | null;
}

export interface ImportedUsageRow {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cost?: number;
  project?: string;
  date?: string;
  note?: string;
}
