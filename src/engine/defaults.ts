import { DEFAULT_ESTIMATE } from "./estimate";
import { DEFAULT_SELECTED_MODEL_IDS } from "./pricing";
import type { AppState, Workflow } from "./types";

export function uid(prefix = "wf"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyActuals() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    invoiceUsd: 0,
    source: "manual" as const,
    note: "",
  };
}

export function makeWorkflow(partial: Partial<Workflow> = {}): Workflow {
  const { actuals: actualsPatch, ...rest } = partial;
  return {
    id: uid(),
    name: "Untitled delivery",
    notes: "",
    inputMode: "forecast",
    designHoursContractor: 16,
    codeHoursContractor: 24,
    calendarDaysContractor: 10,
    designHoursWithAi: 3,
    codeHoursWithAi: 6,
    reviewHours: 4,
    calendarDaysWithAi: 2,
    reworkRate: 0.2,
    loc: 800,
    tokenMode: "estimate",
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheHitRate: 0.4,
    billingMode: "both",
    selectedModelIds: [...DEFAULT_SELECTED_MODEL_IDS],
    ...rest,
    actuals: { ...emptyActuals(), ...actualsPatch },
  };
}

export const PRESETS: { id: string; label: string; hint: string; apply: () => Workflow }[] = [
  {
    id: "landing",
    label: "Landing page",
    hint: "Figma marketing page → GitHub PR",
    apply: () =>
      makeWorkflow({
        name: "Landing page",
        notes: "Figma marketing page to a production GitHub PR.",
        designHoursContractor: 16,
        codeHoursContractor: 24,
        calendarDaysContractor: 10,
        designHoursWithAi: 3,
        codeHoursWithAi: 6,
        reviewHours: 4,
        calendarDaysWithAi: 2,
        loc: 900,
      }),
  },
  {
    id: "feature",
    label: "Feature PR",
    hint: "One GitHub feature with light design",
    apply: () =>
      makeWorkflow({
        name: "Feature PR",
        notes: "Single product feature. Light Figma, heavy GitHub.",
        designHoursContractor: 4,
        codeHoursContractor: 20,
        calendarDaysContractor: 7,
        designHoursWithAi: 1,
        codeHoursWithAi: 5,
        reviewHours: 3,
        calendarDaysWithAi: 1.5,
        loc: 700,
      }),
  },
  {
    id: "system",
    label: "Design system",
    hint: "Figma system + component PRs",
    apply: () =>
      makeWorkflow({
        name: "Design system slice",
        notes: "Tokens, components, and a GitHub implementation pass.",
        designHoursContractor: 24,
        codeHoursContractor: 16,
        calendarDaysContractor: 12,
        designHoursWithAi: 6,
        codeHoursWithAi: 4,
        reviewHours: 4,
        calendarDaysWithAi: 3,
        loc: 600,
        reworkRate: 0.15,
      }),
  },
  {
    id: "slice",
    label: "Full slice",
    hint: "Auth + dashboard, design through ship",
    apply: () =>
      makeWorkflow({
        name: "Auth + dashboard slice",
        notes: "End-to-end product slice. Figma flows and GitHub delivery.",
        designHoursContractor: 32,
        codeHoursContractor: 80,
        calendarDaysContractor: 20,
        designHoursWithAi: 8,
        codeHoursWithAi: 18,
        reviewHours: 10,
        calendarDaysWithAi: 5,
        loc: 2800,
        reworkRate: 0.22,
      }),
  },
  {
    id: "hotfix",
    label: "Hotfix",
    hint: "Small GitHub patch, no design",
    apply: () =>
      makeWorkflow({
        name: "Hotfix",
        notes: "Small production patch. No Figma.",
        designHoursContractor: 0,
        codeHoursContractor: 4,
        calendarDaysContractor: 1.5,
        designHoursWithAi: 0,
        codeHoursWithAi: 0.75,
        reviewHours: 0.5,
        calendarDaysWithAi: 0.3,
        loc: 80,
        reworkRate: 0.1,
        cacheHitRate: 0.55,
      }),
  },
];

export function defaultState(): AppState {
  const first = PRESETS[0].apply();
  return {
    rates: {
      designHourly: 150,
      codeHourly: 200,
      reviewHourly: 200,
      opportunityPerDay: 800,
    },
    seats: {
      claudeMonthly: 200,
      codexMonthly: 200,
      workflowsPerMonth: 8,
    },
    estimate: { ...DEFAULT_ESTIMATE },
    workflows: [first],
    activeWorkflowId: first.id,
    customModels: [],
    pricesRefreshedAt: null,
    pricesSource: null,
  };
}

export function activeWorkflow(state: AppState): Workflow {
  return state.workflows.find((w) => w.id === state.activeWorkflowId) ?? state.workflows[0];
}
