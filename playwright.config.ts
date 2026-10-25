// End-to-end tests against a dev server (`npm run test:e2e`). The sign-in is the test-only shortcut (backend/auth/e2e.ts), which
// answers only with FREUNDEBUCH_E2E=1 outside a production build, so these tests run on `next dev`, never on the built app.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;
const DATA_DIR = "test-results/e2e-data";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "phone", testMatch: "phone.spec.ts", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } }],
  webServer: {
    // A fresh database and a fresh dev build on every start: a dev build left from before source edits makes the first pages
    // reload themselves (Fast Refresh) mid-test.
    command: `rm -rf ${DATA_DIR} .next/dev && next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATA_DIR, FREUNDEBUCH_E2E: "1", FREUNDEBUCH_SECRET: "e2e-secret-".padEnd(40, "x"), FREUNDEBUCH_LOG_LEVEL: "warn", TZ: "Europe/Berlin" },
  },
});
