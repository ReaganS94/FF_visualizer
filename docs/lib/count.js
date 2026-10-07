// Counting alarms by a key, and the numbers around counts.

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
