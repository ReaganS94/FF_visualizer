// "Einsatz heute?": the ring with the estimate for the time of day we're in, today and tonight as tiles, yesterday's
// estimate against what happened, the next days from the weather forecast and how well the estimate did so far. The
// alarms are made up: from 01.07.2024 to 07.10.2026 one every Thursday at 10:15, one every third night at 23:30, one
// at 7:30 on 50 Mondays, one at 9:00 on every second Saturday of 2026, one more in the Silvesternacht 2024 and two in
// 2025, two around noon on the last day and a Wachbesetzung, which doesn't count. The weather too: summer 2025 with
// twelve hot days, and a forecast from 08.10.2026 on. The numbers the page should show come from lib/estimate.js,
// which has unit tests of its own; these tests check that the tab shows them, in the right place and at the right time.
import { test, expect, json, openSite } from "./fixtures.js";
import { isoDate, addDays } from "../../web/src/lib/dates.js";
import { alarmWindows, lastCovered, estimate, backtest, backtestGroups } from "../../web/src/lib/estimate.js";

const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const alarm = (date, time, keyword = "th1") =>
  ({ date, time, category: "Einsatz", keyword, event: "Test", street: "Teststraße", district: "Linden-Mitte", remarks: "" });
function rows() {
  const out = [];
  for (let d = new Date(2024, 6, 1), i = 0, mondays = 0, saturdays = 0; d <= new Date(2026, 9, 7); d.setDate(d.getDate() + 1), i++) {
    const date = day(d);
    if (d.getDay() === 4) out.push(alarm(date, "10:15"));
    if (d.getDay() === 1 && mondays++ < 50) out.push(alarm(date, "07:30"));
    if (d.getDay() === 6 && date >= "2026-01-01" && ++saturdays % 2 === 0) out.push(alarm(date, "09:00"));
    if (i % 3 === 0) out.push(alarm(date, "23:30", "b1"));
  }
  out.push(alarm("2024-12-31", "23:10", "b1"), alarm("2025-12-31", "23:45", "b1"), alarm("2026-01-01", "00:45", "b1"));
  out.push(alarm("2026-10-07", "12:00"), alarm("2026-10-07", "12:30"), alarm("2026-10-07", "14:00", "vs")); // and a Wachbesetzung
  return out.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}
const UPDATED = "2026-10-08T04:00:00+00:00";
// June to August 2025 with twelve days of 32 °C
const PAST = {};
for (let d = new Date(2025, 5, 1); d <= new Date(2025, 7, 31); d.setDate(d.getDate() + 1)) PAST[day(d)] = { tmax: 24, tmin: 14, rain: 0, gust: 20, code: 1 };
for (const date of ["2025-06-24", "2025-06-25", "2025-07-01", "2025-07-02", "2025-07-03", "2025-07-15", "2025-07-16", "2025-07-26", "2025-07-27",
  "2025-08-12", "2025-08-13", "2025-08-14"]) PAST[date].tmax = 32;
const w = (tmax, tmin, gust, code, rain = 0) => ({ tmax, tmin, rain, gust, code });
// from Thursday 08.10.2026: heat today, a storm with thunder tomorrow, thunder again on Saturday and Sunday, and every
// other symbol
const FORECAST = [w(33, 19, 30, 0), w(31, 18, 72.4, 95), w(24, 12, 40, 95), w(18, 9, 45, 96), w(12, 7, 50, 61, 4), w(2, -3, 30, 71, 2), w(8, 4, 20, 45)];
const forecast = (days) => Object.fromEntries(days.map((x, i) => [isoDate(addDays(new Date(2026, 9, 8), i)), x]));

async function openChance(page, time, { days = FORECAST, pause = true, keep = () => true } = {}) {
  await page.clock.install({ time: new Date(time) });
  await page.route("**/data/alarms.json", (r) => r.fulfill(json({ updated: UPDATED, rows: rows().filter(keep) })));
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: [] })));
  await page.route("**/data/weather.json", (r) => r.fulfill(json({ days: { ...PAST, ...forecast(days) } })));
  await openSite(page);
  if (pause) await page.clock.pauseAt(new Date(time).getTime() + 30000); // the hand moves a minute after the tab is first drawn
  await page.click("nav button[data-view=chance]");
}

