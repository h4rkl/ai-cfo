import { tokenCostUsd } from "./calc";
import { allModels, getModel } from "./pricing";
import type { ModelPricing, Workflow } from "./types";
import { makeWorkflow } from "./defaults";

export type LocalProvider = "claude" | "codex";

export interface RawLocalSession {
  id: string;
  provider: LocalProvider;
  project: string;
  cwd: string;
  title: string;
  prompt: string;
  startedAt: string | null;
  endedAt: string | null;
  hours: number;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  turns: number;
}

export interface LocalScanResult {
  scannedAt: string;
  days: number;
  cutoff: string;
  claudeRoots: string[];
  codexRoots: string[];
  sessions: RawLocalSession[];
}

export interface PricedSession extends RawLocalSession {
  apiCost: number;
  primaryModel: string;
}

export interface UsageSummary {
  sessions: PricedSession[];
  projects: {
    name: string;
    cwd: string;
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    apiCost: number;
    providers: LocalProvider[];
  }[];
  byProvider: Record<
    LocalProvider,
    { sessions: number; inputTokens: number; outputTokens: number; apiCost: number }
  >;
  totals: {
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    apiCost: number;
    hours: number;
  };
}

export function resolveModelId(raw: string, custom: ModelPricing[] = []): string {
  const name = raw.trim().toLowerCase();
  if (!name) return "";
  const exact = getModel(name, custom);
  if (exact) return exact.id;
  const aliases: Record<string, string> = {
    "claude-fable-5": "claude-fable-5",
    fable: "claude-fable-5",
    "claude-opus-5": "claude-opus-5",
    "claude-sonnet-5": "claude-sonnet-5",
    "claude-haiku-4.5": "claude-haiku-4.5",
    "claude-haiku-4-5": "claude-haiku-4.5",
    "claude-opus-4.8": "claude-opus-4.8",
    "claude-sonnet-4.6": "claude-sonnet-4.6",
    "gpt-5.6-sol": "gpt-5.6-sol",
    "gpt-5.6-terra": "gpt-5.6-terra",
    "gpt-5.6-luna": "gpt-5.6-luna",
    "gpt-5.3-codex": "gpt-5.3-codex",
    sol: "gpt-5.6-sol",
    terra: "gpt-5.6-terra",
    luna: "gpt-5.6-luna",
  };
  if (aliases[name]) return aliases[name];
  const hit = allModels(custom).find(
    (m) => name.includes(m.id) || name.includes(m.shortName.toLowerCase()),
  );
  if (hit) return hit.id;
  if (name.includes("fable")) return "claude-fable-5";
  if (name.includes("opus")) return name.includes("4.8") ? "claude-opus-4.8" : "claude-opus-5";
  if (name.includes("sonnet")) return name.includes("4.6") ? "claude-sonnet-4.6" : "claude-sonnet-5";
  if (name.includes("haiku")) return "claude-haiku-4.5";
  if (name.includes("sol")) return "gpt-5.6-sol";
  if (name.includes("terra")) return "gpt-5.6-terra";
  if (name.includes("luna")) return "gpt-5.6-luna";
  if (name.includes("codex")) return "gpt-5.3-codex";
  return name;
}

export function priceSession(session: RawLocalSession, custom: ModelPricing[] = []): PricedSession {
  const primary = resolveModelId(session.models[0] || "", custom);
  const model =
    getModel(primary, custom) ||
    (session.provider === "claude"
      ? getModel("claude-sonnet-5", custom)
      : getModel("gpt-5.6-terra", custom));
  let apiCost = 0;
  if (model) {
    const priced = tokenCostUsd(
      model,
      session.inputTokens,
      session.outputTokens,
      session.cachedInputTokens,
      session.cacheWriteTokens,
    );
    apiCost = priced.total;
  }
  return {
    ...session,
    primaryModel: primary || session.models[0] || "unknown",
    apiCost: Math.round(apiCost * 100) / 100,
  };
}

