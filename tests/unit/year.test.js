import { describe, test, expect } from "vitest";
import { parseDate, longestRun } from "../../web/src/lib/dates.js";
import { NOTABLE, yearInfo, DAY_SLOTS, runningTotal } from "../../web/src/lib/year.js";

// Cleaned alarms as yearInfo gets them: newest first.
const alarm = (date, more = {}) => ({ date, standby: false, bigDay: false, ...more });
const dates = (rows) => rows.map((r) => r.date);

describe("yearInfo", () => {
  const all = [
    alarm("2026-09-29"), // entered by hand, the website lists alarms only up to 13.09.
    alarm("2026-09-10"),
    alarm("2026-07-14", { bigDay: true }),
    alarm("2026-05-05", { standby: true }),
    alarm("2026-03-01"),
    alarm("2026-01-01"),
    alarm("2025-12-31"),
    alarm("2025-09-14"),
    alarm("2025-09-13"),
    alarm("2025-02-01"),
    alarm("2024-06-01"),
    alarm("2024-03-01"),
    alarm("2024-01-02"),
  ];
  const listed = parseDate("2026-09-13"), today = parseDate("2026-10-07");

  test("a running year counts up to the website's newest alarm, against the same days a year earlier", () => {
    const info = yearInfo("2026", true, all, listed, today);
    expect(dates(info.rows)).toEqual(["2026-09-29", "2026-09-10", "2026-07-14", "2026-03-01", "2026-01-01"]); // no standby
    expect([info.lastDate, info.running, info.partial, info.listed, info.cutDate, info.cut]).toEqual(
      ["2026-09-29", true, true, "2026-09-13", "2026-09-13", "09-13"]);
    expect(dates(info.cmpRows)).toEqual(["2026-09-10", "2026-07-14", "2026-03-01", "2026-01-01"]);
    expect(dates(info.prevSame)).toEqual(["2025-09-13", "2025-02-01"]);
    expect(info.delta).toBe(100);
  });

  test("without Großlagen", () => {
    const info = yearInfo("2026", false, all, listed, today);
    expect(dates(info.cmpRows)).toEqual(["2026-09-10", "2026-03-01", "2026-01-01"]);
    expect(info.delta).toBe(50);
  });

  test("a past year counts whole, against the whole year before", () => {
    const info = yearInfo("2025", true, all, listed, today);
    expect([info.running, info.partial, info.cutDate, info.cut]).toEqual([false, false, "2025-12-31", "12-31"]);
    expect([info.cmpRows.length, info.prevSame.length, info.delta]).toEqual([4, 3, 33]);
  });

  test("a past year stays open in January until the website reaches 31.12.", () => {
    const rows = [alarm("2026-12-28"), alarm("2026-12-15"), alarm("2025-12-25"), alarm("2025-12-18")];
    const january = parseDate("2027-01-05");
    const open = yearInfo("2026", true, rows, parseDate("2026-12-20"), january);
    expect([open.running, open.partial, open.cut, open.cmpRows.length, open.prevSame.length]).toEqual([false, true, "12-20", 1, 1]);
    const done = yearInfo("2026", true, rows, parseDate("2026-12-31"), january);
    expect([done.partial, done.cut, done.cmpRows.length, done.prevSame.length]).toEqual([false, "12-31", 2, 2]);
  });

  test("no comparison while the website hasn't reached the year (only entries by hand)", () => {
    const rows = [alarm("2027-01-01"), alarm("2026-12-31")];
    const info = yearInfo("2027", true, rows, parseDate("2026-12-30"), parseDate("2027-01-01"));
    expect([info.partial, info.cutDate, info.cut, info.cmpRows.length, info.delta]).toEqual([true, "2026-12-30", "", 0, null]);
  });

  test("a year without alarms, or without a year before it to compare with", () => {
    expect(yearInfo("2023", true, all, listed, today)).toMatchObject({ lastDate: "", partial: false, cut: "12-31", delta: null });
    expect(yearInfo("2024", true, all, listed, today).delta).toBe(null);
  });
});

describe("running totals", () => {
  test("one slot for every day of a leap year", () => {
    expect([DAY_SLOTS.length, DAY_SLOTS[0], DAY_SLOTS[59], DAY_SLOTS[60], DAY_SLOTS[365]]).toEqual([366, "01-01", "02-29", "03-01", "12-31"]);
  });

  test("add up day by day and stop after the last day", () => {
    const rows = [alarm("2026-03-01"), alarm("2026-01-03"), alarm("2026-01-01"), alarm("2026-01-01")];
    const values = runningTotal(rows, "03-01");
    expect(values.slice(0, 4)).toEqual([2, 2, 3, 3]);
    expect(values.slice(59, 62)).toEqual([3, 4, null]);
    expect(runningTotal(rows, "").every((v) => v === null)).toBe(true);
  });
});

test("NOTABLE picks the bigger keywords", () => {
  expect(["b2", "b3", "abc2", "hw1", "hu2", "manv", "manv10"].every((k) => NOTABLE.test(k))).toBe(true);
  expect(["b1", "th1", "rd", "hw", "b22"].some((k) => NOTABLE.test(k))).toBe(false);
});

describe("longestRun", () => {
  // March/April 2026 (summer time starts on 29.03.): days with an alarm on 27.03., 31.03.–02.04. and 05.04.
  const busy = new Set(["2026-03-27", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-05"]);

  test("the longest stretch of days with or without an alarm", () => {
    expect(longestRun(busy, "2026-03-25", "2026-04-05", true)).toEqual({ len: 3, from: "2026-03-31", to: "2026-04-02" });
    expect(longestRun(busy, "2026-03-25", "2026-04-05", false)).toEqual({ len: 3, from: "2026-03-28", to: "2026-03-30" });
  });

  test("the first one wins a tie, and nothing found is null", () => {
    expect(longestRun(new Set(["2026-01-03"]), "2026-01-01", "2026-01-05", false)).toEqual({ len: 2, from: "2026-01-01", to: "2026-01-02" });
    expect(longestRun(busy, "2026-03-31", "2026-04-02", false)).toBe(null);
  });
});
