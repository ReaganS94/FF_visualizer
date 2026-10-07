// The Jahresrückblick and the year story: which alarms a year counts, what it is compared with, and
// the line of alarms added up day by day.
import { isoDate, addDays, minDate } from "./dates.js";

// Keywords worth listing individually in the annual report.
export const NOTABLE = /^(b2|b3|ob|ba2|bg2|abc2|hm2|hm3|hw\d|hu\d|manv.*)$/;

// What the annual report and the year story compare: a running year only up to the website's newest
// entry (later alarms exist only where they were entered by hand), against the same period a year earlier.
// year: "2026", all: the cleaned alarms (newest first), listed: the day of the website's newest alarm,
// today: to tell a running year. The result's `listed` is that day as "YYYY-MM-DD".
export function yearInfo(year, storm, all, listed, today = new Date()) {
  const alarms = all.filter((r) => !r.standby && (storm || !r.bigDay));
  const rows = alarms.filter((r) => r.date.startsWith(year));
  const prev = alarms.filter((r) => r.date.startsWith(String(year - 1)));
  const lastDate = rows.length ? rows[0].date : "";
  const listedDay = isoDate(listed);
  // Not complete while the year runs, nor in January while the website still catches up on December.
  const running = Number(year) >= today.getFullYear();
  const partial = Boolean(lastDate) && (running || listedDay < `${year}-12-31`);
  const cutDate = partial ? minDate(lastDate, listedDay) : `${year}-12-31`;
  const cut = cutDate.startsWith(year) ? cutDate.slice(5) : "";
  const cmpRows = rows.filter((r) => r.date.slice(5) <= cut);
  const prevSame = partial ? prev.filter((r) => r.date.slice(5) <= cut) : prev;
  const delta = prevSame.length && cut ? Math.round((100 * (cmpRows.length - prevSame.length)) / prevSame.length) : null;
  return { alarms, rows, prev, lastDate, running, partial, listed: listedDay, cutDate, cut, cmpRows, prevSame, delta };
}

// The days of a leap year ("MM-DD"), so every date sits at the same place in every year.
export const DAY_SLOTS = Array.from({ length: 366 }, (_, i) => isoDate(addDays(new Date(2024, 0, 1), i)).slice(5));

// Alarms from 01.01. added up day by day, one number per DAY_SLOTS day; null after `until` ("MM-DD"),
// so the line stops there.
export function runningTotal(rows, until) {
  const per = {};
  for (const r of rows) per[r.date.slice(5)] = (per[r.date.slice(5)] || 0) + 1;
  let sum = 0;
  return DAY_SLOTS.map((d) => (d > until ? null : (sum += per[d] || 0)));
}
