// The Jahresrückblick's "Das Jahr als Story": every card of a year with and without its Großlage, a running year
// up to the website's newest alarm, Neujahr with only a hand entry, the numbers counting up, and the ways through
// the cards (keys, taps, swipes, the buttons, the back button). The alarms are made up: 2024 small, 2025 whole
// with a Großlage without times, Silvester alarms and odd characters, 2026 up to 01.07. with a hand entry after it.
import { devices } from "@playwright/test";
import { test, expect, json, openSite, device } from "./fixtures.js";

const alarm = (date, time, keyword, street, district = "Linden-Mitte", event = "Test") => ({ date, time, category: "Einsatz", keyword, event, street, district, remarks: "" });
const ODD = "Rauch <piept> & \"laut\"";
const ROWS = [
  alarm("2024-02-02", "10:00", "b1", "Am Kanal"),
  alarm("2024-06-06", "12:00", "h", "Nahstraße"),
  // 2025: three alarms in the Silvesternacht, a Großlage of ten without times, Mitternacht and 14 Uhr twice each
  alarm("2025-01-01", "00:10", "b1", "Am Kanal", "Linden-Süd", ODD),
  alarm("2025-01-01", "00:20", "b1", "Am Kanal", "Linden-Süd", ODD),
  alarm("2025-01-01", "01:30", "b1", "Am Kanal", "Linden-Süd"),
  alarm("2025-03-05", "14:10", "th", "Nahstraße", "Linden-Nord"),
  alarm("2025-03-06", "14:40", "b1", "Nahstraße", "Linden-Nord"),
  alarm("2025-05-05", "09:00", "th", "Mittelweg"),
  ...Array.from({ length: 10 }, (_, k) => alarm("2025-07-10", "00:00", "h", `Sturmweg ${k + 1}`)),
  alarm("2025-08-01", "11:00", "vs", "Teichstraße"), // a Wachbesetzung never counts
  alarm("2025-12-31", "23:30", "b1", "Weg <A> & \"B\"", "unbekannt"),
  alarm("2026-01-01", "00:15", "b1", "Am Kanal"),
  alarm("2026-04-04", "12:00", "h", "Nahstraße"),
  alarm("2026-07-01", "13:00", "b1", "Mittelweg"),
];
const HAND = alarm("2026-07-20", "20:00", "b1", "Mittelweg"); // after the website's newest alarm

// A card as its head, the text of each part of its body, its foot and the progress bar.
const card = (page) => page.evaluate(() => {
  const c = document.querySelector("#story-card");
  return {
    head: c.querySelector(".st-head").textContent,
    body: [...c.querySelectorAll(".st-body > *")].map((e) => e.textContent),
    foot: c.querySelector(".st-foot").textContent,
    theme: document.querySelector("#story-frame").className,
    bar: [...document.querySelectorAll("#story-bar i")].map((i) => i.className || "-").join(" "),
  };
});
const at = async (page) => (await card(page)).bar.split(" ").indexOf("now");

async function setup(page, { time = "2026-10-08T12:00:00+02:00", rows = ROWS, hand = [HAND], motion = false } = {}) {
  await page.emulateMedia({ reducedMotion: motion ? "no-preference" : "reduce" });
  await page.clock.install({ time: new Date(time) });
  await page.route("**/data/alarms.json", (r) => r.fulfill(json({ updated: "2026-07-02T06:00:00+00:00", rows: [...rows].reverse() })));
  await page.route("**/data/manual.json", (r) => r.fulfill(json({ rows: hand })));
  await openSite(page);
  await page.click("nav button[data-view=year]");
}
async function openStory(page, year, storm = true) {
  await page.selectOption("#y-year", year);
  await page.setChecked("#y-storm", storm);
  await page.click("#y-story");
  await expect(page.locator("#story")).toBeVisible();
}
async function allCards(page) {
  const out = [];
  for (;;) {
    out.push(await card(page));
    if (await page.locator("#story-next").isDisabled()) return out;
    await page.click("#story-next");
  }
}

