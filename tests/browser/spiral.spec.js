// The Jahresspirale: a turn per year from the inside out, a piece per day shaded by its alarms, every date at the same
// angle in every year. The alarms are made up: a leap day, busy days, Silvester, a Großlage entered without times,
// a Wachbesetzung alone in its year, and an entry by hand after the website's newest alarm.
import { test, expect, json, openSite } from "./fixtures.js";

const alarm = (date, time, keyword, street = "Teststraße", event = "Test") =>
  ({ date, time, category: "Einsatz", keyword, event, street, district: "Linden-Mitte", remarks: "" });
const ROWS = [
  alarm("2023-05-05", "19:00", "vs", "Teichstraße"), // a Wachbesetzung, alone in its year: only with the filter
  alarm("2024-02-29", "10:00", "b1"),
  alarm("2024-07-01", "08:00", "h"), alarm("2024-07-01", "09:30", "th1"),
  ...Array.from({ length: 5 }, (_, i) => alarm("2024-11-11", `1${i}:11`, "h")),
  alarm("2025-03-03", "08:00", "b1"), alarm("2025-03-03", "12:00", "h"), alarm("2025-03-03", "18:00", "r"),
  alarm("2025-07-01", "07:00", "b1"),
  alarm("2025-12-31", "23:30", "b1", "Am Kanal", "Feuer <Mülltonne> & Rauch"),
  ...Array.from({ length: 7 }, (_, i) => alarm("2026-01-01", `0${i}:10`, "b1", `Silvesterweg ${i + 1}`)), // Silvester, no Großlage
  ...Array.from({ length: 4 }, (_, i) => alarm("2026-07-01", `1${i}:00`, "th1")),
  // a Großlage: ten storm alarms on one day, entered without their times
  ...Array.from({ length: 10 }, (_, i) => alarm("2026-07-10", "00:00", "uw", `Sturmweg ${i + 1}`)),
  alarm("2026-07-31", "16:00", "th1"), // the website's newest alarm
];
const HAND = { ...alarm("2026-08-05", "12:00", "th1", "Handweg", "Testeintrag von Hand") };

// Every piece of the spiral in page order: its day ("2026-07-14"), alarms, tooltip, classes, colour and opacity, and
// where its middle is: the angle clockwise from the top and the distance from the centre.
const pieces = (page) => page.$$eval("#c-spiral .day-seg", (ps) => {
  const C = document.querySelector("#c-spiral svg").viewBox.baseVal.width / 2;
  return ps.map((p) => {
    const [, d, m, y, n] = p.dataset.tip.match(/^<b>\w\w, (\d\d)\.(\d\d)\.(\d{4})<\/b> · (\d+) /);
    const corners = p.getAttribute("d").match(/[\d.]+,[\d.]+/g).map((s) => s.split(",").map(Number));
    const x = corners.reduce((s, c) => s + c[0], 0) / 4 - C, yy = corners.reduce((s, c) => s + c[1], 0) / 4 - C;
    const cs = getComputedStyle(p);
    return { date: `${y}-${m}-${d}`, n: Number(n), tip: p.dataset.tip, cls: p.getAttribute("class"), fill: cs.fill, opacity: cs.opacity,
      angle: ((Math.atan2(x, -yy) * 180) / Math.PI + 360) % 360, r: Math.hypot(x, yy) };
  });
});
const texts = (page, sel) => page.$$eval(`#c-spiral ${sel}`, (ts) => ts.map((t) => t.textContent));
const NOTE = "Jede Runde ist ein Jahr, jedes Stück ein Tag. Derselbe Tag liegt in jedem Jahr an derselben Stelle, so stehen " +
  "die Jahreszeiten übereinander. Je dunkler, desto mehr Einsätze an diesem Tag.";
const PALER = " Tage nach dem 31.07.2026 sind blasser: Die Website listet sie noch nicht, an diesen Tagen zählen nur vorläufige Einträge.";
const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 864e5 + 1;

async function openSpiral(page, { time = "2026-08-09T12:00:00+02:00", hand = [HAND] } = {}) {
  await page.clock.install({ time: new Date(time) });
  await page.route("**/data/alarms.json", (r) => r.fulfill(json({ updated: "2026-08-09T06:00:00+00:00", rows: [...ROWS].reverse() })));
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: hand })));
  await openSite(page);
  await page.click("nav button[data-view=spiral]");
}

