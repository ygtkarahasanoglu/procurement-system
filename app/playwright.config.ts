import { defineConfig } from "@playwright/test";

// Real-browser E2E test for the UI vertical slice. Assumes the backend
// API (app, :3000) and the frontend dev server (web, :5173) are already
// running against the real `procurement_dev` PostgreSQL database — this
// is NOT started automatically here, since both are already managed
// processes in this environment (see README "How to run locally").
export default defineConfig({
  testDir: "./test-e2e",
  timeout: 30000,
  use: {
    baseURL: process.env.UI_BASE_URL ?? "http://localhost:5173",
    headless: true,
    launchOptions: {
      // This environment pins an older pre-installed Chromium revision
      // than the @playwright/test version installed above expects by
      // default; point at it explicitly rather than downloading a new one.
      executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    },
  },
});
