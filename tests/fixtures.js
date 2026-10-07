// Shared setup for every test: nothing leaves the machine. Leaflet comes from node_modules instead of
// unpkg, map tiles are blank, the warning services answer "no warnings", and every other outside address
// (GitHub, for one) fails, unless a test routes it itself (a route added later wins). Uncaught errors on
// the page are collected in page.errors.
import { test as base, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NODE_MODULES = fileURLToPath(new URL("../node_modules/", import.meta.url));

// A blank 1×1 PNG for map tiles.
const TILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

// A JSON answer that any website may load, like Bright Sky's.
export const json = (body, status = 200) => ({
  status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body),
});

export const test = base.extend({
  page: async ({ page }, use) => {
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    await page.route((url) => url.hostname !== "127.0.0.1", (r) => r.abort());
    // https://unpkg.com/leaflet@1.9.4/dist/leaflet.js -> node_modules/leaflet/dist/leaflet.js
    // (the versions in package.json match the ones the site asks for)
    await page.route("https://unpkg.com/**", (r) => {
      const [, pkg, ...rest] = new URL(r.request().url()).pathname.split("/");
      r.fulfill({ path: path.join(NODE_MODULES, pkg.slice(0, pkg.lastIndexOf("@")), ...rest) });
    });
    await page.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ contentType: "image/png", body: TILE }));
    await page.route("https://api.brightsky.dev/**", (r) => r.fulfill(json({ alerts: [], location: {} })));
    await page.route("https://warnung.bund.de/**", (r) => r.fulfill(json([])));
    await use(page);
  },
});
export { expect };

// Opens the site and waits until the alarms are loaded and the year filter is filled.
export async function openSite(page) {
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelector("#f-year option + option"));
}

// Device settings for test.use(): Playwright's phone presets without their browser choice, which
// can't change inside a file (the tests run in Chromium with the phone's size, touch and user agent).
export function device(preset) {
  const { defaultBrowserType, ...rest } = preset;
  return rest;
}
