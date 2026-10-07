// Browser tests for the site in docs/. `npm test` starts a small web server for docs/ (the same one as
// "Run locally" in the README) and runs every *.spec.js file in tests/ in Chromium.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
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
    command: "python3 -m http.server 8870 --bind 127.0.0.1 --directory docs",
    url: "http://127.0.0.1:8870/index.html",
    reuseExistingServer: !process.env.CI,
    stderr: "ignore", // the server's line for every file it sends
  },
});
