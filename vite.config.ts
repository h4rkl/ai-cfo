import { defineConfig } from "vitest/config";
import { localUsagePlugin } from "./src/server/localUsagePlugin";
import { modelPricesPlugin } from "./src/server/modelPricesPlugin";

export default defineConfig({
  base: "./",
  plugins: [localUsagePlugin(), modelPricesPlugin()],
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
