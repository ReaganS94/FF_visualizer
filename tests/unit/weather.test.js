import { test, expect } from "vitest";
import { parseDate } from "../../web/src/lib/dates.js";
import { isHot, isStorm, isThunder, wxKind, weatherFacts } from "../../web/src/lib/weather.js";

test("hot from 30 °C, storm from 60 km/h, thunder from code 95", () => {
  expect([isHot({ tmax: 30 }), isHot({ tmax: 29.9 })]).toEqual([true, false]);
  expect([isStorm({ gust: 60 }), isStorm({ gust: 59 })]).toEqual([true, false]);
  expect([isThunder({ code: 95 }), isThunder({ code: 82 })]).toEqual([true, false]);
});

test("wxKind turns the weather code into a symbol and a word", () => {
  expect([95, 73, 61, 45, 3, 2, 0].map((code) => wxKind({ code })[0])).toEqual(["thunder", "snow", "rain", "fog", "cloud", "part", "sun"]);
  expect(wxKind({ code: 61 })).toEqual(["rain", "Regen"]);
  // days saved before the codes were added only know the rain
  expect(wxKind({ rain: 2 })).toEqual(["rain", "Regen"]);
  expect(wxKind({ rain: 0 })).toBeNull();
});

test("weatherFacts compares days with that weather against the others", () => {
  const weather = { "2026-07-01": { tmax: 31 }, "2026-07-02": { tmax: 33 }, "2026-07-03": { tmax: 22 }, "2026-07-04": { tmax: 20 } };
  const win = { inDay: new Set(["2026-07-01", "2026-07-03", "2026-07-05"]), inNight: new Set() };
  // 05.07. has no weather and is left out
  expect(weatherFacts(parseDate("2026-07-01"), parseDate("2026-07-05"), win, isHot, weather)).toEqual({ on: 2, onHit: 1, off: 2, offHit: 1 });
});
