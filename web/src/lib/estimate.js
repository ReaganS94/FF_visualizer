// "Einsatz heute?": how likely at least one alarm is today during the day and tonight, and how well that
// guess would have done in the past.
// Day (6–22 Uhr): share of past days with the same weekday that had at least one alarm, blended with
// the rate over all days, and on a day forecast at 30 °C or more blended again with the past hot days.
// Night (22–6 Uhr): the share of all past nights. Replaying every day since July 2024 picked this over
// the earlier weekday-and-month version: at night no weekday or month pattern held from one year to
// the next, and by day the month added nothing once the weekday was known. Deliberately simple so
// anyone can check it by hand.
import { parseDate, isoDate, addDays, weekday, minDate } from "./dates.js";
import { HOT } from "./weather.js";

export const DAY_START = 6; // "tagsüber" = 06:00–21:59, "nachts" = 22:00–05:59
export const NIGHT_START = 22;
export const PRIOR = 10;
// Nights that are busy every year whatever the weekday (Silvester: 20 alarms in 2024, 14 in 2025).
// They get no percentage: the page shows the same night of earlier years instead, and they are
// left out when estimating ordinary nights.
const SPECIAL_NIGHTS = { "12-31": ["Silvesternacht", "Silvesternächten"] };
export const specialNight = (iso) => SPECIAL_NIGHTS[iso.slice(5)];

// The days ("YYYY-MM-DD") with at least one alarm during the day, and the nights with one, each named
// after the evening it starts on. Standbys don't count.
export function alarmWindows(rows) {
  const inDay = new Set(), inNight = new Set();
  for (const r of rows) {
    if (r.standby) continue;
    if (r.timeUnknown || (r.hour >= DAY_START && r.hour < NIGHT_START)) inDay.add(r.date);
    else if (r.hour >= NIGHT_START) inNight.add(r.date);
    else inNight.add(isoDate(addDays(parseDate(r.date), -1))); // 00:00–05:59 belongs to the previous evening's night
  }
  return { inDay, inNight };
}

// The last day an estimate made on `day` may count: yesterday's night ends this morning, and days after
// the last scrape (`updated`) or after the website's newest entry (`listed`) would otherwise look alarm-free.
export function lastCovered(day, updated, listed) {
  const scraped = new Date(updated); scraped.setHours(0, 0, 0, 0);
  return minDate(addDays(minDate(scraped, day), -2), addDays(listed, -1));
}

// Uses only days from `first` to `last`, so the backtest can hide the future from itself.
// win: alarmWindows(), weather: data/weather.json's days.
export function estimate(target, first, last, win, weather) {
  // the same weekday, walking back from `last` in weekly steps
  const days = [];
  for (let d = addDays(last, -((weekday(last) - weekday(target) + 7) % 7)); d >= first; d = addDays(d, -7)) days.push(isoDate(d));
  let total = 0, totDay = 0, nights = 0, night = 0, hot = 0, hotDay = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const k = isoDate(d);
    total++; totDay += win.inDay.has(k);
    if (!specialNight(k)) { nights++; night += win.inNight.has(k); }
    if (weather[k]?.tmax >= HOT) { hot++; hotDay += win.inDay.has(k); }
  }
  // About 30 to 140 same weekdays: a single lucky week still moves the share, so blend in the rate
  // over all days (as if we had seen PRIOR extra average days).
  const blend = (hits, n, base) => (hits + PRIOR * base) / (n + PRIOR);
  const day = days.filter((d) => win.inDay.has(d)).length;
  const weekdayP = blend(day, days.length, total ? totDay / total : 0);
  const tmax = weather[isoDate(target)]?.tmax, heat = tmax >= HOT;
  return {
    n: days.length, day, weekdayP, heat, tmax, hot, hotDay, nights, night,
    pDay: heat ? blend(hotDay, hot, weekdayP) : weekdayP, pNight: nights ? night / nights : 0,
  };
}

// Would the page have been right? Replays the estimate for every past day using only older data.
export function backtest(first, last, win, weather) {
  const bins = [[0, 10], [10, 20], [20, 30], [30, 40], [40, 101]].map(([lo, hi]) => ({ lo, hi, n: 0, hit: 0, sum: 0 }));
  let n = 0;
  for (let t = addDays(first, 182); t <= last; t = addDays(t, 1)) {
    const e = estimate(t, first, addDays(t, -2), win, weather);
    if (!e.n) continue;
    for (const [k, set, day] of [["day", win.inDay, isoDate(t)], ["night", win.inNight, isoDate(t)]]) {
      if (k === "night" && specialNight(day)) continue; // the page shows no percentage for these
      const p = 100 * e[k === "day" ? "pDay" : "pNight"];
      const b = bins.find((b) => p >= b.lo && p < b.hi);
      b.n++; b.sum += p; if (set.has(day)) b.hit++;
      n++;
    }
  }
  return { bins: bins.filter((b) => b.n), n };
}

// A row fits when the share that really had an alarm lies in the range the page said. Fewer than
// 50 estimates are too few to tell: one alarm more or less moves the share by several points.
export function backtestFit(b, rate) {
  if (b.n < 50) return "Zu wenige Fälle";
  if (rate < b.lo) return "Nein, zu hoch";
  if (b.hi <= 100 && rate > b.hi) return "Nein, zu niedrig";
  return "Ja";
}

// Low, middle and high estimates for the short version of the check (percent from, to, label).
export const BACKTEST_GROUPS = [[0, 10, "unter 10 %"], [10, 30, "10–30 %"], [30, 101, "ab 30 %"]];

// The backtest's bins added up into those three groups, each with how many of 100 had an alarm.
export function backtestGroups(bt) {
  return BACKTEST_GROUPS.map(([lo, hi, label]) => {
    const bins = bt.bins.filter((b) => b.lo >= lo && b.lo < hi);
    const n = bins.reduce((a, b) => a + b.n, 0), hit = bins.reduce((a, b) => a + b.hit, 0);
    const rate = n ? Math.round((100 * hit) / n) : 0;
    return { lo, hi, label, n, hit, rate, fit: backtestFit({ lo, hi, n }, rate) };
  }).filter((g) => g.n);
}

// Alarms in a day (06–22) or night (22–06, into the next morning) window of `iso`. Standbys don't count.
export function alarmsIn(rows, iso, night) {
  const next = isoDate(addDays(parseDate(iso), 1));
  return rows.filter((r) => !r.standby && (night
    ? !r.timeUnknown && ((r.date === iso && r.hour >= NIGHT_START) || (r.date === next && r.hour < DAY_START))
    : r.date === iso && (r.timeUnknown || (r.hour >= DAY_START && r.hour < NIGHT_START)))).length;
}
