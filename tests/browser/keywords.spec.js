// The Stichworte tab: the alarms by type and by keyword as ranked bars, with a tooltip on each bar. On a narrow
// phone the long keyword names go above their bars, and back beside them when the window gets wider.
import { test, expect, openSite } from "./fixtures.js";

// the numbers at the ends of a chart's bars, top to bottom
const values = async (page, chart) => (await page.locator(`#${chart} svg > text:not(.lbl)`).allTextContents()).map(Number);
const sum = (a) => a.reduce((s, v) => s + v, 0);

test("ranks the alarm types and the keywords, with a tooltip on each bar, and counts the chosen year", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=keywords]");
  for (const chart of ["c-groups", "c-keywords"]) {
    const n = await values(page, chart);
    expect(n.length).toBeGreaterThan(3);
    expect(n).toEqual([...n].sort((a, b) => b - a));
  }
  await page.locator("#c-keywords .hit").first().hover();
  await expect(page.locator("#tip")).toBeVisible();
  await expect(page.locator("#tip b")).toHaveText(/^\S+$/); // the keyword's code
  await expect(page.locator("#tip")).toContainText("Einsätze");
  const all = sum(await values(page, "c-groups"));
  await page.selectOption("#f-year", "2025");
  const year = sum(await values(page, "c-groups"));
  expect(year).toBeGreaterThan(0);
  expect(year).toBeLessThan(all);
  expect(page.errors).toEqual([]);
});

test("puts long keyword names above their bars on a narrow phone, and beside them when the window gets wider", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openSite(page);
  await page.click("nav button[data-view=keywords]");
  await expect(page.locator('#c-keywords text.lbl[x="0"]').first()).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#c-keywords text.lbl[x="0"]')).toHaveCount(0);
  await expect(page.locator('#c-keywords text.lbl[text-anchor="end"]').first()).toBeVisible();
  expect(page.errors).toEqual([]);
});
