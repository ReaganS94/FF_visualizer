// The Stadtteile tab: the 20 districts with the most alarms as ranked bars, with each district's busiest streets
// in the tooltip on its bar.
import { test, expect, openSite } from "./fixtures.js";

// the numbers at the ends of the bars, top to bottom
const values = async (page) => (await page.locator("#c-districts svg > text:not(.lbl)").allTextContents()).map(Number);
const sum = (a) => a.reduce((s, v) => s + v, 0);

test("ranks the 20 districts with the most alarms, with the busiest streets in each tooltip, and counts the chosen year", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=districts]");
  const all = await values(page);
  expect(all).toHaveLength(20); // more districts have had alarms; only the 20 busiest show
  expect(all).toEqual([...all].sort((a, b) => b - a));
  const name = await page.locator("#c-districts text.lbl").first().textContent();
  await page.locator("#c-districts .hit").first().hover();
  await expect(page.locator("#tip b")).toHaveText(name);
  // the district, its alarms, and its three busiest streets with theirs
  expect(await page.locator("#tip").innerHTML()).toMatch(/^<b>[^<]+<\/b> · [\d.]+ Einsätze(<br>[^<]+ \(\d+\)){3}$/);
  await page.selectOption("#f-year", "2025");
  const year = sum(await values(page));
  expect(year).toBeGreaterThan(0);
  expect(year).toBeLessThan(sum(all));
  expect(page.errors).toEqual([]);
});
