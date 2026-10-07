import { test, expect } from "vitest";
import { WEEKDAYS_LONG, parseDate, isoDate, addDays, weekday, fmtDate } from "../../docs/lib/dates.js";

test("reads and writes dates as local midnight", () => {
  const d = parseDate("2026-10-07");
  expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 7, 0]);
  expect(isoDate(d)).toBe("2026-10-07");
  expect(fmtDate("2026-10-07")).toBe("07.10.2026");
});

test("adds days by the calendar, also over the clock change and the turn of the year", () => {
  expect(isoDate(addDays(parseDate("2026-03-29"), 1))).toBe("2026-03-30"); // summer time starts
  expect(addDays(parseDate("2026-03-29"), 1).getHours()).toBe(0);
  expect(isoDate(addDays(parseDate("2026-10-25"), 1))).toBe("2026-10-26"); // summer time ends
  expect(isoDate(addDays(parseDate("2026-12-31"), 1))).toBe("2027-01-01");
  expect(isoDate(addDays(parseDate("2028-03-01"), -1))).toBe("2028-02-29");
});

test("counts weekdays from Monday", () => {
  expect(weekday(parseDate("2026-10-05"))).toBe(0);
  expect(WEEKDAYS_LONG[weekday(parseDate("2026-10-11"))]).toBe("Sonntag");
});
