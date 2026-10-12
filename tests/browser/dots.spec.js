// The Punktewand: every alarm is a dot, coloured by its type, in a column per month or hour or in a line per type
// or district. A new grouping sends the same dots to their new places; the filters, another tab and a new window
// width draw them afresh. A tapped dot shows its alarm under the chart. The alarms are made up: a few in 2025 and
// 2026, a Wachbesetzung, and a Großlage on 10.07.2026 entered without times.
import { devices } from "@playwright/test";
import { test, expect, json, openSite, device } from "./fixtures.js";

const alarm = (date, time, keyword, street, district, event = "Test") => ({ date, time, category: "Einsatz", keyword, event, street, district, remarks: "" });
const ROWS = [
  alarm("2025-01-10", "08:00", "b1", "Am Kanal", "Linden-Mitte"),
  alarm("2025-01-12", "14:30", "h", "Nahstraße", "Linden-Nord"),
  alarm("2025-03-03", "22:15", "uw", "Sturmweg", "Badenstedt"),
  alarm("2025-06-20", "03:40", "bg1", "Gasweg", "Linden-Süd"),
  alarm("2026-01-02", "12:00", "b1", "Mittelweg", "Linden-Mitte"),
  alarm("2026-01-05", "18:00", "b1", "Am Kanal", "Linden-Mitte"),
  alarm("2026-01-07", "07:30", "h", "Lange Straße", "Linden-Nord"),
  alarm("2026-02-14", "23:50", "r", "Fernstraße", "Ahlem"),
  alarm("2026-03-01", "19:00", "vs", "Teichstraße", "Linden-Mitte"), // a Wachbesetzung: only with the filter
  alarm("2026-04-04", "10:00", "bg1", "Gasweg", "Linden-Süd"),
  alarm("2026-05-05", "16:00", "h", "Nahstraße", "Linden-Nord"),
  alarm("2026-06-06", "12:00", "b1", "Mittelweg", "Linden-Mitte"),
  // a Großlage: ten storm alarms on one day, entered without their times
  ...Array.from({ length: 10 }, (_, i) => alarm("2026-07-10", "00:00", "uw", `Sturmweg ${i + 1}`, "Badenstedt", "Baum & Ast")),
];

// every dot: its alarm's day (from its tooltip), its colour, whether it is picked, and where it sits
const dots = (page) => page.$$eval("#c-dots .dot", (cs) => cs.map((c) => {
  const [, x, y] = c.style.transform.match(/^translate\(([\d.]+)px, ([\d.]+)px\)$/);
  return { day: c.dataset.tip.match(/\d\d\.\d\d\.\d{4}/)[0], kind: c.classList[1], on: c.classList.contains("on"), x: Number(x), y: Number(y) };
}));
const dot = (page, text) => page.locator(`#c-dots .dot[data-tip*="${text}"]`);
// the names and numbers written in the chart, in order
const texts = (page) => page.$$eval("#c-dots text", (ts) => ts.map((t) => t.textContent));
const drawn = (page, n) => expect(page.locator("#c-dots svg")).toHaveAttribute("aria-label", `${n} Einsätze als Punkte`);
const HINT = "Einen Punkt antippen, um den Einsatz zu sehen.";
// by hour on a wide chart: every hour named, and over each column with alarms their number
const PER_HOUR = { 3: 1, 7: 1, 8: 1, 10: 1, 12: 2, 14: 1, 16: 1, 18: 1, 22: 1, 23: 1, "?": 10 };
const HOURS = [...Array.from({ length: 24 }, (_, h) => String(h)), "?"].flatMap((h) => (PER_HOUR[h] ? [String(PER_HOUR[h]), h] : [h]));

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-09T12:00:00+02:00") });
  await page.route("**/data/alarms.json", (r) => r.fulfill(json({ updated: "2026-08-09T06:00:00+00:00", rows: [...ROWS].reverse() })));
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: [] })));
  await openSite(page);
});

