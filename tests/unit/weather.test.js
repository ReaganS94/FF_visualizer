import { test, expect } from "vitest";
import { parseDate } from "../../web/src/lib/dates.js";
import { isHot, isStorm, isThunder, wxKind, weatherFacts, weatherDays, perRange } from "../../web/src/lib/weather.js";

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

test("weatherDays keeps the days from first to last in the chosen year, without dropped days, Silvester and Neujahr", () => {
  const weather = Object.fromEntries(["2024-12-30", "2024-12-31", "2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04", "2025-01-05"]
    .map((d) => [d, { gust: 10 }]));
  expect(weatherDays(weather, "2024-12-30", "2025-01-04", "", new Set())).toEqual(["2024-12-30", "2025-01-02", "2025-01-03", "2025-01-04"]);
  expect(weatherDays(weather, "2025-01-02", "2025-01-03", "", new Set())).toEqual(["2025-01-02", "2025-01-03"]);
  expect(weatherDays(weather, "2024-12-30", "2025-01-05", "2025", new Set(["2025-01-03"]))).toEqual(["2025-01-02", "2025-01-04", "2025-01-05"]);
  // no alarms chosen: every day up to last
  expect(weatherDays(weather, "", "2024-12-31", "", new Set())).toEqual(["2024-12-30"]);
});

test("perRange counts each day in the range its value falls in, from lo up to below hi, with its alarms", () => {
  const weather = { "2025-03-01": { rain: 0 }, "2025-03-02": { rain: 0.1 }, "2025-03-03": { rain: 4.9 }, "2025-03-04": { rain: 5 }, "2025-03-05": { rain: 30 } };
  const perDay = { "2025-03-01": 2, "2025-03-02": 1, "2025-03-04": 3, "2025-03-05": 4, "2025-03-06": 9 };
  const ranges = [[0, 0.1, "trocken"], [0.1, 5, "bis 5 mm"], [5, 20, "5–20 mm"], [20, 999, "ab 20 mm"]];
  expect(perRange(Object.keys(weather), weather, "rain", ranges, perDay)).toEqual([
    { days: 1, alarms: 2 }, { days: 2, alarms: 1 }, { days: 1, alarms: 3 }, { days: 1, alarms: 4 },
  ]);
  // only the days handed in count
  expect(perRange(["2025-03-01", "2025-03-05"], weather, "rain", ranges, perDay)).toEqual([
    { days: 1, alarms: 2 }, { days: 0, alarms: 0 }, { days: 0, alarms: 0 }, { days: 1, alarms: 4 },
  ]);
});
