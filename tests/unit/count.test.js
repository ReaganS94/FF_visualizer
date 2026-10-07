import { test, expect } from "vitest";
import { topCounts, counted, pct, niceMax } from "../../web/src/lib/count.js";

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
