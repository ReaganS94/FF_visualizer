// The Übersicht tab: four numbers (alarms, average per week, share at night, the latest alarm) and a column per
// month. The website's list is answered without its last ten days, and an entry by hand on the last of them, so
// the latest alarm is always a "vorläufig" one after the website's newest. The list also leaves out January 2025:
// a month without alarms, and a year whose first alarm comes weeks after it begins (the real years all have
// alarms on their first and last day).
import { readFileSync } from "node:fs";
import { test, expect, json, openSite } from "./fixtures.js";

const DATA = JSON.parse(readFileSync(new URL("../../web/public/data/alarms.json", import.meta.url), "utf8"));
const HAND = { time: "12:00", category: "Einsatz", keyword: "th1", event: "Testeintrag von Hand", street: "Teststraße",
  district: "Linden-Mitte", remarks: "" };
const newest = (rows) => rows.filter((r) => r.category === "Einsatz").reduce((m, r) => (r.date > m ? r.date : m), "");
const fmt = (iso) => iso.split("-").reverse().join(".");
const LAST = newest(DATA.rows);
const ROWS = DATA.rows.filter((r) => r.date <= new Date(Date.parse(LAST) - 10 * 864e5).toISOString().slice(0, 10) && !r.date.startsWith("2025-01"));
const LISTED = newest(ROWS);

// the alarm counts in the tooltips of a chart's columns ("Jan 2024: <b>21 Einsätze</b>"), in page order
const counts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => Number(e.dataset.tip.match(/<b>([\d.]+) /)[1].replace(".", ""))));
const sum = (a) => a.reduce((s, v) => s + v, 0);
const tile = (page, label) => page.locator("#tiles .tile").filter({ has: page.locator(".l", { hasText: label }) });

test.beforeEach(async ({ page }) => {
  await page.route("**/data/alarms.json", (r) => r.fulfill(json({ ...DATA, rows: ROWS })));
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: [{ ...HAND, date: LAST }] })));
  await openSite(page);
});

test("counts the alarms, the weekly average up to the website's newest day, the night share and the latest alarm", async ({ page }) => {
  // a column for every month from the first alarm to the latest, adding up to the alarms
  const months = await counts(page, "#c-months .hit");
  // (from the oldest alarm that isn't a standby, "vs", which only counts with "Wachbesetzungen mitzählen")
  const first = ROWS.filter((r) => r.category === "Einsatz" && r.keyword.split("/")[0].trim().toLowerCase() !== "vs")
    .reduce((m, r) => (r.date < m ? r.date : m), LAST);
  expect(months).toHaveLength((Number(LAST.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(LAST.slice(5, 7)) - Number(first.slice(5, 7)) + 1);
  await expect(tile(page, "Einsätze").locator(".v")).toHaveText(String(sum(months)));
  await expect(page.locator('#c-months .hit[data-tip^="Jan 2025:"]')).toHaveAttribute("data-tip", "Jan 2025: <b>0 Einsätze</b>");
  // the latest alarm is the hand entry, so the weekly average stops at the website's newest day
  await expect(tile(page, "Letzter Einsatz").locator(".v")).toHaveText(fmt(LAST));
  await expect(tile(page, "Letzter Einsatz").locator(".d")).toHaveText("Testeintrag von Hand vorläufig");
  await expect(tile(page, "Ø pro Woche").locator(".d")).toHaveText(`bis ${fmt(LISTED)}`);
  await expect(tile(page, "Ø pro Woche").locator(".v")).toHaveText(/^\d+,\d$/);
  // a whole past year: its alarms over all its 365 days, though the first of them came in February
  await page.selectOption("#f-year", "2025");
  const year = Number(await tile(page, "Einsätze").locator(".v").textContent());
  expect(year).toBe(sum(await counts(page, "#c-months .hit")));
  await expect(tile(page, "Ø pro Woche").locator(".v")).toHaveText((year / (365 / 7)).toFixed(1).replace(".", ","));
  await expect(tile(page, "Ø pro Woche").locator(".d")).toHaveText("über den gewählten Zeitraum");
  // the night share is the Tageszeit's alarms from 22 to 6 Uhr, of all its alarms
  const night = (await tile(page, "Nachts").locator(".v").textContent()).match(/^(\d+) %$/)[1];
  await page.click("nav button[data-view=hours]");
  const hours = await counts(page, "#c-hours .hit");
  expect(Number(night)).toBe(Math.round((100 * sum([...hours.slice(0, 6), ...hours.slice(22)])) / sum(hours)));
  expect(page.errors).toEqual([]);
});

test("names the years under the month columns on a phone, and the months on a wider screen", async ({ page }) => {
  const ticks = () => page.locator("#c-months svg > text[text-anchor=middle]").allTextContents();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(ticks).toContain("Apr"); // drawn again 150 ms after the window changes
  const wide = await ticks();
  expect(wide[0]).toMatch(/^\D{3} \d{4}$/); // the first month, with its year
  expect(wide.filter((t) => /^Jan \d{4}$/.test(t)).length).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(ticks).not.toContain("Apr");
  const narrow = await ticks();
  expect(narrow.every((t) => /^\d{4}$/.test(t))).toBe(true);
  expect(narrow.length).toBe(wide.filter((t) => /^Jan \d{4}$/.test(t)).length);
  expect(page.errors).toEqual([]);
});