// What lib/estimate.js says for the made-up data on `date` (a Date at midnight).
function expected(date) {
  const all = rows().map((r) => ({ date: r.date, hour: Number(r.time.slice(0, 2)), standby: r.keyword === "vs", timeUnknown: false }));
  const win = alarmWindows(all), first = new Date(2024, 6, 1), weather = { ...PAST, ...forecast(FORECAST) };
  const last = lastCovered(date, new Date(UPDATED), new Date(2026, 9, 7));
  return { win, first, last, est: estimate(date, first, last, win, weather), weather };
}
const pc = (p) => `~${Math.round(100 * p)} %`;
const TODAY = new Date(2026, 9, 8), YESTERDAY = new Date(2026, 9, 7);

// The ring: its description, the segments' shades and tooltips, where the hand points and the texts in the middle.
const ring = (page) => page.$eval("#chance-ring svg", (svg) => ({
  label: svg.getAttribute("aria-label"),
  shades: [...svg.querySelectorAll(".seg")].map((s) => s.getAttribute("fill").match(/\d/)[0]).join(""),
  tips: [...svg.querySelectorAll(".seg")].map((s) => s.dataset.tip),
  hand: ["x1", "y1", "x2", "y2"].map((a) => svg.querySelector(".hand").getAttribute(a)).join(" "),
  texts: [...svg.querySelectorAll("text")].map((t) => `${t.textContent}@${t.style.fontSize}`),
}));
const tiles = (page) => page.$$eval("#chance .tile", (ts) => ts.map((t) => `${t.className} | ${t.querySelector(".l").textContent} | ` +
  `${t.querySelector(".v").className} ${t.querySelector(".v").textContent} | ${t.querySelector(".d").textContent}`));
const table = (page, sel) => page.$$eval(`${sel} tbody tr`, (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent).join(" | ")));

test("at midday: the ring, today's tiles with the day as 'jetzt', yesterday and how it is worked out", async ({ page }) => {
  await openChance(page, "2026-10-08T12:00:00+02:00");
  const { est } = expected(TODAY), y = expected(YESTERDAY);
  await expect(page.locator("section[data-view=chance] .disclaimer")).toHaveText(/^Nur eine Schätzung\. Diese Zahlen werden aus vergangenen Einsätzen/);
  await expect(page.locator("#filters")).toBeHidden();
  const r = await ring(page);
  expect(r.label).toBe(`Einsätze je Uhrzeit. Heute tagsüber: ${pc(est.pDay)}`);
  // 23 Uhr (every third night) is the busiest hour, then 10 Uhr (every Thursday); 0 Uhr has the one after midnight
  expect(r.shades).toBe("000000000020000000000004");
  expect(r.tips[10]).toBe("10–11 Uhr: <b>118 Einsätze</b> seit 2024");
  expect(r.tips[7]).toBe("7–8 Uhr: <b>50 Einsätze</b> seit 2024");
  expect(r.tips[0]).toBe("0–1 Uhr: <b>1 Einsatz</b> seit 2024");
  expect(r.tips[23]).toBe("23–24 Uhr: <b>279 Einsätze</b> seit 2024");
  expect(r.hand).toBe("190.0 276.0 190.0 330.0"); // straight down at 12 Uhr
  expect(r.texts).toEqual(["00@11px", "06@11px", "12@11px", "18@11px", "jetzt@11px", "Heute tagsüber@12px", `${pc(est.pDay)}@34px`, `Nacht: ${pc(est.pNight)}@11px`]);
  await expect(page.locator("#ring-legend")).toHaveText("weniger  mehrTag 6–22 Uhr Nacht 22–6 UhrJedes Stück ist eine Stunde. Je dunkler, desto mehr Einsätze gab es seit 2024 zu dieser Uhrzeit.");
  // hot today: the day compares the past hot days as well
  expect(est.heat).toBe(true);
  expect(await tiles(page)).toEqual([
    `tile now | Heute tagsüber (6–22 Uhr) · jetzt | v ${pc(est.pDay)} | heute bis 33 °C angesagt: an ${est.hotDay} von 12 so heißen Tagen gab es mindestens einen Einsatz, an ${est.day} von ${est.n} Donnerstagen`,
    `tile | Heute Nacht (22–6 Uhr) | v ${pc(est.pNight)} | in ${est.night} von ${est.nights} bisherigen Nächten gab es mindestens einen Einsatz`,
  ]);
  // yesterday (a Wednesday) had two alarms by day besides the Wachbesetzung, and one at night
  expect(await table(page, "#t-yesterday")).toEqual([`Gestern tagsüber | ${pc(y.est.pDay)} | 2 Einsätze`, `Letzte Nacht | ${pc(y.est.pNight)} | 1 Einsatz`]);
  await expect(page.locator("#yesterday-listed")).toHaveText("Die Website hat bisher Einsätze bis gestern eingetragen. Einsätze nach Mitternacht fehlen in der letzten Zeile deshalb vielleicht noch.");
  await expect(page.locator("#chance-method")).toHaveText(/^So wird gerechnet: Für den Tag zählt, an wie vielen Donnerstagen vom 01\.07\.2024 bis 06\.10\.2026 zwischen 6 und 22 Uhr .* \(so, als kämen 10 durchschnittliche Tage dazu\)\. Sind 30 °C .*die Silvesternacht zählt nicht als vergleichbare Nacht\.$/);
  expect(page.errors).toEqual([]);
});

