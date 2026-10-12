// The Karte tab: the heat map of the chosen alarms, and the Zeitraffer, which plays them on the map in date order
// (by day, from the first alarm), with its slider. The alarms and their map positions are made up; two alarms
// have no position.
import { devices } from "@playwright/test";
import { test, expect, json, openSite, device } from "./fixtures.js";

const GEO = {
  "Nahstraße|Linden-Mitte": [52.366, 9.713], "Am Kanal|Linden-Nord": [52.374, 9.715], "Mittelweg|Linden-Süd": [52.36, 9.72],
  "Brückenstrasse|Calenberger Neustadt": [52.37, 9.73], "A2|Stöcken": null,
}; // positions are stored under the spelling the website uses, which the site tidies to "Brückenstraße"
const alarm = (date, keyword, street, district) => ({ date, time: "12:00", category: "Einsatz", keyword, event: "Test", street, district, remarks: "" });
// oldest first, with the days counted from the first alarm
const ROWS = [
  alarm("2025-01-01", "b1", "Nahstraße", "Linden-Mitte"), // day 0
  alarm("2025-01-31", "h", "Nahstraße", "Linden-Mitte"), // day 30
  alarm("2025-03-02", "b1", "Am Kanal", "Linden-Nord"), // day 60
  alarm("2025-03-02", "hm1", "A2", "Stöcken"), // no position
  alarm("2025-06-30", "h", "Mittelweg", "Linden-Süd"), // day 180
  alarm("2025-12-27", "hm1", "Autobahn A7", "Bothfeld"), // not in the positions at all
  alarm("2026-01-01", "b2", "Brückenstrasse", "Calenberger Neustadt"), // day 365
  alarm("2026-02-10", "vs", "Brückenstrasse", "Calenberger Neustadt"), // a Wachbesetzung, day 405
];

const button = (page) => page.locator("#rp-play");
const slider = (page) => page.locator("#rp-pos");
// the date box on the map ("<b>31.01.2025</b>2 Einsätze") as [date, count], or null while hidden
const clock = (page) => page.locator("#c-map .rp-clock").evaluate((c) => (c.hidden ? null : [c.querySelector("b").textContent, c.querySelector("b").nextSibling.textContent]));
// the Zeitraffer's dots on the map, and how many of them light up
const dots = (page) => page.evaluate(() => [document.querySelectorAll("#c-map .rp-dot").length, document.querySelectorAll("#c-map .rp-flash").length]);
const heat = (page) => page.locator("#c-map canvas.leaflet-heatmap-layer");

test.beforeEach(async ({ page }) => {
  await page.route("**/data/alarms.json", (r) => r.fulfill(json({ updated: "2026-02-11T06:00:00+00:00", rows: [...ROWS].reverse() })));
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: [] })));
  await page.route("**/data/geo.json", (r) => r.fulfill(json(GEO)));
});

