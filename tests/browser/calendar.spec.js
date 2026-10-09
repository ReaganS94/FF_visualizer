// The Kalender tab: a block per year, newest first, with a square for every day up to today, shaded by the day's
// alarms like the colour key below says.
import { readFileSync } from "node:fs";
import { test, expect, json, openSite } from "./fixtures.js";

const DATA = JSON.parse(readFileSync(new URL("../../web/public/data/alarms.json", import.meta.url), "utf8"));
const HAND = { time: "12:00", category: "Einsatz", keyword: "th1", event: "Testeintrag von Hand", street: "Teststraße",
  district: "Linden-Mitte", remarks: "" };
const newest = (rows) => rows.filter((r) => r.category === "Einsatz").reduce((m, r) => (r.date > m ? r.date : m), "");

// Every square of the Kalender in page order: its year's block (0 is the top one), its day ("2026-07-14"), its
// alarms and the rest of its tooltip, its classes, colour and opacity.
const squares = (page) => page.$$eval("#c-calendar svg", (svgs) => svgs.flatMap((svg, block) => [...svg.querySelectorAll(".cell")].map((c) => {
  const [, d, m, y, n] = c.dataset.tip.match(/^<b>(\d\d)\.(\d\d)\.(\d{4})<\/b> · ([\d.]+) /);
  const cs = getComputedStyle(c);
  return { block, date: `${y}-${m}-${d}`, n: Number(n.replace(".", "")), tip: c.dataset.tip, cls: c.getAttribute("class"), fill: cs.fill, opacity: cs.opacity };
})));

async function openCalendar(page) {
  await openSite(page);
  await page.click("nav button[data-view=calendar]");
}

test("has a square for every day of every year up to today, shaded like the colour key, and a block per chosen year", async ({ page }) => {
  await openCalendar(page);
  const years = (await page.$$eval("#f-year option", (o) => o.map((x) => x.value))).filter(Boolean); // newest first
  expect(years.length).toBeGreaterThan(1);
  await expect(page.locator("#c-calendar .year-label")).toHaveText(years);
  const all = await squares(page);
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  years.forEach((y, block) => {
    const days = all.filter((s) => s.block === block).map((s) => s.date);
    const last = y < today.slice(0, 4) ? `${y}-12-31` : today;
    expect([days[0], days.at(-1)]).toEqual([`${y}-01-01`, last]);
    expect(days.length).toBe((Date.parse(last) - Date.parse(`${y}-01-01`)) / 864e5 + 1);
    expect(days).toEqual([...new Set(days)].sort()); // each day once, in order
  });
  // the colour key's ranges ("0", "3–4", "10+") and their colours; each square has the colour of its count's range
  const key = await page.$$eval("#c-calendar .legend i", (is) => is.map((i) => [i.nextSibling.textContent.trim(), getComputedStyle(i).backgroundColor]));
  expect(key.map(([label]) => label)).toEqual(["0", "1", "2", "3–4", "5–9", "10+"]);
  const shade = (n) => key.find(([label]) => { const [lo, hi] = label.split(/[–+]/); return n >= Number(lo) && (label.endsWith("+") || n <= Number(hi || lo)); })[1];
  expect(all.filter((s) => s.fill !== shade(s.n)).map((s) => s.date)).toEqual([]);
  expect(new Set(all.map((s) => s.fill)).size).toBe(6); // every shade is used
  // a year shows only its block, the same as before
  await page.selectOption("#f-year", years[1]);
  await expect(page.locator("#c-calendar .year-label")).toHaveText([years[1]]);
  expect(await squares(page)).toEqual(all.filter((s) => s.block === 1).map((s) => ({ ...s, block: 0 })));
  expect(page.errors).toEqual([]);
});

test("without Großlagen, their days count none and say how many alarms they leave out", async ({ page }) => {
  await openCalendar(page);
  const counted = await squares(page);
  // Großlagen are days with 10 alarms or more, except 01.01. (Silvester, which counts like any other day)
  const big = counted.filter((s) => s.n >= 10 && !s.date.endsWith("-01-01"));
  expect(big.length).toBeGreaterThan(0);
  expect(counted.filter((s) => s.tip.includes("nicht mitgezählt")).map((s) => s.date)).toEqual([]);
  await page.uncheck("#f-storm");
  const without = await squares(page);
  expect(without.filter((s) => s.tip.includes("nicht mitgezählt")).map((s) => s.date)).toEqual(big.map((s) => s.date));
  for (const { date, n } of big) {
    const s = without.find((x) => x.date === date);
    expect(s.n).toBe(0);
    expect(s.tip).toContain(`<br>Großlage mit ${n} Einsätzen, nicht mitgezählt`);
  }
  // the other days are the same
  const others = (list) => list.filter((s) => !big.some((b) => b.date === s.date));
  expect(others(without)).toEqual(others(counted));
  expect(page.errors).toEqual([]);
});

test("shows the days after the website's newest alarm paler, says they aren't on it yet, and counts hand entries", async ({ page }) => {
  // the website's list without its last ten days, and an entry by hand on the last of them
  const last = newest(DATA.rows);
  const cut = new Date(Date.parse(last) - 10 * 864e5).toISOString().slice(0, 10);
  const rows = DATA.rows.filter((r) => r.date <= cut);
  const listed = newest(rows);
  await page.route("**/data/alarms.json", (r) => r.fulfill(json({ ...DATA, rows })));
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: [{ ...HAND, date: last }] })));
  await openCalendar(page);
  const all = await squares(page);
  const after = all.filter((s) => s.date > listed);
  expect(after.length).toBeGreaterThanOrEqual(10);
  expect(all.filter((s) => s.cls === "cell unlisted")).toEqual(after);
  expect(all.filter((s) => s.tip.endsWith("<br>Noch nicht auf der Website"))).toEqual(after);
  expect([...new Set(after.map((s) => s.opacity))]).toEqual(["0.45"]);
  expect([...new Set(all.filter((s) => s.date <= listed).map((s) => s.opacity))]).toEqual(["1"]);
  const hand = all.find((s) => s.date === last);
  expect(hand.n).toBe(1);
  await page.locator("#c-calendar .cell").nth(all.indexOf(hand)).hover();
  await expect(page.locator("#tip")).toHaveText(`${last.split("-").reverse().join(".")} · 1 Einsatz12:00 th1 – Testeintrag von HandNoch nicht auf der Website`);
  expect(page.errors).toEqual([]);
});
