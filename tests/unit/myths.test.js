import { describe, test, expect } from "vitest";
import { parseDate, isoDate, addDays, weekday } from "../../docs/lib/dates.js";
import { fullMoons, holidays, rng, testMyth, mythResults, mythVerdict } from "../../docs/lib/myths.js";

test("full moons as Hannover dates", () => {
  // 13 in 2026 (two in May); the one on 29.06. at 23:57 UTC is the 30th in Hannover
  expect(fullMoons(parseDate("2026-01-01"), parseDate("2026-12-31"))).toEqual([
    "2026-01-03", "2026-02-01", "2026-03-03", "2026-04-02", "2026-05-01", "2026-05-31", "2026-06-30",
    "2026-07-29", "2026-08-28", "2026-09-26", "2026-10-26", "2026-11-24", "2026-12-24",
  ]);
  // the lunar eclipses of 14.03. and 07.09.2025, and 04.12.2025 at 23:14 UTC
  expect(fullMoons(parseDate("2025-01-01"), parseDate("2025-12-31"))).toEqual(expect.arrayContaining(["2025-03-14", "2025-09-07", "2025-12-05"]));
});

test("public holidays in Lower Saxony, Easter included", () => {
  expect(holidays(2026)).toEqual(["2026-04-03", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-10-03", "2026-10-31", "2026-12-25", "2026-12-26"]);
  expect(holidays(2024).slice(0, 2)).toEqual(["2024-03-29", "2024-04-01"]); // Easter on 31.03.
  expect(holidays(2025).slice(3, 5)).toEqual(["2025-05-29", "2025-06-09"]);
});

test("seeded random numbers repeat", () => {
  const a = rng(7), b = rng(7);
  const xs = Array.from({ length: 5 }, a);
  expect(Array.from({ length: 5 }, b)).toEqual(xs);
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  expect(rng(8)()).not.toBe(xs[0]);
});

describe("testMyth", () => {
  // 200 days: every 10th is a myth day; each weekday has its own count, myth days one more
  const days = Array.from({ length: 200 }, (_, i) => ({ date: String(i), wd: i % 7, doy: i, n: (i % 7) + (i % 10 === 0 ? 1 : 0) }));
  const is = (d) => Number(d.date) % 10 === 0;
  const sameWeekday = (a, b) => a.wd === b.wd;

  test("compares the myth days with similar days, drawn 2000 times", () => {
    const t = testMyth(days, is, sameWeekday, 1);
    expect(t.n).toBe(20);
    // A myth day's similar days all have one alarm less, so chance can't vary and never gets as high.
    expect(t.lo).toBe(t.hi);
    expect(t.base).toBeCloseTo(t.lo, 10);
    expect(t.avg).toBeCloseTo(t.base + 1, 10);
    expect([t.atLeast, t.atMost]).toEqual([0, 1]);
  });

  test("the same seed gives the same result", () => {
    const noisy = days.map((d, i) => ({ ...d, n: (i * 7919) % 5 }));
    expect(testMyth(noisy, is, sameWeekday, 3)).toEqual(testMyth(noisy, is, sameWeekday, 3));
  });

  test("myth days without a similar day are left out, and no myth days at all is null", () => {
    expect(testMyth(days, is, (a, b) => a.wd === b.wd && a.wd !== 0, 1).n).toBe(17);
    expect(testMyth(days, () => false, sameWeekday, 1)).toBe(null);
  });
});

describe("mythVerdict", () => {
  const t = (avg, p, n = 20) => ({ avg, base: 1, n, atLeast: p, atMost: p });

  test("more than chance explains", () => {
    const [cls, verdict, text] = mythVerdict(t(2, 0.02));
    expect([cls, verdict]).toEqual(["yes", "Stimmt"]);
    expect(text).toBe("Wählt man ebenso viele zufällige ähnliche Tage, kommen sie in 2 von 100 Versuchen auf mindestens so viele Einsätze. " +
      "Da steckt also mehr dahinter als Zufall.");
    expect(mythVerdict(t(0.5, 0.004))[1]).toBe("Im Gegenteil");
    expect(mythVerdict(t(0.5, 0.004))[2]).toMatch(/in keinem von 100 Versuchen auf höchstens so wenige Einsätze/);
  });

  test("too few days, a hint, or chance", () => {
    expect(mythVerdict(t(2, 0.05, 9)).slice(0, 2)).toEqual(["few", "Zu wenige Tage"]);
    expect(mythVerdict(t(2, 0.05)).slice(0, 2)).toEqual(["maybe", "Vielleicht"]);
    expect(mythVerdict(t(0.5, 0.05)).slice(0, 2)).toEqual(["maybe", "Vielleicht weniger"]);
    expect(mythVerdict(t(1, 0.5)).slice(0, 2)).toEqual(["none", "Kein Unterschied"]);
    expect(mythVerdict(t(1, 0.5), "Werktage")[2]).toMatch(/^Wählt man ebenso viele zufällige Werktage,/);
  });
});

describe("mythResults", () => {
  // 2025: one alarm on weekdays, three on weekends, a dozen on Neujahr, and a Großlage on 14.07.
  const alarms = [];
  for (let d = parseDate("2025-01-01"); d <= parseDate("2025-12-31"); d = addDays(d, 1)) {
    const date = isoDate(d), n = date === "2025-01-01" ? 12 : weekday(d) >= 5 ? 3 : 1;
    for (let k = 0; k < n; k++) alarms.unshift({ date, standby: false, bigDay: date === "2025-07-14" });
    if (date === "2025-03-05") alarms.unshift({ date, standby: true, bigDay: false }); // doesn't count
  }
  const last = parseDate("2025-12-31");
  const titles = (res) => res.results.map((m) => m.title);

  test("counts every day but the Großlage, and leaves out myths it has no data for", () => {
    const res = mythResults(alarms, last, { ferien: [], heimspiele: [], weather: {} });
    expect([isoDate(res.first), isoDate(res.last), res.days]).toEqual(["2025-01-01", "2025-12-31", 364]);
    expect(titles(res)).toEqual(["Bei Vollmond ist mehr los.", "Am Freitag, dem 13., ist mehr los.", "An Feiertagen ist mehr los.",
      "Am Wochenende ist mehr los.", "Silvester ist die Nacht des Jahres."]);
    const weekend = res.results.find((m) => /Wochenende/.test(m.title));
    expect([weekend.t.avg, weekend.t.base, mythVerdict(weekend.t, weekend.pick)[0]]).toEqual([3, 1, "yes"]);
    const neujahr = res.results.find((m) => /Silvester/.test(m.title));
    expect([neujahr.t.n, neujahr.t.avg]).toEqual([1, 12]);
    expect(res.results.find((m) => /Freitag/.test(m.title)).t.hits.map((d) => d.date)).toEqual(["2025-06-13"]);
  });

  test("school holidays, home games and hot days add their myths", () => {
    // two hot Tuesdays and a cooler one; days without weather data don't take part
    const weather = { "2025-07-01": { tmax: 31 }, "2025-07-08": { tmax: 30 }, "2025-07-15": { tmax: 24 } };
    const res = mythResults(alarms, last, { ferien: [["2025-07-03", "2025-08-13"]], heimspiele: ["2025-08-23"], weather });
    expect(titles(res)).toEqual(expect.arrayContaining(["In den Ferien ist mehr los.", "Wenn 96 zu Hause spielt, ist mehr los.", "Bei Hitze gibt es mehr Einsätze."]));
    expect(res.results.find((m) => /Hitze/.test(m.title)).t.n).toBe(2);
  });
});
