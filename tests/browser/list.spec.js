// The Liste tab: every alarm of the selection, newest first, with a search box. The hand entries are
// answered by the test, so a "vorläufig" one is always there.
import { test, expect, json, openSite } from "./fixtures.js";

const HAND = { date: "2030-01-01", time: "12:00", category: "Einsatz", keyword: "th1", event: "Testeintrag von Hand",
  street: "Teststraße", district: "Linden-Mitte", remarks: "" };
const rows = (page) => page.locator("#t-list tbody tr");
const counted = async (page) => Number((await page.textContent("#list-count")).match(/^[\d.]+/)[0].replace(/\./g, ""));

test.beforeEach(async ({ page }) => {
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: [HAND] })));
  await openSite(page);
  await page.click("nav button[data-view=list]");
});

test("lists every alarm of the selection and marks hand entries as vorläufig", async ({ page }) => {
  const all = await rows(page).count();
  expect(all).toBeGreaterThan(100);
  expect(await counted(page)).toBe(all);
  await expect(rows(page).first()).toContainText("01.01.2030vorläufig");
  await expect(page.locator("#list-count")).toContainText("Einträge mit „vorläufig“ stehen noch nicht auf der Website");
  await page.locator("#t-list .tag").hover();
  await expect(page.locator("#tip")).toHaveText(/^Noch nicht auf der Website der Feuerwehr\./);
  expect(page.errors).toEqual([]);
});

test("searches the list, and keeps the search when the filters or the tab change", async ({ page }) => {
  const all = await rows(page).count();
  await page.fill("#q", "  TESTEINTRAG ");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#list-count")).toHaveText(/^1 Einsatz\./);
  await page.fill("#q", "nichts davon");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator("#list-count")).toHaveText("0 Einsätze.");
  await page.fill("#q", "th");
  const th = await rows(page).count();
  expect(th).toBeGreaterThan(1);
  expect(th).toBeLessThan(all);
  expect(await counted(page)).toBe(th);
  // a year narrows the search further
  await page.selectOption("#f-year", "2025");
  const dates = await page.locator("#t-list tbody tr td:first-child").allTextContents();
  expect(dates.length).toBeGreaterThan(0);
  expect(dates.length).toBeLessThan(th);
  expect(dates.every((d) => d.endsWith(".2025"))).toBe(true);
  // another tab and back: the search is still there
  await page.click("nav button[data-view=overview]");
  await page.click("nav button[data-view=list]");
  await expect(page.locator("#q")).toHaveValue("th");
  await expect(rows(page)).toHaveCount(dates.length);
  await page.selectOption("#f-year", "");
  await page.fill("#q", "");
  await expect(rows(page)).toHaveCount(all);
  expect(page.errors).toEqual([]);
});
