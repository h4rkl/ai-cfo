import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runLocalScan } from "../src/server/localUsagePlugin";
import { summarizeUsage, workflowFromSessions } from "../src/engine/localUsage";

const root = path.dirname(fileURLToPath(import.meta.url));
const claudeRoot = path.join(root, "fixtures/claude/projects");
const codexRoot = path.join(root, "fixtures/codex/sessions");

describe("local session scan", () => {
  it("dedupes Claude streaming chunks and titles the work", async () => {
    const scan = await runLocalScan(30, [
      "--claude-root",
      claudeRoot,
      "--codex-root",
      path.join(root, "fixtures/empty"),
    ]);
    expect(scan.sessions).toHaveLength(1);
    const session = scan.sessions[0];
    expect(session.provider).toBe("claude");
    expect(session.title).toBe("Figma landing page");
    expect(session.project).toBe("demo");
    expect(session.turns).toBe(2);
    expect(session.outputTokens).toBe(600);
    expect(session.cachedInputTokens).toBe(12000);
    expect(session.cacheWriteTokens).toBe(500);
  });

  it("sums Codex per-turn last_token_usage instead of the running total", async () => {
    const scan = await runLocalScan(30, [
      "--claude-root",
      path.join(root, "fixtures/empty"),
      "--codex-root",
      codexRoot,
    ]);
    expect(scan.sessions).toHaveLength(1);
    const session = scan.sessions[0];
    expect(session.provider).toBe("codex");
    expect(session.models).toContain("gpt-5.6-terra");
    expect(session.inputTokens).toBe(14000);
    expect(session.outputTokens).toBe(1000);
    expect(session.cachedInputTokens).toBe(9000);
    expect(session.turns).toBe(2);
    expect(session.prompt).toContain("auth");
  });

  it("turns scanned work into a comparison workflow", async () => {
    const scan = await runLocalScan(30, [
      "--claude-root",
      claudeRoot,
      "--codex-root",
      codexRoot,
    ]);
    const summary = summarizeUsage(scan);
    expect(summary.totals.sessions).toBe(2);
    expect(summary.projects[0].name).toBe("demo");
    const wf = workflowFromSessions(summary.sessions);
    expect(wf.inputMode).toBe("actuals");
    expect(wf.actuals.source).toBe("local");
    expect(wf.actuals.outputTokens).toBe(1600);
    expect(wf.actuals.invoiceUsd).toBeGreaterThan(0);
  });
});
