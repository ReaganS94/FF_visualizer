// Browser tests for the site in web/. Playwright builds the site the way the publishing workflow does,
// serves the result (dist/) and runs every *.spec.js file in tests/browser/ in Chromium.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  timeout: 5 * 60 * 1000, // the full tour of every tab and year takes a few minutes
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:8870",
    timezoneId: "Europe/Berlin",
    locale: "de-DE",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run build && npx vite preview --host 127.0.0.1 --port 8870 --strictPort",
    url: "http://127.0.0.1:8870/index.html",
    reuseExistingServer: !process.env.CI,
  },
});
