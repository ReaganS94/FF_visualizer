import { test, expect } from "vitest";
import { topCounts, counted, pct, niceMax, weekHours, heatLevel } from "../../web/src/lib/count.js";

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
