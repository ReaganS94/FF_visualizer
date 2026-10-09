// The Wetter tab: the average alarms per day for ranges of gusts, rain and the day's highest temperature. The weather
// is made up: calm on every day, apart from a few days at the edges of the ranges and a few stormy days that must not
// count (before the first alarm, Silvester, Neujahr, the website's newest day and after it). Each day's alarms are
// read from the Kalender's tooltips, so the numbers are checked against another tab.
import { readFileSync } from "node:fs";
import { devices } from "@playwright/test";
import { test, expect, json, openSite, device } from "./fixtures.js";

const DATA = JSON.parse(readFileSync(new URL("../../web/public/data/alarms.json", import.meta.url), "utf8"));
const einsatz = DATA.rows.filter((r) => r.category === "Einsatz");
const LAST = einsatz.reduce((m, r) => (r.date > m ? r.date : m), ""); // the website's newest day
// the first alarm that isn't a standby ("vs", only counted with "Wachbesetzungen mitzählen")
const FIRST = einsatz.filter((r) => r.keyword.split("/")[0].trim().toLowerCase() !== "vs").reduce((m, r) => (r.date < m ? r.date : m), LAST);
const plus = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);

// The days each range should hold, beyond the calm days, which go to the range in CALM. 10.07.2024 is a Großlage;
// 05.07.2025 and 29.05.2026 also had a Wachbesetzung.
const EXPECT = [
  { "40–60 km/h": ["2024-03-29"], "60–80 km/h": ["2025-02-09", "2024-07-10"], "ab 80 km/h": ["2025-07-05", "2026-05-29"] },
  { "bis 5 mm": ["2024-06-15"], "5–20 mm": ["2025-05-21"], "ab 20 mm": ["2024-09-22"] },
  { "unter 0 °C": ["2026-02-05"], "0–10 °C": ["2026-02-07"], "20–30 °C": ["2025-10-18"], "ab 30 °C": ["2026-07-09"] },
];
const CALM = ["unter 40 km/h", "trocken", "10–20 °C"];
const SPECIAL = {
  "2024-03-29": { gust: 40 }, "2025-02-09": { gust: 60 }, "2024-07-10": { gust: 70 }, "2025-07-05": { gust: 85 }, "2026-05-29": { gust: 85 },
  "2024-06-15": { rain: 0.1 }, "2025-05-21": { rain: 5 }, "2024-09-22": { rain: 20 },
  "2026-02-05": { tmax: -0.5 }, "2026-02-07": { tmax: 0 }, "2025-10-18": { tmax: 20 }, "2026-07-09": { tmax: 30 },
  "2023-12-30": { gust: 90 }, "2024-12-31": { gust: 90 }, "2025-01-01": { gust: 90 }, [LAST]: { gust: 90 }, [plus(LAST, 2)]: { gust: 90 },
};
const WEATHER = {};
for (let d = "2023-12-28"; d <= plus(LAST, 6); d = plus(d, 1)) WEATHER[d] = { tmax: 15, tmin: 5, rain: 0, gust: 20, code: 3, ...SPECIAL[d] };

// A chart's rows from its bars: the range, its days, alarms and average from the tooltip, and the label and the
// number beside the bar.
const chart = (page, i) => page.$eval(`#c-weather-${i} svg`, (svg) => [...svg.querySelectorAll(".hit")].map((hit, k) => {
  const [, label, days, alarms, avg] = hit.dataset.tip.match(/^<b>(.+)<\/b><br>(\d+) Tage?, ([\d.]+) Eins(?:atz|ätze)<br>Ø (\d+,\d\d) pro Tag$/);
  return { label, days: Number(days), alarms: Number(alarms.replace(".", "")), avg,
    name: svg.querySelectorAll("text.lbl")[k].textContent, shown: svg.querySelectorAll("text:not(.lbl)")[k].textContent };
}));
// The alarms per day from the Kalender's tooltips ("<b>05.07.2025</b> · 2 Einsätze …"), or the Großlage days it leaves out.
const kalender = (page) => page.$$eval("#c-calendar .cell", (cells) => cells.map((c) => {
  const [, dd, mm, yyyy, n] = c.dataset.tip.match(/^<b>(\d\d)\.(\d\d)\.(\d{4})<\/b> · ([\d.]+) Eins(?:atz|ätze)/);
  return [`${yyyy}-${mm}-${dd}`, Number(n.replace(".", "")), c.dataset.tip.includes("nicht mitgezählt")];
}));

