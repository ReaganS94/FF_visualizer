// Dates as the site handles them: "YYYY-MM-DD" text, as in the data, and Date objects at local midnight.
// Everything is local time; the data is Hannover time.

export const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const WEEKDAYS_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
export const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
export const isoDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
export const addDays = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
export const weekday = (dt) => (dt.getDay() + 6) % 7; // Monday = 0
export const fmtDate = (iso) => iso.split("-").reverse().join("."); // "2026-10-07" -> "07.10.2026"
export const minDate = (a, b) => (a < b ? a : b);
export const maxDate = (a, b) => (a > b ? a : b);

// The longest stretch of days from `from` to `to` ("YYYY-MM-DD") that are all in `days` (a Set of
// "YYYY-MM-DD"), or with `inside` false all missing from it: { len, from, to }, or null if there is none.
export function longestRun(days, from, to, inside) {
  let best = null, start = null;
  for (let d = parseDate(from); isoDate(d) <= to; d = addDays(d, 1)) {
    const k = isoDate(d);
    if (days.has(k) !== inside) { start = null; continue; }
    start ||= k;
    const len = Math.round((d - parseDate(start)) / 864e5) + 1;
    if (!best || len > best.len) best = { len, from: start, to: k };
  }
  return best;
}
