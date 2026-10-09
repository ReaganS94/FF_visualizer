// The Einsatzradius tab: how far the alarms were from the Wache, in tiles and distance bars, and the playback,
// which sends the alarms out in date order. The alarms and their map positions are made up: each street lies a
// known distance north of the Wache, and two have no position.
import { devices } from "@playwright/test";
import { test, expect, json, openSite, device } from "./fixtures.js";

const north = (km) => [52.36847 + km / 110.57, 9.71195]; // km north of the Wache (lib/places.js)
const GEO = {
  "Nahstraße|Linden-Mitte": north(0.1), "Am Kanal|Linden-Nord": north(0.3), "Mittelweg|Linden-Süd": north(0.75),
  "Brückenstraße|Calenberger Neustadt": north(1.5), "Lange Straße|Mitte": north(2.5), "Viertweg|Herrenhausen": north(4),
  "Fernstraße|Misburg-Nord": north(8), "A2|Stöcken": null,
};
const alarm = (date, keyword, street, district) => ({ date, time: "12:00", category: "Einsatz", keyword, event: "Test", street, district, remarks: "" });
// oldest first; the days are counted from the first alarm, for the playback
const ROWS = [
  alarm("2024-03-01", "b1", "Nahstraße", "Linden-Mitte"), // day 0
  alarm("2024-08-15", "h", "Viertweg", "Herrenhausen"), // day 167
  alarm("2025-01-10", "b1", "Am Kanal", "Linden-Nord"), // day 315
  alarm("2025-03-05", "h", "Mittelweg", "Linden-Süd"), // day 369
  alarm("2025-06-20", "b1", "Brückenstraße", "Calenberger Neustadt"),
  alarm("2025-09-01", "hm1", "Lange Straße", "Mitte"),
  alarm("2025-11-11", "hm1", "A2", "Stöcken"), // no position
  alarm("2026-02-14", "b2", "Fernstraße", "Misburg-Nord"),
  alarm("2026-05-01", "b1", "Nahstraße", "Linden-Mitte"),
  alarm("2026-07-04", "hm1", "Autobahn A7", "Bothfeld"), // not in the positions at all
  alarm("2026-08-08", "vs", "Brückenstraße", "Calenberger Neustadt"), // a Wachbesetzung
];

const LABELS = ["bis 500 m", "0,5–1 km", "1–2 km", "2–3 km", "3–5 km", "über 5 km"];
// what the distance bars should say for these alarm counts, closest first
const bars = (counts) => {
  const n = counts.reduce((s, c) => s + c, 0);
  return LABELS.map((l, i) => `${l}: ${counts[i]} ${counts[i] === 1 ? "Einsatz" : "Einsätze"}${n ? ` (${Math.round((100 * counts[i]) / n)}\u00a0%)` : ""}`);
};
// the tiles, each as its number, label and detail line
const tiles = (median, within2, far, farAlarm) => [
  [median, "Die Hälfte der Einsätze liegt näher als das"], [within2, "im Umkreis von 2 km"], [far, "am weitesten weg", ...(farAlarm ? [farAlarm] : [])],
];
async function check(page, { tiles: t, bars: b, note, outside }) {
  await expect.poll(() => page.$$eval("#radius-tiles .tile", (ts) => ts.map((x) => [...x.children].map((c) => c.textContent)))).toEqual(t);
  await expect.poll(() => page.$$eval("#c-radius-km .hit", (hs) => hs.map((h) => h.dataset.tip))).toEqual(b);
  if (note !== undefined) await expect(page.locator("#radius-note")).toHaveText(note);
  if (outside !== undefined) await expect(page.locator("#radius-outside")).toHaveText(outside);
}
const button = (page) => page.locator("#ra-play");
// the count in the date box on the map ("<b>27.04.2024</b>1 Einsatz")
const clockCount = (page) => page.locator("#c-radius .rp-clock").evaluate((c) => c.querySelector("b").nextSibling.textContent);

test.beforeEach(async ({ page }) => {
  await page.route("**/data/alarms.json", (r) => r.fulfill(json({ updated: "2026-08-09T06:00:00+00:00", rows: [...ROWS].reverse() })));
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: [] })));
  await page.route("**/data/geo.json", (r) => r.fulfill(json(GEO)));
});

test("counts the chosen alarms by distance, and says which have no position or lie outside the map", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=radius]");
  await expect(page.locator("#c-radius canvas")).toHaveCount(1);
  // 0,1 0,1 0,3 0,75 1,5 2,5 4 8 km: the middle one is the fifth
  await check(page, {
    tiles: tiles("1,5 km", "63\u00a0%", "8,0 km", "Fernstraße, Misburg-Nord, 14.02.2026"), bars: bars([3, 1, 1, 1, 1, 1]),
    note: "2 Einsätze ohne bekannte Adresse (z. B. Autobahn) fehlen.", outside: "2 Einsätze liegen außerhalb des Ausschnitts.",
  });
  await expect(button(page)).toBeEnabled();
  // the whole selection on the map, then Linden again (3 km around the Wache)
  await page.click("[data-radius=all]");
  await expect(page.locator("#radius-outside")).toHaveText("");
  await page.click("[data-radius=near]");
  await expect(page.locator("#radius-outside")).toHaveText("2 Einsätze liegen außerhalb des Ausschnitts.");
  // a year at a time
  await page.selectOption("#f-year", "2024");
  await check(page, {
    tiles: tiles("4,0 km", "50\u00a0%", "4,0 km", "Viertweg, Herrenhausen, 15.08.2024"), bars: bars([1, 0, 0, 0, 1, 0]),
    note: "", outside: "1 Einsatz liegt außerhalb des Ausschnitts.",
  });
  await page.selectOption("#f-year", "2025");
  await check(page, {
    tiles: tiles("1,5 km", "75\u00a0%", "2,5 km", "Lange Straße, Mitte, 01.09.2025"), bars: bars([1, 1, 1, 1, 0, 0]),
    note: "1 Einsatz ohne bekannte Adresse (z. B. Autobahn) fehlt.", outside: "",
  });
  // Wachbesetzungen count with the filter on
  await page.selectOption("#f-year", "");
  await page.setChecked("#f-standby", true);
  await check(page, {
    tiles: tiles("1,5 km", "67\u00a0%", "8,0 km", "Fernstraße, Misburg-Nord, 14.02.2026"), bars: bars([3, 1, 2, 1, 1, 1]),
    note: "2 Einsätze ohne bekannte Adresse (z. B. Autobahn) fehlen.",
  });
  expect(page.errors).toEqual([]);
});