test("every card of a whole year with its Großlage", async ({ page }) => {
  await setup(page);
  await openStory(page, "2025");
  const cards = await allCards(page);
  const head = "FF Linden · Einsatzjahr 2025";
  expect(cards.map((c) => [c.theme, c.head, c.body, c.foot])).toEqual([
    ["story-frame st-red", "", ["Freiwillige Feuerwehr Hannover-Linden", "Das Einsatzjahr 2025", "Zum Weiterblättern tippen oder wischen."], ""],
    ["story-frame st-dark", head, ["Einsätze", "17", "Im Schnitt 0,3 pro Woche.", "Mitgezählt: die Großlage am 10.07. mit 10 Einsätzen."], ""],
    ["story-frame st-amber", head, ["Der stärkste Tag", "Donnerstag, 10.07.2025", "10", "Einsätze an einem Tag.", "Am häufigsten: „Test“ (10-mal)"], ""],
    ["story-frame st-navy", head, ["Die häufigste Uhrzeit", "Mitternacht", "Zwischen 0 und 1 Uhr wurde am häufigsten alarmiert: 2-mal.", "06121824 Uhr", "Genauso oft: 14–15 Uhr."], ""],
    ["story-frame st-dark", head, ["Nachts", "57 %", "der Einsätze kamen zwischen 22 und 6 Uhr, also in 8 von 24 Stunden.", "", "Tag 43 %Nacht 57 %"], ""],
    // "th" has no name in the keyword list, so its name is the keyword itself
    ["story-frame st-red", head, ["Das häufigste Stichwort", "h", "Kleine Hilfeleistung", "10-mal, das sind 59 % aller Einsätze.",
      "Danach: b1 Brand, klein (z. B. Rauchmelder, BMA) (5), th th (2)"], ""],
    // the top three and those tied with the third, at most five; no district for "unbekannt"
    ["story-frame st-navy", head, ["Die häufigsten Einsatzorte",
      "Am KanalLinden-Süd3NahstraßeLinden-Nord2Weg <A> & \"B\"1Sturmweg 10Linden-Mitte1Sturmweg 9Linden-Mitte1", "Und 9 weitere mit je 1 Einsatz."], ""],
    ["story-frame st-amber", head, ["Die längste Pause", "173 Tage", "ohne einen einzigen Einsatz, vom 11.07. bis 30.12.2025."], ""],
    ["story-frame st-navy", head, ["Im Vergleich zu 2024", "+750 %", "17 Einsätze im Jahr 2025, 2 im Jahr 2024.", "05101520JanAprJulOkt2024: 22025: 17",
      "Ohne Großlagen: +250 %"], ""],
    ["story-frame st-red", head, ["2025 in Zahlen", "Einsätze17Nachts57 %Stärkster Tag10.07.10 EinsätzeLängste Pause173 TageHäufigstes StichworthHäufigster OrtAm Kanal",
      "Von vornSchließen"], ""],
  ]);
  expect(cards.map((c) => c.bar)).toEqual(cards.map((_, i) => cards.map((_, k) => (k < i ? "done" : k === i ? "now" : "-")).join(" ")));
  await expect(page.locator("#story-prev")).toBeEnabled();
  await expect(page.locator("#story-next")).toBeDisabled();
  expect(page.errors).toEqual([]);
});

test("the pictures on the cards: the hours, day and night, the places, the year before", async ({ page }) => {
  await setup(page);
  await openStory(page, "2025");
  const go = async (n) => { for (let i = 0; i < n; i++) await page.keyboard.press("ArrowRight"); };
  await go(3);
  // a bar per hour, the busiest (Mitternacht) marked, 14 Uhr as high, an empty hour still 2 % high
  const bars = await page.$$eval("#story-card .st-hours .bars i", (is) => is.map((i) => `${i.className || "-"} ${i.style.height}`));
  expect(bars).toHaveLength(24);
  expect([bars[0], bars[1], bars[2], bars[9], bars[14], bars[23]]).toEqual(["hi 100%", "- 50%", "- 2%", "- 50%", "- 100%", "- 50%"]);
  // the big word shrinks with its length
  expect(await page.$eval("#story-card .st-hero", (e) => e.style.cssText)).toBe("font-size: min(26cqw, 10.9cqw, 16cqh); --i: 1;");
  await go(1);
  expect(await page.$$eval("#story-card .st-split i", (is) => is.map((i) => `${i.className || "-"} ${i.style.flexGrow}`))).toEqual(["- 43", "hi 57"]);
  await go(2);
  expect(await page.$$eval("#story-card .st-rank i", (is) => is.map((i) => i.style.width))).toEqual(["100%", "66.6667%", "33.3333%", "33.3333%", "33.3333%"]);
  await go(2);
  // the running totals of both years, the chosen one marked, without tooltips
  await expect(page.locator("#story-card .st-chart polyline")).toHaveCount(2);
  await expect(page.locator("#story-card .st-chart polyline.sel")).toHaveCount(1);
  await expect(page.locator("#story-card .st-chart text.end")).toHaveText(["2024: 2", "2025: 17"]);
  await expect(page.locator("#story-card .st-chart .hit")).toHaveCount(0);
  // each part of a card comes in after the one before it
  expect(await page.$$eval("#story-card .st-body > *", (es) => es.map((e) => e.style.getPropertyValue("--i")))).toEqual(["0", "1", "2", "3", "4"]);
  expect(page.errors).toEqual([]);
});

