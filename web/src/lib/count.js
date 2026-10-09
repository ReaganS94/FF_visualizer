// Counting alarms by a key, and the numbers around counts.
import { parseDate, isoDate, weekday, minDate } from "./dates.js";
import { BIG_DAY } from "./alarms.js";
import { DAY_START, NIGHT_START } from "./estimate.js";

// The `n` most common values of key(r), most first: [[value, rows], ...]. Rows without a value count as "unbekannt".
export function topCounts(rows, key, n = 15) {
  const c = {};
  for (const r of rows) { const k = key(r) || "unbekannt"; (c[k] ||= []).push(r); }
  return Object.entries(c).sort((a, b) => b[1].length - a[1].length).slice(0, n);
}

// Every value with its count, most first: [[value, count], ...].
export const counted = (list, f) => topCounts(list, f, 999).map(([k, l]) => [k, l.length]);

// n of `of` in whole percent.
export const pct = (n, of) => Math.round((100 * n) / of);

// The round number a chart's scale (or the quiz's slider) ends at: 5, or 1, 2, 2,5 or 5 times a power of ten.
export function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

// The alarms with a real time by weekday (Monday = 0) and hour, as grid[weekday][hour], and by hour alone (the
// Tageszeit). The alarms of a big day that were entered without a time are left out.
export function weekHours(rows) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  const hours = Array(24).fill(0);
  for (const r of rows) {
    if (r.timeUnknown) continue;
    grid[weekday(parseDate(r.date))][r.hour]++;
    hours[r.hour]++;
  }
  return { grid, hours };
}

// A count's shade on a heat chart, 0 to 5: 0 for none, else 1 to 5 by fifths of the largest count, max.
export const heatLevel = (n, max) => (n === 0 ? 0 : 1 + Math.min(4, Math.floor((n / max) * 5 - 1e-9)));

// The alarms of each Großlage day, without standbys: { date: count }. With "Großlagen mitzählen" off, the Kalender
// says on those days how many alarms it leaves out.
export function bigDayCounts(alarms) {
  const n = {};
  for (const r of alarms) if (r.bigDay && !r.standby) n[r.date] = (n[r.date] || 0) + 1;
  return n;
}

// A day's shade on the Kalender, 0 to 5: 0, 1, 2, 3–4 and 5 to BIG_DAY − 1 alarms, and a Großlage's BIG_DAY or more.
export const dayLevel = (n) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : n < BIG_DAY ? 4 : 5);

// The alarms per week (the Übersicht) over the days the website's list covers: from 01.01. of the chosen year, or
// from the first alarm, to the website's newest alarm or the year's end. Later days hold only hand entries so far,
// the same rule as the year's story. rows: newest first; year: "2026", or "" for all; listed: the website's newest
// day, "YYYY-MM-DD". { value, to } with `to` the last day counted, or null when no day is covered.
export function perWeek(rows, year, listed) {
  if (!rows.length) return null;
  const from = year ? `${year}-01-01` : rows.at(-1).date;
  const to = year && listed > `${year}-12-31` ? `${year}-12-31` : minDate(rows[0].date, listed);
  if (to < from) return null;
  const days = (parseDate(to) - parseDate(from)) / 864e5 + 1;
  return { value: rows.filter((r) => r.date <= to).length / (days / 7), to };
}

// The share of the alarms with a real time that came at night (22 to 6 Uhr), in whole percent; null when none has one.
export function nightShare(rows) {
  const known = rows.filter((r) => !r.timeUnknown);
  return known.length ? pct(known.filter((r) => r.hour >= NIGHT_START || r.hour < DAY_START).length, known.length) : null;
}

// The alarms in each month from the first alarm's month to the last one's, months without alarms included, oldest
// first: [{ year, month (0–11), n }, ...]. rows: newest first.
export function perMonth(rows) {
  if (!rows.length) return [];
  const counts = {};
  for (const r of rows) counts[r.date.slice(0, 7)] = (counts[r.date.slice(0, 7)] || 0) + 1;
  const first = parseDate(rows.at(-1).date), last = parseDate(rows[0].date);
  const out = [];
  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1))
    out.push({ year: d.getFullYear(), month: d.getMonth(), n: counts[isoDate(d).slice(0, 7)] || 0 });
  return out;
}