export function summarizeUsage(
  scan: LocalScanResult,
  custom: ModelPricing[] = [],
): UsageSummary {
  const sessions = scan.sessions.map((s) => priceSession(s, custom));
  const projectMap = new Map<string, UsageSummary["projects"][number]>();
  const byProvider: UsageSummary["byProvider"] = {
    claude: { sessions: 0, inputTokens: 0, outputTokens: 0, apiCost: 0 },
    codex: { sessions: 0, inputTokens: 0, outputTokens: 0, apiCost: 0 },
  };
  const totals = {
    sessions: sessions.length,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    apiCost: 0,
    hours: 0,
  };

  for (const session of sessions) {
    totals.inputTokens += session.inputTokens;
    totals.outputTokens += session.outputTokens;
    totals.cachedInputTokens += session.cachedInputTokens;
    totals.cacheWriteTokens += session.cacheWriteTokens;
    totals.apiCost += session.apiCost;
    totals.hours += session.hours;
    const bucket = byProvider[session.provider];
    bucket.sessions += 1;
    bucket.inputTokens += session.inputTokens;
    bucket.outputTokens += session.outputTokens;
    bucket.apiCost += session.apiCost;

    const key = session.cwd || session.project;
    const existing = projectMap.get(key);
    if (existing) {
      existing.sessions += 1;
      existing.inputTokens += session.inputTokens;
      existing.outputTokens += session.outputTokens;
      existing.cachedInputTokens += session.cachedInputTokens;
      existing.apiCost += session.apiCost;
      if (!existing.providers.includes(session.provider)) existing.providers.push(session.provider);
    } else {
      projectMap.set(key, {
        name: session.project,
        cwd: session.cwd,
        sessions: 1,
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cachedInputTokens: session.cachedInputTokens,
        apiCost: session.apiCost,
        providers: [session.provider],
      });
    }
  }

  totals.apiCost = Math.round(totals.apiCost * 100) / 100;
  const projects = [...projectMap.values()]
    .map((p) => ({ ...p, apiCost: Math.round(p.apiCost * 100) / 100 }))
    .sort((a, b) => b.apiCost - a.apiCost);

  return { sessions, projects, byProvider, totals };
}

export function workflowFromSessions(sessions: PricedSession[]): Workflow {
  const titles = [...new Set(sessions.map((s) => s.title).filter(Boolean))];
  const hours = sessions.reduce((n, s) => n + s.hours, 0);
  const input = sessions.reduce((n, s) => n + s.inputTokens, 0);
  const output = sessions.reduce((n, s) => n + s.outputTokens, 0);
  const cached = sessions.reduce((n, s) => n + s.cachedInputTokens, 0);
  const writes = sessions.reduce((n, s) => n + s.cacheWriteTokens, 0);
  const invoice = sessions.reduce((n, s) => n + s.apiCost, 0);
  const calendar = Math.max(hours / 8, hours > 0 ? 0.2 : 1);
  const models = [
    ...new Set(sessions.map((s) => resolveModelId(s.primaryModel)).filter(Boolean)),
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-haiku-4.5",
  ];

  return makeWorkflow({
    name: titles[0] || `${sessions.length} local session${sessions.length === 1 ? "" : "s"}`,
    notes: sessions
      .map((s) => `${s.provider}: ${s.title} · ${s.project} · $${s.apiCost.toFixed(2)}`)
      .join("\n"),
    inputMode: "actuals",
    tokenMode: "manual",
    billingMode: "api",
    designHoursContractor: Math.max(hours * 1.4, 2),
    codeHoursContractor: Math.max(hours * 3.2, 4),
    calendarDaysContractor: Math.max(calendar * 4, 1),
    designHoursWithAi: Math.max(hours * 0.25, 0.25),
    codeHoursWithAi: Math.max(hours * 0.45, 0.25),
    reviewHours: Math.max(hours * 0.3, 0.25),
    calendarDaysWithAi: Math.max(calendar, 0.2),
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    cacheHitRate: input > 0 ? cached / input : 0.4,
    selectedModelIds: [...new Set(models)],
    actuals: {
      inputTokens: input,
      outputTokens: output,
      cachedInputTokens: cached,
      cacheWriteTokens: writes,
      invoiceUsd: Math.round(invoice * 100) / 100,
      source: "local",
      note: `Imported ${sessions.length} local ${sessions.length === 1 ? "session" : "sessions"}`,
    },
  });
}