test("the hand moves every minute, and at 22 Uhr the night becomes 'jetzt'", async ({ page }) => {
  await openChance(page, "2026-10-08T21:58:30+02:00");
  const { est } = expected(TODAY);
  expect((await ring(page)).hand).toBe("146.4 115.9 118.9 69.4"); // 21:58
  expect((await ring(page)).label).toBe(`Einsätze je Uhrzeit. Heute tagsüber: ${pc(est.pDay)}`);
  expect((await tiles(page)).map((t) => t.split(" | ")[0])).toEqual(["tile now", "tile"]);
  const rest = () => page.$eval("section[data-view=chance]", (s) => s.innerHTML.replace(/<div id="chance-ring">.*?<\/svg><\/div>/, ""));
  const before = await rest();
  await page.clock.runFor(60000);
  expect((await ring(page)).hand).toBe("146.7 115.7 119.5 69.1"); // 21:59, and nothing else changed
  expect(await rest()).toBe(before);
  await page.clock.runFor(60000);
  const r = await ring(page);
  expect(r.hand).toBe("147.0 115.5 120.0 68.8"); // 22:00
  expect(r.label).toBe(`Einsätze je Uhrzeit. Heute Nacht: ${pc(est.pNight)}`);
  expect(r.texts.slice(5)).toEqual(["Heute Nacht@12px", `${pc(est.pNight)}@34px`]); // nothing more to come today
  expect((await tiles(page)).map((t) => t.split(" | ").slice(0, 2).join(" | "))).toEqual(["tile | Heute tagsüber (6–22 Uhr)", "tile now | Heute Nacht (22–6 Uhr) · jetzt"]);
  // the night's estimate is "jetzt" in the pictures too
  await expect(page.locator("#backtest-odds .odd.now .tag")).toHaveText(`jetzt ${pc(est.pNight)}`);
  expect(page.errors).toEqual([]);
});

