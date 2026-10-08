// Switching tabs on a computer: tabs that scroll show a scrollbar and short ones don't, and the page must not
// jump sideways between them. Chromium hides scrollbars in tests unless told otherwise, so this file shows them.
import { test, expect, openSite } from "./fixtures.js";

const VIEWS = ["overview", "dots", "calendar", "spiral", "hours", "keywords", "districts", "addresses", "map",
  "radius", "weather", "myths", "quiz", "list", "year", "chance"];

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] }, viewport: { width: 1920, height: 1080 } });

// Where the tab bar starts, and whether the page scrolls.
const measure = (page) => page.evaluate(() => ({
  x: document.querySelector("nav").getBoundingClientRect().left,
  scrolls: document.documentElement.scrollHeight > innerHeight,
}));

test("the page stays put when switching between short and long tabs, and when the year story opens", async ({ page }) => {
  await openSite(page);
  const tabs = [];
  for (const v of VIEWS) {
    await page.click(`nav button[data-view=${v}]`);
    tabs.push({ v, ...(await measure(page)) });
  }
  // both kinds of tab, or the test proves nothing
  expect(tabs.filter((t) => t.scrolls).length).toBeGreaterThan(0);
  expect(tabs.filter((t) => !t.scrolls).length).toBeGreaterThan(0);
  const x = tabs[0].x;
  expect(tabs.filter((t) => t.x !== x).map((t) => `${t.v} at x=${t.x}`)).toEqual([]);

  // the story stops the page scrolling while it's open
  await page.click("nav button[data-view=year]");
  await page.click("#y-story");
  await expect(page.locator("#story")).toBeVisible();
  expect((await measure(page)).x).toBe(x);
  await page.keyboard.press("Escape");
  await expect(page.locator("#story")).toBeHidden();
  expect((await measure(page)).x).toBe(x);
  expect(page.errors).toEqual([]);
});
