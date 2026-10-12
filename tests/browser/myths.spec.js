// The Mythen-Check: a card per myth with its verdict, a sentence, what was counted, and a picture of the myth days'
// average against what similar days give by chance. The alarms are made up so the results are known: 2023 to 2025
// with one alarm on every weekday, two on Saturdays and Sundays, a dozen on each Neujahr, a Großlage and a
// Wachbesetzung, plus made-up school holidays, home games and hot days.
import { test, expect, json, openSite } from "./fixtures.js";

const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const alarm = (date, time, keyword = "th1") =>
  ({ date, time, category: "Einsatz", keyword, event: "Test", street: "Teststraße", district: "Linden-Mitte", remarks: "" });
function rows() {
  const out = [];
  for (let d = new Date(2023, 0, 1); d <= new Date(2025, 11, 31); d.setDate(d.getDate() + 1)) {
    const date = day(d), wd = d.getDay();
    const n = date.endsWith("-01-01") ? 12 : date === "2025-07-14" ? 10 : wd === 0 || wd === 6 ? 2 : 1; // 14.07.2025: a Großlage
    for (let k = 0; k < n; k++) out.push(alarm(date, `${pad(8 + k)}:00`));
    if (date === "2025-03-05") out.push(alarm(date, "19:00", "vs")); // a Wachbesetzung, which doesn't count
  }
  out.push(alarm("2026-01-01", "00:30", "b1")); // the website's newest alarm: the days up to the 31.12. count
  return out.reverse();
}
const FERIEN = { ranges: [["2025-07-03", "2025-08-13"]] };
const GAMES = { seasons: { 2025: ["2025-08-23", "2025-09-13"] } };
// June to August 2025, with twelve days of 32 °C
const WEATHER = { days: {} };
for (let d = new Date(2025, 5, 1); d <= new Date(2025, 7, 31); d.setDate(d.getDate() + 1)) WEATHER.days[day(d)] = { tmax: 24, tmin: 14, rain: 0, gust: 20, code: 1 };
for (const date of ["2025-06-24", "2025-06-25", "2025-07-01", "2025-07-02", "2025-07-03", "2025-07-15", "2025-07-16", "2025-07-26", "2025-07-27",
  "2025-08-12", "2025-08-13", "2025-08-14"]) WEATHER.days[date].tmax = 32;

async function openSiteWith(page, { extras = true } = {}) {
  await page.clock.install({ time: new Date("2026-01-02T12:00:00+01:00") });
  await page.route("**/data/alarms.json", (r) => r.fulfill(json({ updated: "2026-01-02T06:00:00+00:00", rows: rows() })));
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: [] })));
  for (const [file, body] of [["ferien", FERIEN], ["heimspiele", GAMES], ["weather", WEATHER]]) {
    await page.route(`**/data/${file}.json`, (r) => (extras ? r.fulfill(json(body)) : r.fulfill({ status: 404, body: "" })));
  }
  await openSite(page);
}

// Each card as it reads: its classes, title, verdict, picture, sentence and what was counted. The positions come
// from the style, which says the same however the page wrote it.
const cards = (page) => page.$$eval("#c-myths .myth", (cs) => cs.map((c) => {
  const pos = (sel) => { const s = c.querySelector(sel).style; return s.width ? `${s.left} ${s.width}` : s.left; };
  return {
    cls: c.className, title: c.querySelector("h3").textContent, verdict: c.querySelector(".verdict").textContent,
    label: c.querySelector(".myth-strip").getAttribute("aria-label"),
    band: pos(".myth-band"), base: pos(".myth-base"), dot: pos(".myth-dot"),
    axis: [...c.querySelectorAll(".myth-axis span")].map((s) => `${s.textContent} at ${s.style.left}`),
    legend: [...c.querySelectorAll(".myth-legend li")].map((li) => li.textContent),
    sentence: c.querySelector("header ~ p:not(.myth-about)").textContent, about: c.querySelector(".myth-about").textContent,
  };
}));
const TITLES = ["Bei Vollmond ist mehr los.", "Am Freitag, dem 13., ist mehr los.", "An Feiertagen ist mehr los.", "In den Ferien ist mehr los.",
  "Wenn 96 zu Hause spielt, ist mehr los.", "Bei Hitze gibt es mehr Einsätze.", "Am Wochenende ist mehr los.", "Silvester ist die Nacht des Jahres."];
const NOTE = "Gezählt werden 1.095 Tage vom 01.01.2023 bis 31.12.2025, ohne Großlagen und ohne Wachbesetzungen.";

