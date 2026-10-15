// The visit counter only runs on the public site, and only once a token is set.
import { afterEach, expect, test, vi } from "vitest";
import { ANALYTICS_TOKEN, startAnalytics } from "../../web/src/lib/analytics.js";

afterEach(() => vi.unstubAllGlobals());

function fakeDocument() {
  const added = [];
  vi.stubGlobal("document", { createElement: () => ({ dataset: {} }), head: { append: (el) => added.push(el) } });
  return added;
}

test("adds Cloudflare's script with the token on the public site", () => {
  const added = fakeDocument();
  expect(startAnalytics("reagans94.github.io", "abc123")).toBe(true);
  expect(added).toHaveLength(1);
  expect(added[0].src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
  expect(added[0].type).toBe("module");
  expect(JSON.parse(added[0].dataset.cfBeacon)).toEqual({ token: "abc123" });
});

test("counts nothing elsewhere or without a token", () => {
  const added = fakeDocument();
  expect(startAnalytics("127.0.0.1", "abc123")).toBe(false);
  expect(startAnalytics("ff-linden-admin.ff-statistik.workers.dev", "abc123")).toBe(false);
  expect(startAnalytics("reagans94.github.io", "")).toBe(false);
  expect(added).toHaveLength(0);
});

test("the site's own token is set", () => {
  const added = fakeDocument();
  expect(ANALYTICS_TOKEN).toMatch(/^[0-9a-f]{32}$/);
  expect(startAnalytics("reagans94.github.io")).toBe(true);
  expect(JSON.parse(added[0].dataset.cfBeacon)).toEqual({ token: ANALYTICS_TOKEN });
});