test("a turn per year from the inside out, a piece per day up to the newest alarm, shaded like the colour key", async ({ page }) => {
  await openSpiral(page);
  await expect(page.locator("#c-spiral svg")).toHaveAttribute("aria-label", "Einsätze pro Tag als Spirale, 2024 bis 2026");
  expect(await texts(page, "text.year-mark")).toEqual(["2024", "2025", "2026"]);
  expect(await texts(page, "text:not(.year-mark)")).toEqual(["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
    "2024–2026", "von innen nach außen"]);
  await expect(page.locator("#c-spiral line.grid")).toHaveCount(12);
  await expect(page.locator("#spiral-note")).toHaveText(NOTE + PALER);
  // every day of 2024 (with the 29.02.) and 2025, and of 2026 up to the entry by hand
  const all = await pieces(page);
  const of = (y) => all.filter((p) => p.date.startsWith(y)).map((p) => p.date);
  for (const [y, last] of [["2024", "2024-12-31"], ["2025", "2025-12-31"], ["2026", "2026-08-05"]]) {
    expect([of(y)[0], of(y).at(-1), of(y).length]).toEqual([`${y}-01-01`, last, days(`${y}-01-01`, last)]);
  }
  expect(all.map((p) => p.date)).toEqual([...new Set(all.map((p) => p.date))].sort()); // each day once, in order
  expect(of("2024")).toContain("2024-02-29");
  // the colour key's ranges and colours; each piece has the colour of its count's range, and every one is used
  const key = await page.$$eval("#c-spiral .legend i", (is) => is.map((i) => [i.nextSibling.textContent.trim(), getComputedStyle(i).backgroundColor]));
  expect(key.map(([label]) => label)).toEqual(["0", "1", "2", "3–4", "5+"]);
  const shade = (n) => key[n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4][1];
  expect(all.filter((p) => p.fill !== shade(p.n)).map((p) => p.date)).toEqual([]);
  expect(new Set(all.map((p) => p.fill)).size).toBe(5);
  expect(Object.fromEntries(all.filter((p) => p.n).map((p) => [p.date, p.n]))).toEqual({ "2024-02-29": 1, "2024-07-01": 2, "2024-11-11": 5, "2025-03-03": 3,
    "2025-07-01": 1, "2025-12-31": 1, "2026-01-01": 7, "2026-07-01": 4, "2026-07-10": 10, "2026-07-31": 1, "2026-08-05": 1 });
  // the same day at the same angle in every year, a turn further out each year; the 01.01. right of the gap at the top
  const july = all.filter((p) => p.date.endsWith("-07-01"));
  expect(july.map((p) => p.angle.toFixed(1))).toEqual(["179.5", "179.5", "179.5"]);
  expect([Math.round(july[1].r - july[0].r), Math.round(july[2].r - july[1].r)]).toEqual([46, 46]);
  expect(all[0].angle).toBeCloseTo(8.5, 0);
  // each year's label in the gap at the top, where its turn starts
  const C = await page.locator("#c-spiral svg").evaluate((svg) => svg.viewBox.baseVal.width / 2);
  const marks = await page.$$eval("#c-spiral text.year-mark", (ts) => ts.map((t) => [Number(t.getAttribute("x")), Number(t.getAttribute("y"))]));
  expect(marks.map(([x, y]) => [x, C - y + 4])).toEqual([[C, 96], [C, 142], [C, 188]]);
  // tooltips: the weekday, the alarms (six at most, the time only where there is one), the text made safe
  const tip = (date) => all.find((p) => p.date === date).tip;
  expect(tip("2026-01-01")).toBe("<b>Do, 01.01.2026</b> · 7 Einsätze" +
    [6, 5, 4, 3, 2, 1].map((h) => `<br>0${h}:10 b1 – Test`).join("") + "<br>… und 1 weiterer");
  expect(tip("2026-07-10")).toBe(`<b>Fr, 10.07.2026</b> · 10 Einsätze${"<br>uw – Test".repeat(6)}<br>… und 4 weitere`);
  expect(tip("2025-12-31")).toBe("<b>Mi, 31.12.2025</b> · 1 Einsatz<br>23:30 b1 – Feuer &lt;Mülltonne&gt; &amp; Rauch");
  expect(tip("2025-06-15")).toBe("<b>So, 15.06.2025</b> · 0 Einsätze");
  await page.locator("#c-spiral .day-seg").nth(all.findIndex((p) => p.date === "2024-02-29")).hover({ force: true });
  await expect(page.locator("#tip")).toHaveText("Do, 29.02.2024 · 1 Einsatz10:00 b1 – Test");
  expect(page.errors).toEqual([]);
});

