// Weather as the site reads it from data/weather.json: one entry per day, "YYYY-MM-DD" ->
// { tmax, tmin, rain, gust, code }, past days and the forecast for the next ones.
import { addDays, isoDate } from "./dates.js";

export const HOT = 30; // °C: a hot day, and the heat rule of the "Einsatz heute?" estimate
export const GUST = 60; // km/h, Sturmböen
export const isHot = (w) => w.tmax >= HOT, isStorm = (w) => w.gust >= GUST, isThunder = (w) => w.code >= 95;

// weather code (WMO, from Open-Meteo) -> symbol and word
const WX = [
  [(c) => c >= 95, "thunder", "Gewitter"],
  [(c) => (c >= 71 && c <= 77) || c === 85 || c === 86, "snow", "Schnee"],
  [(c) => c >= 51 && c <= 82, "rain", "Regen"],
  [(c) => c === 45 || c === 48, "fog", "Nebel"],
  [(c) => c === 3, "cloud", "bewölkt"],
  [(c) => c === 1 || c === 2, "part", "teils sonnig"],
  [() => true, "sun", "sonnig"],
];
// Without a code (weather saved before the symbols were added) only rain can be told.
export const wxKind = (w) => (w.code == null ? (w.rain >= 1 ? ["rain", "Regen"] : null) : WX.find(([is]) => is(w.code)).slice(1));

// How often past days with this weather had an alarm during the day, against the other days.
// win: alarmWindows() from estimate.js, is: e.g. isHot.
export function weatherFacts(first, last, win, is, weather) {
  const f = { on: 0, onHit: 0, off: 0, offHit: 0 };
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const k = isoDate(d), w = weather[k];
    if (!w) continue;
    const hit = win.inDay.has(k);
    if (is(w)) { f.on++; f.onHit += hit; } else { f.off++; f.offHit += hit; }
  }
  return f;
}
