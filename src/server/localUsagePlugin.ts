import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LocalScanResult } from "../engine/localUsage";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/scan_usage.py",
);

export async function runLocalScan(days: number, extra: string[] = []): Promise<LocalScanResult> {
  const { stdout } = await execFileAsync(
    "python3",
    [scriptPath, "--days", String(days), ...extra],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as LocalScanResult;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(json);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname !== "/api/local-usage") return;
  if (req.method !== "GET") {
    send(res, 405, { error: "GET only" });
    return;
  }
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") || 30)));
  try {
    send(res, 200, await runLocalScan(days));
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function localUsagePlugin(): Plugin {
  return {
    name: "local-usage",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url !== "/api/local-usage") return next();
        void handle(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url !== "/api/local-usage") return next();
        void handle(req, res);
      });
    },
  };
}