test("before 6 Uhr it is still last night, and its alarms don't count yet", async ({ page }) => {
  await openChance(page, "2026-10-09T03:00:00+02:00");
  const t = expected(new Date(2026, 9, 9)), y = expected(TODAY);
  const r = await ring(page);
  expect(r.label).toBe(`Einsätze je Uhrzeit. Diese Nacht: ${pc(y.est.pNight)}`);
  expect(r.texts.slice(5)).toEqual(["Diese Nacht@12px", `${pc(y.est.pNight)}@34px`, `Tag: ${pc(t.est.pDay)}@11px`]);
  expect((await tiles(page)).map((x) => x.split(" | ")[0])).toEqual(["tile", "tile"]); // neither of today's windows has begun
  expect(await table(page, "#t-yesterday")).toEqual([`Gestern tagsüber | ${pc(y.est.pDay)} | keiner`, `Diese Nacht | ${pc(y.est.pNight)} | läuft noch`]);
  await expect(page.locator("#yesterday-listed")).toHaveText("Die Website hat bisher nur Einsätze bis 07.10.2026 eingetragen. Hier zählen deshalb nur vorläufige Einträge.");
  expect(page.errors).toEqual([]);
});

test("Silvester: the night is compared with the Silvesternacht before, not with other nights", async ({ page }) => {
  await openChance(page, "2026-12-31T23:00:00+01:00", { days: [] });
  const r = await ring(page);
  expect(r.label).toBe("Einsätze je Uhrzeit. Heute: Silvesternacht: bisher jedes Jahr");
  // no number: the words fill the middle instead
  expect(r.texts.slice(5)).toEqual(["Heute: Silvesternacht@12px", "bisher@16px", "jedes@16px", "Jahr@16px"]);
  expect((await tiles(page))[1]).toBe("tile now | Heute: Silvesternacht (22–6 Uhr) · jetzt | v word bisher jedes Jahr | in beiden bisherigen Silvesternächten gab es Einsätze (2024: 2, 2025: 2)");
  await expect(page.locator("#chance-method")).toHaveText(/^Die Silvesternacht wird nicht mit anderen Nächten verglichen, sondern nur mit derselben Nacht in den Vorjahren\. So wird gerechnet: Für den Tag zählt, an wie vielen Donnerstagen/);
  // no forecast for these days, and no picture is "jetzt"
  await expect(page.locator("#outlook")).toBeHidden();
  await expect(page.locator("#backtest-odds .tag")).toHaveCount(0);
  expect(page.errors).toEqual([]);
});

test("Silvester after a quiet one: how many of the earlier Silvesternächte had alarms", async ({ page }) => {
  await openChance(page, "2026-12-31T23:00:00+01:00", { days: [], keep: (r) => !(r.date === "2024-12-31" && r.time >= "22:00") && !(r.date === "2025-01-01" && r.time < "06:00") });
  expect((await ring(page)).label).toBe("Einsätze je Uhrzeit. Heute: Silvesternacht: 1 von 2");
  expect((await tiles(page))[1]).toBe("tile now | Heute: Silvesternacht (22–6 Uhr) · jetzt | v 1 von 2 | in 1 von 2 bisherigen Silvesternächten gab es Einsätze (2024: 0, 2025: 2)");
  expect(page.errors).toEqual([]);
});

