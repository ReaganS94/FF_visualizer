// The Tageszeit tab: the alarms by weekday and hour as a shaded grid with a colour key, and by hour as bars.
import { test, expect, openSite } from "./fixtures.js";

// the alarm counts in the tooltips of a chart's cells or bars ("Montag, 0–1 Uhr: <b>9 Einsätze</b>"), in page order
const counts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => Number(e.dataset.tip.match(/<b>([\d.]+) /)[1].replace(".", ""))));
const sum = (a) => a.reduce((s, v) => s + v, 0);

test("shades the weekday × hour grid by alarms, the busiest hour darkest, and counts the same alarms by hour", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=hours]");
  const cells = await counts(page, "#c-heat .cell");
  expect(cells).toHaveLength(7 * 24);
  const max = Math.max(...cells);
  await expect(page.locator("#c-heat .legend")).toContainText(`${max} (Maximum)`);
  // the busiest weekday and hour has the colour key's darkest colour
  const fill = await page.locator("#c-heat .cell").nth(cells.indexOf(max)).evaluate((e) => getComputedStyle(e).fill);
  expect(fill).toBe(await page.locator("#c-heat .legend i").last().evaluate((e) => getComputedStyle(e).backgroundColor));
  const hours = await counts(page, "#c-hours .hit");
  expect(hours).toHaveLength(24);
  expect(sum(hours)).toBe(sum(cells));
  await page.selectOption("#f-year", "2025");
  const year = sum(await counts(page, "#c-heat .cell"));
  expect(year).toBeGreaterThan(0);
  expect(year).toBeLessThan(sum(cells));
  expect(sum(await counts(page, "#c-hours .hit"))).toBe(year);
  expect(page.errors).toEqual([]);
});