test("every alarm a dot, coloured by its type, in a column per month; the tooltip and a tap show the alarm", async ({ page }) => {
  await expect(page.locator("#c-dots svg")).toHaveCount(0); // not drawn before the tab opens
  await page.click("nav button[data-view=dots]");
  await drawn(page, 21);
  const all = await dots(page);
  // Brand, Technische Hilfe, Unwetter, and grey for the rest; no Wachbesetzung
  expect(["brand", "hilfe", "unwetter", "other"].map((k) => all.filter((d) => d.kind === k).length)).toEqual([4, 3, 11, 3]);
  // the months of both years together, each with its number over its column, both centred
  expect(await texts(page)).toEqual(["5", "Jan", "1", "Feb", "1", "Mär", "1", "Apr", "1", "Mai", "2", "Jun", "10", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]);
  expect(await page.$$eval("#c-dots text.count", (ts) => ts.map((t) => t.textContent))).toEqual(["5", "1", "1", "1", "1", "2", "10"]);
  expect(await page.$$eval("#c-dots text", (ts) => [...new Set(ts.map((t) => t.getAttribute("text-anchor")))])).toEqual(["middle"]);
  // January in one line from the left: the Brand alarms, then Technische Hilfe, each oldest first
  const jan = all.filter((d) => d.day.slice(3, 5) === "01").sort((a, b) => a.x - b.x);
  expect(jan.map((d) => d.day)).toEqual(["10.01.2025", "02.01.2026", "05.01.2026", "12.01.2025", "07.01.2026"]);
  expect(new Set(jan.map((d) => d.y)).size).toBe(1);
  expect(Math.max(...all.map((d) => d.x))).toBeLessThan(await page.locator("#c-dots").evaluate((el) => el.clientWidth));
  // the tooltip over a dot, and a tap: the alarm under the chart and its dot marked
  const gas = dot(page, "20.06.2025");
  await gas.hover();
  await expect(page.locator("#tip")).toBeVisible();
  expect(await page.locator("#tip").innerHTML()).toBe("<b>Fr, 20.06.2025</b>, 03:40 Uhr<br>bg1 · Gasgeruch im Gebäude<br>Test<br>Gasweg, Linden-Süd");
  await expect(page.locator("#dots-detail")).toHaveText(HINT);
  await gas.click();
  await expect(gas).toHaveClass("dot other on");
  await expect(page.locator("#dots-detail")).toHaveText("Freitag, 20.06.2025, 03:40 Uhr · bg1 Gasgeruch im Gebäude · Test · Gasweg, Linden-Süd");
  await expect(page.locator("#dots-detail b")).toHaveText("Freitag, 20.06.2025, 03:40 Uhr");
  await gas.click(); // a second tap keeps it
  await expect(gas).toHaveClass("dot other on");
  // another dot: one of the Großlage, which has no time; the texts made safe for the tooltip
  const storm = dot(page, "Sturmweg 3,");
  expect(await storm.getAttribute("data-tip")).toBe("<b>Fr, 10.07.2026</b><br>uw · Unwetter<br>Baum &amp; Ast<br>Sturmweg 3, Badenstedt");
  await storm.click();
  await expect(gas).toHaveClass("dot other");
  await expect(storm).toHaveClass("dot unwetter on");
  await expect(page.locator("#dots-detail")).toHaveText("Freitag, 10.07.2026 · uw Unwetter · Baum & Ast · Sturmweg 3, Badenstedt");
  // a tap next to the dots lets go of it
  await page.locator("#c-dots svg").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#c-dots .dot.on")).toHaveCount(0);
  await expect(page.locator("#dots-detail")).toHaveText(HINT);
  expect(page.errors).toEqual([]);
});

