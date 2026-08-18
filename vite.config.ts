import { defineConfig } from "vitest/config";
import { localUsagePlugin } from "./src/server/localUsagePlugin";

export default defineConfig({
  base: "./",
  plugins: [localUsagePlugin()],
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