test("puts the chosen alarms on the map and says how many have no position", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=map]");
  await expect(heat(page)).toHaveCount(1);
  await expect(page.locator("section[data-view=map] h2")).toHaveText("Wo gab es die meisten Einsätze?");
  await expect(page.locator("#map-note")).toHaveText("5 Einsätze auf der Karte. 2 ohne bekannte Adresse (z. B. Autobahn) fehlen.");
  await expect(button(page)).toHaveText("▶ Zeitraffer abspielen");
  await expect(button(page)).toBeEnabled();
  await expect(page.locator("#rp-speed")).toHaveValue("30");
  await expect(slider(page)).toHaveAttribute("max", "365");
  await expect(slider(page)).toHaveValue("0");
  await expect(page.locator("#rp-reset")).toBeHidden();
  expect(await clock(page)).toBeNull();
  await page.selectOption("#f-year", "2025");
  await expect(page.locator("#map-note")).toHaveText("4 Einsätze auf der Karte. 2 ohne bekannte Adresse (z. B. Autobahn) fehlen.");
  await expect(slider(page)).toHaveAttribute("max", "180");
  await page.selectOption("#f-year", "2026");
  await expect(page.locator("#map-note")).toHaveText("1 Einsatz auf der Karte.");
  await expect(slider(page)).toHaveAttribute("max", "0");
  // Wachbesetzungen count with the filter on
  await page.selectOption("#f-year", "");
  await page.setChecked("#f-standby", true);
  await expect(page.locator("#map-note")).toHaveText("6 Einsätze auf der Karte. 2 ohne bekannte Adresse (z. B. Autobahn) fehlen.");
  await expect(slider(page)).toHaveAttribute("max", "405");
  await expect(heat(page)).toHaveCount(1);
  // a new window width while another tab shows (the heat map can't be drawn on a hidden map)
  await page.click("nav button[data-view=list]");
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(400);
  await page.click("nav button[data-view=map]");
  await expect(heat(page)).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test("plays the alarms in date order, pauses, and starts over for a new selection", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-02-11T12:00:00+01:00") });
  await openSite(page);
  await page.click("nav button[data-view=map]");
  await expect(heat(page)).toHaveCount(1);
  // a paused clock: the Zeitraffer moves on only with runFor(), by a month (30 days) per second at first
  await page.clock.pauseAt(new Date("2026-02-11T12:05:00+01:00"));
  const map = page.locator("#c-map");
  expect((await map.boundingBox()).y + (await map.boundingBox()).height).toBeGreaterThan(page.viewportSize().height);
  await button(page).click();
  await expect(button(page)).toHaveText("❚❚ Pause");
  // the map scrolls into view, the heat map makes way for the dots, and the first alarm lights up
  await expect.poll(async () => (await map.boundingBox()).y + (await map.boundingBox()).height).toBeLessThanOrEqual(page.viewportSize().height + 1);
  await expect(heat(page)).toHaveCount(0);
  await expect(page.locator("#rp-reset")).toBeVisible();
  expect(await clock(page)).toEqual(["01.01.2025", "1 Einsatz"]);
  expect(await dots(page)).toEqual([1, 1]);
  // 1.5 seconds: day 45, the alarm of day 30 is out too; the slider follows
  await page.clock.runFor(1500);
  expect(await dots(page)).toEqual([2, 2]);
  // the date box shows the day the slider stands on (whole days since 01.01.2025)
  const day = Number(await slider(page).inputValue());
  expect(day).toBeGreaterThanOrEqual(43);
  expect(day).toBeLessThanOrEqual(46);
  expect(await clock(page)).toEqual([`${String(day - 30).padStart(2, "0")}.02.2025`, "2 Einsätze"]);
  // paused, nothing more comes
  await button(page).click();
  await expect(button(page)).toHaveText("▶ Weiter");
  await page.clock.runFor(5000);
  expect(await dots(page)).toEqual([2, 2]);
  // another second: day 75, the alarm of day 60 is out
  await button(page).click();
  await page.clock.runFor(1000);
  expect(await dots(page)).toEqual([3, 3]);
  // a new window width draws the tab again, but the Zeitraffer goes on
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.clock.runFor(500); // drawn again 150 ms after the window changes
  await expect(button(page)).toHaveText("❚❚ Pause");
  expect(await dots(page)).toEqual([3, 3]);
  // leaving the tab ends it: back to the heat map
  await page.click("nav button[data-view=list]");
  await page.click("nav button[data-view=map]");
  await expect(button(page)).toHaveText("▶ Zeitraffer abspielen");
  await expect(heat(page)).toHaveCount(1);
  await expect(page.locator("#rp-reset")).toBeHidden();
  await expect(slider(page)).toHaveValue("0");
  expect(await dots(page)).toEqual([0, 0]);
  expect(await clock(page)).toBeNull();
  // a new selection while playing starts over, with its own days
  await button(page).click();
  await page.clock.runFor(500);
  await page.selectOption("#f-year", "2025");
  await expect(button(page)).toHaveText("▶ Zeitraffer abspielen");
  await expect(slider(page)).toHaveAttribute("max", "180");
  await expect(slider(page)).toHaveValue("0");
  expect(await dots(page)).toEqual([0, 0]);
  // a quarter (91 days) per second, to the end: all four alarms of 2025 with a position
  await page.selectOption("#rp-speed", "91");
  await button(page).click();
  await page.clock.runFor(3000);
  await expect(button(page)).toHaveText("▶ Nochmal abspielen");
  expect(await clock(page)).toEqual(["30.06.2025", "4 Einsätze"]);
  expect(await dots(page)).toEqual([4, 4]);
  await expect(slider(page)).toHaveValue("180");
  // again: from the start
  await button(page).click();
  await expect(button(page)).toHaveText("❚❚ Pause");
  expect(await clock(page)).toEqual(["01.01.2025", "1 Einsatz"]);
  expect(await dots(page)).toEqual([1, 1]);
  expect(page.errors).toEqual([]);
});