// Compares every chart with the days that should count: from the first alarm to the day before the website's newest,
// in the chosen year, without Silvester, Neujahr and the dropped Großlage days.
async function check(page, perDay, { year = "", dropped = [] } = {}) {
  const days = Object.keys(WEATHER).filter((d) => d >= FIRST && d < LAST && d.startsWith(year) && !/-(12-31|01-01)$/.test(d) && !dropped.includes(d));
  for (const [i, special] of EXPECT.entries()) {
    const inChart = Object.values(special).flat();
    for (const row of await chart(page, i)) {
      const ds = row.label === CALM[i] ? days.filter((d) => !inChart.includes(d)) : (special[row.label] || []).filter((d) => days.includes(d));
      const n = ds.reduce((s, d) => s + perDay[d], 0);
      const avg = (ds.length ? n / ds.length : 0).toFixed(2).replace(".", ",");
      expect(row).toEqual({ label: row.label, days: ds.length, alarms: n, avg, name: row.label, shown: ds.length ? avg : "keine Tage" });
    }
  }
}

test.beforeEach(async ({ page }) => {
  await page.route("**/data/weather.json", (r) => r.fulfill(json({ days: WEATHER })));
});

test("counts each day in the range its weather falls in, with the Kalender's alarms of that day", async ({ page }) => {
  await openSite(page);
  await page.click("nav button[data-view=weather]");
  const perDay = Object.fromEntries((await kalender(page)).map(([d, n]) => [d, n]));
  expect((await chart(page, 0)).map((r) => r.label)).toEqual(["unter 40 km/h", "40–60 km/h", "60–80 km/h", "ab 80 km/h"]);
  await check(page, perDay);
  // a year: only its days, and a range without any says so
  await page.selectOption("#f-year", "2025");
  await check(page, perDay, { year: "2025" });
  expect((await chart(page, 1)).find((r) => r.label === "ab 20 mm").shown).toBe("keine Tage");
  // Großlagen left out: their days don't count at all, rather than as days without alarms
  await page.selectOption("#f-year", "");
  await page.setChecked("#f-storm", false);
  const dropped = (await kalender(page)).filter(([, , big]) => big).map(([d]) => d);
  expect(dropped).toContain("2024-07-10");
  await check(page, perDay, { dropped });
  // Wachbesetzungen never count here
  await page.setChecked("#f-storm", true);
  await page.setChecked("#f-standby", true);
  await check(page, perDay);
  expect(page.errors).toEqual([]);
});

test("says when there is no weather data yet", async ({ page }) => {
  await page.route("**/data/weather.json", (r) => r.fulfill(json({ days: {} })));
  await openSite(page);
  await page.click("nav button[data-view=weather]");
  await expect(page.locator("#c-weather")).toHaveText("Die Wetterdaten erscheinen nach der nächsten täglichen Aktualisierung.");
  await page.selectOption("#f-year", "2025");
  await expect(page.locator("#c-weather .note")).toHaveCount(1);
  expect(page.errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(device(devices["Pixel 7"]));

  test("names each range's days beside it, since the tooltips need a mouse", async ({ page }) => {
    await openSite(page);
    await page.click("nav button[data-view=weather]");
    await page.selectOption("#f-year", "2025");
    for (const i of [0, 1, 2]) {
      for (const row of await chart(page, i)) expect(row.name).toBe(row.days ? `${row.label} · ${row.days} ${row.days === 1 ? "Tag" : "Tage"}` : row.label);
    }
    expect((await chart(page, 0)).find((r) => r.label === "40–60 km/h")).toMatchObject({ days: 0, name: "40–60 km/h", shown: "keine Tage" });
    expect(page.errors).toEqual([]);
  });
});
