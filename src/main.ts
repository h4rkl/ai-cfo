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

const MODEL_COLORS: Record<string, string> = {
  "gpt-5.6-sol": "#4c6fff",
  "gpt-5.6-terra": "#3d7fd6",
  "gpt-5.6-luna": "#8b8fff",
  "gpt-5.3-codex": "#6b5ce7",
  "claude-opus-5": "#2f9b74",
  "claude-sonnet-5": "#3db8a0",
  "claude-opus-4.8": "#1f7a5c",
  "claude-sonnet-4.6": "#5bb8d4",
  "claude-fable-5": "#c9842a",
  "claude-haiku-4.5": "#d15b4a",
};

const FALLBACK_COLORS = ["#6b7078", "#8b9099", "#a3a8b0", "#5c6570"];

function modelColor(id?: string): string {
  if (!id) return "#a3a8b0";
  if (MODEL_COLORS[id]) return MODEL_COLORS[id];
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

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
  const desk = root!.querySelector<HTMLElement>(".desk");
  const y = desk ? desk.scrollTop : window.scrollY;

  root!.innerHTML = `
    <div class="app-frame">
      ${sidebar(workflow)}
      <div class="desk">
        ${topbar(workflow)}
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
    </div>
  `;
  const next = root!.querySelector<HTMLElement>(".desk");
  if (next) next.scrollTop = keepScroll ? y : 0;
  else window.scrollTo(0, keepScroll ? y : 0);
}

function screenLabel(id: Screen): string {
  return id === "compare" ? "Compare" : id === "usage" ? "Local usage" : id === "models" ? "Models" : "Report";
}

function sidebar(workflow: Workflow): string {
  return `
    <aside class="sidenav">
      <div class="brand">
        <h1>AI CFO</h1>
        <p>model · contractor · time-to-delivery</p>
      </div>
      <nav class="nav-scroll" role="tablist">
        <p class="nav-label">Main Menu</p>
        ${navItem("compare", "Compare", "grid")}
        ${navItem("usage", "Local usage", "bars")}
        <p class="nav-label">Insights</p>
        ${navItem("models", "Models", "box")}
        ${navItem("report", "Report", "file")}
        <p class="nav-label">Workspace</p>
        <button class="nav-item" type="button" data-act="export-state">${icon("download")}<span>Export workspace</span></button>
        <label class="nav-item file-btn">${icon("upload")}<span>Import workspace</span>
          <input class="hidden" type="file" accept="application/json" data-import="workspace" />
        </label>
      </nav>
      <div class="nav-foot">
        <div class="avatar">${esc(initials(workflow.name))}</div>
        <div class="who">
          <b>${esc(workflow.name)}</b>
          <span>model · contractor · time-to-delivery</span>
        </div>
        <button class="icon-btn" data-act="export-state" title="Export workspace">${icon("logout")}</button>
      </div>
    </aside>
  `;
}

function topbar(workflow: Workflow): string {
  return `
    <header class="top">
      <div class="crumb">
        <span>Workspace</span>
        <span class="crumb-sep">›</span>
        <b>${screenLabel(screen)}</b>
      </div>
      <div class="top-tools">
        ${
          screen === "compare"
            ? `<label class="search-pill">${icon("search")}
                <select data-field="active" aria-label="Workflow">
                  ${state.workflows
                    .map((w) => `<option value="${w.id}" ${w.id === workflow.id ? "selected" : ""}>${esc(w.name)}</option>`)
                    .join("")}
                </select>
              </label>`
            : ""
        }
        <button class="icon-btn" data-act="export-state" title="Export workspace">${icon("download")}</button>
        <label class="icon-btn file-btn" title="Import workspace">${icon("upload")}
          <input class="hidden" type="file" accept="application/json" data-import="workspace" />
        </label>
      </div>
    </header>
  `;
}

