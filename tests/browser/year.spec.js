// The Jahresrückblick: a year's numbers, its running total next to the other years, its months, alarm types and
// notable alarms. The tab has its own year and "Großlagen mitzählen", kept while other tabs and the filters above
// them change; it opens the story of the chosen year, and prints. The alarms are made up: 2024 with a Großlage,
// 2025 whole, and 2026 running, with a hand entry after the website's newest alarm.
import { devices } from "@playwright/test";
import { test, expect, json, openSite, device } from "./fixtures.js";

const alarm = (date, time, keyword, street, remarks = "") => ({ date, time, category: "Einsatz", keyword, event: "Test", street, district: "Linden-Mitte", remarks });
const ROWS = [
  // 2024: 13 alarms, 10 of them on the Großlage of 10.07.; none notable
  alarm("2024-01-01", "00:30", "b1", "Am Kanal"),
  alarm("2024-03-10", "14:00", "h", "Nahstraße"),
  ...Array.from({ length: 10 }, (_, i) => alarm("2024-07-10", `15:${String(i * 5).padStart(2, "0")}`, "h", "Sturmweg")),
  alarm("2024-11-05", "23:15", "b1", "Mittelweg"),
  // 2025: 7 alarms, two on 01.01.; the b3 is notable
  alarm("2025-01-01", "01:10", "b1", "Am Kanal"),
  alarm("2025-01-01", "02:20", "b1", "Nahstraße"),
  alarm("2025-02-14", "12:00", "hm1", "Lange Straße"),
  alarm("2025-05-05", "09:00", "b1", "Mittelweg"),
  alarm("2025-06-20", "22:30", "h", "Am Kanal"),
  alarm("2025-08-08", "12:00", "b3", "Fernstraße"),
  alarm("2025-12-31", "23:50", "b1", "Nahstraße"),
  // 2026 up to the website's newest alarm on 01.07.: three on 01.01., one with a press report, and a
  // Wachbesetzung, which never counts here
  alarm("2026-01-01", "00:15", "b1", "Am Kanal"),
  alarm("2026-01-01", "00:40", "h", "Nahstraße"),
  alarm("2026-01-01", "03:00", "b1", "Mittelweg"),
  alarm("2026-03-03", "08:00", "hm1", "Lange Straße"),
  alarm("2026-04-04", "12:00", "b1", "Fernstraße", "https://www.presseportal.de/blaulicht/pm/66841/1"),
  alarm("2026-05-01", "10:00", "vs", "Teichstraße"),
  alarm("2026-06-06", "18:00", "h", "Am Kanal"),
  alarm("2026-07-01", "13:00", "b1", "Nahstraße"),
];
const HAND = alarm("2026-07-20", "20:00", "b1", "Mittelweg"); // after the website's newest alarm

// the tiles, each as its label, number and line below
const tiles = (page) => page.$$eval("#y-tiles .tile", (ts) => ts.map((t) => [...t.children].map((c) => c.textContent)));
const tips = (page, sel) => page.$$eval(sel, (hs) => hs.map((h) => h.dataset.tip));
const notable = (page) => page.$$eval("#y-notable tbody tr", (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent)));
// the totals at the ends of the lines, and the chosen year's
const ends = (page) => page.$$eval("#y-race text.end", (ts) => ts.map((t) => t.textContent));
const chosen = (page) => page.$$eval("#y-race text.end.sel", (ts) => ts.map((t) => t.textContent));

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-09T12:00:00+02:00") });
  await page.route("**/data/alarms.json", (r) => r.fulfill(json({ updated: "2026-08-09T06:00:00+00:00", rows: [...ROWS].reverse() })));
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: [HAND] })));
  await openSite(page);
});

