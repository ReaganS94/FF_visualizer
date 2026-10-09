// Wetter: the average number of alarms per day, by gusts, rain and the day's highest temperature.

import { isoDate, addDays, minDate } from "../../lib/dates.js";
import { einsaetze } from "../../lib/text.js";
import { $ } from "../../dom.js";
import { WEATHER, UPDATED, LISTED } from "../../data.js";
import { barList } from "../../components/charts.js";

const WEATHER_BUCKETS = [
  ["Windböen", "gust", [[0, 40, "unter 40 km/h"], [40, 60, "40–60 km/h"], [60, 80, "60–80 km/h"], [80, 999, "ab 80 km/h"]]],
  ["Niederschlag", "rain", [[0, 0.1, "trocken"], [0.1, 5, "bis 5 mm"], [5, 20, "5–20 mm"], [20, 999, "ab 20 mm"]]],
  ["Höchsttemperatur", "tmax", [[-99, 0, "unter 0 °C"], [0, 10, "0–10 °C"], [10, 20, "10–20 °C"], [20, 30, "20–30 °C"], [30, 99, "ab 30 °C"]]],
];

export function renderWeather(rows, year, dropped) {
  const box = $("#c-weather");
  const days = Object.keys(WEATHER);
  if (!days.length) {
    box.innerHTML = `<p class="note">Die Wetterdaten erscheinen nach der nächsten täglichen Aktualisierung.</p>`;
    return;
  }
  const perDay = {};
  for (const r of rows) perDay[r.date] = (perDay[r.date] || 0) + 1;
  const first = rows.length ? rows[rows.length - 1].date : "";
  const last = isoDate(minDate(addDays(UPDATED, -1), addDays(LISTED, -1)));
  // Only days the selection covers: the chosen year, and not the Großlage days that were filtered out
  // (they'd otherwise count as stormy days without alarms). Silvester and Neujahr are left out too: their
  // fireworks alarms come whatever the weather, and two stormy Neujahr days made windy days look busy.
  const covered = days.filter((d) => d >= first && d <= last && (!year || d.startsWith(year)) && !dropped.has(d) &&
    !["12-31", "01-01"].includes(d.slice(5)));
  // Without a mouse the tooltip never shows, so the number of days goes next to the label.
  const touch = matchMedia("(hover: none)").matches;
  const tage = (n) => `${n} ${n === 1 ? "Tag" : "Tage"}`;
  box.innerHTML = WEATHER_BUCKETS.map(([title, , ], i) => `<h2>${title}</h2><div class="chart" id="c-weather-${i}"></div>`).join("");
  WEATHER_BUCKETS.forEach(([title, field, buckets], i) => {
    barList($(`#c-weather-${i}`), buckets.map(([lo, hi, label]) => {
      const ds = covered.filter((d) => WEATHER[d][field] >= lo && WEATHER[d][field] < hi);
      const n = ds.reduce((a, d) => a + (perDay[d] || 0), 0);
      const avg = ds.length ? n / ds.length : 0;
      return {
        label: touch && ds.length ? `${label} · ${tage(ds.length)}` : label,
        value: Math.round(avg * 100) / 100, display: ds.length ? avg.toFixed(2).replace(".", ",") : "keine Tage",
        tip: `<b>${label}</b><br>${tage(ds.length)}, ${einsaetze(n)}<br>Ø ${avg.toFixed(2).replace(".", ",")} pro Tag`,
      };
    }));
  });
}