test("a new grouping sends the same dots to new places and keeps the tapped alarm", async ({ page }) => {
  await page.click("nav button[data-view=dots]");
  await dot(page, "14.02.2026").click();
  const months = await dots(page);
  // marks the dots and the labels' group, to tell whether they are still the same ones
  await page.$$eval("#c-dots .dot, #c-dots .dot-labels", (els) => els.forEach((el) => (el.kept = true)));
  const kept = () => page.$$eval("#c-dots .dot, #c-dots .dot-labels", (els) => els.filter((el) => el.kept).length);
  const active = () => page.$$eval("#dots-by button.active", (bs) => bs.map((b) => b.textContent));
  expect(await active()).toEqual(["Monat"]);
  // by type: a line per type, most first, the dots of each oldest first
  await page.click("#dots-by button >> text=Einsatzart");
  expect(await active()).toEqual(["Einsatzart"]);
  expect(await texts(page)).toEqual(["Unwetter", "11", "Brand", "4", "Technische Hilfe", "3", "Gas & Gefahrstoffe", "2", "Rettungsdienst", "1"]);
  // the names end before the dots, the numbers follow them
  expect(await page.$$eval("#c-dots text", (ts) => ts.map((t) => `${t.getAttribute("class")} ${t.getAttribute("text-anchor")}`)))
    .toEqual(Array(5).fill(["null end", "count null"]).flat());
  const types = await dots(page);
  const at = (day) => types.find((d) => d.day === day);
  expect(["10.07.2026", "10.01.2025", "12.01.2025", "20.06.2025", "14.02.2026"].map((day) => at(day).y)).toEqual([8.5, 27.5, 46.5, 65.5, 84.5]);
  expect(types.filter((d) => d.kind === "brand").sort((a, b) => a.x - b.x).map((d) => d.day)).toEqual(["10.01.2025", "02.01.2026", "05.01.2026", "06.06.2026"]);
  expect(await kept()).toBe(22);
  await expect(page.locator("#c-dots .dot.on")).toHaveCount(1);
  await expect(dot(page, "14.02.2026")).toHaveClass("dot other on");
  await expect(page.locator("#dots-detail b")).toHaveText("Samstag, 14.02.2026, 23:50 Uhr");
  // by district
  await page.click("#dots-by button >> text=Stadtteil");
  expect(await texts(page)).toEqual(["Badenstedt", "11", "Linden-Mitte", "4", "Linden-Nord", "3", "Linden-Süd", "2", "Ahlem", "1"]);
  // by hour: a column per hour, and one for the alarms without a time
  await page.click("#dots-by button >> text=Uhrzeit");
  expect(await active()).toEqual(["Uhrzeit"]);
  expect(await texts(page)).toEqual(HOURS);
  const hours = await dots(page);
  // the Großlage in the column on the right
  expect(Math.min(...hours.filter((d) => d.day === "10.07.2026").map((d) => d.x))).toBeGreaterThan(Math.max(...hours.filter((d) => d.day !== "10.07.2026").map((d) => d.x)));
  // and back: every dot where it was, all the same dots
  await page.click("#dots-by button >> text=Monat");
  expect(await dots(page)).toEqual(months);
  expect(await kept()).toBe(22);
  await expect(page.locator("#dots-detail b")).toHaveText("Samstag, 14.02.2026, 23:50 Uhr");
  expect(page.errors).toEqual([]);
});

