import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MARKET_MODEL_IDS, MARKET_URL, quotesFromOpenRouter } from "../engine/marketRates";

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(json);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    send(res, 405, { error: "GET only" });
    return;
  }
  try {
    const response = await fetch(MARKET_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      send(res, 502, { error: `OpenRouter ${response.status}` });
      return;
    }
    const payload: unknown = await response.json();
    send(res, 200, quotesFromOpenRouter(payload, Object.keys(MARKET_MODEL_IDS)));
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function modelPricesPlugin(): Plugin {
  return {
    name: "model-prices",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url !== "/api/model-prices") return next();
        void handle(req, res);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url !== "/api/model-prices") return next();
        void handle(req, res);
      });
    },
  };
}