function navItem(id: Screen, label: string, glyph: string): string {
  return `<button class="nav-item" role="tab" data-screen="${id}" aria-selected="${screen === id}">${icon(glyph)}<span>${label}</span></button>`;
}

function compareScreen(
  workflow: Workflow,
  comparison: ReturnType<typeof compareWorkflow>,
  tokens: { inputTokens: number; outputTokens: number; cachedInputTokens: number },
): string {
  const { contractor, lanes, winner, briefing } = comparison;
  const roiLabel = winner.kind === "contractor" ? "—" : `${winner.roi.toFixed(1)}×`;
  const savedShare = contractor.totalCost > 0 ? clamp((winner.savingsVsContractor / contractor.totalCost) * 100, 0, 100) : 0;
  return `
    <div class="board">
      ${kpi("All-in cost", usd(winner.totalCost), winner.label, "bag", winner.costScore)}
      ${kpi("Time to delivery", `${winner.calendarDays}d`, `${winner.cfoScore} ${winner.grade}`, "clock", winner.speedScore)}
      ${kpi("ROI vs contractors", roiLabel, winner.label, "trend", clamp(winner.roi * 10, 0, 100))}
      ${kpi("Cash saved", usd(winner.savingsVsContractor), winner.label, "refresh", savedShare)}

      <section class="cell span-8">
        <div class="cell-head">
          <div>
            <h2>Sweet spot</h2>
          </div>
        </div>
        <div class="compass-wrap">
          ${compassSvg(comparison)}
          <div class="verdict">
            <h2>${esc(winner.label)} ${gradePill(winner.grade)}</h2>
            <p class="sub">${esc(briefing)}</p>
          </div>
        </div>
      </section>

      <section class="cell span-4">
        <div class="cell-head">
          <div>
            <h2>CFO score ${winner.cfoScore}</h2>
            <p>${esc(winner.label)}</p>
          </div>
          ${gradePill(winner.grade)}
        </div>
        ${scoreBars(winner)}
      </section>

      <section class="cell span-4">
        <div class="cell-head">
          <div>
            <h2>Delivery</h2>
            <p>How you know the cost</p>
          </div>
        </div>
        <div class="actions" style="margin-top:0">
          <button class="ghost" data-act="new-wf">New</button>
          <button class="ghost" data-act="dup-wf">Duplicate</button>
          <button class="ghost" data-act="del-wf">Delete</button>
        </div>
        <div class="chips" style="margin:12px 0 14px">
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
      </section>

      <section class="cell span-8">
        <div class="cell-head">
          <div>
            <h2>Path</h2>
          </div>
          <button class="pill-btn" data-act="goto-report">Open report</button>
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
      </section>

      <section class="cell span-3">
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
      </section>

      <section class="cell span-3">
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
      </section>

      <section class="cell span-3">
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
      </section>

      <section class="cell span-3">
        <div class="section">
          <p class="kicker">Compare models</p>
          <div class="chips">
            ${allModels(state.customModels)
              .map((m) => {
                const on = workflow.selectedModelIds.includes(m.id);
                return `<button class="chip" data-toggle-model="${m.id}" aria-pressed="${on}" style="--chip:${modelColor(m.id)}"><i class="chip-dot"></i>${esc(m.shortName)}</button>`;
              })
              .join("")}
          </div>
        </div>
      </section>
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
      <div class="stage-intro">
        <p class="kicker">Local Claude + Codex</p>
        <p class="hint">Reads the same session logs CodexBar uses: ~/.claude/projects and ~/.codex/sessions. No login. API-equivalent spend, not your subscription bill.</p>
      </div>
      <div class="toolbar">
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
      ${usageError ? `<p class="hint pad" style="color:var(--signal)">${esc(usageError)}</p>` : ""}
      ${
        summary
          ? `<div class="board">
              ${kpi("API-equivalent spend", usd(summary.totals.apiCost), `${summary.totals.sessions} sessions`, "bag", clamp(summary.totals.sessions * 4, 18, 88))}
              ${kpi("Sessions", String(summary.totals.sessions), `${usageDays}d`, "bars", clamp(summary.totals.sessions * 5, 18, 88))}
              ${kpi("Tokens", fmtInt(summary.totals.inputTokens + summary.totals.outputTokens), `${fmtInt(summary.totals.inputTokens)} in · ${fmtInt(summary.totals.outputTokens)} out`, "file", clamp(Math.log10(Math.max(summary.totals.inputTokens + summary.totals.outputTokens, 10)) * 14, 18, 88))}
              ${kpi("Claude / Codex", `${summary.byProvider.claude.sessions} / ${summary.byProvider.codex.sessions}`, "Claude / Codex", "refresh", summary.totals.sessions ? (summary.byProvider.claude.sessions / summary.totals.sessions) * 100 : 50)}
              <section class="cell span-4">
                <div class="cell-head">
                  <div>
                    <h2>Completed work</h2>
                    <p>Select the sessions that match a delivery, then compare that actual token mix against other models and contractors.</p>
                  </div>
                </div>
                <div class="actions" style="margin-top:0">
                  <button class="primary" data-act="compare-selected">Compare selected</button>
                  <button class="ghost" data-act="compare-all-visible">Compare all visible</button>
                </div>
              </section>
              <section class="cell span-8">
                <table class="ledger">
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
              </section>
              ${
                summary.projects.length
                  ? `<section class="cell span-12">
                      <div class="cell-head"><div><h2>By project</h2></div></div>
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
                      </table>
                    </section>`
                  : ""
              }
            </div>`
          : `<p class="hint pad">Scan to list the work this Mac already completed in Claude Code and Codex.</p>`
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
    <div class="stage">
      <div class="stage-intro">
        <p class="kicker">List prices · August 2026</p>
        <p class="hint">Short-context API rates per 1M tokens. Edit a number to override for your workspace. Time factor is calendar days vs the workflow’s AI baseline (1.00 = baseline).</p>
      </div>
      <div class="models-grid">
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
      <section class="cell span-12">
        <p class="kicker">Token estimate knobs</p>
        <div class="pair" style="max-width:520px">
          ${est("codingInputPerHour", "Code in / AI-hour")}
          ${est("codingOutputPerHour", "Code out / AI-hour")}
        </div>
        <div class="pair" style="max-width:520px">
          ${est("designInputPerHour", "Design in / AI-hour")}
          ${est("designOutputPerHour", "Design out / AI-hour")}
        </div>
      </section>
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
      <div class="toolbar">
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
        <circle cx="140" cy="140" r="126" fill="#f7f8fa" stroke="#eceef2" />
        <circle cx="140" cy="140" r="92" fill="none" stroke="#eceef2" />
        <circle cx="140" cy="140" r="54" fill="none" stroke="#eceef2" />
        <line x1="140" y1="22" x2="140" y2="258" stroke="#eceef2" />
        <line x1="22" y1="140" x2="258" y2="140" stroke="#eceef2" />
        <text x="140" y="16" text-anchor="middle" fill="#8b9099" font-size="9" font-family="Inter, sans-serif">FASTER</text>
        <text x="268" y="144" text-anchor="end" fill="#8b9099" font-size="9" font-family="Inter, sans-serif">CHEAPER</text>
        ${pts
          .map((p) => {
            const win = p.id === comparison.winner.id;
            const fill = modelColor(p.modelId);
            return `<circle cx="${p.x}" cy="${p.y}" r="${win ? 7 : 5}" fill="${fill}" stroke="#fff" stroke-width="${win ? 2 : 1}">
              <title>${esc(p.label)} · ${p.cfoScore} ${p.grade}</title>
            </circle>`;
          })
          .join("")}
      </svg>
      <div class="legend">
        ${pts
          .map((p) => {
            const fill = modelColor(p.modelId);
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
    <td>${base ? "—" : `${lane.cfoScore} ${gradePill(lane.grade)}`}</td>
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

function kpi(label: string, value: string, sub: string, glyph: string, score: number): string {
  return `<section class="cell span-3 kpi">
    <div class="kpi-top">
      <div>
        <h2>${esc(label)}</h2>
        ${sub ? `<p>${esc(sub)}</p>` : ""}
      </div>
      <div class="kpi-icon">${icon(glyph)}</div>
    </div>
    <div class="kpi-chart">
      ${gaugeSvg(score)}
      <div class="kpi-value">${value}</div>
    </div>
  </section>`;
}

function gaugeSvg(score: number): string {
  const t = clamp(score, 10, 82) / 100;
  const start = Math.PI * 1.08;
  const end = Math.PI * -0.08;
  const a = start + (end - start) * t;
  const cx = 100;
  const cy = 96;
  const r = 72;
  const x = cx + r * Math.cos(a);
  const y = cy - r * Math.sin(a);
  const x2 = cx + (r - 11) * Math.cos(a);
  const y2 = cy - (r - 11) * Math.sin(a);
  return `<svg viewBox="0 0 200 118" aria-hidden="true">
    <path d="M 24 98 A 76 76 0 0 1 176 98" fill="none" stroke="#e4e6ea" stroke-width="1.4" stroke-dasharray="1.2 5.5" stroke-linecap="round"/>
    <line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#111113" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#111113"/>
  </svg>`;
}

function scoreBars(winner: ReturnType<typeof compareWorkflow>["winner"]): string {
  const items = [
    { label: "Cost", value: winner.costScore },
    { label: "Speed", value: winner.speedScore },
    { label: "Quality", value: winner.qualityScore },
    { label: "CFO", value: winner.cfoScore },
  ];
  const best = Math.max(...items.map((i) => i.value));
  return `<div class="bars">
    ${items
      .map((i) => {
        const h = clamp(i.value, 8, 100);
        const win = i.value === best;
        return `<div class="bar${win ? " win" : ""}">
          <div class="bar-track">
            <div class="bar-fill" style="height:${h}%"></div>
            <div class="bar-cap" style="bottom:${h}%"></div>
            ${win ? `<span class="bar-tag" style="bottom:${h}%">${i.value}</span>` : ""}
          </div>
          <span>${i.label}</span>
        </div>`;
      })
      .join("")}
  </div>`;
}

function gradePill(grade: string): string {
  const cls = grade === "A" ? "pill-a" : grade === "B" ? "pill-b" : grade === "F" ? "pill-f" : "pill-c";
  return `<span class="stamp pill ${cls}">${esc(grade)}</span>`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  return (name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "AI").toUpperCase();
}

function icon(name: string): string {
  const common = `xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"`;
  const paths: Record<string, string> = {
    grid: `<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/>`,
    bars: `<path d="M4 19V10"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19V8"/>`,
    box: `<path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z"/><path d="M3 8.5 12 14l9-5.5"/><path d="M12 14v7"/>`,
    file: `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/>`,
    search: `<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>`,
    download: `<path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 19h14"/>`,
    upload: `<path d="M12 20V10"/><path d="m8 14 4-4 4 4"/><path d="M5 5h14"/>`,
    logout: `<path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2"/><path d="M4 12h11"/><path d="m12 8 4 4-4 4"/>`,
    bag: `<path d="M6.5 8h11l.8 11.2A2 2 0 0 1 16.3 21H7.7a2 2 0 0 1-2-1.8L6.5 8Z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>`,
    clock: `<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.5"/>`,
    trend: `<path d="M4 17 10 11l3 3 7-8"/><path d="M15 6h5v5"/>`,
    refresh: `<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 5v5h-5"/>`,
  };
  return `<svg ${common}>${paths[name] ?? paths.grid}</svg>`;
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
