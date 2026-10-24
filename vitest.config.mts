import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The rest of the suite prints no log lines.
  test: { environment: "node", exclude: ["**/node_modules/**", ".next/**", "packages/**", "e2e/**"], env: { FREUNDEBUCH_LOG_LEVEL: "silent" } },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
});
