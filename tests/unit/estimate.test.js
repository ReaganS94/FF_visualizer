import { describe, test, expect } from "vitest";
import { parseDate, isoDate, addDays } from "../../web/src/lib/dates.js";
import { alarmWindows, lastCovered, estimate, backtest, backtestFit, backtestGroups, alarmsIn } from "../../web/src/lib/estimate.js";

// Every date from `from` to `to` ("YYYY-MM-DD"), for which keep(date, index) is true.
function dates(from, to, keep = () => true) {
  const out = [];
  for (let d = parseDate(from), i = 0; d <= parseDate(to); d = addDays(d, 1), i++) if (keep(isoDate(d), i)) out.push(isoDate(d));
  return out;
}
const windows = (inDay, inNight = []) => ({ inDay: new Set(inDay), inNight: new Set(inNight) });

describe("alarmWindows and alarmsIn", () => {
  const row = (date, hour, more = {}) => ({ date, hour, standby: false, timeUnknown: false, ...more });
  const rows = [
    row("2026-10-06", 10),
    row("2026-10-06", 23),
    row("2026-10-07", 3), // after midnight: still the night of the 6th
    row("2026-10-08", 0, { timeUnknown: true }), // a Großlage entered without times counts as day
    row("2026-10-09", 12, { standby: true }),
  ];

  test("sort alarms into days (6–22 Uhr) and nights (22–6 Uhr, named after the evening)", () => {
    const win = alarmWindows(rows);
    expect([...win.inDay]).toEqual(["2026-10-06", "2026-10-08"]);
    expect([...win.inNight]).toEqual(["2026-10-06"]);
  });

  test("count the alarms in one day or night", () => {
    expect(alarmsIn(rows, "2026-10-06", false)).toBe(1);
    expect(alarmsIn(rows, "2026-10-06", true)).toBe(2);
    expect(alarmsIn(rows, "2026-10-08", false)).toBe(1);
    expect(alarmsIn(rows, "2026-10-07", true)).toBe(0);
    expect(alarmsIn(rows, "2026-10-09", false)).toBe(0);
  });
});

test("lastCovered stops two days before today, and before the website's newest day", () => {
  const today = parseDate("2026-10-07");
  expect(isoDate(lastCovered(today, "2026-10-07T04:20:00+00:00", parseDate("2026-10-06")))).toBe("2026-10-05");
  expect(isoDate(lastCovered(today, "2026-10-07T11:05:00+00:00", parseDate("2026-10-02")))).toBe("2026-10-01"); // website behind
  expect(isoDate(lastCovered(today, "2026-10-04T16:00:00+00:00", parseDate("2026-10-04")))).toBe("2026-10-02"); // no new data for days
});

describe("estimate", () => {
  // 12 weeks from Monday 05.01. to Sunday 29.03.2026: alarms by day on the first 6 Mondays and on every
  // Sunday (18 of 84 days), and at night on every 4th day (21 of 84 nights).
  const first = parseDate("2026-01-05"), last = parseDate("2026-03-29");
  const sundays = dates("2026-01-11", "2026-03-29", (d, i) => i % 7 === 0);
  const win = windows([...dates("2026-01-05", "2026-02-09", (d, i) => i % 7 === 0), ...sundays], dates("2026-01-05", "2026-03-29", (d, i) => i % 4 === 0));

  test("by day: the same weekday, blended with all days as if 10 average days were added", () => {
    const e = estimate(parseDate("2026-03-30"), first, last, win, {});
    expect([e.n, e.day, e.heat]).toEqual([12, 6, false]);
    expect(e.pDay).toBeCloseTo((6 + 10 * (18 / 84)) / (12 + 10), 10);
  });

  test("at night: the share of all nights", () => {
    expect(estimate(parseDate("2026-03-30"), first, last, win, {}).pNight).toBeCloseTo(21 / 84, 10);
  });

  test("a hot day is blended again with the past hot days", () => {
    // 10 hot days, 8 of them with an alarm by day (all Sundays), and 31 °C forecast for the Monday
    const weather = { "2026-03-30": { tmax: 31 } };
    for (const d of sundays.slice(0, 8)) weather[d] = { tmax: 32 };
    for (const d of ["2026-01-06", "2026-01-07"]) weather[d] = { tmax: 30 };
    const e = estimate(parseDate("2026-03-30"), first, last, win, weather);
    expect([e.heat, e.hot, e.hotDay]).toEqual([true, 10, 8]);
    expect(e.pDay).toBeCloseTo((8 + 10 * e.weekdayP) / (10 + 10), 10);
  });

  test("Silvester doesn't count as an ordinary night", () => {
    const e = estimate(parseDate("2026-01-05"), parseDate("2025-12-29"), parseDate("2026-01-04"), windows([], ["2025-12-31", "2026-01-02"]), {});
    expect([e.nights, e.night]).toEqual([6, 1]);
  });
});

test("backtest replays every day and night after the first half year", () => {
  // an alarm every day and never at night: every day estimate is 100 %, every night estimate 0 %
  const bt = backtest(parseDate("2025-01-01"), parseDate("2025-12-31"), windows(dates("2025-01-01", "2025-12-31")), {});
  expect(bt.bins).toMatchObject([{ lo: 0, hi: 10, n: 182, hit: 0 }, { lo: 40, hi: 101, n: 183, hit: 183 }]); // no Silvester night
  expect(bt.n).toBe(365);
});

test("backtestFit says whether the real share lies in the range the page said", () => {
  expect(backtestFit({ lo: 10, hi: 20, n: 49 }, 50)).toBe("Zu wenige Fälle");
  expect(backtestFit({ lo: 10, hi: 20, n: 50 }, 15)).toBe("Ja");
  expect(backtestFit({ lo: 10, hi: 20, n: 50 }, 9)).toBe("Nein, zu hoch");
  expect(backtestFit({ lo: 10, hi: 20, n: 50 }, 21)).toBe("Nein, zu niedrig");
  expect(backtestFit({ lo: 40, hi: 101, n: 50 }, 100)).toBe("Ja");
});

test("backtestGroups adds the rows up into low, middle and high estimates", () => {
  const bins = [{ lo: 0, hi: 10, n: 30, hit: 3 }, { lo: 10, hi: 20, n: 40, hit: 6 }, { lo: 20, hi: 30, n: 30, hit: 8 }, { lo: 40, hi: 101, n: 10, hit: 5 }];
  expect(backtestGroups({ bins }).map((g) => [g.label, g.n, g.hit, g.rate, g.fit])).toEqual([
    ["unter 10 %", 30, 3, 10, "Zu wenige Fälle"],
    ["10–30 %", 70, 14, 20, "Ja"],
    ["ab 30 %", 10, 5, 50, "Zu wenige Fälle"],
  ]);
});
