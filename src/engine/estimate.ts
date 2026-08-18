import type { EstimateAssumptions, Workflow } from "./types";

export const DEFAULT_ESTIMATE: EstimateAssumptions = {
  codingInputPerHour: 120_000,
  codingOutputPerHour: 25_000,
  designInputPerHour: 30_000,
  designOutputPerHour: 10_000,
  tokensPerLocInput: 40,
  tokensPerLocOutput: 12,
};

/**
 * Token estimate from the delivery itself.
 * Distilled from semcod/costs (diff-size heuristics) and ComputeCFO (~4 chars/token).
 * Agentic coding burns far more input than a one-shot review, so hours dominate.
 */
export function estimateTokens(
  workflow: Pick<
    Workflow,
    | "designHoursWithAi"
    | "codeHoursWithAi"
    | "loc"
    | "cacheHitRate"
    | "tokenMode"
    | "inputTokens"
    | "outputTokens"
    | "cachedInputTokens"
  >,
  assumptions: EstimateAssumptions = DEFAULT_ESTIMATE,
): { inputTokens: number; outputTokens: number; cachedInputTokens: number } {
  if (workflow.tokenMode === "manual") {
    return {
      inputTokens: Math.max(0, workflow.inputTokens),
      outputTokens: Math.max(0, workflow.outputTokens),
      cachedInputTokens: Math.max(0, workflow.cachedInputTokens),
    };
  }

  const fromHoursInput =
    workflow.designHoursWithAi * assumptions.designInputPerHour +
    workflow.codeHoursWithAi * assumptions.codingInputPerHour;
  const fromHoursOutput =
    workflow.designHoursWithAi * assumptions.designOutputPerHour +
    workflow.codeHoursWithAi * assumptions.codingOutputPerHour;

  const fromLocInput = workflow.loc * assumptions.tokensPerLocInput;
  const fromLocOutput = workflow.loc * assumptions.tokensPerLocOutput;

  const inputTokens = Math.round(Math.max(fromHoursInput, fromLocInput));
  const outputTokens = Math.round(Math.max(fromHoursOutput, fromLocOutput));
  const hit = clamp01(workflow.cacheHitRate);
  const cachedInputTokens = Math.round(inputTokens * hit);

  return { inputTokens, outputTokens, cachedInputTokens };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => normalizeHeader(h));
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

export function importUsageFromCsv(text: string): {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  invoiceUsd: number;
  rows: number;
  note: string;
} {
  const rows = parseCsv(text);
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let invoiceUsd = 0;

  for (const row of rows) {
    inputTokens += num(row, [
      "input_tokens",
      "tokens_input",
      "inputtokens",
      "prompt_tokens",
    ]);
    outputTokens += num(row, [
      "output_tokens",
      "tokens_output",
      "outputtokens",
      "completion_tokens",
    ]);
    cachedInputTokens += num(row, [
      "cached_input_tokens",
      "cache_read_input_tokens",
      "cachedinputtokens",
    ]);
    invoiceUsd += num(row, ["cost", "cost_usd", "amount", "spend", "invoice"]);
  }

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    invoiceUsd,
    rows: rows.length,
    note: `Imported ${rows.length} rows`,
  };
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function num(row: Record<string, string>, keys: string[]): number {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") {
      const n = Number(String(row[key]).replace(/[$,]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}
