// Counting alarms by a key, and the numbers around counts.
import { parseDate, weekday } from "./dates.js";
import { BIG_DAY } from "./alarms.js";

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