test("one year is one turn; without Großlagen their days count none and say so; a year without alarms shows no spiral", async ({ page }) => {
  await openSpiral(page);
  const counted = await pieces(page);
  // a past year runs to 31.12.
  await page.selectOption("#f-year", "2025");
  expect(await texts(page, "text.year-mark")).toEqual(["2025"]);
  expect((await texts(page, "text:not(.year-mark)")).slice(-2)).toEqual(["2025", "ein Jahr, eine Runde"]);
  const year = await pieces(page);
  expect([year[0].date, year.at(-1).date, year.length]).toEqual(["2025-01-01", "2025-12-31", 365]);
  expect(year.map(({ date, n, tip }) => [date, n, tip])).toEqual(counted.filter((p) => p.date.startsWith("2025")).map(({ date, n, tip }) => [date, n, tip]));
  await page.selectOption("#f-year", "2026");
  expect((await pieces(page)).at(-1).date).toBe("2026-08-05");
  // without Großlagen
  await page.selectOption("#f-year", "");
  await page.uncheck("#f-storm");
  const without = await pieces(page);
  const big = without.find((p) => p.date === "2026-07-10");
  expect(big.n).toBe(0);
  expect(big.tip).toBe("<b>Fr, 10.07.2026</b> · 0 Einsätze<br>Großlage mit 10 Einsätzen, nicht mitgezählt");
  expect(without.filter((p) => p.tip.includes("nicht mitgezählt")).map((p) => p.date)).toEqual(["2026-07-10"]);
  const others = (list) => list.filter((p) => p.date !== "2026-07-10");
  expect(others(without)).toEqual(others(counted));
  // with the Wachbesetzung: a turn for 2023 inside the others
  await page.check("#f-storm");
  await page.check("#f-standby");
  expect(await texts(page, "text.year-mark")).toEqual(["2023", "2024", "2025", "2026"]);
  expect((await pieces(page)).find((p) => p.date === "2023-05-05").n).toBe(1);
  // 2023 without it: nothing to draw
  await page.uncheck("#f-standby");
  await page.selectOption("#f-year", "2023");
  await expect(page.locator("#c-spiral")).toBeEmpty();
  await expect(page.locator("#spiral-note")).toBeEmpty();
  await page.check("#f-standby");
  expect(await texts(page, "text.year-mark")).toEqual(["2023"]);
  expect(page.errors).toEqual([]);
});

test("days the website doesn't list yet are paler and say so; a year that is over runs to 31.12.", async ({ page }) => {
  await openSpiral(page);
  const all = await pieces(page);
  const after = all.filter((p) => p.date > "2026-07-31");
  expect(after.map((p) => p.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"]);
  expect(all.filter((p) => p.cls === "day-seg unlisted")).toEqual(after);
  expect(all.filter((p) => p.tip.endsWith("<br>Noch nicht auf der Website"))).toEqual(after);
  expect([...new Set(after.map((p) => p.opacity))]).toEqual(["0.45"]);
  expect([...new Set(all.filter((p) => p.date <= "2026-07-31").map((p) => p.opacity))]).toEqual(["1"]);
  expect(after.at(-1).tip).toBe("<b>Mi, 05.08.2026</b> · 1 Einsatz<br>12:00 th1 – Testeintrag von Hand<br>Noch nicht auf der Website");
  // on Neujahr the spiral still ends with 2026, now up to its last day
  await page.clock.setSystemTime(new Date("2027-01-01T10:00:00+01:00"));
  await page.selectOption("#f-year", "2026");
  const year = await pieces(page);
  expect([year.at(-1).date, year.length, year.filter((p) => p.cls === "day-seg unlisted").length]).toEqual(["2026-12-31", 365, days("2026-08-01", "2026-12-31")]);
  await expect(page.locator("#spiral-note")).toHaveText(NOTE + PALER);
  expect(page.errors).toEqual([]);
});

test("without an entry by hand, the spiral ends with the website's newest alarm, and no day is paler", async ({ page }) => {
  await openSpiral(page, { hand: [] });
  const all = await pieces(page);
  expect([all.at(-1).date, all.filter((p) => p.cls !== "day-seg").length]).toEqual(["2026-07-31", 0]);
  await expect(page.locator("#spiral-note")).toHaveText(NOTE);
  expect(page.errors).toEqual([]);
});
