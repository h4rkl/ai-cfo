import { defaultState } from "./engine/defaults";
import type { AppState, Workflow } from "./engine/types";

const KEY = "ai-cfo:v1";

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as AppState;
    return hydrate(parsed);
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function exportState(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function importStateJson(raw: string): AppState {
  return hydrate(JSON.parse(raw) as AppState);
}

function hydrate(parsed: Partial<AppState>): AppState {
  const base = defaultState();
  const workflows = Array.isArray(parsed.workflows) && parsed.workflows.length
    ? parsed.workflows.map(hydrateWorkflow)
    : base.workflows;
  return {
    rates: { ...base.rates, ...parsed.rates },
    seats: { ...base.seats, ...parsed.seats },
    estimate: { ...base.estimate, ...parsed.estimate },
    workflows,
    activeWorkflowId: parsed.activeWorkflowId ?? workflows[0].id,
    customModels: parsed.customModels ?? [],
    pricesRefreshedAt: typeof parsed.pricesRefreshedAt === "string" ? parsed.pricesRefreshedAt : null,
    pricesSource: typeof parsed.pricesSource === "string" ? parsed.pricesSource : null,
  };
}

function hydrateWorkflow(w: Partial<Workflow>): Workflow {
  const base = defaultState().workflows[0];
  return {
    ...base,
    ...w,
    actuals: { ...base.actuals, ...w.actuals },
    selectedModelIds: w.selectedModelIds?.length ? w.selectedModelIds : base.selectedModelIds,
    id: w.id ?? base.id,
  };
}