test("shows the newest year first, up to the website's newest alarm, against the same days a year earlier", async ({ page }) => {
  // the filters above the tabs don't apply here
  await page.selectOption("#f-year", "2024");
  await page.click("nav button[data-view=year]");
  expect(await page.$$eval("#y-year option", (o) => o.map((x) => x.value))).toEqual(["2026", "2025", "2024"]);
  await expect(page.locator("#y-year")).toHaveValue("2026");
  await expect(page.locator("#y-storm")).toBeChecked();
  // 8 alarms with the hand entry; up to 01.07. 7, against 5 in 2025
  expect(await tiles(page)).toEqual([
    ["Einsätze", "8", "+40 % gegenüber 2025 (jeweils bis 01.07.)"], ["Stärkster Tag", "01.01.2026", "3 Einsätze"],
    ["Stärkster Monat", "Jan", "3 Einsätze"], ["Nachts", "38 %", "zwischen 22 und 6 Uhr"],
  ]);
  await expect(page.locator("#y-partial")).toHaveText("Das Jahr 2026 läuft noch. Die Website listet Einsätze bis 01.07.2026, 1 späterer ist vorläufig eingetragen.");
  await expect(page.locator("#y-storm-note")).toHaveText("");
  await expect(page.locator("#y-race-note")).toHaveText("Einsätze ab dem 1. Januar, Tag für Tag zusammengezählt. Je steiler die Linie, desto mehr Einsätze in dieser Zeit. Die Linie für 2026 endet am 01.07., dem Tag des neuesten Einsatzes auf der Website.");
  expect(await ends(page)).toEqual(["2024: 13", "2025: 7", "2026: 7"]);
  expect(await chosen(page)).toEqual(["2026: 7"]);
  expect(await tips(page, "#y-months .hit")).toEqual(["Jan 2026: <b>3 Einsätze</b>", "Feb 2026: <b>0 Einsätze</b>", "Mär 2026: <b>1 Einsatz</b>",
    "Apr 2026: <b>1 Einsatz</b>", "Mai 2026: <b>0 Einsätze</b>", "Jun 2026: <b>1 Einsatz</b>", "Jul 2026: <b>2 Einsätze</b>",
    "Aug 2026: <b>0 Einsätze</b>", "Sep 2026: <b>0 Einsätze</b>", "Okt 2026: <b>0 Einsätze</b>", "Nov 2026: <b>0 Einsätze</b>", "Dez 2026: <b>0 Einsätze</b>"]);
  expect(await tips(page, "#y-groups .hit")).toEqual(["<b>Brand</b>: 5 Einsätze<br>2025 bis 01.07.: 3", "<b>Technische Hilfe</b>: 3 Einsätze<br>2025 bis 01.07.: 2"]);
  expect(await notable(page)).toEqual([["04.04.2026", "Brand, klein (z. B. Rauchmelder, BMA)", "Test", "Fernstraße, Linden-Mitte"]]);
  expect(page.errors).toEqual([]);
});