test("nothing is worked out before the tab opens; then a card per myth with its verdict", async ({ page }) => {
  await openSiteWith(page);
  expect(await page.$$eval("section[data-view=myths] .myth", (cs) => cs.length)).toBe(0);
  expect(await page.evaluate(() => document.querySelector("#myths-note")?.textContent || "")).toBe("");
  await page.click("nav button[data-view=myths]");
  await expect(page.locator("section[data-view=myths] > p.note").first()).toHaveText(/^Stimmt es, dass bei Vollmond mehr los ist\? .* steckt wohl mehr dahinter als Zufall\.$/);
  await expect(page.locator("#myths-note")).toHaveText(NOTE);
  await expect(page.locator("#filters")).toBeHidden();
  const all = await cards(page);
  expect(all.map((c) => c.title)).toEqual(TITLES);
  expect(all.map((c) => [c.cls, c.verdict])).toEqual([["myth none", "Kein Unterschied"], ["myth few", "Zu wenige Tage"], ["myth none", "Kein Unterschied"],
    ["myth none", "Kein Unterschied"], ["myth few", "Zu wenige Tage"], ["myth none", "Kein Unterschied"], ["myth yes", "Stimmt"], ["myth yes", "Stimmt"]]);
  // what was counted: the days of each myth (the Großlage on 14.07.2025 falls in the school holidays)
  expect(all.map((c) => c.about)).toEqual([
    "111 Tage: jeweils der Tag mit Vollmond und die Tage davor und danach, dann ist der Mond fast voll.",
    "Bisher gab es erst 5 solche Tage: 13.01.2023 (1 Einsatz), 13.10.2023 (1 Einsatz), 13.09.2024 (1 Einsatz), 13.12.2024 (1 Einsatz), 13.06.2025 (1 Einsatz).",
    "27 gesetzliche Feiertage in Niedersachsen. Neujahr zählt bei Silvester.",
    "41 Tage Schulferien in Niedersachsen, die Wochenenden in den Ferien eingeschlossen.",
    "2 Heimspiele von Hannover 96 in der Liga. Das Stadion liegt nah an Linden.",
    "12 Tage mit mindestens 30 °C in Hannover (Daten: Open-Meteo).",
    "312 Samstage und Sonntage, verglichen mit Montag bis Freitag in derselben Jahreszeit.",
    "Zum Vergleich, weil es jeder weiß: So sieht ein echter Unterschied aus. Gezählt wird der 01.01., weil die Silvester-Einsätze meist nach " +
      "Mitternacht liegen: 01.01.2023 (12 Einsätze), 01.01.2024 (12 Einsätze), 01.01.2025 (12 Einsätze).",
  ]);
  expect(page.errors).toEqual([]);
});

test("each picture shows its numbers: the dot, the band chance gives and the line at its average, on an axis to a round number", async ({ page }) => {
  await openSiteWith(page);
  await page.click("nav button[data-view=myths]");
  const all = await cards(page);
  // Weekends had two alarms a day, every weekday one: chance can't come near, so the band is a line at 1.
  expect(all[6]).toMatchObject({
    label: "Samstage und Sonntage: 2,00 pro Tag. Werktage: zufällig 1,00 bis 1,00.",
    band: "20% calc(0% + 2px)", base: "20%", dot: "40%", axis: ["0 at 0%", "2,5 at 50%", "5 at 100%"],
    legend: ["Samstage und Sonntage: 2,00 Einsätze pro Tag", "Werktage: 1,00, durch Zufall zwischen 1,00 und 1,00"],
    sentence: "Am Wochenende gab es 2,0-mal so viele Einsätze wie an Werktagen. Wählt man ebenso viele zufällige Werktage, kommen sie in " +
      "keinem von 100 Versuchen auf mindestens so viele Einsätze. Da steckt also mehr dahinter als Zufall.",
  });
  expect(all[1].sentence).toBe("An Freitagen, dem 13., gab es etwa gleich viele Einsätze wie an anderen Freitagen. Wählt man ebenso viele zufällige " +
    "andere Freitage, kommen sie in 100 von 100 Versuchen auf mindestens so viele Einsätze. Bei nur 5 Tagen reicht das nicht für eine Aussage.");
  expect(all[7].legend[0]).toBe("Neujahrstage: 12,00 Einsätze pro Tag");
  expect(all[7].dot).toBe("60%");
  // every axis ends at the first round number 10 % above the dot and the band, with its middle marked
  expect(all.map((c) => c.axis.map((a) => a.split(" at ")[0]).join(" "))).toEqual(["0 1 2", "0 1 2", "0 1 2", "0 1 2", "0 2,5 5", "0 1 2", "0 2,5 5", "0 10 20"]);
  for (const c of all) {
    expect(c.axis.map((a) => a.split(" at ")[1])).toEqual(["0%", "50%", "100%"]);
    // the numbers in the legend, and the same in the picture's description
    const [, avg] = c.legend[0].match(/: ([\d,]+) Einsätze pro Tag$/), [, base, lo, hi] = c.legend[1].match(/: ([\d,]+), durch Zufall zwischen ([\d,]+) und ([\d,]+)$/);
    expect(c.label).toBe(`${c.legend[0].split(": ")[0]}: ${avg} pro Tag. ${c.legend[1].split(": ")[0]}: zufällig ${lo} bis ${hi}.`);
    // each mark where its number lies on the axis (the legend rounds to two places)
    const max = Number(c.axis[2].split(" at ")[0].replace(",", ".")), at = (v) => (100 * Number(v.replace(",", "."))) / max;
    const near = (pos, want) => expect(Math.abs(parseFloat(pos) - want), `${c.title} ${pos} ${want}`).toBeLessThanOrEqual(50 / max / 100 + 0.006);
    near(c.dot, at(avg));
    near(c.base, at(base));
    near(c.band, at(lo));
    near(c.band.match(/calc\(([\d.]+)% \+ 2px\)/)[1], at(hi) - at(lo));
  }
  expect(page.errors).toEqual([]);
});