test("the next 7 days: notes on heat, storm and thunder, a column per day, and a tooltip with the day's estimate", async ({ page }) => {
  await openChance(page, "2026-10-08T12:00:00+02:00");
  const e = expected(TODAY);
  await expect(page.locator("#outlook-title")).toHaveText("Die nächsten 7 Tage");
  await expect(page.locator("#outlook-notes .wx-note.hot")).toHaveText(/^Hitze angesagt: heute bis 33\u00a0°C, morgen bis 31\u00a0°C\. An bisherigen Tagen ab 30\u00a0°C gab es tagsüber an \d+ von 12 mindestens einen Einsatz \(\d+\u00a0%\), an den anderen Tagen in \d+\u00a0%\. Die Schätzung für diese Tage ist deshalb höher\.$/);
  await expect(page.locator("#outlook-notes .wx-note.storm")).toHaveText("Sturmböen angesagt: morgen bis 72 km/h. Gewitter angesagt: morgen. Gewitter möglich: Samstag, Sonntag. " +
    "In die Schätzung geht nur die Temperatur ein.");
  const chart = await page.$eval("#outlook-chart svg", (svg) => ({
    width: svg.getAttribute("width"), box: svg.parentElement.clientWidth,
    cols: [...svg.querySelectorAll(".wx-col")].map((g) => `${g.getAttribute("class")} ${[...g.querySelectorAll("text")].map((t) => t.textContent).join(" ")}`),
    icons: [...svg.querySelectorAll(".wx-icon")].map((g) => `${g.getAttribute("class")}: ${[...g.querySelectorAll("[class]")].map((x) => x.getAttribute("class")).join(",")}`),
    tmax: [...svg.querySelectorAll(".wx-tmaxlabel")].map((t) => t.getAttribute("class").replace("wx-tmaxlabel", "") + t.textContent).join(" "),
    tmin: [...svg.querySelectorAll(".wx-tminlabel")].map((t) => t.textContent).join(" "),
    gusts: [...svg.querySelectorAll(".wx-gust")].map((t) => t.getAttribute("class").replace("wx-gust", "") + t.textContent).join(" "),
    pct: [...svg.querySelectorAll(".wx-pct")].map((t) => t.textContent).join(" "),
    shades: [...svg.querySelectorAll("circle[stroke^='var(--heat']")].map((c) => c.getAttribute("stroke").match(/\d/)[0]).join(""),
    heat: svg.querySelector(".wx-heatlabel")?.textContent, mask: svg.querySelector(".wx-fc").getAttribute("mask"),
  }));
  expect(chart.width).toBe(String(chart.box));
  expect(chart.cols).toEqual(["wx-col hot now Heute 08.10.", "wx-col hot storm Morgen 09.10.", "wx-col storm Samstag 10.10.", "wx-col storm Sonntag 11.10.",
    "wx-col  Montag 12.10.", "wx-col  Dienstag 13.10.", "wx-col  Mittwoch 14.10."]);
  expect(chart.icons).toEqual(["wx-icon hot: wx-sun", "wx-icon hot: wx-cloud dark,wx-bolt", "wx-icon: wx-cloud dark,wx-bolt", "wx-icon: wx-cloud dark,wx-bolt",
    "wx-icon: wx-cloud,wx-rain", "wx-icon: wx-cloud,wx-snow", "wx-icon: wx-fog"]);
  expect(chart.tmax).toBe(" hot33°  hot31° 24° 18° 12° 2° 8°");
  expect(chart.tmin).toBe("19° 18° 12° 9° 7° -3° 4°");
  expect(chart.gusts).toBe("30  storm72 40 45 50 30 20");
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => (i ? estimate(addDays(TODAY, i), e.first, e.last, e.win, e.weather) : e.est));
  expect(chart.pct).toBe(days.map((d) => `${Math.round(100 * d.pDay)}%`).join(" "));
  expect(chart.shades).toBe(days.map((d) => (d.pDay < 0.15 ? 1 : d.pDay < 0.25 ? 2 : d.pDay < 0.4 ? 3 : 4)).join(""));
  expect(chart.heat).toBe("30\u00a0°C");
  expect(chart.mask).toBe("url(#wx-mask)");
  await page.locator("#outlook-chart .wx-hit").nth(1).hover();
  await expect(page.locator("#tip")).toBeVisible();
  expect(await page.locator("#tip").innerHTML()).toBe(`<b>Freitag, 09.10.2026</b><br>Gewitter · 18 bis 31&nbsp;°C · Böen bis 72 km/h<br>Sturmböen<br>Gewitter angesagt` +
    `<br>Schätzung tagsüber: <b>~${Math.round(100 * days[1].pDay)}&nbsp;%</b><br>an ${days[1].hotDay} von 12 Tagen ab 30&nbsp;°C und an ${days[1].day} von ${days[1].n} Freitagen gab es mindestens einen Einsatz`);
  await expect(page.locator("#outlook-legend > span")).toHaveText(["Windböen in km/h", "Schätzung: mindestens ein Einsatz tagsüber", "ab 30 °C", "Sturmböen ab 60 km/h oder Gewitter"]);
  await expect(page.locator("#outlook-note")).toHaveText("Wettervorhersage für Hannover (Daten: Open-Meteo). Je weiter ein Tag weg ist, desto blasser: " +
    "Temperaturen stimmen meist für etwa fünf Tage, Sturm und Gewitter nur für ein bis zwei Tage.");
  expect(page.errors).toEqual([]);
});

