// The Stammadressen tab: streets with three or more alarms and fire alarm systems that went off more than once,
// each row opening to its alarms. The hand entries are answered by the test, so a "vorläufig" one is always there.
import { test, expect, json, openSite } from "./fixtures.js";

const HAND = { date: "2030-01-01", time: "12:00", category: "Einsatz", keyword: "th1", event: "Testeintrag von Hand",
  street: "Limmerstraße", district: "Linden-Nord", remarks: "" };
const rows = (page, list) => page.locator(`#${list} details.addr`);
const street = (page, list, name) => rows(page, list).filter({ has: page.locator("summary b", { hasText: new RegExp(`^${name}$`) }) });

test.beforeEach(async ({ page }) => {
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: [HAND] })));
});

test("lists the busiest streets, each opening to its alarms, and the fire alarm systems", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=addresses]");
  const counts = (await page.locator("#c-addresses .addr-n").allTextContents()).map(Number);
  expect(counts.length).toBeGreaterThan(3);
  expect(counts.length).toBeLessThanOrEqual(25);
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
  expect(Math.min(...counts)).toBeGreaterThanOrEqual(3);
  const first = rows(page, "c-addresses").first();
  await expect(first.locator("table")).toBeHidden();
  await first.locator("summary").click();
  await expect(first.locator("table")).toBeVisible();
  await expect(first.locator("tbody tr")).toHaveCount(counts[0]);
  // the hand entry is the newest alarm of its street, marked as vorläufig
  await expect(street(page, "c-addresses", "Limmerstraße").locator("tbody tr").first()).toContainText("01.01.2030 vorläufig");
  await expect(street(page, "c-addresses", "Limmerstraße").locator(".addr-what")).toContainText("zuletzt 01.01.2030");
  const bma = (await page.locator("#c-bma .addr-n").allTextContents()).map(Number);
  expect(bma.length).toBeGreaterThan(0);
  expect(Math.min(...bma)).toBeGreaterThanOrEqual(2);
  expect(page.errors).toEqual([]);
});

test("keeps an opened row open when the filters or the tab change", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=addresses]");
  await street(page, "c-addresses", "Limmerstraße").locator("summary").click();
  // the street has the most alarms with the hand entry, but is further down in 2025
  await page.selectOption("#f-year", "2025");
  await page.setChecked("#f-standby", true);
  await page.click("nav button[data-view=overview]");
  await page.click("nav button[data-view=addresses]");
  await expect(street(page, "c-addresses", "Limmerstraße")).toHaveAttribute("open", "");
  await expect(page.locator("#c-addresses details[open]")).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("says so when no place has enough alarms", async ({ page }) => {
  // five alarms, each at a street of its own
  await page.route("**/data/alarms.json", async (r) => {
    const data = await (await r.fetch()).json();
    r.fulfill(json({ ...data, rows: data.rows.slice(0, 5).map((row, i) => ({ ...row, street: `Teststraße ${i + 1}` })) }));
  });
  await openSite(page);
  await page.click("nav button[data-view=addresses]");
  await expect(page.locator("#c-addresses")).toHaveText("In der Auswahl gibt es keinen Ort mit drei oder mehr Einsätzen.");
  await expect(page.locator("#c-bma")).toHaveText("In der Auswahl hat keine Brandmeldeanlage mehr als einmal ausgelöst.");
  expect(page.errors).toEqual([]);
});
