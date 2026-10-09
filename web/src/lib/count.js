// Counting alarms by a key, and the numbers around counts.
import { parseDate, weekday } from "./dates.js";

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
