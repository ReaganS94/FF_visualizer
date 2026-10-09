import { test, expect } from "vitest";
import { topCounts, counted, pct, niceMax, weekHours, heatLevel, bigDayCounts, dayLevel, perWeek, nightShare, perMonth } from "../../web/src/lib/count.js";
import { BIG_DAY } from "../../web/src/lib/alarms.js";

const rows = ["Brand", "Hilfe", "Brand", "", "Hilfe", "Brand", "Unwetter"].map((group, i) => ({ i, group }));

test("topCounts groups by a key, most first, and names a missing value", () => {
  const top = topCounts(rows, (r) => r.group);
  expect(top.map(([k, l]) => [k, l.map((r) => r.i)])).toEqual([["Brand", [0, 2, 5]], ["Hilfe", [1, 4]], ["unbekannt", [3]], ["Unwetter", [6]]]);
  expect(topCounts(rows, (r) => r.group, 2).map(([k]) => k)).toEqual(["Brand", "Hilfe"]);
});

test("counted gives every value with its count", () => {
  expect(counted(rows, (r) => r.group)).toEqual([["Brand", 3], ["Hilfe", 2], ["unbekannt", 1], ["Unwetter", 1]]);
});

test("pct rounds to whole percent", () => {
  expect([pct(1, 3), pct(2, 3), pct(0, 5), pct(5, 5)]).toEqual([33, 67, 0, 100]);
});

test("niceMax ends a scale at 5, or at 1, 2, 2,5 or 5 times a power of ten", () => {
  expect([0, 3, 5, 6, 12, 20, 21, 30, 70, 101, 1000, 2400].map(niceMax)).toEqual([5, 5, 5, 10, 20, 20, 25, 50, 100, 200, 1000, 2500]);
});

test("weekHours counts the alarms by weekday and hour, without those entered without a time", () => {
  const alarms = [
    { date: "2026-10-05", hour: 0 }, // a Monday
    { date: "2026-10-05", hour: 0 },
    { date: "2026-10-11", hour: 23 }, // a Sunday
    { date: "2026-10-08", hour: 14 }, // a Thursday
    { date: "2026-10-08", hour: 0, timeUnknown: true }, // a big day's alarm without a time
  ];
  const { grid, hours } = weekHours(alarms);
  expect(grid).toHaveLength(7);
  expect(grid.every((line) => line.length === 24)).toBe(true);
  expect([grid[0][0], grid[6][23], grid[3][14], grid[3][0]]).toEqual([2, 1, 1, 0]);
  expect(grid.flat().reduce((a, b) => a + b)).toBe(4);
  expect([hours[0], hours[14], hours[23]]).toEqual([2, 1, 1]);
  expect(hours.reduce((a, b) => a + b)).toBe(4);
});

test("heatLevel shades a count by fifths of the largest, with 0 for none", () => {
  expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => heatLevel(n, 10))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  expect([heatLevel(1, 1), heatLevel(1, 100), heatLevel(21, 100), heatLevel(80, 100), heatLevel(81, 100)]).toEqual([5, 1, 2, 4, 5]);
});

test("bigDayCounts counts the alarms of each Großlage day, without standbys", () => {
  const alarms = [
    { date: "2026-02-17", bigDay: true },
    { date: "2026-02-17", bigDay: true },
    { date: "2026-02-17", bigDay: true, standby: true },
    { date: "2026-02-18" },
    { date: "2026-06-30", bigDay: true },
  ];
  expect(bigDayCounts(alarms)).toEqual({ "2026-02-17": 2, "2026-06-30": 1 });
  expect(bigDayCounts([])).toEqual({});
});

test("dayLevel shades a day by its alarms: 0, 1, 2, 3–4, up to a Großlage, and a Großlage's", () => {
  expect([0, 1, 2, 3, 4, 5, BIG_DAY - 1, BIG_DAY, BIG_DAY + 15].map(dayLevel)).toEqual([0, 1, 2, 3, 3, 4, 4, 5, 5]);
});

test("perWeek counts the alarms per week up to the website's newest day, and says which day that is", () => {
  const days = (...ds) => ds.map((date) => ({ date })); // newest first
  // all years: from the first alarm to the website's newest alarm, two weeks
  expect(perWeek(days("2026-01-14", "2026-01-08", "2026-01-01"), "", "2026-01-14")).toEqual({ value: 1.5, to: "2026-01-14" });
  // a hand entry after the website's newest day doesn't count yet, and the result says where counting stopped
  expect(perWeek(days("2026-01-20", "2026-01-14", "2026-01-08", "2026-01-01"), "", "2026-01-14")).toEqual({ value: 1.5, to: "2026-01-14" });
  // a chosen year that the website has passed: 01.01. to 31.12.
  expect(perWeek(days("2025-12-30", "2025-06-01"), "2025", "2026-10-02")).toEqual({ value: 2 / (365 / 7), to: "2025-12-31" });
  // a chosen year the website hasn't reached yet, and no alarms at all
  expect(perWeek(days("2026-10-05"), "2026", "2025-12-31")).toBe(null);
  expect(perWeek([], "", "2026-01-14")).toBe(null);
});

test("nightShare gives the share of alarms between 22 and 6 Uhr, of those with a real time", () => {
  const at = (...hours) => hours.map((hour) => ({ hour }));
  expect(nightShare(at(22, 5, 6, 21))).toBe(50); // 22 and 5 are night, 6 and 21 day
  expect(nightShare([...at(23, 2, 12), { hour: 0, timeUnknown: true }])).toBe(67);
  expect(nightShare([{ hour: 0, timeUnknown: true }])).toBe(null);
  expect(nightShare([])).toBe(null);
});

test("perMonth counts the alarms of every month from the first to the last, empty months included", () => {
  const days = (...ds) => ds.map((date) => ({ date })); // newest first
  expect(perMonth(days("2026-03-05", "2026-03-01", "2026-01-31"))).toEqual([
    { year: 2026, month: 0, n: 1 }, { year: 2026, month: 1, n: 0 }, { year: 2026, month: 2, n: 2 }]);
  expect(perMonth(days("2026-01-02", "2025-11-30"))).toEqual([
    { year: 2025, month: 10, n: 1 }, { year: 2025, month: 11, n: 0 }, { year: 2026, month: 0, n: 1 }]);
  expect(perMonth([])).toEqual([]);
});
