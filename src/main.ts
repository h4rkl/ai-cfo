import { compareWorkflow, tokensForLane } from "./engine/calc";
import { PRESETS, activeWorkflow, makeWorkflow, uid } from "./engine/defaults";
import { importUsageFromCsv } from "./engine/estimate";
import {
  summarizeUsage,
  workflowFromSessions,
  type LocalScanResult,
  type PricedSession,
} from "./engine/localUsage";
import { allModels } from "./engine/pricing";
import { reportHtml, reportMarkdown } from "./engine/report";
import type { AppState, BillingMode, InputMode, Workflow } from "./engine/types";
import { exportState, importStateJson, loadState, saveState } from "./store";
import "./styles.css";

type Screen = "compare" | "usage" | "models" | "report";

const state: AppState = loadState();
let screen: Screen = "compare";
let keepScroll = false;
let usageDays = 30;
let usageFilter: "all" | "claude" | "codex" = "all";
let usageSelected = new Set<string>();
let usageScan: LocalScanResult | null = null;
let usageError = "";
let usageLoading = false;

declare global {
  interface Window {
    __aicfoUsage?: {
      resolve: (value: LocalScanResult) => void;
      reject: (error: Error) => void;
    };
  }
}

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing #app");

root.addEventListener("click", onClick);
root.addEventListener("input", onInput);
root.addEventListener("change", onChange);
root.addEventListener("dragover", (e) => {
  if ((e.target as HTMLElement).closest("[data-drop]")) e.preventDefault();
});
root.addEventListener("drop", onDrop);

render();

function persist(): void {
  saveState(state);
}

function wf(): Workflow {
  return activeWorkflow(state);
}

function patchWorkflow(patch: Partial<Workflow>, keep?: HTMLInputElement | HTMLTextAreaElement): void {
  const id = state.activeWorkflowId;
  state.workflows = state.workflows.map((w) => (w.id === id ? { ...w, ...patch } : w));
  refresh(keep);
}

function refresh(keep?: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  persist();
  const identity = keep ? fieldIdentity(keep) : null;
  const start = keep && "selectionStart" in keep ? keep.selectionStart : null;
  const end = keep && "selectionEnd" in keep ? keep.selectionEnd : null;
  keepScroll = true;
  render();
  keepScroll = false;
  if (!identity) return;
  const next = root!.querySelector<HTMLInputElement | HTMLTextAreaElement>(identity);
  if (!next) return;
  next.focus();
  if (start != null && end != null && "setSelectionRange" in next) {
    try {
      next.setSelectionRange(start, end);
    } catch {
      /* number inputs may reject selection */
    }
  }
}

function fieldIdentity(el: HTMLElement): string | null {
  if (el.dataset.wf) return `[data-wf="${el.dataset.wf}"]`;
  if (el.dataset.rate) return `[data-rate="${el.dataset.rate}"]`;
  if (el.dataset.seat) return `[data-seat="${el.dataset.seat}"]`;
  if (el.dataset.est) return `[data-est="${el.dataset.est}"]`;
  if (el.dataset.price) return `[data-price="${el.dataset.price}"]`;
  return null;
}