test("the slider shows the alarms up to a day, and the Zeitraffer ends back on the heat map", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-02-11T12:00:00+01:00") });
  await openSite(page);
  await page.click("nav button[data-view=map]");
  await expect(heat(page)).toHaveCount(1);
  await page.clock.pauseAt(new Date("2026-02-11T12:05:00+01:00"));
  // the day before the third alarm: two dots, without lighting up
  await slider(page).fill("59");
  expect(await clock(page)).toEqual(["01.03.2025", "2 Einsätze"]);
  expect(await dots(page)).toEqual([2, 0]);
  await expect(button(page)).toHaveText("▶ Weiter");
  await expect(page.locator("#rp-reset")).toBeVisible();
  await expect(heat(page)).toHaveCount(0);
  await slider(page).fill("60");
  expect(await clock(page)).toEqual(["02.03.2025", "3 Einsätze"]);
  expect(await dots(page)).toEqual([3, 0]);
  // back to the start
  await slider(page).fill("0");
  expect(await clock(page)).toEqual(["01.01.2025", "1 Einsatz"]);
  expect(await dots(page)).toEqual([1, 0]);
  // to the end
  await slider(page).fill("365");
  expect(await clock(page)).toEqual(["01.01.2026", "5 Einsätze"]);
  await expect(button(page)).toHaveText("▶ Nochmal abspielen");
  // played on from the slider: from day 170, the alarm of day 180 lights up after a second
  await slider(page).fill("170");
  expect(await dots(page)).toEqual([3, 0]);
  await button(page).click();
  await page.clock.runFor(1000);
  expect(await dots(page)).toEqual([4, 1]);
  await button(page).click();
  // ended: the heat map again, and the slider at the start
  await page.click("#rp-reset");
  await expect(heat(page)).toHaveCount(1);
  await expect(button(page)).toHaveText("▶ Zeitraffer abspielen");
  await expect(page.locator("#rp-reset")).toBeHidden();
  await expect(slider(page)).toHaveValue("0");
  expect(await dots(page)).toEqual([0, 0]);
  expect(await clock(page)).toBeNull();
  expect(page.errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(device(devices["Pixel 7"]));

  test("says when there are no map positions yet, with nothing to play", async ({ page }) => {
    await page.route("**/data/geo.json", (r) => r.fulfill(json({})));
    await openSite(page);
    await page.click("nav button[data-view=map]");
    await expect(page.locator("#map-note")).toHaveText("Die Karte erscheint nach der nächsten täglichen Aktualisierung.");
    await expect(button(page)).toBeDisabled();
    await expect(page.locator("#c-map")).toBeHidden();
    await expect(slider(page)).toHaveAttribute("max", "0");
    expect(page.errors).toEqual([]);
  });
});