test("a calm week, and a new width: the chart is drawn again for the width it has", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChance(page, "2026-10-08T12:00:00+02:00", { days: [w(14, 6, 30, 3), w(13, 5, 28, 2), w(15, 7, 33, 1), w(12, 4, 31, 0), w(11, 3, 29, 3), w(10, 2, 27, 61, 1), w(9, 1, 25, 3)], pause: false });
  await expect(page.locator("#outlook-title")).toHaveText("Die nächsten 7 Tage");
  await expect(page.locator("#outlook-notes")).toHaveText("In diesen Tagen sind weder 30 °C noch Sturmböen oder Gewitter angesagt.");
  // clouds, sun and cloud, sun, and rain
  expect(await page.$$eval("#outlook-chart .wx-icon", (gs) => gs.map((g) => [...g.querySelectorAll("[class]")].map((x) => x.getAttribute("class")).join(","))))
    .toEqual(["wx-cloud", "wx-sun,wx-cloud", "wx-sun,wx-cloud", "wx-sun", "wx-cloud", "wx-cloud,wx-rain", "wx-cloud"]);
  const svg = () => page.$eval("#outlook-chart svg", (s) => `${s.getAttribute("width")}/${s.parentElement.clientWidth} ${s.querySelector(".wx-heatline") ? "heat" : "no heat"} ` +
    `${s.querySelector(".wx-fc").getAttribute("mask")} ${[...s.querySelectorAll(".wx-day")].map((t) => `${t.textContent}@${t.style.fontSize}`).join(" ")}`);
  expect(await svg()).toMatch(/^(\d+)\/\1 no heat url\(#wx-mask\) Heute@12px Morgen@12px Sa@12px So@12px Mo@12px Di@12px Mi@12px$/);
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.setViewportSize({ width: 700, height: 844 }); // just wide enough for the long names
  await expect.poll(svg).toMatch(/^(\d+)\/\1 no heat url\(#wx-mask\) Heute@13px Morgen@13px Samstag@13px Sonntag@13px Montag@13px Dienstag@13px Mittwoch@13px$/);
  await page.setViewportSize({ width: 1000, height: 844 });
  await expect.poll(svg).toMatch(/^(\d+)\/\1 no heat url\(#wx-mask\) Heute@13px Morgen@13px Samstag@13px Sonntag@13px Montag@13px Dienstag@13px Mittwoch@13px$/);
  // a new width while another tab shows: the chart follows once the tab is back
  await page.click("nav button[data-view=list]");
  await page.setViewportSize({ width: 600, height: 844 });
  await page.waitForTimeout(300); // a new width redraws after 150 ms
  await page.click("nav button[data-view=chance]");
  expect(await svg()).toMatch(/^(\d+)\/\1 /);
  expect(await page.$eval("#outlook-chart svg", (s) => Number(s.getAttribute("width")))).toBeLessThan(600);
  expect(page.errors).toEqual([]);
});

test("a single day of forecast: the weather today, with its range as a line", async ({ page }) => {
  await openChance(page, "2026-10-08T12:00:00+02:00", { days: [w(26, 14, 61, 95)] });
  await expect(page.locator("#outlook-title")).toHaveText("Das Wetter heute");
  await expect(page.locator("#outlook-notes .wx-note.storm")).toHaveText("Sturmböen angesagt: heute bis 61 km/h. Gewitter angesagt: heute. In die Schätzung geht nur die Temperatur ein.");
  const s = await page.$eval("#outlook-chart svg", (svg) => ({
    mask: svg.querySelector(".wx-fc").getAttribute("mask"), fade: !!svg.querySelector("#wx-fade"), band: !!svg.querySelector(".wx-band"),
    line: svg.querySelector("line.wx-tmax") && ["x1", "x2"].map((a) => svg.querySelector("line.wx-tmax").getAttribute(a)).join(" "), heat: !!svg.querySelector(".wx-heatline"),
  }));
  expect(s).toEqual({ mask: null, fade: false, band: false, line: s.line, heat: true });
  expect(s.line).toMatch(/^([\d.]+) \1$/);
  expect(page.errors).toEqual([]);
});

test("how well the estimate did: a picture per group with 'jetzt' on today's, and the exact numbers folded away", async ({ page }) => {
  await openChance(page, "2026-10-08T12:00:00+02:00");
  const e = expected(TODAY), bt = backtest(e.first, e.last, e.win, e.weather), groups = backtestGroups(bt);
  const num = (x) => x.toLocaleString("de-DE");
  await expect(page.locator("#backtest-note")).toHaveText(`Für jeden Tag und jede Nacht ab 30.12.2024 wurde nachgerechnet, was die Schätzung damals gesagt hätte, ` +
    `und nachgesehen, ob es dann wirklich einen Einsatz gab (${num(bt.n)} Schätzungen). Jedes Bild zeigt das umgerechnet auf 100 solche Tage oder Nächte.`);
  const now = Math.round(100 * e.est.pDay);
  const shown = groups.filter((g) => g.n >= 50 || (now >= g.lo && now < g.hi));
  // the Saturdays of 2026 make a group too small for a picture of its own
  expect(groups.map((g) => g.n < 50)).toEqual([false, true, false]);
  expect(shown).toHaveLength(2);
  const odds = await page.$$eval("#backtest-odds figure", (fs) => fs.map((f) => ({
    cls: f.className, caption: f.querySelector("figcaption").textContent, on: f.querySelectorAll("circle.on").length, dots: f.querySelectorAll("circle").length,
    label: f.querySelector("svg").getAttribute("aria-label"), v: f.querySelector(".odd-v").textContent, d: f.querySelector(".odd-d").textContent, tip: f.dataset.tip,
  })));
  expect(odds).toEqual(shown.map((g) => {
    const isNow = now >= g.lo && now < g.hi;
    return {
      cls: isNow ? "odd now" : "odd", caption: `Die Schätzung sagte${g.label}${isNow ? `jetzt ~${now} %` : "jetzt"}`, on: g.rate, dots: 100, label: `${g.rate} von 100`,
      v: `${g.rate} von 100`, d: `hatten einen Einsatz${num(g.n)} Schätzungen${g.n < 50 ? ", noch zu wenige" : ""}`,
      tip: `Die Schätzung sagte ${g.label}: bei ${num(g.hit)} von ${num(g.n)} Schätzungen gab es wirklich einen Einsatz (${g.rate} %).`,
    };
  }));
  await expect(page.locator("#backtest-verdict")).toHaveText(/Die meisten Schätzungen \([\d.]+ von [\d.]+\) lagen bei (unter 10|10–30|ab 30)\u00a0%\.$/);
  await expect(page.locator("#t-backtest")).toBeHidden();
  await page.click("details.more summary");
  const fit = (b, rate) => (b.n < 50 ? "Zu wenige Fälle" : rate < b.lo ? "Nein, zu hoch" : b.hi <= 100 && rate > b.hi ? "Nein, zu niedrig" : "Ja");
  expect(await table(page, "#t-backtest")).toEqual(bt.bins.map((b) => {
    const rate = Math.round((100 * b.hit) / b.n);
    return `${b.hi > 100 ? `ab ${b.lo} %` : `${b.lo}–${b.hi} %`} | ${num(b.n)}-mal | ${num(b.hit)} von ${num(b.n)} (${rate} %) | ${fit(b, rate)}`;
  }));
  await expect(page.locator("#backtest-example")).toHaveText(/^So liest man eine Zeile: [\d.]+-mal sagte die Schätzung .* das sind \d+ %\. Das /);
  expect(page.errors).toEqual([]);
});
