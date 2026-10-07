// Counting alarms by a key.

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