test("plays the alarms in date order, counting those sent out so far", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-09T12:00:00+02:00") });
  await openSite(page);
  await page.click("nav button[data-view=radius]");
  await expect(page.locator("#c-radius canvas")).toHaveCount(1);
  // a paused clock: the playback moves on only with runFor(), by a month (30 days) per second at first
  await page.clock.pauseAt(new Date("2026-08-09T12:05:00+02:00"));
  const map = page.locator("#c-radius");
  expect((await map.boundingBox()).y + (await map.boundingBox()).height).toBeGreaterThan(page.viewportSize().height);
  await expect(button(page)).toHaveText("▶ Abspielen");
  await button(page).click();
  await expect(button(page)).toHaveText("❚❚ Pause");
  // the map scrolls into view
  await expect.poll(async () => (await map.boundingBox()).y + (await map.boundingBox()).height).toBeLessThanOrEqual(page.viewportSize().height + 1);
  // 2 seconds: day 57, only the first alarm is out
  await page.clock.runFor(2000);
  await check(page, { tiles: tiles("100 m", "100\u00a0%", "100 m", "Nahstraße, Linden-Mitte, 01.03.2024"), bars: bars([1, 0, 0, 0, 0, 0]) });
  expect(await clockCount(page)).toBe("1 Einsatz");
  // paused, nothing more goes out
  await button(page).click();
  await expect(button(page)).toHaveText("▶ Weiter");
  await page.clock.runFor(10000);
  await check(page, { tiles: tiles("100 m", "100\u00a0%", "100 m", "Nahstraße, Linden-Mitte, 01.03.2024"), bars: bars([1, 0, 0, 0, 0, 0]) });
  // 6 seconds played: day 177, the second alarm is out too (day 167), the third (day 315) isn't
  await button(page).click();
  await page.clock.runFor(4000);
  const two = { tiles: tiles("4,0 km", "50\u00a0%", "4,0 km", "Viertweg, Herrenhausen, 15.08.2024"), bars: bars([1, 0, 0, 0, 1, 0]) };
  await check(page, two);
  expect(await clockCount(page)).toBe("2 Einsätze");
  // leaving the tab pauses the playback
  await page.click("nav button[data-view=list]");
  await page.clock.runFor(10000);
  await page.click("nav button[data-view=radius]");
  await expect(button(page)).toHaveText("▶ Weiter");
  await check(page, two);
  // a new window width draws the tab again, but goes on playing (7 seconds: still two alarms)
  await button(page).click();
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.clock.runFor(1000); // drawn again 150 ms after the window changes
  await expect(button(page)).toHaveText("❚❚ Pause");
  await check(page, two);
  // a new selection starts over, with all of its alarms
  await page.selectOption("#f-year", "2025");
  await expect(button(page)).toHaveText("▶ Abspielen");
  const all2025 = { tiles: tiles("1,5 km", "75\u00a0%", "2,5 km", "Lange Straße, Mitte, 01.09.2025"), bars: bars([1, 1, 1, 1, 0, 0]) };
  await check(page, all2025);
  // a quarter (91 days) per second: after a second, day 88, the alarms of day 0 and day 54 are out
  await page.selectOption("#ra-speed", "91");
  await button(page).click();
  await page.clock.runFor(1000);
  await check(page, { tiles: tiles("750 m", "100\u00a0%", "750 m", "Mittelweg, Linden-Süd, 05.03.2025"), bars: bars([1, 1, 0, 0, 0, 0]) });
  // to the end, and back to the whole picture
  await page.clock.runFor(10000);
  await expect(button(page)).toHaveText("▶ Nochmal abspielen");
  await check(page, all2025);
  expect(page.errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(device(devices["Pixel 7"]));

  test("says when there are no map positions yet, with nothing to play", async ({ page }) => {
    await page.route("**/data/geo.json", (r) => r.fulfill(json({})));
    await openSite(page);
    await page.click("nav button[data-view=radius]");
    await check(page, {
      tiles: tiles("–", "–", "–"), bars: bars([0, 0, 0, 0, 0, 0]),
      note: "Die Karte erscheint nach der nächsten täglichen Aktualisierung.", outside: "",
    });
    await expect(button(page)).toBeDisabled();
    await expect(page.locator("#c-radius")).toBeHidden();
    expect(page.errors).toEqual([]);
  });
});