function render(): void {
  const workflow = wf();
  const comparison = compareWorkflow(state, workflow);
  const tokens = tokensForLane(workflow, state.estimate);
  const y = window.scrollY;

  root!.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>AI <span>CFO</span></h1>
          <p>model · contractor · time-to-delivery</p>
        </div>
        <div class="tabs" role="tablist">
          ${tab("compare", "Compare")}
          ${tab("usage", "Local usage")}
          ${tab("models", "Models")}
          ${tab("report", "Report")}
        </div>
        <div class="cluster">
          <button class="ghost" data-act="export-state">Export workspace</button>
          <label class="ghost file-btn">Import workspace
            <input class="hidden" type="file" accept="application/json" data-import="workspace" />
          </label>
        </div>
      </header>
      ${
        screen === "compare"
          ? compareScreen(workflow, comparison, tokens)
          : screen === "usage"
            ? usageScreen()
            : screen === "models"
              ? modelsScreen()
              : reportScreen(workflow, comparison)
      }
    </div>
  `;
  window.scrollTo(0, keepScroll ? y : 0);
}

function tab(id: Screen, label: string): string {
  return `<button class="tab" role="tab" data-screen="${id}" aria-selected="${screen === id}">${label}</button>`;
}

function compareScreen(
  workflow: Workflow,
  comparison: ReturnType<typeof compareWorkflow>,
  tokens: { inputTokens: number; outputTokens: number; cachedInputTokens: number },
): string {
  const { contractor, lanes, winner, briefing } = comparison;
  return `
    <div class="workspace">
      <aside class="rail">
        <p class="kicker">Delivery</p>
        <label class="field">
          <span>Workflow</span>
          <select data-field="active">
            ${state.workflows
              .map((w) => `<option value="${w.id}" ${w.id === workflow.id ? "selected" : ""}>${esc(w.name)}</option>`)
              .join("")}
          </select>
        </label>
        <div class="actions">
          <button class="ghost" data-act="new-wf">New</button>
          <button class="ghost" data-act="dup-wf">Duplicate</button>
          <button class="ghost" data-act="del-wf">Delete</button>
        </div>
        <div class="chips" style="margin:12px 0 18px">
          ${PRESETS.map(
            (p) => `<button class="chip" data-preset="${p.id}" title="${esc(p.hint)}">${esc(p.label)}</button>`,
          ).join("")}
        </div>

        <label class="field">
          <span>Name</span>
          <input type="text" data-wf="name" value="${esc(workflow.name)}" />
        </label>
        <label class="field">
          <span>Notes</span>
          <textarea data-wf="notes">${esc(workflow.notes)}</textarea>
        </label>

        <div class="section">
          <p class="kicker">How you know the cost</p>
          <div class="seg" role="group">
            ${seg("inputMode", "forecast", "Forecast", workflow.inputMode)}
            ${seg("inputMode", "actuals", "Actuals", workflow.inputMode)}
            ${seg("inputMode", "import", "Import", workflow.inputMode)}
          </div>
        </div>

        <div class="section">
          <p class="kicker">Billing</p>
          <div class="seg" role="group">
            ${seg("billingMode", "api", "API tokens", workflow.billingMode)}
            ${seg("billingMode", "subscription", "Seats only", workflow.billingMode)}
            ${seg("billingMode", "both", "Both", workflow.billingMode)}
          </div>
        </div>

        <div class="section">
          <p class="kicker">Contractor baseline</p>
          <div class="pair">
            ${num("designHoursContractor", "Design hours", workflow.designHoursContractor, "h")}
            ${num("codeHoursContractor", "Code hours", workflow.codeHoursContractor, "h")}
          </div>
          ${num("calendarDaysContractor", "Calendar days", workflow.calendarDaysContractor, "d")}
        </div>

        <div class="section">
          <p class="kicker">With Codex / Claude</p>
          <div class="pair">
            ${num("designHoursWithAi", "Design hours left", workflow.designHoursWithAi, "h")}
            ${num("codeHoursWithAi", "Code hours left", workflow.codeHoursWithAi, "h")}
          </div>
          <div class="pair">
            ${num("reviewHours", "Review hours", workflow.reviewHours, "h")}
            ${num("calendarDaysWithAi", "Calendar days", workflow.calendarDaysWithAi, "d")}
          </div>
          ${num("reworkRate", "Rework fraction", workflow.reworkRate, "", 0.01)}
          ${num("loc", "Delivered LOC", workflow.loc, "")}
        </div>

        ${
          workflow.inputMode === "forecast"
            ? `<div class="section">
                <p class="kicker">Tokens</p>
                <div class="seg">
                  ${seg("tokenMode", "estimate", "Estimate", workflow.tokenMode)}
                  ${seg("tokenMode", "manual", "Manual", workflow.tokenMode)}
                </div>
                ${
                  workflow.tokenMode === "manual"
                    ? `<div class="pair" style="margin-top:10px">
                        ${num("inputTokens", "Input tokens", workflow.inputTokens, "")}
                        ${num("outputTokens", "Output tokens", workflow.outputTokens, "")}
                      </div>
                      ${num("cachedInputTokens", "Cached input", workflow.cachedInputTokens, "")}`
                    : `<p class="hint" style="margin:10px 0 8px">Estimate ${fmtInt(tokens.inputTokens)} in · ${fmtInt(tokens.outputTokens)} out · ${fmtInt(tokens.cachedInputTokens)} cached</p>
                       ${num("cacheHitRate", "Cache hit rate", workflow.cacheHitRate, "", 0.01)}`
                }
              </div>`
            : `<div class="section">
                <p class="kicker">${workflow.inputMode === "import" ? "Imported actuals" : "Actual spend"}</p>
                ${
                  workflow.inputMode === "import"
                    ? `<div class="drop" data-drop>
                        Drop a usage CSV here or
                        <label class="file-btn">choose file
                          <input class="hidden" type="file" accept=".csv,text/csv" data-import="csv" />
                        </label>
                        <div class="hint">${esc(workflow.actuals.note || "Expects input_tokens, output_tokens, cost")}</div>
                      </div>`
                    : ""
                }
                ${num("actuals.invoiceUsd", "Invoice / known spend", workflow.actuals.invoiceUsd, "$")}
                <div class="pair">
                  ${num("actuals.inputTokens", "Input tokens", workflow.actuals.inputTokens, "")}
                  ${num("actuals.outputTokens", "Output tokens", workflow.actuals.outputTokens, "")}
                </div>
                ${num("actuals.cachedInputTokens", "Cached input", workflow.actuals.cachedInputTokens, "")}
              </div>`
        }

        <div class="section">
          <p class="kicker">Rates</p>
          <div class="pair">
            ${rate("designHourly", "Design $/h", state.rates.designHourly)}
            ${rate("codeHourly", "Code $/h", state.rates.codeHourly)}
          </div>
          <div class="pair">
            ${rate("reviewHourly", "Review $/h", state.rates.reviewHourly)}
            ${rate("opportunityPerDay", "Day of delay $", state.rates.opportunityPerDay)}
          </div>
        </div>

        <div class="section">
          <p class="kicker">Monthly seats</p>
          <div class="pair">
            ${seat("claudeMonthly", "Claude $", state.seats.claudeMonthly)}
            ${seat("codexMonthly", "Codex $", state.seats.codexMonthly)}
          </div>
          ${seat("workflowsPerMonth", "Deliveries / month", state.seats.workflowsPerMonth)}
        </div>

        <div class="section">
          <p class="kicker">Compare models</p>
          <div class="chips">
            ${allModels(state.customModels)
              .map((m) => {
                const on = workflow.selectedModelIds.includes(m.id);
                return `<button class="chip" data-toggle-model="${m.id}" aria-pressed="${on}">${esc(m.shortName)}</button>`;
              })
              .join("")}
          </div>
        </div>
      </aside>

      <main class="stage">
        <p class="kicker">Sweet spot</p>
        <div class="hero">
          ${compassSvg(comparison)}
          <div class="verdict">
            <h2>${esc(winner.label)} <span class="stamp">${esc(winner.grade)}</span></h2>
            <p class="sub">${esc(briefing)}</p>
            <div class="metrics">
              ${metric(usd(winner.totalCost), "All-in cost")}
              ${metric(`${winner.calendarDays}d`, "Time to delivery")}
              ${metric(winner.kind === "contractor" ? "—" : `${winner.roi.toFixed(1)}×`, "ROI vs contractors")}
              ${metric(usd(winner.savingsVsContractor), "Cash saved")}
            </div>
          </div>
        </div>

        <table class="ledger">
          <thead>
            <tr>
              <th>Path</th>
              <th>Total</th>
              <th>Model</th>
              <th>Human</th>
              <th>Seats</th>
              <th>Days</th>
              <th>Cash vs contractors</th>
              <th>ROI</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            ${ledgerRow(contractor, false, true)}
            ${lanes.map((l) => ledgerRow(l, l.id === winner.id, false)).join("")}
          </tbody>
        </table>

        <div class="brief">
          <p class="kicker">CFO note</p>
          <p>${esc(briefing)}</p>
          <div class="actions">
            <button class="primary" data-act="goto-report">Open report</button>
            <button class="ghost" data-act="download-md">Download markdown</button>
            <button class="ghost" data-act="download-html">Download HTML</button>
            <button class="ghost" data-act="print">Print</button>
          </div>
        </div>
      </main>
    </div>
  `;
}

function usageScreen(): string {
  const summary = usageScan ? summarizeUsage(usageScan, state.customModels) : null;
  const rows = (summary?.sessions ?? []).filter(
    (s) => usageFilter === "all" || s.provider === usageFilter,
  );
  return `
    <div class="stage">
      <p class="kicker">Local Claude + Codex</p>
      <p class="hint">Reads the same session logs CodexBar uses: ~/.claude/projects and ~/.codex/sessions. No login. API-equivalent spend, not your subscription bill.</p>
      <div class="actions" style="margin:14px 0 18px">
        <button class="primary" data-act="scan-usage">${usageLoading ? "Scanning…" : "Scan this Mac"}</button>
        <div class="seg" style="max-width:280px">
          ${["7", "30", "90"].map((d) => `<button type="button" aria-pressed="${usageDays === Number(d)}" data-usage-days="${d}">${d}d</button>`).join("")}
        </div>
        <div class="seg" style="max-width:280px">
          ${(["all", "claude", "codex"] as const)
            .map(
              (f) =>
                `<button type="button" aria-pressed="${usageFilter === f}" data-usage-filter="${f}">${f}</button>`,
            )
            .join("")}
        </div>
      </div>
      ${usageError ? `<p class="hint" style="color:var(--signal)">${esc(usageError)}</p>` : ""}
      ${
        summary
          ? `<div class="metrics">
              ${metric(usd(summary.totals.apiCost), "API-equivalent spend")}
              ${metric(String(summary.totals.sessions), "Sessions")}
              ${metric(fmtInt(summary.totals.inputTokens + summary.totals.outputTokens), "Tokens")}
              ${metric(`${summary.byProvider.claude.sessions} / ${summary.byProvider.codex.sessions}`, "Claude / Codex")}
            </div>
            <div class="brief" style="margin-top:16px">
              <p class="kicker">Completed work</p>
              <p>Select the sessions that match a delivery, then compare that actual token mix against other models and contractors.</p>
              <div class="actions">
                <button class="primary" data-act="compare-selected">Compare selected</button>
                <button class="ghost" data-act="compare-all-visible">Compare all visible</button>
              </div>
            </div>
            <table class="ledger" style="margin-top:16px">
              <thead>
                <tr>
                  <th></th>
                  <th>Work</th>
                  <th>Project</th>
                  <th>Source</th>
                  <th>Model</th>
                  <th>Hours</th>
                  <th>Tokens</th>
                  <th>API $</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map((s) => usageRow(s))
                  .join("") || `<tr><td colspan="8">No sessions in this window.</td></tr>`}
              </tbody>
            </table>
            ${
              summary.projects.length
                ? `<h3 class="kicker" style="margin-top:28px">By project</h3>
                <table class="ledger">
                  <thead><tr><th>Project</th><th>Sessions</th><th>Tokens</th><th>API $</th></tr></thead>
                  <tbody>
                    ${summary.projects
                      .map(
                        (p) => `<tr>
                          <td>${esc(p.name)}</td>
                          <td>${p.sessions}</td>
                          <td>${fmtInt(p.inputTokens + p.outputTokens)}</td>
                          <td>${usd(p.apiCost)}</td>
                        </tr>`,
                      )
                      .join("")}
                  </tbody>
                </table>`
                : ""
            }`
          : `<p class="hint">Scan to list the work this Mac already completed in Claude Code and Codex.</p>`
      }
    </div>
  `;
}

function usageRow(session: PricedSession): string {
  const checked = usageSelected.has(session.id);
  return `<tr class="${checked ? "win" : ""}">
    <td><input type="checkbox" data-session="${esc(session.id)}" ${checked ? "checked" : ""} /></td>
    <td>${esc(session.title)}<div class="hint">${esc(session.prompt || "")}</div></td>
    <td>${esc(session.project)}</td>
    <td>${esc(session.provider)}</td>
    <td>${esc(session.models.join(", ") || "—")}</td>
    <td>${session.hours.toFixed(1)}</td>
    <td>${fmtInt(session.inputTokens + session.outputTokens)}</td>
    <td>${usd(session.apiCost)}</td>
  </tr>`;
}

function modelsScreen(): string {
  return `
    <div class="stage" style="max-width:1100px">
      <p class="kicker">List prices · August 2026</p>
      <p class="hint">Short-context API rates per 1M tokens. Edit a number to override for your workspace. Time factor is calendar days vs the workflow’s AI baseline (1.00 = baseline).</p>
      <div class="models-grid" style="margin-top:18px">
        ${allModels(state.customModels)
          .map((m) => {
            return `<article class="model-card">
              <header>
                <h3>${esc(m.name)}</h3>
                <span class="hint">${esc(m.family)}</span>
              </header>
              <p class="hint">${esc(m.notes)}</p>
              <div class="pair" style="margin-top:10px">
                <label class="field"><span>Input $/M</span><input type="number" step="0.01" data-price="${m.id}:inputPerM" value="${m.inputPerM}" /></label>
                <label class="field"><span>Output $/M</span><input type="number" step="0.01" data-price="${m.id}:outputPerM" value="${m.outputPerM}" /></label>
              </div>
              <div class="pair">
                <label class="field"><span>Cached in $/M</span><input type="number" step="0.01" data-price="${m.id}:cachedInputPerM" value="${m.cachedInputPerM}" /></label>
                <label class="field"><span>Time factor</span><input type="number" step="0.01" data-price="${m.id}:timeFactor" value="${m.timeFactor}" /></label>
              </div>
              <label class="field"><span>Capability</span><input type="number" step="1" min="1" max="100" data-price="${m.id}:capability" value="${m.capability}" /></label>
            </article>`;
          })
          .join("")}
      </div>
      <div class="section" style="margin-top:28px;max-width:520px">
        <p class="kicker">Token estimate knobs</p>
        <div class="pair">
          ${est("codingInputPerHour", "Code in / AI-hour")}
          ${est("codingOutputPerHour", "Code out / AI-hour")}
        </div>
        <div class="pair">
          ${est("designInputPerHour", "Design in / AI-hour")}
          ${est("designOutputPerHour", "Design out / AI-hour")}
        </div>
      </div>
    </div>
  `;
}

function reportScreen(
  workflow: Workflow,
  comparison: ReturnType<typeof compareWorkflow>,
): string {
  const html = reportHtml(workflow, comparison, state);
  const inner = html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? "";
  return `
    <div class="stage">
      <div class="actions" style="margin-bottom:16px">
        <button class="primary" data-act="print">Print / PDF</button>
        <button class="ghost" data-act="download-md">Markdown</button>
        <button class="ghost" data-act="download-html">HTML</button>
      </div>
      <article class="report-page">${inner}</article>
    </div>
  `;
}

function compassSvg(comparison: ReturnType<typeof compareWorkflow>): string {
  const pts = comparison.lanes.map((l) => {
    const x = 140 + (l.costScore - 50) * 1.7;
    const y = 140 - (l.speedScore - 50) * 1.7;
    return { ...l, x: clamp(x, 36, 244), y: clamp(y, 36, 244) };
  });
  return `
    <div>
      <svg class="compass" viewBox="0 0 280 280" role="img" aria-label="Sweet spot compass">
        <circle cx="140" cy="140" r="126" fill="#161410" stroke="#322e28" />
        <circle cx="140" cy="140" r="92" fill="none" stroke="#322e28" />
        <circle cx="140" cy="140" r="54" fill="none" stroke="#322e28" />
        <line x1="140" y1="22" x2="140" y2="258" stroke="#322e28" />
        <line x1="22" y1="140" x2="258" y2="140" stroke="#322e28" />
        <text x="140" y="16" text-anchor="middle" fill="#8c8478" font-size="9" font-family="IBM Plex Mono">FASTER</text>
        <text x="268" y="144" text-anchor="end" fill="#8c8478" font-size="9" font-family="IBM Plex Mono">CHEAPER</text>
        ${pts
          .map((p) => {
            const win = p.id === comparison.winner.id;
            const fill = win ? "#e09f3e" : p.provider === "anthropic" ? "#2a9d8f" : "#c9c0ae";
            return `<circle cx="${p.x}" cy="${p.y}" r="${win ? 8 : 5}" fill="${fill}">
              <title>${esc(p.label)} · ${p.cfoScore} ${p.grade}</title>
            </circle>`;
          })
          .join("")}
      </svg>
      <div class="legend">
        ${pts
          .map((p) => {
            const win = p.id === comparison.winner.id;
            const fill = win ? "#e09f3e" : p.provider === "anthropic" ? "#2a9d8f" : "#c9c0ae";
            return `<span><i style="background:${fill}"></i>${esc(p.label)}</span>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function ledgerRow(
  lane: ReturnType<typeof compareWorkflow>["contractor"],
  win: boolean,
  base: boolean,
): string {
  return `<tr class="${win ? "win" : ""} ${base ? "base" : ""}">
    <td>${esc(lane.label)}${win ? " ★" : ""}</td>
    <td>${usd(lane.totalCost)}</td>
    <td>${usd(lane.tokenCost)}</td>
    <td>${usd(lane.humanCost)}</td>
    <td>${usd(lane.seatCost)}</td>
    <td>${lane.calendarDays}</td>
    <td>${base ? "—" : usd(lane.savingsVsContractor)}</td>
    <td>${base ? "—" : `${lane.roi.toFixed(1)}×`}</td>
    <td>${base ? "—" : `${lane.cfoScore} ${lane.grade}`}</td>
  </tr>`;
}

function num(key: string, label: string, value: number, suffix: string, step = 1): string {
  return `<label class="field"><span>${label}${suffix ? ` (${suffix})` : ""}</span>
    <input type="number" step="${step}" data-wf="${key}" value="${value}" /></label>`;
}

function rate(key: keyof AppState["rates"], label: string, value: number): string {
  return `<label class="field"><span>${label}</span>
    <input type="number" step="5" data-rate="${key}" value="${value}" /></label>`;
}

function seat(key: keyof AppState["seats"], label: string, value: number): string {
  return `<label class="field"><span>${label}</span>
    <input type="number" step="1" data-seat="${key}" value="${value}" /></label>`;
}

function est(key: keyof AppState["estimate"], label: string): string {
  return `<label class="field"><span>${label}</span>
    <input type="number" step="1000" data-est="${key}" value="${state.estimate[key]}" /></label>`;
}

function metric(value: string, label: string): string {
  return `<div class="metric"><b>${value}</b><span>${label}</span></div>`;
}

function seg(field: string, value: string, label: string, current: string): string {
  return `<button type="button" aria-pressed="${current === value}" data-seg="${field}:${value}">${label}</button>`;
}

function onClick(e: Event): void {
  const t = e.target as HTMLElement;
  const screenBtn = t.closest<HTMLElement>("[data-screen]");
  if (screenBtn?.dataset.screen) {
    screen = screenBtn.dataset.screen as Screen;
    render();
    if (screen === "usage" && !usageScan && !usageLoading) void loadUsage();
    return;
  }
  const daysBtn = t.closest<HTMLElement>("[data-usage-days]");
  if (daysBtn?.dataset.usageDays) {
    usageDays = Number(daysBtn.dataset.usageDays);
    void loadUsage();
    return;
  }
  const filterBtn = t.closest<HTMLElement>("[data-usage-filter]");
  if (filterBtn?.dataset.usageFilter) {
    usageFilter = filterBtn.dataset.usageFilter as typeof usageFilter;
    render();
    return;
  }
  const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
  if (act) {
    handleAct(act);
    return;
  }
  const preset = t.closest<HTMLElement>("[data-preset]")?.dataset.preset;
  if (preset) {
    const found = PRESETS.find((p) => p.id === preset);
    if (found) {
      const next = found.apply();
      state.workflows = [...state.workflows, next];
      state.activeWorkflowId = next.id;
      persist();
      render();
    }
    return;
  }
  const toggle = t.closest<HTMLElement>("[data-toggle-model]")?.dataset.toggleModel;
  if (toggle) {
    const ids = new Set(wf().selectedModelIds);
    if (ids.has(toggle)) ids.delete(toggle);
    else ids.add(toggle);
    patchWorkflow({ selectedModelIds: [...ids] });
    return;
  }
  const segBtn = t.closest<HTMLElement>("[data-seg]")?.dataset.seg;
  if (segBtn) {
    const [field, value] = segBtn.split(":");
    if (field === "inputMode") patchWorkflow({ inputMode: value as InputMode });
    if (field === "billingMode") patchWorkflow({ billingMode: value as BillingMode });
    if (field === "tokenMode") patchWorkflow({ tokenMode: value as Workflow["tokenMode"] });
  }
}

function handleAct(act: string): void {
  if (act === "new-wf") {
    const next = makeWorkflow({ name: "New delivery" });
    state.workflows.push(next);
    state.activeWorkflowId = next.id;
    persist();
    render();
  }
  if (act === "dup-wf") {
    const next = { ...structuredClone(wf()), id: uid(), name: `${wf().name} copy` };
    state.workflows.push(next);
    state.activeWorkflowId = next.id;
    persist();
    render();
  }
  if (act === "del-wf") {
    if (state.workflows.length === 1) return;
    state.workflows = state.workflows.filter((w) => w.id !== wf().id);
    state.activeWorkflowId = state.workflows[0].id;
    persist();
    render();
  }
  if (act === "goto-report") {
    screen = "report";
    render();
  }
  if (act === "download-md") download("ai-cfo-report.md", reportMarkdown(wf(), compareWorkflow(state, wf()), state));
  if (act === "download-html") download("ai-cfo-report.html", reportHtml(wf(), compareWorkflow(state, wf()), state));
  if (act === "print") {
    screen = "report";
    render();
    requestAnimationFrame(() => window.print());
  }
  if (act === "export-state") download("ai-cfo-workspace.json", exportState(state));
  if (act === "scan-usage") void loadUsage();
  if (act === "compare-selected" || act === "compare-all-visible") {
    const summary = usageScan ? summarizeUsage(usageScan, state.customModels) : null;
    if (!summary) return;
    const visible = summary.sessions.filter((s) => usageFilter === "all" || s.provider === usageFilter);
    const chosen =
      act === "compare-all-visible"
        ? visible
        : visible.filter((s) => usageSelected.has(s.id));
    if (!chosen.length) {
      usageError = "Select at least one session, or compare all visible.";
      render();
      return;
    }
    const next = workflowFromSessions(chosen);
    state.workflows.push(next);
    state.activeWorkflowId = next.id;
    persist();
    screen = "compare";
    render();
  }
}

async function loadUsage(): Promise<void> {
  usageLoading = true;
  usageError = "";
  render();
  try {
    usageScan = await requestUsage(usageDays);
    usageSelected = new Set();
  } catch (error) {
    usageError =
      error instanceof Error
        ? error.message
        : "Could not read local Claude/Codex logs. Run via npm run dev or the Mac app.";
  } finally {
    usageLoading = false;
    render();
  }
}

async function requestUsage(days: number): Promise<LocalScanResult> {
  const bridge = (
    window as unknown as {
      webkit?: { messageHandlers?: { usage?: { postMessage: (v: unknown) => void } } };
    }
  ).webkit?.messageHandlers?.usage;
  if (bridge) {
    return new Promise((resolve, reject) => {
      window.__aicfoUsage = { resolve, reject };
      bridge.postMessage({ days });
    });
  }
  const response = await fetch(`/api/local-usage?days=${days}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Scan failed (${response.status})`);
  }
  return (await response.json()) as LocalScanResult;
}

function onInput(e: Event): void {
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (el.dataset.wf) {
    applyWorkflowField(el.dataset.wf, el.value, el);
    return;
  }
  if (el.dataset.rate) {
    state.rates[el.dataset.rate as keyof AppState["rates"]] = Number(el.value) || 0;
    refresh(el);
    return;
  }
  if (el.dataset.seat) {
    state.seats[el.dataset.seat as keyof AppState["seats"]] = Number(el.value) || 0;
    refresh(el);
    return;
  }
  if (el.dataset.est) {
    state.estimate[el.dataset.est as keyof AppState["estimate"]] = Number(el.value) || 0;
    refresh(el);
    return;
  }
  if (el.dataset.price) {
    const [id, key] = el.dataset.price.split(":");
    const current = allModels(state.customModels).find((m) => m.id === id);
    if (!current) return;
    state.customModels = [
      ...state.customModels.filter((m) => m.id !== id),
      { ...current, [key]: Number(el.value) || 0 },
    ];
    persist();
  }
}

function onChange(e: Event): void {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el instanceof HTMLInputElement && el.dataset.session) {
    const id = el.dataset.session;
    if (el.checked) usageSelected.add(id);
    else usageSelected.delete(id);
    render();
    return;
  }
  if (el instanceof HTMLSelectElement && el.dataset.field === "active") {
    state.activeWorkflowId = el.value;
    persist();
    render();
    return;
  }
  if (el instanceof HTMLInputElement && el.dataset.import === "csv" && el.files?.[0]) {
    void el.files[0].text().then(applyCsv);
  }
  if (el instanceof HTMLInputElement && el.dataset.import === "workspace" && el.files?.[0]) {
    void el.files[0].text().then((text) => {
      const next = importStateJson(text);
      Object.assign(state, next);
      persist();
      render();
    });
  }
}

function onDrop(e: DragEvent): void {
  const zone = (e.target as HTMLElement).closest("[data-drop]");
  if (!zone) return;
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) void file.text().then(applyCsv);
}

function applyCsv(text: string): void {
  const imported = importUsageFromCsv(text);
  patchWorkflow({
    inputMode: "import",
    actuals: {
      inputTokens: imported.inputTokens,
      outputTokens: imported.outputTokens,
      cachedInputTokens: imported.cachedInputTokens,
      cacheWriteTokens: 0,
      invoiceUsd: imported.invoiceUsd,
      source: "import",
      note: imported.note,
    },
  });
}

function applyWorkflowField(
  path: string,
  raw: string,
  keep?: HTMLInputElement | HTMLTextAreaElement,
): void {
  const current = wf();
  if (path === "name" || path === "notes") {
    patchWorkflow({ [path]: raw }, keep);
    return;
  }
  const value = Number(raw);
  if (path.startsWith("actuals.")) {
    const key = path.slice("actuals.".length) as keyof Workflow["actuals"];
    patchWorkflow(
      {
        actuals: {
          ...current.actuals,
          [key]: Number.isFinite(value) ? value : 0,
        },
      },
      keep,
    );
    return;
  }
  patchWorkflow({ [path]: Number.isFinite(value) ? value : 0 }, keep);
}

function download(name: string, body: string): void {
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
