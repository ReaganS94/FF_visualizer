import { test, expect } from "vitest";
import { esc, einsaetze, weitere, fmtKm, dec, andList } from "../../docs/lib/text.js";

test("esc makes text from the data safe for the page", () => {
  expect(esc('<b>"Brand" & Rauch</b>')).toBe("&lt;b&gt;&quot;Brand&quot; &amp; Rauch&lt;/b&gt;");
  expect(esc(42)).toBe("42");
  expect(esc(null)).toBe("");
  expect(esc(undefined)).toBe("");
});

test("counts in words", () => {
  expect(einsaetze(1)).toBe("1 Einsatz");
  expect(einsaetze(2)).toBe("2 Einsätze");
  expect(einsaetze(1234)).toBe("1.234 Einsätze");
  expect(einsaetze(3, true)).toBe("3 Einsätzen");
  expect(weitere(1)).toBe("1 weiterer");
  expect(weitere(4)).toBe("4 weitere");
});

test("distances in metres below 1 km, else in km", () => {
  expect(fmtKm(0.123)).toBe("120 m");
  expect(fmtKm(0.994)).toBe("990 m");
  expect(fmtKm(0.996)).toBe("1,0 km");
  expect(fmtKm(10.84)).toBe("10,8 km");
});

test("one decimal with a comma, and lists joined with und", () => {
  expect([dec(2.5), dec(3), dec(10.04)]).toEqual(["2,5", "3,0", "10,0"]);
  expect([[], ["Brand"], ["Brand", "Hilfe"], ["Brand", "Hilfe", "Unwetter"]].map(andList))
    .toEqual(["", "Brand", "Brand und Hilfe", "Brand, Hilfe und Unwetter"]);
});