test("a whole year, with and without the Großlage, compared with the whole year before", async ({ page }) => {
  await page.click("nav button[data-view=year]");
  await page.selectOption("#y-year", "2025");
  expect(await tiles(page)).toEqual([
    ["Einsätze", "7", "-46 % gegenüber 2024"], ["Stärkster Tag", "01.01.2025", "2 Einsätze"],
    ["Stärkster Monat", "Jan", "2 Einsätze"], ["Nachts", "57 %", "zwischen 22 und 6 Uhr"],
  ]);
  await expect(page.locator("#y-partial")).toHaveText("");
  await expect(page.locator("#y-storm-note")).toHaveText("Großlagen mitgezählt: 10.07.2024 (10 Einsätze, im Vergleich mit 2024).");
  await expect(page.locator("#y-race-note")).toHaveText("Einsätze ab dem 1. Januar, Tag für Tag zusammengezählt. Je steiler die Linie, desto mehr Einsätze in dieser Zeit. Die Linie für 2026 endet am 01.07., dem Tag des neuesten Einsatzes auf der Website.");
  expect(await chosen(page)).toEqual(["2025: 7"]);
  expect(await notable(page)).toEqual([["08.08.2025", "Brand, groß (Gebäude, Halle)", "Test", "Fernstraße, Linden-Mitte"]]);
  // without the Großlage, 2024 had 3 alarms
  await page.setChecked("#y-storm", false);
  expect((await tiles(page))[0]).toEqual(["Einsätze", "7", "+133 % gegenüber 2024"]);
  await expect(page.locator("#y-storm-note")).toHaveText("Großlagen nicht mitgezählt: 10.07.2024 (10 Einsätze, im Vergleich mit 2024).");
  expect(await ends(page)).toEqual(["2024: 3", "2025: 7", "2026: 7"]);
  // 2024 itself: with the Großlage marked on its line, and without notable alarms
  await page.selectOption("#y-year", "2024");
  await page.setChecked("#y-storm", true);
  expect(await tiles(page)).toEqual([
    ["Einsätze", "13", ""], ["Stärkster Tag", "10.07.2024", "10 Einsätze"], ["Stärkster Monat", "Jul", "10 Einsätze"], ["Nachts", "15 %", "zwischen 22 und 6 Uhr"],
  ]);
  await expect(page.locator("#y-storm-note")).toHaveText("Großlagen mitgezählt: 10.07.2024 (10 Einsätze).");
  await expect(page.locator("#y-race text.anno")).toHaveText(["Großlage 10.07."]);
  expect(await tips(page, "#y-groups .hit")).toEqual(["<b>Technische Hilfe</b>: 11 Einsätze<br>2023: 0", "<b>Brand</b>: 2 Einsätze<br>2023: 0"]);
  expect(await notable(page)).toEqual([["Keine"]]);
  // without it: three alarms, two of them at night, and no mark
  await page.setChecked("#y-storm", false);
  const [count, , , night] = await tiles(page);
  expect([count, night]).toEqual([["Einsätze", "3", ""], ["Nachts", "67 %", "zwischen 22 und 6 Uhr"]]);
  await expect(page.locator("#y-race text.anno")).toHaveCount(0);
  expect(page.errors).toEqual([]);
});

test("keeps the chosen year while other tabs and filters change, and opens its story", async ({ page }) => {
  await page.click("nav button[data-view=year]");
  await page.selectOption("#y-year", "2025");
  await page.setChecked("#y-storm", false);
  await page.click("nav button[data-view=list]");
  await page.selectOption("#f-year", "2024");
  await page.setChecked("#f-standby", true);
  await page.click("nav button[data-view=year]");
  await expect(page.locator("#y-year")).toHaveValue("2025");
  await expect(page.locator("#y-storm")).not.toBeChecked();
  expect((await tiles(page))[0]).toEqual(["Einsätze", "7", "+133 % gegenüber 2024"]);
  // the story of 2025 without the Großlage, and back to its button
  await page.click("#y-story");
  await expect(page.locator("#story")).toBeVisible();
  await expect(page.locator("#story-card .st-title")).toHaveText("Das Einsatzjahr 2025");
  await expect(page.locator("#story-card .st-foot")).toHaveText("Ohne Großlagen");
  await page.click("#story-close");
  await expect(page.locator("#story")).toBeHidden();
  await expect(page.locator("#y-story")).toBeFocused();
  // printing
  await page.evaluate(() => { window.printed = 0; window.print = () => { window.printed++; }; });
  await page.click("#y-print");
  expect(await page.evaluate(() => window.printed)).toBe(1);
  expect(page.errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(device(devices["Pixel 7"]));

  test("draws the running totals as wide as the screen, with every third month", async ({ page }) => {
    await page.click("nav button[data-view=year]");
    const width = await page.locator("#y-race").evaluate((el) => el.clientWidth);
    await expect(page.locator("#y-race svg")).toHaveAttribute("viewBox", `0 0 ${width} 260`);
    await expect(page.locator("#y-race svg > text[text-anchor=middle]")).toHaveText(["Jan", "Apr", "Jul", "Okt"]);
    expect(await chosen(page)).toEqual(["2026: 7"]);
    expect(page.errors).toEqual([]);
  });
});
