import { tokensForLane } from "./calc";
import type { AppState, Comparison, Workflow } from "./types";

export function reportMarkdown(
  workflow: Workflow,
  comparison: Comparison,
  state: AppState,
): string {
  const { contractor, lanes, winner, briefing } = comparison;
  const tokens = tokensForLane(workflow, state.estimate);
  const today = new Date().toLocaleDateString("en-CA");

  const rows = [
    laneRow("Contractors", contractor, true),
    ...lanes.map((l) => laneRow(l.label, l, false, l.id === winner.id)),
  ].join("\n");

  return `# AI CFO report — ${workflow.name}

Generated ${today}

${briefing}

## Recommendation

**${winner.label}** · CFO score ${winner.cfoScore} (${winner.grade}) · $${usd(winner.totalCost)} · ${winner.calendarDays} days

## Comparison

| Path | Total | Tokens / invoice | Human | Seats | Days | Saved | ROI | Score |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## Contractor baseline

- Design: ${workflow.designHoursContractor}h × $${state.rates.designHourly}/h = $${usd(contractor.breakdown.designCost)}
- Code: ${workflow.codeHoursContractor}h × $${state.rates.codeHourly}/h = $${usd(contractor.breakdown.codeCost)}
- Calendar: ${contractor.calendarDays} days
- Opportunity of delay: $${state.rates.opportunityPerDay}/day

## AI path assumptions

- Design with AI: ${workflow.designHoursWithAi}h
- Code with AI: ${workflow.codeHoursWithAi}h
- Review: ${workflow.reviewHours}h
- Rework: ${(workflow.reworkRate * 100).toFixed(0)}% (scaled by model capability)
- Calendar with AI (baseline): ${workflow.calendarDaysWithAi} days
- Billing: ${workflow.billingMode}
- Input mode: ${workflow.inputMode}
- Tokens used in this run: ${fmtInt(tokens.inputTokens)} in / ${fmtInt(tokens.outputTokens)} out / ${fmtInt(tokens.cachedInputTokens)} cached
- Cache hit rate (forecast): ${(workflow.cacheHitRate * 100).toFixed(0)}%
- Seats: Claude $${state.seats.claudeMonthly}/mo · Codex $${state.seats.codexMonthly}/mo · allocated across ${state.seats.workflowsPerMonth} deliveries

${workflow.notes ? `## Notes\n\n${workflow.notes}\n` : ""}
## Method

Cash cost for an AI path is model tokens (or an imported invoice), plus remaining human hours at your contractor rates, plus a slice of monthly seats when billing includes subscriptions. Time value is days saved × opportunity per day. The CFO score is 40% cost, 35% speed, 25% quality after rework.

Prices are August 2026 short-context list rates and are editable in the Models screen.
`;
}

export function reportHtml(
  workflow: Workflow,
  comparison: Comparison,
  state: AppState,
): string {
  const tokens = tokensForLane(workflow, state.estimate);
  const today = new Date().toLocaleDateString("en-CA");
  const table = [comparison.contractor, ...comparison.lanes]
    .map((l) => {
      const win = l.id === comparison.winner.id;
      return `<tr class="${win ? "win" : ""}">
        <td>${esc(l.label)}${win ? " ★" : ""}</td>
        <td>$${usd(l.totalCost)}</td>
        <td>$${usd(l.tokenCost)}</td>
        <td>$${usd(l.humanCost)}</td>
        <td>$${usd(l.seatCost)}</td>
        <td>${l.calendarDays}</td>
        <td>$${usd(l.savingsVsContractor)}</td>
        <td>${l.kind === "contractor" ? "—" : l.roi.toFixed(1) + "×"}</td>
        <td>${l.kind === "contractor" ? "—" : `${l.cfoScore} ${l.grade}`}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>AI CFO — ${esc(workflow.name)}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: Inter, "Segoe UI", system-ui, sans-serif; margin: 48px auto; max-width: 820px; color: #111113; }
    h1 { font-size: 24px; margin: 0 0 8px; letter-spacing: -0.03em; }
    h2 { font-size: 12px; font-weight: 500; color: #8b9099; margin: 28px 0 10px; }
    p { line-height: 1.55; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #eceef2; padding: 10px 8px; text-align: right; }
    th:first-child, td:first-child { text-align: left; }
    tr.win td { font-weight: 600; background: #f4f5f7; }
    ul { padding-left: 18px; }
    @media print { body { margin: 16mm; } }
  </style>
</head>
<body>
  <h1>AI CFO report — ${esc(workflow.name)}</h1>
  <p>Generated ${today}</p>
  <p>${esc(comparison.briefing)}</p>
  <h2>Recommendation</h2>
  <p><strong>${esc(comparison.winner.label)}</strong> · CFO score ${comparison.winner.cfoScore} (${comparison.winner.grade}) · $${usd(comparison.winner.totalCost)} · ${comparison.winner.calendarDays} days</p>
  <h2>Comparison</h2>
  <table>
    <thead>
      <tr>
        <th>Path</th><th>Total</th><th>Model</th><th>Human</th>
        <th>Seats</th><th>Days</th><th>Saved</th><th>ROI</th><th>Score</th>
      </tr>
    </thead>
    <tbody>${table}</tbody>
  </table>
  <h2>Contractor baseline</h2>
  <ul>
    <li>Design: ${workflow.designHoursContractor}h × $${state.rates.designHourly}/h = $${usd(comparison.contractor.breakdown.designCost)}</li>
    <li>Code: ${workflow.codeHoursContractor}h × $${state.rates.codeHourly}/h = $${usd(comparison.contractor.breakdown.codeCost)}</li>
    <li>Calendar: ${comparison.contractor.calendarDays} days</li>
    <li>Opportunity of delay: $${state.rates.opportunityPerDay}/day</li>
  </ul>
  <h2>AI path assumptions</h2>
  <ul>
    <li>Design with AI: ${workflow.designHoursWithAi}h</li>
    <li>Code with AI: ${workflow.codeHoursWithAi}h</li>
    <li>Review: ${workflow.reviewHours}h</li>
    <li>Rework: ${(workflow.reworkRate * 100).toFixed(0)}% (scaled by model capability)</li>
    <li>Calendar with AI (baseline): ${workflow.calendarDaysWithAi} days</li>
    <li>Billing: ${workflow.billingMode}</li>
    <li>Input mode: ${workflow.inputMode}</li>
    <li>Tokens: ${fmtInt(tokens.inputTokens)} in / ${fmtInt(tokens.outputTokens)} out / ${fmtInt(tokens.cachedInputTokens)} cached</li>
    <li>Seats: Claude $${state.seats.claudeMonthly}/mo · Codex $${state.seats.codexMonthly}/mo · ${state.seats.workflowsPerMonth} deliveries</li>
  </ul>
  ${workflow.notes ? `<h2>Notes</h2><p>${esc(workflow.notes)}</p>` : ""}
  <h2>Method</h2>
  <p>Cash cost for an AI path is model tokens (or an imported invoice), plus remaining human hours at your contractor rates, plus a slice of monthly seats when billing includes subscriptions. Time value is days saved × opportunity per day. The CFO score is 40% cost, 35% speed, 25% quality after rework.</p>
</body>
</html>`;
}

function laneRow(
  label: string,
  lane: Comparison["contractor"],
  isContractor: boolean,
  win = false,
): string {
  const name = `${win ? "★ " : ""}${label}`;
  return `| ${name} | $${usd(lane.totalCost)} | $${usd(lane.tokenCost)} | $${usd(lane.humanCost)} | $${usd(lane.seatCost)} | ${lane.calendarDays} | $${usd(lane.savingsVsContractor)} | ${isContractor ? "—" : lane.roi.toFixed(1) + "×"} | ${isContractor ? "—" : `${lane.cfoScore} ${lane.grade}`} |`;
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