test("without the Großlage, and the running year up to the website's newest alarm", async ({ page }) => {
  await setup(page);
  await openStory(page, "2025", false);
  const cards = await allCards(page);
  expect(cards.map((c) => c.foot)).toEqual(Array(cards.length).fill("Ohne Großlagen"));
  expect(cards[1].body).toEqual(["Einsätze", "7", "Im Schnitt 0,1 pro Woche.", "Nicht mitgezählt: die Großlage am 10.07. mit 10 Einsätzen."]);
  // the busiest day is Neujahr, all of it in the Silvesternacht
  expect(cards[2].body).toEqual(["Der stärkste Tag", "Mittwoch, 01.01.2025", "3", "Einsätze an einem Tag, alle in der Silvesternacht.", `Am häufigsten: „${"Rauch <piept> & \"laut\""}“ (2-mal)`]);
  expect(cards.at(-2).body).toEqual(["Im Vergleich zu 2024", "+250 %", "7 Einsätze im Jahr 2025, 2 im Jahr 2024.", "0246810JanAprJulOkt2024: 22025: 7"]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#story")).toBeHidden();

  // 2026: counted up to 01.07., the hand entry after it in the number but not in the average
  await openStory(page, "2026");
  const run = await allCards(page);
  expect(run[0].body).toEqual(["Freiwillige Feuerwehr Hannover-Linden", "Das Einsatzjahr 2026", "Das Jahr läuft noch. Gezählt ist alles bis zum 20.07.2026.", "Zum Weiterblättern tippen oder wischen."]);
  expect(run.map((c) => c.foot)).toEqual(Array(run.length).fill("Stand 20.07.2026"));
  expect(run[1].body).toEqual(["Einsätze", "4", "Im Schnitt 0,1 pro Woche."]);
  // days with one alarm only: the newest of them, without "Am häufigsten"
  expect(run[2].body).toEqual(["Der stärkste Tag", "Montag, 20.07.2026", "1", "Einsätze an einem Tag."]);
  // the longest pause only up to the website's newest alarm
  expect(run.find((c) => c.body[0] === "Die längste Pause").body).toEqual(["Die längste Pause", "92 Tage", "ohne einen einzigen Einsatz, vom 02.01. bis 03.04.2026."]);
  expect(run.find((c) => c.body[0] === "Im Vergleich zu 2025").body).toEqual(["Im Vergleich zu 2025", "−50 %", "3 Einsätze im Jahr 2026, 6 im Jahr 2025 (jeweils bis 01.07.).",
    "0246810JanAprJulOkt2025: 62026: 3"]); // the Großlage of 2025 came later: no "Ohne Großlagen"
  expect(page.errors).toEqual([]);
});

test("Neujahr with only a hand entry, a year with only a Großlage, the same number as the year before", async ({ page }) => {
  const rows = [
    alarm("2025-02-02", "10:00", "b1", "Am Kanal"), alarm("2025-02-02", "23:00", "h", "Nahstraße"),
    alarm("2026-02-02", "10:00", "b1", "Am Kanal"), alarm("2026-02-03", "23:00", "h", ""),
    ...Array.from({ length: 10 }, (_, k) => alarm("2024-06-15", "00:00", "h", `Sturmweg ${k + 1}`)),
  ];
  await setup(page, { time: "2027-01-01T02:00:00+01:00", rows, hand: [alarm("2027-01-01", "00:40", "b1", "Am Kanal")] });
  // 2027: no average yet, no comparison with a year the website hasn't reached
  await openStory(page, "2027");
  const cards = await allCards(page);
  expect(cards[0].body).toContain("Das Jahr läuft noch. Gezählt ist alles bis zum 01.01.2027.");
  expect(cards[1].body).toEqual(["Einsätze", "1"]);
  expect(cards.map((c) => c.body[0])).toEqual(["Freiwillige Feuerwehr Hannover-Linden", "Einsätze", "Der stärkste Tag", "Die häufigste Uhrzeit", "Nachts",
    "Das häufigste Stichwort", "Die häufigsten Einsatzorte", "2027 in Zahlen"]);
  await page.click("[data-story=close]");
  await expect(page.locator("#story")).toBeHidden();
  // 2026 like 2025: ±0 %; a place without a street isn't a place
  await openStory(page, "2026");
  const same = await allCards(page);
  expect(same.find((c) => c.body[0] === "Im Vergleich zu 2025").body.slice(0, 3)).toEqual(["Im Vergleich zu 2025", "±0 %", "2 Einsätze im Jahr 2026, 2 im Jahr 2025 (jeweils bis 03.02.)."]);
  expect(same.find((c) => c.body[0] === "Die häufigsten Einsatzorte").body).toEqual(["Die häufigsten Einsatzorte", "Am KanalLinden-Mitte1"]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#story")).toBeHidden();
  // 2024: only the Großlage, without times: no hours, no nights; without it nothing to tell, so nothing opens
  await openStory(page, "2024");
  const big = await allCards(page);
  expect(big.map((c) => c.body[0])).toEqual(["Freiwillige Feuerwehr Hannover-Linden", "Einsätze", "Der stärkste Tag", "Das häufigste Stichwort",
    "Die häufigsten Einsatzorte", "Die längste Pause", "2024 in Zahlen"]);
  expect(big.at(-1).body[1]).toBe("Einsätze10Nachts–Stärkster Tag15.06.10 EinsätzeLängste Pause199 TageHäufigstes StichworthHäufigster OrtSturmweg 10");
  await page.keyboard.press("Escape");
  await expect(page.locator("#story")).toBeHidden();
  await page.setChecked("#y-storm", false);
  await page.click("#y-story");
  await page.waitForTimeout(200);
  await expect(page.locator("#story")).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/story-open/);
  expect(page.errors).toEqual([]);
});

test("the numbers count up from 0 when their card shows, and again when it shows again", async ({ page }) => {
  await setup(page, { motion: true });
  await page.clock.pauseAt(new Date("2026-10-08T12:00:30+02:00"));
  await openStory(page, "2025");
  await page.keyboard.press("ArrowRight");
  const hero = page.locator("#story-card .st-hero span[data-to]");
  await expect(hero).toHaveText("0");
  await page.clock.runFor(300);
  const mid = Number(await hero.textContent());
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(17);
  await page.clock.runFor(2000);
  await expect(hero).toHaveText("17");
  // the comparison counts up with its sign
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
  const delta = page.locator("#story-card span[data-sign]");
  await expect(delta).toHaveText("±0");
  await page.clock.runFor(3000);
  await expect(delta).toHaveText("+750");
  // back and forth: it starts over
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await expect(delta).toHaveText("±0");
  expect(page.errors).toEqual([]);
});

test("keys, taps, swipes, the buttons and the back button; the page stays put underneath", async ({ page }) => {
  await setup(page);
  // closed: the keys are the page's own (space ticks a focused checkbox)
  await page.focus("#y-storm");
  await page.keyboard.press(" ");
  await expect(page.locator("#y-storm")).not.toBeChecked();
  await page.keyboard.press(" ");
  await expect(page.locator("#y-storm")).toBeChecked();
  // space on the focused close button closes the story, like a click
  await openStory(page, "2025");
  await page.keyboard.press(" ");
  await expect(page.locator("#story")).toBeHidden();
  await page.click("#y-story");
  await expect(page.locator("body")).toHaveClass(/story-open/);
  await expect(page.locator("#story-close")).toBeFocused();
  await expect(page.locator("#story-prev")).toBeDisabled();
  expect(await at(page)).toBe(0);
  await page.keyboard.press("ArrowLeft");
  expect(await at(page)).toBe(0);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(await at(page)).toBe(2);
  await page.keyboard.press("ArrowLeft");
  expect(await at(page)).toBe(1);
  // space goes on, unless a button has the focus
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press(" ");
  expect(await at(page)).toBe(2);
  // a tap on the left third goes back, elsewhere on; a swipe left goes on, right back; a short one is a tap
  const box = await page.locator("#story-card").boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.click(box.x + box.width * 0.9, y);
  expect(await at(page)).toBe(3);
  await page.mouse.click(box.x + box.width * 0.4, y); // just right of the left third
  expect(await at(page)).toBe(4);
  await page.mouse.click(box.x + box.width * 0.2, y);
  await page.mouse.click(box.x + box.width * 0.3, y);
  expect(await at(page)).toBe(2);
  const swipe = async (from, to) => {
    await page.mouse.move(box.x + box.width * from, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, y, { steps: 5 });
    await page.mouse.up();
  };
  await swipe(0.8, 0.2);
  expect(await at(page)).toBe(3);
  await swipe(0.2, 0.8);
  expect(await at(page)).toBe(2);
  await swipe(0.15, 0.2); // 5 % to the right: a tap on the left third
  expect(await at(page)).toBe(1);
  // the arrows beside the card, then the buttons on the last one
  await page.click("#story-prev");
  expect(await at(page)).toBe(0);
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  expect(await at(page)).toBe(9);
  await expect(page.locator("#story-next")).toBeDisabled();
  await page.click("[data-story=restart]");
  expect(await at(page)).toBe(0);
  for (let i = 0; i < 9; i++) await page.click("#story-next");
  await page.click("[data-story=close]");
  await expect(page.locator("#story")).toBeHidden();
  await expect(page.locator("#y-story")).toBeFocused();
  await expect(page.locator("body")).not.toHaveClass(/story-open/);
  await expect(page.locator("#story-card")).toBeEmpty();
  // opened again it starts at the first card; the back button closes it and stays on the page
  const url = page.url();
  await page.click("#y-story");
  expect(await at(page)).toBe(0);
  await page.keyboard.press("ArrowRight");
  await page.goBack();
  await expect(page.locator("#story")).toBeHidden();
  expect(page.url()).toBe(url);
  await expect(page.locator("section[data-view=year]")).toBeVisible();
  // Escape closes it too
  await page.click("#y-story");
  await page.keyboard.press("Escape");
  await expect(page.locator("#story")).toBeHidden();
  await expect(page.locator("#y-story")).toBeFocused();
  expect(page.errors).toEqual([]);
});

test("a running year whose pauses are all short, and one more place than fits", async ({ page }) => {
  const rows = [
    alarm("2026-01-01", "10:00", "b1", "Erster Weg"), alarm("2026-01-01", "11:00", "b1", "Zweiter Weg"),
    alarm("2026-01-03", "10:00", "h", "Dritter Weg"), alarm("2026-01-03", "11:00", "h", "Vierter Weg"),
    alarm("2026-01-04", "10:00", "b1", "Fünfter Weg"), // the website's newest alarm
  ];
  await setup(page, { rows, hand: [alarm("2026-09-01", "10:00", "b1", "Sechster Weg")] });
  await openStory(page, "2026");
  const cards = await allCards(page);
  // the longest pause up to the website's newest alarm is one day: no card for it, "–" in the numbers
  expect(cards.map((c) => c.body[0])).not.toContain("Die längste Pause");
  expect(cards.at(-1).body[1]).toContain("Längste Pause–");
  expect(cards.find((c) => c.body[0] === "Die häufigsten Einsatzorte").body[2]).toBe("Und ein weiterer Ort mit 1 Einsatz.");
  expect(page.errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use(device(devices["Pixel 7"]));

  test("fills the screen, without the arrows, and goes on with taps", async ({ page }) => {
    await setup(page);
    await openStory(page, "2025");
    const vp = page.viewportSize();
    const frame = await page.locator("#story-frame").boundingBox();
    expect([frame.x, frame.y, frame.width, frame.height]).toEqual([0, 0, vp.width, vp.height]);
    await expect(page.locator("#story-next")).toBeHidden();
    const box = await page.locator("#story-card").boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height / 2);
    expect(await at(page)).toBe(2);
    await page.touchscreen.tap(box.x + box.width * 0.1, box.y + box.height / 2);
    expect(await at(page)).toBe(1);
    await page.locator("#story-close").tap();
    await expect(page.locator("#story")).toBeHidden();
    expect(page.errors).toEqual([]);
  });
});