test("the cards stay as they are after other tabs, the filters and a new window width", async ({ page }) => {
  await openSiteWith(page);
  await page.click("nav button[data-view=myths]");
  const shown = await page.locator("section[data-view=myths]").innerHTML();
  await page.click("nav button[data-view=list]");
  await page.selectOption("#f-year", "2024");
  await page.setChecked("#f-standby", true);
  await page.setChecked("#f-storm", false);
  await page.setViewportSize({ width: 600, height: 900 });
  await page.click("nav button[data-view=myths]");
  await page.waitForTimeout(300); // a new width redraws after 150 ms
  expect(await page.locator("section[data-view=myths]").innerHTML()).toBe(shown);
  await expect(page.locator("#myths-note")).toHaveText(NOTE);
  expect(page.errors).toEqual([]);
});

test("without school holidays, home games and weather, their myths are left out", async ({ page }) => {
  await openSiteWith(page, { extras: false });
  await page.click("nav button[data-view=myths]");
  expect((await cards(page)).map((c) => c.title)).toEqual([TITLES[0], TITLES[1], TITLES[2], TITLES[6], TITLES[7]]);
  await expect(page.locator("#myths-note")).toHaveText(NOTE);
  expect(page.errors).toEqual([]);
});

test("a myth question in the quiz shows the same picture as the myth's card", async ({ page }) => {
  await page.addInitScript(() => { // the same questions on every run
    let a = 3;
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await openSiteWith(page);
  await page.click("nav button[data-view=quiz]");
  // answer until a question asks about a myth
  const title = await page.evaluate(() => {
    const card = document.querySelector("#quiz-card");
    for (let k = 0; k < 200; k++) {
      if (card.querySelector("[data-quiz=start]")) { card.querySelector("[data-quiz=start]").click(); continue; }
      const myth = card.querySelector(".quiz-q").textContent.match(/^Stimmt das\? „(.*)“$/);
      if (myth) { card.querySelector("[data-quiz=pick]").click(); return myth[1]; }
      (card.querySelector("[data-quiz=pick]") || card.querySelector("[data-quiz=answer]")).click();
      card.querySelector("[data-quiz=next]").click();
    }
    return null;
  });
  expect(TITLES).toContain(title);
  // the picture written out with every style as the browser reads it
  const picture = (els) => els.map((el) => {
    const out = (n) => (n.nodeType === 3 ? n.data : `<${n.localName}${[...n.attributes].map((a) => ` ${a.name}="${a.name === "style" ? n.style.cssText : a.value}"`).join("")}>` +
      `${[...n.childNodes].map(out).join("")}</${n.localName}>`);
    return out(el);
  }).join("");
  const inQuiz = await page.locator("#quiz-card .quiz-myth > *").evaluateAll(picture);
  await page.click("nav button[data-view=myths]");
  const onCard = await page.locator("#c-myths .myth").filter({ has: page.locator("h3", { hasText: title }) })
    .locator(".myth-strip, .myth-axis, .myth-legend").evaluateAll(picture);
  expect(inQuiz).toContain('class="myth-strip"');
  expect(inQuiz).toBe(onCard);
  expect(page.errors).toEqual([]);
});
