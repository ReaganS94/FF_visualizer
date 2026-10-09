// Wetter: the average number of alarms per day, by gusts, rain and the day's highest temperature.
import { Fragment } from "react";
import { isoDate, addDays, minDate } from "../../lib/dates.js";
import { einsaetze } from "../../lib/text.js";
import { weatherDays, perRange } from "../../lib/weather.js";
import { ALL, WEATHER, UPDATED, LISTED } from "../../data.js";
import { barList } from "../../components/charts.js";
import Chart from "../../components/Chart.jsx";

// A chart per weather value: its title, its field in the weather data, and its ranges, from lo up to below hi.
const CHARTS = [
  ["Windböen", "gust", [[0, 40, "unter 40 km/h"], [40, 60, "40–60 km/h"], [60, 80, "60–80 km/h"], [80, 999, "ab 80 km/h"]]],
  ["Niederschlag", "rain", [[0, 0.1, "trocken"], [0.1, 5, "bis 5 mm"], [5, 20, "5–20 mm"], [20, 999, "ab 20 mm"]]],
  ["Höchsttemperatur", "tmax", [[-99, 0, "unter 0 °C"], [0, 10, "0–10 °C"], [10, 20, "10–20 °C"], [20, 30, "20–30 °C"], [30, 99, "ab 30 °C"]]],
];
const tage = (n) => `${n} ${n === 1 ? "Tag" : "Tage"}`;
const dec2 = (x) => x.toFixed(2).replace(".", ",");

// rows: the alarms chosen with the filters above the tabs; year: the year chosen there ("" for all); storm: whether
// "Großlagen mitzählen" is on. Wachbesetzungen never count here, even with "Wachbesetzungen mitzählen" on.
export default function Weather({ rows, year, storm }) {
  const alarms = rows.filter((r) => !r.standby);
  const perDay = {};
  for (const r of alarms) perDay[r.date] = (perDay[r.date] || 0) + 1;
  // From the first alarm to the day before the website's newest one: later days aren't fully listed yet and would
  // look free of alarms.
  const first = alarms.length ? alarms.at(-1).date : "";
  const last = isoDate(minDate(addDays(UPDATED, -1), addDays(LISTED, -1)));
  const dropped = new Set(storm ? [] : ALL.filter((r) => r.bigDay).map((r) => r.date));
  const days = weatherDays(WEATHER, first, last, year, dropped);
  // Without a mouse the tooltip never shows, so the number of days goes next to the label.
  const touch = matchMedia("(hover: none)").matches;
  const charts = CHARTS.map(([title, field, ranges]) => [title, field, perRange(days, WEATHER, field, ranges, perDay)
    .map(({ days: n, alarms: a }, i) => {
      const label = ranges[i][2], avg = n ? a / n : 0;
      return {
        label: touch && n ? `${label} · ${tage(n)}` : label,
        value: Math.round(avg * 100) / 100, display: n ? dec2(avg) : "keine Tage",
        tip: `<b>${label}</b><br>${tage(n)}, ${einsaetze(a)}<br>Ø ${dec2(avg)} pro Tag`,
      };
    })]);
  return (
    <>
      <p className="note">Durchschnittliche Einsätze pro Tag, je nach Wetter in Hannover (Daten: Open-Meteo). Wenige Tage in einer Zeile bedeuten eine unsichere Zahl. Silvester und Neujahr (31.12. und 01.01.) zählen hier nicht mit: Das Feuerwerk bringt dann jedes Jahr viele Einsätze, ganz gleich bei welchem Wetter.</p>
      <div id="c-weather">
        {Object.keys(WEATHER).length ? charts.map(([title, field, items], i) => (
          <Fragment key={field}>
            <h2>{title}</h2>
            <Chart id={`c-weather-${i}`} draw={(box) => barList(box, items)} />
          </Fragment>
        )) : <p className="note">Die Wetterdaten erscheinen nach der nächsten täglichen Aktualisierung.</p>}
      </div>
    </>
  );
}