test("the filters and another tab draw the dots afresh in the same grouping, and let go of an alarm that is no longer there", async ({ page }) => {
  await page.click("nav button[data-view=dots]");
  await page.click("#dots-by button >> text=Einsatzart");
  await dot(page, "20.06.2025").click();
  await page.$$eval("#c-dots .dot", (cs) => cs.forEach((c) => (c.kept = true)));
  // 2026 alone: new dots, still by type, and the alarm from 2025 let go
  await page.selectOption("#f-year", "2026");
  await drawn(page, 17);
  expect(await page.$$eval("#c-dots .dot", (cs) => cs.filter((c) => c.kept).length)).toBe(0);
  expect((await texts(page)).slice(0, 4)).toEqual(["Unwetter", "10", "Brand", "3"]);
  await expect(page.locator("#c-dots .dot.on")).toHaveCount(0);
  await expect(page.locator("#dots-detail")).toHaveText(HINT);
  // every year again: the alarm from 2025 is back, but no longer picked
  await page.selectOption("#f-year", "");
  await drawn(page, 21);
  await expect(page.locator("#c-dots .dot.on")).toHaveCount(0);
  await expect(page.locator("#dots-detail")).toHaveText(HINT);
  // an alarm the filters keep stays picked; the Wachbesetzung is grey
  await dot(page, "14.02.2026").click();
  await page.setChecked("#f-standby", true);
  await drawn(page, 22);
  await expect(dot(page, "14.02.2026")).toHaveClass("dot other on");
  await expect(page.locator("#dots-detail b")).toHaveText("Samstag, 14.02.2026, 23:50 Uhr");
  await expect(dot(page, "01.03.2026")).toHaveClass("dot other");
  // without the Großlage
  await page.setChecked("#f-storm", false);
  await drawn(page, 12);
  expect((await texts(page)).slice(0, 2)).toEqual(["Brand", "4"]);
  // a filter changed on another tab: drawn for it when the tab opens again, not before
  await page.click("nav button[data-view=list]");
  await page.selectOption("#f-year", "2025");
  await drawn(page, 12);
  await page.click("nav button[data-view=dots]");
  await drawn(page, 4);
  expect(await page.$$eval("#dots-by button.active", (bs) => bs.map((b) => b.textContent))).toEqual(["Einsatzart"]);
  await expect(page.locator("#dots-detail")).toHaveText(HINT);
  expect(page.errors).toEqual([]);
});

test("a new grouping moves the dots one after another; new dots show at their places at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.click("nav button[data-view=dots]");
  // what moves or fades in the chart: each dot's move with its delay, and the labels fading in
  const running = () => page.evaluate(() => document.getAnimations().filter((a) => a.effect.target.closest("#c-dots"))
    .map((a) => (a.transitionProperty ? `move ${a.effect.getTiming().delay}` : a.animationName)).sort());
  expect(await running()).toEqual(["fade-in"]);
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await page.click("#dots-by button >> text=Einsatzart");
  // every dot moves, each a little later than the one before it in the data
  const delays = Array.from({ length: 21 }, (_, i) => (i * 37) % 400);
  expect(await running()).toEqual(delays.map((d) => `move ${d}`).sort());
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  // a new year: the dots are new and show at their places, while the labels fade in
  await page.selectOption("#f-year", "2026");
  expect(await running()).toEqual(["fade-in"]);
  expect(page.errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(device(devices["Pixel 7"]));

  test("smaller dots, as wide as the screen; by hour every third hour named and no numbers over the narrow columns; turned, drawn afresh", async ({ page }) => {
    await page.click("nav button[data-view=dots]");
    const width = await page.locator("#c-dots").evaluate((el) => el.clientWidth);
    await expect(page.locator("#c-dots svg")).toHaveAttribute("viewBox", new RegExp(`^0 0 ${width} \\d+$`));
    await expect(page.locator("#c-dots .dot").first()).toHaveAttribute("r", "2.7");
    expect((await texts(page)).slice(0, 2)).toEqual(["5", "Jan"]);
    await page.click("#dots-by button >> text=Uhrzeit");
    expect(await texts(page)).toEqual(["0", "3", "6", "9", "12", "15", "18", "21", "?"]);
    await dot(page, "20.06.2025").tap();
    await expect(page.locator("#dots-detail b")).toHaveText("Freitag, 20.06.2025, 03:40 Uhr");
    // the phone turned: drawn afresh at the new width, with bigger dots and every hour named, the alarm still picked
    await page.setViewportSize({ width: 915, height: 412 });
    const wide = await page.locator("#c-dots").evaluate((el) => el.clientWidth);
    await expect(page.locator("#c-dots svg")).toHaveAttribute("viewBox", new RegExp(`^0 0 ${wide} \\d+$`));
    await expect(page.locator("#c-dots .dot").first()).toHaveAttribute("r", "3.4");
    expect(await texts(page)).toEqual(HOURS);
    await expect(dot(page, "20.06.2025")).toHaveClass("dot other on");
    expect(page.errors).toEqual([]);
  });
});
